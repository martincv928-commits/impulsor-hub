"""Task/TASK_RUN persistence and state transitions (SPEC sections 8-9,
CLAUDE_M1 Checkpoint C). Pure CRUD + validated transitions; the actual
execution pipeline lives in core/orchestrator/orchestrator.py so this
module stays testable without needing a real AI executor or git repo.
"""
from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from app.database.models import (
    Checkpoint,
    ExecutorResult,
    FileChange,
    RunDisposition,
    Task,
    TaskRun,
    TaskRunStatus,
    TaskStatus,
    TASK_TRANSITIONS,
)


class InvalidTransitionError(Exception):
    pass


class TaskAlreadyRunningError(Exception):
    """Raised when a project already has an active mutating task (SPEC 3.8,
    Checkpoint C: 'one active mutating task per project')."""


_ACTIVE_TASK_STATUSES = {
    TaskStatus.LOCKING,
    TaskStatus.CHECKPOINTING,
    TaskStatus.RUNNING,
    TaskStatus.VERIFYING,
}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _row_to_task(row: sqlite3.Row) -> Task:
    return Task(
        id=row["id"],
        project_id=row["project_id"],
        objective=row["objective"],
        status=TaskStatus(row["status"]),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def _row_to_task_run(row: sqlite3.Row) -> TaskRun:
    return TaskRun(
        id=row["id"],
        task_id=row["task_id"],
        executor_resource_id=row["executor_resource_id"],
        status=TaskRunStatus(row["status"]),
        started_at=row["started_at"],
        ended_at=row["ended_at"],
        timeout_seconds=row["timeout_seconds"],
        structured_result=json.loads(row["structured_result_json"]) if row["structured_result_json"] else None,
        stdout_path=row["stdout_path"],
        stderr_path=row["stderr_path"],
        failure_reason=row["failure_reason"],
        disposition=RunDisposition(row["disposition"]),
        validation_status=row["validation_status"],
    )


def _row_to_file_change(row: sqlite3.Row) -> FileChange:
    return FileChange(
        id=row["id"],
        task_run_id=row["task_run_id"],
        path=row["path"],
        change_type=row["change_type"],
        additions=row["additions"],
        deletions=row["deletions"],
        claimed_by_executor=bool(row["claimed_by_executor"]) if row["claimed_by_executor"] is not None else None,
        observed_by_vcs=bool(row["observed_by_vcs"]),
    )


def _row_to_checkpoint(row: sqlite3.Row) -> Checkpoint:
    return Checkpoint(
        id=row["id"],
        project_id=row["project_id"],
        task_run_id=row["task_run_id"],
        mechanism=row["mechanism"],
        reference=row["reference"],
        created_at=row["created_at"],
        restore_status=row["restore_status"],
    )


def create_task(conn: sqlite3.Connection, *, project_id: str, objective: str) -> Task:
    task_id = str(uuid.uuid4())
    now = _now()
    conn.execute(
        """
        INSERT INTO task (id, project_id, objective, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (task_id, project_id, objective, TaskStatus.CREATED.value, now, now),
    )
    return get_task(conn, task_id)  # type: ignore[return-value]


def get_task(conn: sqlite3.Connection, task_id: str) -> Optional[Task]:
    row = conn.execute("SELECT * FROM task WHERE id = ?", (task_id,)).fetchone()
    return _row_to_task(row) if row else None


def list_tasks(conn: sqlite3.Connection, *, project_id: str) -> list[Task]:
    rows = conn.execute(
        "SELECT * FROM task WHERE project_id = ? ORDER BY created_at DESC", (project_id,)
    ).fetchall()
    return [_row_to_task(r) for r in rows]


def transition_task(conn: sqlite3.Connection, task_id: str, new_status: TaskStatus) -> Task:
    task = get_task(conn, task_id)
    if task is None:
        raise ValueError(f"Unknown task: {task_id}")
    allowed = TASK_TRANSITIONS.get(task.status, set())
    if new_status not in allowed:
        raise InvalidTransitionError(f"Cannot transition task from {task.status} to {new_status}")
    conn.execute(
        "UPDATE task SET status = ?, updated_at = ? WHERE id = ?",
        (new_status.value, _now(), task_id),
    )
    return get_task(conn, task_id)  # type: ignore[return-value]


def has_active_task(conn: sqlite3.Connection, *, project_id: str) -> bool:
    placeholders = ",".join("?" for _ in _ACTIVE_TASK_STATUSES)
    row = conn.execute(
        f"SELECT 1 FROM task WHERE project_id = ? AND status IN ({placeholders}) LIMIT 1",
        (project_id, *[s.value for s in _ACTIVE_TASK_STATUSES]),
    ).fetchone()
    return row is not None


def create_task_run(
    conn: sqlite3.Connection, *, task_id: str, executor_resource_id: str, timeout_seconds: int
) -> TaskRun:
    run_id = str(uuid.uuid4())
    conn.execute(
        """
        INSERT INTO task_run (id, task_id, executor_resource_id, status, timeout_seconds, disposition)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (run_id, task_id, executor_resource_id, TaskRunStatus.PENDING.value, timeout_seconds, RunDisposition.PENDING.value),
    )
    return get_task_run(conn, run_id)  # type: ignore[return-value]


def get_task_run(conn: sqlite3.Connection, run_id: str) -> Optional[TaskRun]:
    row = conn.execute("SELECT * FROM task_run WHERE id = ?", (run_id,)).fetchone()
    return _row_to_task_run(row) if row else None


def list_task_runs(conn: sqlite3.Connection, *, task_id: str) -> list[TaskRun]:
    rows = conn.execute(
        "SELECT * FROM task_run WHERE task_id = ? ORDER BY started_at DESC", (task_id,)
    ).fetchall()
    return [_row_to_task_run(r) for r in rows]


def update_task_run(conn: sqlite3.Connection, run_id: str, **fields: Any) -> TaskRun:
    if not fields:
        return get_task_run(conn, run_id)  # type: ignore[return-value]
    column_map = {
        "status": lambda v: v.value if isinstance(v, TaskRunStatus) else v,
        "started_at": lambda v: v,
        "ended_at": lambda v: v,
        "structured_result_json": lambda v: v,
        "stdout_path": lambda v: v,
        "stderr_path": lambda v: v,
        "failure_reason": lambda v: v,
        "disposition": lambda v: v.value if isinstance(v, RunDisposition) else v,
        "validation_status": lambda v: v,
    }
    set_clauses = []
    params: list[Any] = []
    for key, value in fields.items():
        if key == "structured_result":
            key = "structured_result_json"
            value = json.dumps(value) if value is not None else None
        if key not in column_map:
            raise ValueError(f"Unknown task_run field: {key}")
        set_clauses.append(f"{key} = ?")
        params.append(column_map[key](value))
    params.append(run_id)
    conn.execute(f"UPDATE task_run SET {', '.join(set_clauses)} WHERE id = ?", params)
    return get_task_run(conn, run_id)  # type: ignore[return-value]


def record_file_changes(
    conn: sqlite3.Connection, *, task_run_id: str, entries: list[dict[str, Any]]
) -> list[FileChange]:
    result = []
    for entry in entries:
        fc_id = str(uuid.uuid4())
        conn.execute(
            """
            INSERT INTO file_change
                (id, task_run_id, path, change_type, additions, deletions, claimed_by_executor, observed_by_vcs)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                fc_id,
                task_run_id,
                entry["path"],
                entry["change_type"],
                entry.get("additions"),
                entry.get("deletions"),
                entry.get("claimed_by_executor"),
                entry["observed_by_vcs"],
            ),
        )
        row = conn.execute("SELECT * FROM file_change WHERE id = ?", (fc_id,)).fetchone()
        result.append(_row_to_file_change(row))
    return result


def list_file_changes(conn: sqlite3.Connection, *, task_run_id: str) -> list[FileChange]:
    rows = conn.execute(
        "SELECT * FROM file_change WHERE task_run_id = ? ORDER BY path", (task_run_id,)
    ).fetchall()
    return [_row_to_file_change(r) for r in rows]


def create_checkpoint(
    conn: sqlite3.Connection, *, project_id: str, task_run_id: Optional[str], mechanism: str, reference: str
) -> Checkpoint:
    cp_id = str(uuid.uuid4())
    conn.execute(
        """
        INSERT INTO checkpoint (id, project_id, task_run_id, mechanism, reference, created_at, restore_status)
        VALUES (?, ?, ?, ?, ?, ?, 'available')
        """,
        (cp_id, project_id, task_run_id, mechanism, reference, _now()),
    )
    row = conn.execute("SELECT * FROM checkpoint WHERE id = ?", (cp_id,)).fetchone()
    return _row_to_checkpoint(row)


def get_checkpoint_for_run(conn: sqlite3.Connection, *, task_run_id: str) -> Optional[Checkpoint]:
    row = conn.execute(
        "SELECT * FROM checkpoint WHERE task_run_id = ? ORDER BY created_at DESC LIMIT 1", (task_run_id,)
    ).fetchone()
    return _row_to_checkpoint(row) if row else None


def set_checkpoint_restore_status(conn: sqlite3.Connection, checkpoint_id: str, restore_status: str) -> None:
    conn.execute("UPDATE checkpoint SET restore_status = ? WHERE id = ?", (restore_status, checkpoint_id))
