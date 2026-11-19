"""Google Antigravity agent adapter implementation."""

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
from services.agent_bridge.antigravity.stream_parser import parse_antigravity_line
from services.agent_bridge.streaming import ActivityEvent


class AntigravityAdapter(BaseAgentAdapter):
    """Adapter bridging the Command Center to Google Antigravity CLI."""

    agent_type = AgentType.ANTIGRAVITY

    CANDIDATE_PATHS = [
        Path.home() / ".gemini" / "bin" / "agy.exe",
    ]

    def _resolve_executable(self) -> Optional[str]:
        """Locate verified Antigravity executable."""
        for path in self.CANDIDATE_PATHS:
            if path.exists():
                return str(path)

        which_path = shutil.which("agy")
        if which_path:
            return which_path
        return None

    def detect(self) -> Optional[AgentDescriptor]:
        """Verify Antigravity installation and query its version."""
        exe = self._resolve_executable()
        if not exe:
            return AgentDescriptor(
                agent_type=self.agent_type,
                name="Google Antigravity CLI",
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
            supports_worktrees=False,
            supports_cancellation=True,
            supports_session_resume=True,
        )

        return AgentDescriptor(
            agent_type=self.agent_type,
            name="Google Antigravity CLI",
            executable_path=exe,
            version=version,
            is_available=True,
            capabilities=capabilities,
            notes="Google Antigravity CLI with native ACP and print modes.",
        )

    def build_command(self, request: AgentExecutionRequest) -> List[str]:
        """Assemble command line arguments for non-interactive Antigravity prompt execution."""
        exe = self._resolve_executable() or "agy"
        cmd = [
            exe,
            "-p",
            request.prompt,
            "--output-format",
            "stream-json",
            "--print-timeout",
            f"{request.timeout_seconds}s",
        ]

        try:
            wd = Path(request.working_directory).resolve()
        except OSError:
            wd = None

        add_dirs: List[str] = []
        seen = set()

        def _maybe_add_dir(raw_dir: str) -> None:
            try:
                p = Path(raw_dir).resolve()
            except OSError:
                return
            if not p.exists():
                return
            target = p if p.is_dir() else p.parent
            if wd is not None and target == wd:
                return
            if wd is not None:
                try:
                    target.relative_to(wd)
                    return
                except ValueError:
                    pass
            s = str(target)
            if s not in seen:
                seen.add(s)
                add_dirs.append(s)

        for raw_dir in (request.extra_flags or {}).get("add_dirs", []) or []:
            if isinstance(raw_dir, str) and raw_dir.strip():
                _maybe_add_dir(raw_dir.strip())

        for cf in request.context_files or []:
            p_cf = Path(cf)
            if p_cf.is_absolute():
                _maybe_add_dir(cf)

        for d in add_dirs:
            cmd.extend(["--add-dir", d])

        if request.policy_mode in (PolicyMode.AUTO_LOW_IMPACT, PolicyMode.ALLOW_ALL):
            cmd.append("--dangerously-skip-permissions")

        return cmd

    def parse_stream_line(self, line: str) -> List[ActivityEvent]:
        """Translate Antigravity stream-json events into normalized activity events."""
        return parse_antigravity_line(line)
