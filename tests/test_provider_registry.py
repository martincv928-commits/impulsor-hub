"""M2.8: the AI provider is a selectable, persisted resource, not a
hardcoded ClaudeCodeAdapter -- app/core/router/router.py's registry."""
from __future__ import annotations

from pathlib import Path

import pytest

from app.adapters.ai.claude_code.adapter import ClaudeCodeAdapter
from app.adapters.ai.codex.adapter import CodexAdapter
from app.adapters.ai.gemini.adapter import GeminiAdapter
from app.core.router.router import AI_PROVIDER_REGISTRY, DEFAULT_AI_PROVIDER, ResourceRouter, SelectionError
from app.database.db import init_db


@pytest.fixture
def db(monkeypatch, tmp_path: Path):
    db_path = tmp_path / "provider_registry_test.db"
    monkeypatch.setenv("IMPULSOR_HUB_DB_PATH", str(db_path))
    init_db(db_path)
    return db_path


def test_registry_contains_all_three_providers():
    assert set(AI_PROVIDER_REGISTRY.keys()) == {"claude_code", "codex", "gemini"}


def test_default_active_provider_is_claude_code(db):
    router = ResourceRouter()
    assert router.active_ai_provider() == DEFAULT_AI_PROVIDER == "claude_code"
    assert isinstance(router.select_ai_executor(), ClaudeCodeAdapter)


def test_set_active_ai_provider_switches_the_selected_executor(db):
    router = ResourceRouter()
    router.set_active_ai_provider("codex")
    assert router.active_ai_provider() == "codex"
    assert isinstance(router.select_ai_executor(), CodexAdapter)

    router.set_active_ai_provider("gemini")
    assert isinstance(router.select_ai_executor(), GeminiAdapter)


def test_set_active_ai_provider_rejects_unknown_provider(db):
    router = ResourceRouter()
    with pytest.raises(SelectionError):
        router.set_active_ai_provider("not-a-real-provider")
    # Rejected selection must not have changed the active provider.
    assert router.active_ai_provider() == "claude_code"


def test_active_provider_choice_persists_across_router_instances(db):
    """Simulates a process restart: a fresh ResourceRouter must pick up
    the previously chosen provider from the DB, not reset to default."""
    first_router = ResourceRouter()
    first_router.set_active_ai_provider("codex")

    second_router = ResourceRouter()
    assert second_router.active_ai_provider() == "codex"


def test_all_adapters_includes_every_ai_provider_plus_vcs_and_validator(db):
    router = ResourceRouter()
    adapters = router.all_adapters()
    assert set(adapters.keys()) == {"git", "claude_code", "codex", "gemini", "godot"}
