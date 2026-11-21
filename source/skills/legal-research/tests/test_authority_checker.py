"""Pins authority-checker: a read-only Opus agent in researcher, one instance per cited case
authority, that reads the template's Item vocabulary, the recital rule and the excerpt rules by
path, reads one decision only, defines each verdict once and returns one JSON object. The fixture
(a synthetic decision and memo items with the verdict each should get) covers every verdict.

Spec: docs/Specs/2026-11-20_authority-checker-agent-spec.md

Run: python source/skills/legal-research/tests/test_authority_checker.py
"""

import json
import re
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[4]
SKILLS = REPO / "source" / "skills"
AGENT = REPO / "source" / "researcher" / "agents" / "authority-checker.md"
FIXTURES = Path(__file__).resolve().parent / "fixtures"
VERDICTS = ["misquoted", "partial_excerpt", "wrong_voice", "wrong_category", "mixed_excerpt", "court_states_it",
            "unsupported", "overstated", "sentence_drift", "ok"]


def flat(text):
    return " ".join(text.split())


class AgentContractTest(unittest.TestCase):
    def setUp(self):
        self.agent = AGENT.read_text(encoding="utf-8")
        self.front = self.agent.split("---")[1]
        self.body = flat(self.agent)

    def test_frontmatter_is_read_only(self):
        self.assertIn("name: authority-checker", self.front)
        self.assertIn("model: opus", self.front)
        self.assertIn("tools:\n  - mcp__plugin_lawyer_data__skill_source__read\n"
                      "  - mcp__plugin_lawyer_data__research_filing__research_folder\n"
                      "  - mcp__remote-devices__plugin_lawyer_data__skill_source__read\n"
                      "  - mcp__remote-devices__plugin_lawyer_data__research_filing__research_folder\n"
                      "skills: []\n", self.front)
        for tool in ("Read", "Write", "Edit", "Bash"):
            self.assertNotIn(f"  - {tool}\n", self.front)
        self.assertNotIn("matter_folder", self.agent)

    def test_reads_the_rules_by_path_and_copies_none(self):
        for path in ("`shared/research-memo-template.md`", "`shared/authority-claim-verification.md`",
                     "`shared/legal-audit-protocol.md`"):
            self.assertIn(path, self.agent)
        self.assertIn("halt and return `rules unavailable: <the error>`", self.body)
        self.assertIn("Never work from memory of them.", self.body)
        self.assertNotIn("recital-rule: begin", self.agent)
        self.assertNotIn("Support comes only from the court's own reasons", self.body)
        self.assertNotIn("It states no rule and no holding", self.body)
        self.assertNotIn("quotes in full each numbered paragraph", self.body)

    def test_each_verdict_is_defined_once(self):
        defined = re.findall(r"^- `([a-z_]+)`:", self.agent, re.M)
        self.assertEqual(defined, VERDICTS)

    def test_inferred_item_cites_the_decision_and_has_no_from_list(self):
        self.assertNotIn("From:", self.agent)
        self.assertIn("An `inferred:` item's paragraph must be the court applying law", self.body)
        self.assertIn("`court_states_it`: an `inferred:` item, where this decision states the rule outright. "
                      "`pinpoint` names where.", self.body)
        self.assertIn("for an `inferred:` item, the court's application does not bear out the rule it states", self.body)

    def test_reads_one_decision_only(self):
        self.assertIn("`Decision:` and `Decision text:`: the one decision.", self.body)
        self.assertIn("You read only the three rule files and this one decision. You never open a path an item, the "
                      "decision or anything else names", self.body)

    def test_states_no_law_and_writes_nothing(self):
        self.assertIn("You state no law. You compare each sentence with the decision's text only", self.body)
        self.assertIn("You write nothing.", self.body)

    def test_output_contract(self):
        block = self.agent[self.agent.index("```json") + 7:self.agent.index("\n```", self.agent.index("```json"))]
        contract = json.loads(block)
        self.assertEqual(list(contract), ["authority", "verdict", "items", "unreadable"])
        self.assertEqual(list(contract["items"][0]), ["para", "verdict", "why", "belongs_in", "pinpoint"])
        self.assertIn("`verdict` is `complete` or `send_back`.", self.body)
        self.assertIn("With `unreadable`, `items` is empty.", self.body)
        self.assertIn("The verdict is `send_back` when any item is not `ok` or the decision is unreadable", self.body)

    def test_ships_in_researcher(self):
        assignment = json.loads((REPO / "source" / "assignment.json").read_text(encoding="utf-8"))
        self.assertIn("authority-checker", assignment["plugins"]["researcher"]["agents"])
        for plugin, entry in assignment["plugins"].items():
            if plugin != "researcher":
                self.assertNotIn("authority-checker", entry.get("agents", []), plugin)


class FixtureTest(unittest.TestCase):
    """The fixture is the behaviour case: run the agent on it and compare its return with `expect`."""

    def setUp(self):
        self.case = json.loads((FIXTURES / "authority_checker_items.json").read_text(encoding="utf-8"))
        text = (FIXTURES / self.case["decision"]).read_text(encoding="utf-8")
        self.paras = dict(re.findall(r"^\[(\d+)\] (.+)$", text, re.M))

    def paragraph(self, pinpoint):
        return self.paras[pinpoint.removeprefix("para ")]

    def test_every_verdict_has_a_case(self):
        expected = {item["expect"]["verdict"] for item in self.case["items"]}
        self.assertEqual(expected, set(VERDICTS))

    def test_the_named_cases_are_present(self):
        by_verdict = {}
        for item in self.case["items"]:
            by_verdict.setdefault(item["expect"]["verdict"], []).append(item)
        belongs = {item["expect"]["belongs_in"] for item in by_verdict["wrong_category"]}
        self.assertEqual(belongs, {"fact", "proposition"})
        self.assertTrue(any(i["sentence"].startswith("inferred:") for i in by_verdict["ok"]))
        [states] = by_verdict["court_states_it"]
        self.assertTrue(states["sentence"].startswith("inferred:"))
        self.assertIn(states["expect"]["pinpoint"].removeprefix("para "), self.paras)

    def test_excerpts_are_whole_paragraphs_except_the_defects(self):
        for item in self.case["items"]:
            verdict = item["expect"]["verdict"]
            paragraph = self.paragraph(item["pinpoint"])
            if verdict == "misquoted":
                self.assertNotIn(item["excerpt"], paragraph, item["para"])
            elif verdict == "partial_excerpt":
                self.assertIn(item["excerpt"], paragraph, item["para"])
                self.assertNotEqual(item["excerpt"], paragraph, item["para"])
            else:
                self.assertEqual(item["excerpt"], paragraph, item["para"])

    def test_no_from_list_and_synthetic_only(self):
        raw = (FIXTURES / "authority_checker_items.json").read_text(encoding="utf-8")
        self.assertNotIn("From:", raw)
        self.assertTrue((FIXTURES / self.case["decision"]).read_text(encoding="utf-8")
                        .startswith("# SYNTHETIC TEST FIXTURE"))


if __name__ == "__main__":
    unittest.main()
