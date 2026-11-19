"""Test asynchronous execution and run output retrieval."""

import json
import time
import urllib.request

BASE = "http://127.0.0.1:8000"


def test_async_execution():
    print("Testing asynchronous task dispatch and polling...")
    payload = {
        "title": "Ping Pong Test",
        "description": "Respond with the single word pong",
        "preferred_agent": "OPENCODE",
        "policy_mode": "AUTO_LOW_IMPACT",
        "use_worktree": False,
    }
    req = urllib.request.Request(
        f"{BASE}/tasks",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req) as res:
        task = json.loads(res.read().decode("utf-8"))
        task_id = task["id"]
        print(f"  -> Task created: {task_id}")

    # Trigger execution
    t0 = time.time()
    req_exec = urllib.request.Request(f"{BASE}/tasks/{task_id}/execute", method="POST")
    with urllib.request.urlopen(req_exec) as res:
        exec_res = json.loads(res.read().decode("utf-8"))
        elapsed = time.time() - t0
        print(f"  -> Trigger returned instantly in {elapsed:.3f}s: {exec_res}")
        assert exec_res["status"] == "RUNNING"

    # Poll status for up to 8 seconds
    final_status = "PENDING"
    for i in range(8):
        time.sleep(1)
        with urllib.request.urlopen(f"{BASE}/tasks/{task_id}") as res:
            current = json.loads(res.read().decode("utf-8"))
            final_status = current["status"]
            print(f"  -> Poll {i+1}s: {final_status}")
            if final_status in ("COMPLETED", "FAILED"):
                break

    # Fetch run output
    with urllib.request.urlopen(f"{BASE}/tasks/{task_id}/runs") as res:
        runs = json.loads(res.read().decode("utf-8"))
        print(f"  -> Total runs recorded: {len(runs)}")
        assert len(runs) > 0
        latest = runs[0]
        print(f"  -> Latest run status: {latest['status']}, exit_code: {latest['exit_code']}")
        print(f"  -> Duration: {latest['duration_seconds']}s")
        assert latest["status"] == "COMPLETED"
        assert "pong" in latest["stdout"].lower()
        print("  -> Verified: Agent stdout contains expected output 'pong'!")


if __name__ == "__main__":
    test_async_execution()
