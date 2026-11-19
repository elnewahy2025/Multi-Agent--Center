"""Task contracts and schema definitions."""

from __future__ import annotations

import re
from datetime import datetime
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field, model_validator

from packages.contracts.enums import AgentType, PolicyMode, TaskStatus

_FILLER_PREFIX_RE = re.compile(
    r"^(?:please|can you|could you|would you|i want(?: you)? to|help me|task\s*:)\s+",
    re.IGNORECASE,
)
_CODE_LINE_RE = re.compile(
    r"^\s*(?:def |class |import |from\s+\S+\s+import |async\s+def |return\b|if\s+__name__|"
    r"function\s+|const\s+|let\s+|var\s+|export\s+|interface\s+|type\s+|#include\s+|"
    r"package\s+|public\s+|private\s+|SELECT\s+|INSERT\s+|UPDATE\s+|DELETE\s+|"
    r"CREATE\s+TABLE\s+|<[a-zA-Z!])"
)
_CODE_END_RE = re.compile(r"(?:\{\s*|\}\s*;?|;\s*|\):\s*)$")
_CODE_SYNTAX_RE = re.compile(r"(?:[=(){}\[\];]|</|\b(?:def|class|import|function|const|let)\s+)")


def _first_non_empty_line(text: str) -> str:
    for raw in (text or "").splitlines():
        s = raw.strip()
        if s:
            return s
    return ""


def _fenced_block_contains_code(text: str) -> bool:
    lines = (text or "").splitlines()
    saw_open = False
    for raw in lines:
        s = raw.strip()
        if not saw_open:
            if s.startswith("```"):
                saw_open = True
                tag = s[3:].strip()
                if tag and " " not in tag and "```" not in tag:
                    return True
            continue
        if s.startswith("```"):
            break
        if not s:
            continue
        if _CODE_LINE_RE.match(s) or _CODE_END_RE.search(s) or _CODE_SYNTAX_RE.search(s):
            return True
    return False


def _starts_with_code(text: str) -> bool:
    first = _first_non_empty_line(text)
    if not first:
        return False
    if first.startswith("```"):
        return _fenced_block_contains_code(text)
    return bool(_CODE_LINE_RE.match(first)) or bool(_CODE_END_RE.search(first))


def looks_like_code_snippet(text: str) -> bool:
    """Return True when text contains fenced code or multiple lines of source code."""
    if not text or not text.strip():
        return False
    if "```" in text:
        return _fenced_block_contains_code(text)
    non_empty = [ln for ln in text.splitlines() if ln.strip()]
    if not non_empty:
        return False
    if _CODE_LINE_RE.match(non_empty[0]) or _CODE_END_RE.search(non_empty[0]):
        return True
    code_hits = sum(1 for ln in non_empty if _CODE_LINE_RE.match(ln) or _CODE_END_RE.search(ln))
    return len(non_empty) >= 2 and code_hits >= 2


def normalize_task_prompt(description: str, context_files: Optional[List[str]] = None) -> str:
    """Frame raw pasted code as a fix request and prepend explicit file/folder target scope."""
    body = (description or "").strip()
    if _starts_with_code(body):
        body = (
            "Inspect, debug, and fix the following pasted code snippet. Identify the root cause of any "
            "issues and provide the complete corrected code (and apply the fix to the target file if applicable):\n\n"
            + body
        )
    if context_files:
        scope = ", ".join(context_files)
        body = f"Target File(s) / Directory Scope: {scope}\n\n{body}"
    return body


def derive_task_title(description: str, explicit_title: Optional[str] = None) -> str:
    """Return explicit_title when provided, or derive a concise variable title from description."""
    if explicit_title and explicit_title.strip():
        return explicit_title.strip()[:255]

    if _starts_with_code(description):
        code_line = ""
        for raw in (description or "").splitlines():
            s = raw.strip()
            if s and not s.startswith("```"):
                code_line = " ".join(s.split())
                break
        if code_line:
            if len(code_line) <= 52:
                return f"Fix code: {code_line}"
            cut = code_line[:51].rsplit(" ", 1)[0] or code_line[:51]
            return f"Fix code: {cut}…"

    first_line = ""
    for raw in (description or "").splitlines():
        cleaned = re.sub(r"^[#*\->\s]+", "", raw).strip()
        if cleaned and not cleaned.startswith("```"):
            first_line = cleaned
            break
    if not first_line:
        return "Untitled Task"

    # Strip repeated polite/filler prefixes (e.g. "Please help me fix...")
    for _ in range(3):
        updated = _FILLER_PREFIX_RE.sub("", first_line).strip()
        if updated == first_line:
            break
        first_line = updated

    clause = re.split(r"[.?!;](?:\s|$)", first_line, maxsplit=1)[0]
    collapsed = " ".join(clause.split()).strip(" :-")
    if not collapsed:
        return "Untitled Task"

    titled = collapsed[0].upper() + collapsed[1:]
    if len(titled) <= 65:
        return titled
    cut = titled[:64].rsplit(" ", 1)[0].rstrip(",;:-") or titled[:64]
    return f"{cut}…"


class TaskCreate(BaseModel):
    """Schema for creating a new task request."""
    title: Optional[str] = Field(None, max_length=255, description="Optional task title; auto-derived from description when omitted")
    description: str = Field(..., min_length=1, description="Detailed instructions for the agent")
    project_id: Optional[str] = Field(None, description="Optional target project identifier")
    project_path: Optional[str] = Field(None, description="Target repository path")
    preferred_agent: Optional[AgentType] = Field(None, description="Requested agent adapter")
    policy_mode: PolicyMode = Field(PolicyMode.AUTO_LOW_IMPACT, description="Autonomy policy")
    use_worktree: bool = Field(True, description="Whether to isolate task in a Git worktree")
    timeout_seconds: int = Field(3600, ge=30, le=86400, description="Task timeout limit")
    context_files: List[str] = Field(default_factory=list, description="Files to include in context")

    @model_validator(mode="after")
    def _ensure_title(self) -> "TaskCreate":
        self.title = derive_task_title(self.description, self.title)
        return self


class TaskRead(BaseModel):
    """Schema representing an existing task with full state."""
    id: str
    title: str
    description: str
    project_id: Optional[str] = None
    project_path: Optional[str] = None
    assigned_agent: Optional[AgentType] = None
    status: TaskStatus
    policy_mode: PolicyMode
    worktree_path: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    completed_at: Optional[datetime] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)


class TaskUpdate(BaseModel):
    """Schema for updating an existing task."""
    title: Optional[str] = None
    description: Optional[str] = None
    status: Optional[TaskStatus] = None
    assigned_agent: Optional[AgentType] = None
    worktree_path: Optional[str] = None
    completed_at: Optional[datetime] = None
    metadata: Optional[Dict[str, Any]] = None
