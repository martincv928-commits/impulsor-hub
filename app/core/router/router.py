"""Resource selection (SPEC section 4: "no intelligent planner yet").

M1 had exactly one AI executor adapter (claude_code); the AI provider is
now an interchangeable resource (any AIExecutorAdapter implementation),
selected from AI_PROVIDER_REGISTRY rather than hardcoded, so the Hub is
not dependent on any single AI vendor. This module still exists so the
orchestrator never imports a concrete adapter directly — it asks the
router, which is the seam a real capability/cost/availability router
replaces in M3, without the orchestrator changing. Adding a provider
means adding one entry to AI_PROVIDER_REGISTRY, not touching the
orchestrator or this class's public shape.
"""
from __future__ import annotations

from dataclasses import dataclass

from app.adapters.ai.base import AIExecutorAdapter
from app.adapters.ai.claude_code.adapter import ClaudeCodeAdapter
from app.adapters.ai.codex.adapter import CodexAdapter
from app.adapters.ai.gemini.adapter import GeminiAdapter
from app.adapters.validator.base import ValidatorAdapter
from app.adapters.validator.godot.adapter import GodotAdapter
from app.adapters.vcs.base import VcsAdapter
from app.adapters.vcs.git.adapter import GitAdapter
from app.database.db import get_connection

# Add a provider here -- nothing else in the orchestrator/pipeline needs
# to change. Each adapter handles its own official auth mechanism; this
# registry only needs to know how to construct one.
AI_PROVIDER_REGISTRY: dict[str, type[AIExecutorAdapter]] = {
    "claude_code": ClaudeCodeAdapter,
    "codex": CodexAdapter,
    "gemini": GeminiAdapter,
}
DEFAULT_AI_PROVIDER = "claude_code"
_ACTIVE_PROVIDER_SETTING_KEY = "active_ai_provider"


@dataclass
class SelectionError(Exception):
    reason: str


def _load_active_provider() -> str:
    try:
        with get_connection() as conn:
            row = conn.execute(
                "SELECT value FROM hub_setting WHERE key = ?", (_ACTIVE_PROVIDER_SETTING_KEY,)
            ).fetchone()
    except Exception:
        # Best-effort: an unreadable/uninitialized DB just falls back to
        # the default rather than failing router construction.
        return DEFAULT_AI_PROVIDER
    if row and row["value"] in AI_PROVIDER_REGISTRY:
        return row["value"]
    return DEFAULT_AI_PROVIDER


def _persist_active_provider(key: str) -> None:
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO hub_setting (key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (_ACTIVE_PROVIDER_SETTING_KEY, key),
        )


class ResourceRouter:
    """Direct, non-intelligent resource selection for M1/M2, with a
    user-selectable (not auto-negotiated) active AI provider for M2.8."""

    def __init__(self) -> None:
        self._vcs = GitAdapter()
        self._ai_executors: dict[str, AIExecutorAdapter] = {
            key: cls() for key, cls in AI_PROVIDER_REGISTRY.items()
        }
        self._validator = GodotAdapter()
        self._active_provider = _load_active_provider()

    def active_ai_provider(self) -> str:
        return self._active_provider

    def set_active_ai_provider(self, key: str) -> None:
        if key not in AI_PROVIDER_REGISTRY:
            raise SelectionError(reason=f"Unknown AI provider: {key}")
        self._active_provider = key
        _persist_active_provider(key)

    def select_vcs(self) -> VcsAdapter:
        return self._vcs

    def select_ai_executor(self) -> AIExecutorAdapter:
        return self._ai_executors[self._active_provider]

    def select_validator(self) -> ValidatorAdapter:
        return self._validator

    def all_adapters(self) -> dict[str, object]:
        return {"git": self._vcs, **self._ai_executors, "godot": self._validator}


_router_singleton: ResourceRouter | None = None


def get_router() -> ResourceRouter:
    global _router_singleton
    if _router_singleton is None:
        _router_singleton = ResourceRouter()
    return _router_singleton
