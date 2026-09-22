"""USAR PROYECTO DE PRUEBA (M2.6.1 SPEC sections A, P)."""
from __future__ import annotations

import hashlib
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.api import main as api_main
from app.api.routers import testgame as testgame_router

TEMPLATE_DIR = Path(__file__).resolve().parents[1] / "fixtures" / "impulsor_hub_test_game"


@pytest.fixture
def client(monkeypatch, tmp_path: Path):
    monkeypatch.setenv("IMPULSOR_HUB_DB_PATH", str(tmp_path / "testgame_test.db"))
    monkeypatch.setenv("IMPULSOR_HUB_AGENT_TOKEN", "tok")
    monkeypatch.setenv("IMPULSOR_HUB_TEST_PROJECTS_DIR", str(tmp_path / "test-projects"))
    with TestClient(api_main.app) as c:
        c.headers["Authorization"] = "Bearer tok"
        yield c


def _template_hashes() -> dict[str, str]:
    return {
        p.name: hashlib.sha256(p.read_bytes()).hexdigest()
        for p in TEMPLATE_DIR.iterdir()
        if p.is_file()
    }


def test_template_fixture_has_project_godot_and_main_scene():
    assert (TEMPLATE_DIR / "project.godot").is_file()
    assert (TEMPLATE_DIR / "main.tscn").is_file()
    config = (TEMPLATE_DIR / "project.godot").read_text()
    assert 'run/main_scene="res://main.tscn"' in config
    # Never itself a git repo -- copies get a fresh one, the template doesn't.
    assert not (TEMPLATE_DIR / ".git").exists()


def test_create_test_game_copy_returns_a_real_godot_project(client):
    resp = client.post("/api/test-game")
    assert resp.status_code == 200, resp.text
    project = resp.json()
    assert project["project_type"] == "godot"
    assert project["name"] == "Impulsor Hub Test Game (prueba)"
    dest = Path(project["root_path"])
    assert (dest / "project.godot").is_file()
    assert (dest / "main.tscn").is_file()
    assert (dest / ".git").is_dir()


def test_create_test_game_copy_never_modifies_the_master_template(client):
    before = _template_hashes()
    client.post("/api/test-game")
    after = _template_hashes()
    assert before == after


def test_two_copies_are_independent_projects(client):
    r1 = client.post("/api/test-game").json()
    r2 = client.post("/api/test-game").json()
    assert r1["id"] != r2["id"]
    assert r1["root_path"] != r2["root_path"]
    assert Path(r1["root_path"]).is_dir()
    assert Path(r2["root_path"]).is_dir()


def test_create_test_game_copy_requires_token(client):
    del client.headers["Authorization"]
    resp = client.post("/api/test-game")
    assert resp.status_code == 401


def test_missing_template_reports_a_clear_error(client, monkeypatch, tmp_path: Path):
    monkeypatch.setattr(testgame_router, "_TEMPLATE_DIR", tmp_path / "does-not-exist")
    resp = client.post("/api/test-game")
    assert resp.status_code == 500
    assert "no está disponible" in resp.json()["detail"]
