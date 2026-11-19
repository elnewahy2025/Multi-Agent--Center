"""SQLAlchemy database models for persistence."""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any, Dict
from sqlalchemy import (
    Column,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import declarative_base, relationship

Base = declarative_base()


class ProjectModel(Base):
    """Registered project checkout managed by the Command Center."""
    __tablename__ = "projects"

    id = Column(String(64), primary_key=True)
    name = Column(String(255), nullable=False)
    root_path = Column(Text, nullable=False, unique=True)
    default_agent = Column(String(64), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    tasks = relationship("TaskModel", back_populates="project", cascade="all, delete-orphan")


class TaskModel(Base):
    """Task assigned to an agent workflow."""
    __tablename__ = "tasks"

    id = Column(String(64), primary_key=True)
    project_id = Column(String(64), ForeignKey("projects.id", ondelete="SET NULL"), nullable=True)
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=False)
    assigned_agent = Column(String(64), nullable=True)
    status = Column(String(32), nullable=False, default="PENDING")
    policy_mode = Column(String(32), nullable=False, default="AUTO_LOW_IMPACT")
    worktree_path = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
    completed_at = Column(DateTime, nullable=True)
    metadata_json = Column(Text, default="{}", nullable=False)

    project = relationship("ProjectModel", back_populates="tasks")
    runs = relationship("AgentRunModel", back_populates="task", cascade="all, delete-orphan")
    approvals = relationship("ApprovalModel", back_populates="task", cascade="all, delete-orphan")

    def get_metadata(self) -> Dict[str, Any]:
        """Deserialize metadata safely."""
        try:
            return json.loads(self.metadata_json)
        except Exception:
            return {}

    def set_metadata(self, data: Dict[str, Any]) -> None:
        """Serialize metadata safely."""
        self.metadata_json = json.dumps(data)


class AgentRunModel(Base):
    """Specific invocation / turn of an agent for a task."""
    __tablename__ = "agent_runs"

    id = Column(String(64), primary_key=True)
    task_id = Column(String(64), ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False)
    agent_type = Column(String(64), nullable=False)
    status = Column(String(32), nullable=False, default="RUNNING")
    exit_code = Column(Integer, nullable=True)
    command_line = Column(Text, nullable=True)
    stdout = Column(Text, nullable=True)
    stderr = Column(Text, nullable=True)
    duration_seconds = Column(Float, nullable=True)
    error_reason = Column(Text, nullable=True)
    started_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    completed_at = Column(DateTime, nullable=True)

    task = relationship("TaskModel", back_populates="runs")


class ApprovalModel(Base):
    """Human-in-the-loop permission / approval record."""
    __tablename__ = "approvals"

    id = Column(String(64), primary_key=True)
    task_id = Column(String(64), ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False)
    run_id = Column(String(64), nullable=True)
    action_type = Column(String(64), nullable=False)
    command_or_path = Column(Text, nullable=False)
    description = Column(Text, nullable=False)
    risk_level = Column(String(32), nullable=False, default="HIGH")
    decision = Column(String(32), nullable=False, default="PENDING")
    decided_by = Column(String(128), nullable=True)
    reason = Column(Text, nullable=True)
    requested_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    decided_at = Column(DateTime, nullable=True)

    task = relationship("TaskModel", back_populates="approvals")


class AuditLogModel(Base):
    """Immutable audit trail for operational events."""
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    task_id = Column(String(64), nullable=True)
    run_id = Column(String(64), nullable=True)
    event_type = Column(String(64), nullable=False)
    message = Column(Text, nullable=False)
    payload_json = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
