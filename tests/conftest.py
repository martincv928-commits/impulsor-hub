from __future__ import annotations

import sqlite3
import subprocess
from pathlib import Path

import pytest

from app.database.db import init_db


def _git(args: list[str], cwd: Path) -> None:
    subprocess.run(["git", *args], cwd=str(cwd), check=True, capture_output=True, text=True)


@pytest.fixture
def db_path(tmp_path: Path) -> Path:
    path = tmp_path / "hub_test.db"
    init_db(path)
    return path


@pytest.fixture
def db_conn(db_path: Path):
    conn = sqlite3.connect(str(db_path), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    yield conn
    conn.close()


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


@pytest.fixture
def godot_fixture_repo(tmp_path: Path) -> Path:
    """A disposable git repo that is also a minimal Godot project (so
    `add_project` detects project_type='godot'), one commit, clean tree."""
    repo = tmp_path / "godot_fixture_repo"
    repo.mkdir()
    _git(["init", "-q"], cwd=repo)
    _git(["config", "user.email", "test@example.com"], cwd=repo)
    _git(["config", "user.name", "Test"], cwd=repo)
    (repo / "project.godot").write_text('config_version=4\n[application]\nconfig/name="Fixture"\n')
    (repo / "main.gd").write_text("extends Node\n\nfunc _ready():\n\tprint(1)\n")
    _git(["add", "."], cwd=repo)
    _git(["commit", "-q", "-m", "initial"], cwd=repo)
    return repo


@pytest.fixture
def dirty_godot_fixture_repo(godot_fixture_repo: Path) -> Path:
    """Same Godot project, but with pre-existing uncommitted work before
    any task runs: one modified tracked file and one untracked file."""
    (godot_fixture_repo / "main.gd").write_text(
        "extends Node\n\nfunc _ready():\n\tprint(1) # user's own uncommitted edit\n"
    )
    (godot_fixture_repo / "untracked_before.txt").write_text("pre-existing untracked work\n")
    return godot_fixture_repo
