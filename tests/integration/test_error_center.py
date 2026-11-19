import json
import sys
import urllib.request
from pathlib import Path

# Add project root to sys.path
root_dir = Path(__file__).resolve().parent.parent.parent
if str(root_dir) not in sys.path:
    sys.path.insert(0, str(root_dir))

API_BASE = "http://127.0.0.1:8000"

def test_error_center():
    # 1. Test diagnostics endpoint
    diag_res = urllib.request.urlopen(f"{API_BASE}/diagnostics")
    diag_data = json.loads(diag_res.read().decode())
    print("Diagnostics:", diag_data)
    assert "status" in diag_data
    assert "agents" in diag_data
    assert len(diag_data["agents"]) >= 2, "Expected detected agents"

    # 2. Test errors list
    err_res = urllib.request.urlopen(f"{API_BASE}/errors")
    err_data = json.loads(err_res.read().decode())
    print("Initial active errors:", len(err_data))

    # 3. Insert a simulated diagnostic error to test UI pipeline
    from services.orchestrator.db import ErrorLogModel, get_db_session
    with get_db_session() as session:
        test_err = ErrorLogModel(
            task_id="tsk_test_error",
            run_id="run_test",
            source="OPENCODE_CLI",
            severity="ERROR",
            title="Model Context Limit Warning",
            message="Prompt exceeded 32k tokens, auto-summarization active.",
            stderr="Traceback (simulated): ContextWindowExceeded in opencode-cli.exe",
            resolved=False,
        )
        session.add(test_err)

    # 4. Fetch errors again and verify it is returned
    err_res2 = urllib.request.urlopen(f"{API_BASE}/errors")
    err_data2 = json.loads(err_res2.read().decode())
    print("Active errors after insert:", len(err_data2))
    assert any(e["title"] == "Model Context Limit Warning" for e in err_data2), "Inserted error not found"
    err_id = [e["id"] for e in err_data2 if e["title"] == "Model Context Limit Warning"][0]

    # 5. Test resolving the error
    req = urllib.request.Request(f"{API_BASE}/errors/{err_id}/resolve", method="POST")
    resolve_res = urllib.request.urlopen(req)
    assert resolve_res.status == 200

    # 6. Verify it is now resolved
    err_res3 = urllib.request.urlopen(f"{API_BASE}/errors?unresolved_only=true")
    err_data3 = json.loads(err_res3.read().decode())
    assert not any(e["id"] == err_id for e in err_data3), "Error was not resolved"
    print("SUCCESS: Error Messages Center API & diagnostics fully verified!")

if __name__ == "__main__":
    test_error_center()
