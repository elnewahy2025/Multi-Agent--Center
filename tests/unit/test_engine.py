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
        self.assertIn(data["status"], ("healthy", "degraded"))
        self.assertIn("database_connected", data)
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

    def test_file_and_folder_target_resolution_and_fs_list(self):
        from pathlib import Path
        from services.orchestrator.workspace import WorkspaceManager

        repo_root = Path(__file__).resolve().parents[2].resolve()
        mgr = WorkspaceManager()

        root_file, files_1 = mgr.resolve_target_path(str(repo_root / "requirements.txt"))
        self.assertEqual(Path(root_file).resolve(), repo_root)
        self.assertEqual(files_1, ["requirements.txt"])

        root_sub, files_2 = mgr.resolve_target_path(str(repo_root / "services" / "orchestrator"))
        self.assertEqual(Path(root_sub).resolve(), repo_root)
        self.assertEqual(files_2, ["services/orchestrator"])

        root_all, files_3 = mgr.resolve_target_path(str(repo_root))
        self.assertEqual(Path(root_all).resolve(), repo_root)
        self.assertEqual(files_3, [])

        # GET /fs/list returns workspace entries
        fs_res = self.client.get("/fs/list?limit=50")
        self.assertEqual(fs_res.status_code, 200)
        fs_data = fs_res.json()
        self.assertEqual(Path(fs_data["root"]).resolve(), repo_root)
        self.assertTrue(len(fs_data["entries"]) > 0)

        # POST /tasks pointing project_path at a single file resolves enclosing folder + context_files
        res = self.client.post(
            "/tasks",
            json={
                "description": "def broken(x):\n    return x / 0",
                "project_path": str(repo_root / "requirements.txt"),
                "context_files": [str(repo_root / "services" / "orchestrator" / "api.py")],
            },
        )
        self.assertEqual(res.status_code, 200)
        task = res.json()
        try:
            self.assertEqual(task["title"], "Fix code: def broken(x):")
            self.assertEqual(
                task["metadata"]["context_files"],
                ["services/orchestrator/api.py", "requirements.txt"],
            )
        finally:
            self.client.delete(f"/tasks/{task['id']}")

    def test_fs_browse_and_static_no_cache_headers(self):
        from pathlib import Path

        repo_root = Path(__file__).resolve().parents[2].resolve()

        # Default workspace browse
        res = self.client.get("/fs/browse")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(Path(data["current_dir"]).resolve(), repo_root)
        self.assertIsNotNone(data["parent_dir"])
        self.assertTrue(len(data["drives"]) >= 1)
        folder_names = [f["name"] for f in data["folders"]]
        self.assertIn("services", folder_names)
        self.assertIn("apps", folder_names)

        # Recursive search query
        q_res = self.client.get("/fs/browse?query=api.py")
        self.assertEqual(q_res.status_code, 200)
        q_data = q_res.json()
        rel_files = [f["rel_path"] for f in q_data["files"]]
        self.assertIn("services/orchestrator/api.py", rel_files)

        # Navigate up to parent and drive anchor without error
        drive_anchor = str(Path(repo_root).anchor)
        drv_res = self.client.get(f"/fs/browse?path={drive_anchor}")
        self.assertEqual(drv_res.status_code, 200)
        self.assertIsNone(drv_res.json()["parent_dir"])

        # Static dashboard assets disable browser cache
        for asset in ("/", "/app.js", "/styles.css"):
            r = self.client.get(asset)
            self.assertEqual(r.status_code, 200)
            self.assertIn("no-cache", r.headers.get("cache-control", "").lower())

    def test_image_upload_validation_serving_and_workspace_isolation(self):
        import base64
        import tempfile
        from pathlib import Path
        from services.orchestrator.workspace import WorkspaceManager

        png_1x1 = base64.b64encode(
            b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
            b"\x08\x06\x00\x00\x00\x1f\x15c4\x00\x00\x00\x0bIDATx\x9cc`\x00\x02"
            b"\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
        ).decode("ascii")
        res = self.client.post(
            "/uploads/image",
            json={"filename": "Screen Shot 1.png", "data_url": f"data:image/png;base64,{png_1x1}"},
        )
        self.assertEqual(res.status_code, 200)
        uploaded = res.json()
        saved_path = Path(uploaded["path"])
        try:
            self.assertTrue(saved_path.is_file())
            self.assertTrue(uploaded["url"].startswith("/uploads/"))
            self.assertNotIn("_", uploaded["filename"])

            get_res = self.client.get(uploaded["url"])
            self.assertEqual(get_res.status_code, 200)
            self.assertEqual(get_res.headers.get("content-type"), "image/png")

            # Workspace resolution must keep an external non-git project intact when uploads are attached
            mgr = WorkspaceManager()
            with tempfile.TemporaryDirectory() as ext_dir:
                eff_root, add_dirs = mgr.resolve_effective_project_and_add_dirs(
                    ext_dir, "Fix button alignment using screenshot", [str(saved_path)]
                )
                self.assertEqual(Path(eff_root).resolve(), Path(ext_dir).resolve())
                self.assertIn(str(saved_path.parent.resolve()), add_dirs)
        finally:
            if saved_path.exists():
                saved_path.unlink()

        bad_res = self.client.post(
            "/uploads/image",
            json={"filename": "evil.txt", "data_url": "data:text/plain;base64,SGVsbG8="},
        )
        self.assertEqual(bad_res.status_code, 400)

        bad_get = self.client.get("/uploads/missing-file.txt")
        self.assertEqual(bad_get.status_code, 400)

        missing_get = self.client.get("/uploads/does-not-exist.png")
        self.assertEqual(missing_get.status_code, 404)

    def test_repo_status_endpoint(self):
        res = self.client.get("/repo/status")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertTrue(data["is_git_repo"])
        self.assertTrue(bool(data["branch"]))
        self.assertIsNotNone(data["latest_commit"])
        self.assertIsInstance(data["worktrees"], list)
        self.assertGreaterEqual(len(data["worktrees"]), 1)

    def test_diagnostics_endpoint(self):
        res = self.client.get("/diagnostics")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        # Backward-compatible keys
        for key in ("status", "active_errors", "total_tasks", "failed_tasks", "database", "agents"):
            self.assertIn(key, data)
        # New keys
        for key in ("task_counts", "run_counts", "pending_approvals", "registered_agents",
                    "available_agents", "total_workflows", "verified_workflows",
                    "database_connected", "database_dialect"):
            self.assertIn(key, data)
        self.assertEqual(data["registered_agents"], 4)
        self.assertGreaterEqual(data["available_agents"], 2)
        # At least one available descriptor present
        avail_flags = {a.get("available") for a in data["agents"]}
        self.assertIn(True, avail_flags)
        # task_counts has all statuses
        self.assertIsInstance(data["task_counts"], dict)
        for st in ("PENDING", "RUNNING", "COMPLETED", "FAILED", "CANCELLED", "TIMED_OUT", "AWAITING_APPROVAL"):
            self.assertIn(st, data["task_counts"])
        # Empty-ish state: exact counts are non-negative
        self.assertGreaterEqual(data["pending_approvals"], 0)

    def test_diagnostics_task_counts_not_truncated(self):
        created_ids = []
        try:
            for i in range(55):
                r = self.client.post("/tasks", json={"description": f"diagnostics count test {i}", "policy_mode": "AUTO_LOW_IMPACT"})
                self.assertEqual(r.status_code, 200)
                created_ids.append(r.json()["id"])
            res = self.client.get("/diagnostics")
            self.assertEqual(res.status_code, 200)
            data = res.json()
            self.assertGreaterEqual(data["total_tasks"], 55)
            # Sum of task_counts equals total_tasks
            self.assertEqual(sum(data["task_counts"].values()), data["total_tasks"])
        finally:
            for tid in created_ids:
                self.client.delete(f"/tasks/{tid}")

    def test_static_no_fake_literals(self):
        from pathlib import Path
        repo_root = Path(__file__).resolve().parents[2]
        for rel in ("apps/dashboard/index.html", "apps/dashboard/app.js"):
            text = (repo_root / rel).read_text(encoding="utf-8")
            for forbidden in ("PostgreSQL 18", "localhost:5433", "Ahmed", "● LIVE"):
                self.assertNotIn(forbidden, text, msg=f"{forbidden!r} found in {rel}")
        html = (repo_root / "apps/dashboard/index.html").read_text(encoding="utf-8")
        self.assertNotIn('id="diagDbValue">OK', html)
        self.assertNotIn("Status: healthy", html)

    def test_health_and_diagnostics_degraded_when_db_unavailable(self):
        from unittest.mock import patch
        probe = {
            "connected": False,
            "dialect": None,
            "version": None,
            "database": None,
            "host": None,
            "port": None,
            "error": "db down",
        }
        with patch("services.orchestrator.api._probe_database", return_value=probe):
            for path in ("/health", "/diagnostics"):
                res = self.client.get(path)
                self.assertEqual(res.status_code, 200, msg=path)
                data = res.json()
                self.assertFalse(data["database_connected"], msg=path)
                self.assertEqual(data["status"], "degraded", msg=path)

    def test_diagnostics_degraded_when_session_fails(self):
        from unittest.mock import patch
        probe = {
            "connected": True,
            "dialect": "sqlite",
            "version": None,
            "database": "test",
            "host": None,
            "port": None,
            "error": None,
        }
        with patch("services.orchestrator.api._probe_database", return_value=probe):
            with patch("services.orchestrator.api.get_db_session", side_effect=RuntimeError("session boom")):
                res = self.client.get("/diagnostics")
                self.assertEqual(res.status_code, 200)
                data = res.json()
                self.assertFalse(data["database_connected"])
                self.assertEqual(data["status"], "degraded")
                # Zeroed defaults with all TaskStatus keys present, even on failure.
                self.assertEqual(data["total_tasks"], 0)
                self.assertEqual(data["active_errors"], 0)
                self.assertIsInstance(data["task_counts"], dict)
                for st in ("PENDING", "RUNNING", "COMPLETED", "FAILED", "CANCELLED", "TIMED_OUT", "AWAITING_APPROVAL"):
                    self.assertIn(st, data["task_counts"])
                    self.assertEqual(data["task_counts"][st], 0)

    def test_registry_list_descriptors_synthesizes_unavailable(self):
        from unittest.mock import patch
        from services.agent_bridge.registry import AgentRegistry
        registry = AgentRegistry()
        adapter = list(registry._adapters.values())[0]
        atype = adapter.agent_type
        before = registry.registered_count()
        with patch.object(adapter, "detect", return_value=None):
            descs = registry.list_descriptors()
            self.assertEqual(registry.registered_count(), before)
            d = next(x for x in descs if x.agent_type == atype)
            self.assertFalse(d.is_available)
        with patch.object(adapter, "detect", side_effect=RuntimeError("boom")):
            descs = registry.list_descriptors()
            self.assertEqual(registry.registered_count(), before)
            d = next(x for x in descs if x.agent_type == atype)
            self.assertFalse(d.is_available)


    def test_diagnostics_task_counts_zeroed_on_mid_session_failure(self):
        from unittest.mock import patch, MagicMock
        probe = {
            "connected": True,
            "dialect": "sqlite",
            "version": None,
            "database": "test",
            "host": None,
            "port": None,
            "error": None,
        }
        fake_session = MagicMock()

        call_counter = {"n": 0}

        def count_side_effect(*args, **kwargs):
            call_counter["n"] += 1
            if call_counter["n"] >= 4:
                raise RuntimeError("mid-session boom")
            return 0

        fake_session.query.return_value.count.side_effect = count_side_effect
        fake_session.query.return_value.filter_by.return_value.count.side_effect = count_side_effect

        cm = MagicMock()
        cm.__enter__.return_value = fake_session
        cm.__exit__.return_value = False

        with patch("services.orchestrator.api._probe_database", return_value=probe):
            with patch("services.orchestrator.api.get_db_session", return_value=cm):
                res = self.client.get("/diagnostics")
                self.assertEqual(res.status_code, 200)
                data = res.json()
                self.assertFalse(data["database_connected"])
                self.assertEqual(data["status"], "degraded")
                self.assertEqual(data["total_tasks"], 0)
                self.assertEqual(data["active_errors"], 0)
                self.assertIsInstance(data["task_counts"], dict)
                for st in ("PENDING", "RUNNING", "COMPLETED", "FAILED", "CANCELLED", "TIMED_OUT", "AWAITING_APPROVAL"):
                    self.assertIn(st, data["task_counts"])
                    self.assertEqual(data["task_counts"][st], 0)

if __name__ == "__main__":
    unittest.main()
