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


def test_change_manifest_excludes_untouched_pre_existing_dirty_state(dirty_fixture_repo: Path):
    """dirty tracked file, sin modificación adicional -> excluido del manifest."""
    adapter = GitAdapter()
    ref = adapter.create_checkpoint(dirty_fixture_repo, _checkpoint_dir(dirty_fixture_repo))

    (dirty_fixture_repo / "new_by_ai.txt").write_text("line1\nline2\n")

    manifest = adapter.compute_change_manifest(dirty_fixture_repo, ref)

    paths = {e.path: e for e in manifest.entries}
    assert "new_by_ai.txt" in paths
    assert paths["new_by_ai.txt"].change_type == "created"
    assert paths["new_by_ai.txt"].additions == 2
    # Pre-existing dirty tracked file, untouched during the task, must not appear.
    assert "committed.txt" not in paths
    # Pre-existing untracked file, untouched during the task, must not appear either.
    assert "untracked_before.txt" not in paths


def test_change_manifest_detects_modification_of_pre_existing_dirty_file(dirty_fixture_repo: Path):
    """§7.1 fix: a dirty tracked file that Claude edits *again* during the
    task must be reported as a task-attributable change, even though its
    `git status` code (' M') never changes."""
    adapter = GitAdapter()
    ref = adapter.create_checkpoint(dirty_fixture_repo, _checkpoint_dir(dirty_fixture_repo))
    baseline_content = (dirty_fixture_repo / "committed.txt").read_text()

    with (dirty_fixture_repo / "committed.txt").open("a") as f:
        f.write("AI added this line\n")

    manifest = adapter.compute_change_manifest(dirty_fixture_repo, ref)

    paths = {e.path: e for e in manifest.entries}
    assert "committed.txt" in paths
    assert paths["committed.txt"].change_type == "modified"
    # Only the task's own added line counts -- not the user's pre-existing dirty line too.
    assert paths["committed.txt"].additions == 1
    assert paths["committed.txt"].deletions == 0
    assert baseline_content != (dirty_fixture_repo / "committed.txt").read_text()


def test_change_manifest_excludes_untouched_pre_existing_untracked_file(dirty_fixture_repo: Path):
    """untracked preexistente, sin modificar -> excluido del manifest."""
    adapter = GitAdapter()
    ref = adapter.create_checkpoint(dirty_fixture_repo, _checkpoint_dir(dirty_fixture_repo))

    (dirty_fixture_repo / "committed.txt").write_text("only the tracked file changes\n")

    manifest = adapter.compute_change_manifest(dirty_fixture_repo, ref)
    paths = {e.path for e in manifest.entries}
    assert "untracked_before.txt" not in paths


def test_change_manifest_detects_modification_of_pre_existing_untracked_file(dirty_fixture_repo: Path):
    """untracked preexistente, modificado durante la tarea -> detectado."""
    adapter = GitAdapter()
    ref = adapter.create_checkpoint(dirty_fixture_repo, _checkpoint_dir(dirty_fixture_repo))

    with (dirty_fixture_repo / "untracked_before.txt").open("a") as f:
        f.write("AI appended to the untracked file\n")

    manifest = adapter.compute_change_manifest(dirty_fixture_repo, ref)
    paths = {e.path: e for e in manifest.entries}
    assert "untracked_before.txt" in paths
    assert paths["untracked_before.txt"].change_type == "modified"
    assert paths["untracked_before.txt"].additions == 1


def test_change_manifest_detects_new_file_created_during_task(fixture_repo: Path):
    """archivo nuevo creado durante la tarea -> 'created'."""
    adapter = GitAdapter()
    ref = adapter.create_checkpoint(fixture_repo, _checkpoint_dir(fixture_repo))

    (fixture_repo / "new_module.py").write_text("def f():\n    return 1\n")

    manifest = adapter.compute_change_manifest(fixture_repo, ref)
    paths = {e.path: e for e in manifest.entries}
    assert paths["new_module.py"].change_type == "created"
    assert paths["new_module.py"].additions == 2
    assert paths["new_module.py"].deletions == 0


def test_change_manifest_detects_file_deleted_during_task(fixture_repo: Path):
    """archivo eliminado durante la tarea -> 'deleted'."""
    adapter = GitAdapter()
    ref = adapter.create_checkpoint(fixture_repo, _checkpoint_dir(fixture_repo))

    (fixture_repo / "committed.txt").unlink()

    manifest = adapter.compute_change_manifest(fixture_repo, ref)
    paths = {e.path: e for e in manifest.entries}
    assert paths["committed.txt"].change_type == "deleted"


def test_ai_created_then_deleted_by_ai_nets_to_no_change(fixture_repo: Path):
    adapter = GitAdapter()
    ref = adapter.create_checkpoint(fixture_repo, _checkpoint_dir(fixture_repo))
    (fixture_repo / "temp.txt").write_text("x")
    (fixture_repo / "temp.txt").unlink()
    manifest = adapter.compute_change_manifest(fixture_repo, ref)
    assert manifest.entries == []


def test_change_manifest_reports_broken_symlink_as_changed_instead_of_crashing(fixture_repo: Path):
    """A path whose content can't be hashed (e.g. a symlink that pointed
    somewhere valid at checkpoint time but is now broken) must never crash
    verification -- report it as changed rather than silently equal."""
    adapter = GitAdapter()
    (fixture_repo / "link.txt").symlink_to(fixture_repo / "committed.txt")
    ref = adapter.create_checkpoint(fixture_repo, _checkpoint_dir(fixture_repo))

    (fixture_repo / "committed.txt").unlink()  # breaks link.txt's target

    manifest = adapter.compute_change_manifest(fixture_repo, ref)
    paths = {e.path for e in manifest.entries}
    assert "link.txt" in paths
