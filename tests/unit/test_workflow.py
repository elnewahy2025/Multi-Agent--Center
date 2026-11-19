"""Unit tests for collaborative multi-agent workflow models and transitions."""

import tempfile
import unittest
import uuid
from datetime import datetime
from pathlib import Path

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
from services.orchestrator.db import (
    AgentEventModel,
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

    def test_rework_loop_and_max_attempt_failure(self):
        class StubAdapter:
            def __init__(self, agent_type, handler):
                self.agent_type = agent_type
                self.handler = handler
                self.requests = []

            def execute(self, req: AgentExecutionRequest, on_event=None):
                self.requests.append(req)
                out = self.handler(req, len(self.requests))
                return AgentExecutionResult(
                    task_id=req.task_id, run_id=req.run_id, agent_type=self.agent_type,
                    status=TaskStatus.COMPLETED, exit_code=0, stdout=out, stderr="",
                    duration_seconds=0.1, structured_output={"final_text": out},
                )

        class StubRegistry:
            def __init__(self, adapters):
                self.adapters = adapters

            def get_adapter(self, agent_type):
                return self.adapters.get(agent_type)

        class StubWorkspaceMgr:
            def __init__(self, wt_dir: Path):
                self.wt_dir = wt_dir

            def create_worktree(self, project_root, task_id, branch_name=None):
                return self.wt_dir

            def get_changed_files(self, working_dir: Path):
                return [{"path": "app.py", "status": "MODIFIED", "diff": "+fixed"}]

        with tempfile.TemporaryDirectory() as tmp:
            wt_path = Path(tmp)
            # Case A: Round 1 Stage 4 rejects, Round 2 Stage 3 fixes and Stage 4 approves
            anti = StubAdapter(AgentType.ANTIGRAVITY, lambda _r, n: (
                "Plan ready." if n == 1 else (
                    "VERDICT: REJECTED — missing test" if n == 2 else "VERDICT: APPROVED"
                )
            ))
            opc = StubAdapter(AgentType.OPENCODE, lambda _r, n: (
                "AGREED" if n == 1 else f"Applied changes pass {n}"
            ))
            engine = CollaborativeWorkflowEngine(
                registry=StubRegistry({AgentType.ANTIGRAVITY: anti, AgentType.OPENCODE: opc}),
                workspace_mgr=StubWorkspaceMgr(wt_path),
                max_attempts=2,
            )

            task_id = f"tsk_{uuid.uuid4().hex[:8]}"
            with get_db_session() as s:
                s.add(TaskModel(id=task_id, title="Fix bug", description="Fix and test", status="PENDING"))

            try:
                wf = engine.run_collaborative_workflow(task_id)
                self.assertEqual(wf.status, "COMPLETED")
                self.assertTrue(wf.is_verified)
                self.assertEqual(len(anti.requests), 3)  # Stage 1 + Stage 4 (x2)
                self.assertEqual(len(opc.requests), 3)   # Stage 2 + Stage 3 (x2)
                # Read-only in Stages 1 & 2, isolated cwd with no --worktree in all stages
                self.assertEqual(anti.requests[0].policy_mode, PolicyMode.STRICT)
                self.assertEqual(opc.requests[0].policy_mode, PolicyMode.STRICT)
                self.assertTrue(all(r.worktree_name is None for r in anti.requests + opc.requests))
                self.assertTrue(all(r.working_directory == str(wt_path) for r in anti.requests + opc.requests))
                # Round 2 Stage 3 prompt received Round 1's rejection details
                self.assertIn("VERDICT: REJECTED — missing test", opc.requests[2].prompt)
            finally:
                with get_db_session() as s:
                    s.query(AgentEventModel).filter_by(task_id=task_id).delete()
                    s.query(ErrorLogModel).filter_by(task_id=task_id).delete()
                    s.query(AuditLogModel).filter_by(task_id=task_id).delete()
                    s.query(WorkflowRunModel).filter_by(task_id=task_id).delete()
                    s.query(TaskModel).filter_by(id=task_id).delete()

            # Case B: Still rejected after max_attempts -> FAILED + ErrorLogModel
            anti_fail = StubAdapter(AgentType.ANTIGRAVITY, lambda _r, n: (
                "Plan ready." if n == 1 else "VERDICT: REJECTED — still broken"
            ))
            opc_fail = StubAdapter(AgentType.OPENCODE, lambda _r, n: "AGREED" if n == 1 else "Tried fix")
            engine_fail = CollaborativeWorkflowEngine(
                registry=StubRegistry({AgentType.ANTIGRAVITY: anti_fail, AgentType.OPENCODE: opc_fail}),
                workspace_mgr=StubWorkspaceMgr(wt_path),
                max_attempts=2,
            )

            task_fail_id = f"tsk_{uuid.uuid4().hex[:8]}"
            with get_db_session() as s:
                s.add(TaskModel(id=task_fail_id, title="Broken task", description="Fails verify", status="PENDING"))

            try:
                wf_fail = engine_fail.run_collaborative_workflow(task_fail_id)
                self.assertEqual(wf_fail.status, "FAILED")
                self.assertFalse(wf_fail.is_verified)
                with get_db_session() as s:
                    t_row = s.query(TaskModel).filter_by(id=task_fail_id).first()
                    err_row = s.query(ErrorLogModel).filter_by(task_id=task_fail_id).first()
                    self.assertEqual(t_row.status, "FAILED")
                    self.assertIsNotNone(err_row)
                    self.assertEqual(err_row.source, "ANTIGRAVITY_VERIFICATION")
            finally:
                with get_db_session() as s:
                    s.query(AgentEventModel).filter_by(task_id=task_fail_id).delete()
                    s.query(ErrorLogModel).filter_by(task_id=task_fail_id).delete()
                    s.query(AuditLogModel).filter_by(task_id=task_fail_id).delete()
                    s.query(WorkflowRunModel).filter_by(task_id=task_fail_id).delete()
                    s.query(TaskModel).filter_by(id=task_fail_id).delete()


if __name__ == "__main__":
    unittest.main()
