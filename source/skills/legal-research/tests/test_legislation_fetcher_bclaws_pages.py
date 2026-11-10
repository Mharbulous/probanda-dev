"""Regression locks for the BC Laws pages law-getter files beside a consolidation.

Beside a BC Laws consolidation, `law-getter` in legislation mode also files the Point in Time
page the consolidation links and, for a B.C. Reg. citation, the current year's
Cumulative B.C. Regulations Bulletin, with the same two tools it files the
instrument with. It counts the bulletin lines naming the regulation by an exact
number match, so `68/2009` never counts a line naming `168/2009`. Amending
regulations are not filed from the bulletin: their Gazette page address is only in
a link, and `sources__fetch` returns text without links. A caller that holds the
exact address dispatches the amending instrument on its own (section 12), and it
is filed as made, with no currency marker. A regulation BC Laws publishes in parts,
such as the Supreme Court Civil Rules, is fetched part by part from the ids the
map lists. Each test pins one piece of that. BC Laws pages have one fetch route,
so no Chrome-mode BC Laws capture exists.
"""
import re
import unittest
from pathlib import Path


SKILL_ROOT = Path(__file__).resolve().parents[1]
SKILLS_ROOT = SKILL_ROOT.parent
REPO_ROOT = SKILLS_ROOT.parents[1]
SHARED = SKILLS_ROOT / "shared"
AGENTS = REPO_ROOT / "source" / "researcher" / "agents"
FETCHER = AGENTS / "law-getter.md"
PLAYBOOK = SKILL_ROOT / "references" / "law-getter-legislation-playbook.md"

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
        self.assertIn("Return the single JSON object the playbook's section 2 names", read(FETCHER))


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
        self.assertIn("`sources__fetch` returns no links, so the page cannot be reached from the bulletin", text)
        self.assertIn("Never build its address from a row's numbers or dates.", text)
        self.assertIn("A dispatch that supplies the page's exact address files it on its own (section 12).", text)

    def test_stated_limits(self):
        text = section_ten()
        self.assertIn('**"Amendments Not in Force"**: no consolidation page links one.', text)
        self.assertIn("**Order-in-council PDFs**, and any earlier year's bulletin.", text)
        self.assertIn("Never guess a part id", text)

    def test_one_bc_laws_route(self):
        self.assertFalse((SHARED / "law-getter" / "bclaws-capture.md").exists())
        self.assertNotIn("BC Laws capture", read(FETCHER))


class ReaderTests(unittest.TestCase):
    def test_statute_currency_leg_three_lists_the_pages(self):
        text = flat(read(SHARED / "statute-currency.md"))
        self.assertIn("also files the Point in Time page the consolidation links", text)
        self.assertIn("Cumulative B.C. Regulations Bulletin", text)
        self.assertIn("It files an amending regulation only as made, at the exact address a caller supplies", text)
        self.assertNotIn("has no route yet", text)

    def test_pages_are_never_ingested(self):
        text = flat(read(SHARED / "legal-research.md"))
        self.assertIn("A Point in Time page or bulletin it filed beside a consolidation is a currency record, "
                      "not an authority: never ingest it.", text)


def section(heading, end=None):
    text = read(PLAYBOOK)
    start = text.index(heading)
    return flat(text[start:text.index(end, start) if end else len(text)])


def seed_parts():
    """The BC seed's regulation_parts entry for 168_2009, as a list of part ids."""
    seed = read(PLAYBOOK)
    seed = seed[seed.index("BC Laws, for"):seed.index("Justice Laws, for")]
    match = re.search(r"- id: '168_2009'\n\s+parts: '([^']+)'", seed)
    return [part.strip() for part in match.group(1).split(",")] if match else []


