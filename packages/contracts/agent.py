"""Agent contracts, capabilities, and execution schemas."""

from __future__ import annotations

from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field

from packages.contracts.enums import AgentType, PolicyMode, TaskStatus


class AgentCapabilities(BaseModel):
    """Declared and verified capabilities of an agent integration."""
    supports_acp: bool = Field(False, description="Whether agent supports Agent Client Protocol")
    supports_mcp: bool = Field(False, description="Whether agent supports Model Context Protocol")
    supports_headless: bool = Field(False, description="Whether agent supports non-interactive execution")
    supports_json_output: bool = Field(False, description="Whether agent supports structured JSON output")
    supports_worktrees: bool = Field(False, description="Whether agent supports native Git worktree flags")
    supports_cancellation: bool = Field(False, description="Whether agent supports external cancellation")
    supports_session_resume: bool = Field(False, description="Whether agent supports session resumption")


class AgentDescriptor(BaseModel):
    """Metadata describing an installed and discovered agent."""
    agent_type: AgentType
    name: str
    executable_path: str
    version: str
    is_available: bool
    capabilities: AgentCapabilities
    notes: Optional[str] = None


class AgentExecutionRequest(BaseModel):
    """Request payload passed to an agent adapter to execute work."""
    task_id: str
    run_id: str
    prompt: str
    working_directory: str
    worktree_name: Optional[str] = None
    policy_mode: PolicyMode = PolicyMode.AUTO_LOW_IMPACT
    timeout_seconds: int = 3600
    context_files: List[str] = Field(default_factory=list)
    extra_flags: Dict[str, Any] = Field(default_factory=dict)


class AgentExecutionResult(BaseModel):
    """Result returned by an agent adapter upon turn or run completion."""
    task_id: str
    run_id: str
    agent_type: AgentType
    status: TaskStatus
    exit_code: int
    stdout: str
    stderr: str
    duration_seconds: float
    structured_output: Optional[Dict[str, Any]] = None
    error_reason: Optional[str] = None
