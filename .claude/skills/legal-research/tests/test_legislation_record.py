"""Regression locks for the legislation record (spec 2026-10-05, legislation into /draft).

The gate runs the `legislation_currency` call inside duty 4, holds one record per
instrument, and relays the records in a fixed shape. `/draft` reads the record's `path`
for a provision's words and its `currency` for the release's check, and `/drafting-data`
stores the record on existing columns.
"""
import unittest
from pathlib import Path


SKILL_ROOT = Path(__file__).resolve().parents[1]
SKILLS_ROOT = SKILL_ROOT.parent
GATE = SKILLS_ROOT / "shared" / "legal-research.md"
DRAFT_REFS = SKILLS_ROOT / "draft" / "references"
CHECKLISTS = SKILLS_ROOT / "drafting-data" / "references" / "filing-checklists.md"

RECORD = "`{citation, title, path, sha256, currency_marker, currency, official}`"
RELAY = (
    "Legislation records:\n"
    "- citation: <citation> | title: <title> | path: <path> | sha256: <sha256> | "
    "currency_marker: <marker> | currency: <value> | official: <true / false> | "
    "key: <key> | provisions: <pinpoint>; <pinpoint> / none"
)
SOURCE = "legislation record (`shared/legal-research.md`, \"Statute currency.\")"


def read(path):
    return path.read_text(encoding="utf-8")


def flat(text):
    return " ".join(text.split())


class GateTests(unittest.TestCase):
    def setUp(self):
        self.text = read(GATE)
        start = self.text.index("4. **Legislation text, before the audit.**")
        self.duty = flat(self.text[start:self.text.index("**Westlaw unreachable is a hard stop.**")])

    def test_currency_dispatch_sits_in_duty_four_before_the_spawn_field(self):
        dispatch = self.duty.index("call the canlii `legislation_currency` tool once")
        self.assertLess(dispatch, self.duty.index("Record every instrument in the spawn prompt's `Legislation:` field"))

    def test_currency_dispatch_covers_every_instrument(self):
        self.assertIn("every instrument in issue, whatever the fetcher returned for it", self.duty)

    def test_duty_four_holds_the_record_from_the_manifest(self):
        self.assertIn(RECORD, self.duty)
        self.assertIn("`case-download-manifest.json`", self.duty)
        self.assertIn("`validation_unavailable` when it fails", self.duty)

    def test_statute_currency_relays_the_fixed_shape(self):
        rule = self.text[self.text.index("**Statute currency.**"):]
        self.assertIn("runs at the end of duty 4", flat(rule))
        self.assertIn(RELAY, rule)
        self.assertIn("never confirms on its own", flat(rule))


class DraftTests(unittest.TestCase):
    def test_overstatement_quotes_from_the_record_path(self):
        text = flat(read(DRAFT_REFS / "overstatement.md"))
        self.assertIn("the file at the `path` of its " + SOURCE, text)
        self.assertIn("Quote the provision from that file by its pinpoint.", text)

    def test_intake_note_up_quotes_from_the_record_path(self):
        text = flat(read(DRAFT_REFS / "job-session.md"))
        rule = text[text.index("**An intake note-up job on a statute, regulation or rule**"):]
        rule = rule[:rule.index("**Announce and proceed.**")]
        self.assertIn(SOURCE, rule)
        self.assertIn("from the file at the record's `path`", rule)
        self.assertIn("its `currency_marker` as that provision's \"current to\" date", rule)

    def test_release_uses_the_record_currency(self):
        text = flat(read(DRAFT_REFS / "CAN" / "BC" / "_NoVenue" / "Documents" / "release.md"))
        self.assertIn("the `currency` value of the enactment's " + SOURCE, text)


class DraftingDataTests(unittest.TestCase):
    def test_record_maps_onto_existing_columns(self):
        text = flat(read(CHECKLISTS))
        rule = text[text.index("**Recording a legislation record**"):]
        self.assertIn("UPDATE authorities SET url_or_locator = '<path>' WHERE id = N", rule)
        self.assertIn("is the `current_to` of every `provision_currency` row", rule)
        self.assertIn("`sha256` has no column", rule)
        self.assertIn("record one `provision_currency` row for each provision it lists", rule)


class OneCheckPerActTests(unittest.TestCase):
    """Spec 2026-10-06 research-gate preflight section 4.4: one currency check per Act."""

    KEY = ("the jurisdiction, lower-cased, then `|`, then the citation with periods removed, "
           "lower-cased and whitespace runs collapsed")

    def test_gate_checks_one_key_once_and_reuses_it_in_session(self):
        text = flat(read(GATE))
        rule = text[text.index("**One currency check per Act.**"):]
        rule = rule[:rule.index("Save all a `legislation_currency` call returns")]
        self.assertIn(self.KEY, rule)
        self.assertIn("one call checks it once", rule)
        self.assertIn("listing every provision named for it", rule)
        self.assertIn("reused, not checked again", rule)

    def test_the_tool_rules_define_the_same_key(self):
        rules = flat(read(SKILLS_ROOT / "shared" / "research-paralegal" / "legislation-currency.md"))
        self.assertIn("`key` is the jurisdiction, lower-cased, then `|`, then the citation with periods "
                      "removed, lower-cased and whitespace runs collapsed", rules)

    def test_note_up_job_checks_once_at_its_first_step(self):
        text = flat(read(DRAFT_REFS / "job-session.md"))
        rule = text[text.index("**An intake note-up job on a statute, regulation or rule**"):]
        rule = rule[:rule.index("**Announce and proceed.**")]
        self.assertIn("once, at its first step, naming every step's provision", rule)
        self.assertIn("Every later step reuses that record and checks nothing again", rule)


if __name__ == "__main__":
    unittest.main()
