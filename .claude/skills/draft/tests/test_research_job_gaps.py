"""Pins a research job's scope on the /draft side: job-planning asks no approval of a recorded
question and its completion test leaves required research as a gap only once every tier has run,
and Complete refuses a research job whose last saved memo is INCOMPLETE, unless the
practitioner waives it, and a memo with any sub-issue heading.

Spec: docs/Specs/2026-10-21_held-job-research-sub-issues-implicitly-approved-spec.md

Run: python -m pytest .claude/skills/draft/tests/test_research_job_gaps.py -q
"""

import unittest
from pathlib import Path

SKILLS = Path(__file__).resolve().parents[2]


def read(*parts):
    return SKILLS.joinpath(*parts).read_text(encoding="utf-8")


class ResearchJobGapsTest(unittest.TestCase):
    def test_job_planning_needs_no_sub_issue_approval(self):
        plan = read("shared", "job-planning.md")
        section = plan[plan.index("## 2. A research job"):plan.index("## 3.")]
        self.assertNotIn("approved by the practitioner before any search", section)
        self.assertIn("left as a gap only once every source tier has run on it", section)

    def test_job_planning_adds_no_issue_to_a_recorded_question(self):
        plan = read("shared", "job-planning.md")
        section = plan[plan.index("## 2. A research job"):plan.index("## 3.")]
        self.assertIn("The job's recorded question, verbatim, is its one question, and the plan adds no issue to it",
                      section)
        self.assertIn("the memo's one Issue is the job's title, verbatim", section)

    def test_complete_refuses_an_open_tier(self):
        session = read("draft", "references", "job-session.md")
        complete = session[session.index("### Complete"):]
        self.assertIn("A research job whose last saved memo's `Confidence:` starts with `INCOMPLETE` is not completed", complete)
        self.assertIn("unless the practitioner says in their own words to complete the job without it", complete)
        self.assertIn("an unattended run reports and stops", complete)

    def test_complete_heading_rewrite_passes_the_reviewer(self):
        session = read("draft", "references", "job-session.md")
        complete = session[session.index("### Complete"):]
        self.assertIn("re-invoke the same agent with `Review:` to rewrite the memo to the job question, then save it "
                      "again through memo-reviewer's loop", complete)

    def test_job_planning_has_one_issue_not_a_checklist(self):
        plan = read("shared", "job-planning.md")
        self.assertNotIn("internal checklist", plan)
        self.assertNotIn("scope: in", plan)

    def test_complete_compares_memo_headings_with_the_title(self):
        session = read("draft", "references", "job-session.md")
        complete = session[session.index("### Complete"):]
        self.assertIn("compare the saved memo's headings with the job's title", complete)
        self.assertIn("one `## Issue` holding the title verbatim, and no sub-issue or other issue or topic heading", complete)
        self.assertNotIn("### Sub-issue", complete)
        self.assertIn("unless the practitioner says in their own words to complete it as is", complete)


if __name__ == "__main__":
    unittest.main()
