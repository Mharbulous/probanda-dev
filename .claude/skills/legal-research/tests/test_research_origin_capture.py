"""Regression lock for research results routed to the board.

Spec `2026-10-06_research-results-to-board-spec.md`: a research question taken from a draft
carries an `Origin:`; the audit tags each offer `live_issue` and quotes each correction to the
draft's words. Wherever a board resolves, the relaying session captures the corrections and
flags as loose threads and sorts every offer against the board, whatever its tag: off the
application (dropped) or on or near it (captured as a loose thread, unless the board already
holds it). Captured offers are not relayed, and with no board nothing is captured: the relay is
the answer alone.
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
matter-data: pinpoint : FIXTURE pinpoint missing on the instrument : doc-1
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


# The sort's class for each fixture offer, in order: "on" (on or near the application), "off",
# or "board" (on or near, but the duplicate test finds it already on the board). The sort reads
# the board, never the tag: point C is tagged `live_issue: no` and is still captured and relayed.
FIXTURE_SORT = ["board", "off", "on"]


def offers_by_class(notes, sort, wanted):
    offers = [line for line in notes.splitlines() if OFFER_TAG.search(line)]
    return [line for line, cls in zip(offers, sort) if cls == wanted]


def captures(notes, sort):
    """One thread per correction and per captured offer, all pinpoint flags as one thread."""
    corrections = [m.group(0) for m in ORIGIN_CORRECTION.finditer(notes)]
    pinpoints = [l for l in notes.splitlines() if l.startswith("matter-data: pinpoint")]
    captured = offers_by_class(notes, sort, "on")
    return corrections + captured +(["\n".join(pinpoints)] if pinpoints else [])


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
        root = Path(__file__).resolve().parents[4]
        text = (root / "source/researcher/agents/research-agent.md").read_text(encoding="utf-8")
        self.assertIn("shared/legal-audit-protocol.md", text)
        self.assertNotIn("live_issue", text)


class AfterTheAnswerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.step = flat(between(
            read("legal-research.md"),
            "**With a board, the return's open items are sorted against it.**",
            "**Statute currency.**",
        ))

    def test_runs_wherever_a_board_resolves(self):
        self.assertIn("for a return they persisted, wherever a board resolves", self.step)
        self.assertIn(
            "In a `/draft` session the board is the open one, whatever the spawn prompt's `Origin:` says.",
            self.step,
        )
        self.assertIn("the one `/drafting-data` §8a step 2 resolves from the origin", self.step)

    def test_captures_through_the_gatekeeper(self):
        self.assertIn("through `/drafting-data`'s capture with no job held", self.step)
        self.assertIn("A `/draft` session holding a job captures them by its own rule instead", self.step)
        self.assertNotRegex(self.step, r"INSERT|seeds|SELECT")

    def test_never_assigned_never_edits(self):
        self.assertIn("never ripe, never a blocker and never assigned to anyone", self.step)
        self.assertIn("Never edit the draft.", self.step)

    def test_corrections_and_flags_captured_and_still_offered(self):
        self.assertIn("each `origin-correction:` line in the notes, one thread each", self.step)
        self.assertIn("every `pinpoint` flag together as one thread", self.step)
        self.assertIn("is still relayed", self.step)

    def test_every_offer_is_sorted_whatever_its_tag(self):
        self.assertIn(
            "Then sort every Step 5 offer, whatever its `live_issue` tag, against the board.", self.step
        )
        self.assertIn("| Off the application |", self.step)
        self.assertIn(
            "Everything else: an offer serving the board's words, a new angle on the board's own "
            "subject, and any doubt",
            self.step,
        )
        self.assertIn("Captured as a loose thread at once", self.step)
        self.assertNotIn("relayed word for word", self.step)
        self.assertIn("It states no law and rewords nothing and creates no job.", self.step)
        self.assertIn("Captured offers are not relayed and invite nothing.", self.step)

    def test_relay_is_the_answer_alone(self):
        self.assertIn(
            "Then relay the return's `Confidence:` line, word for word, and the saved memo as its file card",
            self.step,
        )
        self.assertNotIn("offers captured as loose threads", self.step)
        self.assertNotIn("to add as a research job", self.step)

    def test_no_board_relays_the_same(self):
        self.assertIn("When no board resolves, capture nothing and relay the same.", self.step)

    def test_origin_none_outside_draft_unchanged(self):
        self.assertIn(
            "A return with `Origin: none` is sorted against the open board in a `/draft` session. "
            "Outside `/draft` it is relayed as before this step existed.",
            self.step,
        )

    def test_fixture_captures(self):
        self.assertEqual(len(captures(NOTES_WITH_ORIGIN, FIXTURE_SORT)), 3)


if __name__ == "__main__":
    unittest.main()
