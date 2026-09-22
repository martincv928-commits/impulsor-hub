from __future__ import annotations

import threading
import time
from pathlib import Path

from app.adapters.ai.base import ExecuteOutcome
from app.core.orchestrator import orchestrator
from app.database.models import RunDisposition, TaskRunStatus, TaskStatus
from app.projects import service as projects_service
from app.tasks import service as tasks_service
from tests.fakes import FakeAIExecutorAdapter, FakeRouter


def _make_task(db_conn, repo_path: Path, objective: str = "make a change"):
    project = projects_service.add_project(db_conn, root_path=str(repo_path))
    task = tasks_service.create_task(db_conn, project_id=project.id, objective=objective)
    return project, task


def test_happy_path_completes_and_manifest_matches_claims(db_conn, fixture_repo):
    project, task = _make_task(db_conn, fixture_repo)

    def apply(workspace: Path):
        (workspace / "new_file.py").write_text("print('hi')\n")
        return (["new_file.py"], [], [])

    fake_ai = FakeAIExecutorAdapter(apply_fn=apply)
    router = FakeRouter(fake_ai)

    result_task = orchestrator.run_task(db_conn, task_id=task.id, router=router)

    assert result_task.status == TaskStatus.COMPLETED
    runs = tasks_service.list_task_runs(db_conn, task_id=task.id)
    assert len(runs) == 1
    run = runs[0]
    assert run.status == TaskRunStatus.COMPLETED
    assert run.disposition == RunDisposition.PENDING

    changes = tasks_service.list_file_changes(db_conn, task_run_id=run.id)
    assert len(changes) == 1
    assert changes[0].path == "new_file.py"
    assert changes[0].change_type == "created"
    assert changes[0].claimed_by_executor is True
    assert changes[0].observed_by_vcs is True


def test_discrepancy_detected_when_claim_and_observation_differ(db_conn, fixture_repo):
    project, task = _make_task(db_conn, fixture_repo)

    def apply(workspace: Path):
        # Actually creates two files but only claims one -> discrepancy.
        (workspace / "claimed.py").write_text("x = 1\n")
        (workspace / "unclaimed.py").write_text("y = 2\n")
        return (["claimed.py"], [], [])

    fake_ai = FakeAIExecutorAdapter(apply_fn=apply)
    router = FakeRouter(fake_ai)
    orchestrator.run_task(db_conn, task_id=task.id, router=router)

    run = tasks_service.list_task_runs(db_conn, task_id=task.id)[0]
    changes = {c.path: c for c in tasks_service.list_file_changes(db_conn, task_run_id=run.id)}
    assert changes["claimed.py"].claimed_by_executor is True
    assert changes["claimed.py"].observed_by_vcs is True
    assert changes["unclaimed.py"].claimed_by_executor is False
    assert changes["unclaimed.py"].observed_by_vcs is True

    events = [e["type"] for e in __import__("app.core.events.events", fromlist=["list_events"]).list_events(db_conn, task_id=task.id)]
    assert "task.claim_discrepancy" in events


def test_malformed_structured_result_marks_task_failed_not_completed(db_conn, fixture_repo):
    project, task = _make_task(db_conn, fixture_repo)
    outcome = ExecuteOutcome(
        run_status="completed",
        exit_code=0,
        stdout="not json",
        stderr="",
        structured_result=None,
        malformed_result_raw="not json",
    )
    fake_ai = FakeAIExecutorAdapter(outcome_override=outcome)
    router = FakeRouter(fake_ai)

    result_task = orchestrator.run_task(db_conn, task_id=task.id, router=router)

    assert result_task.status == TaskStatus.FAILED
    run = tasks_service.list_task_runs(db_conn, task_id=task.id)[0]
    assert run.status == TaskRunStatus.FAILED
    assert "malformed" in (run.failure_reason or "").lower() or "no valid structured result" in (run.failure_reason or "").lower()


def test_timeout_marks_task_failed(db_conn, fixture_repo):
    project, task = _make_task(db_conn, fixture_repo)
    outcome = ExecuteOutcome(
        run_status="timed_out",
        exit_code=None,
        stdout="",
        stderr="",
        structured_result=None,
        failure_reason="Execution exceeded timeout of 1s",
    )
    fake_ai = FakeAIExecutorAdapter(outcome_override=outcome)
    router = FakeRouter(fake_ai)

    result_task = orchestrator.run_task(db_conn, task_id=task.id, router=router)
    assert result_task.status == TaskStatus.FAILED
    run = tasks_service.list_task_runs(db_conn, task_id=task.id)[0]
    assert run.status == TaskRunStatus.TIMED_OUT


