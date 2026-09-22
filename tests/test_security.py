"""Agent token authentication (M2.6 SPEC section E)."""
from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.api import main as api_main
from app.api.routers import projects as projects_router
from app.api.routers import resources as resources_router
from app.api.routers import tasks as tasks_router
from app.core.security import get_or_create_agent_token
from tests.fakes import FakeAIExecutorAdapter, FakeRouter


@pytest.fixture
def unauthenticated_client(monkeypatch, tmp_path: Path):
    monkeypatch.setenv("IMPULSOR_HUB_DB_PATH", str(tmp_path / "sec_test.db"))
    monkeypatch.setenv("IMPULSOR_HUB_AGENT_TOKEN", "the-real-token")
    fake_router = FakeRouter(FakeAIExecutorAdapter(apply_fn=lambda ws: ([], [], [])))
    monkeypatch.setattr(projects_router, "get_router", lambda: fake_router)
    monkeypatch.setattr(resources_router, "get_router", lambda: fake_router)
    monkeypatch.setattr(tasks_router, "get_router", lambda: fake_router)
    with TestClient(api_main.app) as c:
        yield c


def test_protected_endpoint_rejects_missing_token(unauthenticated_client):
    resp = unauthenticated_client.get("/api/projects")
    assert resp.status_code == 401


def test_protected_endpoint_rejects_wrong_token(unauthenticated_client):
    unauthenticated_client.headers["Authorization"] = "Bearer not-the-real-token"
    resp = unauthenticated_client.get("/api/projects")
    assert resp.status_code == 401


def test_protected_endpoint_accepts_correct_token(unauthenticated_client):
    unauthenticated_client.headers["Authorization"] = "Bearer the-real-token"
    resp = unauthenticated_client.get("/api/projects")
    assert resp.status_code == 200


def test_health_and_agent_status_are_public(unauthenticated_client):
    assert unauthenticated_client.get("/api/health").status_code == 200
    assert unauthenticated_client.get("/api/agent/status").status_code == 200


def test_token_persists_across_calls_when_not_overridden(monkeypatch, tmp_path: Path):
    monkeypatch.delenv("IMPULSOR_HUB_AGENT_TOKEN", raising=False)
    monkeypatch.setenv("IMPULSOR_HUB_TOKEN_PATH", str(tmp_path / "agent_token"))
    first = get_or_create_agent_token()
    second = get_or_create_agent_token()
    assert first == second
    assert (tmp_path / "agent_token").read_text().strip() == first
