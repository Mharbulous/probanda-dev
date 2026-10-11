"""Regression lock for research results routed to the board.

Spec `2026-10-06_research-results-to-board-spec.md`: a research question taken from a draft
carries an `Origin:`; the audit tags each offer `live_issue` and quotes each correction to the
draft's words; a caller holding no `/draft` job captures them as loose threads and relays only
the live-issue offers; `Origin: none` behaves as before.
"""
import re
import unittest
from pathlib import Path


SHARED = Path(__file__).resolve().parents[2] / "shared"

OFFER_TAG = re.compile(r" live_issue: (yes|no)$", re.MULTILINE)
ORIGIN_CORRECTION = re.compile(r"^origin-correction: (.+?) : (.+?) : (.+)$", re.MULTILINE)

# Fixture notes. Placeholder wording, no matter content.
NOTES_WITH_ORIGIN = """# Internal research notes
Flags
case-data: pinpoint : FIXTURE pinpoint missing on the instrument : doc-1
Origin
origin-correction: the FIXTURE Act provides no route : the FIXTURE Act provides a limited route : Issue 1
Offers
Would you like me to research FIXTURE point A? live_issue: yes
Would you like me to research FIXTURE point B? live_issue: no
Would you like me to research FIXTURE point C? live_issue: no
"""


def read(name):
    return (SHARED / name).read_text(encoding="utf-8")


def flat(text):
    return " ".join(text.split())


def between(text, start, end):
    begin = text.index(start)
    return text[begin:text.index(end, begin)]


def relay(notes):
    """The relay with an origin and a board: live-issue offers, then a count of the rest."""
    tags = OFFER_TAG.findall(notes)
    offers = [line for line in notes.splitlines() if OFFER_TAG.search(line)]
    kept = [line for line in offers if line.endswith("live_issue: yes")]
    rest = tags.count("no")
    return kept + [f"{rest} more offers are on the board as loose threads."]


def captures(notes):
    """One thread per correction and per offer, all pinpoint flags as one thread."""
    corrections = [m.group(0) for m in ORIGIN_CORRECTION.finditer(notes)]
    offers = [line for line in notes.splitlines() if OFFER_TAG.search(line)]
    pinpoints = [l for l in notes.splitlines() if l.startswith("case-data: pinpoint")]
    return corrections + offers + (["\n".join(pinpoints)] if pinpoints else [])


class SpawnTemplateTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.text = read("legal-research.md")

    def test_template_carries_origin(self):
        template = between(self.text, "**Spawn the agent from this template.**", "**A `needs_download`")
        self.assertIn(
            'Origin: <draft file path or Writing id>: "<the draft\'s words the question came from>" / none',
            template,
        )

    def test_origin_is_filled_only_from_a_draft(self):
        self.assertIn("Every other question carries `Origin: none`.", flat(self.text))


class AuditContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.protocol = flat(read("legal-audit-protocol.md"))

    def test_every_offer_is_tagged(self):
        step_five = between(self.protocol, "### Step 5", "### Step 6")
        self.assertIn("End every offer with ` live_issue: yes`", step_five)
        self.assertIn("never what the law is", step_five)

    def test_origin_correction_shape(self):
        step_six = between(self.protocol, "### Step 6", "## Fallback ladder")
        self.assertIn(
            "`origin-correction: <the draft's words> : <the memo's words> : <issue>`", step_six
        )
        self.assertIn("Never propose wording of your own", step_six)
        self.assertIn("With `Origin: none`, or no such place, write no `Origin` heading.", step_six)

    def test_fixture_parses(self):
        self.assertEqual(len(ORIGIN_CORRECTION.findall(NOTES_WITH_ORIGIN)), 1)
        self.assertEqual(OFFER_TAG.findall(NOTES_WITH_ORIGIN), ["yes", "no", "no"])

    def test_shim_carries_no_contract(self):
        # The twin shim's body is pinned to this one by the other plugin's own shim-contract test.
        root = Path(__file__).resolve().parents[4]
        text = (root / "source/probanda/agents/research-agent.md").read_text(encoding="utf-8")
        self.assertIn("shared/legal-audit-protocol.md", text)
        self.assertNotIn("live_issue", text)


class AfterTheAnswerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.step = flat(between(
            read("legal-research.md"),
            "**With an origin, the return's open items go on the board.**",
            "**Statute currency.**",
        ))

    def test_runs_only_with_an_origin_and_no_job(self):
        self.assertIn("was not `none` and the caller holds no `/draft` job", self.step)
        self.assertIn("A `/draft` session holding a job captures by its own rule instead", self.step)

    def test_captures_through_the_gatekeeper(self):
        self.assertIn("through `/drafting-data`'s capture with no job held", self.step)
        self.assertNotRegex(self.step, r"INSERT|seeds|SELECT")

    def test_never_assigned_never_edits(self):
        self.assertIn("never ripe, never a blocker and never assigned to anyone", self.step)
        self.assertIn("Never edit the draft.", self.step)

    def test_case_data_flags_captured_and_still_offered(self):
        self.assertIn("every `pinpoint` flag together as one thread", self.step)
        self.assertIn("is still relayed", self.step)

    def test_relay_trims_only_captured_offers(self):
        self.assertIn("`<n> more offers are on the board as loose threads.`", self.step)
        self.assertIn("Only offers that landed on the board are left out of the relay.", self.step)
        self.assertIn("relay as below with every offer", self.step)

    def test_origin_none_unchanged(self):
        self.assertIn("A return with `Origin: none` is relayed as before this step existed.", self.step)

    def test_fixture_relay_and_captures(self):
        self.assertEqual(
            relay(NOTES_WITH_ORIGIN),
            ["Would you like me to research FIXTURE point A? live_issue: yes",
             "2 more offers are on the board as loose threads."],
        )
        self.assertEqual(len(captures(NOTES_WITH_ORIGIN)), 5)


if __name__ == "__main__":
    unittest.main()
