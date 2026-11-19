"""Enumerations for system contracts and state transitions."""

from enum import Enum


class TaskStatus(str, Enum):
    """Lifecycle state of a task in the command center."""
    PENDING = "PENDING"
    RUNNING = "RUNNING"
    AWAITING_APPROVAL = "AWAITING_APPROVAL"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"
    TIMED_OUT = "TIMED_OUT"


class AgentType(str, Enum):
    """Supported agent implementations."""
    OPENCODE = "OPENCODE"
    ANTIGRAVITY = "ANTIGRAVITY"
    CLAUDE_CODE = "CLAUDE_CODE"
    CODEX = "CODEX"
    QWEN_CODE = "QWEN_CODE"
    OPENCLAW = "OPENCLAW"


class ApprovalDecision(str, Enum):
    """Decision state for human-in-the-loop approvals."""
    PENDING = "PENDING"
    APPROVED = "APPROVED"
    DENIED = "DENIED"


class PolicyMode(str, Enum):
    """Autonomy and security policy enforcement modes."""
    STRICT = "STRICT"                      # Deny all high-impact actions automatically
    ASK = "ASK"                            # Require human confirmation for tool/write actions
    AUTO_LOW_IMPACT = "AUTO_LOW_IMPACT"    # Auto-allow reads/edits in worktree; ask for git push / deploy
    ALLOW_ALL = "ALLOW_ALL"                # Auto-approve (sandboxes only)


class RiskLevel(str, Enum):
    """Risk classification for tool actions."""
    READ = "READ"
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    DESTRUCTIVE = "DESTRUCTIVE"
