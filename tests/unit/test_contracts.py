"""Unit tests for Command Center contracts."""

import unittest
from datetime import datetime

from packages.contracts import (
    AgentCapabilities,
    AgentDescriptor,
    AgentExecutionRequest,
    AgentExecutionResult,
    AgentType,
    ApprovalDecision,
    ApprovalRequest,
    PolicyMode,
    RiskLevel,
    TaskCreate,
    TaskStatus,
)


class TestContracts(unittest.TestCase):
    """Test schema instantiation, defaults, and validation."""

    def test_task_create_defaults(self):
        task = TaskCreate(
            title="Refactor auth middleware",
            description="Replace legacy token parser with JWT validator",
        )
        self.assertEqual(task.title, "Refactor auth middleware")
        self.assertEqual(task.policy_mode, PolicyMode.AUTO_LOW_IMPACT)
        self.assertTrue(task.use_worktree)
        self.assertEqual(task.timeout_seconds, 3600)

    def test_agent_descriptor_serialization(self):
        capabilities = AgentCapabilities(
            supports_acp=True,
            supports_mcp=True,
            supports_headless=True,
            supports_json_output=True,
        )
        descriptor = AgentDescriptor(
            agent_type=AgentType.OPENCODE,
            name="OpenCode Desktop CLI",
            executable_path="C:\\mock\\opencode-cli.exe",
            version="2.3.2",
            is_available=True,
            capabilities=capabilities,
        )
        data = descriptor.model_dump()
        self.assertEqual(data["agent_type"], "OPENCODE")
        self.assertTrue(data["capabilities"]["supports_headless"])

    def test_approval_request(self):
        req = ApprovalRequest(
            id="app_123",
            task_id="tsk_456",
            run_id="run_789",
            action_type="git_push",
            command_or_path="git push origin main",
            description="Push local worktree branch to remote repository",
            risk_level=RiskLevel.HIGH,
            requested_at=datetime.utcnow(),
        )
        self.assertEqual(req.decision, ApprovalDecision.PENDING)
        self.assertEqual(req.risk_level, RiskLevel.HIGH)


if __name__ == "__main__":
    unittest.main()
