import json
import os
import re
import sys
import tempfile
import unittest
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "tests"))
from hook_runner import run_hook  # noqa: E402

SCRIPT = Path(__file__).resolve().parents[1] / "hooks" / "session-lane-guard.py"
PLUGIN_JSON = Path(__file__).resolve().parents[5] / "source" / "lawyer" / "plugin.json"
PLUGIN_HOOK_ARG = "${CLAUDE_PLUGIN_ROOT}/skills/shared/docket-clerk/hooks/session-lane-guard.py"
DEADLINE_TOOLS = ("active_deadlines", "open_tasks", "upsert_deadline", "upsert_anchor", "delete_anchor",
                  "rule_overlay", "upsert_rule_overlay", "render_practice_board")


class SessionLaneGuardTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.env = dict(os.environ, TMP=self.tmp.name, TEMP=self.tmp.name, TMPDIR=self.tmp.name)
        self.session = str(uuid.uuid4())

    def tearDown(self):
        self.tmp.cleanup()

    def run_hook(self, payload, session=None):
        payload = dict(payload, session_id=session or self.session)
        return run_hook(SCRIPT, json.dumps(payload), env=self.env, timeout=None, text=True)

    def skill(self, name, **kw):
        return self.run_hook({"hook_event_name": "PreToolUse", "tool_name": "Skill",
                              "tool_input": {"skill": name}}, **kw)

    def typed(self, prompt, **kw):
        return self.run_hook({"hook_event_name": "UserPromptSubmit", "prompt": prompt}, **kw)

    def tool(self, name, **kw):
        return self.run_hook({"hook_event_name": "PreToolUse", "tool_name": name,
                              "tool_input": {}}, **kw)

    def agent_tool(self, name, agent_type="general-purpose", **kw):
        return self.run_hook({"hook_event_name": "PreToolUse", "tool_name": name, "tool_input": {},
                              "agent_id": "agent-1", "agent_type": agent_type}, **kw)

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

    def test_each_drafting_skill_enters_the_drafting_lane(self):
        for name in ("draft", "publish", "litigator:polish-substance", "litigator:assemble", "prepare", "work", "litigator:work"):
            session = str(uuid.uuid4())
            self.assertEqual(self.skill(name, session=session).returncode, 0, name)
            self.assertEqual(self.tool(self.AUDIT, session=session).returncode, 2, name)

    def test_deadline_tools_pass_in_drafting_session(self):
        self.assertEqual(self.skill("draft").returncode, 0)
        for name in DEADLINE_TOOLS:
            for prefix in ("mcp__plugin_lawyer_data__", "mcp__remote-devices__plugin_lawyer_data__"):
                self.assertEqual(self.tool(f"{prefix}practice_data__{name}").returncode, 0, prefix + name)
            self.assertEqual(self.agent_tool(f"mcp__plugin_lawyer_data__practice_data__{name}",
                                             agent_type="lawyer:docket-clerk").returncode, 0, name)

    def test_drafting_passes_after_deadline_tool(self):
        self.assertEqual(self.tool("mcp__plugin_lawyer_data__practice_data__upsert_deadline").returncode, 0)
        self.assertEqual(self.tool("mcp__plugin_lawyer_data__practice_data__active_deadlines").returncode, 0)
        self.assertEqual(self.skill("draft").returncode, 0)
        self.assertEqual(self.skill("litigator:assemble").returncode, 0)

    def test_other_tools_and_skills_pass(self):
        self.assertEqual(self.run_hook({"hook_event_name": "PreToolUse", "tool_name": "Bash",
                                        "tool_input": {"command": "ls"}}).returncode, 0)
        self.assertEqual(self.skill("calculate").returncode, 0)
        self.assertEqual(self.tool(self.AUDIT).returncode, 0)

    def test_same_lane_passes(self):
        self.assertEqual(self.skill("draft").returncode, 0)
        self.assertEqual(self.skill("publish").returncode, 0)
        self.assertEqual(self.skill("draft").returncode, 0)

    def test_typed_slash_commands_count(self):
        self.assertEqual(self.typed("/litigator:draft open the NoA").returncode, 0)
        self.assertEqual(self.tool(self.AUDIT).returncode, 2)
        other = str(uuid.uuid4())
        self.assertEqual(self.typed("what does /draft do?", session=other).returncode, 0)
        self.assertEqual(self.tool(self.AUDIT, session=other).returncode, 0)

    def test_new_session_starts_clean(self):
        self.assertEqual(self.skill("draft").returncode, 0)
        self.assertEqual(self.tool(self.AUDIT, session=str(uuid.uuid4())).returncode, 0)

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

    def audit_with_transcript(self, path):
        return self.run_hook({"hook_event_name": "PreToolUse", "tool_name": self.AUDIT, "tool_input": {},
                              "transcript_path": path})

    def test_missing_marker_rebuilds_typed_draft_lane(self):
        path = self.transcript(self.typed_entry(
            "<command-message>litigator:draft</command-message>\n<command-name>/litigator:draft</command-name>"))
        self.assertEqual(self.audit_with_transcript(path).returncode, 2)
        self.assertEqual(self.tool(self.AUDIT).returncode, 2)

    def test_missing_marker_rebuilds_skill_call_lane(self):
        path = self.transcript(
            self.tool_use_entry("mcp__plugin_lawyer_data__practice_data__active_deadlines", {}),
            self.tool_use_entry("Skill", {"skill": "litigator:draft"}))
        result = self.audit_with_transcript(path)
        self.assertEqual(result.returncode, 2)
        self.assertIn("/draft", result.stderr)

    def test_transcript_without_drafting_is_no_lane(self):
        path = self.transcript(
            self.tool_use_entry("Agent", {"subagent_type": "lawyer:docket-clerk", "prompt": "x"}),
            self.tool_use_entry("mcp__plugin_lawyer_data__practice_data__upsert_deadline", {}))
        self.assertEqual(self.audit_with_transcript(path).returncode, 0)

    def test_transcript_sidechain_entries_ignored(self):
        path = self.transcript(self.tool_use_entry("Skill", {"skill": "draft"}, sidechain=True))
        self.assertEqual(self.audit_with_transcript(path).returncode, 0)

    def test_empty_transcript_is_a_fresh_session(self):
        self.assertEqual(self.audit_with_transcript(self.transcript()).returncode, 0)

    def test_unreadable_transcript_fails_open(self):
        result = self.audit_with_transcript(str(Path(self.tmp.name) / "missing.jsonl"))
        self.assertEqual(result.returncode, 0)
        self.assertIn("hook error", result.stderr)

    def test_malformed_input_fails_open(self):
        result = run_hook(SCRIPT, "not json", env=self.env, timeout=None, text=True)
        self.assertEqual(result.returncode, 0)
        self.assertIn("hook error", result.stderr)


