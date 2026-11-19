"""FastAPI application for the AI Coding Command Center."""

from typing import Any, Dict, List, Optional
from fastapi import FastAPI, HTTPException
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
    get_db_session,
    init_db,
)
from services.orchestrator.engine import TaskOrchestrator

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


@app.on_event("startup")
def startup_event():
    """Ensure database schema is ready on startup."""
    init_db()


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


@app.post("/tasks/{task_id}/execute", response_model=AgentExecutionResult)
def execute_task(task_id: str) -> AgentExecutionResult:
    """Trigger execution of a submitted task."""
    try:
        return orchestrator.execute_task(task_id)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


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
