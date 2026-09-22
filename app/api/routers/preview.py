""""PROBAR RESULTADO" / "PROBAR ESTADO ACTUAL" -- launches the real Godot
executable, non-headless, against a real workspace so the user can
actually play it (M2.6 SPEC section L; M2.6.1 SPEC section B extends this
to previewing a project's *current* state before any task runs).
Deliberately separate from the validator adapter (which always runs
headless --check-only): this is a real, interactive Godot process the
user watches and closes themselves, not a validation step, so it never
feeds back into task status/manifest.

Process state is in-memory only (module-level dict), same pattern as
GodotAdapter's own `_processes` tracking -- an Agent restart naturally
clears any preview state. Two thin route groups (task-run-scoped and
project-scoped) share the same start/status/stop mechanics via a single
string key, prefixed per scope so a run id and a project id can never
collide in the same dict.
"""
from __future__ import annotations

import subprocess
import threading
from pathlib import Path

from fastapi import APIRouter, HTTPException

from app.adapters.validator.godot.adapter import GodotAdapter
from app.database.db import get_connection
from app.projects import service as projects_service
from app.tasks import service as tasks_service

router = APIRouter(tags=["preview"])

_lock = threading.Lock()
_processes: dict[str, subprocess.Popen] = {}


def _workspace_for_run(run_id: str) -> Path:
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
    return Path(project.root_path)


def _workspace_for_project(project_id: str) -> Path:
    with get_connection() as conn:
        project = projects_service.get_project(conn, project_id)
        if project is None:
            raise HTTPException(status_code=404, detail="Project not found")
    if project.project_type != "godot":
        raise HTTPException(status_code=409, detail="PROBAR ESTADO ACTUAL solo está disponible para proyectos Godot")
    return Path(project.root_path)


def _start(key: str, workspace: Path) -> dict:
    with _lock:
        existing = _processes.get(key)
        if existing is not None and existing.poll() is None:
            return {"status": "running", "pid": existing.pid}

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
        _processes[key] = proc
    return {"status": "running", "pid": proc.pid}


def _status(key: str) -> dict:
    with _lock:
        proc = _processes.get(key)
        if proc is None:
            return {"status": "not_started"}
        if proc.poll() is None:
            return {"status": "running", "pid": proc.pid}
        _processes.pop(key, None)
        return {"status": "stopped", "exit_code": proc.returncode}


def _stop(key: str) -> dict:
    with _lock:
        proc = _processes.pop(key, None)
    if proc is None or proc.poll() is not None:
        return {"status": "stopped"}
    proc.terminate()
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait(timeout=5)
    return {"status": "stopped"}


def stop_all() -> None:
    """Called on Agent shutdown (see app/api/main.py's lifespan): only
    kills preview processes THIS Agent started and is tracking here --
    never touches a Godot process the user launched some other way."""
    with _lock:
        keys = list(_processes.keys())
    for key in keys:
        _stop(key)


# --- PROBAR RESULTADO: after a task run -------------------------------
@router.post("/api/task-runs/{run_id}/preview/start")
def start_run_preview(run_id: str) -> dict:
    return _start(f"run:{run_id}", _workspace_for_run(run_id))


@router.get("/api/task-runs/{run_id}/preview/status")
def run_preview_status(run_id: str) -> dict:
    return _status(f"run:{run_id}")


@router.post("/api/task-runs/{run_id}/preview/stop")
def stop_run_preview(run_id: str) -> dict:
    return _stop(f"run:{run_id}")


# --- PROBAR ESTADO ACTUAL: a project's current state, no task run yet --
@router.post("/api/projects/{project_id}/preview/start")
def start_project_preview(project_id: str) -> dict:
    return _start(f"project:{project_id}", _workspace_for_project(project_id))


@router.get("/api/projects/{project_id}/preview/status")
def project_preview_status(project_id: str) -> dict:
    return _status(f"project:{project_id}")


@router.post("/api/projects/{project_id}/preview/stop")
def stop_project_preview(project_id: str) -> dict:
    return _stop(f"project:{project_id}")
