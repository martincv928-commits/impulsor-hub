"""Claude Code CLI AI executor adapter (SPEC sections 7, 12-13; CLAUDE_M1 Checkpoint D).

Invocation contract (verified against the actual `claude` CLI available in
this environment, `claude --help` / `claude doctor` / `claude auth status`):

- Detection: `claude --version` (no API call).
- Health/auth: `claude doctor` + `claude auth status --json` (no API call,
  so health checks never "consume unnecessary work" per CLAUDE_M1
  Checkpoint B).
- Execution: `claude -p <prompt> --output-format json --permission-mode
  acceptEdits --permission-prompts none --disallowedTools <git history
  subcommands> --strict-mcp-config`, run with `cwd=workspace` and never via
  a shell (argument array, no string interpolation into a shell command —
  SPEC line 189).
- `--disallowedTools` is a real, CLI-enforced guardrail (not just prompt
  text) against `git commit/reset/rebase/stash/checkout/switch/branch/
  push/clean/filter-branch/reflog`, backing the envelope's RULES section
  with something Hub does not have to trust the model to obey.

Known limitation (documented again in M1_REPORT.md): this does not run the
CLI inside an OS-level sandbox/jail, so the *workspace-boundary* rule
(as opposed to the git-history rule) is enforced by prompt instruction +
default tool cwd-scoping + Hub-side post-hoc Git verification, not by a
hard OS boundary. SPEC 10 asks for boundary enforcement "where technically
possible" within M1; full sandboxing is flagged as future work.
"""
from __future__ import annotations

import json
import re
import subprocess
import threading
from pathlib import Path
from typing import Any, Optional

from pydantic import ValidationError

from app.adapters.ai.base import AIExecutorAdapter, ExecuteOutcome, ExecuteRequest
from app.core.permissions.policy import RESULT_SCHEMA_INSTRUCTION, build_task_envelope
from app.database.models import ExecutorResult

_DISALLOWED_GIT_TOOLS = [
    "Bash(git commit *)",
    "Bash(git reset *)",
    "Bash(git rebase *)",
    "Bash(git stash *)",
    "Bash(git checkout *)",
    "Bash(git switch *)",
    "Bash(git branch *)",
    "Bash(git push *)",
    "Bash(git clean *)",
    "Bash(git filter-branch *)",
    "Bash(git reflog *)",
]

