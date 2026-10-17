import json
import subprocess
import sys
import unittest
from pathlib import Path


SKILL_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = SKILL_ROOT.parents[2]
HOOK = SKILL_ROOT / "hooks" / "block-subagent-legal-research.py"
SKILL_MD = SKILL_ROOT / "SKILL.md"
PLUGIN_JSON = REPO_ROOT / "source" / "researcher" / "plugin.json"
PLUGIN_HOOK_ARG = "${CLAUDE_PLUGIN_ROOT}/skills/legal-research/hooks/block-subagent-legal-research.py"


def run_hook(stdin_text):
    return subprocess.run(
        [sys.executable, str(HOOK)],
        input=stdin_text, capture_output=True, text=True, encoding="utf-8",
    )


def skill_call(skill, args=None, **extra):
    tool_input = {"skill": skill}
    if args is not None:
        tool_input["args"] = args
    return run_hook(json.dumps({"tool_name": "Skill", "tool_input": tool_input, **extra}))


class SubagentGateGuardTests(unittest.TestCase):
    def assertBlocked(self, result):
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertIn("runs only from the main session", result.stderr)
        self.assertIn("Nothing was dispatched", result.stderr)

    def test_main_session_gate_is_allowed(self):
        for skill in ("legal-research", "researcher:legal-research", "/legal-research"):
            with self.subTest(skill=skill):
                self.assertEqual(skill_call(skill, "Is the claim out of time?").returncode, 0)

    def test_subagent_gate_is_blocked(self):
        for skill in ("legal-research", "researcher:legal-research"):
            for agent_type in ("general-purpose", "researcher:research-agent", None):
                with self.subTest(skill=skill, agent_type=agent_type):
                    self.assertBlocked(skill_call(
                        skill, "note up the Act", agent_id="a1b2", agent_type=agent_type))

    def test_subagent_query_drafting_is_allowed(self):
        result = skill_call("legal-research", "westlaw-query-optimizer draft a query",
                            agent_id="a1b2", agent_type="general-purpose")
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_other_skills_and_tools_are_allowed(self):
        self.assertEqual(skill_call("draft", agent_id="a1b2").returncode, 0)
        other_tool = run_hook(json.dumps({"tool_name": "Read", "tool_input": {}, "agent_id": "a1b2"}))
        self.assertEqual(other_tool.returncode, 0)

    def test_malformed_input_fails_open_loudly(self):
        result = run_hook("not json")
        self.assertEqual(result.returncode, 0)
        self.assertIn("hook error (allowing call)", result.stderr)

    def test_hook_is_registered_on_the_skill_tool(self):
        manifest = json.loads(PLUGIN_JSON.read_text(encoding="utf-8"))
        entries = [entry for entry in manifest["hooks"]["PreToolUse"]
                   if any(PLUGIN_HOOK_ARG in hook.get("args", []) for hook in entry["hooks"])]
        self.assertEqual(len(entries), 1)
        self.assertEqual(entries[0]["matcher"], "Skill")

    def test_skill_text_carries_the_main_session_backstop(self):
        text = SKILL_MD.read_text(encoding="utf-8")
        gate = text.index("## The gate")
        backstop = text.index("**Main session only.**")
        first_step = text.index("1. Read `shared/legal-research.md`")
        self.assertLess(gate, backstop)
        self.assertLess(backstop, first_step)
        self.assertIn("If the Agent tool is not in your tool\nlist", text)


if __name__ == "__main__":
    unittest.main()
