#!/usr/bin/env python3
"""
agent-bridged-grants, ported from CoClerk's plugin-packager tests/test_agent_bridged_grants.py.

A Cowork Project session reaches plugin MCP servers through the desktop bridge, which
renames every tool `mcp__remote-devices__<name>`. A subagent `tools:` entry that
matches no live tool is dropped silently, so every `mcp__plugin_` grant in a plugin
agent must also be declared under its bridged name, and the bridged grant must mirror
the plain grant exactly: no server-level `mcp__remote-devices` entry and no wildcard.

CoClerk's version was a real-tree test only; it is kept below, and each failure mode
is also planted in a throwaway agents dir.

Run: python -m pytest -q scripts/tests/test_check_agent_bridged_grants.py
"""

import importlib.util
import os
import tempfile
import unittest

SCRIPTS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_spec = importlib.util.spec_from_file_location("check_plugin", os.path.join(SCRIPTS, "check_plugin.py"))
check_plugin = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(check_plugin)

PLAIN = "mcp__plugin_probanda_data__case_data__query"
BRIDGED = "mcp__remote-devices__plugin_probanda_data__case_data__query"


def agent(tools):
    lines = ["---", "name: fixture", "description: Fixture agent.", "tools:"]
    lines += [f"  - {tool}" for tool in tools]
    return "\n".join(lines + ["---", "", "# Fixture", ""])


class AgentBridgedGrantViolationsTest(unittest.TestCase):
    def violations(self, agents):
        with tempfile.TemporaryDirectory() as tmp:
            for name, tools in agents.items():
                with open(os.path.join(tmp, name), "w", encoding="utf-8", newline="\n") as f:
                    f.write(agent(tools))
            return check_plugin.agent_bridged_grant_violations(tmp)

    def test_mirrored_grants_pass(self):
        self.assertEqual(self.violations({"a.md": ["Read", PLAIN, BRIDGED], "b.md": ["Read"]}), [])

    def test_a_plain_grant_without_its_bridged_twin_fails(self):
        self.assertEqual(self.violations({"a.md": [PLAIN]}), [f"a.md lacks the bridged twin {BRIDGED}"])

    def test_a_bridged_grant_without_its_plain_twin_fails(self):
        self.assertEqual(self.violations({"a.md": [PLAIN, BRIDGED, "mcp__remote-devices__plugin_probanda_data__x"]}),
                         ["a.md grants mcp__remote-devices__plugin_probanda_data__x with no plain twin"])

    def test_the_whole_bridge_server_fails(self):
        self.assertIn("a.md grants the whole bridge server",
                      self.violations({"a.md": [PLAIN, BRIDGED, "mcp__remote-devices"]}))

    def test_a_wildcard_fails(self):
        self.assertIn("a.md grants a wildcard tool",
                      self.violations({"a.md": [PLAIN, BRIDGED, "mcp__remote-devices__plugin_probanda_data__*"]}))

    def test_no_agent_declaring_a_plugin_tool_fails(self):
        self.assertEqual(self.violations({"a.md": ["Read"]}),
                         ["no agent declares a plugin MCP tool; the parser is likely broken"])

    def test_no_agent_files_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(check_plugin.agent_bridged_grant_violations(tmp), ["no plugin agent files found"])


class RealAgentsTest(unittest.TestCase):
    def test_every_plugin_mcp_grant_has_its_bridged_twin_and_nothing_more(self):
        for plugin in check_plugin.built_plugins(check_plugin.REPO).values():
            if check_plugin.agent_names(check_plugin.REPO, plugin):
                with self.subTest(plugin=plugin["name"]):
                    agents_dir = check_plugin.source_path(check_plugin.REPO, plugin, "agents")
                    self.assertEqual(check_plugin.agent_bridged_grant_violations(agents_dir), [])


if __name__ == "__main__":
    unittest.main()
