from __future__ import annotations

import subprocess
from pathlib import Path

import pytest


def _git(args: list[str], cwd: Path) -> None:
    subprocess.run(["git", *args], cwd=str(cwd), check=True, capture_output=True, text=True)


@pytest.fixture
def fixture_repo(tmp_path: Path) -> Path:
    """A disposable git repo with one committed file, clean working tree."""
    repo = tmp_path / "fixture_repo"
    repo.mkdir()
    _git(["init", "-q"], cwd=repo)
    _git(["config", "user.email", "test@example.com"], cwd=repo)
    _git(["config", "user.name", "Test"], cwd=repo)
    (repo / "committed.txt").write_text("original content\n")
    _git(["add", "."], cwd=repo)
    _git(["commit", "-q", "-m", "initial"], cwd=repo)
    return repo


@pytest.fixture
def dirty_fixture_repo(fixture_repo: Path) -> Path:
    """Same repo, but with pre-existing uncommitted work before any task
    runs: one modified tracked file and one untracked file."""
    (fixture_repo / "committed.txt").write_text("original content\nuser edit before task\n")
    (fixture_repo / "untracked_before.txt").write_text("pre-existing untracked work\n")
    return fixture_repo
