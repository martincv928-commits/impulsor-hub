"""Native folder picker (M2.6 SPEC section F). Mocks the actual Tk dialog
so these tests never need a real display."""
from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.api import main as api_main
from app.api.routers import agent as agent_router


@pytest.fixture
def client(monkeypatch, tmp_path: Path):
    monkeypatch.setenv("IMPULSOR_HUB_DB_PATH", str(tmp_path / "agent_test.db"))
    monkeypatch.setenv("IMPULSOR_HUB_AGENT_TOKEN", "tok")
    with TestClient(api_main.app) as c:
        c.headers["Authorization"] = "Bearer tok"
        yield c


def test_pick_folder_returns_selected_path(client, monkeypatch, tmp_path: Path):
    chosen = str(tmp_path / "my-project")
    monkeypatch.setattr(agent_router, "_run_native_folder_dialog", lambda: chosen)
    resp = client.post("/api/agent/pick-folder")
    assert resp.status_code == 200
    body = resp.json()
    assert body == {"path": chosen, "cancelled": False, "error": None}


def test_pick_folder_reports_cancellation(client, monkeypatch):
    monkeypatch.setattr(agent_router, "_run_native_folder_dialog", lambda: None)
    resp = client.post("/api/agent/pick-folder")
    assert resp.status_code == 200
    assert resp.json() == {"path": None, "cancelled": True, "error": None}


def test_pick_folder_reports_clear_error_when_no_display(client, monkeypatch):
    def _boom():
        raise RuntimeError("no display name and no $DISPLAY environment variable")

    monkeypatch.setattr(agent_router, "_run_native_folder_dialog", _boom)
    resp = client.post("/api/agent/pick-folder")
    assert resp.status_code == 200
    body = resp.json()
    assert body["path"] is None
    assert body["cancelled"] is False
    assert "no se pudo abrir" in body["error"].lower()


def test_pick_folder_requires_token(client):
    del client.headers["Authorization"]
    resp = client.post("/api/agent/pick-folder")
    assert resp.status_code == 401
