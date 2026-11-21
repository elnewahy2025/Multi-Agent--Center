"""FastAPI application for the AI Coding Command Center."""

import base64
import json
import os
import re
import subprocess
import sys
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional
from fastapi import BackgroundTasks, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel

from packages.contracts import (
    AgentDescriptor,
    AgentExecutionResult,
    ApprovalDecisionPayload,
    ApprovalRequest,
    TaskCreate,
    TaskRead,
    TaskStatus,
)
from sqlalchemy import text

from services.orchestrator.db import (
    AgentEventModel,
    ApprovalModel,
    AuditLogModel,
    ErrorLogModel,
    TaskModel,
    WorkflowRunModel,
    get_db_session,
    get_engine,
    init_db,
)
from services.orchestrator.engine import TaskOrchestrator
from services.orchestrator.events import iso_utc, list_events
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


@app.middleware("http")
async def disable_dashboard_cache(request: Request, call_next):
    """Ensure dashboard HTML/JS/CSS assets always reload cleanly in the browser."""
    response = await call_next(request)
    if request.url.path in ("/", "/index.html", "/app.js", "/styles.css"):
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    return response

orchestrator = TaskOrchestrator()
collab_engine = CollaborativeWorkflowEngine()


@app.on_event("startup")
def startup_event():
    """Ensure database schema is ready and recover orphan tasks on startup."""
    init_db()
    stale_recovered = orchestrator.recover_stale_tasks()
    if stale_recovered > 0:
        print(f"Recovered {stale_recovered} interrupted task(s) from previous session.")


def _probe_database() -> Dict[str, Any]:
    """Probe database connectivity without leaking credentials or raising."""
    result: Dict[str, Any] = {
        "connected": False,
        "dialect": None,
        "version": None,
        "database": None,
        "host": None,
        "port": None,
        "error": None,
    }
    try:
        engine = get_engine()
        url = engine.url
        # Structured, sanitized fields only (never the full URL / password).
        result["dialect"] = getattr(engine.dialect, "name", None)
        try:
            result["host"] = url.host
        except Exception:
            result["host"] = None
        try:
            result["port"] = url.port
        except Exception:
            result["port"] = None
        try:
            result["database"] = url.database
        except Exception:
            result["database"] = None

        with engine.connect() as conn:
            ok = conn.execute(text("SELECT 1")).scalar()
            result["connected"] = (ok == 1)

        if result["connected"]:
            try:
                with engine.connect() as conn:
                    if result["dialect"] == "postgresql":
                        result["version"] = conn.execute(text("SELECT version()")).scalar()
                    elif result["dialect"] == "sqlite":
                        result["version"] = conn.execute(text("SELECT sqlite_version()")).scalar()
                    else:
                        result["version"] = None
            except Exception as exc:
                result["version"] = None
                result["error"] = str(exc)
    except Exception as exc:
        result["connected"] = False
        result["error"] = str(exc)
    return result


def _database_label(probe: Dict[str, Any]) -> str:
    dialect = probe.get("dialect") or "database"
    db_name = probe.get("database")
    host = probe.get("host")
    port = probe.get("port")
    if db_name and host and port:
        return f"{dialect} ({host}:{port}/{db_name})"
    if db_name:
        return f"{dialect} ({db_name})"
    return str(dialect)


@app.get("/health")
def health_check() -> Dict[str, Any]:
    """Check system health, database connectivity, and registered agents."""
    agents = orchestrator.registry.get_available_agents()
    probe = _probe_database()
    status = "healthy" if probe["connected"] else "degraded"
    return {
        "status": status,
        "database": _database_label(probe),
        "database_connected": bool(probe["connected"]),
        "database_dialect": probe["dialect"],
        "database_version": probe["version"],
        "available_agents": len(agents),
        "registered_agents": orchestrator.registry.registered_count(),
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


@app.delete("/tasks/{task_id}")
def delete_task(task_id: str) -> Dict[str, Any]:
    """Delete a non-running task and its associated telemetry records."""
    task = orchestrator.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if task.status == TaskStatus.RUNNING:
        raise HTTPException(status_code=409, detail="Cannot delete a running task; stop it first.")

    with get_db_session() as session:
        session.query(AgentEventModel).filter_by(task_id=task_id).delete()
        session.query(ErrorLogModel).filter_by(task_id=task_id).delete()
        session.query(AuditLogModel).filter_by(task_id=task_id).delete()
        session.query(WorkflowRunModel).filter_by(task_id=task_id).delete()
        session.query(TaskModel).filter_by(id=task_id).delete()
    return {"deleted": True, "task_id": task_id}


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
                "started_at": iso_utc(r.started_at),
                "completed_at": iso_utc(r.completed_at),
            }
            for r in runs
        ]


