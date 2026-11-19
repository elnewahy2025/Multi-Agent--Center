"""FastAPI application for the AI Coding Command Center."""

from typing import Any, Dict, List, Optional
from fastapi import BackgroundTasks, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from packages.contracts import (
    AgentDescriptor,
    AgentExecutionResult,
    ApprovalDecisionPayload,
    ApprovalRequest,
    TaskCreate,
    TaskRead,
    TaskStatus,
)
from services.orchestrator.db import (
    ApprovalModel,
    AuditLogModel,
    TaskModel,
    WorkflowRunModel,
    get_db_session,
    init_db,
)
from services.orchestrator.engine import TaskOrchestrator
from services.orchestrator.workflows import CollaborativeWorkflowEngine

app = FastAPI(
    title="AI Coding Command Center API",
    description="Local orchestrator coordinating OpenCode, Google Antigravity, and other agents.",
    version="1.0.0",
)

# Enable CORS for local web dashboard
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

orchestrator = TaskOrchestrator()
collab_engine = CollaborativeWorkflowEngine()


@app.on_event("startup")
def startup_event():
    """Ensure database schema is ready and recover orphan tasks on startup."""
    init_db()
    stale_recovered = orchestrator.recover_stale_tasks()
    if stale_recovered > 0:
        print(f"Recovered {stale_recovered} interrupted task(s) from previous session.")


@app.get("/health")
def health_check() -> Dict[str, Any]:
    """Check system health, database connectivity, and registered agents."""
    agents = orchestrator.registry.get_available_agents()
    return {
        "status": "healthy",
        "database": "postgresql (command_center)",
        "available_agents": len(agents),
        "agents": [a.name for a in agents],
    }


@app.get("/agents", response_model=List[AgentDescriptor])
def list_agents() -> List[AgentDescriptor]:
    """List all detected agents and their verified capabilities."""
    return orchestrator.registry.list_descriptors()


@app.post("/tasks", response_model=TaskRead)
def create_task(payload: TaskCreate) -> TaskRead:
    """Submit a new task for agent execution."""
    return orchestrator.submit_task(payload)


@app.get("/tasks", response_model=List[TaskRead])
def list_tasks(status: Optional[TaskStatus] = None) -> List[TaskRead]:
    """List recent tasks, optionally filtered by status."""
    with get_db_session() as session:
        query = session.query(TaskModel).order_by(TaskModel.created_at.desc()).limit(50)
        if status:
            query = query.filter(TaskModel.status == status.value)
        tasks = query.all()

        results: List[TaskRead] = []
        for t in tasks:
            results.append(
                TaskRead(
                    id=t.id,
                    title=t.title,
                    description=t.description,
                    project_id=t.project_id,
                    assigned_agent=t.assigned_agent,  # type: ignore
                    status=t.status,  # type: ignore
                    policy_mode=t.policy_mode,  # type: ignore
                    worktree_path=t.worktree_path,
                    created_at=t.created_at,
                    updated_at=t.updated_at,
                    completed_at=t.completed_at,
                    metadata=t.get_metadata(),
                )
            )
        return results


@app.get("/tasks/{task_id}", response_model=TaskRead)
def get_task(task_id: str) -> TaskRead:
    """Retrieve details for a specific task."""
    task = orchestrator.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


@app.post("/tasks/{task_id}/execute")
def execute_task(task_id: str, background_tasks: BackgroundTasks) -> Dict[str, Any]:
    """Trigger background execution of a submitted task."""
    task = orchestrator.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    # Dispatch to background task so the HTTP request returns immediately
    background_tasks.add_task(orchestrator.execute_task, task_id)
    return {
        "status": "RUNNING",
        "task_id": task_id,
        "message": "Task dispatched to agent in background",
    }


@app.get("/tasks/{task_id}/runs")
def get_task_runs(task_id: str) -> List[Dict[str, Any]]:
    """Retrieve runs and output logs for a specific task."""
    from services.orchestrator.db import AgentRunModel

    with get_db_session() as session:
        runs = session.query(AgentRunModel).filter_by(task_id=task_id).order_by(AgentRunModel.started_at.desc()).all()
        return [
            {
                "id": r.id,
                "agent_type": r.agent_type,
                "status": r.status,
                "exit_code": r.exit_code,
                "duration_seconds": r.duration_seconds,
                "error_reason": r.error_reason,
                "stdout": r.stdout or "",
                "stderr": r.stderr or "",
                "started_at": r.started_at.isoformat() if r.started_at else None,
                "completed_at": r.completed_at.isoformat() if r.completed_at else None,
            }
            for r in runs
        ]


