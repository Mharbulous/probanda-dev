import json
import re
import subprocess
import sys
import unittest
from pathlib import Path


SKILL_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = SKILL_ROOT.parents[2]
HOOK = SKILL_ROOT / "hooks" / "block-main-session-canlii.py"
PLUGIN_JSON = REPO_ROOT / "source" / "research" / "plugin.json"
PLUGIN_HOOK_ARG = "${CLAUDE_PLUGIN_ROOT}/skills/legal-research/hooks/block-main-session-canlii.py"

LOCAL = "mcp__plugin_research_canlii__"
BRIDGED = "mcp__remote-devices__plugin_research_canlii__"


def run_hook(stdin_text):
    return subprocess.run(
        [sys.executable, str(HOOK)],
        input=stdin_text, capture_output=True, text=True, encoding="utf-8",
    )


def call(tool_name, **extra):
    return run_hook(json.dumps({"tool_name": tool_name, "tool_input": {}, **extra}))


class MainSessionCanliiGuardTests(unittest.TestCase):
    def assertBlocked(self, result):
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertIn("A closed gate is never a licence", result.stderr)
        self.assertIn("/legal-research", result.stderr)

    def test_main_session_research_call_is_blocked(self):
        for tool in ("search", "get_case_citator", "get_legislation_databases", "browse_legislation"):
            with self.subTest(tool=tool):
                self.assertBlocked(call(LOCAL + tool))

    def test_device_bridged_research_call_is_blocked(self):
        self.assertBlocked(call(BRIDGED + "search"))

    def test_plugin_agent_citator_call_is_allowed(self):
        # Inside an agent CanLII is note-up only (test_westlaw_first.py pins the
        # in-agent block).
        for agent_type in ("research:research-agent", "research:research-paralegal"):
            with self.subTest(agent_type=agent_type):
                result = call(LOCAL + "get_case_citator", agent_id="a1b2", agent_type=agent_type)
                self.assertEqual(result.returncode, 0, result.stderr)

    def test_raw_legislation_tools_are_blocked_in_every_agent(self):
        # The paralegal's legislation-currency mode retired into legislation_currency
        # (2026-10-06), so no agent keeps the raw legislation tools.
        for agent_type in ("research:research-paralegal", "research:research-agent"):
            for tool in ("get_legislation_databases", "browse_legislation",
                         "get_legislation_regulation_metadata"):
                with self.subTest(agent_type=agent_type, tool=tool):
                    result = call(LOCAL + tool, agent_id="a1b2", agent_type=agent_type)
                    self.assertEqual(result.returncode, 2, result.stderr)

    def test_legislation_currency_runs_anywhere(self):
        # Leg 1 of shared/statute-currency.md as one call: metadata, no statement of law.
        for prefix in (LOCAL, BRIDGED):
            for extra in ({}, {"agent_id": "a1b2", "agent_type": "general-purpose"},
                          {"agent_id": "a1b2", "agent_type": "research:research-agent"}):
                with self.subTest(prefix=prefix, extra=extra):
                    self.assertEqual(call(prefix + "legislation_currency", **extra).returncode, 0)

    def test_main_session_block_names_the_currency_tool(self):
        result = call(LOCAL + "browse_legislation")
        self.assertIn("legislation_currency", result.stderr)

    def test_non_plugin_subagent_research_call_is_blocked(self):
        # An agent of another plugin, or of the retired single plugin, is not a research agent.
        for agent_type in ("general-purpose", "Explore", "research-paralegal", None,
                           "practice:docket-clerk", "probanda" + ":research-agent"):
            with self.subTest(agent_type=agent_type):
                self.assertBlocked(call(LOCAL + "search", agent_id="a1b2", agent_type=agent_type))

    def test_credential_setup_tools_are_allowed_in_main_session(self):
        for tool in ("configure_status", "configure_credential"):
            for prefix in (LOCAL, BRIDGED):
                with self.subTest(tool=prefix + tool):
                    self.assertEqual(call(prefix + tool).returncode, 0)

    def test_other_tools_are_allowed(self):
        for tool in ("mcp__plugin_practice_data__case_data__query", "Read", "WebSearch"):
            with self.subTest(tool=tool):
                self.assertEqual(call(tool).returncode, 0)

    def test_malformed_input_fails_open_loudly(self):
        result = run_hook("not json")
        self.assertEqual(result.returncode, 0)
        self.assertIn("hook error", result.stderr)


class PluginRegistrationTests(unittest.TestCase):
    def test_plugin_registers_the_guard_for_both_tool_name_forms(self):
        manifest = json.loads(PLUGIN_JSON.read_text(encoding="utf-8"))
        entries = [
            entry for entry in manifest["hooks"]["PreToolUse"]
            if any(PLUGIN_HOOK_ARG in h.get("args", []) for h in entry["hooks"])
        ]
        self.assertEqual(len(entries), 1)
        matcher = re.compile(entries[0]["matcher"])
        for name in (LOCAL + "search", BRIDGED + "search"):
            self.assertTrue(matcher.fullmatch(name), name)
        self.assertFalse(matcher.fullmatch("mcp__plugin_practice_data__case_data__query"))


if __name__ == "__main__":
    unittest.main()
