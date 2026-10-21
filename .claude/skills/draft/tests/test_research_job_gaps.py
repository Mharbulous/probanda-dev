"""Pins a research job's scope on the /draft side: job-planning asks no approval of a recorded
question's sub-issues and puts every sub-issue in the completion test, and Complete refuses a
research job whose last return names a tier not run, unless the practitioner waives it.

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
        self.assertIn("A job whose research question is recorded needs no approval of its issues", section)
        self.assertIn("Only an issue outside the recorded question needs the practitioner's word.", section)
        self.assertIn("left as a gap only once every source tier has run on it", section)

    def test_job_planning_adds_no_issue_to_a_recorded_question(self):
        plan = read("shared", "job-planning.md")
        section = plan[plan.index("## 2. A research job"):plan.index("## 3.")]
        self.assertIn("The planner adds no issue to it", section)
        self.assertIn("the memo's one Issue is the job's title, verbatim", section)

    def test_complete_refuses_an_open_tier(self):
        session = read("draft", "references", "job-session.md")
        complete = session[session.index("### Complete"):session.index("## Branch B")]
        self.assertIn("A research job whose last research return carried a `gap:` line naming a tier not run is not completed", complete)
        self.assertIn("unless the practitioner says in their own words to complete the job without it", complete)
        self.assertIn("an unattended run reports and stops", complete)

    def test_complete_compares_memo_headings_with_the_title(self):
        session = read("draft", "references", "job-session.md")
        complete = session[session.index("### Complete"):session.index("## Branch B")]
        self.assertIn("compare the saved memo's headings with the job's title", complete)
        self.assertIn("one `## Issue` holding the title verbatim", complete)
        self.assertIn("unless the practitioner says in their own words to complete it as is", complete)


if __name__ == "__main__":
    unittest.main()
