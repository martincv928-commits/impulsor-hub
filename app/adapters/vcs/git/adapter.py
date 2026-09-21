"""Git VCS adapter (SPEC sections 7, 15).

Design decision (documented again in M1_REPORT.md): checkpoint/restore is
implemented as a **filesystem-level snapshot** under
`<workspace>/.impulsor/checkpoints/<id>/`, not `git stash`/`git commit`.

Rationale:
- `git stash` does not capture ignored files by default and interacts with
  the index in ways that are easy to get subtly wrong under a dirty repo.
- SPEC 15 explicitly forbids a naive `git reset --hard` / `git clean`
  restore and requires proof that pre-existing tracked *and* untracked work
  survives rollback. A plain recursive copy of the entire working tree
  (minus `.git` and `.impulsor`) gives an exact, easy-to-verify baseline
  and an exact, easy-to-verify restore, independent of git plumbing edge
  cases.
- git itself is still used for `status`/`diff` (the *observation* half of
  the pipeline — SPEC 3.10-3.11), since that is what "Git-observed changes"
  means in the spec. Checkpointing and observing are deliberately separate
  concerns.

All git invocations use argument arrays via subprocess (never shell=True)
and are restricted to read-only / non-history-mutating subcommands.
"""
from __future__ import annotations

import shutil
import subprocess
import uuid
from pathlib import Path
from typing import Any

from app.adapters.vcs.base import (
    ChangeManifest,
    CheckpointError,
    CheckpointRef,
    FileChangeEntry,
    RepositoryNotFoundError,
    RollbackError,
    VcsAdapter,
    VcsNotAvailableError,
    VcsStatus,
)

_GIT_TIMEOUT_SECONDS = 30
_IGNORED_TOP_LEVEL_DIRS = {".git", ".impulsor"}

# Only ever these read-only subcommands are executed by this adapter.
_ALLOWED_SUBCOMMANDS = {"--version", "rev-parse", "status", "diff"}


def _run_git(args: list[str], cwd: Path) -> subprocess.CompletedProcess:
    subcommand = args[0] if args else ""
    if subcommand not in _ALLOWED_SUBCOMMANDS:
        raise AssertionError(f"git adapter attempted disallowed subcommand: {subcommand}")
    return subprocess.run(
        ["git", *args],
        cwd=str(cwd),
        capture_output=True,
        text=True,
        timeout=_GIT_TIMEOUT_SECONDS,
        check=False,
    )


