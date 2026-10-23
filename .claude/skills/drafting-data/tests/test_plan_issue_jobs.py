"""Pins the research plan issue jobs: the practitioner's "No" at /legal-research's closing plan
question writes one job per approved issue, its title and intent the issue's text, its one step the
plan marker, no job for a skipped issue, and no research dispatched by the write.

Spec: docs/Specs/2026-10-20_research-issue-by-issue-approval-creates-jobs-spec.md

Run: python -m pytest .claude/skills/drafting-data/tests/test_plan_issue_jobs.py -q
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


class PlanIssueJobsTest(unittest.TestCase):
    def test_doctrine_writes_one_job_per_issue(self):
        rule = paragraph(read("shared", "legal-research.md"), "**Approved plan issues become jobs.**")
        self.assertIn("write one research job per listed issue by\n`/drafting-data` §3l", rule)
        self.assertIn("title and intent are the issue's text as the list showed it", rule)
        self.assertIn('"The plan\nmarker"', rule)
        self.assertIn("A skipped issue gets no job", rule)
        self.assertIn("Then re-render the Job Board and stop.", rule)
        self.assertIn("Writing the jobs dispatches\nnothing", rule)

    def test_stock_section_writes_the_marker(self):
        stock = read("drafting-data", "references", "jobs-stock.md")
        start = stock.index("## 3l. Research plan issue jobs")
        section = stock[start:]
        self.assertIn("one job per listed issue and none for an issue they skipped", section)
        self.assertIn("Steps: the plan marker as its one step", section)
        self.assertIn(f"VALUES (32, 1, '{MARKER}');", section)
        self.assertIn("No research runs from this write", section)

    def test_create_table_lists_the_path(self):
        create = read("drafting-data", "references", "jobs-create.md")
        self.assertIn("| §3l research plan issue jobs |", create)
        self.assertIn("§3l's research plan issue jobs", create)
        sections = paragraph(create, "**The plan marker.**").rsplit("(", 1)[1].rstrip(").").split(", ")
        self.assertIn("§3l", sections)
        self.assertIn("`references/jobs-stock.md` §3l", read("drafting-data", "SKILL.md"))


if __name__ == "__main__":
    unittest.main()
