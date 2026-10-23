"""Pins the plan-marker step: a job created with no supplied, approved or derived steps carries one
fixed step, /draft routes such a job to /job-planning instead of assigning it, and /job-planning
replaces the marker without touching a done step.

Run: python -m pytest .claude/skills/drafting-data/tests/test_plan_marker_step.py -q
"""

import unittest
from pathlib import Path

SKILLS = Path(__file__).resolve().parents[2]
MARKER = "Create a plan for how to complete this job."


def read(*parts):
    return SKILLS.joinpath(*parts).read_text(encoding="utf-8")


def paragraph(text, opening):
    start = text.index(opening)
    end = text.find("\n\n", start)
    return text[start:end if end != -1 else None]


class PlanMarkerStepTest(unittest.TestCase):
    def test_create_writes_the_marker_as_fixed_text(self):
        create = read("drafting-data", "references", "jobs-create.md")
        rule = paragraph(create, "**The plan marker.**")
        self.assertIn(f"`{MARKER}`", rule)
        self.assertIn("no steps the practitioner supplied or approved, and none derived from a Proposal card", rule)
        self.assertIn("takes exactly one step, ordinal 1", rule)
        self.assertIn(f"VALUES (2, 1, '{MARKER}');", create)
        self.assertIn("A job outlined from a Proposal keeps its card-derived steps", rule)

    def test_spin_off_blocker_takes_the_marker(self):
        create = read("drafting-data", "references", "jobs-create.md")
        spin_off = create[create.index("## 3f. Spin off blockers"):create.index("## 3j.")]
        self.assertIn("its text the plan marker (§3, \"The plan marker\")", spin_off)
        self.assertIn(f"VALUES (51, 1, '{MARKER}');", spin_off)
        self.assertNotIn("the intent verbatim", spin_off)
        self.assertIn("What must be shown to establish this contention? <contention>", spin_off)
        self.assertIn("(§3f, §3i, §3l)", paragraph(create, "**The plan marker.**"))

    def test_research_offer_without_steps_takes_the_marker(self):
        stock = read("drafting-data", "references", "jobs-stock.md")
        self.assertIn("An offer with a `job:` line and no `steps:` line takes the plan marker", stock)
        self.assertIn("They are never a default plan and are never copied onto another job", stock)

    def test_draft_routes_a_marker_job_to_planning(self):
        session = read("work", "references", "job-session.md")
        rule = paragraph(session, "**A job that needs a plan.**")
        self.assertIn(f"`{MARKER}`", rule)
        self.assertIn("the restating check never flags it", rule)
        self.assertIn("never assign the job or stamp its approval while the marker is its only step", rule)
        self.assertIn("then run `/job-planning` on it", rule)
        self.assertIn("never splits or rewrites the plan marker", session)
        self.assertIn("A job whose only step is the plan marker is not checked as a one-step job", session)
        take_over = read("draft", "references", "take-over.md")
        self.assertIn("Where its only step is the plan marker", take_over)

    def test_job_planning_replaces_the_marker_and_keeps_done_steps(self):
        rule = paragraph(read("shared", "job-planning.md"), "**The plan marker.**")
        self.assertIn(f"`{MARKER}`", rule)
        self.assertIn("its upgrade replaces the marker step with the planned steps", rule)
        self.assertIn("Steps already done are never altered.", rule)
        skill = read("job-planning", "SKILL.md")
        self.assertIn("never meets them: go to step 4", skill)
        self.assertIn("Either write replaces the plan marker with the planned steps and leaves every done step as it is.", skill)


if __name__ == "__main__":
    unittest.main()
