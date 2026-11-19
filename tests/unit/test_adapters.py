"""Unit tests for agent bridge adapters."""

import unittest

from packages.contracts import (
    AgentExecutionRequest,
    AgentType,
    PolicyMode,
)
from services.agent_bridge import (
    AgentRegistry,
    AntigravityAdapter,
    OpenCodeAdapter,
)


class TestAdapters(unittest.TestCase):
    """Test adapter command formulation and detection."""

    def test_opencode_command_builder(self):
        adapter = OpenCodeAdapter()
        req = AgentExecutionRequest(
            task_id="tsk_test_1",
            run_id="run_test_1",
            prompt="Fix formatting in main.py",
            working_directory="C:\\test\\repo",
            worktree_name="feature-format",
            policy_mode=PolicyMode.AUTO_LOW_IMPACT,
            context_files=["main.py", "utils.py"],
        )
        cmd = adapter.build_command(req)
        self.assertIn("run", cmd)
        self.assertIn("--format", cmd)
        self.assertIn("json", cmd)
        self.assertIn("--auto", cmd)
        self.assertIn("--worktree", cmd)
        self.assertIn("feature-format", cmd)
        self.assertIn("--file", cmd)
        self.assertIn("Fix formatting in main.py", cmd)

    def test_antigravity_command_builder(self):
        adapter = AntigravityAdapter()
        req = AgentExecutionRequest(
            task_id="tsk_test_2",
            run_id="run_test_2",
            prompt="Analyze architectural boundaries",
            working_directory="C:\\test\\repo",
            policy_mode=PolicyMode.AUTO_LOW_IMPACT,
            timeout_seconds=120,
        )
        cmd = adapter.build_command(req)
        self.assertIn("-p", cmd)
        self.assertIn("Analyze architectural boundaries", cmd)
        self.assertIn("--output-format", cmd)
        self.assertIn("json", cmd)
        self.assertIn("--print-timeout", cmd)
        self.assertIn("120s", cmd)
        self.assertIn("--dangerously-skip-permissions", cmd)

    def test_registry_discovery(self):
        registry = AgentRegistry()
        available = registry.get_available_agents()
        agent_types = [a.agent_type for a in available]
        self.assertIn(AgentType.OPENCODE, agent_types)
        self.assertIn(AgentType.ANTIGRAVITY, agent_types)
        self.assertIn(AgentType.CLAUDE_CODE, agent_types)
        self.assertIn(AgentType.QWEN_CODE, agent_types)

    def test_claude_command_builder(self):
        from services.agent_bridge.claude import ClaudeCodeAdapter
        adapter = ClaudeCodeAdapter()
        req = AgentExecutionRequest(
            task_id="tsk_claude_1",
            run_id="run_claude_1",
            prompt="Refactor database models",
            working_directory="C:\\test\\repo",
            worktree_name="feature-db",
            policy_mode=PolicyMode.AUTO_LOW_IMPACT,
            context_files=["C:\\test\\repo\\models.py"],
        )
        cmd = adapter.build_command(req)
        self.assertIn("-p", cmd)
        self.assertIn("Refactor database models", cmd)
        self.assertIn("--worktree", cmd)
        self.assertIn("feature-db", cmd)
        self.assertIn("--dangerously-skip-permissions", cmd)

    def test_qwen_command_builder(self):
        from services.agent_bridge.qwen import QwenCodeAdapter
        adapter = QwenCodeAdapter()
        req = AgentExecutionRequest(
            task_id="tsk_qwen_1",
            run_id="run_qwen_1",
            prompt="Write tests for payment api",
            working_directory="C:\\test\\repo",
            worktree_name="test-payment",
        )
        cmd = adapter.build_command(req)
        self.assertIn("--output-format", cmd)
        self.assertIn("json", cmd)
        self.assertIn("--worktree", cmd)
        self.assertIn("test-payment", cmd)
        self.assertIn("Write tests for payment api", cmd)


if __name__ == "__main__":
    unittest.main()
