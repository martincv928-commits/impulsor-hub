"""Pipeline-level tests for the M2 validation + repair loop (SPEC section
6). Uses FakeAIExecutorAdapter + FakeValidatorAdapter for speed/determinism
-- the real Godot binary is exercised separately in test_godot_adapter.py
and in the real E2E scenarios (docs/e2e/). Real GitAdapter is still used
throughout, so checkpoint/rollback/manifest correctness is genuine."""
from __future__ import annotations

from pathlib import Path

from app.adapters.validator.base import ValidationIssue, ValidationResult, ValidationStatus
from app.core.events.events import list_events
from app.core.orchestrator import orchestrator
from app.database.models import RunDisposition, TaskStatus
from app.projects import service as projects_service
from app.tasks import service as tasks_service
from tests.fakes import FakeAIExecutorAdapter, FakeRouter, FakeValidatorAdapter


def _make_godot_task(db_conn, repo_path: Path, objective: str = "make a change"):
    project = projects_service.add_project(db_conn, root_path=str(repo_path))
    assert project.project_type == "godot"
    task = tasks_service.create_task(db_conn, project_id=project.id, objective=objective)
    return project, task


def _result(status: ValidationStatus, *, errors=None, summary="") -> ValidationResult:
    return ValidationResult(
        validator="godot",
        status=status,
        exit_code=0 if status == ValidationStatus.PASS else 1,
        duration_ms=5,
        command="fake godot --check-only",
        summary=summary or status.value,
        errors=errors or [],
    )


def _fail(msg: str) -> ValidationResult:
    return _result(ValidationStatus.FAIL, errors=[ValidationIssue(message=msg, file="main.gd", line=3)], summary=f"1 error: {msg}")


# 11. PASS inicial -> no repair.
def test_initial_pass_needs_no_repair(db_conn, godot_fixture_repo):
    project, task = _make_godot_task(db_conn, godot_fixture_repo)
    fake_ai = FakeAIExecutorAdapter(apply_fn=lambda ws: (_touch(ws, "a.txt"), [], []))
    fake_validator = FakeValidatorAdapter(result=_result(ValidationStatus.PASS))
    router = FakeRouter(fake_ai, fake_validator)

    result_task = orchestrator.run_task(db_conn, task_id=task.id, router=router)

    assert result_task.status == TaskStatus.COMPLETED
    assert fake_ai.call_count == 1
    run = tasks_service.list_task_runs(db_conn, task_id=task.id)[0]
    assert run.validation_status == "pass"
    events = list_events(db_conn, task_id=task.id)
    assert not any(e["type"].startswith("repair.") for e in events)


# 12. FAIL -> repair -> PASS.
def test_fail_then_repair_then_pass(db_conn, godot_fixture_repo):
    project, task = _make_godot_task(db_conn, godot_fixture_repo)
    fake_ai = FakeAIExecutorAdapter(
        sequenced_apply_fns=[lambda ws: (_touch(ws, "a.txt"), [], []), lambda ws: (_touch(ws, "fix.txt"), [], [])]
    )
    fake_validator = FakeValidatorAdapter(sequenced_results=[_fail("parse error"), _result(ValidationStatus.PASS)])
    router = FakeRouter(fake_ai, fake_validator)

    result_task = orchestrator.run_task(db_conn, task_id=task.id, router=router)

    assert result_task.status == TaskStatus.COMPLETED
    assert fake_ai.call_count == 2
    run = tasks_service.list_task_runs(db_conn, task_id=task.id)[0]
    assert run.validation_status == "pass"
    events = list_events(db_conn, task_id=task.id)
    repair_started = [e for e in events if e["type"] == "repair.started"]
    assert len(repair_started) == 1
    assert repair_started[0]["payload"]["attempt"] == 1
    # The repair prompt must clearly mark itself as a repair, not a new task.
    assert "REPAIR ATTEMPT" in fake_ai.requests[1].full_prompt_override
    assert "parse error" in fake_ai.requests[1].full_prompt_override


