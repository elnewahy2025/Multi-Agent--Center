"""Parse OpenCode 2.3.2 `run --format json` NDJSON events (verified 2026-11-19 by live probe).

Observed event types: step_start, tool_use, text, step_finish.
"""

from __future__ import annotations

import json
from typing import List

from services.agent_bridge.streaming import ActivityEvent, clip, summarize_params

_STATUS = {"completed": "done", "error": "failed", "running": "running", "pending": "running"}


def parse_opencode_line(line: str) -> List[ActivityEvent]:
    text = line.strip()
    if not text.startswith("{"):
        return [ActivityEvent(key=f"log-{hash(text)}", kind="log", content=clip(text))] if text else []

    data = json.loads(text)
    etype = data.get("type")
    part = data.get("part") or {}

    if etype == "tool_use":
        state = part.get("state") or {}
        tool = part.get("tool") or "tool"
        status = _STATUS.get(state.get("status", ""), "done")
        timing = state.get("time") or {}
        duration = None
        if timing.get("start") and timing.get("end"):
            duration = (timing["end"] - timing["start"]) / 1000.0
        output = state.get("output") if status != "failed" else (state.get("error") or state.get("output"))
        return [ActivityEvent(
            key=part.get("id") or part.get("partID") or f"tool-{data.get('timestamp')}",
            kind="tool", status=status, tool=tool,
            title=summarize_params(state.get("input") or {}),
            content=clip(output), duration_seconds=duration,
        )]

    if etype == "text" and part.get("text"):
        return [ActivityEvent(key=part.get("id", "text"), kind="text", content=part["text"])]

    if etype == "step_finish":
        tokens = part.get("tokens") or {}
        if part.get("reason") == "stop":
            return [ActivityEvent(key=part.get("id", "finish"), kind="system",
                                  title=f"Turn finished · {tokens.get('input', 0)} in / "
                                        f"{tokens.get('output', 0)} out tokens")]
        return []

    if etype == "error" or data.get("error"):
        err = data.get("error") or part
        return [ActivityEvent(key=f"err-{data.get('timestamp')}", kind="error", status="failed",
                              content=clip(json.dumps(err) if not isinstance(err, str) else err))]

    return []  # step_start and unknown types carry no user-visible information
