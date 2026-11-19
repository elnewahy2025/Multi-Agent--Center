"""Agent adapter registry and discovery service."""

from __future__ import annotations

from typing import Dict, List, Optional

from packages.contracts.agent import AgentDescriptor
from packages.contracts.enums import AgentType
from services.agent_bridge.antigravity.adapter import AntigravityAdapter
from services.agent_bridge.base import BaseAgentAdapter
from services.agent_bridge.claude.adapter import ClaudeCodeAdapter
from services.agent_bridge.opencode.adapter import OpenCodeAdapter
from services.agent_bridge.qwen.adapter import QwenCodeAdapter


class AgentRegistry:
    """Registry maintaining available agent bridges."""

    def __init__(self) -> None:
        self._adapters: Dict[AgentType, BaseAgentAdapter] = {}
        # Register default supported adapters
        self.register(OpenCodeAdapter())
        self.register(AntigravityAdapter())
        self.register(ClaudeCodeAdapter())
        self.register(QwenCodeAdapter())

    def register(self, adapter: BaseAgentAdapter) -> None:
        """Register a new agent adapter."""
        self._adapters[adapter.agent_type] = adapter

    def get_adapter(self, agent_type: AgentType) -> Optional[BaseAgentAdapter]:
        """Retrieve adapter for an agent type."""
        return self._adapters.get(agent_type)

    def list_descriptors(self) -> List[AgentDescriptor]:
        """Detect and return descriptors for all registered agents."""
        descriptors: List[AgentDescriptor] = []
        for adapter in self._adapters.values():
            desc = adapter.detect()
            if desc:
                descriptors.append(desc)
        return descriptors

    def get_available_agents(self) -> List[AgentDescriptor]:
        """Return only agents currently verified and installed on this machine."""
        return [d for d in self.list_descriptors() if d.is_available]
