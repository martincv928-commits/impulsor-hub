"""Task execution pipeline (SPEC sections 3, 9, 15; M2 SPEC sections 5-12).

`local project -> task -> safe baseline -> Claude Code executor ->
independent file verification -> [Godot validation -> repair loop] ->
manifest -> user KEEP or ROLLBACK`

This module is the only place that wires adapters (via the router),
policy enforcement, event logging and task/task_run persistence together.
The API layer only calls functions here; it never talks to adapters
directly. The orchestrator only ever calls the generic `ValidatorAdapter`
interface -- it has no import of GodotAdapter and no idea Godot exists
(M2 SPEC section 1).
"""
from __future__ import annotations

import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from app.adapters.ai.base import ExecuteOutcome, ExecuteRequest
from app.adapters.validator.base import ValidationIssue, ValidationResult, ValidationStatus
from app.adapters.vcs.base import (
    CheckpointRef,
    RepositoryNotFoundError,
    RollbackError,
    VcsNotAvailableError,
)
from app.core.events.events import log_event
from app.core.permissions.policy import (
    RESULT_SCHEMA_INSTRUCTION,
    build_repair_envelope,
    impulsor_metadata_dir,
)
from app.core.router.router import ResourceRouter
from app.database.models import EventSeverity, RunDisposition, Task, TaskRunStatus, TaskStatus
from app.projects import service as projects_service
from app.tasks import service as tasks_service

