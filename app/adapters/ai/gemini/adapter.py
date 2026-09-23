"""Google Gemini CLI AI executor adapter.

Invocation contract verified against the actual official `gemini` CLI
(`@google/gemini-cli` on npm, `0.60.0` installed in this environment and
inspected directly via `--help` and its README; nothing here is guessed):

- Detection: `gemini --version` (no API call).
- Health/auth: zero-API-call, zero-prompt check -- either `GEMINI_API_KEY`
  or `GOOGLE_API_KEY` is set (the CLI's own documented API-key auth path),
  or `~/.gemini/oauth_creds.json` exists (the real cached-credentials path
  for its "Sign in with Google" OAuth flow, confirmed by grepping the
  installed bundle for that literal filename -- not guessed). Actually
  invoking `gemini -p ...` to "check" auth would risk triggering a real
  request or an interactive login prompt, so this adapter never does that
  just to report status (observed directly: with no auth configured, a
  headless `gemini -p` call prints "Please set an Auth method..." and
  exits cleanly with no hang and no API call -- but that string match is
  fragile/undocumented, so health_check relies on the documented
  env-var/cache-file signals instead).
- Execution: `gemini -p <prompt> -o text --approval-mode auto_edit`, run
  with `cwd=workspace` (the CLI has no explicit --cd/--directory flag;
  like ClaudeCodeAdapter it is scoped by process cwd). `--approval-mode
  auto_edit` auto-approves file edits without an interactive prompt --
  there is no terminal to answer one here.
- Official auth mechanisms (from the installed CLI's own README, verified
  directly): "Sign in with Google" (interactive OAuth, a personal Google
  account, free tier) or `GEMINI_API_KEY`/`GOOGLE_API_KEY` (Google AI
  Studio, has a free tier). Neither is performed by this adapter --
  exactly like ClaudeCodeAdapter never runs `claude login` itself.
"""
from __future__ import annotations

import os
import subprocess
import threading
from pathlib import Path
from typing import Any

from app.adapters.ai.base import AIExecutorAdapter, ExecuteOutcome, ExecuteRequest
from app.adapters.ai.result_parsing import parse_executor_result
from app.core.permissions.policy import RESULT_SCHEMA_INSTRUCTION, build_task_envelope

_OAUTH_CREDS_PATH = Path.home() / ".gemini" / "oauth_creds.json"


class GeminiAdapter(AIExecutorAdapter):
    adapter_key = "gemini"

    def __init__(self) -> None:
        self._processes: dict[str, subprocess.Popen] = {}
        self._lock = threading.Lock()

    def detect(self) -> dict[str, Any]:
        try:
            proc = subprocess.run(
                ["gemini", "--version"], capture_output=True, text=True, timeout=10, check=False
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
        has_api_key = bool(os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY"))
        has_oauth_cache = _OAUTH_CREDS_PATH.is_file()
        auth_state = "authenticated" if (has_api_key or has_oauth_cache) else "not_authenticated"
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

        args = ["gemini", "-p", prompt, "-o", "text", "--approval-mode", "auto_edit"]

        try:
            popen = subprocess.Popen(
                args,
                cwd=str(request.workspace),
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                stdin=subprocess.DEVNULL,
                text=True,
            )
        except FileNotFoundError:
            return ExecuteOutcome(
                run_status="failed",
                exit_code=None,
                stdout="",
                stderr="",
                structured_result=None,
                failure_reason="gemini executable not found",
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
                failure_reason=f"gemini CLI exited with code {exit_code}",
            )

        if not stdout.strip():
            return ExecuteOutcome(
                run_status="failed",
                exit_code=exit_code,
                stdout=stdout,
                stderr=stderr,
                structured_result=None,
                failure_reason="gemini CLI produced no output",
            )

        structured_result, malformed_raw = parse_executor_result(stdout, request.task_id)
        warnings: list[str] = []
        if structured_result is None:
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
