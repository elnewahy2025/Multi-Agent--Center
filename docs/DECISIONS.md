# Architecture Decision Register

This document separates owner-approved choices from proposals and unresolved questions. Update it when a decision is explicitly made or validated.

## Approved decisions

| ID | Decision | Rationale / notes |
|---|---|---|
| ADR-001 | Product is an AI Coding Command Center coordinating multiple coding agents. | Explicit project goal. |
| ADR-002 | Operating model is fully autonomous within defined safety boundaries. | Owner selected fully autonomous operation; this does not mean unrestricted permissions. |
| ADR-003 | Deployment model is hybrid. | Local orchestration with cloud and/or local model providers as appropriate. |
| ADR-004 | Initial repository root is `C:\Users\ahmed\AI-Coding-Command-Center`. | Confirmed by successful PowerShell output. |
| ADR-005 | Use the currently created directory structure as the initial foundation and allow additions later. | Owner supplied and created the structure. |
| ADR-006 | Initial agent-bridge directories are `antigravity` and `opencode`. | Present in the verified project structure; this does not assert that either adapter is implemented. |
| ADR-007 | Continually track and commit verified project milestones to source control. | Explicitly directed by user ("always save our progress"). |
| ADR-008 | PostgreSQL 18 on port 5433 selected for Command Center persistence. | Dedicated database `command_center` created and verified. |
| ADR-009 | OpenCode SQLite state protected via atomic SQLite online backup. | Verified backup script `scripts/backup_opencode.py` created and tested with PRAGMA quick_check passing. |
| ADR-010 | OpenCode CLI conflict resolved via user-local wrapper in `.local\bin`. | Prioritizes Desktop CLI 2.3.2 over obsolete npm 1.19.6 without destructive uninstallation. |

## Verified environment facts

These facts were confirmed through direct execution and system inspection:

- Windows 11 environment.
- Python 3.11.9 is available and is the default Python launcher version.
- Git 2.53.0.windows.1 is available.
- Node.js v26.7.0 and npm 11.12.1 are available; pnpm 11.22.0 is available.
- PostgreSQL 18 is installed (`C:\Program Files\PostgreSQL\18\bin\psql.exe`), active as a Windows Service (`postgresql-x64-18`), and listening on port `5433`.
- Docker is installed (`C:\Program Files\Docker\Docker\resources\bin\docker.exe`).
- OpenCode Desktop CLI 2.3.2 is verified at `C:\Users\ahmed\AppData\Local\Programs\ai.opencode.desktop\resources\opencode-cli.exe`. It recognizes and reads the 43MB database (`C:\Users\ahmed\.local\share\opencode\opencode.db`) and lists all projects/sessions without errors.
- OpenCode Desktop application is running (PID 13444) with active background service `opencode-cli.exe serve --service` (PID 3516).
- Antigravity CLI `agy.exe` 1.5.12 (`C:\Users\ahmed\.gemini\bin\agy.exe`) and Antigravity IDE 1.107.0 (`C:\Users\ahmed\AppData\Local\Programs\Antigravity IDE`) are verified. Both support ACP (`agy.exe acp`) and non-interactive prompt runs (`agy.exe -p`).
- Claude Code 2.1.316 is verified at `C:\Users\ahmed\.local\bin\claude.exe`.
- Qwen Code 0.28.0 is verified at `C:\Users\ahmed\AppData\Roaming\npm\qwen.ps1`.
- OpenClaw 2026.9.4 is verified at `C:\Users\ahmed\AppData\Roaming\npm\openclaw.ps1`.
- OpenAI Codex Desktop 26.1111.2228.0 is installed as an AppX package.

## Proposed decisions — not yet approved

| ID | Proposal | Validation needed |
|---|---|---|
| PROP-001 | Python 3.11 for orchestrator. | Confirm dependency compatibility, process supervision needs, and packaging. |
| PROP-002 | FastAPI for local backend API. | Confirm API and streaming requirements. |
| PROP-003 | React + TypeScript for dashboard. | Confirm UI needs and existing tooling preferences. |
| PROP-004 | PostgreSQL 18 on port 5433 for Command Center persistence, using SQLAlchemy/asyncpg to maintain SQLite portability. | Confirm database credentials, schema migration setup, and user database preference. |
| PROP-005 | Git worktrees for task isolation. | Prototype concurrent tasks and cleanup safeguards. |
| PROP-006 | ACP as a common agent integration where supported. | Verify each candidate's real ACP behavior and lifecycle controls. |
| PROP-007 | Start with no more than two concurrent coding workers. | Measure resource usage and quality before increasing. |

## Open questions

1. Which installed agent should be the first end-to-end bridge?
2. Should the orchestrator expose REST plus WebSocket or server-sent events?
3. What desktop framework best fits the existing Windows environment?
4. What secret-storage mechanism should be used?
5. What exact approval policy and operator experience are required?
6. What backup, retention, and recovery guarantees are expected?
7. Should task execution support remote/cloud workspaces later, or remain local initially?

## Change control

Before treating a proposal as approved, record the owner's explicit choice and any relevant validation evidence. Do not silently convert a proposal into a fact.
