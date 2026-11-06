#!/usr/bin/env python3
"""
fetch-grant-allowlist, ported from CoClerk's plugin-packager tests/test_fetch_grant_allowlist.py.

The data server's `sources__fetch` is granted only by the agents in FETCH_GRANT_AGENTS,
each present one under both its plain and its bridged tool name, and by at least one
agent. A listed agent that is absent passes. Each case builds a throwaway agents dir.

Run: python -m pytest -q scripts/tests/test_check_fetch_grants.py
"""

import os
import sys
import tempfile
import unittest

SCRIPTS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, SCRIPTS)
import check_plugin_agents  # noqa: E402

PLAIN = "mcp__plugin_lawyer_data__sources__fetch"
BRIDGED = "mcp__remote-devices__plugin_lawyer_data__sources__fetch"
OTHER = "mcp__plugin_lawyer_data__skill_source__read"
OTHER_BRIDGED = "mcp__remote-devices__plugin_lawyer_data__skill_source__read"
LOCALIZE = "localize-helper.md"
FETCHER = "law-getter.md"


def agent(tools):
    lines = ["---", "name: fixture", "description: Fixture agent.", "model: opus", "tools:"]
    lines += [f"  - {tool}" for tool in tools]
    lines += ["---", "", "# Fixture", ""]
    return "\n".join(lines)


class FetchGrantAllowlistTest(unittest.TestCase):
    def violations(self, agents, **kwargs):
        with tempfile.TemporaryDirectory() as tmp:
            for name, tools in agents.items():
                with open(os.path.join(tmp, name), "w", encoding="utf-8", newline="\n") as f:
                    f.write(agent(tools))
            return check_plugin_agents.fetch_grant_allowlist_violations(tmp, (PLAIN, BRIDGED), **kwargs)

    def test_the_grants_carry_the_name_of_the_plugin_that_ships_the_data_server(self):
        self.assertEqual(check_plugin_agents.fetch_grants("lawyer"), (PLAIN, BRIDGED))
        self.assertEqual(check_plugin_agents.fetch_grants("practice"),
                         ("mcp__plugin_practice_data__sources__fetch",
                          "mcp__remote-devices__plugin_practice_data__sources__fetch"))

    def test_a_plugin_with_no_listed_agent_needs_no_grant_but_may_not_add_one(self):
        self.assertEqual(self.violations({"other.md": [OTHER, OTHER_BRIDGED]}, expect_grant=False), [])
        hits = self.violations({"third.md": [PLAIN, BRIDGED]}, expect_grant=False)
        self.assertEqual(len(hits), 1)
        self.assertIn("third.md grants sources__fetch but is not in FETCH_GRANT_AGENTS", hits[0])

    def test_the_allowlist_names_the_two_agents(self):
        self.assertEqual(check_plugin_agents.FETCH_GRANT_AGENTS, (LOCALIZE, FETCHER))

    def test_both_listed_agents_granting_both_names_pass(self):
        self.assertEqual(self.violations({
            LOCALIZE: ["Read", PLAIN, BRIDGED],
            FETCHER: [PLAIN, BRIDGED],
            "other.md": [OTHER, OTHER_BRIDGED],
        }), [])

    def test_one_listed_agent_present_and_the_other_absent_passes(self):
        self.assertEqual(self.violations({LOCALIZE: [PLAIN, BRIDGED]}), [])
        self.assertEqual(self.violations({FETCHER: [PLAIN, BRIDGED]}), [])

    def test_a_third_agent_granting_either_name_fails_by_name(self):
        for tools in ([PLAIN], [BRIDGED], [PLAIN, BRIDGED]):
            with self.subTest(tools=tools):
                hits = self.violations({LOCALIZE: [PLAIN, BRIDGED], FETCHER: [PLAIN, BRIDGED], "third.md": tools})
                self.assertEqual(len(hits), 1)
                self.assertIn("third.md grants sources__fetch but is not in FETCH_GRANT_AGENTS", hits[0])

    def test_a_listed_agent_missing_a_twin_fails(self):
        self.assertEqual(self.violations({LOCALIZE: [PLAIN, BRIDGED], FETCHER: [PLAIN]}),
                         [f"{FETCHER} does not grant {BRIDGED}"])
        self.assertEqual(self.violations({LOCALIZE: [BRIDGED]}),
                         [f"{LOCALIZE} does not grant {PLAIN}"])

    def test_a_present_listed_agent_granting_neither_name_fails(self):
        self.assertEqual(self.violations({LOCALIZE: [PLAIN, BRIDGED], FETCHER: [OTHER, OTHER_BRIDGED]}),
                         [f"{FETCHER} does not grant {PLAIN}", f"{FETCHER} does not grant {BRIDGED}"])

    def test_the_old_litigation_names_do_not_satisfy_the_grant(self):
        old = "mcp__plugin_litigation_data__sources__fetch"
        old_bridged = "mcp__remote-devices__plugin_litigation_data__sources__fetch"
        self.assertEqual(self.violations({LOCALIZE: [old, old_bridged]}),
                         [f"{LOCALIZE} does not grant {PLAIN}", f"{LOCALIZE} does not grant {BRIDGED}"])

    def test_a_longer_tool_name_is_not_a_fetch_grant(self):
        hits = self.violations({"other.md": ["mcp__plugin_lawyer_data__sources__fetch_extra"]})
        self.assertEqual(hits, ["no agent grants sources__fetch"])

    def test_no_agent_granting_fetch_fails(self):
        hits = self.violations({"other.md": [OTHER, OTHER_BRIDGED]})
        self.assertEqual(hits, ["no agent grants sources__fetch"])


if __name__ == "__main__":
    unittest.main()