def test_dirty_repo_execution_still_proceeds_with_baseline_warning(db_conn, dirty_fixture_repo):
    project, task = _make_task(db_conn, dirty_fixture_repo)
    fake_ai = FakeAIExecutorAdapter(apply_fn=lambda ws: ([], [], []))
    router = FakeRouter(fake_ai)

    result_task = orchestrator.run_task(db_conn, task_id=task.id, router=router)
    assert result_task.status == TaskStatus.COMPLETED

    events_mod = __import__("app.core.events.events", fromlist=["list_events"])
    events = [e["type"] for e in events_mod.list_events(db_conn, task_id=task.id)]
    assert "task.dirty_repository_baseline" in events


def test_keep_marks_disposition_kept(db_conn, fixture_repo):
    project, task = _make_task(db_conn, fixture_repo)
    fake_ai = FakeAIExecutorAdapter(apply_fn=lambda ws: (_touch(ws), [], []))
    router = FakeRouter(fake_ai)
    orchestrator.run_task(db_conn, task_id=task.id, router=router)
    run = tasks_service.list_task_runs(db_conn, task_id=task.id)[0]

    orchestrator.keep_task_run(db_conn, task_run_id=run.id)

    updated = tasks_service.get_task_run(db_conn, run.id)
    assert updated.disposition == RunDisposition.KEPT
    assert (fixture_repo / "created_by_ai.txt").exists()


def test_rollback_restores_pre_task_state_including_dirty_work(db_conn, dirty_fixture_repo):
    project, task = _make_task(db_conn, dirty_fixture_repo, objective="mess things up")
    pre_content = (dirty_fixture_repo / "committed.txt").read_text()

    def apply(workspace: Path):
        (workspace / "committed.txt").write_text("AI overwrote it\n")
        (workspace / "ai_created.py").write_text("x=1\n")
        return (["ai_created.py"], ["committed.txt"], [])

    fake_ai = FakeAIExecutorAdapter(apply_fn=apply)
    router = FakeRouter(fake_ai)
    orchestrator.run_task(db_conn, task_id=task.id, router=router)
    run = tasks_service.list_task_runs(db_conn, task_id=task.id)[0]

    orchestrator.rollback_task_run(db_conn, task_run_id=run.id, router=router)

    assert (dirty_fixture_repo / "committed.txt").read_text() == pre_content
    assert not (dirty_fixture_repo / "ai_created.py").exists()
    assert (dirty_fixture_repo / "untracked_before.txt").exists()
    updated = tasks_service.get_task_run(db_conn, run.id)
    assert updated.disposition == RunDisposition.ROLLED_BACK


def test_dirty_file_re_edit_is_detected_with_no_false_discrepancy(db_conn, dirty_fixture_repo):
    """§7.1 fix at pipeline level: when Claude re-edits an already-dirty
    tracked file *and declares it*, the manifest must show it as observed
    (not just claimed), so no false claim-vs-reality discrepancy is raised."""
    project, task = _make_task(db_conn, dirty_fixture_repo, objective="edit notes and add a file")

    def apply(workspace: Path):
        with (workspace / "committed.txt").open("a") as f:
            f.write("AI added this line\n")
        (workspace / "new_by_ai.txt").write_text("hi\n")
        return (["new_by_ai.txt"], ["committed.txt"], [])

    fake_ai = FakeAIExecutorAdapter(apply_fn=apply)
    router = FakeRouter(fake_ai)
    orchestrator.run_task(db_conn, task_id=task.id, router=router)
    run = tasks_service.list_task_runs(db_conn, task_id=task.id)[0]

    changes = {c.path: c for c in tasks_service.list_file_changes(db_conn, task_run_id=run.id)}
    assert changes["committed.txt"].change_type == "modified"
    assert changes["committed.txt"].claimed_by_executor is True
    assert changes["committed.txt"].observed_by_vcs is True
    assert changes["new_by_ai.txt"].observed_by_vcs is True

    events = __import__("app.core.events.events", fromlist=["list_events"]).list_events(db_conn, task_id=task.id)
    assert not any(e["type"] == "task.claim_discrepancy" for e in events)


