"""OpenAI Codex CLI AI executor adapter.

Invocation contract verified against the actual official `codex` CLI
(`@openai/codex` on npm, `codex-cli 0.156.1` installed in this environment
and inspected directly via `--help`; nothing here is guessed):

- Detection: `codex --version` (no API call).
- Health/auth: `codex login status` -- real, documented subcommand,
  non-interactive, exits 0 when logged in and non-zero with "Not logged
  in" on stdout otherwise (observed directly). No API call.
- Execution: `codex exec` -- the CLI's own documented non-interactive
  mode (`codex exec --help`: "Run Codex non-interactively"). Uses
  `--sandbox workspace-write --approve-for-me` (auto-approves edits
  within the workspace instead of prompting -- there is no interactive
  terminal to answer prompts here, mirroring ClaudeCodeAdapter's
  `--permission-mode acceptEdits --permission-prompts none`) and
  `-o/--output-last-message <file>` to capture the agent's final
  response text, which is where the required ExecutorResult JSON lives
  (per the same RESULT_SCHEMA_INSTRUCTION every provider is given).
- Official auth mechanisms (from `codex login --help`, also verified
  directly): `codex login` (ChatGPT account OAuth, interactive browser
  flow) or `codex login --with-api-key` (reads OPENAI_API_KEY from
  stdin, non-interactive). Neither is performed by this adapter --
  authentication is the operator's responsibility, done once outside
  Impulsor Hub, exactly like ClaudeCodeAdapter never runs `claude login`
  itself.
"""
from __future__ import annotations

import subprocess
import tempfile
import threading
from pathlib import Path
from typing import Any

from app.adapters.ai.base import AIExecutorAdapter, ExecuteOutcome, ExecuteRequest
from app.adapters.ai.result_parsing import parse_executor_result
from app.core.permissions.policy import RESULT_SCHEMA_INSTRUCTION, build_task_envelope


class CodexAdapter(AIExecutorAdapter):
    adapter_key = "codex"

    def __init__(self) -> None:
        self._processes: dict[str, subprocess.Popen] = {}
        self._lock = threading.Lock()

    def detect(self) -> dict[str, Any]:
        try:
            proc = subprocess.run(
                ["codex", "--version"], capture_output=True, text=True, timeout=10, check=False
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
            status_proc = subprocess.run(
                ["codex", "login", "status"], capture_output=True, text=True, timeout=15, check=False
            )
            if status_proc.returncode == 0:
                auth_state = "authenticated"
            elif "not logged in" in (status_proc.stdout + status_proc.stderr).lower():
                auth_state = "not_authenticated"
        except (subprocess.TimeoutExpired, FileNotFoundError):
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

        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".txt", prefix="codex-last-message-", delete=False
        ) as tmp:
            output_path = Path(tmp.name)

        args = [
            "codex",
            "exec",
            prompt,
            "--sandbox",
            "workspace-write",
            "--approve-for-me",
            "--cd",
            str(request.workspace),
            "--output-last-message",
            str(output_path),
        ]

        try:
            popen = subprocess.Popen(
                args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True
            )
        except FileNotFoundError:
            output_path.unlink(missing_ok=True)
            return ExecuteOutcome(
                run_status="failed",
                exit_code=None,
                stdout="",
                stderr="",
                structured_result=None,
                failure_reason="codex executable not found",
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
            output_path.unlink(missing_ok=True)
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
            output_path.unlink(missing_ok=True)
            return ExecuteOutcome(
                run_status="cancelled",
                exit_code=popen.returncode,
                stdout=stdout or "",
                stderr=stderr or "",
                structured_result=None,
                failure_reason="Execution was cancelled",
            )

        try:
            last_message = output_path.read_text() if output_path.is_file() else ""
        finally:
            output_path.unlink(missing_ok=True)

        return self._interpret_cli_output(
            request=request,
            exit_code=popen.returncode,
            stdout=stdout or "",
            stderr=stderr or "",
            last_message=last_message,
        )

    def cancel(self, run_id: str) -> bool:
        with self._lock:
            popen = self._processes.get(run_id)
        if popen is None or popen.poll() is not None:
            return False
        popen.terminate()
        return True

    def _interpret_cli_output(
        self, *, request: ExecuteRequest, exit_code: int, stdout: str, stderr: str, last_message: str
    ) -> ExecuteOutcome:
        if exit_code != 0:
            return ExecuteOutcome(
                run_status="failed",
                exit_code=exit_code,
                stdout=stdout,
                stderr=stderr,
                structured_result=None,
                failure_reason=f"codex exec exited with code {exit_code}",
            )

        if not last_message.strip():
            return ExecuteOutcome(
                run_status="failed",
                exit_code=exit_code,
                stdout=stdout,
                stderr=stderr,
                structured_result=None,
                failure_reason="codex exec produced no final message (--output-last-message was empty)",
            )

        structured_result, malformed_raw = parse_executor_result(last_message, request.task_id)
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
