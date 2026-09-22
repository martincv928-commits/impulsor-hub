from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest

from app.adapters.ai.base import ExecuteRequest
from app.adapters.ai.claude_code.adapter import ClaudeCodeAdapter


class _FakeCompleted:
    def __init__(self, returncode=0, stdout="", stderr=""):
        self.returncode = returncode
        self.stdout = stdout
        self.stderr = stderr


class _FakePopen:
    """Stands in for subprocess.Popen: communicate() returns canned output,
    or raises TimeoutExpired on the first call if `hangs` is set."""

    def __init__(self, stdout: str, stderr: str, returncode: int, hangs: bool = False):
        self._stdout = stdout
        self._stderr = stderr
        self.returncode = returncode
        self._hangs = hangs
        self._communicate_calls = 0
        self.terminated = False
        self.killed = False

    def communicate(self, timeout=None):
        self._communicate_calls += 1
        if self._hangs and self._communicate_calls == 1:
            raise subprocess.TimeoutExpired(cmd="claude", timeout=timeout)
        return self._stdout, self._stderr

    def terminate(self):
        self.terminated = True

    def kill(self):
        self.killed = True


def _envelope(result_obj: dict, *, is_error=False, subtype="success") -> str:
    return json.dumps(
        {
            "type": "result",
            "subtype": subtype,
            "is_error": is_error,
            "result": json.dumps(result_obj),
            "permission_denials": [],
        }
    )


def test_execute_parses_conforming_structured_result(monkeypatch, tmp_path: Path):
    adapter = ClaudeCodeAdapter()
    payload = {
        "task_id": "TASK-1",
        "status": "completed",
        "summary": "did the thing",
        "files_claimed_modified": ["a.py"],
        "files_claimed_created": [],
        "files_claimed_deleted": [],
    }
    fake = _FakePopen(stdout=_envelope(payload), stderr="", returncode=0)
    monkeypatch.setattr(subprocess, "Popen", lambda *a, **k: fake)

    outcome = adapter.execute(
        ExecuteRequest(task_id="TASK-1", run_id="run-1", workspace=tmp_path, objective="x", timeout_seconds=30)
    )
    assert outcome.run_status == "completed"
    assert outcome.structured_result is not None
    assert outcome.structured_result.status == "completed"
    assert outcome.structured_result.files_claimed_modified == ["a.py"]


def test_execute_flags_malformed_result_text(monkeypatch, tmp_path: Path):
    adapter = ClaudeCodeAdapter()
    envelope = json.dumps(
        {"type": "result", "subtype": "success", "is_error": False, "result": "not json at all", "permission_denials": []}
    )
    fake = _FakePopen(stdout=envelope, stderr="", returncode=0)
    monkeypatch.setattr(subprocess, "Popen", lambda *a, **k: fake)

    outcome = adapter.execute(
        ExecuteRequest(task_id="TASK-1", run_id="run-1", workspace=tmp_path, objective="x", timeout_seconds=30)
    )
    assert outcome.run_status == "completed"
    assert outcome.structured_result is None
    assert outcome.malformed_result_raw == "not json at all"
    assert any("did not conform" in w for w in outcome.warnings)


def test_execute_treats_cli_level_error_as_failed(monkeypatch, tmp_path: Path):
    adapter = ClaudeCodeAdapter()
    envelope = _envelope({}, is_error=True, subtype="error_max_turns")
    fake = _FakePopen(stdout=envelope, stderr="", returncode=0)
    monkeypatch.setattr(subprocess, "Popen", lambda *a, **k: fake)

    outcome = adapter.execute(
        ExecuteRequest(task_id="TASK-1", run_id="run-1", workspace=tmp_path, objective="x", timeout_seconds=30)
    )
    assert outcome.run_status == "failed"
    assert outcome.structured_result is None


def test_execute_handles_non_json_cli_output(monkeypatch, tmp_path: Path):
    adapter = ClaudeCodeAdapter()
    fake = _FakePopen(stdout="not valid json {{{", stderr="", returncode=0)
    monkeypatch.setattr(subprocess, "Popen", lambda *a, **k: fake)

    outcome = adapter.execute(
        ExecuteRequest(task_id="TASK-1", run_id="run-1", workspace=tmp_path, objective="x", timeout_seconds=30)
    )
    assert outcome.run_status == "failed"
    assert outcome.malformed_result_raw is not None


def test_execute_handles_nonzero_exit(monkeypatch, tmp_path: Path):
    adapter = ClaudeCodeAdapter()
    fake = _FakePopen(stdout="", stderr="boom", returncode=1)
    monkeypatch.setattr(subprocess, "Popen", lambda *a, **k: fake)

    outcome = adapter.execute(
        ExecuteRequest(task_id="TASK-1", run_id="run-1", workspace=tmp_path, objective="x", timeout_seconds=30)
    )
    assert outcome.run_status == "failed"
    assert outcome.exit_code == 1


def test_execute_times_out_and_terminates_process(monkeypatch, tmp_path: Path):
    adapter = ClaudeCodeAdapter()
    fake = _FakePopen(stdout="", stderr="", returncode=0, hangs=True)
    monkeypatch.setattr(subprocess, "Popen", lambda *a, **k: fake)

    outcome = adapter.execute(
        ExecuteRequest(task_id="TASK-1", run_id="run-1", workspace=tmp_path, objective="x", timeout_seconds=1)
    )
    assert outcome.run_status == "timed_out"
    assert fake.terminated is True


def test_cancel_terminates_tracked_process(monkeypatch, tmp_path: Path):
    import threading
    import time

    adapter = ClaudeCodeAdapter()

    class _CancellableSlowPopen:
        """Simulates a genuinely in-flight subprocess: communicate() blocks
        until either the real timeout elapses or terminate() is called,
        exactly like a real Popen does when signalled mid-wait."""

        def __init__(self):
            self.returncode = None
            self.terminated = False
            self._event = threading.Event()

        def communicate(self, timeout=None):
            signalled = self._event.wait(timeout=timeout)
            if not signalled:
                raise subprocess.TimeoutExpired(cmd="claude", timeout=timeout)
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

    fake = _CancellableSlowPopen()
    monkeypatch.setattr(subprocess, "Popen", lambda *a, **k: fake)

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
    time.sleep(0.1)  # let execute() reach communicate() and register the process
    signalled = adapter.cancel("run-cancel")
    t.join(timeout=10)

    assert signalled is True
    assert fake.terminated is True
    assert outcomes[0].run_status == "cancelled"


def test_detect_reports_unavailable_when_binary_missing(monkeypatch):
    adapter = ClaudeCodeAdapter()

    def _raise(*a, **k):
        raise FileNotFoundError()

    monkeypatch.setattr(subprocess, "run", _raise)
    info = adapter.detect()
    assert info == {"available": False, "version": None}
