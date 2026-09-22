"""Task execution pipeline (SPEC sections 3, 9, 15; CLAUDE_M1 Checkpoints C-E).

`local project -> task -> safe baseline -> Claude Code executor ->
actual Git inspection -> manifest -> user KEEP or ROLLBACK`

This module is the only place that wires adapters (via the router),
policy enforcement, event logging and task/task_run persistence together.
The API layer only calls functions here; it never talks to adapters
directly.
"""
from __future__ import annotations

import sqlite3
import threading
from pathlib import Path
from typing import Optional

from app.adapters.ai.base import ExecuteRequest
from app.adapters.vcs.base import (
    CheckpointRef,
    RepositoryNotFoundError,
    RollbackError,
    VcsNotAvailableError,
)
from app.core.events.events import log_event
from app.core.permissions.policy import impulsor_metadata_dir
from app.core.router.router import ResourceRouter
from app.database.models import EventSeverity, RunDisposition, Task, TaskRunStatus, TaskStatus
from app.projects import service as projects_service
from app.tasks import service as tasks_service

DEFAULT_TIMEOUT_SECONDS = 600

_project_locks: dict[str, threading.Lock] = {}
_project_locks_guard = threading.Lock()


class OrchestratorError(Exception):
    def __init__(self, message: str, *, event_type: str, severity: EventSeverity = EventSeverity.ERROR):
        super().__init__(message)
        self.event_type = event_type
        self.severity = severity


class ProjectLockedError(OrchestratorError):
    pass


def _project_lock(project_id: str) -> threading.Lock:
    with _project_locks_guard:
        if project_id not in _project_locks:
            _project_locks[project_id] = threading.Lock()
        return _project_locks[project_id]


