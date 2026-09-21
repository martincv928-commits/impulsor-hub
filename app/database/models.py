"""Pydantic contracts for core entities and the executor result schema.

These are the shapes that cross process/API boundaries. Row<->model mapping
happens in the service layer (projects/service.py, tasks/service.py), which
keeps SQL out of the API layer and validation out of raw sqlite3.Row objects.
"""
from __future__ import annotations

from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, Field, field_validator


class TaskStatus(str, Enum):
    CREATED = "CREATED"
    VALIDATING = "VALIDATING"
    READY = "READY"
    LOCKING = "LOCKING"
    CHECKPOINTING = "CHECKPOINTING"
    RUNNING = "RUNNING"
    VERIFYING = "VERIFYING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    WAITING_APPROVAL = "WAITING_APPROVAL"
    BLOCKED = "BLOCKED"
    CANCELLED = "CANCELLED"


# Legal forward transitions. Loops are not allowed; failure/cancel/blocked
# are reachable from any in-flight state.
TASK_TRANSITIONS: dict[TaskStatus, set[TaskStatus]] = {
    TaskStatus.CREATED: {TaskStatus.VALIDATING, TaskStatus.CANCELLED},
    TaskStatus.VALIDATING: {
        TaskStatus.READY,
        TaskStatus.BLOCKED,
        TaskStatus.WAITING_APPROVAL,
        TaskStatus.FAILED,
        TaskStatus.CANCELLED,
    },
    TaskStatus.WAITING_APPROVAL: {TaskStatus.READY, TaskStatus.CANCELLED, TaskStatus.BLOCKED},
    TaskStatus.READY: {TaskStatus.LOCKING, TaskStatus.CANCELLED},
    TaskStatus.LOCKING: {TaskStatus.CHECKPOINTING, TaskStatus.BLOCKED, TaskStatus.CANCELLED},
    TaskStatus.CHECKPOINTING: {TaskStatus.RUNNING, TaskStatus.FAILED, TaskStatus.CANCELLED},
    TaskStatus.RUNNING: {TaskStatus.VERIFYING, TaskStatus.FAILED, TaskStatus.CANCELLED},
    TaskStatus.VERIFYING: {TaskStatus.COMPLETED, TaskStatus.FAILED},
    TaskStatus.COMPLETED: set(),
    TaskStatus.FAILED: set(),
    TaskStatus.BLOCKED: set(),
    TaskStatus.CANCELLED: set(),
}


class TaskRunStatus(str, Enum):
    PENDING = "PENDING"
    RUNNING = "RUNNING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    TIMED_OUT = "TIMED_OUT"
    CANCELLED = "CANCELLED"


class RunDisposition(str, Enum):
    PENDING = "pending"
    KEPT = "kept"
    ROLLED_BACK = "rolled_back"


class EventSeverity(str, Enum):
    INFO = "info"
    WARNING = "warning"
    ERROR = "error"


class ResourceType(str, Enum):
    AI_EXECUTOR = "ai_executor"
    VCS = "vcs"
    TOOL = "tool"
    SERVICE = "service"


class CostType(str, Enum):
    FREE = "free"
    SUBSCRIPTION = "subscription"
    API = "api"
    UNKNOWN = "unknown"


class Project(BaseModel):
    id: str
    name: str
    root_path: str
    project_type: str = "generic"
    created_at: str
    updated_at: str
    status: str = "active"


class ProjectCreate(BaseModel):
    root_path: str
    name: Optional[str] = None


class Resource(BaseModel):
    id: str
    adapter_key: str
    type: ResourceType
    display_name: str
    version: Optional[str] = None
    availability: str
    auth_state: Optional[str] = None
    cost_type: CostType = CostType.UNKNOWN
    capabilities: list[str] = Field(default_factory=list)
    health: dict[str, Any] = Field(default_factory=dict)
    checked_at: Optional[str] = None


class Task(BaseModel):
    id: str
    project_id: str
    objective: str
    status: TaskStatus
    created_at: str
    updated_at: str


class TaskCreateRequest(BaseModel):
    project_id: str
    objective: str

    @field_validator("objective")
    @classmethod
    def objective_not_blank(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("objective must not be blank")
        return v.strip()


class TaskRun(BaseModel):
    id: str
    task_id: str
    executor_resource_id: Optional[str] = None
    status: TaskRunStatus
    started_at: Optional[str] = None
    ended_at: Optional[str] = None
    timeout_seconds: int
    structured_result: Optional[dict[str, Any]] = None
    stdout_path: Optional[str] = None
    stderr_path: Optional[str] = None
    failure_reason: Optional[str] = None
    disposition: RunDisposition = RunDisposition.PENDING


class FileChange(BaseModel):
    id: str
    task_run_id: str
    path: str
    change_type: str  # created | modified | deleted | renamed
    additions: Optional[int] = None
    deletions: Optional[int] = None
    claimed_by_executor: Optional[bool] = None
    observed_by_vcs: bool


class Checkpoint(BaseModel):
    id: str
    project_id: str
    task_run_id: Optional[str] = None
    mechanism: str
    reference: str
    created_at: str
    restore_status: str = "available"


class Event(BaseModel):
    id: str
    project_id: Optional[str] = None
    task_id: Optional[str] = None
    task_run_id: Optional[str] = None
    type: str
    severity: EventSeverity = EventSeverity.INFO
    payload: dict[str, Any] = Field(default_factory=dict)
    created_at: str


class ExecutorResult(BaseModel):
    """Minimum logical schema per SPEC section 13.

    This is a *claim*, never treated as verified truth on its own — the VCS
    adapter independently observes actual repository state and the two are
    reconciled in tasks/service.py.
    """

    task_id: str
    status: str
    summary: str = ""
    files_claimed_modified: list[str] = Field(default_factory=list)
    files_claimed_created: list[str] = Field(default_factory=list)
    files_claimed_deleted: list[str] = Field(default_factory=list)
    commands_executed: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    recommended_validation: list[str] = Field(default_factory=list)