@app.get("/tasks/{task_id}/events")
def get_task_events(task_id: str, after_id: int = 0) -> Dict[str, Any]:
    """Return live streamed activity events (tool calls, text deltas, status) for a task."""
    task = orchestrator.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    events = list_events(task_id, after_id=after_id)
    return {
        "task_id": task_id,
        "task_status": task.status.value,
        "count": len(events),
        "events": events,
    }


@app.get("/tasks/{task_id}/files")
def get_task_files(task_id: str) -> Dict[str, Any]:
    """Inspect and return all files touched, changed, or actively worked on by agents for this task."""
    task = orchestrator.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    repo_root = Path(__file__).resolve().parents[2]
    working_dir = repo_root

    # Priority 1: Isolated Git worktree assigned to the task
    if task.worktree_path and Path(task.worktree_path).exists():
        working_dir = Path(task.worktree_path)
    else:
        # Priority 2: Project root if registered
        with get_db_session() as session:
            t = session.query(TaskModel).filter_by(id=task_id).first()
            if t and t.project and t.project.root_path and Path(t.project.root_path).exists():
                working_dir = Path(t.project.root_path)

    changed_files = orchestrator.workspace_mgr.get_changed_files(working_dir)
    context_files = task.metadata.get("context_files", []) if task.metadata else []

    with get_db_session() as session:
        tool_events = (
            session.query(AgentEventModel)
            .filter_by(task_id=task_id, kind="tool")
            .order_by(AgentEventModel.id.asc())
            .all()
        )
        activity_files = [
            {
                "id": ev.id,
                "agent": ev.agent,
                "phase": ev.phase,
                "tool": ev.tool or "tool",
                "target": ev.title or "(workspace)",
                "status": (ev.status or "done").upper(),
                "output": (ev.content or "")[:1500],
                "duration_seconds": ev.duration_seconds,
                "updated_at": iso_utc(ev.updated_at),
            }
            for ev in tool_events
        ]

    return {
        "task_id": task_id,
        "working_dir": str(working_dir),
        "is_worktree": bool(task.worktree_path and Path(task.worktree_path).exists()),
        "total_changed": len(changed_files),
        "changed_files": changed_files,
        "total_activity": len(activity_files),
        "activity_files": activity_files,
        "context_files": context_files,
    }


@app.post("/tasks/{task_id}/collaborate")
def collaborate_task(task_id: str, background_tasks: BackgroundTasks) -> Dict[str, Any]:
    """Trigger bilateral collaborative workflow in the background using selected agent pairing."""
    task = orchestrator.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    inspector_type, worker_type = collab_engine.resolve_pair_types(
        task.assigned_agent.value if task.assigned_agent else None
    )
    background_tasks.add_task(collab_engine.run_collaborative_workflow, task_id)
    return {
        "status": "RUNNING",
        "task_id": task_id,
        "workflow": f"{inspector_type.value} <-> {worker_type.value} Bilateral Collaboration",
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
                "requested_at": iso_utc(a.requested_at),
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
                "created_at": iso_utc(log.created_at),
            }
            for log in logs
        ]


