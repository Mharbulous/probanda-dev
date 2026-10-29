"""Pins the memo-reviewer loop: the audit opens Step 4 with the scope test and ends an incomplete
memo's Conclusion with the open-issues paragraph; memo-reviewer is a read-only Opus agent that
returns strict JSON and ships in researcher; and the gate reviews every memo after the held-job
rule and before it persists, sends back required research and working-matter identifiers, never
edits the memo, and ends with the out-of-scope questions.

Run: python .claude/skills/legal-research/tests/test_memo_reviewer.py
"""

import json
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[4]
SKILLS = REPO / ".claude" / "skills"
AGENT = REPO / "source" / "researcher" / "agents" / "memo-reviewer.md"


def read(*parts):
    return SKILLS.joinpath(*parts).read_text(encoding="utf-8")


def flat(text):
    return " ".join(text.split())


def between(text, start, end):
    begin = text.index(start)
    return text[begin:text.index(end, begin)]


class ScopeTestTest(unittest.TestCase):
    def test_step_four_opens_with_the_scope_test(self):
        step_four = flat(between(read("shared", "legal-audit-protocol.md"), "### Step 4", "### Step 5"))
        self.assertTrue(step_four.startswith("### Step 4 — Disclosure gate **The scope test.** Research is required "
                                             "only if the Issue, as framed, cannot be answered without it."))
        self.assertIn("Never call it required and never say more research is needed on it.", step_four)
        self.assertIn("A spawn prompt's `Review:` line is memo-reviewer's verdict on your last memo", step_four)

    def test_no_closed_gate_and_no_sub_issues_left_in_shared(self):
        for path in (SKILLS / "shared").rglob("*.md"):
            text = path.read_text(encoding="utf-8")
            self.assertNotIn("More research is needed before I can give", text, path.name)
            self.assertNotIn("### Sub-issue", text, path.name)


class AgentContractTest(unittest.TestCase):
    def setUp(self):
        self.agent = AGENT.read_text(encoding="utf-8")
        self.front = self.agent.split("---")[1]

    def test_frontmatter(self):
        self.assertIn("name: memo-reviewer", self.front)
        self.assertIn("model: opus", self.front)
        self.assertIn("tools:\n  - Read\n  - mcp__plugin_lawyer_data__skill_source__read\n"
                      "  - mcp__remote-devices__plugin_lawyer_data__skill_source__read\n", self.front)
        self.assertIn("skills:\n  - researcher:legal-research", self.front)

    def test_body_is_procedure_and_contract(self):
        for key in ('"verdict"', '"required"', '"out_of_scope"', '"identifiers"'):
            self.assertIn(key, self.agent)
        self.assertIn("`shared/legal-audit-protocol.md`", self.agent)
        self.assertIn("`shared/research-memo-template.md`", self.agent)
        self.assertIn("halt and return `rules unavailable: <the error>`", self.agent)
        self.assertIn("You state no law.", self.agent)
        self.assertIn("You write nothing.", self.agent)
        self.assertNotIn("canlii", self.agent.lower())

    def test_ships_in_researcher(self):
        assignment = json.loads((REPO / "source" / "assignment.json").read_text(encoding="utf-8"))
        self.assertIn("memo-reviewer", assignment["plugins"]["researcher"]["agents"])


class GateLoopTest(unittest.TestCase):
    def setUp(self):
        self.text = read("shared", "legal-research.md")
        self.rule = flat(between(self.text, "**memo-reviewer checks every memo before it is saved.**",
                                 "Persist in this order."))

    def test_loop_sits_after_the_held_job_rule_and_before_persisting(self):
        held = self.text.index("**On a held job, an open tier is not an answer.**")
        review = self.text.index("**memo-reviewer checks every memo before it is saved.**")
        self.assertLess(held, review)
        self.assertLess(review, self.text.index("Persist in this order."))

    def test_send_backs_and_the_bound(self):
        self.assertIn("Spawn `researcher:memo-reviewer`", self.rule)
        self.assertIn("re-invoke the agent with `Re-invocation: yes` and `Review:` the reviewer's JSON", self.rule)
        self.assertIn("Each tier still runs at most once per issue.", self.rule)
        self.assertIn("`send_back` with `identifiers`: re-invoke the agent with `Review:` to rewrite the memo without them.",
                      self.rule)
        self.assertIn("its `Confidence:` reading `INCOMPLETE: <the research named>`", self.rule)

    def test_approval_drops_out_of_scope_and_never_edits(self):
        self.assertIn("re-invoke the agent once with `Review:` to drop them", self.rule)
        self.assertIn("Never edit the memo yourself: it is saved verbatim.", self.rule)
        self.assertIn("End the report with those questions as a numbered list, then one line inviting the "
                      "practitioner to say which, if any, they want a further memo on.", self.rule)
        self.assertIn("- each memo-reviewer `out_of_scope` question, one thread each.", self.text)

    def test_re_invocation_is_yes_on_every_re_invocation(self):
        self.assertIn("`Re-invocation` is `no` on the first spawn and `yes` on every re-invocation below.", self.text)
        self.assertIn("Review: <memo-reviewer's last JSON, verbatim> / none\n", self.text)

    def test_front_door_and_board_point_to_the_loop(self):
        self.assertIn("`researcher:memo-reviewer`", read("legal-research", "SKILL.md"))
        self.assertIn("Once memo-reviewer's loop on it has ended",
                      read("legal-research", "references", "research-board.md"))


if __name__ == "__main__":
    unittest.main()
