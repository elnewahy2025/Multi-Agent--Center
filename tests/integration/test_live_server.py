"""Integration test verifying all endpoints and assets of the live running server."""

import json
import urllib.request

BASE = "http://127.0.0.1:8000"


def fetch(url: str, method: str = "GET", payload: dict = None):
    req = urllib.request.Request(url, method=method)
    body = None
    if payload:
        req.add_header("Content-Type", "application/json")
        body = json.dumps(payload).encode("utf-8")

    with urllib.request.urlopen(req, data=body, timeout=5) as res:
        content_type = res.headers.get("Content-Type", "")
        raw = res.read().decode("utf-8")
        if "application/json" in content_type:
            return json.loads(raw)
        return raw


def main():
    print("=" * 60)
    print("   LIVE SERVER END-TO-END VERIFICATION")
    print("=" * 60)

    # 1. Test HTML Dashboard
    print("[1/8] Testing Root HTML (GET /)...")
    html = fetch(f"{BASE}/")
    assert "<title>AI Coding Command Center</title>" in html
    print("      -> OK: Dashboard HTML served successfully.")

    # 2. Test CSS
    print("[2/8] Testing Stylesheet (GET /styles.css)...")
    css = fetch(f"{BASE}/styles.css")
    assert "--bg-color" in css
    print("      -> OK: styles.css served successfully.")

    # 3. Test JS
    print("[3/8] Testing Client Script (GET /app.js)...")
    js = fetch(f"{BASE}/app.js")
    assert "initDashboard" in js
    print("      -> OK: app.js served successfully.")

    # 4. Test Health Check
    print("[4/8] Testing Health Endpoint (GET /health)...")
    health = fetch(f"{BASE}/health")
    assert health["status"] == "healthy"
    print(f"      -> OK: Database: {health['database']}, Active Agents: {health['available_agents']}")

    # 5. Test Agents Listing
    print("[5/8] Testing Agents Endpoint (GET /agents)...")
    agents = fetch(f"{BASE}/agents")
    names = [a["name"] for a in agents]
    print(f"      -> OK: Detected {len(agents)} agents: {', '.join(names)}")

    # 6. Test Task Creation via POST /tasks
    print("[6/8] Testing Task Creation (POST /tasks)...")
    task_input = {
        "title": "Automated End-to-End System Test",
        "description": "Verify task registration, state transitions, and audit records",
        "preferred_agent": "OPENCODE",
        "policy_mode": "AUTO_LOW_IMPACT",
        "use_worktree": False,
    }
    task = fetch(f"{BASE}/tasks", method="POST", payload=task_input)
    task_id = task["id"]
    assert task["status"] == "PENDING"
    print(f"      -> OK: Task created with ID: {task_id}")

    # 7. Test Task Retrieval
    print(f"[7/8] Testing Task Retrieval (GET /tasks/{task_id})...")
    fetched = fetch(f"{BASE}/tasks/{task_id}")
    assert fetched["title"] == task_input["title"]
    print(f"      -> OK: Retrieved task '{fetched['title']}' with status '{fetched['status']}'")

    # 8. Test Audit Trail
    print("[8/8] Testing Audit Log (GET /audit)...")
    audit = fetch(f"{BASE}/audit?limit=10")
    assert len(audit) > 0
    print(f"      -> OK: Audit trail returned {len(audit)} events. Most recent: [{audit[0]['event_type']}]")

    print("\n" + "=" * 60)
    print("SUCCESS: ALL 8 END-TO-END SERVER CHECKS PASSED!")
    print("=" * 60)


if __name__ == "__main__":
    main()
