"""Unit tests for collaborative multi-agent workflow models and transitions."""

import tempfile
import threading
import time
import unittest
import uuid
from datetime import datetime
from pathlib import Path

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
from services.orchestrator.db import (
    AgentEventModel,
    ApprovalModel,
    AuditLogModel,
    ErrorLogModel,
    TaskModel,
    WorkflowMessageModel,
    WorkflowRunModel,
    get_db_session,
    init_db,
)
from services.orchestrator.workflows import CollaborativeWorkflowEngine


class TestCollaborativeWorkflow(unittest.TestCase):
    """Test workflow models, persistence, and message transitions."""

    @classmethod
    def setUpClass(cls):
        init_db()

    def test_workflow_message_contract(self):
        msg = WorkflowMessage(
            sender=AgentType.ANTIGRAVITY,
            recipient=AgentType.OPENCODE,
            phase=WorkflowPhase.INSPECTION,
            content="Technical plan: modularize auth handlers.",
        )
        self.assertEqual(msg.sender, AgentType.ANTIGRAVITY)
        self.assertEqual(msg.phase, WorkflowPhase.INSPECTION)

    def test_workflow_database_persistence(self):
        task_id = f"tsk_{uuid.uuid4().hex[:8]}"
        wf_id = f"wf_{uuid.uuid4().hex[:8]}"

        with get_db_session() as session:
            task = TaskModel(
                id=task_id,
                title="Collaborative Test Task",
                description="Refactor API routing",
                status="RUNNING",
            )
            session.add(task)

            wf = WorkflowRunModel(
                id=wf_id,
                task_id=task_id,
                status="RUNNING",
                current_phase="INSPECTION",
            )
            session.add(wf)

            msg1 = WorkflowMessageModel(
                workflow_run_id=wf_id,
                sender="ANTIGRAVITY",
                recipient="OPENCODE",
                phase="INSPECTION",
                content="Proposal: Use APIRouter in FastAPI",
            )
            msg2 = WorkflowMessageModel(
                workflow_run_id=wf_id,
                sender="OPENCODE",
                recipient="ANTIGRAVITY",
                phase="NEGOTIATION",
                content="AGREED. Steps confirmed.",
            )
            session.add_all([msg1, msg2])

        with get_db_session() as session:
            fetched_wf = session.query(WorkflowRunModel).filter_by(id=wf_id).first()
            self.assertIsNotNone(fetched_wf)
            self.assertEqual(len(fetched_wf.messages), 2)
            self.assertEqual(fetched_wf.messages[0].sender, "ANTIGRAVITY")
            self.assertEqual(fetched_wf.messages[1].content, "AGREED. Steps confirmed.")

            # Cleanup
            session.delete(fetched_wf.task)

    def test_verification_verdict_parser(self):
        self.assertTrue(CollaborativeWorkflowEngine._is_verification_approved("All checks pass.\nVERDICT: APPROVED"))
        self.assertTrue(CollaborativeWorkflowEngine._is_verification_approved("## Verdict: **APPROVED**\nSigned off."))
        self.assertFalse(CollaborativeWorkflowEngine._is_verification_approved("## Verdict: **REJECTED (Blocked)**"))
        self.assertFalse(CollaborativeWorkflowEngine._is_verification_approved("Missing tests.\nVERDICT: REJECTED"))
        self.assertFalse(CollaborativeWorkflowEngine._is_verification_approved("Looks mostly fine, no verdict line."))

    @staticmethod
    def _cleanup_task(task_id: str) -> None:
        with get_db_session() as s:
            s.query(AgentEventModel).filter_by(task_id=task_id).delete()
            s.query(ApprovalModel).filter_by(task_id=task_id).delete()
            s.query(ErrorLogModel).filter_by(task_id=task_id).delete()
            s.query(AuditLogModel).filter_by(task_id=task_id).delete()
            s.query(WorkflowRunModel).filter_by(task_id=task_id).delete()
            s.query(TaskModel).filter_by(id=task_id).delete()

    @staticmethod
    def _spawn_approval_decider(task_id: str, expected_action: str, decision: ApprovalDecision,
                                reason: str | None = None):
        """Wait for a PENDING ApprovalModel for task_id, record observations, then decide it."""
        observed = {"saw_awaiting": False, "action_type": None}

        def _worker():
            deadline = time.monotonic() + 5.0
            while time.monotonic() < deadline:
                with get_db_session() as s:
                    t = s.query(TaskModel).filter_by(id=task_id).first()
                    apr = s.query(ApprovalModel).filter_by(
                        task_id=task_id, decision=ApprovalDecision.PENDING.value
                    ).first()
                    if t and t.status == TaskStatus.AWAITING_APPROVAL.value and apr:
                        observed["saw_awaiting"] = True
                        observed["action_type"] = apr.action_type
                        if apr.action_type == expected_action:
                            apr.decision = decision.value
                            apr.decided_by = "test-operator"
                            apr.reason = reason
                            apr.decided_at = datetime.utcnow()
                            return
                time.sleep(0.03)

        th = threading.Thread(target=_worker, daemon=True)
        th.start()
        return th, observed

    def _build_stub_engine(self, anti_handler, opc_handler, wt_path: Path, max_attempts: int = 2,
                           extra_handlers=None):
        class StubAdapter:
            def __init__(self, agent_type, handler):
                self.agent_type, self.handler, self.requests = agent_type, handler, []

            def execute(self, req: AgentExecutionRequest, on_event=None):
                self.requests.append(req)
                out = self.handler(req, len(self.requests))
                return AgentExecutionResult(
                    task_id=req.task_id, run_id=req.run_id, agent_type=self.agent_type,
                    status=TaskStatus.COMPLETED, exit_code=0, stdout=out, stderr="",
                    duration_seconds=0.05, structured_output={"final_text": out},
                )

        class StubRegistry:
            def __init__(self, adapters):
                self.adapters = adapters

            def get_adapter(self, agent_type):
                return self.adapters.get(agent_type)

        class StubWorkspaceMgr:
            def create_worktree(self, project_root, task_id, branch_name=None):
                return wt_path

            def get_changed_files(self, working_dir: Path):
                return [{"path": "app.py", "status": "MODIFIED", "diff": "+fixed"}]

        anti = StubAdapter(AgentType.ANTIGRAVITY, anti_handler)
        opc = StubAdapter(AgentType.OPENCODE, opc_handler)
        adapters = {AgentType.ANTIGRAVITY: anti, AgentType.OPENCODE: opc}
        for agent_type, handler in (extra_handlers or {}).items():
            adapters[agent_type] = StubAdapter(agent_type, handler)
        engine = CollaborativeWorkflowEngine(
            registry=StubRegistry(adapters),
            workspace_mgr=StubWorkspaceMgr(),
            max_attempts=max_attempts,
            poll_interval_seconds=0.03,
            approval_timeout_seconds=5,
        )
        return engine, anti, opc

    def test_rework_loop_succeeds_automatically(self):
        with tempfile.TemporaryDirectory() as tmp:
            engine, anti, opc = self._build_stub_engine(
                lambda _r, n: "Plan ready." if n == 1 else (
                    "VERDICT: REJECTED — missing test" if n == 2 else "VERDICT: APPROVED"
                ),
                lambda _r, n: "AGREED" if n == 1 else f"Applied changes pass {n}",
                Path(tmp),
            )
            task_id = f"tsk_{uuid.uuid4().hex[:8]}"
            with get_db_session() as s:
                s.add(TaskModel(id=task_id, title="Fix bug", description="Fix and test", status="PENDING"))
            try:
                wf = engine.run_collaborative_workflow(task_id)
                self.assertEqual(wf.status, "COMPLETED")
                self.assertTrue(wf.is_verified)
                self.assertEqual(len(anti.requests), 3)
                self.assertEqual(len(opc.requests), 3)
                self.assertEqual(anti.requests[0].policy_mode, PolicyMode.STRICT)
                self.assertEqual(opc.requests[0].policy_mode, PolicyMode.STRICT)
                self.assertTrue(all(r.worktree_name is None for r in anti.requests + opc.requests))
                self.assertTrue(all(r.working_directory == str(Path(tmp)) for r in anti.requests + opc.requests))
                self.assertIn("VERDICT: REJECTED — missing test", opc.requests[2].prompt)
            finally:
                self._cleanup_task(task_id)

    def test_pre_execution_approval_gate_and_operator_note(self):
        with tempfile.TemporaryDirectory() as tmp:
            engine, _anti, opc = self._build_stub_engine(
                lambda _r, n: "Plan proposes migrating DB driver.\nAPPROVAL_REQUIRED: YES" if n == 1 else "VERDICT: APPROVED",
                lambda _r, n: "AGREED" if n == 1 else "Executed safely",
                Path(tmp),
            )
            task_id = f"tsk_{uuid.uuid4().hex[:8]}"
            with get_db_session() as s:
                s.add(TaskModel(
                    id=task_id, title="Audit dependencies", description="Check requirements",
                    policy_mode=PolicyMode.ASK.value, status="PENDING",
                ))
            th, obs = self._spawn_approval_decider(
                task_id, "PRE_EXECUTION_APPROVAL", ApprovalDecision.APPROVED,
                reason="Only pin upper bounds, do not touch api.py",
            )
            try:
                wf = engine.run_collaborative_workflow(task_id)
                th.join(timeout=2.0)
                self.assertTrue(obs["saw_awaiting"])
                self.assertEqual(obs["action_type"], "PRE_EXECUTION_APPROVAL")
                self.assertEqual(wf.status, "COMPLETED")
                self.assertTrue(wf.is_verified)
                self.assertIn("Only pin upper bounds, do not touch api.py", opc.requests[1].prompt)
            finally:
                self._cleanup_task(task_id)

    def test_unresolved_issues_escalation_gate(self):
        with tempfile.TemporaryDirectory() as tmp:
            # 1) Denied at Gate B -> FAILED + ErrorLogModel
            engine_deny, _anti_d, _opc_d = self._build_stub_engine(
                lambda _r, n: "Plan ready." if n == 1 else "VERDICT: REJECTED — still broken",
                lambda _r, n: "AGREED" if n == 1 else "Tried fix",
                Path(tmp), max_attempts=2,
            )
            task_deny = f"tsk_{uuid.uuid4().hex[:8]}"
            with get_db_session() as s:
                s.add(TaskModel(id=task_deny, title="Broken task", description="Fails verify", status="PENDING"))
            th_d, obs_d = self._spawn_approval_decider(
                task_deny, "UNRESOLVED_ISSUES_DECISION", ApprovalDecision.DENIED, reason="Stop and let me inspect",
            )
            try:
                wf_fail = engine_deny.run_collaborative_workflow(task_deny)
                th_d.join(timeout=2.0)
                self.assertTrue(obs_d["saw_awaiting"])
                self.assertEqual(obs_d["action_type"], "UNRESOLVED_ISSUES_DECISION")
                self.assertEqual(wf_fail.status, "FAILED")
                self.assertFalse(wf_fail.is_verified)
                with get_db_session() as s:
                    self.assertEqual(s.query(TaskModel).filter_by(id=task_deny).first().status, "FAILED")
                    err_row = s.query(ErrorLogModel).filter_by(task_id=task_deny).first()
                    self.assertIsNotNone(err_row)
                    self.assertEqual(err_row.source, "ANTIGRAVITY_VERIFICATION")
            finally:
                self._cleanup_task(task_deny)

            # 2) Approved at Gate B with operator guidance -> runs extra Stage 3->4 cycle and completes
            engine_ok, anti_ok, opc_ok = self._build_stub_engine(
                lambda _r, n: (
                    "Plan ready." if n == 1
                    else ("VERDICT: APPROVED" if n == 4 else "VERDICT: REJECTED — missing README divider")
                ),
                lambda _r, n: "AGREED" if n == 1 else f"Fix round {n}",
                Path(tmp), max_attempts=2,
            )
            task_ok = f"tsk_{uuid.uuid4().hex[:8]}"
            with get_db_session() as s:
                s.add(TaskModel(id=task_ok, title="Needs extra guidance", description="Add divider", status="PENDING"))
            th_ok, obs_ok = self._spawn_approval_decider(
                task_ok, "UNRESOLVED_ISSUES_DECISION", ApprovalDecision.APPROVED,
                reason="Add '---' separator above section 6 in README.md",
            )
            try:
                wf_ok = engine_ok.run_collaborative_workflow(task_ok)
                th_ok.join(timeout=2.0)
                self.assertTrue(obs_ok["saw_awaiting"])
                self.assertEqual(wf_ok.status, "COMPLETED")
                self.assertTrue(wf_ok.is_verified)
                self.assertEqual(len(anti_ok.requests), 4)  # Stage 1 + Stage 4 (x3)
                self.assertEqual(len(opc_ok.requests), 4)   # Stage 2 + Stage 3 (x3)
                self.assertIn("Add '---' separator above section 6 in README.md", opc_ok.requests[3].prompt)
            finally:
                self._cleanup_task(task_ok)

    def test_selected_agent_becomes_negotiator_and_implementer(self):
        cases = [
            (AgentType.CLAUDE_CODE, "Claude Code", AgentType.ANTIGRAVITY),
            (AgentType.QWEN_CODE, "Qwen Code", AgentType.ANTIGRAVITY),
            (AgentType.ANTIGRAVITY, "Google Antigravity", AgentType.OPENCODE),
        ]
        with tempfile.TemporaryDirectory() as tmp:
            for selected_type, expected_name, expected_inspector in cases:
                engine, anti, opc = self._build_stub_engine(
                    lambda _r, n: ("Plan ready." if n == 1 else "VERDICT: APPROVED")
                    if selected_type != AgentType.ANTIGRAVITY
                    else ("AGREED" if n == 1 else "Implemented as Antigravity"),
                    lambda _r, n: ("Plan ready." if n == 1 else "VERDICT: APPROVED")
                    if selected_type == AgentType.ANTIGRAVITY
                    else "unused",
                    Path(tmp),
                    extra_handlers={
                        AgentType.CLAUDE_CODE: lambda _r, n: "AGREED" if n == 1 else "Claude executed",
                        AgentType.QWEN_CODE: lambda _r, n: "AGREED" if n == 1 else "Qwen executed",
                    },
                )
                task_id = f"tsk_{uuid.uuid4().hex[:8]}"
                with get_db_session() as s:
                    s.add(TaskModel(
                        id=task_id, title=f"Task for {selected_type.value}",
                        description="Implement feature", assigned_agent=selected_type.value, status="PENDING",
                    ))
                try:
                    wf = engine.run_collaborative_workflow(task_id)
                    self.assertEqual(wf.status, "COMPLETED")
                    self.assertEqual(wf.inspector_agent, expected_inspector)
                    self.assertEqual(wf.worker_agent, selected_type)
                    self.assertEqual(wf.messages[0].sender, expected_inspector)
                    self.assertEqual(wf.messages[0].phase, WorkflowPhase.INSPECTION)
                    self.assertEqual(wf.messages[1].sender, selected_type)
                    self.assertEqual(wf.messages[1].phase, WorkflowPhase.NEGOTIATION)
                    self.assertEqual(wf.messages[2].sender, selected_type)
                    self.assertEqual(wf.messages[2].phase, WorkflowPhase.EXECUTION)
                    self.assertEqual(wf.messages[3].sender, expected_inspector)
                    self.assertEqual(wf.messages[3].phase, WorkflowPhase.VERIFICATION)

                    inspector_stub = engine.registry.get_adapter(expected_inspector)
                    worker_stub = engine.registry.get_adapter(selected_type)
                    self.assertEqual(len(inspector_stub.requests), 2)
                    self.assertEqual(len(worker_stub.requests), 2)
                    self.assertIn(expected_name, inspector_stub.requests[0].prompt)
                    if selected_type in (AgentType.CLAUDE_CODE, AgentType.QWEN_CODE):
                        self.assertNotIn("OpenCode", inspector_stub.requests[0].prompt)
                        self.assertNotIn("OpenCode", worker_stub.requests[1].prompt)
                finally:
                    self._cleanup_task(task_id)


if __name__ == "__main__":
    unittest.main()
