# AI Coding Command Center

An extensible local AI Coding Command Center coordinating independently integrated coding agents (**Google Antigravity**, **OpenCode Desktop**, **Claude Code**, and others), managing projects and isolated Git worktrees, recording audit evidence, and persisting task lifecycles in **PostgreSQL 18**.

---

## 1. Quick Start

### Start the Command Center Server
Run the PowerShell launcher script:
```powershell
.\scripts\start_command_center.ps1
```
Or run directly with Python:
```powershell
python scripts\start_command_center.py
```

Once started:
* **Interactive API Documentation:** [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)
* **System Health Check:** [http://127.0.0.1:8000/health](http://127.0.0.1:8000/health)
* **Agent Capabilities:** [http://127.0.0.1:8000/agents](http://127.0.0.1:8000/agents)

---

## 2. Verified Agent Integrations

| Agent | Version | Location | Capabilities Verified |
|---|---|---|---|
| **OpenCode Desktop CLI** | `2.3.2` | `C:\Users\ahmed\AppData\Local\Programs\ai.opencode.desktop\resources\opencode-cli.exe` | Headless execution (`opencode run`), Git Worktree isolation (`--worktree`), JSON output, ACP, MCP |
| **Google Antigravity CLI** | `1.5.12` | `C:\Users\ahmed\.gemini\bin\agy.exe` | Non-interactive execution (`agy -p`), JSON output, ACP stdio server (`agy acp`), AgentAPI (`agentapi.bat`) |
| **Claude Code** | `2.1.316` | `C:\Users\ahmed\.local\bin\claude.exe` | Non-interactive execution (`claude -p`), JSON output, Worktree isolation (`-w`) |
| **Qwen Code** | `0.28.0` | `C:\Users\ahmed\AppData\Roaming\npm\qwen.ps1` | CLI execution |
| **OpenClaw** | `2026.9.4` | `C:\Users\ahmed\AppData\Roaming\npm\openclaw.ps1` | CLI execution |
| **OpenAI Codex** | `26.1111.2228.0` | Windows AppX Package | Desktop application |

---

## 3. Database Architecture (PostgreSQL 18)

* **Engine:** PostgreSQL 18.4 (Windows Service `postgresql-x64-18`)
* **Port:** `5433`
* **Database:** `command_center`
* **Tables:**
  * `projects`: Registered workspaces and repositories
  * `tasks`: Task definitions, assigned agents, policy modes, and state
  * `agent_runs`: Process execution records, durations, exit codes, and output
  * `approvals`: Human-in-the-loop permission requests
  * `audit_logs`: Immutable security and lifecycle events
* **Configuration:** Managed via `.env` (copy from `.env.example`).

---

## 4. OpenCode Environment & Safety

### CLI Conflict Resolution
Typing `opencode` now automatically invokes version **2.3.2** via the wrapper in `C:\Users\ahmed\.local\bin\opencode.ps1`. The legacy npm package (`1.19.6`) was preserved without uninstallation.

### Atomic Database Backup
To safely back up OpenCode's 43 MB database (`~/.local/share/opencode/opencode.db`) and its active WAL pages:
```powershell
python scripts\backup_opencode.py
```
Verified backups are stored with timestamps in `C:\Users\ahmed\.local\share\opencode\backups\`.

---

## 5. Running Tests

Run all unit tests across contracts, database models, and agent adapters:
```powershell
python -m unittest discover tests/unit
```
*(All 10 unit tests pass against live PostgreSQL and contracts).*

---

## 6. Project Structure

```text
AI-Coding-Command-Center/
├── packages/
│   └── contracts/           # Pydantic schemas (Task, Agent, Approval, Enums)
├── services/
│   ├── orchestrator/        # Task engine, FastAPI API, Git worktrees, PostgreSQL DB
│   └── agent-bridge/        # Adapter bridges (OpenCode, Antigravity)
├── scripts/
│   ├── start_command_center.ps1   # PowerShell server launcher
│   ├── start_command_center.py    # Python server launcher
│   ├── backup_opencode.py         # SQLite online atomic backup
│   └── opencode.ps1               # OpenCode 2.3.2 wrapper
├── tests/
│   └── unit/                # Unit test suite
├── docs/                    # Architecture and decision records
├── workspace/
│   ├── projects/            # User-registered checkouts
│   └── worktrees/           # Isolated Git worktrees for agent tasks
└── data/                    # Local runtime logs and temporary state
```
