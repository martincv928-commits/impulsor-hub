from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.core.resources import list_resources, refresh_resources
from app.core.router.router import get_router
from app.database.db import get_connection
from app.database.models import Project, ProjectCreate, Resource
from app.projects import service as projects_service

router = APIRouter(prefix="/api/projects", tags=["projects"])


@router.post("", response_model=Project)
def create_project(payload: ProjectCreate) -> Project:
    with get_connection() as conn:
        try:
            return projects_service.add_project(conn, root_path=payload.root_path, name=payload.name)
        except projects_service.ProjectPathError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("", response_model=list[Project])
def list_projects_endpoint() -> list[Project]:
    with get_connection() as conn:
        return projects_service.list_projects(conn)


@router.get("/{project_id}", response_model=Project)
def get_project_endpoint(project_id: str) -> Project:
    with get_connection() as conn:
        project = projects_service.get_project(conn, project_id)
        if project is None:
            raise HTTPException(status_code=404, detail="Project not found")
        return project


@router.get("/{project_id}/resources", response_model=list[Resource])
def project_resources(project_id: str) -> list[Resource]:
    """M1 resources are global (git/claude_code), not per-project, but this
    endpoint keeps the Project overview view self-contained."""
    with get_connection() as conn:
        project = projects_service.get_project(conn, project_id)
        if project is None:
            raise HTTPException(status_code=404, detail="Project not found")
        return refresh_resources(conn, get_router())
