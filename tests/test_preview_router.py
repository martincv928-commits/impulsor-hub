"""PROBAR RESULTADO -- Godot preview launch/status/stop (M2.6 SPEC section L).
Uses a fake Popen and a fake GodotAdapter.detect() so these tests never
need a real Godot binary or a display."""
from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.api import main as api_main
from app.api.routers import preview as preview_router
from app.database.db import get_connection
from app.projects import service as projects_service
from app.tasks import service as tasks_service


class _FakeProc:
    def __init__(self, pid: int = 4242):
        self.pid = pid
        self._alive = True
        self.returncode = None

    def poll(self):
        return None if self._alive else self.returncode

    def terminate(self):
        self._alive = False
        self.returncode = 0

    def wait(self, timeout=None):
        return self.returncode

    def kill(self):
        self._alive = False
        self.returncode = -9


@pytest.fixture(autouse=True)
def _clear_preview_state():
    preview_router._processes.clear()
    yield
    preview_router._processes.clear()


@pytest.fixture
def client(monkeypatch, tmp_path: Path):
    monkeypatch.setenv("IMPULSOR_HUB_DB_PATH", str(tmp_path / "preview_test.db"))
    monkeypatch.setenv("IMPULSOR_HUB_AGENT_TOKEN", "tok")
    with TestClient(api_main.app) as c:
        c.headers["Authorization"] = "Bearer tok"
        yield c


def _make_run(godot_fixture_repo: Path, project_type: str = "godot") -> str:
    with get_connection() as conn:
        project = projects_service.add_project(conn, root_path=str(godot_fixture_repo))
        if project.project_type != project_type:
            conn.execute("UPDATE project SET project_type = ? WHERE id = ?", (project_type, project.id))
        task = tasks_service.create_task(conn, project_id=project.id, objective="x")
        run_id = "run-preview-test"
        conn.execute(
            """INSERT INTO task_run (id, task_id, status, timeout_seconds, disposition)
               VALUES (?, ?, 'COMPLETED', 600, 'pending')""",
            (run_id, task.id),
        )
    return run_id


def test_preview_start_launches_process_and_status_reports_running(client, monkeypatch, godot_fixture_repo):
    run_id = _make_run(godot_fixture_repo)
    monkeypatch.setattr(
        preview_router.GodotAdapter, "detect", lambda self: {"available": True, "executable_path": "godot4"}
    )
    fake = _FakeProc()
    monkeypatch.setattr(preview_router.subprocess, "Popen", lambda *a, **k: fake)

    resp = client.post(f"/api/task-runs/{run_id}/preview/start")
    assert resp.status_code == 200
    assert resp.json() == {"status": "running", "pid": fake.pid}

    resp = client.get(f"/api/task-runs/{run_id}/preview/status")
    assert resp.json() == {"status": "running", "pid": fake.pid}


def test_preview_stop_terminates_and_status_then_reports_stopped(client, monkeypatch, godot_fixture_repo):
    run_id = _make_run(godot_fixture_repo)
    monkeypatch.setattr(
        preview_router.GodotAdapter, "detect", lambda self: {"available": True, "executable_path": "godot4"}
    )
    fake = _FakeProc()
    monkeypatch.setattr(preview_router.subprocess, "Popen", lambda *a, **k: fake)
    client.post(f"/api/task-runs/{run_id}/preview/start")

    resp = client.post(f"/api/task-runs/{run_id}/preview/stop")
    assert resp.json() == {"status": "stopped"}

    resp = client.get(f"/api/task-runs/{run_id}/preview/status")
    assert resp.json()["status"] in ("not_started", "stopped")


def test_preview_status_before_start_is_not_started(client, godot_fixture_repo):
    run_id = _make_run(godot_fixture_repo)
    resp = client.get(f"/api/task-runs/{run_id}/preview/status")
    assert resp.json() == {"status": "not_started"}


def test_preview_unavailable_when_godot_not_detected(client, monkeypatch, godot_fixture_repo):
    run_id = _make_run(godot_fixture_repo)
    monkeypatch.setattr(
        preview_router.GodotAdapter, "detect", lambda self: {"available": False, "executable_path": None}
    )
    resp = client.post(f"/api/task-runs/{run_id}/preview/start")
    assert resp.status_code == 409


def test_preview_rejected_for_non_godot_project(client, fixture_repo):
    run_id = _make_run(fixture_repo, project_type="generic")
    resp = client.post(f"/api/task-runs/{run_id}/preview/start")
    assert resp.status_code == 409
    assert "Godot" in resp.json()["detail"]


def test_preview_404_for_unknown_run(client):
    resp = client.post("/api/task-runs/does-not-exist/preview/start")
    assert resp.status_code == 404


def test_preview_requires_token(client, godot_fixture_repo):
    run_id = _make_run(godot_fixture_repo)
    del client.headers["Authorization"]
    resp = client.post(f"/api/task-runs/{run_id}/preview/start")
    assert resp.status_code == 401


# --- PROBAR ESTADO ACTUAL: project-scoped preview (M2.6.1) --------------


def _make_project(godot_fixture_repo: Path, project_type: str = "godot") -> str:
    with get_connection() as conn:
        project = projects_service.add_project(conn, root_path=str(godot_fixture_repo))
        if project.project_type != project_type:
            conn.execute("UPDATE project SET project_type = ? WHERE id = ?", (project_type, project.id))
    return project.id


def test_project_preview_start_and_status(client, monkeypatch, godot_fixture_repo):
    project_id = _make_project(godot_fixture_repo)
    monkeypatch.setattr(
        preview_router.GodotAdapter, "detect", lambda self: {"available": True, "executable_path": "godot4"}
    )
    fake = _FakeProc()
    monkeypatch.setattr(preview_router.subprocess, "Popen", lambda *a, **k: fake)

    resp = client.post(f"/api/projects/{project_id}/preview/start")
    assert resp.json() == {"status": "running", "pid": fake.pid}
    resp = client.get(f"/api/projects/{project_id}/preview/status")
    assert resp.json() == {"status": "running", "pid": fake.pid}

    resp = client.post(f"/api/projects/{project_id}/preview/stop")
    assert resp.json() == {"status": "stopped"}


def test_project_preview_rejected_for_non_godot_project(client, fixture_repo):
    project_id = _make_project(fixture_repo, project_type="generic")
    resp = client.post(f"/api/projects/{project_id}/preview/start")
    assert resp.status_code == 409


def test_project_and_run_preview_keys_never_collide(client):
    """A project id and a task-run id could be the exact same string in a
    pathological case; the two scopes must never share state."""
    same_id = "shared-id-value"
    preview_router._processes[f"project:{same_id}"] = _FakeProc(pid=1)

    assert client.get(f"/api/task-runs/{same_id}/preview/status").json()["status"] == "not_started"
    assert client.get(f"/api/projects/{same_id}/preview/status").json() == {"status": "running", "pid": 1}


def test_stop_all_kills_every_tracked_preview_but_nothing_else(monkeypatch):
    preview_router._processes.clear()
    a, b = _FakeProc(pid=1), _FakeProc(pid=2)
    preview_router._processes["run:a"] = a
    preview_router._processes["project:b"] = b

    preview_router.stop_all()

    assert a.poll() is not None
    assert b.poll() is not None
    assert preview_router._processes == {}