def run_task(
    conn: sqlite3.Connection,
    *,
    task_id: str,
    router: ResourceRouter,
    timeout_seconds: int = DEFAULT_TIMEOUT_SECONDS,
) -> Task:
    """Execute the full pipeline synchronously for `task_id`.

    Synchronous-and-blocking is a deliberate M1 simplification: the API
    layer runs this in a background thread per request so the HTTP call can
    return immediately while this function owns the project lock for the
    duration of the run (SPEC 3.8, Checkpoint C).
    """
    task = tasks_service.get_task(conn, task_id)
    if task is None:
        raise OrchestratorError(f"Unknown task: {task_id}", event_type="task.not_found")

    project = projects_service.get_project(conn, task.project_id)
    if project is None:
        raise OrchestratorError(f"Unknown project: {task.project_id}", event_type="task.project_missing")

    workspace = projects_service.project_root(project)
    vcs = router.select_vcs()
    ai_executor = router.select_ai_executor()

    if tasks_service.has_active_task(conn, project_id=project.id) and task.status not in (
        TaskStatus.LOCKING,
        TaskStatus.CHECKPOINTING,
        TaskStatus.RUNNING,
        TaskStatus.VERIFYING,
    ):
        # DB-level fallback lock: catches another task mid-flight even if this
        # process's in-memory lock was lost (e.g. across a restart).
        raise ProjectLockedError(
            f"A task is already running for project {project.id}", event_type="task.blocked_locked"
        )

    lock = _project_lock(project.id)
    if not lock.acquire(blocking=False):
        raise ProjectLockedError(
            f"A task is already running for project {project.id}", event_type="task.blocked_locked"
        )

    try:
        task = tasks_service.transition_task(conn, task_id, TaskStatus.VALIDATING)
        conn.commit()  # visible to other connections immediately: a run can take minutes
        try:
            vcs.validate_repository(workspace)
        except (RepositoryNotFoundError, VcsNotAvailableError) as exc:
            log_event(
                conn,
                type="task.validation_failed",
                severity=EventSeverity.ERROR,
                project_id=project.id,
                task_id=task_id,
                payload={"error": str(exc)},
            )
            return tasks_service.transition_task(conn, task_id, TaskStatus.BLOCKED)

        pre_status = vcs.status(workspace)
        if not pre_status.is_clean:
            log_event(
                conn,
                type="task.dirty_repository_baseline",
                severity=EventSeverity.WARNING,
                project_id=project.id,
                task_id=task_id,
                payload={"entries": pre_status.entries},
            )

        task = tasks_service.transition_task(conn, task_id, TaskStatus.READY)
        task = tasks_service.transition_task(conn, task_id, TaskStatus.LOCKING)
        log_event(conn, type="task.locked", severity=EventSeverity.INFO, project_id=project.id, task_id=task_id)
        conn.commit()

        task = tasks_service.transition_task(conn, task_id, TaskStatus.CHECKPOINTING)
        conn.commit()
        checkpoint_dir = impulsor_metadata_dir(workspace) / "checkpoints"
        try:
            ref = vcs.create_checkpoint(workspace, checkpoint_dir)
        except Exception as exc:  # noqa: BLE001 - surfaced as a task failure, not a crash
            log_event(
                conn,
                type="task.checkpoint_failed",
                severity=EventSeverity.ERROR,
                project_id=project.id,
                task_id=task_id,
                payload={"error": str(exc)},
            )
            return tasks_service.transition_task(conn, task_id, TaskStatus.FAILED)

        task_run = tasks_service.create_task_run(
            conn, task_id=task_id, executor_resource_id="resource-claude-code", timeout_seconds=timeout_seconds
        )
        checkpoint = tasks_service.create_checkpoint(
            conn,
            project_id=project.id,
            task_run_id=task_run.id,
            mechanism=ref.mechanism,
            reference=ref.reference,
        )
        log_event(
            conn,
            type="task.checkpoint_created",
            severity=EventSeverity.INFO,
            project_id=project.id,
            task_id=task_id,
            task_run_id=task_run.id,
            payload={"checkpoint_id": checkpoint.id, "mechanism": ref.mechanism},
        )

        task = tasks_service.transition_task(conn, task_id, TaskStatus.RUNNING)
        from datetime import datetime, timezone

        tasks_service.update_task_run(
            conn, task_run.id, status=TaskRunStatus.RUNNING, started_at=datetime.now(timezone.utc).isoformat()
        )
        log_event(
            conn,
            type="task.execution_started",
            severity=EventSeverity.INFO,
            project_id=project.id,
            task_id=task_id,
            task_run_id=task_run.id,
        )
        conn.commit()  # must be visible before the (potentially minutes-long) blocking call below

        outcome = ai_executor.execute(
            ExecuteRequest(
                task_id=task_id,
                run_id=task_run.id,
                workspace=workspace,
                objective=task.objective,
                timeout_seconds=timeout_seconds,
            )
        )

        logs_dir = impulsor_metadata_dir(workspace) / "logs" / task_run.id
        logs_dir.mkdir(parents=True, exist_ok=True)
        stdout_path = logs_dir / "stdout.log"
        stderr_path = logs_dir / "stderr.log"
        stdout_path.write_text(outcome.stdout)
        stderr_path.write_text(outcome.stderr)

        ended_at = datetime.now(timezone.utc).isoformat()
        log_event(
            conn,
            type="task.execution_finished",
            severity=EventSeverity.INFO,
            project_id=project.id,
            task_id=task_id,
            task_run_id=task_run.id,
            payload={"run_status": outcome.run_status, "exit_code": outcome.exit_code, "warnings": outcome.warnings},
        )
        if outcome.malformed_result_raw is not None:
            log_event(
                conn,
                type="task.malformed_executor_result",
                severity=EventSeverity.WARNING,
                project_id=project.id,
                task_id=task_id,
                task_run_id=task_run.id,
                payload={"raw": outcome.malformed_result_raw[:2000]},
            )

        task = tasks_service.transition_task(conn, task_id, TaskStatus.VERIFYING)
        # Compared against the pre-task checkpoint snapshot's actual bytes
        # (see GitAdapter.compute_change_manifest), not another `git status`
        # snapshot -- that's what lets a re-edit of an already-dirty file be
        # detected as task-attributable (SPEC 15 / M1_REPORT.md §7.1 fix).
        manifest = vcs.compute_change_manifest(workspace, ref)

        claimed_paths: dict[str, bool] = {}
        if outcome.structured_result is not None:
            for p in outcome.structured_result.files_claimed_created:
                claimed_paths[p] = True
            for p in outcome.structured_result.files_claimed_modified:
                claimed_paths[p] = True
            for p in outcome.structured_result.files_claimed_deleted:
                claimed_paths[p] = True

        observed_paths = {e.path for e in manifest.entries}
        entries_to_persist = []
        for entry in manifest.entries:
            entries_to_persist.append(
                {
                    "path": entry.path,
                    "change_type": entry.change_type,
                    "additions": entry.additions,
                    "deletions": entry.deletions,
                    "claimed_by_executor": entry.path in claimed_paths,
                    "observed_by_vcs": True,
                }
            )
        discrepant_claimed_only = sorted(set(claimed_paths) - observed_paths)
        for path in discrepant_claimed_only:
            entries_to_persist.append(
                {
                    "path": path,
                    "change_type": "unknown",
                    "additions": None,
                    "deletions": None,
                    "claimed_by_executor": True,
                    "observed_by_vcs": False,
                }
            )
        tasks_service.record_file_changes(conn, task_run_id=task_run.id, entries=entries_to_persist)

        if discrepant_claimed_only or (observed_paths - set(claimed_paths)):
            log_event(
                conn,
                type="task.claim_discrepancy",
                severity=EventSeverity.WARNING,
                project_id=project.id,
                task_id=task_id,
                task_run_id=task_run.id,
                payload={
                    "claimed_but_not_observed": discrepant_claimed_only,
                    "observed_but_not_claimed": sorted(observed_paths - set(claimed_paths)),
                },
            )

        run_status, task_status, failure_reason = _final_statuses(outcome)
        tasks_service.update_task_run(
            conn,
            task_run.id,
            status=run_status,
            ended_at=ended_at,
            structured_result=(outcome.structured_result.model_dump() if outcome.structured_result else None),
            stdout_path=str(stdout_path),
            stderr_path=str(stderr_path),
            failure_reason=failure_reason,
        )
        task = tasks_service.transition_task(conn, task_id, task_status)
        log_event(
            conn,
            type="task.finished",
            severity=EventSeverity.INFO if task_status == TaskStatus.COMPLETED else EventSeverity.WARNING,
            project_id=project.id,
            task_id=task_id,
            task_run_id=task_run.id,
            payload={"final_status": task_status.value},
        )
        return task
    finally:
        lock.release()


