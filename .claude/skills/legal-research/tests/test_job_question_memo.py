"""Pins a research job's memo to the job's own question: the spawn prompt carries the job's
title verbatim, plan mode splits it only at its own question marks and crossed lists and adds no
issue, a held job holding more than one question is proposed for splitting, and the memo has one
Issue holding the title verbatim and no sub-issues.

Spec: docs/Specs/2026-10-21_research-job-memo-restates-job-question-spec.md

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
        self.assertIn('Job question: "<the held job\'s title, verbatim>" / none', gate)
        self.assertIn("fills `Job question:` with the job's title character for character", gate)

    def test_plan_mode_splits_only_the_job_question(self):
        scoped = read("shared", "legal-audit-scoped.md")
        plan = flat(scoped[scoped.index("## `mode: plan`"):scoped.index("## Coverage line")])
        self.assertIn("split only at its own question marks", plan)
        self.assertIn("each part quoted verbatim as its issue", plan)
        self.assertIn("You add no issue of your own", plan)
        self.assertIn("A part that crosses two lists (rule C) is split further, one issue per question", plan)
        self.assertIn("the gate runs one audit, and the agent writes one memo, per issue", plan)

    def test_a_job_holding_several_questions_is_proposed_for_splitting(self):
        gate = flat(read("shared", "legal-research.md"))
        rule = gate[gate.index("**A job holds one question.**"):gate.index("**A caller working a `/draft` job checks its lock")]
        self.assertIn("propose to the practitioner one job per question", rule)
        self.assertIn("(`/drafting-data` §3m, \"Rewording a held job\")", rule)
        self.assertIn("§3i's guarded create", rule)

    def test_memo_has_one_issue_and_rules_a_to_c(self):
        template = read("shared", "research-memo-template.md")
        self.assertIn("The Issue is the spawn prompt's Job question, verbatim, never paraphrased.", flat(template))
        self.assertIn("One memo has one `## Issue` and no sub-issues.", flat(template))
        for rule in ("**A.** holds one question;", "**B.** makes sense on its own;",
                     "**C.** lists alternatives in one place at most."):
            self.assertIn(rule, template)
        self.assertNotIn("Sub-issue <n>", template)
        self.assertNotIn("**Several issues.**", template)
        self.assertIn("No other issue or topic heading", template)
        self.assertIn("never paraphrased", flat(template))
        self.assertIn("Confidence:", template)
        self.assertIn("## Sources", template)


if __name__ == "__main__":
    unittest.main()
