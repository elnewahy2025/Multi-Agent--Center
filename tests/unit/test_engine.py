"""Unit tests for task orchestrator and API endpoints."""

import unittest
from fastapi.testclient import TestClient

from packages.contracts import PolicyMode, TaskCreate, TaskStatus
from services.orchestrator.api import app
from services.orchestrator.db import init_db
from services.orchestrator.engine import TaskOrchestrator


class TestOrchestrator(unittest.TestCase):
    """Test task submission, lifecycle, and API endpoints."""

    @classmethod
    def setUpClass(cls):
        init_db()
        cls.client = TestClient(app)
        cls.orchestrator = TaskOrchestrator()

    def test_health_check_endpoint(self):
        res = self.client.get("/health")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["status"], "healthy")
        self.assertGreaterEqual(data["available_agents"], 2)

    def test_list_agents_endpoint(self):
        res = self.client.get("/agents")
        self.assertEqual(res.status_code, 200)
        agents = res.json()
        names = [a["name"] for a in agents]
        self.assertIn("OpenCode Desktop CLI", names)
        self.assertIn("Google Antigravity CLI", names)

    def test_task_submission_and_retrieval(self):
        res = self.client.post(
            "/tasks",
            json={
                "title": "Audit dependencies",
                "description": "Check for obsolete packages in requirements",
                "policy_mode": "AUTO_LOW_IMPACT",
            },
        )
        self.assertEqual(res.status_code, 200)
        task = res.json()
        task_id = task["id"]
        self.assertEqual(task["status"], "PENDING")

        try:
            # Retrieve via GET
            get_res = self.client.get(f"/tasks/{task_id}")
            self.assertEqual(get_res.status_code, 200)
            self.assertEqual(get_res.json()["title"], "Audit dependencies")
        finally:
            del_res = self.client.delete(f"/tasks/{task_id}")
            self.assertEqual(del_res.status_code, 200)

    def test_auto_generated_variable_title_from_description(self):
        res1 = self.client.post(
            "/tasks",
            json={
                "description": "Please fix authentication middleware timeout on login route. Add unit tests too.",
                "policy_mode": "AUTO_LOW_IMPACT",
            },
        )
        res2 = self.client.post(
            "/tasks",
            json={
                "title": "",
                "description": "Refactor SQLAlchemy models into separate files for modularity",
                "policy_mode": "AUTO_LOW_IMPACT",
            },
        )
        self.assertEqual(res1.status_code, 200)
        self.assertEqual(res2.status_code, 200)
        t1, t2 = res1.json(), res2.json()
        try:
            self.assertEqual(t1["title"], "Fix authentication middleware timeout on login route")
            self.assertEqual(t2["title"], "Refactor SQLAlchemy models into separate files for modularity")
            self.assertNotEqual(t1["title"], t2["title"])
        finally:
            self.client.delete(f"/tasks/{t1['id']}")
            self.client.delete(f"/tasks/{t2['id']}")


if __name__ == "__main__":
    unittest.main()