# 13. FAIL -> repair FAIL -> repair PASS.
def test_fail_repair_fail_repair_pass(db_conn, godot_fixture_repo):
    project, task = _make_godot_task(db_conn, godot_fixture_repo)
    fake_ai = FakeAIExecutorAdapter(
        sequenced_apply_fns=[
            lambda ws: (_touch(ws, "a.txt"), [], []),
            lambda ws: (_touch(ws, "b.txt"), [], []),
            lambda ws: (_touch(ws, "c.txt"), [], []),
        ]
    )
    fake_validator = FakeValidatorAdapter(
        sequenced_results=[_fail("error 1"), _fail("error 2"), _result(ValidationStatus.PASS)]
    )
    router = FakeRouter(fake_ai, fake_validator)

    result_task = orchestrator.run_task(db_conn, task_id=task.id, router=router)

    assert result_task.status == TaskStatus.COMPLETED
    assert fake_ai.call_count == 3
    events = list_events(db_conn, task_id=task.id)
    repair_attempts = sorted(e["payload"]["attempt"] for e in events if e["type"] == "repair.started")
    assert repair_attempts == [1, 2]


# 14. FAIL -> repair FAIL -> repair FAIL -> exhausted.
# 15. nunca superar MAX_REPAIR_ATTEMPTS.
def test_repairs_exhausted_never_exceeds_max_attempts(db_conn, godot_fixture_repo):
    project, task = _make_godot_task(db_conn, godot_fixture_repo)
    fake_ai = FakeAIExecutorAdapter(apply_fn=lambda ws: (_touch(ws, "a.txt"), [], []))
    fake_validator = FakeValidatorAdapter(result=_fail("still broken"))
    router = FakeRouter(fake_ai, fake_validator)

    result_task = orchestrator.run_task(db_conn, task_id=task.id, router=router)

    assert result_task.status == TaskStatus.FAILED
    assert fake_ai.call_count == 1 + orchestrator.MAX_REPAIR_ATTEMPTS
    run = tasks_service.list_task_runs(db_conn, task_id=task.id)[0]
    assert run.validation_status == "fail"
    assert "exhausted" in (run.failure_reason or "").lower()
    events = list_events(db_conn, task_id=task.id)
    assert len([e for e in events if e["type"] == "repair.started"]) == orchestrator.MAX_REPAIR_ATTEMPTS
    assert any(e["type"] == "repair.exhausted" for e in events)
    # ROLLBACK must still be possible after exhaustion.
    orchestrator.rollback_task_run(db_conn, task_run_id=run.id, router=router)
    assert tasks_service.get_task_run(db_conn, run.id).disposition == RunDisposition.ROLLED_BACK


# 16. rollback después de repair.
def test_rollback_after_single_repair_removes_files_from_both_attempts(db_conn, godot_fixture_repo):
    project, task = _make_godot_task(db_conn, godot_fixture_repo)
    fake_ai = FakeAIExecutorAdapter(
        sequenced_apply_fns=[lambda ws: (_touch(ws, "from_initial.txt"), [], []), lambda ws: (_touch(ws, "from_repair.txt"), [], [])]
    )
    fake_validator = FakeValidatorAdapter(sequenced_results=[_fail("x"), _result(ValidationStatus.PASS)])
    router = FakeRouter(fake_ai, fake_validator)
    orchestrator.run_task(db_conn, task_id=task.id, router=router)
    run = tasks_service.list_task_runs(db_conn, task_id=task.id)[0]

    orchestrator.rollback_task_run(db_conn, task_run_id=run.id, router=router)

    assert not (godot_fixture_repo / "from_initial.txt").exists()
    assert not (godot_fixture_repo / "from_repair.txt").exists()


# 17. rollback después de múltiples repairs.
def test_rollback_after_multiple_repairs_removes_files_from_every_attempt(db_conn, godot_fixture_repo):
    project, task = _make_godot_task(db_conn, godot_fixture_repo)
    fake_ai = FakeAIExecutorAdapter(
        sequenced_apply_fns=[
            lambda ws: (_touch(ws, "f0.txt"), [], []),
            lambda ws: (_touch(ws, "f1.txt"), [], []),
            lambda ws: (_touch(ws, "f2.txt"), [], []),
        ]
    )
    fake_validator = FakeValidatorAdapter(sequenced_results=[_fail("a"), _fail("b"), _result(ValidationStatus.PASS)])
    router = FakeRouter(fake_ai, fake_validator)
    orchestrator.run_task(db_conn, task_id=task.id, router=router)
    run = tasks_service.list_task_runs(db_conn, task_id=task.id)[0]

    orchestrator.rollback_task_run(db_conn, task_run_id=run.id, router=router)

    for name in ("f0.txt", "f1.txt", "f2.txt"):
        assert not (godot_fixture_repo / name).exists()


