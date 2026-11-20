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


if __name__ == "__main__":
    unittest.main()