@app.get("/errors", response_model=List[Dict[str, Any]])
def list_errors(unresolved_only: bool = True, limit: int = 50) -> List[Dict[str, Any]]:
    """Retrieve active and recent errors for the Diagnostics & Error Center."""
    with get_db_session() as session:
        query = session.query(ErrorLogModel).order_by(ErrorLogModel.created_at.desc())
        if unresolved_only:
            query = query.filter_by(resolved=False)
        errors = query.limit(limit).all()
        return [
            {
                "id": e.id,
                "task_id": e.task_id,
                "run_id": e.run_id,
                "source": e.source,
                "severity": e.severity,
                "title": e.title,
                "message": e.message,
                "stderr": e.stderr,
                "resolved": e.resolved,
                "created_at": iso_utc(e.created_at),
            }
            for e in errors
        ]


@app.post("/errors/{error_id}/resolve")
def resolve_error(error_id: int) -> Dict[str, Any]:
    """Dismiss or resolve a specific error message."""
    with get_db_session() as session:
        err = session.query(ErrorLogModel).filter_by(id=error_id).first()
        if not err:
            raise HTTPException(status_code=404, detail="Error record not found")
        err.resolved = True
    return {"message": "Error dismissed", "id": error_id}


@app.post("/errors/clear")
def clear_errors() -> Dict[str, Any]:
    """Dismiss all pending error messages in the Error Center."""
    with get_db_session() as session:
        session.query(ErrorLogModel).update({ErrorLogModel.resolved: True})
    return {"message": "All error notifications cleared"}


@app.get("/diagnostics")
def get_diagnostics() -> Dict[str, Any]:
    """Return live system health diagnostics, detected CLI paths, and error metrics."""
    agents = orchestrator.registry.list_descriptors()
    available_agents = [a for a in agents if a.is_available]
    probe = _probe_database()

    # Zeroed defaults so /diagnostics never 500s when DB is offline.
    active_errors = 0
    total_tasks = 0
    failed_tasks = 0
    task_counts: Dict[str, int] = {st.value: 0 for st in TaskStatus}
    pending_approvals = 0
    run_counts: Dict[str, int] = {}
    total_workflows = 0
    verified_workflows = 0

    if probe["connected"]:
        try:
            with get_db_session() as session:
                active_errors = session.query(ErrorLogModel).filter_by(resolved=False).count()
                total_tasks = session.query(TaskModel).count()
                failed_tasks = session.query(TaskModel).filter_by(status="FAILED").count()

                task_counts = {}
                for st in TaskStatus:
                    task_counts[st.value] = session.query(TaskModel).filter_by(status=st.value).count()

                pending_approvals = session.query(ApprovalModel).filter_by(decision="PENDING").count()

                run_counts = {}
                try:
                    from collections import Counter
                    rows = session.query(WorkflowRunModel.status).all()
                    c = Counter(r[0] for r in rows)
                    # Ensure stable keys for known statuses
                    for key in ("RUNNING", "COMPLETED", "FAILED", "CANCELLED", "TIMED_OUT"):
                        run_counts[key] = int(c.get(key, 0))
                    for k, v in c.items():
                        if k not in run_counts:
                            run_counts[str(k)] = int(v)
                except Exception:
                    run_counts = {}

                total_workflows = session.query(WorkflowRunModel).count()
                verified_workflows = session.query(WorkflowRunModel).filter_by(is_verified=True).count()
        except Exception as exc:
            # Never return partial/inconsistent metrics on a mid-session failure.
            active_errors = 0
            total_tasks = 0
            failed_tasks = 0
            task_counts = {st.value: 0 for st in TaskStatus}
            pending_approvals = 0
            run_counts = {}
            total_workflows = 0
            verified_workflows = 0
            probe["connected"] = False
            probe["error"] = str(exc)

    overall_status = "healthy" if (active_errors == 0 and probe["connected"]) else "degraded"

    return {
        "status": overall_status,
        "active_errors": active_errors,
        "total_tasks": total_tasks,
        "failed_tasks": failed_tasks,
        "task_counts": task_counts,
        "run_counts": run_counts,
        "pending_approvals": pending_approvals,
        "registered_agents": orchestrator.registry.registered_count(),
        "available_agents": len(available_agents),
        "total_workflows": total_workflows,
        "verified_workflows": verified_workflows,
        "database": _database_label(probe),
        "database_connected": bool(probe["connected"]),
        "database_dialect": probe["dialect"],
        "database_version": probe["version"],
        "agents": [
            {
                "type": a.agent_type.value,
                "name": a.name,
                "version": a.version,
                "executable": a.executable_path,
                "available": a.is_available,
            }
            for a in agents
        ],
    }


