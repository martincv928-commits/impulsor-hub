from __future__ import annotations

import threading
from typing import Any, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.core.events.events import list_events
from app.core.orchestrator import orchestrator
from app.core.router.router import get_router
from app.database.db import get_connection
from app.database.models import FileChange, Task, TaskCreateRequest, TaskRun
from app.projects import service as projects_service
from app.tasks import service as tasks_service

router = APIRouter(prefix="/api", tags=["tasks"])


class RunTaskRequest(BaseModel):
    timeout_seconds: Optional[int] = None


class EventOut(BaseModel):
    id: str
    project_id: Optional[str] = None
    task_id: Optional[str] = None
    task_run_id: Optional[str] = None
    type: str
    severity: str
    payload: dict[str, Any]
    created_at: str


def _run_in_background(task_id: str, timeout_seconds: int) -> None:
    with get_connection() as conn:
        try:
            orchestrator.run_task(conn, task_id=task_id, router=get_router(), timeout_seconds=timeout_seconds)
        except orchestrator.OrchestratorError:
            pass  # already logged as an event inside the orchestrator / lock path


@router.post("/projects/{project_id}/tasks", response_model=Task)
def create_task(project_id: str, payload: dict) -> Task:
    with get_connection() as conn:
        project = projects_service.get_project(conn, project_id)
        if project is None:
            raise HTTPException(status_code=404, detail="Project not found")
        req = TaskCreateRequest(project_id=project_id, objective=payload.get("objective", ""))
        return tasks_service.create_task(conn, project_id=project_id, objective=req.objective)


@router.get("/projects/{project_id}/tasks", response_model=list[Task])
def list_tasks(project_id: str) -> list[Task]:
    with get_connection() as conn:
        return tasks_service.list_tasks(conn, project_id=project_id)


@router.get("/tasks/{task_id}", response_model=Task)
def get_task(task_id: str) -> Task:
    with get_connection() as conn:
        task = tasks_service.get_task(conn, task_id)
        if task is None:
            raise HTTPException(status_code=404, detail="Task not found")
        return task


@router.post("/tasks/{task_id}/run")
def run_task(task_id: str, payload: RunTaskRequest) -> dict:
    with get_connection() as conn:
        task = tasks_service.get_task(conn, task_id)
        if task is None:
            raise HTTPException(status_code=404, detail="Task not found")
        if tasks_service.has_active_task(conn, project_id=task.project_id):
            raise HTTPException(status_code=409, detail="A task is already running for this project")

    timeout_seconds = payload.timeout_seconds or orchestrator.DEFAULT_TIMEOUT_SECONDS
    thread = threading.Thread(target=_run_in_background, args=(task_id, timeout_seconds), daemon=True)
    thread.start()
    return {"task_id": task_id, "accepted": True}


@router.get("/tasks/{task_id}/runs", response_model=list[TaskRun])
def list_task_runs(task_id: str) -> list[TaskRun]:
    with get_connection() as conn:
        return tasks_service.list_task_runs(conn, task_id=task_id)


@router.get("/task-runs/{run_id}", response_model=TaskRun)
def get_task_run(run_id: str) -> TaskRun:
    with get_connection() as conn:
        run = tasks_service.get_task_run(conn, run_id)
        if run is None:
            raise HTTPException(status_code=404, detail="Task run not found")
        return run


@router.get("/task-runs/{run_id}/changes", response_model=list[FileChange])
def get_task_run_changes(run_id: str) -> list[FileChange]:
    with get_connection() as conn:
        return tasks_service.list_file_changes(conn, task_run_id=run_id)


class KeepRunRequest(BaseModel):
    override: bool = False


@router.post("/task-runs/{run_id}/keep")
def keep_run(run_id: str, payload: KeepRunRequest = KeepRunRequest()) -> dict:
    with get_connection() as conn:
        try:
            orchestrator.keep_task_run(conn, task_run_id=run_id, override=payload.override)
        except orchestrator.OrchestratorError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
    return {"task_run_id": run_id, "disposition": "kept", "override": payload.override}


@router.post("/task-runs/{run_id}/rollback")
def rollback_run(run_id: str) -> dict:
    with get_connection() as conn:
        try:
            orchestrator.rollback_task_run(conn, task_run_id=run_id, router=get_router())
        except orchestrator.OrchestratorError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        except Exception as exc:  # RollbackError etc.
            raise HTTPException(status_code=500, detail=f"Rollback failed: {exc}") from exc
    return {"task_run_id": run_id, "disposition": "rolled_back"}


@router.post("/task-runs/{run_id}/cancel")
def cancel_run(run_id: str) -> dict:
    with get_connection() as conn:
        signalled = orchestrator.cancel_task_run(conn, task_run_id=run_id, router=get_router())
    return {"task_run_id": run_id, "signalled": signalled}


@router.get("/events", response_model=list[EventOut])
def get_events(
    project_id: Optional[str] = None, task_id: Optional[str] = None, task_run_id: Optional[str] = None
) -> list[EventOut]:
    with get_connection() as conn:
        rows = list_events(conn, project_id=project_id, task_id=task_id, task_run_id=task_run_id)
        return [EventOut(**row) for row in rows]
