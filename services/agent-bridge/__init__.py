"""Agent bridge module exports."""

from services.agent_bridge.antigravity import AntigravityAdapter
from services.agent_bridge.base import BaseAgentAdapter
from services.agent_bridge.claude import ClaudeCodeAdapter
from services.agent_bridge.opencode import OpenCodeAdapter
from services.agent_bridge.qwen import QwenCodeAdapter
from services.agent_bridge.registry import AgentRegistry

__all__ = [
    "BaseAgentAdapter",
    "OpenCodeAdapter",
    "AntigravityAdapter",
    "ClaudeCodeAdapter",
    "QwenCodeAdapter",
    "AgentRegistry",
]
