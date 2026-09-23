"""Cloud session bootstrap (M2.7 SPEC sections E, F)."""
from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.api import main as api_main


@pytest.fixture
def client(monkeypatch, tmp_path: Path):
    monkeypatch.setenv("IMPULSOR_HUB_DB_PATH", str(tmp_path / "cloud_test.db"))
    monkeypatch.setenv("IMPULSOR_HUB_AGENT_TOKEN", "the-agent-token")
    with TestClient(api_main.app) as c:
        yield c


def test_session_exchange_returns_agent_token_with_correct_code(client, monkeypatch):
    monkeypatch.setenv("IMPULSOR_HUB_CLOUD_ACCESS_CODE", "let-me-in")
    resp = client.post("/api/cloud/session", json={"access_code": "let-me-in"})
    assert resp.status_code == 200
    assert resp.json() == {"token": "the-agent-token"}


def test_session_exchange_rejects_wrong_code(client, monkeypatch):
    monkeypatch.setenv("IMPULSOR_HUB_CLOUD_ACCESS_CODE", "let-me-in")
    resp = client.post("/api/cloud/session", json={"access_code": "guess"})
    assert resp.status_code == 401


def test_session_exchange_unavailable_when_cloud_not_configured(client, monkeypatch):
    monkeypatch.delenv("IMPULSOR_HUB_CLOUD_ACCESS_CODE", raising=False)
    resp = client.post("/api/cloud/session", json={"access_code": "anything"})
    assert resp.status_code == 503


def test_agent_status_reports_local_mode_by_default(client, monkeypatch):
    monkeypatch.delenv("IMPULSOR_HUB_CLOUD_ACCESS_CODE", raising=False)
    resp = client.get("/api/agent/status")
    assert resp.json()["mode"] == "local"


def test_agent_status_reports_cloud_mode_when_access_code_configured(client, monkeypatch):
    monkeypatch.setenv("IMPULSOR_HUB_CLOUD_ACCESS_CODE", "let-me-in")
    resp = client.get("/api/agent/status")
    assert resp.json()["mode"] == "cloud"


_UI_DIST_PRESENT = (Path(__file__).resolve().parents[1] / "ui" / "dist").is_dir()


@pytest.mark.skipif(not _UI_DIST_PRESENT, reason="ui/dist not built in this checkout")
def test_served_index_never_embeds_the_token_in_cloud_mode(client, monkeypatch):
    monkeypatch.setenv("IMPULSOR_HUB_CLOUD_ACCESS_CODE", "let-me-in")
    resp = client.get("/")
    assert resp.status_code == 200
    assert "__IMPULSOR_AGENT_TOKEN__" not in resp.text
    assert "the-agent-token" not in resp.text


@pytest.mark.skipif(not _UI_DIST_PRESENT, reason="ui/dist not built in this checkout")
def test_served_index_still_embeds_the_token_in_local_mode(client, monkeypatch):
    monkeypatch.delenv("IMPULSOR_HUB_CLOUD_ACCESS_CODE", raising=False)
    resp = client.get("/")
    assert "the-agent-token" in resp.text
