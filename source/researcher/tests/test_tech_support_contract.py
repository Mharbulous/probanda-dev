"""Pins that the troubleshooter writes nothing to the troubleshooting store.

The store has no delete, so an entry going to it is one-way, and the one-way gate refuses every
call from a subagent because it cannot see a subagent's transcript. So the troubleshooter only
prepares an entry and the main session makes the store call behind the gate (plan
docs/Plans/2026-10-28_guardrail-gaps.md, gap 2).
"""

from pathlib import Path
import unittest

REPO_ROOT = Path(__file__).resolve().parents[3]
AGENT = REPO_ROOT / "source" / "researcher" / "agents" / "troubleshooter.md"


def frontmatter_tools(text):
    head = text.split("---")[1]
    return [line.strip()[2:] for line in head.splitlines() if line.strip().startswith("- ")]


class TroubleshooterWritesNothing(unittest.TestCase):
    def test_no_store_write_tool_is_granted(self):
        tools = frontmatter_tools(AGENT.read_text(encoding="utf-8"))
        self.assertIn("mcp__plugin_researcher_commons__troubleshoot__search", tools)
        self.assertEqual([t for t in tools if t.endswith(("troubleshoot__record", "troubleshoot__confirm_fix"))], [])


if __name__ == "__main__":
    unittest.main()