def _run_git_readonly(target_dir: Path, args: List[str]) -> subprocess.CompletedProcess:
    """Run a fast, read-only git command inside target_dir."""
    return subprocess.run(
        ["git", "-C", str(target_dir), *args],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=5,
    )


@app.get("/repo/status")
def get_repo_status(path: Optional[str] = None) -> Dict[str, Any]:
    """Return live Git branch, working tree status, recent commits, and worktrees."""
    repo_root = Path(__file__).resolve().parents[2].resolve()
    target_dir = _resolve_browse_dir(path, repo_root)

    try:
        inside = _run_git_readonly(target_dir, ["rev-parse", "--is-inside-work-tree"])
        is_git = inside.returncode == 0 and inside.stdout.strip().lower() == "true"
    except Exception:
        is_git = False

    if not is_git:
        return {
            "root": str(target_dir),
            "name": target_dir.name or str(target_dir),
            "is_git_repo": False,
            "branch": None,
            "clean": True,
            "uncommitted_count": 0,
            "uncommitted_files": [],
            "latest_commit": None,
            "recent_commits": [],
            "worktrees": [],
        }

    branch_res = _run_git_readonly(target_dir, ["rev-parse", "--abbrev-ref", "HEAD"])
    branch = branch_res.stdout.strip() if branch_res.returncode == 0 else "HEAD"

    status_res = _run_git_readonly(target_dir, ["status", "--porcelain=v1"])
    uncommitted: List[Dict[str, str]] = []
    if status_res.returncode == 0:
        for line in status_res.stdout.splitlines():
            if not line.strip():
                continue
            code = line[:2].strip() or "M"
            rel_path = line[3:].strip()
            uncommitted.append({"status": code, "path": rel_path})

    log_res = _run_git_readonly(target_dir, ["log", "-n", "6", "--format=%h%x1f%s%x1f%cr"])
    recent_commits: List[Dict[str, str]] = []
    if log_res.returncode == 0:
        for line in log_res.stdout.splitlines():
            parts = line.split("\x1f")
            if len(parts) == 3:
                recent_commits.append({
                    "hash": parts[0].strip(),
                    "subject": parts[1].strip(),
                    "relative_time": parts[2].strip(),
                })

    wt_res = _run_git_readonly(target_dir, ["worktree", "list", "--porcelain"])
    worktrees: List[Dict[str, str]] = []
    if wt_res.returncode == 0:
        current: Dict[str, Any] = {}
        for line in wt_res.stdout.splitlines() + [""]:
            if not line.strip():
                if current.get("path") and not current.get("prunable"):
                    worktrees.append({
                        "path": str(current["path"]),
                        "head": str(current.get("head", ""))[:7],
                        "branch": str(current.get("branch", "detached")),
                    })
                current = {}
            elif line.startswith("worktree "):
                current["path"] = line[len("worktree "):].strip()
            elif line.startswith("HEAD "):
                current["head"] = line[len("HEAD "):].strip()
            elif line.startswith("branch "):
                ref = line[len("branch "):].strip()
                current["branch"] = ref.replace("refs/heads/", "")
            elif line.startswith("detached"):
                current["branch"] = "detached HEAD"
            elif line.startswith("prunable"):
                current["prunable"] = True

    return {
        "root": str(target_dir),
        "name": target_dir.name or str(target_dir),
        "is_git_repo": True,
        "branch": branch,
        "clean": len(uncommitted) == 0,
        "uncommitted_count": len(uncommitted),
        "uncommitted_files": uncommitted[:30],
        "latest_commit": recent_commits[0] if recent_commits else None,
        "recent_commits": recent_commits,
        "worktrees": worktrees,
    }


