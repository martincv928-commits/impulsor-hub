"""Test doubles for the AI executor, so pipeline tests never call the real
`claude` CLI (cost, network, nondeterminism) except in the explicit
end-to-end smoke test."""
from __future__ import annotations

import threading
from dataclasses import dataclass, field
from typing import Callable, Optional

from app.adapters.ai.base import AIExecutorAdapter, ExecuteOutcome, ExecuteRequest
from app.adapters.vcs.git.adapter import GitAdapter
from app.database.models import ExecutorResult


class FakeAIExecutorAdapter(AIExecutorAdapter):
    """Executor stand-in whose `execute` behavior is fully scripted by the
    test: either a canned outcome, or an `apply_fn(workspace)` callable that
    mutates the fixture repo the way a real executor would, before
    returning a matching ExecutorResult."""

    def __init__(
        self,
        *,
        apply_fn: Optional[Callable] = None,
        outcome_override: Optional[ExecuteOutcome] = None,
        block_until: Optional[threading.Event] = None,
    ) -> None:
        self.apply_fn = apply_fn
        self.outcome_override = outcome_override
        self.block_until = block_until
        self.cancel_requested_for: list[str] = []
        self.last_request: Optional[ExecuteRequest] = None
        self._cancel_event = threading.Event()

    def detect(self):
        return {"available": True, "version": "fake-1.0"}

    def health_check(self):
        return {"status": "healthy", "available": True, "version": "fake-1.0", "authenticated": "authenticated"}

    def capabilities(self):
        return ["code_edit"]

    def execute(self, request: ExecuteRequest) -> ExecuteOutcome:
        self.last_request = request
        if self.block_until is not None:
            self.block_until.wait(timeout=5)
            if self._cancel_event.is_set():
                return ExecuteOutcome(
                    run_status="cancelled",
                    exit_code=-15,
                    stdout="",
                    stderr="",
                    structured_result=None,
                    failure_reason="cancelled",
                )
        if self.outcome_override is not None:
            return self.outcome_override

        claimed_created: list[str] = []
        claimed_modified: list[str] = []
        claimed_deleted: list[str] = []
        if self.apply_fn is not None:
            claimed_created, claimed_modified, claimed_deleted = self.apply_fn(request.workspace)

        result = ExecutorResult(
            task_id=request.task_id,
            status="completed",
            summary="fake executor run",
            files_claimed_created=claimed_created,
            files_claimed_modified=claimed_modified,
            files_claimed_deleted=claimed_deleted,
        )
        return ExecuteOutcome(
            run_status="completed",
            exit_code=0,
            stdout="{}",
            stderr="",
            structured_result=result,
        )

    def cancel(self, run_id: str) -> bool:
        self.cancel_requested_for.append(run_id)
        if self.block_until is not None:
            self._cancel_event.set()
            self.block_until.set()
            return True
        return False


class FakeRouter:
    def __init__(self, ai_executor: FakeAIExecutorAdapter):
        self._vcs = GitAdapter()
        self._ai = ai_executor

    def select_vcs(self):
        return self._vcs

    def select_ai_executor(self):
        return self._ai

    def all_adapters(self):
        return {"git": self._vcs, "claude_code": self._ai}
