# AI Coding Command Center — Agent Instructions

## 1. Purpose

This repository builds an extensible, hybrid AI Coding Command Center. It coordinates independently integrated coding agents, manages projects and isolated worktrees, runs bounded workflows, records evidence, and presents operational status through web and desktop interfaces.

These instructions apply to every human and AI contributor working in this repository.

## 2. Non-negotiable working rules

1. **Inspect before changing.** Read the relevant source, configuration, tests, and documentation before proposing or editing.
2. **Do not invent capabilities.** Verify an installed agent's actual CLI/API behavior and version before implementing or documenting an integration.
3. **No fake completion.** Never claim a command, test, integration, deployment, or validation succeeded unless its result was observed.
4. **Preserve existing behavior.** Avoid broad refactors and unrelated changes. Do not remove features, options, or compatibility without explicit approval and evidence.
5. **Small, reviewable changes.** Prefer focused changes with tests. Avoid generating large files or monolithic modules.
6. **No hidden assumptions.** Label facts as verified, decisions as approved, and proposals as proposed. Record unresolved questions.
7. **No secrets in source control.** Never print, log, commit, or place API keys, tokens, passwords, cookies, or private credentials in reports or test fixtures.
8. **No destructive actions without authorization.** Do not delete user data, rewrite Git history, run destructive migrations, force-push, publish releases, or deploy to production without the required explicit approval.
9. **Do not silently expand scope.** Ask before adding paid services, new infrastructure, new global installations, or unrelated dependencies.
10. **Report evidence.** State files changed, commands run, results, failures, and remaining risks.

## 3. Architecture boundaries

- `apps/dashboard`: browser-based operator interface.
- `apps/desktop`: desktop shell and desktop-specific capabilities.
- `services/orchestrator`: task lifecycle, workflow execution, scheduling, policy enforcement, and coordination.
- `services/agent-bridge/<agent>`: one adapter per supported agent or protocol.
- `packages/contracts`: shared, versioned schemas and message contracts.
- `workspace/projects`: user-managed project checkouts.
- `workspace/worktrees`: isolated Git worktrees created for tasks.
- `data`: local runtime state and database files; never commit runtime secrets or user project contents.
- `docs`: architecture, decisions, security, and implementation documentation.
- `tests`: unit, integration, and end-to-end tests.

Agent-specific behavior must remain behind an adapter. The orchestrator must not contain scattered CLI flags or provider-specific assumptions.

## 4. Autonomy and safety

The intended operating model is highly autonomous, but autonomy is bounded by explicit policy.

- Agents should work in task-specific isolated worktrees wherever practical.
- Each run must have a unique ID, project identity, task description, selected adapter, policy context, timestamps, status, and captured result metadata.
- Apply timeouts, retry limits, concurrency limits, and configurable resource/cost budgets.
- Record tool invocations and meaningful state transitions without recording secrets.
- Default-deny high-impact actions until a policy explicitly permits them.
- Require human approval for remote pushes, production deployments, destructive database operations, irreversible deletion, credential changes, and other high-impact actions.
- Never expose unrestricted host-shell execution as an implicit capability.
- Cancellation must be propagated to the running process/session where the adapter supports it; report when cancellation cannot be confirmed.

Do not enable an agent's unrestricted or “YOLO” mode merely to make automation easier.

## 5. Integration requirements

Before an adapter is considered supported, document and test:

- Exact product and version.
- Invocation method and executable discovery.
- Non-interactive execution behavior.
- Input and output formats.
- Streaming behavior, if available.
- Session creation, resume, and termination behavior.
- Working-directory and workspace isolation.
- Permission and approval controls.
- Timeout and cancellation behavior.
- Exit codes and error classification.
- Authentication requirements without exposing credentials.
- Known limitations and tested operating-system assumptions.

Do not infer support for ACP, HTTP, JSON, streaming, or cancellation from a help summary alone. Verify with a controlled, harmless test.

## 6. Engineering quality

- Prefer clear, typed interfaces and explicit error handling.
- Keep modules focused; target approximately 300 lines or fewer per source file unless a documented reason justifies more.
- Avoid hard-coded user-specific paths, credentials, provider models, and machine assumptions.
- Validate external inputs at boundaries.
- Use structured logs with run/task correlation IDs.
- Add tests for normal behavior, failure paths, cancellation, timeouts, and permission denials.
- Do not weaken tests or lint rules just to obtain a passing result.
- Keep dependencies minimal and justify each new dependency.

## 7. Change workflow

For each implementation task:

1. Restate the scope and acceptance criteria.
2. Inspect relevant code and existing decisions.
3. Identify risks and affected interfaces.
4. Make the smallest coherent change.
5. Add or update tests.
6. Run the relevant tests, type checks, and lint checks that are available.
7. Report exact commands and outcomes.
8. List anything not verified.

Do not commit changes unless explicitly asked or an approved workflow says to do so.

## 8. Documentation status labels

Use these labels consistently:

- **Verified** — directly confirmed by command output, source inspection, or a reproducible test.
- **Approved** — explicitly selected by the project owner.
- **Proposed** — a recommendation not yet approved.
- **Pending validation** — requires testing or further evidence.
- **Deferred** — intentionally postponed.