@app.get("/fs/list")
def list_workspace_paths(root: Optional[str] = None, limit: int = 300) -> Dict[str, Any]:
    """List project files and folders for the dashboard file/directory selector."""
    repo_root = Path(__file__).resolve().parents[2].resolve()
    base_dir = repo_root
    if root and root.strip():
        cand = Path(root.strip()).resolve()
        if cand.is_file():
            cand = cand.parent
        if not cand.exists() or not cand.is_dir():
            raise HTTPException(status_code=400, detail=f"Directory not found: {root}")
        base_dir = cand

    skip_dirs = {".git", "__pycache__", "node_modules", ".venv", "venv", ".pytest_cache"}
    entries: List[Dict[str, str]] = []
    worktrees_dir = str((base_dir / "workspace" / "worktrees").resolve())

    for dirpath, dirnames, filenames in os.walk(base_dir):
        dirnames[:] = sorted(
            d for d in dirnames
            if d not in skip_dirs and os.path.abspath(os.path.join(dirpath, d)) != worktrees_dir
        )
        rel_dir = Path(dirpath).resolve().relative_to(base_dir).as_posix()
        if rel_dir != ".":
            entries.append({"path": rel_dir, "type": "folder"})
            if len(entries) >= limit:
                break
        for fname in sorted(filenames):
            if fname.endswith((".pyc", ".pyo")):
                continue
            rel_file = f"{rel_dir}/{fname}" if rel_dir != "." else fname
            entries.append({"path": rel_file, "type": "file"})
            if len(entries) >= limit:
                break
        if len(entries) >= limit:
            break

    return {"root": str(base_dir), "entries": entries}


_FS_SKIP_DIRS = {".git", "__pycache__", "node_modules", ".venv", "venv", ".pytest_cache"}


def _list_available_drives(anchor: str) -> List[str]:
    if os.name == "nt":
        drives = [f"{d}:\\" for d in "CDEFGHIJKLMNOPQRSTUVWXYZ" if os.path.exists(f"{d}:\\")]
        if drives:
            return drives
    return [anchor] if anchor else ["/"]


def _rel_or_abs(target: Path, base: Path) -> str:
    try:
        rel = target.resolve().relative_to(base.resolve()).as_posix()
        return rel if rel and rel != "." else str(target.resolve())
    except ValueError:
        return str(target.resolve())


def _resolve_browse_dir(raw_path: Optional[str], fallback: Path) -> Path:
    if not raw_path or not raw_path.strip():
        return fallback
    try:
        cand = Path(raw_path.strip()).expanduser().resolve()
    except OSError:
        return fallback
    if cand.is_file():
        return cand.parent
    while not cand.exists() and cand.parent != cand:
        cand = cand.parent
    return cand if cand.exists() and cand.is_dir() else fallback


