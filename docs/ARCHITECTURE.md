# System Architecture

**Document status:** Initial architecture baseline  
**Project:** AI Coding Command Center

## 1. Product objective

Build a local-first control plane that can coordinate multiple AI coding agents across multiple software projects. It should support autonomous task execution while enforcing isolation, policy, observability, and human approval for high-impact actions.

The system uses a **hybrid operating model**: orchestration and project/worktree management run locally; model inference may use cloud providers or local providers where configured and verified.

## 2. Confirmed project structure

```text
AI-Coding-Command-Center/
├── apps/
│   ├── dashboard/
│   └── desktop/
├── services/
│   ├── orchestrator/
│   └── agent-bridge/
│       ├── antigravity/
│       └── opencode/
├── packages/
│   └── contracts/
├── docs/
├── tests/
│   ├── unit/
│   ├── integration/
│   └── e2e/
├── scripts/
├── data/
└── workspace/
    ├── projects/
    └── worktrees/
```

The structure is an initial foundation, not a restriction. New agents, services, packages, and applications may be added when justified.

## 3. Logical components

### 3.1 Orchestrator

The orchestrator is the system's control plane. Its responsibilities are:

- Accept and validate tasks.
- Maintain task and run lifecycle state.
- Select an eligible agent adapter according to policy and task requirements.
- Allocate an isolated working directory/worktree.
- Enforce concurrency, timeout, retry, and approval policies.
- Collect progress, output, exit status, and evidence.
- Coordinate validation and review stages.
- Persist run history and audit events.
- Recover or mark interrupted work safely.

It should depend on adapter interfaces and shared contracts, not individual agent implementations.

### 3.2 Agent bridges

Each bridge translates the common internal task contract into a specific agent's supported interface.

Initial bridge directories are reserved for Antigravity and OpenCode. Their actual automation capabilities remain **pending validation**. The existence of a directory does not mean an integration is implemented or supported.

Future bridges may include Claude Code, Qwen Code, Codex, DeepSeek-based tools, OpenClaw, or other compatible agents. Add them independently; do not make the orchestrator depend on a fixed list.

### 3.3 Shared contracts

`packages/contracts` owns stable schemas for:

- Task requests and task results.
- Agent capabilities and health.
- Run lifecycle events.
- Approval requests and decisions.
- Workspace and worktree references.
- Structured errors.
- Audit records.

Contracts should be versioned and validated at process boundaries. Avoid sharing implementation-specific classes between services.

### 3.4 Dashboard and desktop application

The dashboard is the primary operational view. The desktop application may provide a desktop shell, local notifications, and OS integration. Their exact technology and division of responsibilities are **not yet approved**.

Both clients should communicate with the orchestrator through a documented application API. They should not invoke coding agents directly or bypass orchestrator policy.

### 3.5 Persistence

A local database is expected to store task metadata, run history, configuration metadata, approvals, and audit events. The database engine and migration strategy are **pending validation**.

Large logs and artifacts may be stored as files with database references. Secrets must be stored using an appropriate OS-backed or otherwise protected secret mechanism, not as plaintext application records.

### 3.6 Workspace manager

The workspace manager owns project registration and task-specific Git worktrees. It should verify repository state before creating work, avoid modifying a user's primary working tree, and track cleanup eligibility.

Never automatically delete a worktree containing uncommitted user changes or unmerged work.

## 4. High-level execution flow

1. User submits a task through the dashboard or desktop app.
2. Orchestrator validates the request and applicable policy.
3. Orchestrator selects a project and creates or allocates an isolated worktree.
4. Agent capability registry selects an adapter that satisfies the task requirements.
5. Adapter starts the agent with scoped context and permissions.
6. Orchestrator records progress, output, and state transitions.
7. Validation stages run the configured tests and checks.
8. A separate review stage may inspect the changes.
9. Orchestrator presents results, diffs, test evidence, and any required approval.
10. Integration, push, deployment, and cleanup follow explicit policy; high-impact operations require approval.

## 5. Integration strategy

Prefer a common protocol such as ACP only when a specific agent's implementation has been verified to support the required lifecycle and policy features. Otherwise, use a CLI or documented API adapter.

A common protocol does not eliminate the need for capability discovery: adapters must still report which features they actually support.

## 6. Technology decisions

The following are candidates, not approved implementation decisions:

| Area | Candidate | Status |
|---|---|---|
| Orchestrator language | Python 3.11 | Installed and verified; architecture fit still to be confirmed |
| Backend API | FastAPI | Proposed |
| Dashboard | React + TypeScript | Proposed |
| Desktop shell | To be evaluated against existing desktop tooling | Pending |
| Initial database | SQLite | Proposed; concurrency and durability needs to be checked |
| Process execution | Async subprocess/process supervision | Proposed |
| Isolation | Git worktrees plus scoped execution policies | Proposed |
| Agent protocol | ACP where verified; otherwise dedicated adapters | Pending validation |

Do not install or adopt these technologies solely because they appear in this table. Validate requirements and reuse existing suitable tools.

## 7. Quality attributes

- **Safety:** least privilege, isolation, explicit approval boundaries.
- **Reliability:** bounded retries, timeouts, crash recovery, durable run state.
- **Extensibility:** independent adapters and versioned contracts.
- **Observability:** correlated logs, event history, clear run status.
- **Portability:** avoid hard-coded machine paths and shell assumptions.
- **Usability:** understandable status, actionable failures, reviewable diffs.
- **Maintainability:** focused modules, tests, documented decisions.

## 8. Open architecture questions

- Which agent interfaces are stable enough for production use?
- Should the orchestrator expose REST, WebSocket, server-sent events, or a combination?
- What desktop shell best fits the user's existing environment?
- What database and backup strategy meet the expected workload?
- How should model/provider selection and cost tracking work across agents?
- What is the desired approval experience for risky operations?
