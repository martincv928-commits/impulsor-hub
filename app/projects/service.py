"""Project add/list/open (SPEC section 3.2-3.4, CLAUDE_M1 Checkpoint B)."""
from __future__ import annotations

import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from app.core.events.events import log_event
from app.core.permissions.policy import WorkspaceBoundaryError, normalize_project_root
from app.database.models import EventSeverity, Project


class ProjectPathError(Exception):
    """Raised for any invalid project root: missing, not a directory,
    or already registered."""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _detect_project_type(root: Path) -> str:
    """M2 SPEC section 3: detect `type = godot` via project.godot at the
    project root. Anything else stays 'generic' and keeps the plain M1
    pipeline (no universal detection system needed yet)."""
    if (root / "project.godot").is_file():
        return "godot"
    return "generic"


def _row_to_project(row: sqlite3.Row) -> Project:
    return Project(
        id=row["id"],
        name=row["name"],
        root_path=row["root_path"],
        project_type=row["project_type"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        status=row["status"],
    )


def add_project(conn: sqlite3.Connection, *, root_path: str, name: Optional[str] = None) -> Project:
    try:
        resolved = normalize_project_root(root_path)
    except WorkspaceBoundaryError as exc:
        raise ProjectPathError(str(exc)) from exc

    if not resolved.exists():
        raise ProjectPathError(f"Path does not exist: {resolved}")
    if not resolved.is_dir():
        raise ProjectPathError(f"Path is not a directory: {resolved}")

    existing = conn.execute(
        "SELECT * FROM project WHERE root_path = ?", (str(resolved),)
    ).fetchone()
    if existing is not None:
        raise ProjectPathError(f"Project already registered for path: {resolved}")

    project_id = str(uuid.uuid4())
    now = _now()
    display_name = name.strip() if name and name.strip() else resolved.name
    project_type = _detect_project_type(resolved)
    conn.execute(
        """
        INSERT INTO project (id, name, root_path, project_type, created_at, updated_at, status)
        VALUES (?, ?, ?, ?, ?, ?, 'active')
        """,
        (project_id, display_name, str(resolved), project_type, now, now),
    )
    log_event(
        conn,
        type="project.added",
        severity=EventSeverity.INFO,
        project_id=project_id,
        payload={"root_path": str(resolved), "project_type": project_type},
    )
    row = conn.execute("SELECT * FROM project WHERE id = ?", (project_id,)).fetchone()
    return _row_to_project(row)


def list_projects(conn: sqlite3.Connection) -> list[Project]:
    rows = conn.execute("SELECT * FROM project ORDER BY created_at DESC").fetchall()
    return [_row_to_project(r) for r in rows]


def get_project(conn: sqlite3.Connection, project_id: str) -> Optional[Project]:
    row = conn.execute("SELECT * FROM project WHERE id = ?", (project_id,)).fetchone()
    return _row_to_project(row) if row else None


def project_root(project: Project) -> Path:
    return Path(project.root_path)
