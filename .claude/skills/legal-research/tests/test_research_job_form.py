"""Pins one form for every legal research job: research runs only under a held `Legal research: ` job,
every path that writes one builds it in the form, rule C allows only a conjunctive list, rule D is the
identity rule, and every route into research runs the sweep or the migration review.

Spec: docs/Specs/2026-11-02_one-form-for-every-legal-research-job-spec.md
"""

import re
import unittest
from pathlib import Path

SKILLS = Path(__file__).resolve().parents[2]
REPO = SKILLS.parents[1]
MIGRATION = "shared/research-job-migration.md"


def read(*parts):
    return " ".join(SKILLS.joinpath(*parts).read_text(encoding="utf-8").split())


class ResearchNeedsAJobTest(unittest.TestCase):
    def test_the_doctrine_runs_research_only_under_a_held_prefixed_job(self):
        doctrine = read("shared", "legal-research.md")
        self.assertIn("**Research runs only under a job.** Legal research runs only for a job this session holds whose title opens `Legal research: `", doctrine)
        self.assertIn("never in a reply in chat", doctrine)
        self.assertIn("A plainly labelled hunch is no research", doctrine)
        for gone in ("A caller holding no job records nothing", "A caller holding no job runs the same loop", "with no board, run this gate"):
            self.assertNotIn(gone, doctrine)

    def test_the_routes_outside_it_are_named(self):
        doctrine = read("shared", "legal-research.md")
        self.assertIn("a held note-up, scrutiny or case brief job, a `Note up paragraphs:` run, a currency check asked on its own and a scoped holdings dispatch", doctrine)
        self.assertIn("With no matter named, ask which matter and run nothing until told.", doctrine)

    def test_the_gate_checks_the_job_before_any_dispatch(self):
        gate = read("legal-research", "SKILL.md")
        self.assertLess(gate.index("1a. Job, before any dispatch."), gate.index("2a. Scope, before any search."))
        self.assertNotIn("without one the same loop", gate)


class EveryWriteIsInTheFormTest(unittest.TestCase):
    def test_no_research_job_is_written_from_unformed_words(self):
        stock = read("drafting-data", "references", "jobs-stock.md")
        self.assertNotIn("their question, character for character", stock)
        self.assertNotIn("With no board, write nothing", stock)
        section = stock[stock.index("## 3i. Research offer jobs"):stock.index("## 3n.")]
        self.assertNotIn("INSERT INTO tickets", section)
        self.assertNotIn("UPDATE tickets", section)
        self.assertIn("guard `research_title`", section)
        self.assertIn("`migrate: true`", section)

    def test_the_audit_offer_and_the_triage_return_the_form(self):
        self.assertIn("job: Legal research: A commercial tenant holds over. Does the example point apply?", read("shared", "legal-audit-protocol.md"))
        triage = (REPO / "source" / "researcher" / "agents" / "research-triage.md").read_text(encoding="utf-8")
        self.assertIn('"new_jobs": [{"title": "Legal research: <the issue>", "intent": "<the issue>"', triage)
        self.assertIn('"reword": [{"job": 5, "title": "Legal research: <the issue>", "intent": "<the issue>"', triage)

    def test_a_research_blocker_is_in_the_form(self):
        session = read("draft", "references", "job-session.md")
        self.assertNotIn("Research the test", session)
        self.assertIn("title `Legal research: ` followed by that intent", session)
        self.assertIn("What must be shown to establish this contention?`, title", session)


class RuleCAndDTest(unittest.TestCase):
    def test_one_conjunctive_list_and_the_identity_rule(self):
        template = read("shared", "research-memo-template.md")
        self.assertIn("**C.** holds at most one list, and that list conjunctive", template)
        self.assertIn('"Is gambling legal in BC or Alberta?" lists alternatives, so it is two questions', template)
        self.assertIn("**D.** names nothing that identifies the client, the parties, the people involved or the proceeding.", template)
        self.assertNotIn("one axis", template)

    def test_no_reader_still_cites_rules_a_to_c(self):
        for path in (SKILLS / "shared" / "legal-research.md", SKILLS / "shared" / "legal-audit-protocol.md", REPO / "source" / "researcher" / "agents" / "memo-reviewer.md"):
            self.assertIsNone(re.search(r"rules A\s+to C", path.read_text(encoding="utf-8")), path.name)


class EveryRouteMigratesTest(unittest.TestCase):
    def test_each_route_points_at_the_migration(self):
        for parts in (
            ("work", "references", "opening.md"),
            ("work", "references", "opening-routes.md"),
            ("draft", "SKILL.md"),
            ("legal-research", "references", "research-board.md"),
            ("shared", "legal-research.md"),
            ("drafting-data", "references", "jobs-closeout.md"),
        ):
            self.assertIn(MIGRATION, read(*parts), parts)

    def test_board_mode_defines_a_research_job_by_the_prefix(self):
        board = read("legal-research", "references", "research-board.md")
        self.assertIn("A research job is a queued, unshelved job whose title opens `Legal research: `.", board)

    def test_the_review_never_keeps_the_original(self):
        migration = read("shared", "research-job-migration.md")
        self.assertIn("Never offer to keep the original", migration)
        self.assertIn("One job per turn, under `/show-me`.", migration)
        self.assertIn("A job judged not research is left alone and never retitled", migration)
        self.assertIn("nothing is written without it", migration)


if __name__ == "__main__":
    unittest.main()
