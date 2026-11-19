"""Unit tests for agent bridge adapters."""

import sys
import tempfile
import unittest

from packages.contracts import (
    AgentCapabilities,
    AgentDescriptor,
    AgentExecutionRequest,
    AgentType,
    PolicyMode,
    TaskStatus,
)
from services.agent_bridge import (
    AgentRegistry,
    AntigravityAdapter,
    OpenCodeAdapter,
)
from services.agent_bridge.base import BaseAgentAdapter


class TestAdapters(unittest.TestCase):
    """Test adapter command formulation and detection."""

    def test_opencode_command_builder(self):
        adapter = OpenCodeAdapter()
        req = AgentExecutionRequest(
            task_id="tsk_test_1",
            run_id="run_test_1",
            prompt="Fix formatting in main.py",
            working_directory="C:\\test\\repo",
            worktree_name="feature-format",
            policy_mode=PolicyMode.AUTO_LOW_IMPACT,
            context_files=["main.py", "utils.py"],
        )
        cmd = adapter.build_command(req)
        self.assertIn("run", cmd)
        self.assertIn("--format", cmd)
        self.assertIn("json", cmd)
        self.assertIn("--auto", cmd)
        self.assertIn("--worktree", cmd)
        self.assertIn("feature-format", cmd)
        self.assertIn("--file", cmd)
        self.assertIn("Fix formatting in main.py", cmd)

    def test_antigravity_command_builder(self):
        adapter = AntigravityAdapter()
        req = AgentExecutionRequest(
            task_id="tsk_test_2",
            run_id="run_test_2",
            prompt="Analyze architectural boundaries",
            working_directory="C:\\test\\repo",
            policy_mode=PolicyMode.AUTO_LOW_IMPACT,
            timeout_seconds=120,
        )
        cmd = adapter.build_command(req)
        self.assertIn("-p", cmd)
        self.assertIn("Analyze architectural boundaries", cmd)
        self.assertIn("--output-format", cmd)
        self.assertIn("stream-json", cmd)
        self.assertIn("--print-timeout", cmd)
        self.assertIn("120s", cmd)
        self.assertIn("--dangerously-skip-permissions", cmd)

    def test_registry_discovery(self):
        registry = AgentRegistry()
        available = registry.get_available_agents()
        agent_types = [a.agent_type for a in available]
        self.assertIn(AgentType.OPENCODE, agent_types)
        self.assertIn(AgentType.ANTIGRAVITY, agent_types)
        self.assertIn(AgentType.CLAUDE_CODE, agent_types)
        self.assertIn(AgentType.QWEN_CODE, agent_types)

    def test_claude_command_builder(self):
        from services.agent_bridge.claude import ClaudeCodeAdapter
        adapter = ClaudeCodeAdapter()
        req = AgentExecutionRequest(
            task_id="tsk_claude_1",
            run_id="run_claude_1",
            prompt="Refactor database models",
            working_directory="C:\\test\\repo",
            worktree_name="feature-db",
            policy_mode=PolicyMode.AUTO_LOW_IMPACT,
            context_files=["C:\\test\\repo\\models.py"],
        )
        cmd = adapter.build_command(req)
        self.assertIn("-p", cmd)
        self.assertIn("Refactor database models", cmd)
        self.assertIn("--worktree", cmd)
        self.assertIn("feature-db", cmd)
        self.assertIn("--dangerously-skip-permissions", cmd)

    def test_qwen_command_builder(self):
        from services.agent_bridge.qwen import QwenCodeAdapter
        adapter = QwenCodeAdapter()
        req = AgentExecutionRequest(
            task_id="tsk_qwen_1",
            run_id="run_qwen_1",
            prompt="Write tests for payment api",
            working_directory="C:\\test\\repo",
            worktree_name="test-payment",
        )
        cmd = adapter.build_command(req)
        self.assertIn("--output-format", cmd)
        self.assertIn("json", cmd)
        self.assertIn("--worktree", cmd)
        self.assertIn("test-payment", cmd)
        self.assertIn("Write tests for payment api", cmd)

    def test_opencode_stream_parser(self):
        from services.agent_bridge.opencode.stream_parser import parse_opencode_line

        tool_line = (
            '{"type":"tool_use","timestamp":1000,"part":{"id":"call-1","tool":"read",'
            '"state":{"status":"completed","input":{"path":"services/orchestrator/api.py"},'
            '"output":"line 1","time":{"start":1000,"end":1250}}}}'
        )
        tool_events = parse_opencode_line(tool_line)
        self.assertEqual(len(tool_events), 1)
        self.assertEqual(tool_events[0].kind, "tool")
        self.assertEqual(tool_events[0].status, "done")
        self.assertEqual(tool_events[0].tool, "read")
        self.assertEqual(tool_events[0].title, "services/orchestrator/api.py")
        self.assertAlmostEqual(tool_events[0].duration_seconds or 0.0, 0.25)

        text_line = '{"type":"text","timestamp":1001,"part":{"id":"prt_1","type":"text","text":"Summary of api.py"}}'
        text_events = parse_opencode_line(text_line)
        self.assertEqual(len(text_events), 1)
        self.assertEqual(text_events[0].kind, "text")
        self.assertEqual(text_events[0].content, "Summary of api.py")

    def test_antigravity_stream_parser(self):
        from services.agent_bridge.antigravity.stream_parser import parse_antigravity_line

        active_tool = (
            '{"event":"step_update","step_update":{"step_index":2,"state":"ACTIVE","step_type":"tool",'
            '"tool_name":"read_file","tool_info":{"name":"read_file","parameters":{"Path":"api.py"}}}}'
        )
        ev_active = parse_antigravity_line(active_tool)
        self.assertEqual(len(ev_active), 1)
        self.assertEqual(ev_active[0].key, "step-2")
        self.assertEqual(ev_active[0].kind, "tool")
        self.assertEqual(ev_active[0].status, "running")
        self.assertEqual(ev_active[0].title, "api.py")

        done_tool = (
            '{"event":"step_update","step_update":{"step_index":2,"state":"DONE","step_type":"tool",'
            '"tool_name":"read_file","duration_seconds":1.5,"tool_info":{"name":"read_file",'
            '"parameters":{"Path":"api.py"},"output":"381 lines"}}}'
        )
        ev_done = parse_antigravity_line(done_tool)
        self.assertEqual(ev_done[0].key, "step-2")
        self.assertEqual(ev_done[0].status, "done")
        self.assertEqual(ev_done[0].content, "381 lines")
        self.assertEqual(ev_done[0].duration_seconds, 1.5)

        delta_line = '{"event":"step_update","step_update":{"step_index":8,"state":"ACTIVE","step_type":"agent_response","text_delta":"Hello "}}'
        ev_delta = parse_antigravity_line(delta_line)
        self.assertEqual(ev_delta[0].kind, "text")
        self.assertTrue(ev_delta[0].append)
        self.assertEqual(ev_delta[0].content, "Hello ")

        result_line = '{"event":"result","result":{"status":"SUCCESS","response":"Final summary"}}'
        ev_res = parse_antigravity_line(result_line)
        self.assertEqual(len(ev_res), 1)
        self.assertEqual(ev_res[0].kind, "final")
        self.assertEqual(ev_res[0].content, "Final summary")

    def test_streaming_grace_window_and_silent_timeout(self):
        class _DummyAdapter(BaseAgentAdapter):
            agent_type = AgentType.ANTIGRAVITY

            def detect(self):
                return AgentDescriptor(
                    agent_type=AgentType.ANTIGRAVITY,
                    name="Dummy Streamer",
                    executable_path=sys.executable,
                    version="1.0",
                    is_available=True,
                    capabilities=AgentCapabilities(supports_headless=True),
                )

            def build_command(self, request: AgentExecutionRequest):
                return [sys.executable, "-c", request.prompt]

            def parse_stream_line(self, line: str):
                from services.agent_bridge.streaming import ActivityEvent
                s = line.strip()
                if s.startswith("TEXT:"):
                    return [ActivityEvent(key="resp", kind="text", status="done", content=s[5:] + "\n", append=True)]
                return []

        adapter = _DummyAdapter()
        with tempfile.TemporaryDirectory() as tmp:
            events_seen = []
            # Actively streaming past 1s triggers grace window and completes cleanly
            stream_code = (
                "import sys, time\n"
                "for i in range(6):\n"
                "    print(f'TEXT:chunk-{i}', flush=True)\n"
                "    time.sleep(0.25)\n"
            )
            res_ok = adapter.execute(
                AgentExecutionRequest(
                    task_id="tsk_grace", run_id="run_grace", prompt=stream_code,
                    working_directory=tmp, timeout_seconds=1,
                ),
                on_event=events_seen.append,
            )
            self.assertEqual(res_ok.status, TaskStatus.COMPLETED)
            self.assertEqual(res_ok.exit_code, 0)
            self.assertIn("chunk-5", res_ok.structured_output["final_text"])
            keys = [ev.key for ev in events_seen]
            self.assertEqual(keys[0], "process-start")
            self.assertEqual(keys[-1], "process-end")

            # Silent hanging process still hits hard timeout without grace
            hang_code = "import time; time.sleep(5)"
            res_to = adapter.execute(AgentExecutionRequest(
                task_id="tsk_hang", run_id="run_hang", prompt=hang_code,
                working_directory=tmp, timeout_seconds=1,
            ))
            self.assertEqual(res_to.status, TaskStatus.TIMED_OUT)
            self.assertEqual(res_to.exit_code, 124)

    def test_antigravity_add_dir_and_stream_error_parsing(self):
        from pathlib import Path
        from services.agent_bridge.antigravity.stream_parser import parse_antigravity_line

        adapter = AntigravityAdapter()
        with tempfile.TemporaryDirectory() as tmp:
            root_dir = Path(tmp) / "root"
            extra_dir = Path(tmp) / "extra_repo"
            ctx_dir = Path(tmp) / "ctx_repo"
            root_dir.mkdir()
            extra_dir.mkdir()
            ctx_dir.mkdir()
            ctx_file = ctx_dir / "package.json"
            ctx_file.write_text("{}", encoding="utf-8")

            req = AgentExecutionRequest(
                task_id="tsk_add_dir", run_id="run_add_dir", prompt="Inspect",
                working_directory=str(root_dir),
                context_files=[str(ctx_file)],
                extra_flags={"add_dirs": [str(extra_dir), str(root_dir)]},
            )
            cmd = adapter.build_command(req)
            add_vals = [cmd[i + 1] for i, tok in enumerate(cmd) if tok == "--add-dir"]
            self.assertIn(str(extra_dir.resolve()), add_vals)
            self.assertIn(str(ctx_dir.resolve()), add_vals)
            self.assertNotIn(str(root_dir.resolve()), add_vals)

        err_tool = (
            '{"event":"step_update","step_update":{"step_index":2,"state":"ERROR","step_type":"tool",'
            '"tool_name":"read_file","duration_seconds":0.9,"tool_info":{"name":"read_file",'
            '"parameters":{"Path":"package.json"},"error":{"type":"TOOL_ERROR","message":"permission check failed"}}}}'
        )
        evs_err = parse_antigravity_line(err_tool)
        self.assertEqual(len(evs_err), 1)
        self.assertEqual(evs_err[0].status, "failed")
        self.assertEqual(evs_err[0].content, "permission check failed")

        denied_result = (
            '{"event":"result","result":{"status":"SUCCESS","response":"",'
            '"denied_actions":[{"action":"read_file","display_name":"ReadFile"}]}}'
        )
        evs_denied = parse_antigravity_line(denied_result)
        self.assertEqual([e.key for e in evs_denied], ["final", "denied-actions"])
        self.assertEqual(evs_denied[1].kind, "error")
        self.assertIn("ReadFile", evs_denied[1].content)


if __name__ == "__main__":
    unittest.main()
