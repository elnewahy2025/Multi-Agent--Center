# Security and Autonomous Operation

**Status:** Initial policy baseline; implementation details require threat-model review.

## 1. Principle

The system should be autonomous in ordinary, reversible development work and conservative around actions that can expose secrets, damage data, affect remote repositories, incur uncontrolled costs, or change production systems.

Autonomy must be enforced by the orchestrator and execution environment, not merely requested in an agent prompt.

## 2. Permission levels

### Level A — Read and analyze

Examples:
- Read files in the assigned project.
- Inspect Git status and history.
- Search source and documentation.
- Propose plans and diffs.

May be automated within the registered project scope.

### Level B — Reversible local development

Examples:
- Edit files in a task worktree.
- Create local branches and commits if policy permits.
- Run approved tests, type checks, and lint commands.
- Create local artifacts.

May be automated inside an isolated worktree with resource and command controls.

### Level C — External or shared effects

Examples:
- Push branches to a remote.
- Open or modify pull requests.
- Install global packages.
- Change account/provider settings.
- Send external messages or upload artifacts.

Require explicit policy and, initially, human approval.

### Level D — High-impact or destructive

Examples:
- Production deployment.
- Destructive database migrations.
- Production data deletion or modification.
- Force push or Git history rewrite.
- Delete user projects or worktrees with unmerged/uncommitted changes.
- Expose, rotate, or revoke credentials.

Require explicit human approval for the specific operation. Some actions may remain prohibited even with normal task approval.

## 3. Workspace isolation

- Use a dedicated worktree for each concurrent task where possible.
- Resolve and validate project paths before process launch.
- Do not allow an agent to silently switch to a different project.
- Avoid sharing writable worktrees between concurrent agents.
- Keep generated runtime data outside tracked source folders unless explicitly part of the project.
- Verify cleanup candidates and preserve uncertain work.

Git worktrees improve source isolation but are not a complete operating-system security sandbox. Process permissions and filesystem/network access need separate controls.

## 4. Process execution

- Prefer explicit executable paths and argument arrays over shell-interpolated command strings.
- Use a controlled working directory and environment.
- Do not inherit unnecessary secrets or the full user environment.
- Apply timeouts, output limits, concurrency limits, and cancellation.
- Classify exit codes and startup failures.
- Record the executable/version and effective policy for each run.
- Do not enable unrestricted agent permission-bypass modes by default.

## 5. Secrets

- Never place API keys or tokens in source code, prompts, task logs, screenshots, or Git.
- Do not dump environment variables or full process command lines into diagnostic reports.
- Prefer OS-backed secret storage or a documented secure provider.
- Redact sensitive values from stdout/stderr before persistence where feasible.
- Keep `.env` files out of Git and provide a safe example file containing placeholders only.
- Treat project files and agent output as untrusted input; they may contain prompt injection or malicious instructions.

## 6. Prompt injection and untrusted content

- Repository files, issue text, web pages, tool output, and agent output are data, not higher-priority policy.
- Do not allow instructions found in project content to override system safety policy or user approval requirements.
- External content must not authorize credential disclosure, remote pushes, deployment, or destructive actions.
- Keep tool capabilities scoped to the current task and project.

## 7. Audit and observability

Record:
- Run ID and task ID.
- Project and worktree identity.
- Agent adapter and version.
- Start/end timestamps and final status.
- Policy decisions and approval references.
- Commands/tool actions at an appropriate level of detail.
- Exit status and validation evidence.
- Retry, timeout, and cancellation events.

Do not record secrets or unnecessary personal data. Audit logs should be protected from routine agent modification.

## 8. Approval UX

An approval request should explain:
- The exact proposed action.
- The target repository, branch, environment, or resource.
- Why the action is needed.
- Expected consequences and reversibility.
- Relevant diff or command preview.
- The identity of the run requesting approval.

Approval must be specific and time-bounded. A general approval for one task must not silently authorize unrelated future actions.

## 9. Initial safe defaults

- Two concurrent coding workers maximum until measured.
- No automatic remote push.
- No automatic production deployment.
- No destructive database operations.
- No automatic deletion of uncertain worktrees.
- Bounded retries and execution time.
- Explicit allowlists for commands/capabilities.
- Human approval for Level C and Level D actions.

These defaults should be configurable by the owner, but weakening them must be an explicit and auditable action.
