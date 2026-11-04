"""Pins a research job's memo to the job's own question: the spawn prompt carries the job's
intent verbatim, checked before any dispatch, a question holding more than one is proposed for
rewording, and the memo has one Issue and no sub-issues.

Specs: docs/Specs/2026-10-21_research-job-memo-restates-job-question-spec.md,
docs/Specs/2026-10-31_job-question-from-intent-spec.md

Run: python -m pytest .claude/skills/legal-research/tests/test_job_question_memo.py -q
"""

import unittest
from pathlib import Path

SKILLS = Path(__file__).resolve().parents[2]


def read(*parts):
    return SKILLS.joinpath(*parts).read_text(encoding="utf-8")


def flat(text):
    return " ".join(text.split())


class JobQuestionMemoTest(unittest.TestCase):
    def test_spawn_template_carries_the_job_question(self):
        gate = flat(read("shared", "legal-research.md"))
        self.assertIn('Job question: "<the job\'s intent, verbatim>" while you hold the job\'s lock / none', gate)
        self.assertIn('Before any dispatch, check `Job question:` by "A research question holds one question"', gate)
        board = flat(read("legal-research", "references", "research-board.md"))
        self.assertIn("`Job question:` is its intent", board)
        self.assertNotIn("`Job question:` with the job's title", gate)
        self.assertNotIn("is its title", board)

    def test_a_question_holding_several_is_reworded(self):
        gate = flat(read("shared", "legal-research.md"))
        rule = gate[gate.index("**A research question holds one question.**"):gate.index("**A new question is")]
        self.assertIn("rules A to D", rule)
        self.assertIn("(`/drafting-data` §3m, \"Rewording a held job\")", rule)
        self.assertNotIn("## `mode: plan`", read("shared", "legal-audit-scoped.md"))
        self.assertIn("A return with a rewording proposal and no memo saves nothing: put that proposal to "
                      "the practitioner as \"A research question holds one question\" says.", gate)

    def test_memo_has_one_issue_and_rules_a_to_d(self):
        template = read("shared", "research-memo-template.md")
        self.assertIn("the Issue is that question verbatim if it meets rules A to D. If not, return no memo "
                      "but one rewording proposal", flat(template))
        self.assertNotIn("The Issue is the spawn prompt's Job question", flat(template))
        self.assertIn("One memo has one `## Issue` and no sub-issues.", flat(template))
        for rule in ("**A.** holds one question;", "**B.** makes sense on its own;",
                     "**C.** holds at most one list, and that list conjunctive, joined by \"and\".",
                     "**D.** names nothing that identifies the client, the parties, the people involved or the proceeding."):
            self.assertIn(rule, flat(template))
        self.assertNotIn("Sub-issue <n>", template)
        self.assertNotIn("**Several issues.**", template)
        self.assertNotIn("No other issue or topic heading", template)
        self.assertNotIn("Confidence:", template)
        self.assertIn("## Sources", template)


if __name__ == "__main__":
    unittest.main()
