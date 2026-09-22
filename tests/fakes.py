"""Test doubles for the AI executor and validator, so pipeline tests never
call the real `claude` CLI or a real Godot binary (cost, network,
nondeterminism) except in the explicit end-to-end smoke tests."""
from __future__ import annotations

import threading
from pathlib import Path
from typing import Callable, Optional

from app.adapters.ai.base import AIExecutorAdapter, ExecuteOutcome, ExecuteRequest
from app.adapters.validator.base import ValidationResult, ValidationStatus, ValidatorAdapter
from app.adapters.vcs.git.adapter import GitAdapter
from app.database.models import ExecutorResult


class FakeAIExecutorAdapter(AIExecutorAdapter):
    """Executor stand-in whose `execute` behavior is fully scripted by the
    test: either a canned outcome, an `apply_fn(workspace)` callable that
    mutates the fixture repo the way a real executor would, or (for
    repair-loop tests) `sequenced_apply_fns` -- one apply_fn per call,
    indexed by how many times `execute` has been invoked so the initial
    attempt and each repair attempt can behave differently."""

    def __init__(
        self,
        *,
        apply_fn: Optional[Callable] = None,
        sequenced_apply_fns: Optional[list[Callable]] = None,
        outcome_override: Optional[ExecuteOutcome] = None,
        sequenced_outcomes: Optional[list[ExecuteOutcome]] = None,
        block_until: Optional[threading.Event] = None,
    ) -> None:
        self.apply_fn = apply_fn
        self.sequenced_apply_fns = sequenced_apply_fns
        self.outcome_override = outcome_override
        self.sequenced_outcomes = sequenced_outcomes
        self.block_until = block_until
        self.cancel_requested_for: list[str] = []
        self.last_request: Optional[ExecuteRequest] = None
        self.requests: list[ExecuteRequest] = []
        self.call_count = 0
        self._cancel_event = threading.Event()

    def detect(self):
        return {"available": True, "version": "fake-1.0"}

    def health_check(self):
        return {"status": "healthy", "available": True, "version": "fake-1.0", "authenticated": "authenticated"}

    def capabilities(self):
        return ["code_edit"]

    def execute(self, request: ExecuteRequest) -> ExecuteOutcome:
        call_index = self.call_count
        self.call_count += 1
        self.last_request = request
        self.requests.append(request)

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
        if self.sequenced_outcomes is not None:
            idx = min(call_index, len(self.sequenced_outcomes) - 1)
            return self.sequenced_outcomes[idx]
        if self.outcome_override is not None:
            return self.outcome_override

        apply_fn = self.apply_fn
        if self.sequenced_apply_fns is not None:
            idx = min(call_index, len(self.sequenced_apply_fns) - 1)
            apply_fn = self.sequenced_apply_fns[idx]

        claimed_created: list[str] = []
        claimed_modified: list[str] = []
        claimed_deleted: list[str] = []
        if apply_fn is not None:
            claimed_created, claimed_modified, claimed_deleted = apply_fn(request.workspace)

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


class FakeValidatorAdapter(ValidatorAdapter):
    """Validator stand-in: either a single canned ValidationResult for
    every call, or `sequenced_results` -- one per call, indexed like
    FakeAIExecutorAdapter's sequenced_apply_fns (index 0 = the validation
    right after the initial execution, 1 = after repair 1, ...)."""

    def __init__(
        self,
        *,
        supports_result: bool = True,
        result: Optional[ValidationResult] = None,
        sequenced_results: Optional[list[ValidationResult]] = None,
    ) -> None:
        self.supports_result = supports_result
        self.result = result or ValidationResult(
            validator="fake",
            status=ValidationStatus.PASS,
            exit_code=0,
            duration_ms=1,
            command="fake",
            summary="fake pass",
        )
        self.sequenced_results = sequenced_results
        self.call_count = 0
        self.cancel_requested_for: list[str] = []

    def detect(self):
        return {"available": True, "version": "fake-godot-1.0"}

    def health_check(self):
        return {"status": "healthy", "available": True, "version": "fake-godot-1.0"}

    def capabilities(self):
        return ["fake_validation"]

    def supports(self, workspace: Path) -> bool:
        return self.supports_result

    def validate(self, workspace: Path, *, run_id: str, timeout_seconds: int) -> ValidationResult:
        idx = self.call_count
        self.call_count += 1
        if self.sequenced_results is not None:
            return self.sequenced_results[min(idx, len(self.sequenced_results) - 1)]
        return self.result

    def cancel(self, run_id: str) -> bool:
        self.cancel_requested_for.append(run_id)
        return True


class FakeRouter:
    def __init__(self, ai_executor: FakeAIExecutorAdapter, validator: Optional[FakeValidatorAdapter] = None):
        self._vcs = GitAdapter()
        self._ai = ai_executor
        self._validator = validator or FakeValidatorAdapter(supports_result=False)

    def select_vcs(self):
        return self._vcs

    def select_ai_executor(self):
        return self._ai

    def select_validator(self):
        return self._validator

    def all_adapters(self):
        return {"git": self._vcs, "claude_code": self._ai, "godot": self._validator}
