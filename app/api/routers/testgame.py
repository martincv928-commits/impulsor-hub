"""USAR PROYECTO DE PRUEBA (M2.6.1 SPEC section A/E): copies the bundled
"Impulsor Hub Test Game" fixture into a fresh, independent location and
adds it as a real project through the normal `add_project` path -- no
new detection/checkpoint logic, this is 100% the existing M1/M2 pipeline
pointed at a project the user didn't have to bring themselves.

The template under fixtures/impulsor_hub_test_game/ is never touched: it
is plain tracked files (not a git repo itself), and every copy gets its
own fresh `git init` so checkpoint/KEEP/ROLLBACK work exactly like they
would on any other real project.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import uuid
from pathlib import Path

from fastapi import APIRouter, HTTPException

from app.database.db import get_connection
from app.database.models import Project
from app.projects import service as projects_service

router = APIRouter(prefix="/api/test-game", tags=["test-game"])

_TEMPLATE_DIR = Path(__file__).resolve().parents[3] / "fixtures" / "impulsor_hub_test_game"


def _copies_root() -> Path:
    return Path(os.environ.get("IMPULSOR_HUB_TEST_PROJECTS_DIR", str(Path.home() / ".impulsor-hub" / "test-projects")))


def _git(args: list[str], cwd: Path) -> None:
    subprocess.run(["git", *args], cwd=str(cwd), check=True, capture_output=True, text=True)


@router.post("", response_model=Project)
def create_test_game_copy() -> Project:
    if not _TEMPLATE_DIR.is_dir():
        raise HTTPException(status_code=500, detail="El proyecto de prueba no está disponible en esta instalación")

    root = _copies_root()
    root.mkdir(parents=True, exist_ok=True)
    dest = root / f"impulsor-hub-test-game-{uuid.uuid4().hex[:8]}"
    shutil.copytree(_TEMPLATE_DIR, dest)

    try:
        _git(["init", "-q"], cwd=dest)
        _git(["config", "user.email", "impulsor-hub@local"], cwd=dest)
        _git(["config", "user.name", "Impulsor Hub"], cwd=dest)
        _git(["add", "."], cwd=dest)
        _git(["commit", "-q", "-m", "Impulsor Hub Test Game (copia de prueba)"], cwd=dest)
    except subprocess.CalledProcessError as exc:
        shutil.rmtree(dest, ignore_errors=True)
        raise HTTPException(status_code=500, detail=f"No se pudo preparar la copia de prueba: {exc}") from exc

    with get_connection() as conn:
        try:
            return projects_service.add_project(conn, root_path=str(dest), name="Impulsor Hub Test Game (prueba)")
        except projects_service.ProjectPathError as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc
