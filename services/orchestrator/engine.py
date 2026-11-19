"""Core task orchestration and execution engine."""

from __future__ import annotations

import logging
import uuid
from datetime import datetime
from pathlib import Path
from typing import List, Optional

from packages.contracts import (
    AgentExecutionRequest,
    AgentExecutionResult,
    AgentType,
    TaskCreate,
    TaskRead,
    TaskStatus,
    derive_task_title,
    normalize_task_prompt,
)
from services.agent_bridge import AgentRegistry
from services.orchestrator.db import (
    AgentRunModel,
    AuditLogModel,
    ErrorLogModel,
    ProjectModel,
    TaskModel,
    get_db_session,
)
from services.orchestrator.events import EventSink
from services.orchestrator.workspace import WorkspaceManager

logger = logging.getLogger("orchestrator.engine")


class TaskOrchestrator:
    """Coordinates task lifecycle, policy enforcement, worktrees, and agent bridges."""

    def __init__(
        self,
        registry: Optional[AgentRegistry] = None,
        workspace_mgr: Optional[WorkspaceManager] = None,
    ) -> None:
        self.registry = registry or AgentRegistry()
        self.workspace_mgr = workspace_mgr or WorkspaceManager()

    def submit_task(self, request: TaskCreate) -> TaskRead:
        """Register and persist a new task in the Command Center."""
        task_id = f"tsk_{uuid.uuid4().hex[:12]}"
        now = datetime.utcnow()

        with get_db_session() as session:
            # Resolve directory vs single-file/subfolder scope
            project_id = request.project_id
            scoped_files = list(request.context_files)
            if request.project_path or request.context_files:
                project_root, scoped_files = self.workspace_mgr.resolve_target_path(
                    request.project_path, request.context_files,
                )
                if request.project_path and not project_id:
                    existing_p = session.query(ProjectModel).filter_by(root_path=project_root).first()
                    if existing_p:
                        project_id = existing_p.id
                    else:
                        project_id = f"proj_{uuid.uuid4().hex[:8]}"
                        session.add(ProjectModel(
                            id=project_id,
                            name=Path(project_root).name,
                            root_path=project_root,
                        ))

            title = derive_task_title(request.description, request.title)
            model = TaskModel(
                id=task_id,
                project_id=project_id,
                title=title,
                description=request.description,
                assigned_agent=request.preferred_agent.value if request.preferred_agent else None,
                status=TaskStatus.PENDING.value,
                policy_mode=request.policy_mode.value,
                created_at=now,
                updated_at=now,
            )
            model.set_metadata({
                "context_files": scoped_files,
                "timeout_seconds": request.timeout_seconds,
                "use_worktree": request.use_worktree,
            })
            session.add(model)

            # Record audit log
            audit = AuditLogModel(
                task_id=task_id,
                event_type="TASK_CREATED",
                message=f"Task '{title}' submitted",
            )
            session.add(audit)

        return self.get_task(task_id)  # type: ignore

    def get_task(self, task_id: str) -> Optional[TaskRead]:
        """Fetch task state by ID."""
        with get_db_session() as session:
            model = session.query(TaskModel).filter_by(id=task_id).first()
            if not model:
                return None
            return TaskRead(
                id=model.id,
                title=model.title,
                description=model.description,
                project_id=model.project_id,
                assigned_agent=AgentType(model.assigned_agent) if model.assigned_agent else None,
                status=TaskStatus(model.status),
                policy_mode=model.policy_mode,  # type: ignore
                worktree_path=model.worktree_path,
                created_at=model.created_at,
                updated_at=model.updated_at,
                completed_at=model.completed_at,
                metadata=model.get_metadata(),
            )

    def execute_task(self, task_id: str) -> AgentExecutionResult:
        """Execute a pending task using the selected agent adapter."""
        task = self.get_task(task_id)
        if not task:
            raise ValueError(f"Task not found: {task_id}")

        # Choose eligible agent
        agent_type = task.assigned_agent
        if not agent_type:
            # Default to OpenCode if available, otherwise Antigravity
            available = self.registry.get_available_agents()
            if not available:
                raise RuntimeError("No coding agents are currently available on this machine.")
            agent_type = available[0].agent_type

        adapter = self.registry.get_adapter(agent_type)
        if not adapter:
            raise RuntimeError(f"No adapter registered for agent type: {agent_type}")

        run_id = f"run_{uuid.uuid4().hex[:12]}"

        # Resolve working directory and Git worktree
        working_dir = "."
        worktree_path: Optional[Path] = None

        with get_db_session() as session:
            model = session.query(TaskModel).filter_by(id=task_id).first()
            if model and model.project:
                working_dir = model.project.root_path

            # Create isolated worktree if requested
            if task.metadata.get("use_worktree", True) and working_dir != ".":
                try:
                    worktree_path = self.workspace_mgr.create_worktree(
                        project_root=working_dir,
                        task_id=task_id,
                    )
                    working_dir = str(worktree_path)
                    if model:
                        model.worktree_path = working_dir
                except Exception as exc:
                    logger.warning("Could not create worktree, falling back to project root: %s", exc)

            # Update status to RUNNING
            if model:
                model.status = TaskStatus.RUNNING.value
                model.assigned_agent = agent_type.value
                model.updated_at = datetime.utcnow()

            # Record AgentRunModel
            run_model = AgentRunModel(
                id=run_id,
                task_id=task_id,
                agent_type=agent_type.value,
                status="RUNNING",
            )
            session.add(run_model)

        context_files = task.metadata.get("context_files", [])
        req = AgentExecutionRequest(
            task_id=task_id,
            run_id=run_id,
            prompt=normalize_task_prompt(task.description, context_files),
            working_directory=working_dir,
            # WorkspaceManager already points working_directory at the isolated worktree;
            # leave worktree_name=None so CLIs do not spawn a second worktree.
            worktree_name=None,
            policy_mode=task.policy_mode,
            timeout_seconds=task.metadata.get("timeout_seconds", 3600),
            context_files=context_files,
        )

        # Dispatch execution with live event streaming
        sink = EventSink(task_id=task_id, run_id=run_id, agent=agent_type.value, phase="EXECUTION")
        result = adapter.execute(req, on_event=sink)
        sink.flush()

        # Update run and task records
        with get_db_session() as session:
            run_record = session.query(AgentRunModel).filter_by(id=run_id).first()
            if run_record:
                run_record.status = result.status.value
                run_record.exit_code = result.exit_code
                run_record.stdout = result.stdout
                run_record.stderr = result.stderr
                run_record.duration_seconds = result.duration_seconds
                run_record.error_reason = result.error_reason
                run_record.completed_at = datetime.utcnow()

            task_record = session.query(TaskModel).filter_by(id=task_id).first()
            if task_record:
                if task_record.status != TaskStatus.CANCELLED.value:
                    task_record.status = result.status.value
                task_record.updated_at = datetime.utcnow()
                if result.status == TaskStatus.COMPLETED and task_record.status != TaskStatus.CANCELLED.value:
                    task_record.completed_at = datetime.utcnow()

            if result.status != TaskStatus.COMPLETED or result.exit_code != 0:
                if not (task_record and task_record.status == TaskStatus.CANCELLED.value):
                    session.add(
                        ErrorLogModel(
                            task_id=task_id,
                            run_id=run_id,
                            source=f"{agent_type.value}_CLI",
                            severity="ERROR",
                            title=f"Task execution failed ({agent_type.value})",
                            message=result.error_reason or f"Exited with code {result.exit_code}",
                            stderr=result.stderr,
                            resolved=False,
                        )
                    )

            # Audit record
            audit = AuditLogModel(
                task_id=task_id,
                run_id=run_id,
                event_type="TASK_FINISHED",
                message=f"Agent {agent_type.value} exited with status {result.status.value} (code {result.exit_code})",
            )
            session.add(audit)

        return result

    def cancel_task(self, task_id: str) -> bool:
        """Cancel an active task and terminate its running processes."""
        with get_db_session() as session:
            task = session.query(TaskModel).filter_by(id=task_id).first()
            if not task:
                return False

            task.status = TaskStatus.CANCELLED.value
            task.updated_at = datetime.utcnow()

            # Find and cancel running agent runs
            runs = session.query(AgentRunModel).filter_by(task_id=task_id, status="RUNNING").all()
            for r in runs:
                r.status = "CANCELLED"
                r.error_reason = "Cancelled by operator"
                r.completed_at = datetime.utcnow()
                agent_key = r.agent_type or task.assigned_agent
                if agent_key:
                    adapter = self.registry.get_adapter(AgentType(agent_key))
                    if adapter:
                        adapter.cancel(r.id)

            # Cancel associated workflow runs if any
            from services.orchestrator.db import WorkflowRunModel
            wf = session.query(WorkflowRunModel).filter_by(task_id=task_id, status="RUNNING").first()
            if wf:
                wf.status = "CANCELLED"
                wf.updated_at = datetime.utcnow()

            audit = AuditLogModel(
                task_id=task_id,
                event_type="TASK_CANCELLED",
                message="Task execution was stopped by operator.",
            )
            session.add(audit)
            return True

    def recover_stale_tasks(self) -> int:
        """Scan for orphan tasks left in RUNNING state after an ungraceful server shutdown."""
        with get_db_session() as session:
            stale_tasks = session.query(TaskModel).filter_by(status="RUNNING").all()
            count = len(stale_tasks)
            for t in stale_tasks:
                t.status = "FAILED"
                t.updated_at = datetime.utcnow()

                from services.orchestrator.db import WorkflowRunModel
                wf = session.query(WorkflowRunModel).filter_by(task_id=t.id, status="RUNNING").first()
                if wf:
                    wf.status = "FAILED"
                    wf.verification_report = "Interrupted by server restart or process termination."
                    wf.updated_at = datetime.utcnow()

                audit = AuditLogModel(
                    task_id=t.id,
                    event_type="TASK_INTERRUPTED",
                    message="Task execution interrupted by server restart.",
                )
                session.add(audit)
            return count
