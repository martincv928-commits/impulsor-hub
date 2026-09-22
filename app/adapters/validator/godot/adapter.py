"""Godot validator adapter (M2 SPEC sections 2, 15).

Scope decision (documented again in M2_REPORT.md): validation means
**GDScript syntax/parse validation**, run headlessly via
`godot --path <workspace> --script res://<file> --check-only --quiet` for
every `.gd` file in the project -- not a full game boot. Rationale:

- `--check-only --script <file>` gives a reliable per-file exit code
  (0 = parses cleanly, 1 = parse error) and a clean stderr message with
  file/line, verified empirically against the real `godot3-server` binary.
- Booting the full project (`--path <project> --quit`) to catch errors is
  historically unreliable for exit-code purposes in Godot CI pipelines
  (script errors don't reliably propagate to the process exit code), and
  would require a first-run asset import pass that is slow and fragile in
  a headless container with a dummy video driver.
- This is still a *real*, externally-authoritative check the AI executor
  has no control over -- it is not a mock.

Never depends on a fixed install path: resolves the executable via
`IMPULSOR_HUB_GODOT_PATH` (manual override) or a PATH search across common
binary names, covering both Godot 3 ("-server"/"-headless" builds) and
Godot 4 (which needs an explicit `--headless` flag for true headless
operation; Godot 3 does not use that flag).
"""
from __future__ import annotations

import os
import re
import shutil
import subprocess
import threading
import time
from pathlib import Path
from typing import Any, Optional

from app.adapters.validator.base import (
    ValidationIssue,
    ValidationResult,
    ValidationStatus,
    ValidatorAdapter,
)

_CANDIDATE_EXECUTABLE_NAMES = [
    "godot4",
    "godot",
    "godot3-server",
    "godot3",
    "Godot",
    "godot.x11.opt.tools.64",
]
_EXCLUDED_DIRS = {".git", ".impulsor", ".godot", ".import"}
_PER_FILE_MIN_TIMEOUT_SECONDS = 5
_ERROR_LOCATION_RE = re.compile(r"\((res://[^():]+):(\d+)\)")


def _resolve_executable() -> Optional[str]:
    override = os.environ.get("IMPULSOR_HUB_GODOT_PATH")
    if override:
        if shutil.which(override):
            return shutil.which(override)
        return override if Path(override).is_file() else None
    for name in _CANDIDATE_EXECUTABLE_NAMES:
        found = shutil.which(name)
        if found:
            return found
    return None


def _major_version(version_string: str) -> Optional[int]:
    match = re.match(r"(\d+)\.", version_string.strip())
    return int(match.group(1)) if match else None


def _discover_gd_scripts(workspace: Path) -> list[str]:
    """Relative, POSIX-style paths of every `.gd` file, excluding Hub/VCS/
    Godot-cache directories, sorted for deterministic validation order."""
    scripts: list[str] = []
    for path in workspace.rglob("*.gd"):
        try:
            rel = path.relative_to(workspace)
        except ValueError:
            continue
        if any(part in _EXCLUDED_DIRS for part in rel.parts):
            continue
        scripts.append(rel.as_posix())
    return sorted(scripts)