class ClaudeCodeAdapter(AIExecutorAdapter):
    adapter_key = "claude_code"

    def __init__(self) -> None:
        self._processes: dict[str, subprocess.Popen] = {}
        self._lock = threading.Lock()

    def detect(self) -> dict[str, Any]:
        try:
            proc = subprocess.run(
                ["claude", "--version"], capture_output=True, text=True, timeout=10, check=False
            )
        except FileNotFoundError:
            return {"available": False, "version": None}
        if proc.returncode != 0:
            return {"available": False, "version": None}
        return {"available": True, "version": proc.stdout.strip()}

    def health_check(self) -> dict[str, Any]:
        info = self.detect()
        if not info["available"]:
            return {
                "status": "unavailable",
                "available": False,
                "version": None,
                "authenticated": "unknown",
            }
        auth_state = "unknown"
        try:
            auth_proc = subprocess.run(
                ["claude", "auth", "status", "--json"],
                capture_output=True,
                text=True,
                timeout=15,
                check=False,
            )
            if auth_proc.returncode == 0:
                payload = json.loads(auth_proc.stdout)
                auth_state = "authenticated" if payload.get("loggedIn") else "not_authenticated"
        except (subprocess.TimeoutExpired, json.JSONDecodeError, FileNotFoundError):
            auth_state = "unknown"
        return {
            "status": "healthy" if auth_state == "authenticated" else "degraded",
            "available": True,
            "version": info["version"],
            "authenticated": auth_state,
        }

    def capabilities(self) -> list[str]:
        return ["code_edit", "shell_exec", "structured_result"]

    def execute(self, request: ExecuteRequest) -> ExecuteOutcome:
        prompt = request.full_prompt_override or (
            build_task_envelope(
                task_id=request.task_id, workspace=request.workspace, objective=request.objective
            )
            + "\n"
            + RESULT_SCHEMA_INSTRUCTION
        )

        args = [
            "claude",
            "-p",
            prompt,
            "--output-format",
            "json",
            "--permission-mode",
            "acceptEdits",
            "--permission-prompts",
            "none",
            "--strict-mcp-config",
            "--disallowedTools",
            *_DISALLOWED_GIT_TOOLS,
        ]

        try:
            popen = subprocess.Popen(
                args,
                cwd=str(request.workspace),
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )
        except FileNotFoundError:
            return ExecuteOutcome(
                run_status="failed",
                exit_code=None,
                stdout="",
                stderr="",
                structured_result=None,
                failure_reason="claude executable not found",
            )

        with self._lock:
            self._processes[request.run_id] = popen

        try:
            stdout, stderr = popen.communicate(timeout=request.timeout_seconds)
        except subprocess.TimeoutExpired:
            popen.terminate()
            try:
                stdout, stderr = popen.communicate(timeout=10)
            except subprocess.TimeoutExpired:
                popen.kill()
                stdout, stderr = popen.communicate()
            return ExecuteOutcome(
                run_status="timed_out",
                exit_code=popen.returncode,
                stdout=stdout or "",
                stderr=stderr or "",
                structured_result=None,
                failure_reason=f"Execution exceeded timeout of {request.timeout_seconds}s",
            )
        finally:
            with self._lock:
                self._processes.pop(request.run_id, None)

        if popen.returncode == -15 or popen.returncode == -9:
            return ExecuteOutcome(
                run_status="cancelled",
                exit_code=popen.returncode,
                stdout=stdout or "",
                stderr=stderr or "",
                structured_result=None,
                failure_reason="Execution was cancelled",
            )

        return self._interpret_cli_output(
            request=request, exit_code=popen.returncode, stdout=stdout or "", stderr=stderr or ""
        )

    def cancel(self, run_id: str) -> bool:
        with self._lock:
            popen = self._processes.get(run_id)
        if popen is None or popen.poll() is not None:
            return False
        popen.terminate()
        return True

    def _interpret_cli_output(
        self, *, request: ExecuteRequest, exit_code: int, stdout: str, stderr: str
    ) -> ExecuteOutcome:
        if exit_code != 0:
            return ExecuteOutcome(
                run_status="failed",
                exit_code=exit_code,
                stdout=stdout,
                stderr=stderr,
                structured_result=None,
                failure_reason=f"claude CLI exited with code {exit_code}",
            )

        try:
            envelope = json.loads(stdout)
        except json.JSONDecodeError as exc:
            return ExecuteOutcome(
                run_status="failed",
                exit_code=exit_code,
                stdout=stdout,
                stderr=stderr,
                structured_result=None,
                malformed_result_raw=stdout,
                failure_reason=f"claude CLI did not return valid JSON: {exc}",
            )

        warnings: list[str] = []
        if envelope.get("is_error"):
            failure_reason = f"claude CLI reported error subtype={envelope.get('subtype')}"
            return ExecuteOutcome(
                run_status="failed",
                exit_code=exit_code,
                stdout=stdout,
                stderr=stderr,
                structured_result=None,
                failure_reason=failure_reason,
            )

        denials = envelope.get("permission_denials") or []
        if denials:
            warnings.append(f"{len(denials)} tool call(s) were denied by permission policy")

        result_text = envelope.get("result")
        structured_result: Optional[ExecutorResult] = None
        malformed_raw: Optional[str] = None
        if isinstance(result_text, str):
            structured_result, malformed_raw = _parse_executor_result(result_text, request.task_id)
        if structured_result is None and malformed_raw is not None:
            warnings.append("Executor result did not conform to the required JSON schema")

        return ExecuteOutcome(
            run_status="completed",
            exit_code=exit_code,
            stdout=stdout,
            stderr=stderr,
            structured_result=structured_result,
            malformed_result_raw=malformed_raw,
            warnings=warnings,
        )


def _parse_executor_result(
    result_text: str, expected_task_id: str
) -> tuple[Optional[ExecutorResult], Optional[str]]:
    """Try progressively looser extraction strategies. Whichever candidate
    text is used, it is still fully validated against ExecutorResult before
    being trusted — loosening *extraction* never loosens *verification*, so
    a genuinely malformed/missing result still correctly falls through to
    `(None, raw_text)` (observed for real against the live `claude` CLI: it
    sometimes prefixes the required JSON with a sentence of prose despite
    the envelope instruction not to)."""
    candidates = [result_text.strip()]

    fence_match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", result_text, re.DOTALL)
    if fence_match:
        candidates.append(fence_match.group(1))

    first_brace = result_text.find("{")
    last_brace = result_text.rfind("}")
    if first_brace != -1 and last_brace > first_brace:
        candidates.append(result_text[first_brace : last_brace + 1])

    for candidate in candidates:
        try:
            raw = json.loads(candidate)
            parsed = ExecutorResult.model_validate(raw)
        except (json.JSONDecodeError, ValidationError):
            continue
        return parsed, None
    return None, result_text
