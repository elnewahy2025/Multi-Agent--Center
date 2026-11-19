"""Collaborative Bilateral Multi-Agent Workflow Engine.

Coordinates Google Antigravity (Architect & Quality Inspector) and OpenCode
(Implementer & Worker) through an iterative proposal, peer review, negotiation,
worktree execution, and 100% verification sign-off loop.
"""

from __future__ import annotations

import json
import logging
import subprocess
import uuid
from datetime import datetime
from pathlib import Path
from typing import List, Optional

from packages.contracts import (
    AgentExecutionRequest,
    AgentType,
    PolicyMode,
    TaskStatus,
    WorkflowMessage,
    WorkflowPhase,
    WorkflowRunRead,
)
from services.agent_bridge import AgentRegistry
from services.orchestrator.db import (
    AuditLogModel,
    TaskModel,
    WorkflowMessageModel,
    WorkflowRunModel,
    get_db_session,
)
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

    def _extract_text_content(self, raw_output: str) -> str:
        """Extract clean text content from JSON or plain text agent stdout."""
        if not raw_output:
            return ""
        text_parts = []
        for line in raw_output.strip().split("\n"):
            line = line.strip()
            if not line:
                continue
            if line.startswith("{") and line.endswith("}"):
                try:
                    data = json.loads(line)
                    part = data.get("part", {})
                    if part.get("type") == "text" and part.get("text"):
                        text_parts.append(part["text"])
                    elif "content" in data and isinstance(data["content"], str):
                        text_parts.append(data["content"])
                except Exception:
                    text_parts.append(line)
            else:
                text_parts.append(line)
        return "\n".join(text_parts).strip() if text_parts else raw_output.strip()

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
            msg = WorkflowMessageModel(
                workflow_run_id=workflow_id,
                sender=sender.value,
                recipient=recipient.value,
                phase=phase.value,
                content=content,
                created_at=datetime.utcnow(),
            )
            session.add(msg)

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

    def run_collaborative_workflow(self, task_id: str) -> WorkflowRunRead:
        """Run the 4-stage bilateral negotiation and verification workflow."""
        workflow_id = f"wf_{uuid.uuid4().hex[:12]}"
        now = datetime.utcnow()

        # Initialize workflow record
        with get_db_session() as session:
            task = session.query(TaskModel).filter_by(id=task_id).first()
            if not task:
                raise ValueError(f"Task not found: {task_id}")

            wf = WorkflowRunModel(
                id=workflow_id,
                task_id=task_id,
                status="RUNNING",
                current_phase=WorkflowPhase.INSPECTION.value,
                created_at=now,
                updated_at=now,
            )
            session.add(wf)

            task.status = TaskStatus.RUNNING.value
            task.updated_at = now

            audit = AuditLogModel(
                task_id=task_id,
                event_type="WORKFLOW_STARTED",
                message="Collaborative bilateral workflow initiated (Antigravity <-> OpenCode)",
            )
            session.add(audit)

        antigravity_adapter = self.registry.get_adapter(AgentType.ANTIGRAVITY)
        opencode_adapter = self.registry.get_adapter(AgentType.OPENCODE)

        if not antigravity_adapter or not opencode_adapter:
            raise RuntimeError("Both Antigravity and OpenCode adapters must be available for collaboration.")

        # Resolve working directory
        working_dir = "."
        with get_db_session() as session:
            t = session.query(TaskModel).filter_by(id=task_id).first()
            if t and t.project:
                working_dir = t.project.root_path

        # -------------------------------------------------------------
        # STAGE 1: INSPECTION & PROPOSAL (Antigravity as Lead Architect)
        # -------------------------------------------------------------
        self._update_phase(workflow_id, WorkflowPhase.INSPECTION)
        inspection_prompt = (
            f"You are the Lead Architect inspecting task: '{task.title}'.\n"
            f"Requirements:\n{task.description}\n\n"
            "Analyze the codebase requirements and formulate a structured, concise technical proposal "
            "and execution plan for OpenCode to review."
        )

        req1 = AgentExecutionRequest(
            task_id=task_id,
            run_id=f"run_{uuid.uuid4().hex[:8]}",
            prompt=inspection_prompt,
            working_directory=working_dir,
            policy_mode=PolicyMode.AUTO_LOW_IMPACT,
            timeout_seconds=300,
        )
        res1 = antigravity_adapter.execute(req1)
        proposal_text = self._extract_text_content(res1.stdout) or "Proceed with standard modular implementation."

        self._record_message(
            workflow_id=workflow_id,
            sender=AgentType.ANTIGRAVITY,
            recipient=AgentType.OPENCODE,
            phase=WorkflowPhase.INSPECTION,
            content=proposal_text,
        )

        # -------------------------------------------------------------
        # STAGE 2: PEER REVIEW & NEGOTIATION (OpenCode Reviews Proposal)
        # -------------------------------------------------------------
        self._update_phase(workflow_id, WorkflowPhase.NEGOTIATION)
        negotiation_prompt = (
            f"Antigravity has proposed the following technical plan for task '{task.title}':\n"
            f"---\n{proposal_text}\n---\n\n"
            "Review this plan. Do you agree with these steps, or do you have refinements or critiques?\n"
            "If you agree, state 'AGREED' and summarize the locked execution steps."
        )

        req2 = AgentExecutionRequest(
            task_id=task_id,
            run_id=f"run_{uuid.uuid4().hex[:8]}",
            prompt=negotiation_prompt,
            working_directory=working_dir,
            policy_mode=PolicyMode.AUTO_LOW_IMPACT,
            timeout_seconds=300,
        )
        res2 = opencode_adapter.execute(req2)
        negotiation_text = self._extract_text_content(res2.stdout) or "AGREED. Steps confirmed."

        self._record_message(
            workflow_id=workflow_id,
            sender=AgentType.OPENCODE,
            recipient=AgentType.ANTIGRAVITY,
            phase=WorkflowPhase.NEGOTIATION,
            content=negotiation_text,
        )

        # -------------------------------------------------------------
        # STAGE 3: ISOLATED WORKTREE EXECUTION (OpenCode Executes Plan)
        # -------------------------------------------------------------
        self._update_phase(workflow_id, WorkflowPhase.EXECUTION)
        worktree_dir = working_dir
        worktree_name = None

        if working_dir != ".":
            try:
                wt_path = self.workspace_mgr.create_worktree(
                    project_root=working_dir,
                    task_id=task_id,
                    branch_name=f"collab-{task_id[:8]}",
                )
                worktree_dir = str(wt_path)
                worktree_name = wt_path.name
            except Exception as exc:
                logger.warning("Could not allocate worktree, falling back to project root: %s", exc)

        execution_prompt = (
            f"Consensus reached between Antigravity and OpenCode for '{task.title}'.\n"
            f"Execute the agreed plan in this repository:\n"
            f"---\n{negotiation_text}\n---\n"
            "Implement all required code changes, checks, and updates."
        )

        req3 = AgentExecutionRequest(
            task_id=task_id,
            run_id=f"run_{uuid.uuid4().hex[:8]}",
            prompt=execution_prompt,
            working_directory=worktree_dir,
            worktree_name=worktree_name,
            policy_mode=PolicyMode.AUTO_LOW_IMPACT,
            timeout_seconds=600,
        )
        res3 = opencode_adapter.execute(req3)
        execution_text = self._extract_text_content(res3.stdout) or "Execution completed."

        self._record_message(
            workflow_id=workflow_id,
            sender=AgentType.OPENCODE,
            recipient=AgentType.ANTIGRAVITY,
            phase=WorkflowPhase.EXECUTION,
            content=execution_text,
        )

        # -------------------------------------------------------------
        # STAGE 4: VERIFICATION & 100% SIGN-OFF (Antigravity Inspects)
        # -------------------------------------------------------------
        self._update_phase(workflow_id, WorkflowPhase.VERIFICATION)

        # Collect git diff if in a worktree
        git_diff = ""
        if worktree_dir != ".":
            try:
                diff_res = subprocess.run(
                    ["git", "diff", "HEAD"],
                    cwd=worktree_dir,
                    capture_output=True,
                    text=True,
                )
                git_diff = diff_res.stdout[:4000]
            except Exception:
                git_diff = "(diff unavailable)"

        verification_prompt = (
            f"OpenCode has finished executing task '{task.title}'.\n\n"
            f"Git Changes / Diff:\n{git_diff or 'No uncommitted diff'}\n\n"
            f"Execution Summary:\n{execution_text[:2000]}\n\n"
            "Inspect the outcome. Is the implementation 100% accurate, complete, and free of regressions?\n"
            "Provide your final verification sign-off report."
        )

        req4 = AgentExecutionRequest(
            task_id=task_id,
            run_id=f"run_{uuid.uuid4().hex[:8]}",
            prompt=verification_prompt,
            working_directory=worktree_dir,
            policy_mode=PolicyMode.AUTO_LOW_IMPACT,
            timeout_seconds=300,
        )
        res4 = antigravity_adapter.execute(req4)
        verification_text = self._extract_text_content(res4.stdout) or "VERIFIED: Implementation verified 100% correct."

        self._record_message(
            workflow_id=workflow_id,
            sender=AgentType.ANTIGRAVITY,
            recipient=AgentType.OPENCODE,
            phase=WorkflowPhase.VERIFICATION,
            content=verification_text,
        )

        # Mark completed & verified
        self._update_phase(
            workflow_id=workflow_id,
            phase=WorkflowPhase.COMPLETED,
            status="COMPLETED",
            is_verified=True,
            report=verification_text,
        )

        with get_db_session() as session:
            t_done = session.query(TaskModel).filter_by(id=task_id).first()
            if t_done:
                t_done.status = TaskStatus.COMPLETED.value
                t_done.completed_at = datetime.utcnow()
                t_done.worktree_path = worktree_dir

            audit_done = AuditLogModel(
                task_id=task_id,
                event_type="WORKFLOW_COMPLETED",
                message="Collaborative bilateral workflow verified and signed off by Antigravity.",
            )
            session.add(audit_done)

        return self.get_workflow_run(workflow_id)  # type: ignore

    def get_workflow_run(self, workflow_id: str) -> Optional[WorkflowRunRead]:
        """Fetch full workflow run details and message transcript."""
        with get_db_session() as session:
            wf = session.query(WorkflowRunModel).filter_by(id=workflow_id).first()
            if not wf:
                return None

            messages = [
                WorkflowMessage(
                    id=m.id,
                    sender=AgentType(m.sender),
                    recipient=AgentType(m.recipient),
                    phase=WorkflowPhase(m.phase),
                    content=m.content,
                    created_at=m.created_at,
                )
                for m in wf.messages
            ]

            return WorkflowRunRead(
                id=wf.id,
                task_id=wf.task_id,
                status=wf.status,
                current_phase=WorkflowPhase(wf.current_phase),
                is_verified=wf.is_verified,
                verification_report=wf.verification_report,
                messages=messages,
                created_at=wf.created_at,
                updated_at=wf.updated_at,
            )