@app.post("/tasks/{task_id}/collaborate")
def collaborate_task(task_id: str, background_tasks: BackgroundTasks) -> Dict[str, Any]:
    """Trigger bilateral collaborative workflow (Antigravity <-> OpenCode) in the background."""
    task = orchestrator.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    background_tasks.add_task(collab_engine.run_collaborative_workflow, task_id)
    return {
        "status": "RUNNING",
        "task_id": task_id,
        "workflow": "Antigravity <-> OpenCode Bilateral Collaboration",
        "message": "Collaborative inspection and negotiation initiated",
    }


@app.get("/tasks/{task_id}/workflow")
def get_task_workflow(task_id: str) -> Optional[Dict[str, Any]]:
    """Retrieve the collaborative workflow state and negotiation message history."""
    with get_db_session() as session:
        wf = (
            session.query(WorkflowRunModel)
            .filter_by(task_id=task_id)
            .order_by(WorkflowRunModel.created_at.desc())
            .first()
        )
        if not wf:
            return None

        run_read = collab_engine.get_workflow_run(wf.id)
        if not run_read:
            return None
        return run_read.model_dump()


@app.post("/tasks/{task_id}/cancel")
def cancel_task(task_id: str) -> Dict[str, Any]:
    """Stop and cancel a running task immediately."""
    success = orchestrator.cancel_task(task_id)
    if not success:
        raise HTTPException(status_code=404, detail="Task not found")
    return {"message": "Task stopped successfully", "task_id": task_id, "status": "CANCELLED"}


@app.post("/approvals/{approval_id}/decide")
def decide_approval(approval_id: str, payload: ApprovalDecisionPayload) -> Dict[str, Any]:
    """Human-in-the-loop: Grant or deny an approval request."""
    from datetime import datetime
    with get_db_session() as session:
        approval = session.query(ApprovalModel).filter_by(id=approval_id).first()
        if not approval:
            raise HTTPException(status_code=404, detail="Approval request not found")

        approval.decision = payload.decision.value
        approval.decided_by = payload.decided_by
        approval.reason = payload.reason
        approval.decided_at = datetime.utcnow()

        audit = AuditLogModel(
            task_id=approval.task_id,
            event_type="APPROVAL_DECIDED",
            message=f"Action '{approval.action_type}' was {payload.decision.value} by {payload.decided_by}.",
        )
        session.add(audit)

    return {
        "id": approval_id,
        "decision": payload.decision.value,
        "decided_by": payload.decided_by,
        "status": "RECORDED",
    }


@app.get("/approvals", response_model=List[Dict[str, Any]])
def list_approvals() -> List[Dict[str, Any]]:
    """List pending high-impact approval requests."""
    with get_db_session() as session:
        records = session.query(ApprovalModel).filter_by(decision="PENDING").all()
        return [
            {
                "id": a.id,
                "task_id": a.task_id,
                "action_type": a.action_type,
                "command_or_path": a.command_or_path,
                "description": a.description,
                "risk_level": a.risk_level,
                "requested_at": a.requested_at.isoformat(),
            }
            for a in records
        ]


@app.get("/audit", response_model=List[Dict[str, Any]])
def list_audit_trail(limit: int = 50) -> List[Dict[str, Any]]:
    """Retrieve immutable audit log events."""
    with get_db_session() as session:
        logs = session.query(AuditLogModel).order_by(AuditLogModel.created_at.desc()).limit(limit).all()
        return [
            {
                "id": log.id,
                "task_id": log.task_id,
                "run_id": log.run_id,
                "event_type": log.event_type,
                "message": log.message,
                "created_at": log.created_at.isoformat(),
            }
            for log in logs
        ]


# Mount the operator dashboard static UI at root
from pathlib import Path
from fastapi.staticfiles import StaticFiles

dashboard_dir = Path(__file__).resolve().parents[2] / "apps" / "dashboard"
if dashboard_dir.exists():
    app.mount("/", StaticFiles(directory=str(dashboard_dir), html=True), name="dashboard")

