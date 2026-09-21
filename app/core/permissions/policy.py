"""Workspace boundary + policy enforcement (SPEC sections 6.10-6.11, 6.17).

Prompt instructions alone are not a security boundary (SPEC line 187), so
every place that touches the filesystem or spawns a subprocess for a
project MUST go through these helpers instead of trusting caller-provided
paths or building shell strings.
"""
from __future__ import annotations

from pathlib import Path

IMPULSOR_METADATA_DIRNAME = ".impulsor"

FORBIDDEN_GIT_SUBCOMMANDS = {
    "commit",
    "reset",
    "rebase",
    "stash",
    "checkout",
    "switch",
    "branch",
    "filter-branch",
    "reflog",
    "push",
    "clean",
}


class WorkspaceBoundaryError(Exception):
    """Raised when a path would resolve outside the project root, or into
    the Hub-owned .impulsor metadata directory."""


class ForbiddenGitOperationError(Exception):
    """Raised when a caller (executor-facing code path) attempts a
    history-mutating git subcommand that only the Hub is allowed to run."""


def normalize_project_root(raw_path: str) -> Path:
    """Resolve a user-supplied path to an absolute, symlink-free path.

    Does not require the path to exist yet; existence is validated
    separately by the project service so we can return a specific error
    message ("path does not exist" vs "not a git repository").
    """
    if not raw_path or not raw_path.strip():
        raise WorkspaceBoundaryError("Project root path must not be empty")
    return Path(raw_path).expanduser().resolve()


def validate_path_within_workspace(workspace_root: Path, candidate: Path) -> Path:
    """Ensure `candidate` resolves inside `workspace_root` and is not the
    Hub's own metadata directory. Returns the resolved candidate path.

    Uses Path.resolve() + relative_to rather than string prefix matching,
    which is unsafe against paths like /workspace-evil sharing a prefix
    with /workspace.
    """
    root = workspace_root.resolve()
    resolved = candidate if candidate.is_absolute() else (root / candidate)
    resolved = resolved.resolve()
    try:
        relative = resolved.relative_to(root)
    except ValueError as exc:
        raise WorkspaceBoundaryError(
            f"Path '{candidate}' resolves outside workspace root '{root}'"
        ) from exc
    if relative.parts and relative.parts[0] == IMPULSOR_METADATA_DIRNAME:
        raise WorkspaceBoundaryError(
            f"Path '{candidate}' targets Hub-owned '{IMPULSOR_METADATA_DIRNAME}/' metadata directory"
        )
    return resolved


def impulsor_metadata_dir(workspace_root: Path) -> Path:
    return workspace_root.resolve() / IMPULSOR_METADATA_DIRNAME


def assert_allowed_git_subcommand(args: list[str]) -> None:
    """Guard for any code path that could be influenced by executor/AI
    output before shelling out to git. The Hub's own VCS adapter uses a
    fixed, hard-coded allowlist of invocations instead (see
    adapters/vcs/git/adapter.py) and does not need this guard, but it is
    kept here as a defense-in-depth check for any future generic path."""
    if not args:
        raise ForbiddenGitOperationError("Empty git command")
    subcommand = args[0]
    if subcommand in FORBIDDEN_GIT_SUBCOMMANDS:
        raise ForbiddenGitOperationError(
            f"git {subcommand} is a Hub-only, history-mutating operation and is not permitted here"
        )


def build_task_envelope(*, task_id: str, workspace: Path, objective: str) -> str:
    """Render the exact executor instruction text from SPEC section 12."""
    return (
        "IMPULSOR HUB TASK\n"
        f"TASK_ID: {task_id}\n"
        f"WORKSPACE: {workspace}\n"
        f"OBJECTIVE: {objective}\n"
        "\n"
        "RULES:\n"
        "- Work only inside WORKSPACE.\n"
        "- Do not run git commit/reset/rebase/stash/checkout or rewrite history.\n"
        "- Do not modify .impulsor.\n"
        "- Do not access files outside WORKSPACE.\n"
        "- Do not install dependencies without approval.\n"
        "- Do not delete files unless explicitly required.\n"
        "- Make the minimum changes necessary.\n"
        "- Preserve existing behavior outside the objective.\n"
        "- Return the required structured result.\n"
    )
