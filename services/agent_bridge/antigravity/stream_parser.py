"""Parse Antigravity CLI 1.5.12 `--output-format stream-json` events (verified 2026-11-19 by live probe).

Observed events: init, step_update (user_input | agent_response | tool | subagent), result.
"""

from __future__ import annotations

import json
from typing import List

from services.agent_bridge.streaming import ActivityEvent, clip, summarize_params

_STATE = {"ACTIVE": "running", "DONE": "done", "ERROR": "failed", "FAILED": "failed",
          "CANCELED": "failed", "CANCELLED": "failed"}


def parse_antigravity_line(line: str) -> List[ActivityEvent]:
    text = line.strip()
    if not text.startswith("{"):
        return [ActivityEvent(key=f"log-{hash(text)}", kind="log", content=clip(text))] if text else []

    data = json.loads(text)
    event = data.get("event")

    if event == "init":
        init = data.get("init") or {}
        return [ActivityEvent(key="init", kind="system",
                              title=f"Session started in {init.get('cwd', '?')}")]

    if event == "result":
        result = data.get("result") or {}
        events = [ActivityEvent(key="final", kind="final", content=result.get("response") or "")]
        if result.get("status") not in (None, "SUCCESS"):
            events.append(ActivityEvent(key="result-error", kind="error", status="failed",
                                        content=clip(json.dumps(result))))
        return events

    if event != "step_update":
        return []

    step = data.get("step_update") or {}
    idx = step.get("step_index")
    stype = step.get("step_type")
    status = _STATE.get(step.get("state", ""), "running")
    key = f"step-{idx}"

    if stype == "agent_response":
        if step.get("text_delta"):
            return [ActivityEvent(key=key, kind="text", status=status,
                                  content=step["text_delta"], append=True)]
        return []  # thinking-only turn: no visible text

    if stype in ("tool", "subagent"):
        info = step.get("tool_info") or {}
        tool = step.get("tool_name") or info.get("name") or stype
        title = summarize_params(info.get("parameters") or {})
        if stype == "subagent":
            subs = (step.get("subagent_info") or {}).get("subagents") or [{}]
            title = subs[0].get("role") or title
        return [ActivityEvent(key=key, kind="tool", status=status, tool=tool, title=title,
                              content=clip(info.get("output")) if info.get("output") else None,
                              duration_seconds=step.get("duration_seconds"))]

    return []  # user_input echo
