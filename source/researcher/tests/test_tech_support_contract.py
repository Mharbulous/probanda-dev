"""Pins that tech-support writes nothing to the troubleshooting store and preloads its know-how.

The store has no delete, so an entry going to it is one-way, and the one-way gate refuses every
call from a subagent because it cannot see a subagent's transcript. So tech-support only
prepares an entry and the main session makes the store call behind the gate (plan
docs/Plans/2026-10-28_guardrail-gaps.md, gap 2). Its know-how lives in the
probanda-troubleshooting skill, which the practitioner flow reads too (CLAUDE.md, "Skills and agents").
"""

from pathlib import Path
import unittest

REPO_ROOT = Path(__file__).resolve().parents[3]
AGENT = REPO_ROOT / "source" / "researcher" / "agents" / "tech-support.md"


def frontmatter_list(text, field):
    head = text.split("---")[1]
    items, inside = [], False
    for line in head.splitlines():
        if not line.startswith(" "):
            inside = line.startswith(f"{field}:")
        elif inside and line.strip().startswith("- "):
            items.append(line.strip()[2:])
    return items


class TechSupportContract(unittest.TestCase):
    def setUp(self):
        self.text = AGENT.read_text(encoding="utf-8")

    def test_no_store_write_tool_is_granted(self):
        tools = frontmatter_list(self.text, "tools")
        self.assertIn("mcp__plugin_researcher_commons__troubleshoot__search", tools)
        self.assertEqual([t for t in tools if t.endswith(("troubleshoot__record", "troubleshoot__confirm_fix"))], [])

    def test_preloads_the_troubleshooting_skill(self):
        self.assertEqual(frontmatter_list(self.text, "skills"), ["researcher:probanda-troubleshooting"])

    def test_reads_its_mode_helper_files_from_the_skill(self):
        tools = frontmatter_list(self.text, "tools")
        self.assertIn("mcp__plugin_lawyer_data__skill_source__read", tools)
        self.assertIn("mcp__remote-devices__plugin_lawyer_data__skill_source__read", tools)
        for mode in ("diagnose", "screen"):
            name = f"probanda-troubleshooting/references/{mode}.md"
            self.assertIn(name, self.text)
            self.assertTrue((REPO_ROOT / "source" / "skills" / name).is_file(), name)


if __name__ == "__main__":
    unittest.main()
