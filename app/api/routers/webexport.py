"""Godot Web export + secured mobile preview serving (M2.7 SPEC sections
M-O). A desktop Godot preview (app/api/routers/preview.py) needs a
display on the Agent's own machine -- fine for a PC user sitting at it,
useless for someone reaching the Agent from an Android browser. This is
the mobile answer: run the project through Godot's real, headless Web
export (HTML/WASM/PCK), then serve exactly those files with the headers
Godot's Web runtime requires (cross-origin isolation for SharedArrayBuffer
-- verified for real: without these headers Godot 4.2's Web export
refuses to boot at all), behind an unguessable per-export id, never as a
general file browser over the workspace.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import time
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse

from app.adapters.validator.godot.adapter import GodotAdapter
from app.api.routers.preview import _workspace_for_project, _workspace_for_run
from app.core.permissions.policy import WorkspaceBoundaryError, validate_path_within_workspace
from app.core.security import require_agent_token

router = APIRouter(tags=["webexport"])

_EXPORT_TTL_SECONDS = 30 * 60
_EXPORT_TIMEOUT_SECONDS = 120


def _exports_root() -> Path:
    return Path(os.environ.get("IMPULSOR_HUB_WEBEXPORT_DIR", str(Path.home() / ".impulsor-hub" / "web-exports")))


def _cleanup_expired() -> None:
    root = _exports_root()
    if not root.is_dir():
        return
    now = time.time()
    for entry in root.iterdir():
        try:
            if entry.is_dir() and (now - entry.stat().st_mtime) > _EXPORT_TTL_SECONDS:
                shutil.rmtree(entry, ignore_errors=True)
        except OSError:
            continue


def _run_export(workspace: Path) -> str:
    if not (workspace / "export_presets.cfg").is_file():
        raise HTTPException(
            status_code=409,
            detail="Este proyecto no tiene un preset de exportación Web configurado.",
        )
    adapter = GodotAdapter()
    info = adapter.detect()
    if not info["available"]:
        raise HTTPException(status_code=409, detail="Godot no está disponible en este equipo")

    _cleanup_expired()
    export_id = uuid.uuid4().hex
    export_dir = _exports_root() / export_id
    export_dir.mkdir(parents=True, exist_ok=True)
    target = export_dir / "index.html"

    try:
        result = subprocess.run(
            [info["executable_path"], "--headless", "--export-debug", "Web", str(target), "--path", str(workspace)],
            capture_output=True,
            text=True,
            timeout=_EXPORT_TIMEOUT_SECONDS,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        shutil.rmtree(export_dir, ignore_errors=True)
        raise HTTPException(status_code=500, detail=f"No se pudo exportar el proyecto: {exc}") from exc

    if not target.is_file():
        stderr_excerpt = (result.stderr or "")[-2000:]
        shutil.rmtree(export_dir, ignore_errors=True)
        if "template" in stderr_excerpt.lower():
            raise HTTPException(
                status_code=409,
                detail="Faltan las plantillas de exportación Web de Godot en este equipo.",
            )
        raise HTTPException(status_code=500, detail=f"La exportación Web falló: {stderr_excerpt or 'sin detalles'}")

    return export_id


@router.post("/api/projects/{project_id}/webexport/start", dependencies=[Depends(require_agent_token)])
def start_project_webexport(project_id: str) -> dict:
    export_id = _run_export(_workspace_for_project(project_id))
    return {"status": "ready", "url": f"/preview/web/{export_id}/index.html"}


@router.post("/api/task-runs/{run_id}/webexport/start", dependencies=[Depends(require_agent_token)])
def start_run_webexport(run_id: str) -> dict:
    export_id = _run_export(_workspace_for_run(run_id))
    return {"status": "ready", "url": f"/preview/web/{export_id}/index.html"}


# Deliberately NOT token-gated: a plain browser navigation/<script>/<link>
# request from Godot's own Web runtime cannot attach a custom
# Authorization header, and the whole point is a link an Android user can
# just open. The unguessable export_id in the URL IS the access control
# here (spec O explicitly allows this pattern) -- see module docstring.
@router.get("/preview/web/{export_id}/{filename:path}")
def serve_webexport_file(export_id: str, filename: str):
    # export_id itself is the unguessable-URL security boundary (spec O);
    # this boundary check on top only stops `..`-style traversal escaping
    # THIS export's own directory -- it is never a general file browser
    # over the workspace, and never resolves outside _exports_root().
    export_dir = _exports_root() / export_id
    if not export_dir.is_dir():
        raise HTTPException(status_code=404, detail="Preview not found or expired")
    try:
        resolved = validate_path_within_workspace(export_dir, Path(filename))
    except WorkspaceBoundaryError as exc:
        raise HTTPException(status_code=404, detail="Not found") from exc
    if not resolved.is_file():
        raise HTTPException(status_code=404, detail="Not found")
    # Cross-origin isolation: Godot 4's Web export will not boot without
    # these (verified for real -- omitting them produces a hard error in
    # the browser console: "SharedArrayBuffer ... missing").
    headers = {
        "Cross-Origin-Opener-Policy": "same-origin",
        "Cross-Origin-Embedder-Policy": "require-corp",
    }
    return FileResponse(resolved, headers=headers)
