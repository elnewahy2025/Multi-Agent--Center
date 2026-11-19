"""Collaborative Bilateral Multi-Agent Workflow Engine.

Coordinates Google Antigravity (Architect & Quality Inspector) and OpenCode
(Implementer & Worker) through read-only inspection/negotiation and a bounded
Stage 3 <-> Stage 4 execution/verification rework loop inside an isolated worktree.
"""

from __future__ import annotations

import json
import logging
import re
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Optional, Tuple

from packages.contracts import (
    AgentExecutionRequest,
    AgentExecutionResult,
    AgentType,
    ApprovalDecision,
    PolicyMode,
    TaskStatus,
    WorkflowMessage,
    WorkflowPhase,
    WorkflowRunRead,
)
from services.agent_bridge import AgentRegistry, BaseAgentAdapter
from services.agent_bridge.streaming import ActivityEvent
from services.orchestrator.db import (
    AgentRunModel,
    ApprovalModel,
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
    """Orchestrates bilateral negotiation, isolated execution, and verification rework."""

    AGENT_NAMES = {
        AgentType.ANTIGRAVITY: "Google Antigravity",
        AgentType.OPENCODE: "OpenCode Desktop",
        AgentType.CLAUDE_CODE: "Claude Code",
        AgentType.QWEN_CODE: "Qwen Code",
        AgentType.CODEX: "OpenAI Codex",
        AgentType.OPENCLAW: "OpenClaw",
    }

    @classmethod
    def resolve_pair_types(cls, assigned_agent: Optional[str]) -> Tuple[AgentType, AgentType]:
        """Resolve (inspector_type, worker_type); selected agent is always Negotiator & Implementer."""
        worker_type = AgentType.OPENCODE
        if assigned_agent:
            try:
                worker_type = AgentType(assigned_agent)
            except ValueError:
                worker_type = AgentType.OPENCODE
        inspector_type = AgentType.OPENCODE if worker_type == AgentType.ANTIGRAVITY else AgentType.ANTIGRAVITY
        return inspector_type, worker_type

    def __init__(
        self,
        registry: Optional[AgentRegistry] = None,
        workspace_mgr: Optional[WorkspaceManager] = None,
        max_attempts: int = 2,
        poll_interval_seconds: float = 0.5,
        approval_timeout_seconds: int = 1800,
    ) -> None:
        self.registry = registry or AgentRegistry()
        self.workspace_mgr = workspace_mgr or WorkspaceManager()
        self.max_attempts = max_attempts
        self.poll_interval_seconds = poll_interval_seconds
        self.approval_timeout_seconds = approval_timeout_seconds

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
        try:
            data = json.loads(trimmed)
            if isinstance(data, dict):
                extracted = self._pick_text_from_obj(data)
                if extracted:
                    return extracted
        except Exception:
            pass
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

    @staticmethod
    def _is_verification_approved(report: str) -> bool:
        """Require an explicit approval verdict and fail closed on rejection or ambiguity."""
        if not report or not report.strip():
            return False
        if re.search(r"verdict\*{0,2}\s*[:\-]\s*\*{0,2}(rejected|failed|blocked)", report, re.IGNORECASE):
            return False
        if "VERDICT: REJECTED" in report.upper():
            return False
        return bool(
            re.search(r"verdict\*{0,2}\s*[:\-]\s*\*{0,2}(approved|verified|pass|passed|100%\s*certified)",
                      report, re.IGNORECASE)
        )

    def _collect_worktree_changes_summary(self, worktree_dir: str) -> str:
        """Summarize modified, added/untracked, and deleted files plus diffs in worktree_dir."""
        files = self.workspace_mgr.get_changed_files(Path(worktree_dir))
        if not files:
            return "No uncommitted changes in worktree"
        chunks = [f"### [{f['status']}] {f['path']}\n{f['diff']}" for f in files]
        combined = "\n\n".join(chunks)
        return combined[:4000] if len(combined) > 4000 else combined

    @staticmethod
    def _detect_high_risk_plan(
        task_desc: str, proposal: str, negotiation: str, policy_mode: PolicyMode,
    ) -> Optional[str]:
        """Detect policy or plan triggers requiring human confirmation before execution."""
        if policy_mode in (PolicyMode.ASK, PolicyMode.STRICT):
            return (
                f"Task policy mode is '{policy_mode.value}', requiring human confirmation "
                "before Stage 3 file modifications."
            )
        combined = f"{task_desc}\n{proposal}\n{negotiation}"
        if re.search(r"approval[_\s-]*required\s*:\s*yes", combined, re.IGNORECASE):
            return (
                "Agents flagged high-impact or approval-gated changes "
                "(APPROVAL_REQUIRED: YES) in the technical plan."
            )
        danger = re.search(
            r"\b(git\s+push|git\s+reset\s+--hard|git\s+clean\s+-fd|rm\s+-rf|"
            r"remove-item\s+.*-recurse|drop\s+table|truncate\s+table|delete\s+from|force-push)\b"
            r"|(?:^|\s)(--force)(?=\s|$)",
            combined,
            re.IGNORECASE,
        )
        if danger:
            matched = (danger.group(1) or danger.group(2) or "").strip()
            return (
                f"Plan references high-impact operation ('{matched}'), requiring human approval "
                "before execution."
            )
        return None

    def _request_and_wait_for_approval(
        self, task_id: str, workflow_id: str, action_type: str,
        description: str, command_or_path: str, risk_level: str = "HIGH",
    ) -> Tuple[ApprovalDecision, Optional[str]]:
        """Pause workflow in AWAITING_APPROVAL and wait until the operator decides."""
        approval_id = f"apr_{uuid.uuid4().hex[:10]}"
        with get_db_session() as session:
            session.add(ApprovalModel(
                id=approval_id, task_id=task_id, run_id=workflow_id, action_type=action_type,
                command_or_path=command_or_path, description=description, risk_level=risk_level,
                decision=ApprovalDecision.PENDING.value,
            ))
            t = session.query(TaskModel).filter_by(id=task_id).first()
            if t:
                t.status, t.updated_at = TaskStatus.AWAITING_APPROVAL.value, datetime.utcnow()
            wf = session.query(WorkflowRunModel).filter_by(id=workflow_id).first()
            if wf:
                wf.status, wf.updated_at = TaskStatus.AWAITING_APPROVAL.value, datetime.utcnow()
            session.add(AuditLogModel(
                task_id=task_id, run_id=workflow_id, event_type="APPROVAL_REQUESTED",
                message=f"[{action_type}] Waiting for human decision: {description}",
            ))

        sink = EventSink(task_id=task_id, run_id=workflow_id, agent="SYSTEM", phase=action_type)
        sink(ActivityEvent(
            key=f"apr-{approval_id}", kind="system", status="running",
            title=f"⏸ Waiting for human decision ({action_type}): {description}",
        ))

        deadline = time.monotonic() + self.approval_timeout_seconds
        while time.monotonic() < deadline:
            with get_db_session() as session:
                t = session.query(TaskModel).filter_by(id=task_id).first()
                apr = session.query(ApprovalModel).filter_by(id=approval_id).first()
                if t and t.status == TaskStatus.CANCELLED.value:
                    if apr and apr.decision == ApprovalDecision.PENDING.value:
                        apr.decision = ApprovalDecision.DENIED.value
                        apr.reason = "Task cancelled"
                        apr.decided_at = datetime.utcnow()
                    sink(ActivityEvent(
                        key=f"apr-{approval_id}", kind="system", status="failed",
                        title=f"⏹ Cancelled while waiting for human decision ({action_type})",
                    ))
                    return ApprovalDecision.DENIED, "Task cancelled"

                if apr and apr.decision != ApprovalDecision.PENDING.value:
                    dec = ApprovalDecision(apr.decision)
                    reason = apr.reason
                    if dec == ApprovalDecision.APPROVED:
                        if t:
                            t.status, t.updated_at = TaskStatus.RUNNING.value, datetime.utcnow()
                        wf = session.query(WorkflowRunModel).filter_by(id=workflow_id).first()
                        if wf:
                            wf.status, wf.updated_at = "RUNNING", datetime.utcnow()
                    note_txt = f" — Instructions: {reason}" if reason else ""
                    sink(ActivityEvent(
                        key=f"apr-{approval_id}", kind="system",
                        status="done" if dec == ApprovalDecision.APPROVED else "failed",
                        title=f"Operator {dec.value} ({action_type}){note_txt}",
                    ))
                    return dec, reason
            time.sleep(self.poll_interval_seconds)

        with get_db_session() as session:
            apr = session.query(ApprovalModel).filter_by(id=approval_id).first()
            if apr and apr.decision == ApprovalDecision.PENDING.value:
                apr.decision, apr.reason, apr.decided_at = ApprovalDecision.DENIED.value, "Approval timed out", datetime.utcnow()
        sink(ActivityEvent(
            key=f"apr-{approval_id}", kind="system", status="failed",
            title=f"⏱ Approval timed out ({action_type})",
        ))
        return ApprovalDecision.DENIED, "Approval timed out"

    def _record_error(
        self, task_id: str, workflow_id: str, source: str, title: str,
        message: str, stderr: Optional[str] = None, severity: str = "ERROR",
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
        self, workflow_id: str, sender: AgentType, recipient: AgentType,
        phase: WorkflowPhase, content: str,
    ) -> None:
        """Persist a message in the collaborative conversation history."""
        with get_db_session() as session:
            session.add(WorkflowMessageModel(
                workflow_run_id=workflow_id, sender=sender.value, recipient=recipient.value,
                phase=phase.value, content=content, created_at=datetime.utcnow(),
            ))

    def _update_phase(
        self, workflow_id: str, phase: WorkflowPhase, status: str = "RUNNING",
        is_verified: bool = False, report: Optional[str] = None,
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
        self, workflow_id: str, task_id: str, adapter: BaseAgentAdapter, recipient: AgentType,
        phase: WorkflowPhase, stage_label: str, req: AgentExecutionRequest, severity: str = "CRITICAL",
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
                run_rec.exit_code, run_rec.stdout, run_rec.stderr = res.exit_code, res.stdout, res.stderr
                run_rec.duration_seconds = res.duration_seconds
                run_rec.error_reason = "Cancelled by operator" if cancelled else res.error_reason
                run_rec.completed_at = datetime.utcnow()
        if cancelled:
            return None

        if res.status != TaskStatus.COMPLETED or res.exit_code != 0:
            err_msg = res.error_reason or res.stderr or f"{agent_val} exited with code {res.exit_code}"
            self._record_error(task_id, workflow_id, source, f"{stage_label} Failed", err_msg, res.stderr, severity)
            self._record_message(
                workflow_id, adapter.agent_type, recipient, phase,
                f"❌ [{stage_label} Failed — {agent_val} Error]\nExit Code: {res.exit_code}\nError: {err_msg}\nStderr:\n{res.stderr or '(no stderr)'}",
            )
            self._fail_workflow(workflow_id, task_id, f"{stage_label} failed: {err_msg}")
            return None

        text = self._extract_text_content(res.stdout, res)
        if not text:
            err_msg = f"{agent_val} completed {stage_label} but output was empty."
            self._record_error(task_id, workflow_id, source, f"Empty {stage_label} Output", err_msg, res.stderr)
            self._fail_workflow(workflow_id, task_id, err_msg)
            return None

        self._record_message(workflow_id, adapter.agent_type, recipient, phase, text)
        return text

    def _allocate_worktree(self, project_root: str, task_id: str) -> str:
        """Create/reuse isolated worktree and persist its path on the task."""
        if not project_root:
            return project_root
        try:
            wt_path = self.workspace_mgr.create_worktree(
                project_root=project_root, task_id=task_id, branch_name=f"collab-{task_id[:8]}",
            )
            worktree_dir = str(wt_path)
            with get_db_session() as session:
                t = session.query(TaskModel).filter_by(id=task_id).first()
                if t:
                    t.worktree_path = worktree_dir
            return worktree_dir
        except Exception as exc:
            logger.warning("Could not allocate worktree, falling back to project root: %s", exc)
            return project_root

    def run_collaborative_workflow(self, task_id: str) -> WorkflowRunRead:
        """Run Stages 1-2 read-only, then a bounded Stage 3 <-> Stage 4 rework loop in a single worktree."""
        workflow_id, now = f"wf_{uuid.uuid4().hex[:12]}", datetime.utcnow()
        with get_db_session() as session:
            task = session.query(TaskModel).filter_by(id=task_id).first()
            if not task:
                raise ValueError(f"Task not found: {task_id}")
            task_title, task_desc = task.title, task.description
            task_policy = PolicyMode(task.policy_mode)
            inspector_type, worker_type = self.resolve_pair_types(task.assigned_agent)
            inspector_name = self.AGENT_NAMES.get(inspector_type, inspector_type.value)
            worker_name = self.AGENT_NAMES.get(worker_type, worker_type.value)
            project_root = (
                task.project.root_path
                if (task.project and task.project.root_path)
                else str(Path(__file__).resolve().parents[3])
            )
            session.add(WorkflowRunModel(
                id=workflow_id, task_id=task_id, status="RUNNING",
                current_phase=WorkflowPhase.INSPECTION.value, created_at=now, updated_at=now,
            ))
            task.status, task.updated_at = TaskStatus.RUNNING.value, now
            session.add(AuditLogModel(
                task_id=task_id, event_type="WORKFLOW_STARTED",
                message=f"Collaborative bilateral workflow initiated ({inspector_name} <-> {worker_name})",
            ))

        inspector_adapter = self.registry.get_adapter(inspector_type)
        worker_adapter = self.registry.get_adapter(worker_type)
        if not inspector_adapter or not worker_adapter:
            raise RuntimeError(f"Both {inspector_name} and {worker_name} adapters must be available for collaboration.")

        worktree_dir = self._allocate_worktree(project_root, task_id)

        # STAGE 1: READ-ONLY INSPECTION & PROPOSAL (Inspector)
        proposal_text = self._run_stage(
            workflow_id, task_id, inspector_adapter, worker_type,
            WorkflowPhase.INSPECTION, "Stage 1 Inspection",
            AgentExecutionRequest(
                task_id=task_id, run_id=f"run_{uuid.uuid4().hex[:8]}",
                prompt=(
                    f"You are {inspector_name}, the Lead Architect inspecting task: '{task_title}'.\n"
                    f"Requirements:\n{task_desc}\n\n"
                    "Analyze the codebase requirements and formulate a structured, concise technical proposal "
                    f"and execution plan for {worker_name} to review.\n"
                    "If your plan includes any dangerous, destructive, or high-impact actions that require human "
                    "confirmation before execution, include the line 'APPROVAL_REQUIRED: YES' and explain why.\n"
                    "IMPORTANT: This is Stage 1 (read-only inspection). Do NOT modify, create, or delete any files."
                ),
                working_directory=worktree_dir, worktree_name=None,
                policy_mode=PolicyMode.STRICT, timeout_seconds=300,
            ),
        )
        if proposal_text is None:
            return self.get_workflow_run(workflow_id)  # type: ignore

        # STAGE 2: READ-ONLY PEER REVIEW & NEGOTIATION (Selected Worker Agent)
        negotiation_text = self._run_stage(
            workflow_id, task_id, worker_adapter, inspector_type,
            WorkflowPhase.NEGOTIATION, "Stage 2 Peer Review",
            AgentExecutionRequest(
                task_id=task_id, run_id=f"run_{uuid.uuid4().hex[:8]}",
                prompt=(
                    f"{inspector_name} has proposed the following technical plan for task '{task_title}':\n"
                    f"---\n{proposal_text}\n---\n\n"
                    "Review this plan. Do you agree with these steps, or do you have refinements or critiques?\n"
                    "If your plan includes any dangerous, destructive, or high-impact actions that require human "
                    "confirmation before execution, include the line 'APPROVAL_REQUIRED: YES' and explain why.\n"
                    "IMPORTANT: This is Stage 2 (read-only peer review & negotiation). Do NOT modify, create, or "
                    "delete any files in this stage—only review the plan and state 'AGREED' with the locked "
                    "execution steps or list your proposed refinements."
                ),
                working_directory=worktree_dir, worktree_name=None,
                policy_mode=PolicyMode.STRICT, timeout_seconds=300,
            ),
        )
        if negotiation_text is None:
            return self.get_workflow_run(workflow_id)  # type: ignore

        # GATE A: PRE-EXECUTION HUMAN APPROVAL FOR POLICY OR HIGH-IMPACT PLANS
        risk_reason = self._detect_high_risk_plan(task_desc, proposal_text, negotiation_text, task_policy)
        if risk_reason:
            decision, user_note = self._request_and_wait_for_approval(
                task_id, workflow_id, "PRE_EXECUTION_APPROVAL", risk_reason, worktree_dir, "HIGH",
            )
            if decision != ApprovalDecision.APPROVED:
                halt_msg = f"🛑 Execution halted: Operator denied pre-execution approval ({user_note or decision.value})."
                self._record_message(
                    workflow_id, inspector_type, worker_type, WorkflowPhase.NEGOTIATION, halt_msg,
                )
                self._update_phase(workflow_id, WorkflowPhase.FAILED if user_note == "Approval timed out" else WorkflowPhase.NEGOTIATION,
                                   status="FAILED" if user_note == "Approval timed out" else "CANCELLED",
                                   report=halt_msg)
                with get_db_session() as session:
                    t = session.query(TaskModel).filter_by(id=task_id).first()
                    if t:
                        t.status = TaskStatus.FAILED.value if user_note == "Approval timed out" else TaskStatus.CANCELLED.value
                        t.updated_at = datetime.utcnow()
                return self.get_workflow_run(workflow_id)  # type: ignore
            if user_note:
                negotiation_text += f"\n\nOperator Approval Instructions:\n{user_note}"

        # STAGES 3 <-> 4: BOUNDED EXECUTION & VERIFICATION REWORK LOOP + GATE B ESCALATION
        attempt, operator_granted_extra, last_verification_text = 1, False, ""
        while True:
            if attempt == 1:
                execution_prompt = (
                    f"Consensus reached between {inspector_name} and {worker_name} for '{task_title}'.\n"
                    f"Execute the agreed plan directly inside the current working directory ({worktree_dir}):\n"
                    f"---\n{negotiation_text}\n---\n"
                    "Implement all required code changes, checks, and updates in this directory. "
                    "Do not create or use any other worktree path."
                )
            else:
                execution_prompt = (
                    f"{inspector_name} inspected your previous execution for '{task_title}' (Attempt {attempt - 1}) "
                    f"and REJECTED it with the following verification findings:\n"
                    f"---\n{last_verification_text}\n---\n\n"
                    f"Original Agreed Plan:\n---\n{negotiation_text}\n---\n\n"
                    f"Fix every issue reported by {inspector_name} directly inside the current working directory ({worktree_dir}). "
                    "Do not create or use any other worktree path."
                )

            execution_text = self._run_stage(
                workflow_id, task_id, worker_adapter, inspector_type,
                WorkflowPhase.EXECUTION, f"Stage 3 Execution (Attempt {attempt})",
                AgentExecutionRequest(
                    task_id=task_id, run_id=f"run_{uuid.uuid4().hex[:8]}",
                    prompt=execution_prompt, working_directory=worktree_dir, worktree_name=None,
                    policy_mode=PolicyMode.AUTO_LOW_IMPACT, timeout_seconds=600,
                ),
            )
            if execution_text is None:
                return self.get_workflow_run(workflow_id)  # type: ignore

            changes_summary = self._collect_worktree_changes_summary(worktree_dir)
            verification_text = self._run_stage(
                workflow_id, task_id, inspector_adapter, worker_type,
                WorkflowPhase.VERIFICATION, f"Stage 4 Verification (Attempt {attempt})",
                AgentExecutionRequest(
                    task_id=task_id, run_id=f"run_{uuid.uuid4().hex[:8]}",
                    prompt=(
                        f"{worker_name} has finished executing task '{task_title}' (Attempt {attempt}/{self.max_attempts}) "
                        f"in working directory: {worktree_dir}\n\n"
                        f"Worktree Git Changes & Untracked Files:\n{changes_summary}\n\n"
                        f"{worker_name} Execution Summary:\n{execution_text[:2000]}\n\n"
                        "Inspect the actual files in this working directory and verify whether the implementation is "
                        "100% accurate, complete, and free of regressions. Do NOT modify files yourself.\n"
                        "You MUST include an explicit verdict line in your report:\n"
                        "- Write `VERDICT: APPROVED` if all requirements are satisfied and verified in this working directory.\n"
                        "- Write `VERDICT: REJECTED` if any requirement is missing, broken, or failed verification, "
                        f"followed by the exact list of fixes {worker_name} must make."
                    ),
                    working_directory=worktree_dir, worktree_name=None,
                    policy_mode=PolicyMode.STRICT, timeout_seconds=300,
                ),
                severity="WARNING",
            )
            if verification_text is None:
                return self.get_workflow_run(workflow_id)  # type: ignore

            if self._is_verification_approved(verification_text):
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
                        message=f"Collaborative bilateral workflow approved by {inspector_name} (Attempt {attempt}).",
                    ))
                return self.get_workflow_run(workflow_id)  # type: ignore

            last_verification_text = verification_text
            if attempt < self.max_attempts:
                with get_db_session() as session:
                    session.add(AuditLogModel(
                        task_id=task_id, run_id=workflow_id, event_type="WORKFLOW_REWORK_REQUESTED",
                        message=f"{inspector_name} rejected attempt {attempt}/{self.max_attempts}; returning to {worker_name} for fixes.",
                    ))
                attempt += 1
                continue

            if not operator_granted_extra:
                decision, user_note = self._request_and_wait_for_approval(
                    task_id, workflow_id, "UNRESOLVED_ISSUES_DECISION",
                    f"{inspector_name} still reported unresolved issues after {attempt} attempt(s). "
                    "Approve (with optional instructions) to run another fix cycle, or Deny to stop.",
                    worktree_dir, "HIGH",
                )
                if decision == ApprovalDecision.APPROVED:
                    operator_granted_extra = True
                    if user_note:
                        last_verification_text += f"\n\nOperator Approval Instructions:\n{user_note}"
                    attempt += 1
                    continue
                if user_note == "Task cancelled":
                    return self.get_workflow_run(workflow_id)  # type: ignore

            self._record_error(
                task_id, workflow_id, f"{inspector_type.value}_VERIFICATION",
                f"Verification Rejected After {attempt} Attempts",
                f"{inspector_name} rejected the implementation. Inspect the task verification report for required fixes.",
                stderr=verification_text[:2000], severity="ERROR",
            )
            self._fail_workflow(workflow_id, task_id, verification_text)
            return self.get_workflow_run(workflow_id)  # type: ignore

    def get_workflow_run(self, workflow_id: str) -> Optional[WorkflowRunRead]:
        """Fetch full workflow run details and message transcript."""
        with get_db_session() as session:
            wf = session.query(WorkflowRunModel).filter_by(id=workflow_id).first()
            if not wf:
                return None
            inspector_type, worker_type = self.resolve_pair_types(
                wf.task.assigned_agent if wf.task else None
            )
            messages = []
            for m in wf.messages:
                sender = AgentType(m.sender)
                phase = WorkflowPhase(m.phase)
                if phase == WorkflowPhase.INSPECTION:
                    inspector_type = sender
                elif phase == WorkflowPhase.NEGOTIATION and sender != inspector_type:
                    worker_type = sender
                messages.append(WorkflowMessage(
                    id=m.id, sender=sender, recipient=AgentType(m.recipient),
                    phase=phase, content=m.content, created_at=m.created_at,
                ))
            return WorkflowRunRead(
                id=wf.id, task_id=wf.task_id, status=wf.status,
                current_phase=WorkflowPhase(wf.current_phase),
                inspector_agent=inspector_type, worker_agent=worker_type,
                is_verified=wf.is_verified,
                verification_report=wf.verification_report, messages=messages,
                created_at=wf.created_at, updated_at=wf.updated_at,
            )
