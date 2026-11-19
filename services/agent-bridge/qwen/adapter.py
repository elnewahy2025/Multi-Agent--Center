"""Qwen Code agent adapter implementation."""

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
from packages.contracts.enums import AgentType
from services.agent_bridge.base import BaseAgentAdapter


class QwenCodeAdapter(BaseAgentAdapter):
    """Adapter bridging the Command Center to Qwen Code CLI."""

    agent_type = AgentType.QWEN_CODE

    CANDIDATE_PATHS = [
        Path.home() / "AppData" / "Roaming" / "npm" / "qwen.cmd",
    ]

    def _resolve_executable(self) -> Optional[str]:
        """Locate verified Qwen Code executable."""
        for path in self.CANDIDATE_PATHS:
            if path.exists():
                return str(path)

        which_path = shutil.which("qwen")
        if which_path:
            return which_path
        return None

    def detect(self) -> Optional[AgentDescriptor]:
        """Verify Qwen Code installation and query its version."""
        exe = self._resolve_executable()
        if not exe:
            return AgentDescriptor(
                agent_type=self.agent_type,
                name="Qwen Code CLI",
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
            name="Qwen Code CLI",
            executable_path=exe,
            version=version,
            is_available=True,
            capabilities=capabilities,
            notes="Qwen Code with worktree and JSON output support.",
        )

    def build_command(self, request: AgentExecutionRequest) -> List[str]:
        """Assemble command line arguments for non-interactive Qwen execution."""
        exe = self._resolve_executable() or "qwen"
        cmd = [exe, "--output-format", "json"]

        if request.worktree_name:
            cmd.extend(["--worktree", request.worktree_name])

        for dir_path in request.context_files:
            cmd.extend(["--include-directories", dir_path])

        cmd.append(request.prompt)
        return cmd
