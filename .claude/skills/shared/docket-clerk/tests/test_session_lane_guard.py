import json
import os
import re
import subprocess
import sys
import tempfile
import unittest
import uuid
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "hooks" / "session-lane-guard.py"
AGENT = "lawyer:docket-clerk"
PLUGIN_JSON = Path(__file__).resolve().parents[5] / "source" / "lawyer" / "plugin.json"
PLUGIN_HOOK_ARG = "${CLAUDE_PLUGIN_ROOT}/skills/shared/docket-clerk/hooks/session-lane-guard.py"


class SessionLaneGuardTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.env = dict(os.environ, TMP=self.tmp.name, TEMP=self.tmp.name, TMPDIR=self.tmp.name)
        self.session = str(uuid.uuid4())

    def tearDown(self):
        self.tmp.cleanup()

    def run_hook(self, payload, session=None):
        payload = dict(payload, session_id=session or self.session)
        return subprocess.run([sys.executable, str(SCRIPT)], input=json.dumps(payload),
                              capture_output=True, text=True, env=self.env)

    def skill(self, name, **kw):
        return self.run_hook({"hook_event_name": "PreToolUse", "tool_name": "Skill",
                              "tool_input": {"skill": name}}, **kw)

    def typed(self, prompt, **kw):
        return self.run_hook({"hook_event_name": "UserPromptSubmit", "prompt": prompt}, **kw)

    def tool(self, name, **kw):
        return self.run_hook({"hook_event_name": "PreToolUse", "tool_name": name,
                              "tool_input": {}}, **kw)

    def test_deadline_tools_blocked_after_drafting(self):
        self.assertEqual(self.skill("draft").returncode, 0)
        for name in ("active_deadlines", "open_tasks", "upsert_deadline", "upsert_anchor",
                     "delete_anchor", "rule_overlay", "upsert_rule_overlay"):
            result = self.tool(f"mcp__plugin_lawyer_data__practice_data__{name}")
            self.assertEqual(result.returncode, 2, name)
            self.assertIn("/draft", result.stderr)

    AUDIT = "mcp__plugin_lawyer_data__rules__audit"

    def test_audit_refused_in_drafting_lane(self):
        self.assertEqual(self.skill("draft").returncode, 0)
        for name in (self.AUDIT, "mcp__remote-devices__plugin_lawyer_data__rules__audit"):
            result = self.tool(name)
            self.assertEqual(result.returncode, 2, name)
            self.assertIn("Blocked: auditing", result.stderr)
            self.assertNotIn("rules__audit", result.stderr)
        self.assertEqual(self.agent_tool(self.AUDIT).returncode, 2)
        self.assertEqual(self.tool("mcp__plugin_lawyer_data__rules__at").returncode, 0)

    def test_audit_allowed_outside_drafting_and_enters_no_lane(self):
        self.assertEqual(self.tool(self.AUDIT).returncode, 0)
        self.assertEqual(self.skill("draft").returncode, 0)
        fresh = str(uuid.uuid4())
        self.assertEqual(self.tool(self.AUDIT, session=fresh).returncode, 0)
        self.assertEqual(self.tool("mcp__plugin_lawyer_data__practice_data__open_tasks",
                                   session=fresh).returncode, 0)

    def test_audit_leaves_deadline_lane_unaffected(self):
        self.assertEqual(self.tool("mcp__plugin_lawyer_data__practice_data__active_deadlines").returncode, 0)
        self.assertEqual(self.tool(self.AUDIT).returncode, 0)
        self.assertEqual(self.tool("mcp__plugin_lawyer_data__practice_data__upsert_deadline").returncode, 0)
        self.assertEqual(self.skill("draft").returncode, 2)

    def test_bridged_deadline_tool_blocked_after_drafting(self):
        self.assertEqual(self.skill("draft").returncode, 0)
        self.assertEqual(self.tool(
            "mcp__remote-devices__plugin_lawyer_data__practice_data__active_deadlines").returncode, 2)

    def test_drafting_blocked_after_deadline_tool(self):
        self.assertEqual(self.tool("mcp__plugin_lawyer_data__practice_data__open_tasks").returncode, 0)
        self.assertEqual(self.tool("mcp__plugin_lawyer_data__practice_data__active_deadlines").returncode, 0)
        self.assertEqual(self.skill("draft").returncode, 2)

    def test_deadline_tool_passes_in_deadline_lane(self):
        self.assertEqual(self.tool("mcp__plugin_lawyer_data__practice_data__upsert_deadline").returncode, 0)
        self.assertEqual(self.tool("mcp__plugin_lawyer_data__practice_data__active_deadlines").returncode, 0)
        self.assertEqual(self.tool("mcp__plugin_lawyer_data__practice_data__upsert_deadline").returncode, 0)

    def test_unfenced_practice_tools_pass_after_drafting(self):
        self.assertEqual(self.skill("draft").returncode, 0)
        for name in ("court_calendar_days", "court_calendar_coverage", "matter_lookup"):
            self.assertEqual(self.tool(f"mcp__plugin_lawyer_data__practice_data__{name}").returncode, 0, name)

    def test_other_tools_and_skills_pass(self):
        self.assertEqual(self.run_hook({"hook_event_name": "PreToolUse", "tool_name": "Bash",
                                        "tool_input": {"command": "ls"}}).returncode, 0)
        self.assertEqual(self.skill("calculate").returncode, 0)
        self.assertEqual(self.tool("mcp__plugin_lawyer_data__practice_data__upsert_deadline").returncode, 0)

    def test_deadline_blocked_after_drafting(self):
        self.assertEqual(self.skill("draft").returncode, 0)
        result = self.tool("mcp__plugin_lawyer_data__practice_data__upsert_deadline")
        self.assertEqual(result.returncode, 2)
        self.assertIn("/draft", result.stderr)

    def test_drafting_blocked_after_deadline(self):
        self.assertEqual(self.tool("mcp__plugin_lawyer_data__practice_data__upsert_deadline").returncode, 0)
        self.assertEqual(self.skill("litigator:polish-substance").returncode, 2)

    def test_assemble_is_in_drafting_lane(self):
        self.assertEqual(self.tool("mcp__plugin_lawyer_data__practice_data__upsert_deadline").returncode, 0)
        self.assertEqual(self.skill("assemble").returncode, 2)

    def test_deadline_blocked_after_assemble(self):
        self.assertEqual(self.skill("litigator:assemble").returncode, 0)
        self.assertEqual(self.tool("mcp__plugin_lawyer_data__practice_data__upsert_deadline").returncode, 2)

    def test_prepare_is_in_drafting_lane(self):
        self.assertEqual(self.tool("mcp__plugin_lawyer_data__practice_data__upsert_deadline").returncode, 0)
        self.assertEqual(self.skill("prepare").returncode, 2)

    def test_deadline_blocked_after_prepare(self):
        self.assertEqual(self.skill("litigator:prepare").returncode, 0)
        self.assertEqual(self.tool("mcp__plugin_lawyer_data__practice_data__upsert_deadline").returncode, 2)

    def test_same_lane_passes(self):
        self.assertEqual(self.skill("draft").returncode, 0)
        self.assertEqual(self.skill("publish").returncode, 0)
        self.assertEqual(self.skill("draft").returncode, 0)

    def test_typed_slash_commands_count(self):
        self.assertEqual(self.typed("/litigator:draft open the NoA").returncode, 0)
        self.assertEqual(self.tool("mcp__plugin_lawyer_data__practice_data__upsert_deadline").returncode, 2)
        other = str(uuid.uuid4())
        self.assertEqual(self.typed("what does /draft do?", session=other).returncode, 0)
        self.assertEqual(self.tool("mcp__plugin_lawyer_data__practice_data__upsert_deadline", session=other).returncode, 0)

    def test_new_session_starts_clean(self):
        self.assertEqual(self.skill("draft").returncode, 0)
        self.assertEqual(self.tool("mcp__plugin_lawyer_data__practice_data__upsert_deadline", session=str(uuid.uuid4())).returncode, 0)

    def agent_tool(self, name, agent_type=AGENT, **kw):
        return self.run_hook({"hook_event_name": "PreToolUse", "tool_name": name, "tool_input": {},
                              "agent_id": "agent-1", "agent_type": agent_type}, **kw)

    def subagent_start(self, **kw):
        return self.run_hook({"hook_event_name": "SubagentStart", "agent_id": "agent-1",
                              "agent_type": AGENT}, **kw)

    def subagent_stop(self, message, stop_hook_active=False, **kw):
        return self.run_hook({"hook_event_name": "SubagentStop", "agent_id": "agent-1",
                              "agent_type": AGENT, "last_assistant_message": message,
                              "stop_hook_active": stop_hook_active}, **kw)

    def marker_lane(self):
        marker = Path(self.tmp.name) / f"coclerk-lane-{self.session}"
        return marker.read_text(encoding="utf-8").split("\n")[0]

    def test_docket_clerk_agent_deadline_tool_passes_in_drafting_lane(self):
        self.assertEqual(self.skill("draft").returncode, 0)
        for name in ("upsert_anchor", "upsert_deadline", "active_deadlines", "rule_overlay"):
            result = self.agent_tool(f"mcp__plugin_lawyer_data__practice_data__{name}")
            self.assertEqual(result.returncode, 0, name)
        self.assertEqual(self.agent_tool(
            "mcp__remote-devices__plugin_lawyer_data__practice_data__upsert_deadline").returncode, 0)
        self.assertEqual(self.marker_lane(), "drafting")

    def test_other_agent_deadline_tool_blocked_in_drafting_lane(self):
        self.assertEqual(self.skill("draft").returncode, 0)
        result = self.agent_tool("mcp__plugin_lawyer_data__practice_data__upsert_deadline",
                                 agent_type="general-purpose")
        self.assertEqual(result.returncode, 2)

    def test_subagent_start_in_fresh_session_is_full_mode_and_locks_deadline_lane(self):
        result = self.subagent_start()
        self.assertEqual(result.returncode, 0)
        out = json.loads(result.stdout)["hookSpecificOutput"]
        self.assertEqual(out["hookEventName"], "SubagentStart")
        self.assertIn("Full mode", out["additionalContext"])
        self.assertEqual(self.marker_lane(), "deadline")
        self.assertEqual(self.skill("draft").returncode, 2)

    def test_subagent_start_mode_follows_lane(self):
        self.assertEqual(self.skill("draft").returncode, 0)
        drafting = json.loads(self.subagent_start().stdout)["hookSpecificOutput"]["additionalContext"]
        self.assertIn("Recorded-only mode", drafting)
        self.assertEqual(self.marker_lane(), "drafting")
        other = str(uuid.uuid4())
        self.assertEqual(self.tool("mcp__plugin_lawyer_data__practice_data__upsert_deadline", session=other).returncode, 0)
        deadline = json.loads(self.subagent_start(session=other).stdout)["hookSpecificOutput"]
        self.assertIn("Full mode", deadline["additionalContext"])

    def test_subagent_stop_blocks_dates_in_drafting_lane(self):
        self.assertEqual(self.skill("draft").returncode, 0)
        for message in ("recorded 1 deadline due 2026-11-03", "14 days", "Nov 3, 2026",
                        "3/11/2026", "2 weeks"):
            result = self.subagent_stop(message)
            self.assertEqual(result.returncode, 0, message)
            self.assertEqual(json.loads(result.stdout)["decision"], "block", message)
        looping = self.subagent_stop("14 days", stop_hook_active=True)
        self.assertEqual(json.loads(looping.stdout)["decision"], "block")

    def test_subagent_stop_passes_counts_in_drafting_lane(self):
        self.assertEqual(self.skill("draft").returncode, 0)
        for message in ("recorded 2 anchors, 3 deadlines",
                        "recorded 0 anchors, 0 deadlines\n2 items need a deadline session"):
            result = self.subagent_stop(message)
            self.assertEqual(result.returncode, 0, message)
            self.assertEqual(result.stdout.strip(), "", message)

    def test_subagent_stop_passes_dates_in_deadline_lane(self):
        self.assertEqual(self.tool("mcp__plugin_lawyer_data__practice_data__upsert_deadline").returncode, 0)
        result = self.subagent_stop("trial_management_conference due 2026-11-03 (14 days)")
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stdout.strip(), "")

    # The temp marker can be missing, for example after a session resumes on another
    # host. The lane is then rebuilt from the session transcript.
    def transcript(self, *entries):
        path = Path(self.tmp.name) / "transcript.jsonl"
        path.write_text("".join(json.dumps(e) + "\n" for e in entries), encoding="utf-8")
        return str(path)

    @staticmethod
    def typed_entry(text, sidechain=False):
        return {"type": "user", "isSidechain": sidechain, "message": {"role": "user", "content": text}}

    @staticmethod
    def tool_use_entry(name, tool_input, sidechain=False):
        return {"type": "assistant", "isSidechain": sidechain, "message": {"role": "assistant", "content": [
            {"type": "tool_use", "id": "toolu_1", "name": name, "input": tool_input}]}}

    def with_transcript(self, path, payload):
        return self.run_hook(dict(payload, transcript_path=path))

    def test_missing_marker_rebuilds_typed_draft_lane(self):
        path = self.transcript(self.typed_entry(
            "<command-message>litigator:draft</command-message>\n<command-name>/litigator:draft</command-name>"))
        start = self.with_transcript(path, {"hook_event_name": "SubagentStart", "agent_id": "agent-1",
                                            "agent_type": AGENT})
        self.assertIn("Recorded-only mode", json.loads(start.stdout)["hookSpecificOutput"]["additionalContext"])
        self.assertEqual(self.marker_lane(), "drafting")
        stop = self.subagent_stop("due 2026-11-03")
        self.assertEqual(json.loads(stop.stdout)["decision"], "block")
        self.assertEqual(self.skill("litigator:publish").returncode, 0)

    def test_missing_marker_rebuilds_skill_call_lane(self):
        path = self.transcript(self.tool_use_entry("Skill", {"skill": "litigator:draft"}))
        result = self.with_transcript(path, {"hook_event_name": "PreToolUse", "tool_input": {},
                                             "tool_name": "mcp__plugin_lawyer_data__practice_data__upsert_deadline"})
        self.assertEqual(result.returncode, 2)
        self.assertIn("/draft", result.stderr)

    def test_missing_marker_rebuilds_deadline_lane(self):
        path = self.transcript(
            self.tool_use_entry("mcp__plugin_lawyer_data__practice_data__active_deadlines", {}),
            self.tool_use_entry("Skill", {"skill": "draft"}))
        result = self.with_transcript(path, {"hook_event_name": "PreToolUse", "tool_name": "Skill",
                                             "tool_input": {"skill": "draft"}})
        self.assertEqual(result.returncode, 2)

    def test_missing_marker_rebuilds_clerk_spawn_lane(self):
        path = self.transcript(self.tool_use_entry("Agent", {"subagent_type": AGENT, "prompt": "x"}))
        result = self.with_transcript(path, {"hook_event_name": "PreToolUse", "tool_name": "Skill",
                                             "tool_input": {"skill": "publish"}})
        self.assertEqual(result.returncode, 2)

    def test_transcript_sidechain_entries_ignored(self):
        path = self.transcript(self.tool_use_entry("Skill", {"skill": "draft"}, sidechain=True))
        start = self.with_transcript(path, {"hook_event_name": "SubagentStart", "agent_id": "agent-1",
                                            "agent_type": AGENT})
        self.assertIn("Full mode", json.loads(start.stdout)["hookSpecificOutput"]["additionalContext"])
        self.assertEqual(self.marker_lane(), "deadline")

    def test_empty_transcript_is_a_fresh_session(self):
        path = self.transcript()
        start = self.with_transcript(path, {"hook_event_name": "SubagentStart", "agent_id": "agent-1",
                                            "agent_type": AGENT})
        self.assertIn("Full mode", json.loads(start.stdout)["hookSpecificOutput"]["additionalContext"])
        self.assertEqual(self.marker_lane(), "deadline")

    def test_unreadable_transcript_fails_open_without_a_lane_line(self):
        path = str(Path(self.tmp.name) / "missing.jsonl")
        start = self.with_transcript(path, {"hook_event_name": "SubagentStart", "agent_id": "agent-1",
                                            "agent_type": AGENT})
        self.assertEqual(start.returncode, 0)
        self.assertNotIn("LANE:", start.stdout)
        self.assertIn("hook error", start.stderr)

    def test_malformed_input_fails_open(self):
        result = subprocess.run([sys.executable, str(SCRIPT)], input="not json",
                                capture_output=True, text=True, env=self.env)
        self.assertEqual(result.returncode, 0)
        self.assertIn("hook error", result.stderr)


