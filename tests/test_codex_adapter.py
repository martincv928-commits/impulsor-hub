"""CodexAdapter (M2.8: AI provider independence). Mirrors
tests/test_claude_code_adapter.py's fake-subprocess discipline -- never
calls the real `codex` CLI or consumes real API/subscription usage."""
from __future__ import annotations

import json
import subprocess
from pathlib import Path

from app.adapters.ai.base import ExecuteRequest
from app.adapters.ai.codex.adapter import CodexAdapter


class _FakeCompleted:
    def __init__(self, returncode=0, stdout="", stderr=""):
        self.returncode = returncode
        self.stdout = stdout
        self.stderr = stderr


class _FakePopen:
    """Stands in for subprocess.Popen. Writes `last_message` to the path
    passed via --output-last-message, exactly like the real `codex exec`
    CLI writes its own final response there."""

    def __init__(self, args, *, last_message: str, returncode: int, hangs: bool = False):
        self._args = list(args)
        self._last_message = last_message
        self.returncode = returncode
        self._hangs = hangs
        self._communicate_calls = 0
        self.terminated = False
        self.killed = False

    def _output_path(self) -> str:
        idx = self._args.index("--output-last-message")
        return self._args[idx + 1]

    def communicate(self, timeout=None):
        self._communicate_calls += 1
        if self._hangs and self._communicate_calls == 1:
            raise subprocess.TimeoutExpired(cmd="codex", timeout=timeout)
        if self._last_message is not None:
            Path(self._output_path()).write_text(self._last_message)
        return "", ""

    def terminate(self):
        self.terminated = True

    def kill(self):
        self.killed = True

    def poll(self):
        return self.returncode


def _payload(**overrides) -> dict:
    base = {
        "task_id": "TASK-1",
        "status": "completed",
        "summary": "did the thing",
        "files_claimed_modified": ["a.py"],
        "files_claimed_created": [],
        "files_claimed_deleted": [],
    }
    base.update(overrides)
    return base


def test_execute_parses_conforming_structured_result(monkeypatch, tmp_path: Path):
    adapter = CodexAdapter()
    message = json.dumps(_payload())
    monkeypatch.setattr(
        subprocess, "Popen", lambda args, **k: _FakePopen(args, last_message=message, returncode=0)
    )

    outcome = adapter.execute(
        ExecuteRequest(task_id="TASK-1", run_id="run-1", workspace=tmp_path, objective="x", timeout_seconds=30)
    )
    assert outcome.run_status == "completed"
    assert outcome.structured_result is not None
    assert outcome.structured_result.files_claimed_modified == ["a.py"]


def test_execute_extracts_json_from_prose_prefixed_message(monkeypatch, tmp_path: Path):
    adapter = CodexAdapter()
    message = "Only a.py was touched.\n\n```json\n" + json.dumps(_payload()) + "\n```"
    monkeypatch.setattr(
        subprocess, "Popen", lambda args, **k: _FakePopen(args, last_message=message, returncode=0)
    )

    outcome = adapter.execute(
        ExecuteRequest(task_id="TASK-1", run_id="run-1", workspace=tmp_path, objective="x", timeout_seconds=30)
    )
    assert outcome.structured_result is not None
    assert outcome.structured_result.files_claimed_modified == ["a.py"]


def test_execute_flags_malformed_final_message(monkeypatch, tmp_path: Path):
    adapter = CodexAdapter()
    monkeypatch.setattr(
        subprocess, "Popen", lambda args, **k: _FakePopen(args, last_message="not json at all", returncode=0)
    )

    outcome = adapter.execute(
        ExecuteRequest(task_id="TASK-1", run_id="run-1", workspace=tmp_path, objective="x", timeout_seconds=30)
    )
    assert outcome.run_status == "completed"
    assert outcome.structured_result is None
    assert outcome.malformed_result_raw == "not json at all"


def test_execute_treats_empty_last_message_as_failed(monkeypatch, tmp_path: Path):
    adapter = CodexAdapter()
    monkeypatch.setattr(subprocess, "Popen", lambda args, **k: _FakePopen(args, last_message="", returncode=0))

    outcome = adapter.execute(
        ExecuteRequest(task_id="TASK-1", run_id="run-1", workspace=tmp_path, objective="x", timeout_seconds=30)
    )
    assert outcome.run_status == "failed"
    assert "no final message" in outcome.failure_reason


def test_execute_handles_nonzero_exit(monkeypatch, tmp_path: Path):
    adapter = CodexAdapter()
    monkeypatch.setattr(subprocess, "Popen", lambda args, **k: _FakePopen(args, last_message="", returncode=1))

    outcome = adapter.execute(
        ExecuteRequest(task_id="TASK-1", run_id="run-1", workspace=tmp_path, objective="x", timeout_seconds=30)
    )
    assert outcome.run_status == "failed"
    assert outcome.exit_code == 1


