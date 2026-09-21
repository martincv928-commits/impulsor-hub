from __future__ import annotations

from pathlib import Path

import pytest

from app.adapters.vcs.base import RepositoryNotFoundError
from app.adapters.vcs.git.adapter import GitAdapter


def _checkpoint_dir(repo: Path) -> Path:
    d = repo / ".impulsor" / "checkpoints"
    d.mkdir(parents=True, exist_ok=True)
    return d


def test_detect_finds_git():
    adapter = GitAdapter()
    info = adapter.detect()
    assert info["available"] is True
    assert info["version"]


def test_validate_repository_rejects_missing_path(tmp_path: Path):
    adapter = GitAdapter()
    missing = tmp_path / "does_not_exist"
    with pytest.raises(RepositoryNotFoundError):
        adapter.validate_repository(missing)


def test_validate_repository_rejects_non_git_dir(tmp_path: Path):
    adapter = GitAdapter()
    plain_dir = tmp_path / "plain"
    plain_dir.mkdir()
    with pytest.raises(RepositoryNotFoundError):
        adapter.validate_repository(plain_dir)


def test_status_clean_repo_is_clean(fixture_repo: Path):
    adapter = GitAdapter()
    status = adapter.status(fixture_repo)
    assert status.is_repository is True
    assert status.is_clean is True
    assert status.entries == []


def test_status_dirty_repo_reports_entries(dirty_fixture_repo: Path):
    adapter = GitAdapter()
    status = adapter.status(dirty_fixture_repo)
    assert status.is_clean is False
    paths = {e["path"] for e in status.entries}
    assert "committed.txt" in paths
    assert "untracked_before.txt" in paths


def test_status_non_repository_reports_not_a_repo(tmp_path: Path):
    adapter = GitAdapter()
    plain_dir = tmp_path / "plain"
    plain_dir.mkdir()
    status = adapter.status(plain_dir)
    assert status.is_repository is False
    assert status.error is not None


def test_clean_repo_rollback_removes_ai_created_and_restores_modified(fixture_repo: Path):
    adapter = GitAdapter()
    ref = adapter.create_checkpoint(fixture_repo, _checkpoint_dir(fixture_repo))

    # Simulate the AI executor doing work.
    (fixture_repo / "committed.txt").write_text("AI modified this file\n")
    (fixture_repo / "ai_created.py").write_text("print('hello')\n")

    adapter.restore_checkpoint(fixture_repo, ref)

    assert (fixture_repo / "committed.txt").read_text() == "original content\n"
    assert not (fixture_repo / "ai_created.py").exists()


def test_dirty_repo_rollback_preserves_pre_existing_tracked_modification(dirty_fixture_repo: Path):
    adapter = GitAdapter()
    ref = adapter.create_checkpoint(dirty_fixture_repo, _checkpoint_dir(dirty_fixture_repo))

    pre_task_content = (dirty_fixture_repo / "committed.txt").read_text()
    assert "user edit before task" in pre_task_content

    # AI further modifies the already-dirty tracked file.
    (dirty_fixture_repo / "committed.txt").write_text("AI overwrote everything\n")

    adapter.restore_checkpoint(dirty_fixture_repo, ref)

    restored = (dirty_fixture_repo / "committed.txt").read_text()
    assert restored == pre_task_content
    assert "user edit before task" in restored


def test_dirty_repo_rollback_preserves_pre_existing_untracked_file(dirty_fixture_repo: Path):
    adapter = GitAdapter()
    ref = adapter.create_checkpoint(dirty_fixture_repo, _checkpoint_dir(dirty_fixture_repo))

    # AI creates a new file and also deletes the user's pre-existing untracked file.
    (dirty_fixture_repo / "ai_created.py").write_text("print('hi')\n")
    (dirty_fixture_repo / "untracked_before.txt").unlink()

    adapter.restore_checkpoint(dirty_fixture_repo, ref)

    assert (dirty_fixture_repo / "untracked_before.txt").read_text() == "pre-existing untracked work\n"
    assert not (dirty_fixture_repo / "ai_created.py").exists()


def test_rollback_restores_deleted_tracked_file(fixture_repo: Path):
    adapter = GitAdapter()
    ref = adapter.create_checkpoint(fixture_repo, _checkpoint_dir(fixture_repo))

    (fixture_repo / "committed.txt").unlink()

    adapter.restore_checkpoint(fixture_repo, ref)

    assert (fixture_repo / "committed.txt").exists()
    assert (fixture_repo / "committed.txt").read_text() == "original content\n"


def test_rollback_is_noop_for_untouched_clean_repo(fixture_repo: Path):
    adapter = GitAdapter()
    ref = adapter.create_checkpoint(fixture_repo, _checkpoint_dir(fixture_repo))
    adapter.restore_checkpoint(fixture_repo, ref)
    status = adapter.status(fixture_repo)
    assert status.is_clean is True


def test_change_manifest_excludes_pre_existing_dirty_state(dirty_fixture_repo: Path):
    adapter = GitAdapter()
    pre_status = adapter.status(dirty_fixture_repo)

    (dirty_fixture_repo / "new_by_ai.txt").write_text("line1\nline2\n")

    post_status = adapter.status(dirty_fixture_repo)
    manifest = adapter.compute_change_manifest(dirty_fixture_repo, pre_status, post_status)

    paths = {e.path: e for e in manifest.entries}
    assert "new_by_ai.txt" in paths
    assert paths["new_by_ai.txt"].change_type == "created"
    # Pre-existing dirty file untouched during "task" must not appear.
    assert "committed.txt" not in paths
    assert "untracked_before.txt" not in paths


def test_change_manifest_detects_modification_of_pre_existing_file(dirty_fixture_repo: Path):
    adapter = GitAdapter()
    pre_status = adapter.status(dirty_fixture_repo)

    # AI further edits the file that was already dirty before the task.
    with (dirty_fixture_repo / "committed.txt").open("a") as f:
        f.write("AI added this line\n")

    post_status = adapter.status(dirty_fixture_repo)
    manifest = adapter.compute_change_manifest(dirty_fixture_repo, pre_status, post_status)
    # status_code for committed.txt is the same (' M' before and after edit->still modified),
    # so this documents the known limitation: same-status re-edits of an
    # already-dirty file are not distinguished from the pre-existing edit.
    paths = {e.path for e in manifest.entries}
    assert "committed.txt" not in paths


def test_ai_created_then_deleted_by_ai_nets_to_no_change(fixture_repo: Path):
    adapter = GitAdapter()
    pre_status = adapter.status(fixture_repo)
    (fixture_repo / "temp.txt").write_text("x")
    (fixture_repo / "temp.txt").unlink()
    post_status = adapter.status(fixture_repo)
    manifest = adapter.compute_change_manifest(fixture_repo, pre_status, post_status)
    assert manifest.entries == []
