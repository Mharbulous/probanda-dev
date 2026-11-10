#!/usr/bin/env python3
"""
Static contract for the marshal-facts agent and the /apply-to-facts skill that
dispatches it (spec Engineering/1. Design/2026-10-04_marshal-facts-agent-spec.md,
section 10, tests 5 and 6).

Run: python -m unittest discover -s source/skills/apply-to-facts/tests
"""

import re
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[4]
AGENT = REPO / "source" / "litigator" / "agents" / "marshal-facts.md"
SKILL = REPO / "source" / "skills" / "apply-to-facts" / "SKILL.md"
SCHEMA = REPO / "source" / "skills" / "matter-data" / "references" / "schema.sql"

EXPECTED_TOOLS = [
    "Read",
    "Glob",
    "Grep",
    "Skill",
    "mcp__plugin_lawyer_data__skill_source__read",
    "mcp__plugin_lawyer_data__matter_data__query",
    "mcp__remote-devices__plugin_lawyer_data__skill_source__read",
    "mcp__remote-devices__plugin_lawyer_data__matter_data__query",
]

SQL_KEYWORDS = re.compile(r"\b(SELECT|FROM|JOIN|WHERE|INSERT|UPDATE|DELETE)\b")
BANNED_LITERALS = [
    "import sqlite3",
    "sqlite3.connect",
    ".sqlite",
    "@query_",
    "matter_data__",
    "schema.sql",
    "queries.sql",
    "v_fact_status",
    "pending_reverification",
    "privilege_status",
    "verified =",
]


def _read(path):
    return path.read_text(encoding="utf-8").replace("\r\n", "\n")


def _tools(text):
    match = re.match(r"---\n(.*?)\n---\n", text, re.DOTALL)
    if not match:
        return []
    block = re.search(r"^tools:\n((?:  - .*\n?)*)", match.group(1), re.MULTILINE)
    if not block:
        return []
    return [line[len("  - "):].strip() for line in block.group(1).splitlines()]


class MarshalFactsContractTests(unittest.TestCase):
    def test_agent_grant_is_exactly_the_read_only_set(self):
        tools = _tools(_read(AGENT))
        self.assertEqual(len(tools), len(EXPECTED_TOOLS), tools)
        self.assertEqual(set(tools), set(EXPECTED_TOOLS))

    def test_skill_holds_no_database_particulars(self):
        text = _read(SKILL)
        self.assertEqual(SQL_KEYWORDS.findall(text), [])
        for literal in BANNED_LITERALS:
            with self.subTest(literal=literal):
                self.assertNotIn(literal, text)
        tables = re.findall(r"CREATE TABLE (\w+)", _read(SCHEMA))
        self.assertTrue(tables, "no tables parsed from schema.sql")
        for table in tables:
            with self.subTest(table=table):
                self.assertNotIn(f"`{table}`", text)

    def test_dispatch_follows_the_incomplete_memo_stop(self):
        # The body starts at the H1, after the Contents table that names every step.
        text = _read(SKILL)
        body = text[text.find("\n# "):]
        gate = body.find("An `INCOMPLETE` memo is the answer.")
        dispatch = body.find("marshal-facts")
        self.assertNotEqual(gate, -1, "incomplete-memo sentence missing")
        self.assertNotEqual(dispatch, -1, "marshal-facts not named")
        self.assertGreater(dispatch, gate)
        self.assertIn("An `INCOMPLETE` memo at step 2 dispatches nothing.", body)
        self.assertNotIn("closed gate", body)


if __name__ == "__main__":
    unittest.main()
