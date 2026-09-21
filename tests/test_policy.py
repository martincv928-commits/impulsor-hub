from __future__ import annotations

from pathlib import Path

import pytest

from app.core.permissions.policy import (
    WorkspaceBoundaryError,
    assert_allowed_git_subcommand,
    ForbiddenGitOperationError,
    build_task_envelope,
    normalize_project_root,
    validate_path_within_workspace,
)


def test_normalize_project_root_rejects_blank():
    with pytest.raises(WorkspaceBoundaryError):
        normalize_project_root("   ")


def test_path_inside_workspace_is_allowed(tmp_path: Path):
    (tmp_path / "sub").mkdir()
    resolved = validate_path_within_workspace(tmp_path, tmp_path / "sub" / "file.txt")
    assert resolved == (tmp_path / "sub" / "file.txt").resolve()


def test_path_outside_workspace_is_rejected(tmp_path: Path):
    sibling = tmp_path.parent / "not_the_workspace"
    with pytest.raises(WorkspaceBoundaryError):
        validate_path_within_workspace(tmp_path, sibling / "file.txt")


def test_prefix_sharing_sibling_is_rejected(tmp_path: Path):
    """Regression guard: a naive str.startswith(root) check would wrongly
    allow '/workspace-evil' when root is '/workspace'."""
    evil_sibling = Path(str(tmp_path) + "-evil")
    with pytest.raises(WorkspaceBoundaryError):
        validate_path_within_workspace(tmp_path, evil_sibling / "file.txt")


def test_impulsor_metadata_dir_is_rejected(tmp_path: Path):
    with pytest.raises(WorkspaceBoundaryError):
        validate_path_within_workspace(tmp_path, tmp_path / ".impulsor" / "secret.json")


@pytest.mark.parametrize(
    "args",
    [
        ["commit", "-m", "x"],
        ["reset", "--hard"],
        ["rebase", "main"],
        ["stash"],
        ["checkout", "main"],
        ["push"],
        ["clean", "-fd"],
    ],
)
def test_forbidden_git_subcommands_rejected(args):
    with pytest.raises(ForbiddenGitOperationError):
        assert_allowed_git_subcommand(args)


def test_allowed_git_subcommand_passes():
    assert_allowed_git_subcommand(["status", "--porcelain"])


def test_task_envelope_contains_required_rules(tmp_path: Path):
    envelope = build_task_envelope(task_id="TASK-1", workspace=tmp_path, objective="do the thing")
    assert "TASK_ID: TASK-1" in envelope
    assert str(tmp_path) in envelope
    assert "do the thing" in envelope
    assert "Do not run git commit/reset/rebase/stash/checkout" in envelope
    assert "Do not modify .impulsor" in envelope