DEFAULT_TIMEOUT_SECONDS = 600
DEFAULT_VALIDATION_TIMEOUT_SECONDS = 120
MAX_REPAIR_ATTEMPTS = 2

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


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def run_task(
    conn: sqlite3.Connection,
    *,
    task_id: str,
    router: ResourceRouter,
    timeout_seconds: int = DEFAULT_TIMEOUT_SECONDS,
    validation_timeout_seconds: int = DEFAULT_VALIDATION_TIMEOUT_SECONDS,
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
    validator = router.select_validator()
    project_wants_validation = project.project_type == "godot" and validator.supports(workspace)

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
        # The checkpoint above is the ONLY one created for this task's entire
        # lifecycle -- repairs (below) never create a new one. It is the sole
        # source of ROLLBACK and of the final manifest, however many repair
        # attempts happen (M2 SPEC sections 11-12).

        task = tasks_service.transition_task(conn, task_id, TaskStatus.RUNNING)
        tasks_service.update_task_run(conn, task_run.id, status=TaskRunStatus.RUNNING, started_at=_now())
        conn.commit()  # must be visible before the (potentially minutes-long) blocking call below

        logs_dir = impulsor_metadata_dir(workspace) / "logs" / task_run.id
        outcome = _execute_attempt(
            conn,
            project=project,
            task=task,
            task_run_id=task_run.id,
            ai_executor=ai_executor,
            workspace=workspace,
            objective=task.objective,
            timeout_seconds=timeout_seconds,
            logs_dir=logs_dir,
            attempt=0,
            kind="initial",
        )

        claimed_paths: dict[str, bool] = {}
        _accumulate_claims(claimed_paths, outcome)

        task = tasks_service.transition_task(conn, task_id, TaskStatus.VERIFYING)

        final_validation: Optional[ValidationResult] = None
        repair_attempts_used = 0
        final_outcome = outcome

        if project_wants_validation and outcome.run_status == "completed":
            health = validator.health_check()
            log_event(
                conn,
                type="validator.detected" if health.get("available") else "validator.unavailable",
                severity=EventSeverity.INFO if health.get("available") else EventSeverity.WARNING,
                project_id=project.id,
                task_id=task_id,
                task_run_id=task_run.id,
                payload={"validator": "godot", "health": health},
            )

            attempt = 0
            while True:
                manifest = vcs.compute_change_manifest(workspace, ref)
                validation_result = validator.validate(
                    workspace, run_id=task_run.id, timeout_seconds=validation_timeout_seconds
                )
                final_validation = validation_result
                _log_validation_event(conn, project=project, task_id=task_id, task_run_id=task_run.id, attempt=attempt, result=validation_result)

                if validation_result.status == ValidationStatus.PASS:
                    break
                if validation_result.status in (ValidationStatus.ERROR, ValidationStatus.TIMEOUT):
                    break  # validator infra issue, not a repairable code problem
                if attempt >= MAX_REPAIR_ATTEMPTS:
                    log_event(
                        conn,
                        type="repair.exhausted",
                        severity=EventSeverity.WARNING,
                        project_id=project.id,
                        task_id=task_id,
                        task_run_id=task_run.id,
                        payload={"max_repair_attempts": MAX_REPAIR_ATTEMPTS},
                    )
                    break

                attempt += 1
                repair_attempts_used = attempt
                modified_files = sorted({e.path for e in manifest.entries})
                repair_prompt = build_repair_envelope(
                    task_id=task_id,
                    workspace=workspace,
                    objective=task.objective,
                    attempt=attempt,
                    max_attempts=MAX_REPAIR_ATTEMPTS,
                    validator_name=validation_result.validator,
                    validation_status=validation_result.status.value,
                    errors=[_format_issue(e) for e in validation_result.errors],
                    warnings=[_format_issue(w) for w in validation_result.warnings],
                    modified_files=modified_files,
                ) + "\n" + RESULT_SCHEMA_INSTRUCTION
                log_event(
                    conn,
                    type="repair.started",
                    severity=EventSeverity.INFO,
                    project_id=project.id,
                    task_id=task_id,
                    task_run_id=task_run.id,
                    payload={"attempt": attempt, "error_count": len(validation_result.errors)},
                )
                conn.commit()

                final_outcome = _execute_attempt(
                    conn,
                    project=project,
                    task=task,
                    task_run_id=task_run.id,
                    ai_executor=ai_executor,
                    workspace=workspace,
                    objective=task.objective,
                    timeout_seconds=timeout_seconds,
                    logs_dir=logs_dir,
                    attempt=attempt,
                    kind="repair",
                    full_prompt_override=repair_prompt,
                )
                _accumulate_claims(claimed_paths, final_outcome)
                log_event(
                    conn,
                    type="repair.finished",
                    severity=EventSeverity.INFO,
                    project_id=project.id,
                    task_id=task_id,
                    task_run_id=task_run.id,
                    payload={"attempt": attempt, "run_status": final_outcome.run_status},
                )
                # Loop back: re-observe real changes, then re-validate --
                # regardless of whether the repair's own self-report was
                # clean, since Godot has authority over its own domain.

        # Final manifest/claims: ALWAYS checkpoint vs final state, computed
        # once here -- never an incremental "vs last repair" diff (M2 SPEC
        # section 12). For a non-Godot project this is exactly M1's manifest.
        manifest = vcs.compute_change_manifest(workspace, ref)
        _persist_manifest_and_discrepancies(
            conn, project=project, task_id=task_id, task_run_id=task_run.id, manifest=manifest, claimed_paths=claimed_paths
        )

        run_status, task_status, failure_reason, validation_status_value = _final_statuses(
            final_outcome, validation=final_validation, repair_attempts_used=repair_attempts_used
        )
        tasks_service.update_task_run(
            conn,
            task_run.id,
            status=run_status,
            ended_at=_now(),
            structured_result=(final_outcome.structured_result.model_dump() if final_outcome.structured_result else None),
            failure_reason=failure_reason,
            validation_status=validation_status_value,
        )
        task = tasks_service.transition_task(conn, task_id, task_status)
        log_event(
            conn,
            type="task.finished",
            severity=EventSeverity.INFO if task_status == TaskStatus.COMPLETED else EventSeverity.WARNING,
            project_id=project.id,
            task_id=task_id,
            task_run_id=task_run.id,
            payload={"final_status": task_status.value, "validation_status": validation_status_value, "repair_attempts_used": repair_attempts_used},
        )
        return task
    finally:
        lock.release()


def _execute_attempt(
    conn: sqlite3.Connection,
    *,
    project,
    task,
    task_run_id: str,
    ai_executor,
    workspace: Path,
    objective: str,
    timeout_seconds: int,
    logs_dir: Path,
    attempt: int,
    kind: str,
    full_prompt_override: Optional[str] = None,
) -> ExecuteOutcome:
    """Run one executor invocation (the initial execution, or one repair
    attempt) and log/persist everything about it. Returns the outcome;
    callers decide what it means for the pipeline."""
    log_event(
        conn,
        type="task.execution_started",
        severity=EventSeverity.INFO,
        project_id=project.id,
        task_id=task.id,
        task_run_id=task_run_id,
        payload={"attempt": attempt, "kind": kind},
    )
    conn.commit()

    outcome = ai_executor.execute(
        ExecuteRequest(
            task_id=task.id,
            run_id=task_run_id,
            workspace=workspace,
            objective=objective,
            timeout_seconds=timeout_seconds,
            full_prompt_override=full_prompt_override,
        )
    )

    logs_dir.mkdir(parents=True, exist_ok=True)
    stdout_path = logs_dir / f"attempt_{attempt}_stdout.log"
    stderr_path = logs_dir / f"attempt_{attempt}_stderr.log"
    stdout_path.write_text(outcome.stdout)
    stderr_path.write_text(outcome.stderr)
    tasks_service.update_task_run(conn, task_run_id, stdout_path=str(stdout_path), stderr_path=str(stderr_path))

    log_event(
        conn,
        type="task.execution_finished",
        severity=EventSeverity.INFO,
        project_id=project.id,
        task_id=task.id,
        task_run_id=task_run_id,
        payload={
            "attempt": attempt,
            "kind": kind,
            "run_status": outcome.run_status,
            "exit_code": outcome.exit_code,
            "warnings": outcome.warnings,
            "stdout_path": str(stdout_path),
            "stderr_path": str(stderr_path),
        },
    )
    if outcome.malformed_result_raw is not None:
        log_event(
            conn,
            type="task.malformed_executor_result",
            severity=EventSeverity.WARNING,
            project_id=project.id,
            task_id=task.id,
            task_run_id=task_run_id,
            payload={"attempt": attempt, "raw": outcome.malformed_result_raw[:2000]},
        )
    conn.commit()
    return outcome


def _accumulate_claims(claimed_paths: dict[str, bool], outcome: ExecuteOutcome) -> None:
    if outcome.structured_result is None:
        return
    for p in outcome.structured_result.files_claimed_created:
        claimed_paths[p] = True
    for p in outcome.structured_result.files_claimed_modified:
        claimed_paths[p] = True
    for p in outcome.structured_result.files_claimed_deleted:
        claimed_paths[p] = True


def _persist_manifest_and_discrepancies(
    conn: sqlite3.Connection, *, project, task_id: str, task_run_id: str, manifest, claimed_paths: dict[str, bool]
) -> None:
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
    tasks_service.record_file_changes(conn, task_run_id=task_run_id, entries=entries_to_persist)

    if discrepant_claimed_only or (observed_paths - set(claimed_paths)):
        log_event(
            conn,
            type="task.claim_discrepancy",
            severity=EventSeverity.WARNING,
            project_id=project.id,
            task_id=task_id,
            task_run_id=task_run_id,
            payload={
                "claimed_but_not_observed": discrepant_claimed_only,
                "observed_but_not_claimed": sorted(observed_paths - set(claimed_paths)),
            },
        )


def _log_validation_event(conn: sqlite3.Connection, *, project, task_id: str, task_run_id: str, attempt: int, result: ValidationResult) -> None:
    type_by_status = {
        ValidationStatus.PASS: "validation.passed",
        ValidationStatus.FAIL: "validation.failed",
        ValidationStatus.ERROR: "validation.error",
        ValidationStatus.TIMEOUT: "validation.timeout",
    }
    severity = EventSeverity.INFO if result.status == ValidationStatus.PASS else EventSeverity.WARNING
    log_event(
        conn,
        type=type_by_status[result.status],
        severity=severity,
        project_id=project.id,
        task_id=task_id,
        task_run_id=task_run_id,
        payload={
            "attempt": attempt,
            "validator": result.validator,
            "status": result.status.value,
            "summary": result.summary,
            "duration_ms": result.duration_ms,
            "error_count": len(result.errors),
            "errors": [_issue_dict(e) for e in result.errors[:20]],
            "warning_count": len(result.warnings),
        },
    )
    conn.commit()


def _issue_dict(issue: ValidationIssue) -> dict:
    return {"file": issue.file, "line": issue.line, "message": issue.message}


def _format_issue(issue: ValidationIssue) -> str:
    loc = f"{issue.file}:{issue.line}" if issue.file and issue.line else (issue.file or "")
    return f"{loc}: {issue.message}" if loc else issue.message


def _final_statuses(
    outcome: ExecuteOutcome, *, validation: Optional[ValidationResult], repair_attempts_used: int
) -> tuple[TaskRunStatus, TaskStatus, Optional[str], Optional[str]]:
    """Returns (task_run_status, task_status, failure_reason, validation_status_value)."""
    if outcome.run_status == "timed_out":
        return TaskRunStatus.TIMED_OUT, TaskStatus.FAILED, outcome.failure_reason, None
    if outcome.run_status == "cancelled":
        return TaskRunStatus.CANCELLED, TaskStatus.CANCELLED, outcome.failure_reason, None
    if outcome.run_status == "failed":
        return TaskRunStatus.FAILED, TaskStatus.FAILED, outcome.failure_reason, None

    if validation is not None:
        # An external validator was applicable and ran: it has authority
        # over the task's technical outcome (M2 SPEC section 5) -- a PASS
        # is decisive even if the *last* executor self-report was malformed,
        # since the manifest/discrepancy machinery already captured whatever
        # was claimed across every attempt independent of this gate.
        if validation.status == ValidationStatus.PASS:
            return TaskRunStatus.COMPLETED, TaskStatus.COMPLETED, None, "pass"
        if validation.status == ValidationStatus.FAIL:
            reason = f"Validation failed after {repair_attempts_used} repair attempt(s); repair attempts exhausted"
            return TaskRunStatus.FAILED, TaskStatus.FAILED, reason, "fail"
        # ERROR / TIMEOUT: distinct from a code FAIL -- the validator itself
        # didn't produce a verdict (M2 SPEC section 9D).
        reason = f"Validator {validation.status.value}: {validation.summary}"
        return TaskRunStatus.FAILED, TaskStatus.FAILED, reason, validation.status.value

    # No validator applicable (non-Godot project, or Godot project whose
    # initial execution didn't even complete): identical to M1.
    if outcome.structured_result is None:
        return TaskRunStatus.FAILED, TaskStatus.FAILED, "Executor returned no valid structured result", None
    if outcome.structured_result.status != "completed":
        return TaskRunStatus.FAILED, TaskStatus.FAILED, "Executor self-reported a non-completed status", None
    return TaskRunStatus.COMPLETED, TaskStatus.COMPLETED, None, None


def keep_task_run(conn: sqlite3.Connection, *, task_run_id: str, override: bool = False) -> None:
    task_run = tasks_service.get_task_run(conn, task_run_id)
    if task_run is None:
        raise OrchestratorError(f"Unknown task_run: {task_run_id}", event_type="run.not_found")
    if task_run.disposition != RunDisposition.PENDING:
        raise OrchestratorError(
            f"Task run {task_run_id} already has disposition {task_run.disposition}", event_type="run.disposition_conflict"
        )
    validation_blocks_keep = task_run.validation_status is not None and task_run.validation_status != "pass"
    if validation_blocks_keep and not override:
        raise OrchestratorError(
            f"Cannot KEEP: validation status is '{task_run.validation_status}', not 'pass'. "
            "An explicit override is required to keep changes that failed validation.",
            event_type="run.keep_blocked_by_validation",
        )
    tasks_service.update_task_run(conn, task_run_id, disposition=RunDisposition.KEPT)
    checkpoint = tasks_service.get_checkpoint_for_run(conn, task_run_id=task_run_id)
    if checkpoint is not None:
        tasks_service.set_checkpoint_restore_status(conn, checkpoint.id, "kept")
    event_type = "task_run.kept_with_override" if (validation_blocks_keep and override) else "task_run.kept"
    log_event(
        conn,
        type=event_type,
        severity=EventSeverity.WARNING if event_type == "task_run.kept_with_override" else EventSeverity.INFO,
        task_run_id=task_run_id,
        payload={"validation_status": task_run.validation_status, "override": override},
    )


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

    # Always the ORIGINAL pre-task checkpoint (never a repair's state) --
    # there is only ever one checkpoint per task_run (M2 SPEC section 11).
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
