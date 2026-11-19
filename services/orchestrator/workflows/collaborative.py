"""Collaborative Bilateral Multi-Agent Workflow Engine.

Coordinates Google Antigravity (Architect & Quality Inspector) and OpenCode
(Implementer & Worker) through an iterative proposal, peer review, negotiation,
worktree execution, and verification sign-off loop with live event streaming.
"""

from __future__ import annotations

import json
import logging
import subprocess
import uuid
from datetime import datetime
from pathlib import Path
from typing import Optional

from packages.contracts import (
    AgentExecutionRequest,
    AgentExecutionResult,
    AgentType,
    PolicyMode,
    TaskStatus,
    WorkflowMessage,
    WorkflowPhase,
    WorkflowRunRead,
)
from services.agent_bridge import AgentRegistry, BaseAgentAdapter
from services.orchestrator.db import (
    AgentRunModel,
    AuditLogModel,
    ErrorLogModel,
    TaskModel,
    WorkflowMessageModel,
    WorkflowRunModel,
    get_db_session,
)
from services.orchestrator.events import EventSink
from services.orchestrator.workspace import WorkspaceManager

logger = logging.getLogger("orchestrator.collaborative")


class CollaborativeWorkflowEngine:
    """Orchestrates bilateral negotiation and verification between Antigravity and OpenCode."""

    def __init__(
        self,
        registry: Optional[AgentRegistry] = None,
        workspace_mgr: Optional[WorkspaceManager] = None,
    ) -> None:
        self.registry = registry or AgentRegistry()
        self.workspace_mgr = workspace_mgr or WorkspaceManager()

    def _extract_text_content(
        self,
        raw_output: str,
        result: Optional[AgentExecutionResult] = None,
    ) -> str:
        """Extract clean text content from structured result, JSON, or plain text stdout."""
        if result and result.structured_output:
            final_text = result.structured_output.get("final_text")
            if isinstance(final_text, str) and final_text.strip():
                return final_text.strip()

        if not raw_output or not raw_output.strip():
            return ""
        trimmed = raw_output.strip()

        # 1. Try full JSON parse (single JSON payload)
        try:
            data = json.loads(trimmed)
            if isinstance(data, dict):
                extracted = self._pick_text_from_obj(data)
                if extracted:
                    return extracted
        except Exception:
            pass

        # 2. Try line-by-line NDJSON (stream-json / OpenCode JSON lines)
        text_parts = []
        for line in trimmed.split("\n"):
            line = line.strip()
            if not line:
                continue
            if line.startswith("{") and line.endswith("}"):
                try:
                    data = json.loads(line)
                    if data.get("event") == "result" and isinstance(data.get("result"), dict):
                        resp = data["result"].get("response")
                        if isinstance(resp, str) and resp.strip():
                            return resp.strip()
                    extracted = self._pick_text_from_obj(data)
                    if extracted:
                        text_parts.append(extracted)
                except Exception:
                    text_parts.append(line)
            else:
                text_parts.append(line)
        return "\n".join(text_parts).strip()

    @staticmethod
    def _pick_text_from_obj(data: dict) -> Optional[str]:
        part = data.get("part")
        if isinstance(part, dict) and part.get("type") == "text" and isinstance(part.get("text"), str):
            if part["text"].strip():
                return part["text"].strip()
        for key in ("response", "content", "text", "message"):
            val = data.get(key)
            if isinstance(val, str) and val.strip():
                return val.strip()
        if isinstance(part, dict) and isinstance(part.get("text"), str) and part["text"].strip():
            return part["text"].strip()
        return None

    def _record_error(
        self,
        task_id: str,
        workflow_id: str,
        source: str,
        title: str,
        message: str,
        stderr: Optional[str] = None,
        severity: str = "ERROR",
    ) -> None:
        """Record structured error for the Error Messages Center."""
        with get_db_session() as session:
            session.add(ErrorLogModel(
                task_id=task_id, run_id=workflow_id, source=source, severity=severity,
                title=title, message=message, stderr=stderr, resolved=False,
            ))
            session.add(AuditLogModel(
                task_id=task_id, run_id=workflow_id, event_type="SYSTEM_ERROR",
                message=f"[{source}] {title}: {message}",
            ))

    def _fail_workflow(self, workflow_id: str, task_id: str, reason: str) -> None:
        """Mark workflow and parent task as FAILED with detailed diagnostic reason."""
        self._update_phase(workflow_id, WorkflowPhase.FAILED, status="FAILED", report=reason)
        with get_db_session() as session:
            t = session.query(TaskModel).filter_by(id=task_id).first()
            if t and t.status != TaskStatus.CANCELLED.value:
                t.status = TaskStatus.FAILED.value
                t.updated_at = datetime.utcnow()

    def _record_message(
        self,
        workflow_id: str,
        sender: AgentType,
        recipient: AgentType,
        phase: WorkflowPhase,
        content: str,
    ) -> None:
        """Persist a message in the collaborative conversation history."""
        with get_db_session() as session:
            session.add(WorkflowMessageModel(
                workflow_run_id=workflow_id, sender=sender.value, recipient=recipient.value,
                phase=phase.value, content=content, created_at=datetime.utcnow(),
            ))

    def _update_phase(
        self,
        workflow_id: str,
        phase: WorkflowPhase,
        status: str = "RUNNING",
        is_verified: bool = False,
        report: Optional[str] = None,
    ) -> None:
        """Update workflow progress state."""
        with get_db_session() as session:
            wf = session.query(WorkflowRunModel).filter_by(id=workflow_id).first()
            if wf:
                wf.current_phase = phase.value
                wf.status = status
                wf.is_verified = is_verified
                if report:
                    wf.verification_report = report
                wf.updated_at = datetime.utcnow()

    def _run_stage(
        self,
        workflow_id: str,
        task_id: str,
        adapter: BaseAgentAdapter,
        recipient: AgentType,
        phase: WorkflowPhase,
        stage_label: str,
        req: AgentExecutionRequest,
        severity: str = "CRITICAL",
    ) -> Optional[str]:
        """Run one collaborative stage with live event streaming and strict failure checks."""
        agent_val = adapter.agent_type.value
        source = f"{agent_val}_CLI"
        self._update_phase(workflow_id, phase)

        with get_db_session() as session:
            session.add(AgentRunModel(
                id=req.run_id, task_id=task_id, agent_type=agent_val,
                status="RUNNING", started_at=datetime.utcnow(),
            ))

        sink = EventSink(task_id=task_id, run_id=req.run_id, agent=agent_val, phase=phase.value)
        res = adapter.execute(req, on_event=sink)
        sink.flush()

        cancelled = False
        with get_db_session() as session:
            t = session.query(TaskModel).filter_by(id=task_id).first()
            cancelled = bool(t and t.status == TaskStatus.CANCELLED.value)
            run_rec = session.query(AgentRunModel).filter_by(id=req.run_id).first()
            if run_rec:
                run_rec.status = TaskStatus.CANCELLED.value if cancelled else res.status.value
                run_rec.exit_code = res.exit_code
                run_rec.stdout = res.stdout
                run_rec.stderr = res.stderr
                run_rec.duration_seconds = res.duration_seconds
                run_rec.error_reason = "Cancelled by operator" if cancelled else res.error_reason
                run_rec.completed_at = datetime.utcnow()

        if cancelled:
            return None

        if res.status != TaskStatus.COMPLETED or res.exit_code != 0:
            err_msg = res.error_reason or res.stderr or f"{agent_val} exited with code {res.exit_code}"
            self._record_error(task_id, workflow_id, source, f"{stage_label} Failed", err_msg, res.stderr, severity)
            self._record_message(
                workflow_id=workflow_id, sender=adapter.agent_type, recipient=recipient, phase=phase,
                content=f"❌ [{stage_label} Failed — {agent_val} Error]\nExit Code: {res.exit_code}\nError: {err_msg}\nStderr:\n{res.stderr or '(no stderr)'}",
            )
            self._fail_workflow(workflow_id, task_id, f"{stage_label} failed: {err_msg}")
            return None

        text = self._extract_text_content(res.stdout, res)
        if not text:
            err_msg = f"{agent_val} completed {stage_label} but output was empty."
            self._record_error(task_id, workflow_id, source, f"Empty {stage_label} Output", err_msg, res.stderr)
            self._fail_workflow(workflow_id, task_id, err_msg)
            return None

        self._record_message(
            workflow_id=workflow_id, sender=adapter.agent_type, recipient=recipient, phase=phase, content=text,
        )
        return text

    def run_collaborative_workflow(self, task_id: str) -> WorkflowRunRead:
        """Run the 4-stage bilateral negotiation and verification workflow."""
        workflow_id = f"wf_{uuid.uuid4().hex[:12]}"
        now = datetime.utcnow()

        with get_db_session() as session:
            task = session.query(TaskModel).filter_by(id=task_id).first()
            if not task:
                raise ValueError(f"Task not found: {task_id}")
            task_title, task_desc = task.title, task.description
            working_dir = (
                task.project.root_path
                if (task.project and task.project.root_path)
                else str(Path(__file__).resolve().parents[3])
            )
            session.add(WorkflowRunModel(
                id=workflow_id, task_id=task_id, status="RUNNING",
                current_phase=WorkflowPhase.INSPECTION.value, created_at=now, updated_at=now,
            ))
            task.status = TaskStatus.RUNNING.value
            task.updated_at = now
            session.add(AuditLogModel(
                task_id=task_id, event_type="WORKFLOW_STARTED",
                message="Collaborative bilateral workflow initiated (Antigravity <-> OpenCode)",
            ))

        antigravity_adapter = self.registry.get_adapter(AgentType.ANTIGRAVITY)
        opencode_adapter = self.registry.get_adapter(AgentType.OPENCODE)
        if not antigravity_adapter or not opencode_adapter:
            raise RuntimeError("Both Antigravity and OpenCode adapters must be available for collaboration.")

        # STAGE 1: INSPECTION & PROPOSAL (Antigravity)
        proposal_text = self._run_stage(
            workflow_id, task_id, antigravity_adapter, AgentType.OPENCODE,
            WorkflowPhase.INSPECTION, "Stage 1 Inspection",
            AgentExecutionRequest(
                task_id=task_id, run_id=f"run_{uuid.uuid4().hex[:8]}",
                prompt=(
                    f"You are the Lead Architect inspecting task: '{task_title}'.\n"
                    f"Requirements:\n{task_desc}\n\n"
                    "Analyze the codebase requirements and formulate a structured, concise technical proposal "
                    "and execution plan for OpenCode to review."
                ),
                working_directory=working_dir, policy_mode=PolicyMode.AUTO_LOW_IMPACT, timeout_seconds=300,
            ),
        )
        if proposal_text is None:
            return self.get_workflow_run(workflow_id)  # type: ignore

        # STAGE 2: PEER REVIEW & NEGOTIATION (OpenCode)
        negotiation_text = self._run_stage(
            workflow_id, task_id, opencode_adapter, AgentType.ANTIGRAVITY,
            WorkflowPhase.NEGOTIATION, "Stage 2 Peer Review",
            AgentExecutionRequest(
                task_id=task_id, run_id=f"run_{uuid.uuid4().hex[:8]}",
                prompt=(
                    f"Antigravity has proposed the following technical plan for task '{task_title}':\n"
                    f"---\n{proposal_text}\n---\n\n"
                    "Review this plan. Do you agree with these steps, or do you have refinements or critiques?\n"
                    "If you agree, state 'AGREED' and summarize the locked execution steps."
                ),
                working_directory=working_dir, policy_mode=PolicyMode.AUTO_LOW_IMPACT, timeout_seconds=300,
            ),
        )
        if negotiation_text is None:
            return self.get_workflow_run(workflow_id)  # type: ignore

        # STAGE 3: ISOLATED WORKTREE EXECUTION (OpenCode)
        self._update_phase(workflow_id, WorkflowPhase.EXECUTION)
        worktree_dir, worktree_name = working_dir, None
        if working_dir:
            try:
                wt_path = self.workspace_mgr.create_worktree(
                    project_root=working_dir, task_id=task_id, branch_name=f"collab-{task_id[:8]}",
                )
                worktree_dir, worktree_name = str(wt_path), wt_path.name
                with get_db_session() as session:
                    t = session.query(TaskModel).filter_by(id=task_id).first()
                    if t:
                        t.worktree_path = worktree_dir
            except Exception as exc:
                logger.warning("Could not allocate worktree, falling back to project root: %s", exc)

        execution_text = self._run_stage(
            workflow_id, task_id, opencode_adapter, AgentType.ANTIGRAVITY,
            WorkflowPhase.EXECUTION, "Stage 3 Execution",
            AgentExecutionRequest(
                task_id=task_id, run_id=f"run_{uuid.uuid4().hex[:8]}",
                prompt=(
                    f"Consensus reached between Antigravity and OpenCode for '{task_title}'.\n"
                    f"Execute the agreed plan in this repository:\n"
                    f"---\n{negotiation_text}\n---\n"
                    "Implement all required code changes, checks, and updates."
                ),
                working_directory=worktree_dir, worktree_name=worktree_name,
                policy_mode=PolicyMode.AUTO_LOW_IMPACT, timeout_seconds=600,
            ),
        )
        if execution_text is None:
            return self.get_workflow_run(workflow_id)  # type: ignore

        # STAGE 4: VERIFICATION & SIGN-OFF (Antigravity)
        git_diff = ""
        if worktree_dir != ".":
            try:
                diff_res = subprocess.run(["git", "diff", "HEAD"], cwd=worktree_dir, capture_output=True, text=True)
                git_diff = diff_res.stdout[:4000]
            except Exception:
                git_diff = "(diff unavailable)"

        verification_text = self._run_stage(
            workflow_id, task_id, antigravity_adapter, AgentType.OPENCODE,
            WorkflowPhase.VERIFICATION, "Stage 4 Verification",
            AgentExecutionRequest(
                task_id=task_id, run_id=f"run_{uuid.uuid4().hex[:8]}",
                prompt=(
                    f"OpenCode has finished executing task '{task_title}'.\n\n"
                    f"Git Changes / Diff:\n{git_diff or 'No uncommitted diff'}\n\n"
                    f"Execution Summary:\n{execution_text[:2000]}\n\n"
                    "Inspect the outcome. Is the implementation 100% accurate, complete, and free of regressions?\n"
                    "Provide your final verification sign-off report."
                ),
                working_directory=worktree_dir, policy_mode=PolicyMode.AUTO_LOW_IMPACT, timeout_seconds=300,
            ),
            severity="WARNING",
        )
        if verification_text is None:
            return self.get_workflow_run(workflow_id)  # type: ignore

        self._update_phase(workflow_id, WorkflowPhase.COMPLETED, status="COMPLETED",
                           is_verified=True, report=verification_text)
        with get_db_session() as session:
            t_done = session.query(TaskModel).filter_by(id=task_id).first()
            if t_done:
                t_done.status = TaskStatus.COMPLETED.value
                t_done.completed_at = datetime.utcnow()
                t_done.worktree_path = worktree_dir
            session.add(AuditLogModel(
                task_id=task_id, event_type="WORKFLOW_COMPLETED",
                message="Collaborative bilateral workflow verified and signed off by Antigravity.",
            ))
        return self.get_workflow_run(workflow_id)  # type: ignore

    def get_workflow_run(self, workflow_id: str) -> Optional[WorkflowRunRead]:
        """Fetch full workflow run details and message transcript."""
        with get_db_session() as session:
            wf = session.query(WorkflowRunModel).filter_by(id=workflow_id).first()
            if not wf:
                return None
            messages = [
                WorkflowMessage(
                    id=m.id, sender=AgentType(m.sender), recipient=AgentType(m.recipient),
                    phase=WorkflowPhase(m.phase), content=m.content, created_at=m.created_at,
                )
                for m in wf.messages
            ]
            return WorkflowRunRead(
                id=wf.id, task_id=wf.task_id, status=wf.status,
                current_phase=WorkflowPhase(wf.current_phase), is_verified=wf.is_verified,
                verification_report=wf.verification_report, messages=messages,
                created_at=wf.created_at, updated_at=wf.updated_at,
            )
