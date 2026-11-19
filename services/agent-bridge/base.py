"""Base adapter interface for coding agents, with live line-by-line event streaming."""

from __future__ import annotations

import abc
import subprocess
import threading
import time
from typing import Dict, List, Optional

from packages.contracts.agent import (
    AgentDescriptor,
    AgentExecutionRequest,
    AgentExecutionResult,
)
from packages.contracts.enums import AgentType, TaskStatus
from services.agent_bridge.streaming import ActivityEvent, EventCallback, clip


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

    def parse_stream_line(self, line: str) -> List[ActivityEvent]:
        """Translate one stdout line into activity events. Override per agent format."""
        text = line.strip()
        if not text:
            return []
        return [ActivityEvent(key=f"log-{time.time_ns()}", kind="log", content=clip(text))]

    def execute(
        self,
        request: AgentExecutionRequest,
        on_event: Optional[EventCallback] = None,
    ) -> AgentExecutionResult:
        """Run the agent non-interactively, streaming each stdout line as it arrives."""
        descriptor = self.detect()
        if not descriptor or not descriptor.is_available:
            return self._result(request, TaskStatus.FAILED, 1, "", "Agent executable is not available.",
                                0.0, "AGENT_UNAVAILABLE", None)

        emit = on_event or (lambda _e: None)
        cmd = self.build_command(request)
        start = time.time()
        stdout_lines: List[str] = []
        stderr_chunks: List[str] = []
        texts: Dict[str, str] = {}
        final_text: Optional[str] = None
        timed_out = threading.Event()

        try:
            process = subprocess.Popen(
                cmd, cwd=request.working_directory, stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                text=True, encoding="utf-8", errors="replace", bufsize=1,
            )
        except Exception as exc:  # executable missing, bad cwd, etc.
            emit(ActivityEvent(key="spawn-error", kind="error", status="failed", content=str(exc)))
            return self._result(request, TaskStatus.FAILED, 1, "", str(exc), 0.0, str(exc), None)

        self._active_processes[request.run_id] = process
        emit(ActivityEvent(key="process", kind="system", status="running",
                           title=f"{descriptor.name} started (pid {process.pid})"))

        def _drain_stderr() -> None:
            for chunk in process.stderr:  # type: ignore[union-attr]
                stderr_chunks.append(chunk)

        def _on_timeout() -> None:
            timed_out.set()
            self.cancel(request.run_id)

        err_thread = threading.Thread(target=_drain_stderr, daemon=True)
        err_thread.start()
        timer = threading.Timer(request.timeout_seconds, _on_timeout)
        timer.start()

        try:
            for line in process.stdout:  # type: ignore[union-attr]
                stdout_lines.append(line)
                for event in self._safe_parse(line):
                    if event.kind == "final":
                        final_text = event.content
                        continue
                    if event.kind == "text":
                        texts[event.key] = (texts.get(event.key, "") + (event.content or "")
                                            if event.append else (event.content or ""))
                    emit(event)
            process.wait()
        finally:
            timer.cancel()
            err_thread.join(timeout=5)
            self._active_processes.pop(request.run_id, None)

        duration = time.time() - start
        exit_code = process.returncode if process.returncode is not None else 1
        stderr_text = "".join(stderr_chunks)
        status, reason = TaskStatus.COMPLETED, None
        if timed_out.is_set():
            status, exit_code = TaskStatus.TIMED_OUT, 124
            reason = f"Execution timed out after {request.timeout_seconds} seconds"
        elif exit_code != 0:
            status, reason = TaskStatus.FAILED, f"Process exited with non-zero code {exit_code}"

        if final_text is None and texts:
            final_text = "\n\n".join(t.strip() for t in texts.values() if t.strip())
        emit(ActivityEvent(key="process", kind="system",
                           status="done" if status == TaskStatus.COMPLETED else "failed",
                           title=f"{descriptor.name} finished — exit {exit_code} in {duration:.1f}s",
                           content=clip(stderr_text) if status != TaskStatus.COMPLETED else None,
                           duration_seconds=duration))
        return self._result(request, status, exit_code, "".join(stdout_lines), stderr_text,
                            duration, reason, {"final_text": final_text or ""})

    def _safe_parse(self, line: str) -> List[ActivityEvent]:
        try:
            return self.parse_stream_line(line)
        except Exception:
            return BaseAgentAdapter.parse_stream_line(self, line)

    def _result(self, request, status, exit_code, stdout, stderr, duration, reason, structured):
        return AgentExecutionResult(
            task_id=request.task_id, run_id=request.run_id, agent_type=self.agent_type,
            status=status, exit_code=exit_code, stdout=stdout, stderr=stderr,
            duration_seconds=duration, error_reason=reason, structured_output=structured,
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
