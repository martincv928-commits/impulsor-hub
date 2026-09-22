from __future__ import annotations

import pytest

from app.database.models import TaskStatus
from app.projects import service as projects_service
from app.tasks import service as tasks_service


def test_create_and_get_task(db_conn, fixture_repo):
    project = projects_service.add_project(db_conn, root_path=str(fixture_repo))
    task = tasks_service.create_task(db_conn, project_id=project.id, objective="do something")
    assert task.status == TaskStatus.CREATED
    fetched = tasks_service.get_task(db_conn, task.id)
    assert fetched.id == task.id


def test_valid_transition_sequence(db_conn, fixture_repo):
    project = projects_service.add_project(db_conn, root_path=str(fixture_repo))
    task = tasks_service.create_task(db_conn, project_id=project.id, objective="x")
    for status in [
        TaskStatus.VALIDATING,
        TaskStatus.READY,
        TaskStatus.LOCKING,
        TaskStatus.CHECKPOINTING,
        TaskStatus.RUNNING,
        TaskStatus.VERIFYING,
        TaskStatus.COMPLETED,
    ]:
        task = tasks_service.transition_task(db_conn, task.id, status)
        assert task.status == status


def test_illegal_transition_rejected(db_conn, fixture_repo):
    project = projects_service.add_project(db_conn, root_path=str(fixture_repo))
    task = tasks_service.create_task(db_conn, project_id=project.id, objective="x")
    with pytest.raises(tasks_service.InvalidTransitionError):
        tasks_service.transition_task(db_conn, task.id, TaskStatus.COMPLETED)


def test_terminal_states_have_no_outgoing_transitions(db_conn, fixture_repo):
    project = projects_service.add_project(db_conn, root_path=str(fixture_repo))
    task = tasks_service.create_task(db_conn, project_id=project.id, objective="x")
    tasks_service.transition_task(db_conn, task.id, TaskStatus.CANCELLED)
    with pytest.raises(tasks_service.InvalidTransitionError):
        tasks_service.transition_task(db_conn, task.id, TaskStatus.RUNNING)


def test_has_active_task_detects_in_flight_states(db_conn, fixture_repo):
    project = projects_service.add_project(db_conn, root_path=str(fixture_repo))
    task = tasks_service.create_task(db_conn, project_id=project.id, objective="x")
    assert tasks_service.has_active_task(db_conn, project_id=project.id) is False
    tasks_service.transition_task(db_conn, task.id, TaskStatus.VALIDATING)
    tasks_service.transition_task(db_conn, task.id, TaskStatus.READY)
    tasks_service.transition_task(db_conn, task.id, TaskStatus.LOCKING)
    assert tasks_service.has_active_task(db_conn, project_id=project.id) is True
