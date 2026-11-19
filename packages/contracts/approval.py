"""Human-in-the-loop approval schemas and event contracts."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, Optional
from pydantic import BaseModel, Field

from packages.contracts.enums import ApprovalDecision, RiskLevel


class ApprovalRequest(BaseModel):
    """A high-impact action requiring human verification and decision."""
    id: str
    task_id: str
    run_id: str
    action_type: str = Field(..., description="Action category (e.g. git_push, destructive_cmd)")
    command_or_path: str = Field(..., description="Exact command or file path being evaluated")
    description: str = Field(..., description="Human-readable explanation of why approval is needed")
    risk_level: RiskLevel = Field(RiskLevel.HIGH, description="Risk assessment of the action")
    decision: ApprovalDecision = Field(ApprovalDecision.PENDING, description="Current decision status")
    requested_at: datetime
    decided_at: Optional[datetime] = None
    decided_by: Optional[str] = None
    reason: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)


class ApprovalDecisionPayload(BaseModel):
    """Payload submitted by the user/operator to grant or deny an approval."""
    decision: ApprovalDecision
    decided_by: str = "operator"
    reason: Optional[str] = None
