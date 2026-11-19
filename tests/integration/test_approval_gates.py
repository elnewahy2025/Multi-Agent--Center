"""Integration test for human-in-the-loop approval API, custom instructions, and UI assets."""

import json
import sys
import urllib.request
import uuid
from pathlib import Path

root_dir = Path(__file__).resolve().parent.parent.parent
if str(root_dir) not in sys.path:
    sys.path.insert(0, str(root_dir))

from services.orchestrator.db import ApprovalModel, AuditLogModel, TaskModel, get_db_session

API_BASE = "http://127.0.0.1:8000"


def _post_json(url: str, payload: dict) -> dict:
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url, data=data, headers={"Content-Type": "application/json"}, method="POST",
    )
    with urllib.request.urlopen(req) as res:
        return json.loads(res.read().decode("utf-8"))


def test_approval_gates_api_and_ui() -> None:
    task_id = f"tsk_apr_{uuid.uuid4().hex[:8]}"
    apr_id = f"apr_int_{uuid.uuid4().hex[:8]}"

    with get_db_session() as s:
        s.add(TaskModel(
            id=task_id,
            title="Approval Gate Integration Test",
            description="Test high-impact approval pause and operator instructions.",
            policy_mode="ASK",
            status="AWAITING_APPROVAL",
        ))
        s.add(ApprovalModel(
            id=apr_id,
            task_id=task_id,
            run_id="wf_test",
            action_type="PRE_EXECUTION_APPROVAL",
            command_or_path="C:\\workspace\\worktree",
            description="Task policy mode is 'ASK', requiring human confirmation.",
            risk_level="HIGH",
            decision="PENDING",
        ))

    try:
        # 1. Verify GET /approvals lists our pending approval
        with urllib.request.urlopen(f"{API_BASE}/approvals") as res:
            approvals = json.loads(res.read().decode("utf-8"))
        matched = [a for a in approvals if a["id"] == apr_id]
        assert len(matched) == 1, f"Expected approval {apr_id} in /approvals"
        assert matched[0]["task_id"] == task_id

        # 2. Decide with operator instructions (reason)
        dec = _post_json(
            f"{API_BASE}/approvals/{apr_id}/decide",
            {
                "decision": "APPROVED",
                "decided_by": "Ahmed",
                "reason": "Skip driver upgrade; only pin bounds",
            },
        )
        assert dec["decision"] == "APPROVED"
        assert dec["status"] == "RECORDED"

        # 3. Verify reason stored and approval removed from pending list
        with urllib.request.urlopen(f"{API_BASE}/approvals") as res:
            remaining = json.loads(res.read().decode("utf-8"))
        assert not any(a["id"] == apr_id for a in remaining), "Approval should no longer be PENDING"

        with get_db_session() as s:
            row = s.query(ApprovalModel).filter_by(id=apr_id).first()
            assert row and row.reason == "Skip driver upgrade; only pin bounds"

        # 4. Verify live dashboard assets serve AWAITING_APPROVAL UI & decision modal
        app_js = urllib.request.urlopen(f"{API_BASE}/app.js").read().decode("utf-8")
        styles_css = urllib.request.urlopen(f"{API_BASE}/styles.css").read().decode("utf-8")
        assert "AWAITING_APPROVAL" in app_js and "modalAprNote_" in app_js
        assert "modal-approval-box" in styles_css and "approval-note-input" in styles_css

        print("SUCCESS: Approval gates API, operator reason persistence, and UI assets verified!")
    finally:
        with get_db_session() as s:
            s.query(AuditLogModel).filter_by(task_id=task_id).delete()
            s.query(ApprovalModel).filter_by(id=apr_id).delete()
            s.query(TaskModel).filter_by(id=task_id).delete()


if __name__ == "__main__":
    test_approval_gates_api_and_ui()