@app.get("/fs/browse")
def browse_filesystem(
    path: Optional[str] = None,
    root: Optional[str] = None,
    query: Optional[str] = None,
    limit: int = 200,
) -> Dict[str, Any]:
    """Browse directories and files interactively for the dashboard Target Scope explorer."""
    repo_root = Path(__file__).resolve().parents[2].resolve()
    workspace_root = _resolve_browse_dir(root, repo_root)
    current_dir = _resolve_browse_dir(path, workspace_root)
    parent_dir = str(current_dir.parent) if current_dir.parent != current_dir else None
    drives = _list_available_drives(str(Path(current_dir).anchor))
    search_q = (query or "").strip().lower()

    folders: List[Dict[str, Any]] = []
    files: List[Dict[str, Any]] = []

    if not search_q:
        try:
            with os.scandir(current_dir) as it:
                items = sorted(it, key=lambda e: e.name.lower())
                for entry in items:
                    name = entry.name
                    try:
                        is_dir = entry.is_dir(follow_symlinks=False)
                    except OSError:
                        continue
                    if is_dir:
                        if name in _FS_SKIP_DIRS or name == "$RECYCLE.BIN" or name == "System Volume Information":
                            continue
                        if len(folders) < limit:
                            p = Path(entry.path).resolve()
                            folders.append({
                                "name": name,
                                "path": str(p),
                                "rel_path": _rel_or_abs(p, workspace_root),
                                "type": "folder",
                                "size": 0,
                            })
                    else:
                        if name.endswith((".pyc", ".pyo")):
                            continue
                        if len(files) < limit:
                            p = Path(entry.path).resolve()
                            try:
                                size = entry.stat().st_size
                            except OSError:
                                size = 0
                            files.append({
                                "name": name,
                                "path": str(p),
                                "rel_path": _rel_or_abs(p, workspace_root),
                                "type": "file",
                                "size": size,
                            })
        except OSError as exc:
            raise HTTPException(status_code=403, detail=f"Cannot read directory {current_dir}: {exc}")
    else:
        worktrees_dir = str((current_dir / "workspace" / "worktrees").resolve())
        total = 0
        for dirpath, dirnames, filenames in os.walk(current_dir, onerror=lambda _e: None):
            dirnames[:] = sorted(
                d for d in dirnames
                if d not in _FS_SKIP_DIRS
                and d not in ("$RECYCLE.BIN", "System Volume Information")
                and os.path.abspath(os.path.join(dirpath, d)) != worktrees_dir
            )
            for dname in dirnames:
                p = (Path(dirpath) / dname).resolve()
                rel_p = _rel_or_abs(p, workspace_root)
                if search_q in dname.lower() or search_q in rel_p.lower():
                    folders.append({
                        "name": dname,
                        "path": str(p),
                        "rel_path": rel_p,
                        "type": "folder",
                        "size": 0,
                    })
                    total += 1
                    if total >= limit:
                        break
            if total >= limit:
                break
            for fname in sorted(filenames):
                if fname.endswith((".pyc", ".pyo")):
                    continue
                p = (Path(dirpath) / fname).resolve()
                rel_p = _rel_or_abs(p, workspace_root)
                if search_q in fname.lower() or search_q in rel_p.lower():
                    try:
                        size = p.stat().st_size
                    except OSError:
                        size = 0
                    files.append({
                        "name": fname,
                        "path": str(p),
                        "rel_path": rel_p,
                        "type": "file",
                        "size": size,
                    })
                    total += 1
                    if total >= limit:
                        break
            if total >= limit:
                break

    return {
        "current_dir": str(current_dir),
        "parent_dir": parent_dir,
        "workspace_root": str(workspace_root),
        "repo_root": str(repo_root),
        "drives": drives,
        "query": search_q,
        "folders": folders,
        "files": files,
    }


_NATIVE_PICKER_CODE = (
    "import json, sys, tkinter as tk\n"
    "from tkinter import filedialog\n"
    "mode, initial = sys.argv[1], sys.argv[2]\n"
    "root = tk.Tk()\n"
    "root.withdraw()\n"
    "root.wm_attributes('-topmost', 1)\n"
    "if mode == 'file':\n"
    "    paths = list(filedialog.askopenfilenames(initialdir=initial, title='Select File(s) for Agent Task'))\n"
    "else:\n"
    "    picked = filedialog.askdirectory(initialdir=initial, title='Select Target Folder')\n"
    "    paths = [picked] if picked else []\n"
    "root.destroy()\n"
    "print(json.dumps(paths))\n"
)


