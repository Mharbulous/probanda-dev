#!/usr/bin/env python3
"""
write-up-agent-tools (check_plugin_agents.py): the technical-writer and spec-backstop agents read
only Probanda's shipped files (docs/Plans/2026-10-25_suggestion-design.md, decision 18). Each case
builds a throwaway agents dir; planting a file, shell, web, mail or client-data tool in either
agent's `tools` fails the check. The repo's own agents pass.

Run: python -m pytest -q scripts/tests/test_check_write_up_agents.py
"""

import os
import sys
import tempfile
import unittest

SCRIPTS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, SCRIPTS)
import check_plugin_agents  # noqa: E402
import plugin_layout  # noqa: E402

READS = check_plugin_agents.write_up_tool_names("lawyer", ("skill_source__read", "skill_source__list"))
PLANTED = (
    "Read",
    "Glob",
    "Grep",
    "Bash",
    "WebFetch",
    "WebSearch",
    "mcp__plugin_lawyer_data__matter_data__query",
    "mcp__plugin_lawyer_data__practice_data__matter_lookup",
    "mcp__plugin_lawyer_contacts-calendars-email__mail__get_email",
    "mcp__remote-devices__plugin_lawyer_data__drafting_data__query",
    "mcp__plugin_lawyer_data__suggestion_card__check",
)


def agent(tools, extra=()):
    lines = ["---", "name: fixture", "description: Fixture agent.", "model: opus", *extra]
    if tools is not None:
        lines.append("tools:")
        lines += [f"  - {tool}" for tool in tools]
    lines += ["---", "", "# Fixture", ""]
    return "\n".join(lines)


class WriteUpAgentToolsTest(unittest.TestCase):
    def violations(self, agents):
        with tempfile.TemporaryDirectory() as tmp:
            for name, text in agents.items():
                with open(os.path.join(tmp, f"{name}.md"), "w", encoding="utf-8", newline="\n") as f:
                    f.write(text)
            return check_plugin_agents.write_up_agent_violations(tmp, "lawyer")

    def both(self, writer=READS, backstop=READS, **kwargs):
        return {"technical-writer": agent(writer, **kwargs), "spec-backstop": agent(backstop, **kwargs)}

    def test_the_shipped_file_reads_alone_pass(self):
        self.assertEqual(self.violations(self.both()), [])

    def test_the_read_without_the_listing_passes(self):
        read_only = check_plugin_agents.write_up_tool_names("lawyer", ("skill_source__read",))
        self.assertEqual(self.violations(self.both(writer=read_only, backstop=read_only)), [])

    def test_a_planted_tool_in_either_agent_fails(self):
        for tool in PLANTED:
            for which in ("writer", "backstop"):
                with self.subTest(tool=tool, agent=which):
                    hits = self.violations(self.both(**{which: [*READS, tool]}))
                    self.assertEqual(len(hits), 1, hits)
                    self.assertIn(f"grants {tool}", hits[0])

    def test_a_missing_tools_list_fails_because_it_would_grant_every_tool(self):
        hits = self.violations(self.both(writer=None))
        self.assertEqual(hits, ["technical-writer.md has no tools list, so it would be given every tool"])

    def test_an_inline_tools_value_fails(self):
        text = agent(None, extra=("tools: Read, Bash",))
        hits = self.violations({"technical-writer": text, "spec-backstop": agent(READS)})
        self.assertEqual(len(hits), 1)
        self.assertIn("cannot read", hits[0])

    def test_own_mcp_servers_fail(self):
        hits = self.violations(self.both(backstop=READS, extra=("mcpServers:", "  - files")))
        self.assertIn("spec-backstop.md declares its own MCP servers", hits)

    def test_a_missing_agent_or_a_missing_read_fails(self):
        self.assertEqual(self.violations({"technical-writer": agent(READS)}), ["spec-backstop.md is missing"])
        hits = self.violations(self.both(writer=[READS[2], READS[3]]))
        self.assertEqual(hits, [f"technical-writer.md does not grant {READS[0]}", f"technical-writer.md does not grant {READS[1]}"])

    def test_another_plugins_read_does_not_count(self):
        other = [t.replace("plugin_lawyer_", "plugin_researcher_") for t in READS]
        hits = self.violations(self.both(writer=other))
        self.assertTrue(all("technical-writer.md" in h for h in hits))
        self.assertEqual(len(hits), 6)

    def test_the_repos_own_agents_pass(self):
        repo = plugin_layout.REPO
        lawyer = plugin_layout.plugins(repo)["lawyer"]
        ok, detail = check_plugin_agents.check_write_up_agent_tools(repo, lawyer)
        self.assertTrue(ok, detail)


if __name__ == "__main__":
    unittest.main()
