from __future__ import annotations

import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.api import main as api_main
from app.api.routers import projects as projects_router
from app.api.routers import resources as resources_router
from app.api.routers import tasks as tasks_router
from tests.fakes import FakeAIExecutorAdapter, FakeRouter


@pytest.fixture
def client(monkeypatch, tmp_path: Path, fixture_repo: Path):
    monkeypatch.setenv("IMPULSOR_HUB_DB_PATH", str(tmp_path / "api_test.db"))

    fake_ai = FakeAIExecutorAdapter(apply_fn=lambda ws: (_write(ws), [], []))
    fake_router = FakeRouter(fake_ai)
    monkeypatch.setattr(projects_router, "get_router", lambda: fake_router)
    monkeypatch.setattr(resources_router, "get_router", lambda: fake_router)
    monkeypatch.setattr(tasks_router, "get_router", lambda: fake_router)

    with TestClient(api_main.app) as c:
        yield c, fixture_repo, fake_ai


def _write(workspace: Path) -> list[str]:
    (workspace / "api_created.py").write_text("x = 1\n")
    return ["api_created.py"]


def test_health(client):
    c, _, _ = client
    resp = c.get("/api/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_full_task_flow_through_api(client):
    c, fixture_repo, _fake_ai = client

    resp = c.post("/api/projects", json={"root_path": str(fixture_repo)})
    assert resp.status_code == 200, resp.text
    project = resp.json()

    resp = c.get(f"/api/projects/{project['id']}/resources")
    assert resp.status_code == 200
    assert {r["adapter_key"] for r in resp.json()} == {"git", "claude_code"}

    resp = c.post(f"/api/projects/{project['id']}/tasks", json={"objective": "add a file"})
    assert resp.status_code == 200
    task = resp.json()
    assert task["status"] == "CREATED"

    resp = c.post(f"/api/tasks/{task['id']}/run", json={})
    assert resp.status_code == 200
    assert resp.json()["accepted"] is True

    final_status = None
    for _ in range(50):
        resp = c.get(f"/api/tasks/{task['id']}")
        final_status = resp.json()["status"]
        if final_status in ("COMPLETED", "FAILED", "BLOCKED", "CANCELLED"):
            break
        time.sleep(0.05)
    assert final_status == "COMPLETED"

    resp = c.get(f"/api/tasks/{task['id']}/runs")
    runs = resp.json()
    assert len(runs) == 1
    run = runs[0]
    assert run["status"] == "COMPLETED"

    resp = c.get(f"/api/task-runs/{run['id']}/changes")
    changes = resp.json()
    assert len(changes) == 1
    assert changes[0]["path"] == "api_created.py"

    resp = c.post(f"/api/task-runs/{run['id']}/keep")
    assert resp.status_code == 200
    assert (fixture_repo / "api_created.py").exists()

    resp = c.get("/api/events", params={"task_id": task["id"]})
    assert resp.status_code == 200
    assert len(resp.json()) > 0


def test_add_project_missing_path_returns_400(client):
    c, _fixture_repo, _fake_ai = client
    resp = c.post("/api/projects", json={"root_path": "/definitely/does/not/exist"})
    assert resp.status_code == 400


def test_run_task_for_unknown_task_returns_404(client):
    c, _fixture_repo, _fake_ai = client
    resp = c.post("/api/tasks/does-not-exist/run", json={})
    assert resp.status_code == 404


def test_second_run_rejected_while_project_locked(client):
    import threading

    c, fixture_repo, fake_ai = client
    fake_ai.block_until = threading.Event()

    resp = c.post("/api/projects", json={"root_path": str(fixture_repo)})
    project = resp.json()
    resp = c.post(f"/api/projects/{project['id']}/tasks", json={"objective": "A"})
    task_a = resp.json()
    resp = c.post(f"/api/projects/{project['id']}/tasks", json={"objective": "B"})
    task_b = resp.json()

    c.post(f"/api/tasks/{task_a['id']}/run", json={})
    time.sleep(0.2)

    resp = c.post(f"/api/tasks/{task_b['id']}/run", json={})
    assert resp.status_code == 409

    fake_ai.block_until.set()
    time.sleep(0.2)
