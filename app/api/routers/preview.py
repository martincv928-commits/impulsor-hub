""""PROBAR RESULTADO" -- launches the real Godot executable, non-headless,
against a task run's real workspace so the user can actually play the
result (M2.6 SPEC section L). Deliberately separate from the validator
adapter (which always runs headless --check-only): this is a real,
interactive Godot process the user watches and closes themselves, not a
validation step, so it never feeds back into task status/manifest.

Process state is in-memory only (module-level dict), same pattern as
GodotAdapter's own `_processes` tracking -- an Agent restart naturally
clears any preview state, which is fine since the preview process itself
would need restarting anyway.
"""
from __future__ import annotations

import subprocess
import threading
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException

from app.adapters.validator.godot.adapter import GodotAdapter
from app.database.db import get_connection
from app.projects import service as projects_service
from app.tasks import service as tasks_service

router = APIRouter(prefix="/api/task-runs", tags=["preview"])

_lock = threading.Lock()
_processes: dict[str, subprocess.Popen] = {}


def _workspace_for_run(run_id: str) -> tuple[Path, str]:
    with get_connection() as conn:
        run = tasks_service.get_task_run(conn, run_id)
        if run is None:
            raise HTTPException(status_code=404, detail="Task run not found")
        task = tasks_service.get_task(conn, run.task_id)
        if task is None:
            raise HTTPException(status_code=404, detail="Task not found")
        project = projects_service.get_project(conn, task.project_id)
        if project is None:
            raise HTTPException(status_code=404, detail="Project not found")
    if project.project_type != "godot":
        raise HTTPException(status_code=409, detail="PROBAR RESULTADO solo está disponible para proyectos Godot")
    return Path(project.root_path), project.project_type


@router.post("/{run_id}/preview/start")
def start_preview(run_id: str) -> dict:
    with _lock:
        existing = _processes.get(run_id)
        if existing is not None and existing.poll() is None:
            return {"status": "running", "pid": existing.pid}

    workspace, _ = _workspace_for_run(run_id)
    adapter = GodotAdapter()
    info = adapter.detect()
    if not info["available"]:
        raise HTTPException(status_code=409, detail="Godot no está disponible en este equipo")

    try:
        # No --headless, no --check-only: this is a real, interactive play
        # session the user watches, not validation.
        proc = subprocess.Popen(
            [info["executable_path"], "--path", str(workspace)],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"No se pudo iniciar Godot: {exc}") from exc

    with _lock:
        _processes[run_id] = proc
    return {"status": "running", "pid": proc.pid}


@router.get("/{run_id}/preview/status")
def preview_status(run_id: str) -> dict:
    with _lock:
        proc = _processes.get(run_id)
        if proc is None:
            return {"status": "not_started"}
        if proc.poll() is None:
            return {"status": "running", "pid": proc.pid}
        _processes.pop(run_id, None)
        return {"status": "stopped", "exit_code": proc.returncode}


@router.post("/{run_id}/preview/stop")
def stop_preview(run_id: str) -> dict:
    with _lock:
        proc = _processes.pop(run_id, None)
    if proc is None or proc.poll() is not None:
        return {"status": "stopped"}
    proc.terminate()
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait(timeout=5)
    return {"status": "stopped"}
