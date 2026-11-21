"""Contracts for collaborative bilateral multi-agent workflows."""

from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import List, Optional
from pydantic import BaseModel, Field, model_validator

from packages.contracts.enums import AgentType


class WorkflowPhase(str, Enum):
    """Execution stages of a collaborative bilateral task."""
    INSPECTION = "INSPECTION"         # Antigravity inspects codebase & drafts plan
    NEGOTIATION = "NEGOTIATION"       # OpenCode reviews & reaches consensus with Antigravity
    EXECUTION = "EXECUTION"           # OpenCode applies changes in isolated worktree
    VERIFICATION = "VERIFICATION"     # Antigravity inspects git diff and test output
    COMPLETED = "COMPLETED"           # Antigravity verifies 100% accuracy and signs off
    FAILED = "FAILED"                 # Workflow failed or exceeded retry limit


class WorkflowMessage(BaseModel):
    """A message exchanged between collaborating agents during negotiation."""
    id: Optional[int] = None
    sender: AgentType
    recipient: AgentType
    phase: WorkflowPhase
    content: str
    created_at: datetime = Field(default_factory=datetime.utcnow)

    @model_validator(mode="after")
    def _ensure_utc(self) -> "WorkflowMessage":
        if self.created_at and self.created_at.tzinfo is None:
            self.created_at = self.created_at.replace(tzinfo=timezone.utc)
        return self


class WorkflowRunRead(BaseModel):
    """State of an ongoing or completed collaborative workflow."""
    id: str
    task_id: str
    status: str
    current_phase: WorkflowPhase
    inspector_agent: AgentType = Field(AgentType.ANTIGRAVITY, description="Lead Architect / Inspector agent")
    worker_agent: AgentType = Field(AgentType.OPENCODE, description="Negotiator / Implementer agent")
    is_verified: bool
    verification_report: Optional[str] = None
    messages: List[WorkflowMessage] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime

    @model_validator(mode="after")
    def _ensure_utc(self) -> "WorkflowRunRead":
        if self.created_at and self.created_at.tzinfo is None:
            self.created_at = self.created_at.replace(tzinfo=timezone.utc)
        if self.updated_at and self.updated_at.tzinfo is None:
            self.updated_at = self.updated_at.replace(tzinfo=timezone.utc)
        return self
