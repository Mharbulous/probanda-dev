"""Pins the case brief: a structured Writing of eight parts with one source for its shape, written
by research-agent, checked by brief-reviewer, never of the working matter's own litigation, requested
only when the practitioner asks, and kept apart from research jobs and from the decision's own text.

Plan: docs/Plans/2026-11-01_legal-research-board-and-case-briefs.md

Run: python -m pytest .claude/skills/legal-research/tests/test_case_brief.py -q
"""

import json
import unittest
from pathlib import Path

SKILLS = Path(__file__).resolve().parents[2]
REPO = SKILLS.parents[1]
TYPE = SKILLS / "legal-research" / "references" / "CAN" / "BC" / "_NoVenue" / "Documents" / "case-brief.md"
PARTS = ["Case", "Facts", "Procedural history", "Issues", "Holding", "Ratio decidendi", "Obiter dicta", "Disposition"]
SLOTS = ["case", "facts", "procedural-history", "issues", "holding", "ratio", "obiter", "disposition"]
TITLE = "Brief the case: "


def read(*parts):
    return SKILLS.joinpath(*parts).read_text(encoding="utf-8")


def flat(text):
    return " ".join(text.split())


class Shape(unittest.TestCase):
    def test_type_file_has_the_eight_parts_in_order(self):
        text = TYPE.read_text(encoding="utf-8")
        layout = json.loads(text[text.index("```json") + 7 : text.index("\n```", text.index("```json"))])
        self.assertEqual([p["heading"] for p in layout["parts"]], PARTS)
        self.assertEqual([p["source"] for p in layout["parts"]], [f"slot:{s}" for s in SLOTS])
        self.assertEqual(layout["parts"][0]["paragraph_numbering"], "none")
        self.assertTrue(all(p["paragraph_numbering"] == "continue" for p in layout["parts"][1:]))
        self.assertIn("shared/case-brief-template.md", text)

    def test_template_table_matches_the_type_file(self):
        template = read("shared", "case-brief-template.md")
        at = -1
        for part, slot in zip(PARTS, SLOTS):
            found = template.index(f"| {part} | `{slot}` |")
            self.assertGreater(found, at)
            at = found

    def test_kind_is_internal(self):
        kinds = json.loads(read("legal-research", "references", "CAN", "BC", "_NoVenue", "Documents", "kinds.json"))["kinds"]
        row = next(k for k in kinds if k["file"] == "case-brief")
        self.assertEqual(row["recipient"], "internal")
        self.assertEqual(row["aliases"], [{"name": "case_brief"}])

    def test_server_knows_the_kind_has_no_board(self):
        query = (REPO / "source" / "lawyer" / "mcp" / "src" / "submission" / "forms" / "query.ts").read_text(encoding="utf-8")
        self.assertIn('"case_brief"', query)


class Definition(unittest.TestCase):
    def test_never_of_the_matters_own_litigation(self):
        template = flat(read("shared", "case-brief-template.md"))
        self.assertIn("A decision in the working matter's own proceedings is never briefed", template)
        skill = flat(read("case-brief", "SKILL.md"))
        self.assertIn("Refuse the matter's own litigation", skill)
        self.assertIn("Never for a decision in the matter's own litigation", skill)
        reviewer = flat((REPO / "source" / "researcher" / "agents" / "brief-reviewer.md").read_text(encoding="utf-8"))
        self.assertIn('set `own_litigation` to true and stop', reviewer)
        self.assertIn("Skip a decision in the matter's own litigation", flat(read("drafting-data", "references", "jobs-stock.md")))

    def test_names_nothing_of_the_working_matter(self):
        self.assertIn("It names nothing of the working matter", read("shared", "case-brief-template.md"))
        self.assertIn("nothing of the working matter's facts", read("case-brief", "SKILL.md"))

    def test_says_it_is_not_noted_up(self):
        self.assertIn("`Not noted up by this brief.`", read("shared", "case-brief-template.md"))


class Who(unittest.TestCase):
    def test_research_agent_writes_it_from_the_template(self):
        protocol = flat(read("shared", "legal-audit-protocol.md"))
        self.assertIn("For `mode: case_brief`, fetch `shared/case-brief-template.md` and `case-brief/agents/brief.md`", protocol)
        self.assertIn("mode: case_brief", read("case-brief", "SKILL.md"))

    def test_reviewer_is_assigned_read_only_and_runs_before_the_save(self):
        assignment = json.loads((REPO / "source" / "assignment.json").read_text(encoding="utf-8"))
        self.assertIn("brief-reviewer", json.dumps(assignment["plugins"]["researcher"]["agents"]))
        front = (REPO / "source" / "researcher" / "agents" / "brief-reviewer.md").read_text(encoding="utf-8").split("---")[1]
        for tool in ("Write", "Edit", "Bash", "drafting_data"):
            self.assertNotIn(tool, front.split("tools:")[1])
        skill = read("case-brief", "SKILL.md")
        self.assertLess(skill.index("researcher:brief-reviewer"), skill.index("**Save it**"))
        self.assertIn("Save only after `brief-reviewer` returns `complete`", read("shared", "case-brief-template.md"))

    def test_model_invocable_so_work_can_hand_it_a_job(self):
        self.assertNotIn("disable-model-invocation", read("case-brief", "SKILL.md"))
        self.assertIn(f"| A case brief, its title opening `{TITLE}` | `/case-brief` |", read("work", "SKILL.md"))


class Jobs(unittest.TestCase):
    def test_requests_are_only_the_practitioners(self):
        stock = read("drafting-data", "references", "jobs-stock.md")
        section = stock[stock.index("## 3n. Case brief jobs") :]
        self.assertIn("**Requests are made only when the practitioner asks.**", section)
        self.assertIn(f"`{TITLE}<style of cause>, <citation>`", section)
        self.assertIn("under guard `authority_brief`", section)
        self.assertIn("('authorities', <the case's id>)", section)

    def test_server_holds_the_guard_and_the_fixed_text(self):
        forms = REPO / "source" / "lawyer" / "mcp" / "src" / "submission" / "forms"
        self.assertIn('BRIEF_JOB_PREFIX = "Brief the case: "', (forms / "brief-job.ts").read_text(encoding="utf-8"))
        self.assertIn("title.startsWith(BRIEF_JOB_PREFIX)", (forms / "take-job.ts").read_text(encoding="utf-8"))
        self.assertIn('"authority_brief"', (forms / "create-job.ts").read_text(encoding="utf-8"))

    def test_brief_jobs_are_no_research_jobs(self):
        self.assertIn("A case brief job, its title opening `Brief the case: `, is none", read("legal-research", "references", "research-board.md"))

    def test_completion_checks_a_brief_not_an_issue(self):
        self.assertIn("A case brief job has no Issue heading to compare", read("draft", "references", "job-session.md"))


class NotTheDecision(unittest.TestCase):
    def test_a_brief_is_not_taken_for_the_decision(self):
        self.assertIn("`*case brief*`", read("drafting-data", "references", "locate-authority.md"))
        self.assertIn("never the decision: never ingest one", flat(read("shared", "legal-research.md")))
        self.assertIn("Never ingest a brief", read("shared", "case-brief-template.md"))
        self.assertIn("A file named `case brief`", read("case-brief", "SKILL.md"))


if __name__ == "__main__":
    unittest.main()
