"""Unit tests for persistence models and session operations."""

import unittest
import uuid
from datetime import datetime

from services.orchestrator.db import (
    AgentRunModel,
    ApprovalModel,
    AuditLogModel,
    ProjectModel,
    TaskModel,
    get_db_session,
    init_db,
)


class TestDatabase(unittest.TestCase):
    """Test database schema creation and CRUD transactions."""

    @classmethod
    def setUpClass(cls):
        init_db()

    def test_project_and_task_crud(self):
        project_id = f"proj_{uuid.uuid4().hex[:8]}"
        task_id = f"tsk_{uuid.uuid4().hex[:8]}"

        with get_db_session() as session:
            project = ProjectModel(
                id=project_id,
                name="Test Project",
                root_path=f"C:\\mock\\path_{project_id}",
            )
            session.add(project)

            task = TaskModel(
                id=task_id,
                project_id=project_id,
                title="Implement user auth",
                description="Add OAuth2 and session handlers",
                status="PENDING",
            )
            task.set_metadata({"priority": "high", "tags": ["auth", "backend"]})
            session.add(task)

        with get_db_session() as session:
            fetched_task = session.query(TaskModel).filter_by(id=task_id).first()
            self.assertIsNotNone(fetched_task)
            self.assertEqual(fetched_task.title, "Implement user auth")
            self.assertEqual(fetched_task.get_metadata().get("priority"), "high")
            self.assertEqual(fetched_task.project.name, "Test Project")

            # Cleanup
            session.delete(fetched_task.project)


if __name__ == "__main__":
    unittest.main()