class GitAdapter(VcsAdapter):
    adapter_key = "git"

    def detect(self) -> dict[str, Any]:
        try:
            proc = subprocess.run(
                ["git", "--version"], capture_output=True, text=True, timeout=5, check=False
            )
        except FileNotFoundError:
            return {"available": False, "version": None}
        if proc.returncode != 0:
            return {"available": False, "version": None}
        return {"available": True, "version": proc.stdout.strip()}

    def health_check(self) -> dict[str, Any]:
        info = self.detect()
        return {
            "status": "healthy" if info["available"] else "unavailable",
            "available": info["available"],
            "version": info["version"],
        }

    def validate_repository(self, workspace: Path) -> None:
        if not workspace.exists():
            raise RepositoryNotFoundError(f"Path does not exist: {workspace}")
        if not workspace.is_dir():
            raise RepositoryNotFoundError(f"Path is not a directory: {workspace}")
        if not self.detect()["available"]:
            raise VcsNotAvailableError("git executable not found")
        try:
            proc = _run_git(["rev-parse", "--is-inside-work-tree"], cwd=workspace)
        except subprocess.TimeoutExpired as exc:
            raise VcsNotAvailableError("git rev-parse timed out") from exc
        if proc.returncode != 0 or proc.stdout.strip() != "true":
            raise RepositoryNotFoundError(f"Not a git repository: {workspace}")

    def status(self, workspace: Path) -> VcsStatus:
        try:
            self.validate_repository(workspace)
        except (RepositoryNotFoundError, VcsNotAvailableError) as exc:
            return VcsStatus(is_repository=False, is_clean=True, entries=[], error=str(exc))
        proc = _run_git(["status", "--porcelain=v1", "--untracked-files=all"], cwd=workspace)
        if proc.returncode != 0:
            return VcsStatus(is_repository=True, is_clean=True, entries=[], error=proc.stderr.strip())
        entries = []
        for line in proc.stdout.splitlines():
            if not line:
                continue
            code = line[:2]
            path = line[3:]
            if " -> " in path:  # rename entries: "old -> new"
                path = path.split(" -> ", 1)[1]
            if Path(path).parts and Path(path).parts[0] in _IGNORED_TOP_LEVEL_DIRS:
                continue
            entries.append({"path": path, "status_code": code})
        return VcsStatus(is_repository=True, is_clean=(len(entries) == 0), entries=entries)

    def create_checkpoint(self, workspace: Path, checkpoint_dir: Path) -> CheckpointRef:
        checkpoint_id = str(uuid.uuid4())
        snapshot_root = checkpoint_dir / checkpoint_id
        try:
            snapshot_root.mkdir(parents=True, exist_ok=False)
            for item in workspace.iterdir():
                if item.name in _IGNORED_TOP_LEVEL_DIRS:
                    continue
                dest = snapshot_root / item.name
                if item.is_dir() and not item.is_symlink():
                    shutil.copytree(item, dest, symlinks=True)
                else:
                    shutil.copy2(item, dest, follow_symlinks=False)
        except OSError as exc:
            raise CheckpointError(f"Failed to create checkpoint: {exc}") from exc
        return CheckpointRef(mechanism="filesystem_snapshot", reference=str(snapshot_root))

    def restore_checkpoint(self, workspace: Path, ref: CheckpointRef) -> None:
        if ref.mechanism != "filesystem_snapshot":
            raise RollbackError(f"Unsupported checkpoint mechanism: {ref.mechanism}")
        snapshot_root = Path(ref.reference)
        if not snapshot_root.is_dir():
            raise RollbackError(f"Checkpoint snapshot missing: {snapshot_root}")

        try:
            snapshot_paths = _relative_file_set(snapshot_root)
            current_paths = _relative_file_set(workspace, exclude_top_level=_IGNORED_TOP_LEVEL_DIRS)

            # 1. Remove anything created since the checkpoint (AI-created files).
            for rel_path in sorted(current_paths - snapshot_paths, reverse=True):
                target = workspace / rel_path
                if target.is_symlink() or target.is_file():
                    target.unlink(missing_ok=True)
                elif target.is_dir():
                    shutil.rmtree(target, ignore_errors=True)

            # 2. Restore every path that existed at checkpoint time to its
            #    exact prior content (covers modified files, and files the
            #    task deleted).
            for rel_path in sorted(snapshot_paths):
                src = snapshot_root / rel_path
                dst = workspace / rel_path
                dst.parent.mkdir(parents=True, exist_ok=True)
                if src.is_dir() and not src.is_symlink():
                    dst.mkdir(exist_ok=True)
                else:
                    shutil.copy2(src, dst, follow_symlinks=False)

            _prune_empty_dirs(workspace, exclude_top_level=_IGNORED_TOP_LEVEL_DIRS)
        except OSError as exc:
            raise RollbackError(f"Failed to restore checkpoint: {exc}") from exc

    def compute_change_manifest(
        self, workspace: Path, pre_status: VcsStatus, post_status: VcsStatus
    ) -> ChangeManifest:
        pre_map = {e["path"]: e["status_code"] for e in pre_status.entries}
        post_map = {e["path"]: e["status_code"] for e in post_status.entries}

        touched_paths = sorted(set(pre_map) | set(post_map))
        entries: list[FileChangeEntry] = []
        for path in touched_paths:
            pre_code = pre_map.get(path)
            post_code = post_map.get(path)
            if pre_code == post_code:
                continue  # unchanged since before the task; not this task's work
            change_type = _classify_change(pre_code, post_code)
            additions, deletions = _numstat_for_path(workspace, path, change_type)
            entries.append(
                FileChangeEntry(
                    path=path,
                    change_type=change_type,
                    additions=additions,
                    deletions=deletions,
                )
            )
        return ChangeManifest(entries=entries)


def _relative_file_set(root: Path, exclude_top_level: set[str] | None = None) -> set[str]:
    exclude_top_level = exclude_top_level or set()
    result: set[str] = set()
    if not root.exists():
        return result
    for path in root.rglob("*"):
        try:
            rel = path.relative_to(root)
        except ValueError:
            continue
        if rel.parts and rel.parts[0] in exclude_top_level:
            continue
        if path.is_dir() and not path.is_symlink():
            continue  # directories are implied by their file entries
        result.add(str(rel))
    return result


def _prune_empty_dirs(root: Path, exclude_top_level: set[str]) -> None:
    for dirpath in sorted(root.rglob("*"), key=lambda p: len(p.parts), reverse=True):
        if not dirpath.is_dir() or dirpath.is_symlink():
            continue
        rel = dirpath.relative_to(root)
        if rel.parts and rel.parts[0] in exclude_top_level:
            continue
        try:
            next(dirpath.iterdir())
        except StopIteration:
            dirpath.rmdir()
        except OSError:
            pass


def _classify_change(pre_code: str | None, post_code: str | None) -> str:
    if pre_code is None and post_code is not None:
        return "created" if "?" in post_code else "modified"
    if pre_code is not None and post_code is None:
        return "deleted"
    if post_code and "D" in post_code:
        return "deleted"
    return "modified"


def _numstat_for_path(workspace: Path, path: str, change_type: str) -> tuple[int | None, int | None]:
    target = workspace / path
    if change_type == "created":
        if target.is_file():
            try:
                with target.open("rb") as f:
                    lines = sum(1 for _ in f)
                return lines, 0
            except OSError:
                return None, None
        return None, None
    proc = _run_git(["diff", "--numstat", "--", path], cwd=workspace)
    if proc.returncode == 0 and proc.stdout.strip():
        parts = proc.stdout.strip().split("\t")
        if len(parts) >= 2 and parts[0].isdigit() and parts[1].isdigit():
            return int(parts[0]), int(parts[1])
    return None, None
