"""Base adapter interface for coding agents."""

from __future__ import annotations

import abc
import subprocess
import time
from typing import Dict, List, Optional

from packages.contracts.agent import (
    AgentDescriptor,
    AgentExecutionRequest,
    AgentExecutionResult,
)
from packages.contracts.enums import AgentType, TaskStatus


class BaseAgentAdapter(abc.ABC):
    """Abstract base class that all agent bridges must implement."""

    agent_type: AgentType

    def __init__(self) -> None:
        self._active_processes: Dict[str, subprocess.Popen] = {}

    @abc.abstractmethod
    def detect(self) -> Optional[AgentDescriptor]:
        """Detect if agent is installed and return its descriptor."""
        raise NotImplementedError

    @abc.abstractmethod
    def build_command(self, request: AgentExecutionRequest) -> List[str]:
        """Build the command line argument list for executing a task."""
        raise NotImplementedError

    def execute(self, request: AgentExecutionRequest) -> AgentExecutionResult:
        """Execute a task request non-interactively and return the structured result."""
        descriptor = self.detect()
        if not descriptor or not descriptor.is_available:
            return AgentExecutionResult(
                task_id=request.task_id,
                run_id=request.run_id,
                agent_type=self.agent_type,
                status=TaskStatus.FAILED,
                exit_code=1,
                stdout="",
                stderr="Agent executable is not available on this machine.",
                duration_seconds=0.0,
                error_reason="AGENT_UNAVAILABLE",
            )

        cmd = self.build_command(request)
        start_time = time.time()
        status = TaskStatus.COMPLETED
        exit_code = 0
        stdout_text = ""
        stderr_text = ""
        error_reason: Optional[str] = None

        try:
            process = subprocess.Popen(
                cmd,
                cwd=request.working_directory,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                encoding="utf-8",
                errors="replace",
            )
            self._active_processes[request.run_id] = process

            stdout_text, stderr_text = process.communicate(timeout=request.timeout_seconds)
            exit_code = process.returncode

            if exit_code != 0:
                status = TaskStatus.FAILED
                error_reason = f"Process exited with non-zero code {exit_code}"

        except subprocess.TimeoutExpired:
            self.cancel(request.run_id)
            status = TaskStatus.TIMED_OUT
            error_reason = f"Execution timed out after {request.timeout_seconds} seconds"
            exit_code = 124
        except Exception as exc:
            status = TaskStatus.FAILED
            error_reason = str(exc)
            exit_code = 1
        finally:
            self._active_processes.pop(request.run_id, None)

        duration = time.time() - start_time
        return AgentExecutionResult(
            task_id=request.task_id,
            run_id=request.run_id,
            agent_type=self.agent_type,
            status=status,
            exit_code=exit_code,
            stdout=stdout_text,
            stderr=stderr_text,
            duration_seconds=duration,
            error_reason=error_reason,
        )

    def cancel(self, run_id: str) -> bool:
        """Terminate an active running agent process."""
        process = self._active_processes.get(run_id)
        if process and process.poll() is None:
            try:
                process.terminate()
                time.sleep(0.5)
                if process.poll() is None:
                    process.kill()
                return True
            except Exception:
                return False
        return False
