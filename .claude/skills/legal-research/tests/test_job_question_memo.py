"""Pins a research job's memo to the job's own question: the spawn prompt carries the job's
title verbatim, plan mode splits it only at its own question marks and adds no issue, and the
memo has one Issue holding the title verbatim with its parts as verbatim sub-issues.

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

    def test_memo_has_one_issue_holding_the_job_question(self):
        template = read("shared", "research-memo-template.md")
        self.assertIn("The Issue is the spawn prompt's Job question, verbatim.", flat(template))
        self.assertIn("each `Sub-issue` heading quoting its part character for character", flat(template))
        self.assertIn("No other issue or topic heading", template)
        self.assertIn("never paraphrased", flat(template))
        self.assertIn("Confidence:", template)
        self.assertIn("## Sources", template)


if __name__ == "__main__":
    unittest.main()