# 18. dirty baseline preservado después de repair + rollback.
def test_dirty_baseline_preserved_after_repair_and_rollback(db_conn, dirty_godot_fixture_repo):
    project, task = _make_godot_task(db_conn, dirty_godot_fixture_repo)
    pre_task_main_gd = (dirty_godot_fixture_repo / "main.gd").read_bytes()
    pre_task_untracked = (dirty_godot_fixture_repo / "untracked_before.txt").read_bytes()

    def initial(ws: Path):
        with (ws / "main.gd").open("a") as f:
            f.write("# initial attempt broke something\n")
        return ([], ["main.gd"], [])

    def repair(ws: Path):
        with (ws / "main.gd").open("a") as f:
            f.write("# repair attempt made it worse\n")
        (ws / "ai_created.gd").write_text("extends Node\n")
        return (["ai_created.gd"], ["main.gd"], [])

    fake_ai = FakeAIExecutorAdapter(sequenced_apply_fns=[initial, repair])
    fake_validator = FakeValidatorAdapter(sequenced_results=[_fail("still broken"), _result(ValidationStatus.PASS)])
    router = FakeRouter(fake_ai, fake_validator)
    orchestrator.run_task(db_conn, task_id=task.id, router=router)
    run = tasks_service.list_task_runs(db_conn, task_id=task.id)[0]

    orchestrator.rollback_task_run(db_conn, task_run_id=run.id, router=router)

    assert (dirty_godot_fixture_repo / "main.gd").read_bytes() == pre_task_main_gd
    assert (dirty_godot_fixture_repo / "untracked_before.txt").read_bytes() == pre_task_untracked
    assert not (dirty_godot_fixture_repo / "ai_created.gd").exists()


# 19. manifest final representa checkpoint original vs estado final.
def test_final_manifest_reflects_checkpoint_vs_final_state_not_just_last_repair(db_conn, godot_fixture_repo):
    project, task = _make_godot_task(db_conn, godot_fixture_repo)
    fake_ai = FakeAIExecutorAdapter(
        sequenced_apply_fns=[lambda ws: (_touch(ws, "from_initial.txt"), [], []), lambda ws: (_touch(ws, "from_repair.txt"), [], [])]
    )
    fake_validator = FakeValidatorAdapter(sequenced_results=[_fail("x"), _result(ValidationStatus.PASS)])
    router = FakeRouter(fake_ai, fake_validator)
    orchestrator.run_task(db_conn, task_id=task.id, router=router)
    run = tasks_service.list_task_runs(db_conn, task_id=task.id)[0]

    changes = {c.path for c in tasks_service.list_file_changes(db_conn, task_run_id=run.id)}
    assert "from_initial.txt" in changes
    assert "from_repair.txt" in changes


# 20. KEEP permitido después de PASS.
def test_keep_allowed_after_pass(db_conn, godot_fixture_repo):
    project, task = _make_godot_task(db_conn, godot_fixture_repo)
    fake_ai = FakeAIExecutorAdapter(apply_fn=lambda ws: (_touch(ws, "a.txt"), [], []))
    fake_validator = FakeValidatorAdapter(result=_result(ValidationStatus.PASS))
    router = FakeRouter(fake_ai, fake_validator)
    orchestrator.run_task(db_conn, task_id=task.id, router=router)
    run = tasks_service.list_task_runs(db_conn, task_id=task.id)[0]

    orchestrator.keep_task_run(db_conn, task_run_id=run.id)

    assert tasks_service.get_task_run(db_conn, run.id).disposition == RunDisposition.KEPT


# 21. fallo de validación no se convierte silenciosamente en COMPLETED validado.
def test_validation_failure_never_silently_becomes_completed(db_conn, godot_fixture_repo):
    project, task = _make_godot_task(db_conn, godot_fixture_repo)
    fake_ai = FakeAIExecutorAdapter(apply_fn=lambda ws: (_touch(ws, "a.txt"), [], []))
    fake_validator = FakeValidatorAdapter(result=_fail("still broken"))
    router = FakeRouter(fake_ai, fake_validator)

    result_task = orchestrator.run_task(db_conn, task_id=task.id, router=router)
    assert result_task.status == TaskStatus.FAILED

    run = tasks_service.list_task_runs(db_conn, task_id=task.id)[0]
    try:
        orchestrator.keep_task_run(db_conn, task_run_id=run.id)
        assert False, "expected KEEP to be blocked without an explicit override"
    except orchestrator.OrchestratorError:
        pass

    # An explicit override IS allowed, and is itself recorded distinctly.
    orchestrator.keep_task_run(db_conn, task_run_id=run.id, override=True)
    events = list_events(db_conn, task_run_id=run.id)
    assert any(e["type"] == "task_run.kept_with_override" for e in events)


