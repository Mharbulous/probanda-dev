"""Pins the research question job: a new question the practitioner chooses to research as an
additional issue is written as one job, its title and intent their question, its one step the
plan marker, and no research dispatched by the write.

Run: python -m pytest .claude/skills/drafting-data/tests/test_research_question_jobs.py -q
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


class ResearchQuestionJobsTest(unittest.TestCase):
    def test_doctrine_writes_the_job_by_3l(self):
        rule = " ".join(paragraph(read("shared", "legal-research.md"),
                                  "**A new question is a new job or a new scope.**").split())
        self.assertIn("write it as a research job by `/drafting-data` §3l", rule)

    def test_stock_section_writes_the_marker(self):
        stock = read("drafting-data", "references", "jobs-stock.md")
        start = stock.index("## 3l. Research question jobs")
        section = stock[start:stock.index("## 3m.", start)]
        self.assertIn("writes only on their approval", section)
        self.assertIn("Title: `Legal research: ` followed by the intent, character for character.", section)
        self.assertNotIn("Never cleaned", section)
        self.assertIn("Steps: the plan marker as its one step", section)
        self.assertIn("one `drafting_data__create_job` call under guard `research_title`", section)
        self.assertIn("No research runs from this write", section)
        self.assertNotIn("skipped", section)

    def test_create_table_lists_the_path(self):
        create = read("drafting-data", "references", "jobs-create.md")
        self.assertIn("| §3l research question jobs |", create)
        self.assertIn("§3l's research question jobs", create)
        sections = paragraph(create, "**The plan marker.**").rsplit("(", 1)[1].rstrip(").").split(", ")
        self.assertIn("§3l", sections)
        self.assertIn("`references/jobs-stock.md` §3l", read("drafting-data", "SKILL.md"))


if __name__ == "__main__":
    unittest.main()
