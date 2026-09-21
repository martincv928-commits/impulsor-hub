"""Resource selection (SPEC section 4: "no intelligent planner yet").

M1 has exactly one VCS adapter (git) and one AI executor adapter
(claude_code). This module exists so the orchestrator never imports a
concrete adapter directly — it asks the router, which is the seam a real
capability/cost/availability router replaces in M3, without the
orchestrator changing.
"""
from __future__ import annotations

from dataclasses import dataclass

from app.adapters.ai.base import AIExecutorAdapter
from app.adapters.ai.claude_code.adapter import ClaudeCodeAdapter
from app.adapters.vcs.base import VcsAdapter
from app.adapters.vcs.git.adapter import GitAdapter


@dataclass
class SelectionError(Exception):
    reason: str


class ResourceRouter:
    """Direct, non-intelligent resource selection for M1."""

    def __init__(self) -> None:
        self._vcs = GitAdapter()
        self._ai_executor = ClaudeCodeAdapter()

    def select_vcs(self) -> VcsAdapter:
        return self._vcs

    def select_ai_executor(self) -> AIExecutorAdapter:
        return self._ai_executor

    def all_adapters(self) -> dict[str, object]:
        return {"git": self._vcs, "claude_code": self._ai_executor}


_router_singleton: ResourceRouter | None = None


def get_router() -> ResourceRouter:
    global _router_singleton
    if _router_singleton is None:
        _router_singleton = ResourceRouter()
    return _router_singleton
