"""Abstract AI executor resource contract (SPEC section 7)."""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

from app.database.models import ExecutorResult


@dataclass
class ExecuteRequest:
    task_id: str
    run_id: str
    workspace: Path
    objective: str
    timeout_seconds: int
    # When set (M2 repair loop), the adapter sends this prompt verbatim
    # instead of building the normal task envelope from `objective` --
    # lets the orchestrator (via policy.build_repair_envelope) control
    # repair framing without the adapter knowing anything about repairs.
    full_prompt_override: Optional[str] = None


@dataclass
class ExecuteOutcome:
    run_status: str  # completed | failed | timed_out | cancelled
    exit_code: Optional[int]
    stdout: str
    stderr: str
    structured_result: Optional[ExecutorResult]
    malformed_result_raw: Optional[str] = None
    failure_reason: Optional[str] = None
    warnings: list[str] = field(default_factory=list)


class AIExecutorAdapter(ABC):
    """Contract every AI executor resource adapter must implement (SPEC 7)."""

    @abstractmethod
    def detect(self) -> dict[str, Any]:
        ...

    @abstractmethod
    def health_check(self) -> dict[str, Any]:
        """Never fabricate quota/usage; report `unknown` when not exposed."""

    @abstractmethod
    def capabilities(self) -> list[str]:
        ...

    @abstractmethod
    def execute(self, request: ExecuteRequest) -> ExecuteOutcome:
        ...

    @abstractmethod
    def cancel(self, run_id: str) -> bool:
        """Best-effort cancellation of an in-flight run. Returns whether a
        running process for `run_id` was found and signalled."""