@app.post("/fs/pick")
def pick_native_path(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Open a native Windows File or Folder dialog and return selected path(s)."""
    mode = (payload or {}).get("mode", "folder")
    if mode not in ("folder", "file"):
        raise HTTPException(status_code=400, detail="mode must be 'folder' or 'file'")
    repo_root = Path(__file__).resolve().parents[2].resolve()
    raw_init = (payload or {}).get("initial_dir") or str(repo_root)
    init_dir = Path(raw_init).resolve() if Path(raw_init).exists() else repo_root
    if init_dir.is_file():
        init_dir = init_dir.parent

    try:
        res = subprocess.run(
            [sys.executable, "-c", _NATIVE_PICKER_CODE, mode, str(init_dir)],
            capture_output=True, text=True, timeout=120,
        )
    except subprocess.TimeoutExpired:
        return {"mode": mode, "paths": []}
    if res.returncode != 0:
        raise HTTPException(status_code=500, detail=res.stderr.strip() or "File dialog failed")
    last_line = res.stdout.strip().splitlines()[-1] if res.stdout.strip() else "[]"
    return {"mode": mode, "paths": json.loads(last_line)}


_IMAGE_MIME_TO_EXT = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
}
_EXT_TO_IMAGE_MIME = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
}
_IMAGE_DATA_URL_RE = re.compile(r"^data:(image/(?:png|jpeg|jpg|webp|gif));base64,(.+)$", re.IGNORECASE | re.DOTALL)
_MAX_UPLOAD_BYTES = 10 * 1024 * 1024


class ImageUploadPayload(BaseModel):
    """Payload for attaching a screenshot or reference image to a task."""

    filename: Optional[str] = None
    data_url: str


def _uploads_dir() -> Path:
    repo_root = Path(__file__).resolve().parents[2].resolve()
    target = (repo_root / "data" / "uploads").resolve()
    target.mkdir(parents=True, exist_ok=True)
    return target


def _sanitize_image_stem(raw_name: Optional[str]) -> str:
    stem = Path(raw_name or "image").stem
    cleaned = re.sub(r"[^a-zA-Z0-9-]+", "-", stem).strip("-").lower()
    return (cleaned[:48] or "image")


@app.post("/uploads/image")
def upload_image(payload: ImageUploadPayload) -> Dict[str, Any]:
    """Save a validated reference image into data/uploads/ and return its path and URL."""
    match = _IMAGE_DATA_URL_RE.match((payload.data_url or "").strip())
    if not match:
        raise HTTPException(status_code=400, detail="Only PNG, JPEG, WebP, or GIF base64 image data URLs are supported.")

    mime = match.group(1).lower()
    ext = _IMAGE_MIME_TO_EXT.get(mime)
    if not ext:
        raise HTTPException(status_code=400, detail="Unsupported image format.")

    try:
        raw_bytes = base64.b64decode(match.group(2), validate=True)
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid base64 image encoding.") from exc

    if not raw_bytes:
        raise HTTPException(status_code=400, detail="Uploaded image is empty.")
    if len(raw_bytes) > _MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Image exceeds the 10 MB limit.")

    uploads_dir = _uploads_dir()
    stem = _sanitize_image_stem(payload.filename)
    saved_name = f"{uuid.uuid4().hex[:10]}-{stem}{ext}"
    saved_path = (uploads_dir / saved_name).resolve()
    saved_path.write_bytes(raw_bytes)

    return {
        "filename": saved_name,
        "original_name": payload.filename or saved_name,
        "path": str(saved_path),
        "url": f"/uploads/{saved_name}",
        "size": len(raw_bytes),
    }


@app.get("/uploads/{filename}")
def get_uploaded_image(filename: str):
    """Serve a previously uploaded image by validated basename."""
    if Path(filename).name != filename or "/" in filename or "\\" in filename:
        raise HTTPException(status_code=400, detail="Invalid upload filename.")
    ext = Path(filename).suffix.lower()
    media_type = _EXT_TO_IMAGE_MIME.get(ext)
    if not media_type:
        raise HTTPException(status_code=400, detail="Unsupported upload file extension.")

    uploads_dir = _uploads_dir()
    candidate = (uploads_dir / filename).resolve()
    if candidate.parent != uploads_dir or not candidate.is_file():
        raise HTTPException(status_code=404, detail="Uploaded image not found.")
    return FileResponse(path=str(candidate), media_type=media_type)


# Mount the operator dashboard static UI at root
from fastapi.staticfiles import StaticFiles

dashboard_dir = Path(__file__).resolve().parents[2] / "apps" / "dashboard"
if dashboard_dir.exists():
    app.mount("/", StaticFiles(directory=str(dashboard_dir), html=True), name="dashboard")

