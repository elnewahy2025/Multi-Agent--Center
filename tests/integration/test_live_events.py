"""Integration test verifying live agent event streaming, EventSink upserts, and REST endpoints."""

import json
import sys
import urllib.request
import uuid
from pathlib import Path

root_dir = Path(__file__).resolve().parent.parent.parent
if str(root_dir) not in sys.path:
    sys.path.insert(0, str(root_dir))

from sqlalchemy import inspect
from services.agent_bridge.streaming import ActivityEvent
from services.orchestrator.db import AgentEventModel, TaskModel, get_db_session, get_engine, init_db
from services.orchestrator.events import EventSink

API_BASE = "http://127.0.0.1:8000"


def test_live_event_pipeline() -> None:
    init_db()
    tables = inspect(get_engine()).get_table_names()
    assert "agent_events" in tables, "agent_events table missing!"

    task_id = f"tsk_ev_{uuid.uuid4().hex[:8]}"
    run_id = f"run_ev_{uuid.uuid4().hex[:8]}"

    with get_db_session() as session:
        session.add(TaskModel(
            id=task_id,
            title="Live Event Streaming Test",
            description="Verify ACTIVE -> DONE upserts and text deltas.",
            status="RUNNING",
        ))

    try:
        sink = EventSink(task_id=task_id, run_id=run_id, agent="ANTIGRAVITY", phase="INSPECTION")

        # Simulate ACTIVE tool call followed by DONE update with same key
        sink(ActivityEvent(key="step-2", kind="tool", status="running", tool="read_file", title="api.py"))
        sink(ActivityEvent(
            key="step-2", kind="tool", status="done", tool="read_file", title="api.py",
            content="381 lines read", duration_seconds=1.25,
        ))

        # Simulate streamed text deltas followed by flush
        sink(ActivityEvent(key="step-3", kind="text", status="running", content="Inspecting ", append=True))
        sink(ActivityEvent(key="step-3", kind="text", status="running", content="api.py...", append=True))
        sink.flush()

        # Verify GET /tasks/{task_id}/events
        ev_res = urllib.request.urlopen(f"{API_BASE}/tasks/{task_id}/events")
        ev_data = json.loads(ev_res.read().decode())
        assert ev_data["task_id"] == task_id
        assert ev_data["count"] == 2, f"Expected 2 upserted rows, got {ev_data['count']}"

        tool_ev = ev_data["events"][0]
        text_ev = ev_data["events"][1]
        assert tool_ev["kind"] == "tool" and tool_ev["status"] == "done"
        assert tool_ev["tool"] == "read_file" and tool_ev["title"] == "api.py"
        assert tool_ev["content"] == "381 lines read"
        assert abs((tool_ev["duration_seconds"] or 0.0) - 1.25) < 1e-6

        assert text_ev["kind"] == "text" and text_ev["status"] == "done"
        assert text_ev["content"] == "Inspecting api.py..."

        # Verify GET /tasks/{task_id}/files includes activity_files
        files_res = urllib.request.urlopen(f"{API_BASE}/tasks/{task_id}/files")
        files_data = json.loads(files_res.read().decode())
        assert files_data["total_activity"] == 1
        assert files_data["activity_files"][0]["tool"] == "read_file"
        assert files_data["activity_files"][0]["target"] == "api.py"
        assert files_data["activity_files"][0]["status"] == "DONE"

        # Verify served dashboard HTML includes live activity elements
        html = urllib.request.urlopen(f"{API_BASE}/").read().decode()
        assert "liveActivityFeed" in html
        assert "stageStepper" in html

        print("SUCCESS: agent_events, EventSink upserts, /events, /files, and dashboard HTML verified!")
    finally:
        with get_db_session() as session:
            session.query(AgentEventModel).filter_by(task_id=task_id).delete()
            session.query(TaskModel).filter_by(id=task_id).delete()


if __name__ == "__main__":
    test_live_event_pipeline()