def test_keep_after_modifying_previously_dirty_file(db_conn, dirty_fixture_repo):
    project, task = _make_task(db_conn, dirty_fixture_repo, objective="edit notes")

    def apply(workspace: Path):
        with (workspace / "committed.txt").open("a") as f:
            f.write("AI added this line\n")
        return ([], ["committed.txt"], [])

    fake_ai = FakeAIExecutorAdapter(apply_fn=apply)
    router = FakeRouter(fake_ai)
    orchestrator.run_task(db_conn, task_id=task.id, router=router)
    run = tasks_service.list_task_runs(db_conn, task_id=task.id)[0]

    orchestrator.keep_task_run(db_conn, task_run_id=run.id)

    kept_content = (dirty_fixture_repo / "committed.txt").read_text()
    assert "user edit before task" in kept_content  # user's baseline survives
    assert "AI added this line" in kept_content  # task's accepted change survives
    assert (dirty_fixture_repo / "untracked_before.txt").exists()  # untouched pre-existing work survives
    updated = tasks_service.get_task_run(db_conn, run.id)
    assert updated.disposition == RunDisposition.KEPT


def test_rollback_after_modifying_previously_dirty_file_preserves_baseline_byte_for_byte(
    db_conn, dirty_fixture_repo
):
    project, task = _make_task(db_conn, dirty_fixture_repo, objective="edit notes and add a file")
    baseline_bytes = (dirty_fixture_repo / "committed.txt").read_bytes()
    untracked_baseline_bytes = (dirty_fixture_repo / "untracked_before.txt").read_bytes()

    def apply(workspace: Path):
        with (workspace / "committed.txt").open("ab") as f:
            f.write(b"AI added this line\n")
        (workspace / "ai_created.py").write_text("x = 1\n")
        return (["ai_created.py"], ["committed.txt"], [])

    fake_ai = FakeAIExecutorAdapter(apply_fn=apply)
    router = FakeRouter(fake_ai)
    orchestrator.run_task(db_conn, task_id=task.id, router=router)
    run = tasks_service.list_task_runs(db_conn, task_id=task.id)[0]

    # Sanity: the manifest did detect the re-edit before we roll it back.
    changes = {c.path for c in tasks_service.list_file_changes(db_conn, task_run_id=run.id)}
    assert "committed.txt" in changes

    orchestrator.rollback_task_run(db_conn, task_run_id=run.id, router=router)

    assert (dirty_fixture_repo / "committed.txt").read_bytes() == baseline_bytes
    assert (dirty_fixture_repo / "untracked_before.txt").read_bytes() == untracked_baseline_bytes
    assert not (dirty_fixture_repo / "ai_created.py").exists()


def test_keep_then_rollback_is_rejected(db_conn, fixture_repo):
    project, task = _make_task(db_conn, fixture_repo)
    fake_ai = FakeAIExecutorAdapter(apply_fn=lambda ws: ([], [], []))
    router = FakeRouter(fake_ai)
    orchestrator.run_task(db_conn, task_id=task.id, router=router)
    run = tasks_service.list_task_runs(db_conn, task_id=task.id)[0]

    orchestrator.keep_task_run(db_conn, task_run_id=run.id)
    try:
        orchestrator.rollback_task_run(db_conn, task_run_id=run.id, router=router)
        assert False, "expected OrchestratorError"
    except orchestrator.OrchestratorError:
        pass


def test_second_concurrent_run_is_blocked_by_project_lock(db_conn, fixture_repo):
    project = projects_service.add_project(db_conn, root_path=str(fixture_repo))
    task_a = tasks_service.create_task(db_conn, project_id=project.id, objective="A")
    task_b = tasks_service.create_task(db_conn, project_id=project.id, objective="B")

    block_until = threading.Event()
    fake_ai = FakeAIExecutorAdapter(block_until=block_until)
    router = FakeRouter(fake_ai)

    results = {}

    def run_a():
        results["a"] = orchestrator.run_task(db_conn, task_id=task_a.id, router=router)

    t = threading.Thread(target=run_a)
    t.start()
    time.sleep(0.2)  # let task_a proceed past LOCKING and hold the in-memory lock

    try:
        orchestrator.run_task(db_conn, task_id=task_b.id, router=router)
        blocked = False
    except orchestrator.ProjectLockedError:
        blocked = True
    finally:
        block_until.set()
        t.join(timeout=10)

    assert blocked is True
    assert results["a"].status == TaskStatus.COMPLETED


def _touch(workspace: Path) -> list[str]:
    (workspace / "created_by_ai.txt").write_text("hello\n")
    return ["created_by_ai.txt"]
