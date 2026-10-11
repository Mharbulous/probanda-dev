"""Regression locks for the BC Laws pages legislation-fetcher files beside a consolidation.

Beside a BC Laws consolidation, `legislation-fetcher` also files the Point in Time
page the consolidation links and, for a B.C. Reg. citation, the current year's
Cumulative B.C. Regulations Bulletin, with the same two tools it files the
instrument with. It counts the bulletin lines naming the regulation by an exact
number match, so `68/2009` never counts a line naming `168/2009`. Amending
regulations are not filed: their Gazette page address is only in a link, and
`sources__fetch` returns text without links. Each test pins one piece of that.
BC Laws pages have one fetch route, so no research-paralegal capture mode exists.
"""
import re
import unittest
from pathlib import Path


SKILL_ROOT = Path(__file__).resolve().parents[1]
SKILLS_ROOT = SKILL_ROOT.parent
REPO_ROOT = SKILLS_ROOT.parents[1]
SHARED = SKILLS_ROOT / "shared"
AGENTS = REPO_ROOT / "source" / "probanda" / "agents"
FETCHER = AGENTS / "legislation-fetcher.md"
PLAYBOOK = SKILL_ROOT / "references" / "legislation-fetcher-playbook.md"

PIT_URL = "https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/<id>_pit"
BULLETIN_URL = "https://www.bclaws.gov.bc.ca/civix/document/id/regulationbulletin/regulationbulletin/<YYYY>cumulati"
GAZETTE_URL = "https://www.bclaws.gov.bc.ca/civix/document/id/lc/bcgaz2/v<volume>n<issue>_<N>-<YYYY>"
EXACT_RULE = "the returned lines that hold the number with no digit immediately before or after it"


def read(path):
    return path.read_text(encoding="utf-8")


def flat(text):
    return " ".join(text.split())


def section_ten():
    text = flat(read(PLAYBOOK))
    return text[text.index("## 10. BC Laws pages beside the consolidation"):]


def procedure_step(number, title):
    text = flat(read(PLAYBOOK))
    procedure = text[text.index("## 8. Procedure"):text.index("## 9. A PDF")]
    start = procedure.index(f"{number}. **{title}**")
    return procedure[start:procedure.index(f"{number + 1}. **", start)]


def names_regulation(line, number):
    """The exact-match rule as the playbook words it: no digit immediately before or after."""
    return re.search(rf"(?<!\d){re.escape(number)}(?!\d)", line) is not None


class ProcedureTests(unittest.TestCase):
    def test_step_eight_files_the_pages_for_bc_laws_only(self):
        step = procedure_step(8, "BC Laws pages.")
        self.assertIn("`www.bclaws.gov.bc.ca` or `bclaws.gov.bc.ca`", step)
        self.assertIn("section 10", step)
        self.assertIn("never changes `filed`", step)

    def test_a_companion_page_is_not_on_disk_evidence(self):
        step = procedure_step(2, "Already on disk?")
        self.assertIn("A page section 10 filed beside it does not count.", step)

    def test_the_filed_return_carries_companions(self):
        self.assertIn("for a BC Laws instrument `companions` (section 10)", flat(read(PLAYBOOK)))
        self.assertIn("companions?", read(FETCHER))


class PagesTests(unittest.TestCase):
    def test_pages_use_the_two_existing_tools_only(self):
        text = section_ten()
        self.assertIn("Fetch each page with `sources__fetch`", text)
        self.assertIn("File it with `research_filing__file_fetched`", text)
        self.assertNotIn("capture_bclaws", read(PLAYBOOK))

    def test_a_page_that_fails_is_recorded_not_a_stop(self):
        text = section_ten()
        self.assertIn("A page you cannot file is not a stop", text)
        self.assertIn('{status: "not_filed", reason}', text)
        self.assertIn("Never request a page twice and never try another URL.", text)

    def test_point_in_time_is_built_only_when_linked(self):
        text = section_ten()
        self.assertIn('`match: "Link to Point in Time"`', text)
        self.assertIn('`pit: {status: "not_linked"}`', text)
        self.assertIn(PIT_URL, text)
        self.assertIn("`120_2022` gives `120_2022_pit`", text)
        self.assertIn("`168_2009_01` gives `168_2009_pit`", text)

    def test_bulletin_is_for_a_bc_reg_citation_in_the_current_year(self):
        text = section_ten()
        self.assertIn("Only for a B.C. Reg. citation.", text)
        self.assertIn('`bulletin: {status: "not_applicable"}`', text)
        self.assertIn(BULLETIN_URL, text)
        self.assertIn("`<YYYY>` is the year of step 7's `fetched_at`", text)

    def test_page_records_carry_their_kind_and_the_consolidation_marker(self):
        text = section_ten()
        self.assertIn("`kind` `point-in-time` or `regulations-bulletin`", text)
        self.assertIn("`currency_marker` the consolidation's", text)


class ExactMatchTests(unittest.TestCase):
    def test_rule_is_worded_as_pinned(self):
        text = section_ten()
        self.assertIn(EXACT_RULE, text)
        self.assertIn("`68/2009` also returns the lines naming `168/2009`, and those never count", text)

    def test_68_never_matches_168(self):
        self.assertFalse(names_regulation("168/2009 — Supreme Court Civil Rules", "68/2009"))
        self.assertTrue(names_regulation("168/2009 — Supreme Court Civil Rules", "168/2009"))
        self.assertTrue(names_regulation("Amends B.C. Reg. 68/2009 — Example Regulation", "68/2009"))
        self.assertFalse(names_regulation("Amends B.C. Reg. 68/20091", "68/2009"))


class LimitsTests(unittest.TestCase):
    def test_amending_regulations_are_not_filed(self):
        text = section_ten()
        self.assertIn(GAZETTE_URL, text)
        self.assertIn("`sources__fetch` returns no links, so the page cannot be reached", text)
        self.assertIn("Never build its address from a row's numbers or dates.", text)

    def test_stated_limits(self):
        text = section_ten()
        self.assertIn('**"Amendments Not in Force"**: no consolidation page links one.', text)
        self.assertIn("**Order-in-council PDFs**, and any earlier year's bulletin.", text)
        self.assertIn("Never guess a part id", text)

    def test_one_bc_laws_route(self):
        self.assertFalse((SHARED / "research-paralegal" / "bclaws-capture.md").exists())
        self.assertNotIn("BC Laws capture", read(AGENTS / "research-paralegal.md"))


class ReaderTests(unittest.TestCase):
    def test_statute_currency_leg_three_lists_the_pages(self):
        text = flat(read(SHARED / "statute-currency.md"))
        self.assertIn("also files the Point in Time page the consolidation links", text)
        self.assertIn("Cumulative B.C. Regulations Bulletin", text)
        self.assertIn("It files no amending regulation", text)

    def test_pages_are_never_ingested(self):
        text = flat(read(SHARED / "legal-research.md"))
        self.assertIn("A Point in Time page or bulletin it filed beside a consolidation is a currency record, "
                      "not an authority: never ingest it.", text)


if __name__ == "__main__":
    unittest.main()
