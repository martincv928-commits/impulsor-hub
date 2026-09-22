"""Generic external-validator contract (M2 SPEC section 1).

The orchestrator depends only on this abstraction, never on Godot
specifically -- mirrors the existing VcsAdapter/AIExecutorAdapter pattern
from M1. A future validator (e.g. a linter, a different engine) implements
this same contract without the orchestrator changing.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any, Optional


class ValidationStatus(str, Enum):
    PASS = "pass"
    FAIL = "fail"
    ERROR = "error"  # the validator itself crashed / couldn't run -- not a verdict on the project
    TIMEOUT = "timeout"


@dataclass
class ValidationIssue:
    message: str
    file: Optional[str] = None
    line: Optional[int] = None


@dataclass
class ValidationResult:
    """Structured validator outcome (M2 SPEC section 1's example schema)."""

    validator: str
    status: ValidationStatus
    exit_code: Optional[int]
    duration_ms: int
    command: str
    summary: str
    errors: list[ValidationIssue] = field(default_factory=list)
    warnings: list[ValidationIssue] = field(default_factory=list)
    stdout_excerpt: str = ""
    stderr_excerpt: str = ""


class ValidatorAdapter(ABC):
    """Contract every external-validator resource adapter must implement."""

    @abstractmethod
    def detect(self) -> dict[str, Any]:
        """Return {available: bool, version: str|None}."""

    @abstractmethod
    def health_check(self) -> dict[str, Any]:
        """Never fabricate values; report what's actually detectable."""

    @abstractmethod
    def capabilities(self) -> list[str]:
        ...

    @abstractmethod
    def supports(self, workspace: Path) -> bool:
        """Whether this validator applies to the project at `workspace`."""

    @abstractmethod
    def validate(self, workspace: Path, *, run_id: str, timeout_seconds: int) -> ValidationResult:
        ...

    @abstractmethod
    def cancel(self, run_id: str) -> bool:
        """Best-effort cancellation of an in-flight validation run."""
