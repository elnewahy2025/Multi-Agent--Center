"""Normalized live activity events emitted while an agent process is running."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, Dict, Optional

MAX_CONTENT = 4000


@dataclass
class ActivityEvent:
    """One agent activity item (tool call, streamed text, status) in a CLI-neutral shape."""

    key: str                       # stable id so ACTIVE -> DONE updates the same row
    kind: str                      # tool | text | system | error | log | final
    status: str = "done"           # running | done | failed
    tool: Optional[str] = None
    title: Optional[str] = None
    content: Optional[str] = None
    append: bool = False           # True for word-by-word text deltas
    duration_seconds: Optional[float] = None


EventCallback = Callable[[ActivityEvent], None]


def clip(text: Any, limit: int = MAX_CONTENT) -> str:
    """Convert to string and truncate long tool output for display."""
    if text is None:
        return ""
    s = text if isinstance(text, str) else str(text)
    return s if len(s) <= limit else s[:limit] + f"\n… [truncated {len(s) - limit} chars]"


def summarize_params(params: Dict[str, Any]) -> str:
    """Pick the most meaningful parameter (path, command, pattern) for a one-line title."""
    if not isinstance(params, dict):
        return ""
    for key in ("CommandLine", "command", "Path", "path", "filePath", "file_path",
                "pattern", "Pattern", "query", "Query", "url", "Url"):
        if params.get(key):
            return clip(params[key], 200)
    for value in params.values():
        if isinstance(value, str) and value:
            return clip(value, 200)
    return ""
