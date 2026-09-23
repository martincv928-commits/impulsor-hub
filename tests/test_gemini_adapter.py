"""GeminiAdapter (M2.8: AI provider independence). Mirrors
tests/test_claude_code_adapter.py's fake-subprocess discipline -- never
calls the real `gemini` CLI or consumes real API/quota usage."""
from __future__ import annotations

import json
import subprocess
from pathlib import Path

from app.adapters.ai.base import ExecuteRequest
from app.adapters.ai.gemini.adapter import GeminiAdapter


class _FakeCompleted:
    def __init__(self, returncode=0, stdout="", stderr=""):
        self.returncode = returncode
        self.stdout = stdout
        self.stderr = stderr


class _FakePopen:
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
            raise subprocess.TimeoutExpired(cmd="gemini", timeout=timeout)
        return self._stdout, self._stderr

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
    adapter = GeminiAdapter()
    fake = _FakePopen(stdout=json.dumps(_payload()), stderr="", returncode=0)
    monkeypatch.setattr(subprocess, "Popen", lambda *a, **k: fake)

    outcome = adapter.execute(
        ExecuteRequest(task_id="TASK-1", run_id="run-1", workspace=tmp_path, objective="x", timeout_seconds=30)
    )
    assert outcome.run_status == "completed"
    assert outcome.structured_result is not None
    assert outcome.structured_result.files_claimed_modified == ["a.py"]


def test_execute_extracts_json_from_prose_prefixed_message(monkeypatch, tmp_path: Path):
    adapter = GeminiAdapter()
    text = "Only a.py was touched.\n\n```json\n" + json.dumps(_payload()) + "\n```"
    fake = _FakePopen(stdout=text, stderr="", returncode=0)
    monkeypatch.setattr(subprocess, "Popen", lambda *a, **k: fake)

    outcome = adapter.execute(
        ExecuteRequest(task_id="TASK-1", run_id="run-1", workspace=tmp_path, objective="x", timeout_seconds=30)
    )
    assert outcome.structured_result is not None
    assert outcome.structured_result.files_claimed_modified == ["a.py"]


def test_execute_flags_malformed_output(monkeypatch, tmp_path: Path):
    adapter = GeminiAdapter()
    fake = _FakePopen(stdout="not json at all", stderr="", returncode=0)
    monkeypatch.setattr(subprocess, "Popen", lambda *a, **k: fake)

    outcome = adapter.execute(
        ExecuteRequest(task_id="TASK-1", run_id="run-1", workspace=tmp_path, objective="x", timeout_seconds=30)
    )
    assert outcome.run_status == "completed"
    assert outcome.structured_result is None
    assert outcome.malformed_result_raw == "not json at all"


def test_execute_treats_empty_output_as_failed(monkeypatch, tmp_path: Path):
    adapter = GeminiAdapter()
    fake = _FakePopen(stdout="", stderr="", returncode=0)
    monkeypatch.setattr(subprocess, "Popen", lambda *a, **k: fake)

    outcome = adapter.execute(
        ExecuteRequest(task_id="TASK-1", run_id="run-1", workspace=tmp_path, objective="x", timeout_seconds=30)
    )
    assert outcome.run_status == "failed"
    assert "no output" in outcome.failure_reason


def test_execute_handles_nonzero_exit(monkeypatch, tmp_path: Path):
    adapter = GeminiAdapter()
    fake = _FakePopen(stdout="", stderr="boom", returncode=1)
    monkeypatch.setattr(subprocess, "Popen", lambda *a, **k: fake)

    outcome = adapter.execute(
        ExecuteRequest(task_id="TASK-1", run_id="run-1", workspace=tmp_path, objective="x", timeout_seconds=30)
    )
    assert outcome.run_status == "failed"
    assert outcome.exit_code == 1


def test_execute_times_out_and_terminates_process(monkeypatch, tmp_path: Path):
    adapter = GeminiAdapter()
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

    adapter = GeminiAdapter()

    class _CancellableSlowPopen:
        def __init__(self):
            self.returncode = None
            self.terminated = False
            self._event = threading.Event()

        def communicate(self, timeout=None):
            signalled = self._event.wait(timeout=timeout)
            if not signalled:
                raise subprocess.TimeoutExpired(cmd="gemini", timeout=timeout)
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
    time.sleep(0.1)
    signalled = adapter.cancel("run-cancel")
    t.join(timeout=10)

    assert signalled is True
    assert fake.terminated is True
    assert outcomes[0].run_status == "cancelled"


def test_detect_reports_unavailable_when_binary_missing(monkeypatch):
    adapter = GeminiAdapter()

    def _raise(*a, **k):
        raise FileNotFoundError()

    monkeypatch.setattr(subprocess, "run", _raise)
    assert adapter.detect() == {"available": False, "version": None}


def test_health_check_authenticated_via_api_key_env_var(monkeypatch):
    adapter = GeminiAdapter()
    monkeypatch.setattr(
        subprocess, "run", lambda *a, **k: _FakeCompleted(returncode=0, stdout="0.60.0\n")
    )
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)
    health = adapter.health_check()
    assert health["authenticated"] == "authenticated"


def test_health_check_authenticated_via_oauth_cache_file(monkeypatch, tmp_path: Path):
    from app.adapters.ai.gemini import adapter as gemini_adapter_module

    adapter = GeminiAdapter()
    monkeypatch.setattr(
        subprocess, "run", lambda *a, **k: _FakeCompleted(returncode=0, stdout="0.60.0\n")
    )
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)
    cache_file = tmp_path / "oauth_creds.json"
    cache_file.write_text("{}")
    monkeypatch.setattr(gemini_adapter_module, "_OAUTH_CREDS_PATH", cache_file)
    health = adapter.health_check()
    assert health["authenticated"] == "authenticated"


def test_health_check_not_authenticated_without_any_credentials(monkeypatch, tmp_path: Path):
    from app.adapters.ai.gemini import adapter as gemini_adapter_module

    adapter = GeminiAdapter()
    monkeypatch.setattr(
        subprocess, "run", lambda *a, **k: _FakeCompleted(returncode=0, stdout="0.60.0\n")
    )
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)
    monkeypatch.setattr(gemini_adapter_module, "_OAUTH_CREDS_PATH", tmp_path / "does-not-exist.json")
    health = adapter.health_check()
    assert health["authenticated"] == "not_authenticated"


def test_health_check_reports_unavailable_when_not_installed(monkeypatch):
    adapter = GeminiAdapter()

    def _raise(*a, **k):
        raise FileNotFoundError()

    monkeypatch.setattr(subprocess, "run", _raise)
    health = adapter.health_check()
    assert health["available"] is False
    assert health["authenticated"] == "unknown"