class PartsTests(unittest.TestCase):
    """A regulation published in parts is fetched by the part ids the map lists, never by its bare id."""

    def test_seed_lists_the_sccr_parts_from_the_doc_map(self):
        doc_map = read(SHARED / "bclaws-sccr-doc-map.md")
        listed = re.findall(r"^\| `(168_2009_\d\d(?:_\d)?)` \|", doc_map, re.M)
        self.assertEqual(seed_parts(), [part for part in listed if part != "168_2009_00"])

    def test_map_format_names_regulation_parts(self):
        self.assertIn("`regulation_parts` (optional)", section("## 3. Publisher maps", "## 4."))

    def test_step_four_builds_one_url_per_listed_part(self):
        step = procedure_step(4, "Build the URL.")
        self.assertIn("build one URL per listed part id, in the listed order, in place of the bare id, "
                      "and never fetch the bare id", step)
        self.assertIn("Never guess an id.", step)

    def test_an_overlay_map_without_the_entry_takes_the_seeds(self):
        self.assertIn("lacks a `regulation_parts` entry the BC seed holds takes the seed's entry",
                      procedure_step(3, "Find the map."))
        self.assertIn("overwritten to add it, keeping every other field", procedure_step(9, "Write or correct the map."))

    def test_every_part_is_verified_before_any_is_filed(self):
        self.assertIn("fetch and verify every part this way, each with its own `currency_marker`, before filing any",
                      procedure_step(6, "Fetch and verify."))
        self.assertIn("so each part gets its own manifest line", procedure_step(7, "File."))

    def test_a_stop_on_one_part_stops_the_whole_instrument(self):
        self.assertIn("a stop on any one part stops the whole instrument", section("## 6. Stops", "## 7."))

    def test_on_disk_needs_every_part(self):
        self.assertIn("is on disk only when every part's file (section 5) is there", procedure_step(2, "Already on disk?"))

    def test_part_file_name(self):
        self.assertIn("`Supreme Court Civil Rules, B.C. Reg. 168-2009 - 168_2009_01.md`",
                      section("## 5. File names", "## 6."))

    def test_a_listed_part_is_no_longer_a_stated_limit(self):
        self.assertNotIn("a regulation published in parts stops at step 6", section_ten())

    def test_gate_records_parts_in_one_legislation_record(self):
        text = flat(read(SHARED / "legal-research.md"))
        self.assertIn("still gets one legislation record: its `path`, `sha256` and `currency_marker` each list "
                      "the parts' values", text)
        self.assertIn("For an instrument filed in parts, `<path>` lists every part's path, separated by `; `.", text)


class AmendingInstrumentTests(unittest.TestCase):
    """An amending instrument at a caller-supplied publisher URL is filed as made, with no currency marker."""

    def test_dispatch_carries_the_flag_and_reuses_url(self):
        text = section("## 2. Dispatch and return", "## 3.")
        self.assertIn("- `amending_instrument` (optional)", text)
        self.assertIn("- `url`", text)
        self.assertIn("`amending_instrument` and `url` come together", procedure_step(1, "Check the dispatch."))

    def test_section_twelve_files_with_no_marker_on_the_publisher_host(self):
        text = section("## 12. An amending instrument at the caller's URL")
        self.assertIn("`not_publisher_host`", text)
        self.assertIn("Never change the URL, never build or guess one", text)
        self.assertIn("`final_url` must have the same host as `url`", text)
        self.assertIn("`kind` is `amending-` followed by the dispatch's `kind`", text)
        self.assertIn("`currency_marker` is `none`", text)
        self.assertIn("Never infer a date", text)
        self.assertIn("Never report the copy as current to any date.", text)
        self.assertIn("File no section 10 page and write or correct no map.", text)

    def test_without_the_flag_a_page_with_no_marker_still_stops(self):
        self.assertIn("a page with no marker stops `no_currency_marker`", section("## 12."))

    def test_gate_says_when_to_set_the_flag(self):
        duty = flat(read(SHARED / "legal-research.md"))
        duty = duty[duty.index("4. **Legislation text, before the audit.**"):
                    duty.index("5. **Note-up, before the audit.**")]
        self.assertIn("amending_instrument?, url?", duty)
        self.assertIn("Never build or guess the address, and never set the field without one.", duty)
        self.assertIn("Leave it out of the `legislation_currency` call", duty)

    def test_spawn_template_labels_the_copy_as_made(self):
        text = read(SHARED / "legal-research.md")
        template = text[text.index("**Spawn the agent from this template.**"):
                        text.index("**A `needs_download` or hand-off-packet return")]
        self.assertIn("filed <path>, as made, not current law, no currency marker, made on <made_on>", template)

    def test_playbook_names_the_exception(self):
        self.assertIn("## 12. An amending instrument at the caller's URL", read(PLAYBOOK))


if __name__ == "__main__":
    unittest.main()