def test_execute_times_out_and_terminates_process(monkeypatch, tmp_path: Path):
    adapter = CodexAdapter()
    monkeypatch.setattr(
        subprocess, "Popen", lambda args, **k: _FakePopen(args, last_message="", returncode=0, hangs=True)
    )

    outcome = adapter.execute(
        ExecuteRequest(task_id="TASK-1", run_id="run-1", workspace=tmp_path, objective="x", timeout_seconds=1)
    )
    assert outcome.run_status == "timed_out"


def test_temp_output_file_is_cleaned_up(monkeypatch, tmp_path: Path):
    adapter = CodexAdapter()
    captured = {}

    def fake_popen(args, **k):
        fp = _FakePopen(args, last_message=json.dumps(_payload()), returncode=0)
        captured["path"] = Path(fp._output_path())
        return fp

    monkeypatch.setattr(subprocess, "Popen", fake_popen)
    adapter.execute(
        ExecuteRequest(task_id="TASK-1", run_id="run-1", workspace=tmp_path, objective="x", timeout_seconds=30)
    )
    assert not captured["path"].exists()


def test_cancel_terminates_tracked_process(monkeypatch, tmp_path: Path):
    import threading
    import time

    adapter = CodexAdapter()

    class _CancellableSlowPopen:
        def __init__(self, args):
            self._args = list(args)
            self.returncode = None
            self.terminated = False
            self._event = threading.Event()

        def communicate(self, timeout=None):
            signalled = self._event.wait(timeout=timeout)
            if not signalled:
                raise subprocess.TimeoutExpired(cmd="codex", timeout=timeout)
            self.returncode = -15
            return "", ""

        def terminate(self):
            self.terminated = True
            self.returncode = -15
            self._event.set()

        def kill(self):
            self.terminated = True
            self.returncode = -9
            self._event.set()

        def poll(self):
            return None if not self.terminated else self.returncode

    fake_holder = {}

    def fake_popen(args, **k):
        fp = _CancellableSlowPopen(args)
        fake_holder["fp"] = fp
        return fp

    monkeypatch.setattr(subprocess, "Popen", fake_popen)

    outcomes = []

    def run():
        outcomes.append(
            adapter.execute(
                ExecuteRequest(
                    task_id="TASK-1", run_id="run-cancel", workspace=tmp_path, objective="x", timeout_seconds=5
                )
            )
        )

    t = threading.Thread(target=run)
    t.start()
    time.sleep(0.1)
    signalled = adapter.cancel("run-cancel")
    t.join(timeout=10)

    assert signalled is True
    assert fake_holder["fp"].terminated is True
    assert outcomes[0].run_status == "cancelled"


def test_detect_reports_unavailable_when_binary_missing(monkeypatch):
    adapter = CodexAdapter()

    def _raise(*a, **k):
        raise FileNotFoundError()

    monkeypatch.setattr(subprocess, "run", _raise)
    assert adapter.detect() == {"available": False, "version": None}


def test_health_check_reports_authenticated(monkeypatch):
    adapter = CodexAdapter()

    def fake_run(args, **k):
        if args[:2] == ["codex", "--version"]:
            return _FakeCompleted(returncode=0, stdout="codex-cli 0.156.1\n")
        if args[:3] == ["codex", "login", "status"]:
            return _FakeCompleted(returncode=0, stdout="Logged in\n")
        raise AssertionError(f"unexpected command: {args}")

    monkeypatch.setattr(subprocess, "run", fake_run)
    health = adapter.health_check()
    assert health["available"] is True
    assert health["authenticated"] == "authenticated"


def test_health_check_reports_not_authenticated(monkeypatch):
    adapter = CodexAdapter()

    def fake_run(args, **k):
        if args[:2] == ["codex", "--version"]:
            return _FakeCompleted(returncode=0, stdout="codex-cli 0.156.1\n")
        if args[:3] == ["codex", "login", "status"]:
            return _FakeCompleted(returncode=1, stdout="Not logged in\n")
        raise AssertionError(f"unexpected command: {args}")

    monkeypatch.setattr(subprocess, "run", fake_run)
    health = adapter.health_check()
    assert health["authenticated"] == "not_authenticated"


def test_health_check_reports_unavailable_when_not_installed(monkeypatch):
    adapter = CodexAdapter()

    def _raise(*a, **k):
        raise FileNotFoundError()

    monkeypatch.setattr(subprocess, "run", _raise)
    health = adapter.health_check()
    assert health["available"] is False
    assert health["authenticated"] == "unknown"
