"""Abstract VCS resource contract (SPEC section 7).

The orchestrator/task service depends only on this abstraction, never on
git-specific code, so a future VCS could be added without touching
core/tasks logic.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional


@dataclass
class VcsStatus:
    is_repository: bool
    is_clean: bool
    entries: list[dict[str, str]] = field(default_factory=list)  # [{path, status_code}]
    error: Optional[str] = None


@dataclass
class FileChangeEntry:
    path: str
    change_type: str  # created | modified | deleted | renamed
    additions: Optional[int] = None
    deletions: Optional[int] = None


@dataclass
class ChangeManifest:
    entries: list[FileChangeEntry] = field(default_factory=list)


@dataclass
class CheckpointRef:
    mechanism: str
    reference: str  # opaque identifier the adapter can use to restore later


class VcsAdapterError(Exception):
    pass


class RepositoryNotFoundError(VcsAdapterError):
    pass


class VcsNotAvailableError(VcsAdapterError):
    pass


class CheckpointError(VcsAdapterError):
    pass


class RollbackError(VcsAdapterError):
    pass


class VcsAdapter(ABC):
    """Contract every VCS resource adapter must implement (SPEC 7)."""

    @abstractmethod
    def detect(self) -> dict[str, Any]:
        """Return {available: bool, version: str|None}."""

    @abstractmethod
    def health_check(self) -> dict[str, Any]:
        """Return a structured health payload. Never fabricate values."""

    @abstractmethod
    def validate_repository(self, workspace: Path) -> None:
        """Raise RepositoryNotFoundError / VcsNotAvailableError if invalid."""

    @abstractmethod
    def status(self, workspace: Path) -> VcsStatus:
        ...

    @abstractmethod
    def create_checkpoint(self, workspace: Path, checkpoint_dir: Path) -> CheckpointRef:
        """Create a safe, restorable baseline of the current workspace state
        (tracked + untracked, clean or dirty) without mutating repo history."""

    @abstractmethod
    def restore_checkpoint(self, workspace: Path, ref: CheckpointRef) -> None:
        """Restore the workspace to exactly the state captured by `ref`,
        without destroying any work that existed at checkpoint time."""

    @abstractmethod
    def compute_change_manifest(self, workspace: Path, checkpoint: CheckpointRef) -> ChangeManifest:
        """Derive the set of changes attributable to task execution by
        comparing actual file content against the pre-task checkpoint
        snapshot (not by diffing `git status` codes, which cannot
        distinguish a file that was already dirty at checkpoint time from
        one the task edited further while it stayed dirty). A file whose
        bytes are unchanged since the checkpoint is excluded even if it is
        still `git`-dirty relative to HEAD."""
