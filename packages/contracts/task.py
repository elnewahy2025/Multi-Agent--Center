"""Task contracts and schema definitions."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field

from packages.contracts.enums import AgentType, PolicyMode, TaskStatus


class TaskCreate(BaseModel):
    """Schema for creating a new task request."""
    title: str = Field(..., min_length=1, max_length=255, description="Brief task title")
    description: str = Field(..., min_length=1, description="Detailed instructions for the agent")
    project_id: Optional[str] = Field(None, description="Optional target project identifier")
    project_path: Optional[str] = Field(None, description="Target repository path")
    preferred_agent: Optional[AgentType] = Field(None, description="Requested agent adapter")
    policy_mode: PolicyMode = Field(PolicyMode.AUTO_LOW_IMPACT, description="Autonomy policy")
    use_worktree: bool = Field(True, description="Whether to isolate task in a Git worktree")
    timeout_seconds: int = Field(3600, ge=30, le=86400, description="Task timeout limit")
    context_files: List[str] = Field(default_factory=list, description="Files to include in context")


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