class PluginRegistrationTests(unittest.TestCase):
    # The script reads tool names without the plugin prefix, so the manifest
    # matchers are the only place a wrong plugin name stops the guard running.
    def setUp(self):
        self.hooks = json.loads(PLUGIN_JSON.read_text(encoding="utf-8"))["hooks"]

    def entries(self, event):
        return [entry for entry in self.hooks.get(event, [])
                if any(PLUGIN_HOOK_ARG in h.get("args", []) for h in entry["hooks"])]

    def test_plugin_registers_the_guard_for_skills_and_the_audit(self):
        entries = self.entries("PreToolUse")
        self.assertEqual(len(entries), 1)
        matcher = re.compile(entries[0]["matcher"])
        for prefix in ("mcp__plugin_lawyer_data__", "mcp__remote-devices__plugin_lawyer_data__"):
            self.assertTrue(matcher.fullmatch(prefix + "rules__audit"), prefix)
            self.assertFalse(matcher.fullmatch(prefix + "practice_data__upsert_deadline"), prefix)
        self.assertTrue(matcher.fullmatch("Skill"))
        self.assertFalse(matcher.fullmatch("mcp__plugin_lawyer_data__rules__at"))
        self.assertFalse(matcher.fullmatch("mcp__plugin_other_data__rules__audit"))

    def test_plugin_registers_no_subagent_hooks_for_the_guard(self):
        for event in ("SubagentStart", "SubagentStop"):
            self.assertEqual(self.entries(event), [], event)


if __name__ == "__main__":
    unittest.main()
