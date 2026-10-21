"""Pins the gate's step 2a: the plan's issues are asked one at a time as Yes/No multiple-choice
questions, up to four per form, skipped issues are dropped, and the closing list shows only the
approved issues and the fixed question. An addition repeats the list with the "any more" question,
and the practitioner's "No" approves the list. The whole-plan waive stays.

Spec: docs/Specs/2026-10-20_research-issue-by-issue-approval-creates-jobs-spec.md

Run: python -m pytest .claude/skills/legal-research/tests/test_plan_issue_approval.py -q
"""

import unittest
from pathlib import Path

SKILL = Path(__file__).resolve().parents[1] / "SKILL.md"


def step_2a():
    text = SKILL.read_text(encoding="utf-8")
    start = text.index("2a. Plan, before any search.")
    return text[start:text.index("\n3. ", start)]


class PlanIssueApprovalTest(unittest.TestCase):
    def setUp(self):
        self.step = step_2a()

    def test_each_issue_is_its_own_yes_no_question(self):
        self.assertIn("Ask each issue as its own multiple-choice question", self.step)
        self.assertIn('"Yes, research it" and "No, skip it"', self.step)
        self.assertIn("up to four\n     questions per form", self.step)
        self.assertIn("A skipped issue is dropped.", self.step)

    def test_plain_text_fallback_without_the_tool(self):
        self.assertIn("With no multiple-choice tool in the\n     session, show the issues as a numbered list", self.step)

    def test_closing_list_and_question_without_explanation(self):
        self.assertIn('"Are there any other issues that you would like this research to cover?"', self.step)
        self.assertIn("Add no sentence about what an answer does.", self.step)

    def test_an_addition_repeats_the_list(self):
        self.assertIn("show the full numbered list again", self.step)
        self.assertIn('"Are there any more issues that you would like this research job to cover?"', self.step)

    def test_no_approves_and_hands_to_the_doctrine(self):
        self.assertIn('Their "No" approves the list.', self.step)
        self.assertIn('"Approved plan issues become jobs"', self.step)

    def test_waive_and_no_session_issues_stay(self):
        self.assertIn("waive the whole plan", self.step)
        self.assertIn("you add no issue of your own", self.step)
        self.assertNotIn("approve it, change it in their own words, or waive it", self.step)

    def test_a_held_job_asks_nothing(self):
        self.assertIn("**A caller holding a `/draft` job asks nothing.**", self.step)
        self.assertIn("plan's `scope: in` issues are its internal checklist, and steps 3 to 5 run all of them", self.step)
        self.assertIn("A `scope: new` issue lies outside the question and is not researched: it is captured\n     and offered", self.step)
        self.assertIn("may still narrow or waive the job's scope in their own words", self.step)
        self.assertIn("Otherwise take the practitioner through its issues one at a time:", self.step)
        self.assertNotIn("held job whose title is an issue approved here", self.step)


if __name__ == "__main__":
    unittest.main()
