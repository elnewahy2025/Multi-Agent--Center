"""Persist live agent activity events so the dashboard can render them as they happen."""

from __future__ import annotations

import logging
import threading
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional


def iso_utc(dt: Optional[datetime]) -> Optional[str]:
    """Serialize a naive-UTC or aware datetime as an explicit UTC ISO-8601 string ('...Z')."""
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    else:
        dt = dt.astimezone(timezone.utc)
    return dt.isoformat().replace("+00:00", "Z")

from services.agent_bridge.streaming import ActivityEvent
from services.orchestrator.db import AgentEventModel, get_db_session

logger = logging.getLogger("orchestrator.events")
TEXT_FLUSH_SECONDS = 0.4


class EventSink:
    """Callable passed to adapters; upserts one DB row per event key (tool ACTIVE->DONE, text deltas)."""

    def __init__(self, task_id: str, run_id: str, agent: str, phase: Optional[str] = None) -> None:
        self.task_id, self.run_id, self.agent, self.phase = task_id, run_id, agent, phase
        self._rows: Dict[str, int] = {}
        self._text: Dict[str, str] = {}
        self._last_flush: Dict[str, float] = {}
        self._lock = threading.Lock()

    def __call__(self, event: ActivityEvent) -> None:
        try:
            with self._lock:
                if event.kind == "text" and event.append:
                    self._text[event.key] = self._text.get(event.key, "") + (event.content or "")
                    due = time.time() - self._last_flush.get(event.key, 0) >= TEXT_FLUSH_SECONDS
                    if not due and event.status == "running":
                        return
                    event = ActivityEvent(key=event.key, kind="text", status=event.status,
                                          content=self._text[event.key])
                    self._last_flush[event.key] = time.time()
                self._upsert(event)
        except Exception as exc:  # never let UI telemetry break the agent run
            logger.warning("Failed to persist agent event: %s", exc)

    def flush(self) -> None:
        """Write any buffered streamed text (call after the process exits)."""
        with self._lock:
            for key, text in self._text.items():
                self._upsert(ActivityEvent(key=key, kind="text", status="done", content=text))

    def _upsert(self, e: ActivityEvent) -> None:
        now = datetime.utcnow()
        with get_db_session() as session:
            row = None
            if e.key in self._rows:
                row = session.query(AgentEventModel).filter_by(id=self._rows[e.key]).first()
            if row is None:
                row = AgentEventModel(task_id=self.task_id, run_id=self.run_id, agent=self.agent,
                                      phase=self.phase, event_key=e.key, created_at=now)
                session.add(row)
            row.kind, row.status = e.kind, e.status
            row.tool = e.tool or row.tool
            row.title = e.title or row.title
            if e.content is not None:
                row.content = e.content
            if e.duration_seconds is not None:
                row.duration_seconds = e.duration_seconds
            row.updated_at = now
            session.flush()
            self._rows[e.key] = row.id


def list_events(task_id: str, after_id: int = 0, since: Optional[datetime] = None) -> List[Dict[str, Any]]:
    """Return events for a task; `since` also returns rows updated after that time (status changes)."""
    with get_db_session() as session:
        q = session.query(AgentEventModel).filter(AgentEventModel.task_id == task_id)
        if since is not None:
            q = q.filter((AgentEventModel.id > after_id) | (AgentEventModel.updated_at > since))
        elif after_id:
            q = q.filter(AgentEventModel.id > after_id)
        rows = q.order_by(AgentEventModel.id.asc()).limit(1000).all()
        return [
            {
                "id": r.id, "run_id": r.run_id, "agent": r.agent, "phase": r.phase,
                "kind": r.kind, "tool": r.tool, "status": r.status, "title": r.title,
                "content": r.content, "duration_seconds": r.duration_seconds,
                "created_at": iso_utc(r.created_at), "updated_at": iso_utc(r.updated_at),
            }
            for r in rows
        ]