# 22. proyecto no-Godot conserva comportamiento M1.
def test_non_godot_project_keeps_m1_behavior(db_conn, fixture_repo):
    project = projects_service.add_project(db_conn, root_path=str(fixture_repo))
    assert project.project_type == "generic"
    task = tasks_service.create_task(db_conn, project_id=project.id, objective="plain m1 task")
    fake_ai = FakeAIExecutorAdapter(apply_fn=lambda ws: (_touch(ws, "a.txt"), [], []))
    # A validator that WOULD fail everything, to prove it's never even asked.
    fake_validator = FakeValidatorAdapter(result=_fail("should never be consulted"))
    router = FakeRouter(fake_ai, fake_validator)

    result_task = orchestrator.run_task(db_conn, task_id=task.id, router=router)

    assert result_task.status == TaskStatus.COMPLETED
    assert fake_validator.call_count == 0
    run = tasks_service.list_task_runs(db_conn, task_id=task.id)[0]
    assert run.validation_status is None


# 23. Claude claim sigue comparándose con cambios reales.
def test_claim_vs_reality_discrepancy_still_detected_in_godot_pipeline(db_conn, godot_fixture_repo):
    project, task = _make_godot_task(db_conn, godot_fixture_repo)

    def apply(ws: Path):
        _touch(ws, "claimed.txt")
        _touch(ws, "unclaimed.txt")
        return (["claimed.txt"], [], [])  # unclaimed.txt is NOT declared

    fake_ai = FakeAIExecutorAdapter(apply_fn=apply)
    fake_validator = FakeValidatorAdapter(result=_result(ValidationStatus.PASS))
    router = FakeRouter(fake_ai, fake_validator)

    orchestrator.run_task(db_conn, task_id=task.id, router=router)
    run = tasks_service.list_task_runs(db_conn, task_id=task.id)[0]
    changes = {c.path: c for c in tasks_service.list_file_changes(db_conn, task_run_id=run.id)}
    assert changes["unclaimed.txt"].claimed_by_executor is False
    assert changes["unclaimed.txt"].observed_by_vcs is True
    events = list_events(db_conn, task_id=task.id)
    assert any(e["type"] == "task.claim_discrepancy" for e in events)


# 24. checkpoint original no cambia durante repairs.
def test_checkpoint_is_created_exactly_once_even_with_repairs(db_conn, godot_fixture_repo):
    project, task = _make_godot_task(db_conn, godot_fixture_repo)
    fake_ai = FakeAIExecutorAdapter(
        sequenced_apply_fns=[
            lambda ws: (_touch(ws, "f0.txt"), [], []),
            lambda ws: (_touch(ws, "f1.txt"), [], []),
            lambda ws: (_touch(ws, "f2.txt"), [], []),
        ]
    )
    fake_validator = FakeValidatorAdapter(sequenced_results=[_fail("a"), _fail("b"), _result(ValidationStatus.PASS)])
    router = FakeRouter(fake_ai, fake_validator)
    orchestrator.run_task(db_conn, task_id=task.id, router=router)
    run = tasks_service.list_task_runs(db_conn, task_id=task.id)[0]

    events = list_events(db_conn, task_run_id=run.id)
    checkpoint_events = [e for e in events if e["type"] == "task.checkpoint_created"]
    assert len(checkpoint_events) == 1

    checkpoint = tasks_service.get_checkpoint_for_run(db_conn, task_run_id=run.id)
    assert checkpoint is not None
    # The checkpoint reference recorded at creation time is what ROLLBACK
    # will use; nothing in the repair loop is allowed to replace it.
    checkpoint_ref_snapshot = checkpoint.reference
    orchestrator.rollback_task_run(db_conn, task_run_id=run.id, router=router)
    checkpoint_after = tasks_service.get_checkpoint_for_run(db_conn, task_run_id=run.id)
    assert checkpoint_after.reference == checkpoint_ref_snapshot


def _touch(workspace: Path, name: str) -> list[str]:
    (workspace / name).write_text("content\n")
    return [name]
