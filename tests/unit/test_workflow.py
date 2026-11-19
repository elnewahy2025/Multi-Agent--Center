"""Unit tests for collaborative multi-agent workflow models and transitions."""

import unittest
import uuid
from datetime import datetime

from packages.contracts import (
    AgentType,
    WorkflowMessage,
    WorkflowPhase,
    WorkflowRunRead,
)
from services.orchestrator.db import (
    TaskModel,
    WorkflowMessageModel,
    WorkflowRunModel,
    get_db_session,
    init_db,
)


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


if __name__ == "__main__":
    unittest.main()
