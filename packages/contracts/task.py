"""Task contracts and schema definitions."""

from __future__ import annotations

import re
from datetime import datetime
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field, model_validator

from packages.contracts.enums import AgentType, PolicyMode, TaskStatus

_FILLER_PREFIX_RE = re.compile(
    r"^(?:please|can you|could you|would you|i want(?: you)? to|help me|task\s*:)\s+",
    re.IGNORECASE,
)


def derive_task_title(description: str, explicit_title: Optional[str] = None) -> str:
    """Return explicit_title when provided, or derive a concise variable title from description."""
    if explicit_title and explicit_title.strip():
        return explicit_title.strip()[:255]

    first_line = ""
    for raw in (description or "").splitlines():
        cleaned = re.sub(r"^[#*\->\s]+", "", raw).strip()
        if cleaned:
            first_line = cleaned
            break
    if not first_line:
        return "Untitled Task"

    # Strip repeated polite/filler prefixes (e.g. "Please help me fix...")
    for _ in range(3):
        updated = _FILLER_PREFIX_RE.sub("", first_line).strip()
        if updated == first_line:
            break
        first_line = updated

    clause = re.split(r"[.?!;](?:\s|$)", first_line, maxsplit=1)[0]
    collapsed = " ".join(clause.split()).strip(" :-")
    if not collapsed:
        return "Untitled Task"

    titled = collapsed[0].upper() + collapsed[1:]
    if len(titled) <= 65:
        return titled
    cut = titled[:64].rsplit(" ", 1)[0].rstrip(",;:-") or titled[:64]
    return f"{cut}…"


class TaskCreate(BaseModel):
    """Schema for creating a new task request."""
    title: Optional[str] = Field(None, max_length=255, description="Optional task title; auto-derived from description when omitted")
    description: str = Field(..., min_length=1, description="Detailed instructions for the agent")
    project_id: Optional[str] = Field(None, description="Optional target project identifier")
    project_path: Optional[str] = Field(None, description="Target repository path")
    preferred_agent: Optional[AgentType] = Field(None, description="Requested agent adapter")
    policy_mode: PolicyMode = Field(PolicyMode.AUTO_LOW_IMPACT, description="Autonomy policy")
    use_worktree: bool = Field(True, description="Whether to isolate task in a Git worktree")
    timeout_seconds: int = Field(3600, ge=30, le=86400, description="Task timeout limit")
    context_files: List[str] = Field(default_factory=list, description="Files to include in context")

    @model_validator(mode="after")
    def _ensure_title(self) -> "TaskCreate":
        self.title = derive_task_title(self.description, self.title)
        return self


class TaskRead(BaseModel):
    """Schema representing an existing task with full state."""
    id: str
    title: str
    description: str
    project_id: Optional[str] = None
    project_path: Optional[str] = None
    assigned_agent: Optional[AgentType] = None
    status: TaskStatus
    policy_mode: PolicyMode
    worktree_path: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    completed_at: Optional[datetime] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)


class TaskUpdate(BaseModel):
    """Schema for updating an existing task."""
    title: Optional[str] = None
    description: Optional[str] = None
    status: Optional[TaskStatus] = None
    assigned_agent: Optional[AgentType] = None
    worktree_path: Optional[str] = None
    completed_at: Optional[datetime] = None
    metadata: Optional[Dict[str, Any]] = None
