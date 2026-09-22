"""GodotAdapter tests.

Organization (M2 HARDENING, per external audit): tests here are split into
two groups, distinguished by the `@pytest.mark.real_godot` marker:

- **Unmarked tests** are fully portable -- they use `monkeypatch` to
  simulate subprocess behavior (or don't touch a real Godot binary at
  all, e.g. resource-discovery ordering via a faked `shutil.which`, or
  `supports()`, which only stats a file). These always run and never
  require Godot to be installed.
- **`@pytest.mark.real_godot` tests** execute the actual Godot binary
  (detection, a real PASS, a real FAIL with a real parse error, real
  cancellation of a real subprocess, ...). `tests/conftest.py`
  auto-skips these (SKIPPED, never a false FAIL) when no real Godot
  executable is detected, so plain `pytest tests/` is portable to a
  machine without Godot. Run `pytest -m real_godot` to select only these
  and force them to actually execute (they'll individually skip pieces
  that still can't run, e.g. if pointed at a fake path on purpose).
"""
from __future__ import annotations

import os
import threading
import time
from pathlib import Path

import pytest

from app.adapters.validator.base import ValidationStatus
from app.adapters.validator.godot.adapter import GodotAdapter


@pytest.fixture
def godot_project(tmp_path: Path) -> Path:
    ws = tmp_path / "godot_project"
    ws.mkdir()
    (ws / "project.godot").write_text('config_version=4\n[application]\nconfig/name="Fixture"\n')
    (ws / "main.gd").write_text("extends Node\n\nfunc _ready():\n\tprint(1)\n")
    return ws


# 1. Godot detectado.
@pytest.mark.real_godot
def test_godot_detected():
    adapter = GodotAdapter()
    info = adapter.detect()
    assert info["available"] is True
    assert info["version"]


# 2. Godot no instalado.
def test_godot_not_installed(monkeypatch):
    monkeypatch.setenv("IMPULSOR_HUB_GODOT_PATH", "/definitely/not/a/real/binary")
    adapter = GodotAdapter()
    info = adapter.detect()
    assert info["available"] is False
    assert info["version"] is None


# 3. Health check.
@pytest.mark.real_godot
def test_health_check_reports_healthy_when_available():
    adapter = GodotAdapter()
    health = adapter.health_check()
    assert health["status"] == "healthy"
    assert health["available"] is True
    assert health["executable_path"]


def test_health_check_reports_unavailable_when_missing(monkeypatch):
    monkeypatch.setenv("IMPULSOR_HUB_GODOT_PATH", "/definitely/not/a/real/binary")
    adapter = GodotAdapter()
    health = adapter.health_check()
    assert health["status"] == "unavailable"
    assert health["available"] is False


# 4. Proyecto Godot detectado.
def test_project_godot_detected(godot_project: Path):
    adapter = GodotAdapter()
    assert adapter.supports(godot_project) is True


# 5. Proyecto no-Godot.
def test_non_godot_project_not_supported(tmp_path: Path):
    adapter = GodotAdapter()
    plain = tmp_path / "plain"
    plain.mkdir()
    (plain / "readme.txt").write_text("not a godot project\n")
    assert adapter.supports(plain) is False


# 6. Validation PASS.
@pytest.mark.real_godot
def test_validation_pass(godot_project: Path):
    adapter = GodotAdapter()
    result = adapter.validate(godot_project, run_id="r1", timeout_seconds=30)
    assert result.status == ValidationStatus.PASS
    assert result.exit_code == 0
    assert result.errors == []
    assert result.duration_ms >= 0


# 7. Validation FAIL.
@pytest.mark.real_godot
def test_validation_fail_reports_error_with_location(godot_project: Path):
    (godot_project / "broken.gd").write_text("extends Node\nfunc broken(:\n\tpass\n")
    adapter = GodotAdapter()
    result = adapter.validate(godot_project, run_id="r2", timeout_seconds=30)
    assert result.status == ValidationStatus.FAIL
    assert len(result.errors) == 1
    assert result.errors[0].file == "broken.gd"
    assert result.errors[0].line is not None
    assert "Parse Error" in result.errors[0].message


# 8. Validator timeout.
@pytest.mark.real_godot
def test_validator_timeout(godot_project: Path, monkeypatch):
    import subprocess

    real_popen = subprocess.Popen

    class _HangingPopen:
        def __init__(self, *a, **k):
            self.returncode = None
            self.killed = False

        def communicate(self, timeout=None):
            if self.killed:
                return "", ""
            raise subprocess.TimeoutExpired(cmd="godot", timeout=timeout)

        def kill(self):
            self.killed = True
            self.returncode = -9

        def poll(self):
            return self.returncode

    def _fake_popen(args, *a, **k):
        # Only intercept the per-file --check-only call, not detect()'s
        # own `--version` probe (which subprocess.run also routes through
        # subprocess.Popen).
        if "--check-only" in args:
            return _HangingPopen()
        return real_popen(args, *a, **k)

    monkeypatch.setattr(subprocess, "Popen", _fake_popen)
    adapter = GodotAdapter()
    result = adapter.validate(godot_project, run_id="r3", timeout_seconds=1)
    assert result.status == ValidationStatus.TIMEOUT


