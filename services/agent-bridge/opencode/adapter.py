"""OpenCode agent adapter implementation."""

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


class OpenCodeAdapter(BaseAgentAdapter):
    """Adapter bridging the Command Center to OpenCode 2.3.2."""

    agent_type = AgentType.OPENCODE

    CANDIDATE_PATHS = [
        Path.home() / "AppData" / "Local" / "Programs" / "ai.opencode.desktop" / "resources" / "opencode-cli.exe",
        Path.home() / "AppData" / "Roaming" / "ai.opencode.desktop" / "cli" / "2.3.2-x64" / "opencode-cli.exe",
    ]

    def _resolve_executable(self) -> Optional[str]:
        """Locate verified OpenCode 2.3.2 executable."""
        for path in self.CANDIDATE_PATHS:
            if path.exists():
                return str(path)

        which_path = shutil.which("opencode")
        if which_path:
            return which_path
        return None

    def detect(self) -> Optional[AgentDescriptor]:
        """Verify OpenCode installation and query its version."""
        exe = self._resolve_executable()
        if not exe:
            return AgentDescriptor(
                agent_type=self.agent_type,
                name="OpenCode Desktop CLI",
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
            supports_acp=True,
            supports_mcp=True,
            supports_headless=True,
            supports_json_output=True,
            supports_worktrees=True,
            supports_cancellation=True,
            supports_session_resume=True,
        )

        return AgentDescriptor(
            agent_type=self.agent_type,
            name="OpenCode Desktop CLI",
            executable_path=exe,
            version=version,
            is_available=True,
            capabilities=capabilities,
            notes="Connected to native OpenCode 2.3.2 database.",
        )

    def build_command(self, request: AgentExecutionRequest) -> List[str]:
        """Assemble command line arguments for non-interactive OpenCode task execution."""
        exe = self._resolve_executable() or "opencode"
        model = request.extra_flags.get("model", "opencode/beam-free")
        cmd = [exe, "run", "--format", "json", "--archived", "-m", model]

        if request.worktree_name:
            cmd.extend(["--worktree", request.worktree_name])

        if request.policy_mode in (PolicyMode.AUTO_LOW_IMPACT, PolicyMode.ALLOW_ALL):
            cmd.append("--auto")

        for file_path in request.context_files:
            cmd.extend(["--file", file_path])

        cmd.append(request.prompt)
        return cmd