def _final_statuses(outcome) -> tuple[TaskRunStatus, TaskStatus, Optional[str]]:
    if outcome.run_status == "timed_out":
        return TaskRunStatus.TIMED_OUT, TaskStatus.FAILED, outcome.failure_reason
    if outcome.run_status == "cancelled":
        return TaskRunStatus.CANCELLED, TaskStatus.CANCELLED, outcome.failure_reason
    if outcome.run_status == "failed":
        return TaskRunStatus.FAILED, TaskStatus.FAILED, outcome.failure_reason
    # run_status == "completed" at the process level; still not verified
    # success unless we got a conforming, self-reported-successful result.
    if outcome.structured_result is None:
        return TaskRunStatus.FAILED, TaskStatus.FAILED, "Executor returned no valid structured result"
    if outcome.structured_result.status != "completed":
        return TaskRunStatus.FAILED, TaskStatus.FAILED, "Executor self-reported a non-completed status"
    return TaskRunStatus.COMPLETED, TaskStatus.COMPLETED, None


def keep_task_run(conn: sqlite3.Connection, *, task_run_id: str) -> None:
    task_run = tasks_service.get_task_run(conn, task_run_id)
    if task_run is None:
        raise OrchestratorError(f"Unknown task_run: {task_run_id}", event_type="run.not_found")
    if task_run.disposition != RunDisposition.PENDING:
        raise OrchestratorError(
            f"Task run {task_run_id} already has disposition {task_run.disposition}", event_type="run.disposition_conflict"
        )
    tasks_service.update_task_run(conn, task_run_id, disposition=RunDisposition.KEPT)
    checkpoint = tasks_service.get_checkpoint_for_run(conn, task_run_id=task_run_id)
    if checkpoint is not None:
        tasks_service.set_checkpoint_restore_status(conn, checkpoint.id, "kept")
    log_event(conn, type="task_run.kept", severity=EventSeverity.INFO, task_run_id=task_run_id)


def rollback_task_run(conn: sqlite3.Connection, *, task_run_id: str, router: ResourceRouter) -> None:
    task_run = tasks_service.get_task_run(conn, task_run_id)
    if task_run is None:
        raise OrchestratorError(f"Unknown task_run: {task_run_id}", event_type="run.not_found")
    if task_run.disposition != RunDisposition.PENDING:
        raise OrchestratorError(
            f"Task run {task_run_id} already has disposition {task_run.disposition}", event_type="run.disposition_conflict"
        )
    checkpoint = tasks_service.get_checkpoint_for_run(conn, task_run_id=task_run_id)
    if checkpoint is None:
        raise OrchestratorError(f"No checkpoint recorded for task_run {task_run_id}", event_type="run.no_checkpoint")

    task = tasks_service.get_task(conn, task_run.task_id)
    project = projects_service.get_project(conn, task.project_id)  # type: ignore[union-attr]
    workspace = projects_service.project_root(project)  # type: ignore[arg-type]
    vcs = router.select_vcs()

    ref = CheckpointRef(mechanism=checkpoint.mechanism, reference=checkpoint.reference)
    try:
        vcs.restore_checkpoint(workspace, ref)
    except RollbackError as exc:
        log_event(
            conn,
            type="task_run.rollback_failed",
            severity=EventSeverity.ERROR,
            task_run_id=task_run_id,
            payload={"error": str(exc)},
        )
        raise

    tasks_service.update_task_run(conn, task_run_id, disposition=RunDisposition.ROLLED_BACK)
    tasks_service.set_checkpoint_restore_status(conn, checkpoint.id, "restored")
    log_event(conn, type="task_run.rolled_back", severity=EventSeverity.INFO, task_run_id=task_run_id)


def cancel_task_run(conn: sqlite3.Connection, *, task_run_id: str, router: ResourceRouter) -> bool:
    ai_executor = router.select_ai_executor()
    signalled = ai_executor.cancel(task_run_id)
    log_event(
        conn,
        type="task_run.cancel_requested",
        severity=EventSeverity.INFO,
        task_run_id=task_run_id,
        payload={"signalled": signalled},
    )
    return signalled
