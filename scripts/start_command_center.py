"""Start the AI Coding Command Center Backend Server."""

import uvicorn
from services.agent_bridge import AgentRegistry
from services.orchestrator.db import get_database_url, init_db


def main():
    print("=" * 65)
    print("       AI CODING COMMAND CENTER — OPERATIONAL CONTROLLER")
    print("=" * 65)

    print("\n[1/3] Initializing Database Schema...")
    init_db()
    print("  -> Connected to PostgreSQL: command_center (port 5433)")

    print("\n[2/3] Scanning Installed Coding Agents...")
    registry = AgentRegistry()
    available = registry.get_available_agents()
    for agent in available:
        print(f"  -> [READY] {agent.name} (v{agent.version})")

    print("\n[3/3] Starting Local API Server...")
    print("  -> API Server:     http://127.0.0.1:8000")
    print("  -> OpenAPI Docs:   http://127.0.0.1:8000/docs")
    print("  -> Health Status:  http://127.0.0.1:8000/health")
    print("=" * 65)
    print("Press CTRL+C at any time to stop the server.\n")

    uvicorn.run(
        "services.orchestrator.api:app",
        host="127.0.0.1",
        port=8000,
        log_level="info",
    )


if __name__ == "__main__":
    main()
