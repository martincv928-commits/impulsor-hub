"""Godot Web export + preview serving (M2.7 SPEC sections M-O). Uses a
fake subprocess.run so these don't need a real Godot binary or the
~900MB export templates; the real mechanism was already verified by hand
against the real godot4 binary + real export templates (see
M2_7_REPORT.md) -- these tests lock in the contract."""
from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.api import main as api_main
from app.api.routers import webexport as webexport_router
from app.database.db import get_connection
from app.projects import service as projects_service


class _FakeExportResult:
    def __init__(self, stderr: str = ""):
        self.stderr = stderr
        self.returncode = 0


@pytest.fixture
def client(monkeypatch, tmp_path: Path):
    monkeypatch.setenv("IMPULSOR_HUB_DB_PATH", str(tmp_path / "webexport_test.db"))
    monkeypatch.setenv("IMPULSOR_HUB_AGENT_TOKEN", "tok")
    monkeypatch.setenv("IMPULSOR_HUB_WEBEXPORT_DIR", str(tmp_path / "web-exports"))
    with TestClient(api_main.app) as c:
        c.headers["Authorization"] = "Bearer tok"
        yield c


def _make_godot_project(godot_fixture_repo: Path, with_preset: bool = True) -> str:
    if with_preset:
        (godot_fixture_repo / "export_presets.cfg").write_text("[preset.0]\nplatform=\"Web\"\n")
    with get_connection() as conn:
        project = projects_service.add_project(conn, root_path=str(godot_fixture_repo))
    return project.id


def _fake_export_success(monkeypatch, tmp_path: Path):
    """Simulates a real Godot export by writing the target file the real
    binary would produce, instead of only asserting the command shape."""
    monkeypatch.setattr(
        webexport_router.GodotAdapter, "detect", lambda self: {"available": True, "executable_path": "godot4"}
    )

    def fake_run(args, **kwargs):
        target = Path(args[args.index("Web") + 1])
        target.write_text("<html>fake export</html>")
        return _FakeExportResult()

    monkeypatch.setattr(webexport_router.subprocess, "run", fake_run)


def test_project_webexport_start_returns_a_preview_url(client, monkeypatch, godot_fixture_repo, tmp_path):
    project_id = _make_godot_project(godot_fixture_repo)
    _fake_export_success(monkeypatch, tmp_path)

    resp = client.post(f"/api/projects/{project_id}/webexport/start")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "ready"
    assert body["url"].startswith("/preview/web/")
    assert body["url"].endswith("/index.html")


def test_exported_files_are_served_with_cross_origin_isolation_headers(client, monkeypatch, godot_fixture_repo, tmp_path):
    project_id = _make_godot_project(godot_fixture_repo)
    _fake_export_success(monkeypatch, tmp_path)
    url = client.post(f"/api/projects/{project_id}/webexport/start").json()["url"]

    resp = client.get(url)
    assert resp.status_code == 200
    assert resp.headers["cross-origin-opener-policy"] == "same-origin"
    assert resp.headers["cross-origin-embedder-policy"] == "require-corp"
    assert resp.text == "<html>fake export</html>"


def test_path_traversal_outside_export_dir_is_rejected(client, monkeypatch, godot_fixture_repo, tmp_path):
    project_id = _make_godot_project(godot_fixture_repo)
    _fake_export_success(monkeypatch, tmp_path)
    url = client.post(f"/api/projects/{project_id}/webexport/start").json()["url"]
    export_id = url.split("/")[3]

    resp = client.get(f"/preview/web/{export_id}/../../../etc/passwd")
    assert resp.status_code == 404


def test_unknown_export_id_is_404(client):
    resp = client.get("/preview/web/does-not-exist/index.html")
    assert resp.status_code == 404


def test_preview_serving_requires_no_token(client, monkeypatch, godot_fixture_repo, tmp_path):
    """Deliberately public -- Godot's own Web runtime and a bare browser
    navigation cannot attach a Bearer header; the unguessable export id
    is the access control (spec O)."""
    project_id = _make_godot_project(godot_fixture_repo)
    _fake_export_success(monkeypatch, tmp_path)
    url = client.post(f"/api/projects/{project_id}/webexport/start").json()["url"]

    del client.headers["Authorization"]
    resp = client.get(url)
    assert resp.status_code == 200


def test_webexport_start_requires_token(client, godot_fixture_repo):
    project_id = _make_godot_project(godot_fixture_repo)
    del client.headers["Authorization"]
    resp = client.post(f"/api/projects/{project_id}/webexport/start")
    assert resp.status_code == 401


def test_webexport_rejected_when_no_export_preset(client, godot_fixture_repo):
    project_id = _make_godot_project(godot_fixture_repo, with_preset=False)
    resp = client.post(f"/api/projects/{project_id}/webexport/start")
    assert resp.status_code == 409
    assert "preset" in resp.json()["detail"].lower()


def test_webexport_rejected_when_godot_unavailable(client, monkeypatch, godot_fixture_repo):
    project_id = _make_godot_project(godot_fixture_repo)
    monkeypatch.setattr(webexport_router.GodotAdapter, "detect", lambda self: {"available": False})
    resp = client.post(f"/api/projects/{project_id}/webexport/start")
    assert resp.status_code == 409


def test_webexport_reports_missing_export_templates_clearly(client, monkeypatch, godot_fixture_repo):
    project_id = _make_godot_project(godot_fixture_repo)
    monkeypatch.setattr(
        webexport_router.GodotAdapter, "detect", lambda self: {"available": True, "executable_path": "godot4"}
    )
    monkeypatch.setattr(
        webexport_router.subprocess,
        "run",
        lambda *a, **k: _FakeExportResult(stderr="No export template found at expected path"),
    )
    resp = client.post(f"/api/projects/{project_id}/webexport/start")
    assert resp.status_code == 409
    assert "plantillas" in resp.json()["detail"].lower()


def test_run_webexport_rejected_for_non_godot_project(client, fixture_repo):
    with get_connection() as conn:
        project = projects_service.add_project(conn, root_path=str(fixture_repo))
    resp = client.post(f"/api/projects/{project.id}/webexport/start")
    assert resp.status_code == 409


def test_expired_exports_are_cleaned_up(client, monkeypatch, godot_fixture_repo, tmp_path):
    project_id = _make_godot_project(godot_fixture_repo)
    _fake_export_success(monkeypatch, tmp_path)
    url = client.post(f"/api/projects/{project_id}/webexport/start").json()["url"]
    export_id = url.split("/")[3]
    export_dir = tmp_path / "web-exports" / export_id
    assert export_dir.is_dir()

    # Simulate this export having aged past the TTL.
    import os
    import time

    old = time.time() - webexport_router._EXPORT_TTL_SECONDS - 60
    os.utime(export_dir, (old, old))

    # Any new export triggers a cleanup sweep.
    client.post(f"/api/projects/{project_id}/webexport/start")
    assert not export_dir.exists()
