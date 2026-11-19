# Implementation Roadmap

**Status:** Proposed phased plan; each phase requires evidence-based acceptance.

## Guiding approach

Build a reliable control plane before building a polished interface or adding many agents. Work in small, reviewable stages. Do not install infrastructure until a demonstrated requirement justifies it.

## Phase 0 — Foundation and decisions

**Goal:** Establish repository conventions and verify the environment.

Tasks:
- Confirm the repository structure and Git root.
- Add root `AGENTS.md` and core architecture/security documentation.
- Record confirmed decisions separately from proposals.
- Confirm intended Git author identity before the first commit.
- Inspect existing agent versions and their actual automation interfaces.
- Decide initial runtime stack only after a short technical validation.

Acceptance:
- Folder structure matches the documented baseline.
- No secrets or runtime data are tracked.
- Architecture decisions are clearly labeled.
- Agent integration claims are supported by evidence.

## Phase 1 — Orchestrator skeleton

**Goal:** Create a minimal service that can accept, track, and report a task without yet granting broad agent execution.

Tasks:
- Define shared task/run/error/event contracts.
- Implement configuration loading and validation.
- Implement task lifecycle and persistence.
- Add health/status endpoints.
- Add structured logging and correlation IDs.
- Add unit and integration tests.

Acceptance:
- Tasks can be created, queried, and transitioned through valid states.
- Invalid transitions are rejected.
- Restart behavior is tested.
- No agent can execute outside an approved workspace/policy.

## Phase 2 — Workspace and process supervision

**Goal:** Safely prepare isolated workspaces and supervise child processes.

Tasks:
- Register local Git projects.
- Validate repository identity and working-tree state.
- Create task-specific Git worktrees.
- Implement process start, output capture, timeout, cancellation, and exit handling.
- Apply concurrency and retry limits.
- Preserve uncommitted work; never auto-delete uncertain worktrees.

Acceptance:
- Parallel tasks use separate worktrees.
- A timed-out or cancelled process is reported accurately.
- A failed run does not corrupt the primary project checkout.
- Workspace cleanup is guarded and tested.

## Phase 3 — First agent bridge

**Goal:** Integrate one agent end-to-end using the safest verified interface.

Selection criteria:
- Reliable non-interactive execution.
- Predictable output and exit status.
- Working-directory control.
- Permission controls.
- Session lifecycle and cancellation behavior.
- Clear authentication and configuration model.

Do not select an adapter solely because its CLI has a `run` command.

Acceptance:
- Harmless smoke test passes.
- A bounded coding task can run in a disposable test repository.
- Logs and results are captured without secrets.
- Permission-denied, timeout, cancellation, and agent-failure paths are tested.

## Phase 4 — Validation and review workflow

**Goal:** Make agent output verifiable.

Tasks:
- Configurable test/type/lint commands per project.
- Capture exact commands and exit codes.
- Add independent review stage.
- Summarize changed files and diffs.
- Distinguish agent claims from orchestrator-verified evidence.

Acceptance:
- The system never reports tests as passing when they were not run.
- Review findings link to actual files/changes.
- Failed validation blocks progression according to policy.

## Phase 5 — Additional bridges and scheduling

**Goal:** Add agent diversity and controlled concurrency.

Tasks:
- Add bridges independently.
- Build capability discovery and health checks.
- Add scheduling and task routing.
- Add configurable concurrency, retry, timeout, and cost budgets.
- Compare adapters using repeatable test tasks.

Acceptance:
- A bridge can be added without changing core task lifecycle code.
- Unsupported capabilities are reported honestly.
- Routing decisions are explainable and auditable.

## Phase 6 — Dashboard

**Goal:** Provide a useful operator interface over proven backend behavior.

Initial views:
- Overview and active runs.
- Task creation and queue.
- Agent status/capabilities.
- Project and worktree management.
- Run details, logs, diffs, validation, and approvals.
- Settings and audit history.

Acceptance:
- UI actions go through the orchestrator API.
- Backend policy cannot be bypassed by hiding or disabling UI controls.
- Live status and error states are understandable.

## Phase 7 — Desktop application

**Goal:** Add desktop-specific convenience only after the API and dashboard workflows stabilize.

Possible features:
- Desktop shell.
- Local notifications.
- Launch at user request or startup (opt-in).
- Secure local connection to orchestrator.
- Deep links to runs and project folders.

Desktop technology is to be selected after evaluating existing installed tooling and packaging requirements.

## Phase 8 — Hardening and release readiness

Tasks:
- Threat model and security review.
- Backup/restore and crash recovery tests.
- Dependency and license review.
- Resource and cost limits.
- Installer/update strategy if required.
- End-to-end tests on the target Windows environment.
- Operational documentation.

Acceptance:
- Recovery, isolation, permissions, and data retention are tested.
- Known limitations are documented.
- No production deployment or destructive action occurs without approval.

## Initial concurrency

Start with a maximum of **two concurrent coding workers** as a conservative proposed default. Measure CPU, memory, provider rate limits, and task quality before increasing it.
