"""GET/POST /api/settings/ai-provider (M2.8)."""
from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.api import main as api_main
from app.core.router import router as router_module


@pytest.fixture
def client(monkeypatch, tmp_path: Path):
    monkeypatch.setenv("IMPULSOR_HUB_DB_PATH", str(tmp_path / "settings_test.db"))
    monkeypatch.setenv("IMPULSOR_HUB_AGENT_TOKEN", "tok")
    router_module._router_singleton = None  # fresh router per test, reading this test's DB
    with TestClient(api_main.app) as c:
        c.headers["Authorization"] = "Bearer tok"
        yield c
    router_module._router_singleton = None


def test_get_ai_provider_defaults_to_claude_code(client):
    resp = client.get("/api/settings/ai-provider")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["active"] == "claude_code"
    assert set(body["available"]) == {"claude_code", "codex", "gemini"}


def test_set_ai_provider_switches_active_provider(client):
    resp = client.post("/api/settings/ai-provider", json={"provider": "codex"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["active"] == "codex"

    resp = client.get("/api/settings/ai-provider")
    assert resp.json()["active"] == "codex"


def test_set_ai_provider_rejects_unknown_provider(client):
    resp = client.post("/api/settings/ai-provider", json={"provider": "not-a-real-provider"})
    assert resp.status_code == 400


def test_ai_provider_endpoints_require_token(client):
    del client.headers["Authorization"]
    assert client.get("/api/settings/ai-provider").status_code == 401
    assert client.post("/api/settings/ai-provider", json={"provider": "codex"}).status_code == 401


def test_resources_endpoint_reports_all_three_ai_providers(client):
    resp = client.get("/api/resources")
    assert resp.status_code == 200, resp.text
    adapter_keys = {r["adapter_key"] for r in resp.json()}
    assert {"claude_code", "codex", "gemini"} <= adapter_keys
