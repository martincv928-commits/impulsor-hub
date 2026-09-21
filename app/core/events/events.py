"""Structured lifecycle/event logging (SPEC section 2.7, section 17).

Every important transition or error is persisted here so the UI and future
reliability metrics never depend on parsing logs or prose.
"""
from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from app.database.models import EventSeverity


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def log_event(
    conn: sqlite3.Connection,
    *,
    type: str,
    severity: EventSeverity | str = EventSeverity.INFO,
    project_id: Optional[str] = None,
    task_id: Optional[str] = None,
    task_run_id: Optional[str] = None,
    payload: Optional[dict[str, Any]] = None,
) -> str:
    event_id = str(uuid.uuid4())
    severity_value = severity.value if isinstance(severity, EventSeverity) else severity
    conn.execute(
        """
        INSERT INTO event (id, project_id, task_id, task_run_id, type, severity, payload_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            event_id,
            project_id,
            task_id,
            task_run_id,
            type,
            severity_value,
            json.dumps(payload or {}),
            _now(),
        ),
    )
    return event_id


def list_events(
    conn: sqlite3.Connection,
    *,
    project_id: Optional[str] = None,
    task_id: Optional[str] = None,
    task_run_id: Optional[str] = None,
    limit: int = 200,
) -> list[dict[str, Any]]:
    clauses = []
    params: list[Any] = []
    if project_id is not None:
        clauses.append("project_id = ?")
        params.append(project_id)
    if task_id is not None:
        clauses.append("task_id = ?")
        params.append(task_id)
    if task_run_id is not None:
        clauses.append("task_run_id = ?")
        params.append(task_run_id)
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    rows = conn.execute(
        f"SELECT * FROM event {where} ORDER BY created_at DESC LIMIT ?",
        (*params, limit),
    ).fetchall()
    result = []
    for row in rows:
        d = dict(row)
        d["payload"] = json.loads(d.pop("payload_json"))
        result.append(d)
    return result