class GodotAdapter(ValidatorAdapter):
    adapter_key = "godot"

    def __init__(self) -> None:
        self._processes: dict[str, subprocess.Popen] = {}
        self._cancelled: dict[str, threading.Event] = {}
        self._lock = threading.Lock()

    def detect(self) -> dict[str, Any]:
        exe = _resolve_executable()
        if exe is None:
            return {"available": False, "version": None, "executable_path": None}
        try:
            proc = subprocess.run([exe, "--version"], capture_output=True, text=True, timeout=10, check=False)
        except (OSError, subprocess.TimeoutExpired):
            return {"available": False, "version": None, "executable_path": exe}
        # Several Godot builds (observed with the Debian godot3-server package)
        # exit non-zero even for a successful --version/--help call, so success
        # is judged by output shape, not return code.
        version = proc.stdout.strip()
        if not re.match(r"^\d+\.", version):
            return {"available": False, "version": None, "executable_path": exe}
        return {"available": True, "version": version, "executable_path": exe}

    def health_check(self) -> dict[str, Any]:
        info = self.detect()
        return {
            "status": "healthy" if info["available"] else "unavailable",
            "available": info["available"],
            "version": info["version"],
            "executable_path": info["executable_path"],
        }

    def capabilities(self) -> list[str]:
        return ["gdscript_validation"]

    def supports(self, workspace: Path) -> bool:
        return (workspace / "project.godot").is_file()

    def validate(self, workspace: Path, *, run_id: str, timeout_seconds: int) -> ValidationResult:
        start = time.monotonic()
        info = self.detect()
        if not info["available"]:
            return ValidationResult(
                validator="godot",
                status=ValidationStatus.ERROR,
                exit_code=None,
                duration_ms=0,
                command="",
                summary="Godot executable not found",
                errors=[],
                warnings=[],
            )
        if not self.supports(workspace):
            return ValidationResult(
                validator="godot",
                status=ValidationStatus.ERROR,
                exit_code=None,
                duration_ms=0,
                command="",
                summary=f"{workspace} does not contain a project.godot file",
            )

        executable = info["executable_path"]
        major = _major_version(info["version"] or "")
        scripts = _discover_gd_scripts(workspace)
        command_template = f"{executable} --path {workspace} --script res://<file> --check-only --quiet"

        cancel_event = threading.Event()
        with self._lock:
            self._cancelled[run_id] = cancel_event

        errors: list[ValidationIssue] = []
        stderr_parts: list[str] = []
        checked = 0
        timed_out = False
        crashed: Optional[str] = None
        was_cancelled = False

        try:
            for rel_path in scripts:
                if cancel_event.is_set():
                    was_cancelled = True
                    break
                args = [executable, "--path", str(workspace), "--script", f"res://{rel_path}", "--check-only", "--quiet"]
                if major is not None and major >= 4:
                    args.insert(1, "--headless")
                try:
                    popen = subprocess.Popen(
                        args, cwd=str(workspace), stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True
                    )
                except OSError as exc:
                    crashed = f"Failed to launch Godot: {exc}"
                    break
                with self._lock:
                    self._processes[run_id] = popen
                try:
                    stdout, stderr = popen.communicate(timeout=max(timeout_seconds, _PER_FILE_MIN_TIMEOUT_SECONDS))
                except subprocess.TimeoutExpired:
                    popen.kill()
                    popen.communicate()
                    timed_out = True
                    break
                finally:
                    with self._lock:
                        self._processes.pop(run_id, None)

                checked += 1
                if cancel_event.is_set():
                    was_cancelled = True
                    break
                if popen.returncode == 0:
                    continue
                if popen.returncode == 1:
                    stderr_parts.append(stderr)
                    errors.append(_parse_error_message(rel_path, stderr))
                else:
                    crashed = f"Godot exited with unexpected code {popen.returncode} validating {rel_path}"
                    stderr_parts.append(stderr)
                    break
        finally:
            with self._lock:
                self._cancelled.pop(run_id, None)
                self._processes.pop(run_id, None)

        duration_ms = int((time.monotonic() - start) * 1000)
        stderr_excerpt = ("\n".join(stderr_parts))[:2000]

        if timed_out:
            return ValidationResult(
                validator="godot",
                status=ValidationStatus.TIMEOUT,
                exit_code=None,
                duration_ms=duration_ms,
                command=command_template,
                summary=f"Godot validation timed out after {timeout_seconds}s (checked {checked}/{len(scripts)} scripts)",
                stderr_excerpt=stderr_excerpt,
            )
        if was_cancelled:
            return ValidationResult(
                validator="godot",
                status=ValidationStatus.ERROR,
                exit_code=None,
                duration_ms=duration_ms,
                command=command_template,
                summary=f"Validation cancelled after checking {checked}/{len(scripts)} scripts",
                stderr_excerpt=stderr_excerpt,
            )
        if crashed is not None:
            return ValidationResult(
                validator="godot",
                status=ValidationStatus.ERROR,
                exit_code=None,
                duration_ms=duration_ms,
                command=command_template,
                summary=crashed,
                stderr_excerpt=stderr_excerpt,
            )
        if errors:
            return ValidationResult(
                validator="godot",
                status=ValidationStatus.FAIL,
                exit_code=1,
                duration_ms=duration_ms,
                command=command_template,
                summary=f"{len(errors)} script error(s) across {checked} checked file(s)",
                errors=errors,
                stderr_excerpt=stderr_excerpt,
            )
        return ValidationResult(
            validator="godot",
            status=ValidationStatus.PASS,
            exit_code=0,
            duration_ms=duration_ms,
            command=command_template,
            summary=f"All {checked} GDScript file(s) parsed cleanly" if checked else "No GDScript files to validate",
        )

    def cancel(self, run_id: str) -> bool:
        with self._lock:
            event = self._cancelled.get(run_id)
            popen = self._processes.get(run_id)
        if event is None:
            return False
        event.set()
        if popen is not None and popen.poll() is None:
            popen.terminate()
        return True


def _parse_error_message(rel_path: str, stderr: str) -> ValidationIssue:
    text = stderr.strip()
    match = _ERROR_LOCATION_RE.search(text)
    line = int(match.group(2)) if match else None
    message = text.splitlines()[0] if text else f"{rel_path}: Godot reported a parse error (no stderr captured)"
    return ValidationIssue(message=message, file=rel_path, line=line)