class PluginRegistrationTests(unittest.TestCase):
    # The script reads tool names without the plugin prefix, so the manifest
    # matchers are the only place a wrong plugin name stops the guard running.
    def setUp(self):
        self.hooks = json.loads(PLUGIN_JSON.read_text(encoding="utf-8"))["hooks"]

    def entries(self, event):
        return [entry for entry in self.hooks[event]
                if any(PLUGIN_HOOK_ARG in h.get("args", []) for h in entry["hooks"])]

    def test_plugin_registers_the_guard_for_both_tool_name_forms(self):
        entries = self.entries("PreToolUse")
        self.assertEqual(len(entries), 1)
        matcher = re.compile(entries[0]["matcher"])
        tools = [f"practice_data__{name}" for name in (
            "active_deadlines", "open_tasks", "upsert_deadline", "upsert_anchor",
            "delete_anchor", "rule_overlay", "upsert_rule_overlay")] + ["rules__audit"]
        for prefix in ("mcp__plugin_lawyer_data__", "mcp__remote-devices__plugin_lawyer_data__"):
            for tool in tools:
                self.assertTrue(matcher.fullmatch(prefix + tool), prefix + tool)
        self.assertTrue(matcher.fullmatch("Skill"))
        self.assertFalse(matcher.fullmatch("mcp__plugin_lawyer_data__rules__at"))
        self.assertFalse(matcher.fullmatch("mcp__plugin_other_data__rules__audit"))

    def test_plugin_registers_the_guard_for_the_docket_clerk_agent(self):
        for event in ("SubagentStart", "SubagentStop"):
            entries = self.entries(event)
            self.assertEqual(len(entries), 1, event)
            self.assertEqual(entries[0]["matcher"], AGENT, event)

    def test_test_agent_name_is_the_scripts(self):
        self.assertIn(f'AGENT = "{AGENT}"', SCRIPT.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