# 9. Validator process error.
@pytest.mark.real_godot
def test_validator_process_error_when_launch_fails(godot_project: Path, monkeypatch):
    import subprocess

    real_popen = subprocess.Popen

    def _fake_popen(args, *a, **k):
        if "--check-only" in args:
            raise OSError("exec format error")
        return real_popen(args, *a, **k)

    monkeypatch.setattr(subprocess, "Popen", _fake_popen)
    adapter = GodotAdapter()
    result = adapter.validate(godot_project, run_id="r4", timeout_seconds=30)
    assert result.status == ValidationStatus.ERROR
    assert "Failed to launch" in result.summary


def test_validator_error_when_binary_missing(godot_project: Path, monkeypatch):
    monkeypatch.setenv("IMPULSOR_HUB_GODOT_PATH", "/definitely/not/a/real/binary")
    adapter = GodotAdapter()
    result = adapter.validate(godot_project, run_id="r5", timeout_seconds=30)
    assert result.status == ValidationStatus.ERROR
    assert "not found" in result.summary


def test_validator_error_for_non_godot_project(tmp_path: Path):
    adapter = GodotAdapter()
    plain = tmp_path / "plain"
    plain.mkdir()
    result = adapter.validate(plain, run_id="r6", timeout_seconds=30)
    assert result.status == ValidationStatus.ERROR


# 10. Cancelación.
@pytest.mark.real_godot
def test_cancel_stops_an_in_flight_validation(tmp_path: Path):
    ws = tmp_path / "many_scripts"
    ws.mkdir()
    (ws / "project.godot").write_text('config_version=4\n[application]\nconfig/name="Fixture"\n')
    # Several scripts so there's a real window to cancel between files.
    for i in range(20):
        (ws / f"script_{i}.gd").write_text(f"extends Node\nfunc _ready():\n\tprint({i})\n")

    adapter = GodotAdapter()
    results = {}

    def run():
        results["result"] = adapter.validate(ws, run_id="cancel-me", timeout_seconds=30)

    t = threading.Thread(target=run)
    t.start()
    # Poll for validate() to have registered the run rather than a fixed
    # sleep: a heavier engine build (e.g. a full Godot 4 editor binary vs.
    # the lightweight godot3-server) can take meaningfully longer just to
    # answer `--version` inside detect(), which would make a short fixed
    # sleep fire before cancellation is even possible to register.
    for _ in range(300):  # up to ~30s
        if "cancel-me" in adapter._cancelled:
            break
        time.sleep(0.1)
    signalled = adapter.cancel("cancel-me")
    t.join(timeout=30)

    assert signalled is True
    assert results["result"].status == ValidationStatus.ERROR
    assert "cancel" in results["result"].summary.lower()


@pytest.mark.real_godot
def test_no_gd_scripts_is_a_trivial_pass(tmp_path: Path):
    ws = tmp_path / "empty_godot"
    ws.mkdir()
    (ws / "project.godot").write_text('config_version=4\n[application]\nconfig/name="Empty"\n')
    adapter = GodotAdapter()
    result = adapter.validate(ws, run_id="r7", timeout_seconds=30)
    assert result.status == ValidationStatus.PASS


# --- Resource discovery: Godot 3 + Godot 4 simultaneously installed -----
# Fully portable: simulates PATH contents via a faked shutil.which, so
# these never need a real binary of either version.


def test_resource_discovery_prefers_godot4_name_when_both_present(monkeypatch):
    from app.adapters.validator.godot import adapter as godot_adapter_module

    # Isolation: don't let an ambient IMPULSOR_HUB_GODOT_PATH (e.g. set by
    # whoever is running the suite to force a specific Godot version) leak
    # into this test -- it must reflect a clean PATH-search scenario.
    monkeypatch.delenv("IMPULSOR_HUB_GODOT_PATH", raising=False)
    fake_paths = {"godot4": "/usr/local/bin/godot4", "godot3-server": "/usr/bin/godot3-server"}
    monkeypatch.setattr(godot_adapter_module.shutil, "which", lambda name: fake_paths.get(name))

    resolved = godot_adapter_module._resolve_executable()

    assert resolved == "/usr/local/bin/godot4"


def test_resource_discovery_falls_back_to_godot3_when_godot4_name_absent(monkeypatch):
    from app.adapters.validator.godot import adapter as godot_adapter_module

    monkeypatch.delenv("IMPULSOR_HUB_GODOT_PATH", raising=False)
    fake_paths = {"godot3-server": "/usr/bin/godot3-server"}
    monkeypatch.setattr(godot_adapter_module.shutil, "which", lambda name: fake_paths.get(name))

    resolved = godot_adapter_module._resolve_executable()

    assert resolved == "/usr/bin/godot3-server"


def test_manual_override_wins_over_path_discovery_even_with_both_installed(monkeypatch):
    from app.adapters.validator.godot import adapter as godot_adapter_module

    fake_paths = {"godot4": "/usr/local/bin/godot4", "godot3-server": "/usr/bin/godot3-server"}
    monkeypatch.setattr(godot_adapter_module.shutil, "which", lambda name: fake_paths.get(name))
    monkeypatch.setenv("IMPULSOR_HUB_GODOT_PATH", "godot3-server")

    resolved = godot_adapter_module._resolve_executable()

    # Manual override picks Godot 3 even though godot4 would otherwise win.
    assert resolved == "/usr/bin/godot3-server"


def test_major_version_parses_godot3_and_godot4_version_strings():
    from app.adapters.validator.godot.adapter import _major_version

    assert _major_version("3.5.2.stable.custom_build") == 3
    assert _major_version("4.2.2.stable.official.15073afe3") == 4
    assert _major_version("not a version") is None
