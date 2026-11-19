"""Claude Code agent adapter implementation."""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path
from typing import List, Optional

from packages.contracts.agent import (
    AgentCapabilities,
    AgentDescriptor,
    AgentExecutionRequest,
)
from packages.contracts.enums import AgentType, PolicyMode
from services.agent_bridge.base import BaseAgentAdapter


class ClaudeCodeAdapter(BaseAgentAdapter):
    """Adapter bridging the Command Center to Claude Code CLI."""

    agent_type = AgentType.CLAUDE_CODE

    CANDIDATE_PATHS = [
        Path.home() / ".local" / "bin" / "claude.exe",
    ]

    def _resolve_executable(self) -> Optional[str]:
        """Locate verified Claude Code executable."""
        for path in self.CANDIDATE_PATHS:
            if path.exists():
                return str(path)

        which_path = shutil.which("claude")
        if which_path:
            return which_path
        return None

    def detect(self) -> Optional[AgentDescriptor]:
        """Verify Claude Code installation and query its version."""
        exe = self._resolve_executable()
        if not exe:
            return AgentDescriptor(
                agent_type=self.agent_type,
                name="Claude Code CLI",
                executable_path="",
                version="not_installed",
                is_available=False,
                capabilities=AgentCapabilities(),
            )

        version = "unknown"
        try:
            res = subprocess.run([exe, "--version"], capture_output=True, text=True, timeout=5)
            if res.returncode == 0:
                version = res.stdout.strip()
        except Exception:
            return None

        capabilities = AgentCapabilities(
            supports_acp=False,
            supports_mcp=True,
            supports_headless=True,
            supports_json_output=True,
            supports_worktrees=True,
            supports_cancellation=True,
            supports_session_resume=True,
        )

        return AgentDescriptor(
            agent_type=self.agent_type,
            name="Claude Code CLI",
            executable_path=exe,
            version=version,
            is_available=True,
            capabilities=capabilities,
            notes="Claude Code with native print mode and worktree flags.",
        )

    def build_command(self, request: AgentExecutionRequest) -> List[str]:
        """Assemble command line arguments for non-interactive Claude Code execution."""
        exe = self._resolve_executable() or "claude"
        cmd = [exe, "-p", request.prompt, "--output-format", "json"]

        if request.worktree_name:
            cmd.extend(["--worktree", request.worktree_name])

        if request.policy_mode in (PolicyMode.AUTO_LOW_IMPACT, PolicyMode.ALLOW_ALL):
            cmd.append("--dangerously-skip-permissions")

        for file_path in request.context_files:
            cmd.extend(["--add-dir", file_path])

        return cmd
