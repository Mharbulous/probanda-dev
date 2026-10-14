"""Regression lock for research results routed to the board.

Spec `2026-10-06_research-results-to-board-spec.md`: a research question taken from a draft
carries an `Origin:`; the audit tags each offer `live_issue` and quotes each correction to the
draft's words. Wherever a board resolves, the relaying session captures the corrections and
flags as loose threads and sorts every offer against the board, whatever its tag: on the
application (a research job, no question asked), off it (dropped and counted) or uncertain
(captured as a loose thread and relayed word for word). With no board every offer is relayed.
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


# The sort's class for each fixture offer, in order. The sort reads the board, never the tag:
# point C is tagged `live_issue: no` and is still relayed, because it is uncertain.
FIXTURE_SORT = ["on", "off", "uncertain"]


def offers_by_class(notes, sort, wanted):
    offers = [line for line in notes.splitlines() if OFFER_TAG.search(line)]
    return [line for line, cls in zip(offers, sort) if cls == wanted]


def relay(notes, sort):
    """The relay with a board: each uncertain offer word for word, then the count line."""
    added = len(offers_by_class(notes, sort, "on"))
    dropped = len(offers_by_class(notes, sort, "off"))
    jobs = ", ".join(f"Job #{n} (matches: FIXTURE to-do)" for n in range(1, added + 1))
    return offers_by_class(notes, sort, "uncertain") + [
        f"{added} offers added as research jobs: {jobs}. "
        f"{dropped} offers dropped as off this application."
    ]


def captures(notes, sort):
    """One thread per correction and per uncertain offer, all pinpoint flags as one thread."""
    corrections = [m.group(0) for m in ORIGIN_CORRECTION.finditer(notes)]
    pinpoints = [l for l in notes.splitlines() if l.startswith("case-data: pinpoint")]
    uncertain = offers_by_class(notes, sort, "uncertain")
    return corrections + uncertain + (["\n".join(pinpoints)] if pinpoints else [])


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
        text = (root / "source/probanda/agents/research-agent.md").read_text(encoding="utf-8")
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
        self.assertIn(
            "A research job by `/drafting-data` §3i, in the same turn, with no read-back and no question",
            self.step,
        )
        self.assertIn("Not captured, not relayed, counted", self.step)
        self.assertIn("Any doubt lands here", self.step)
        self.assertIn("Captured as a loose thread at once", self.step)
        self.assertIn("and relayed word for word", self.step)
        self.assertIn("It states no law and rewords nothing.", self.step)

    def test_relay_ends_with_the_count_and_the_add_or_drop_line(self):
        self.assertIn("2. Each uncertain offer, word for word.", self.step)
        self.assertIn(
            "`<a> offers added as research jobs: Job #N (matches: <the board words matched>), "
            "Job #M (...). <d> offers dropped as off this application.`",
            self.step,
        )
        self.assertIn(
            "One line saying they may name any relayed offer to add or drop, and that the rest "
            "stay on the board as loose threads.",
            self.step,
        )

    def test_no_board_relays_every_offer(self):
        self.assertIn(
            "When no board resolves, capture nothing, add no job, relay the confidence summary "
            "and every offer, each word for word",
            self.step,
        )

    def test_origin_none_outside_draft_unchanged(self):
        self.assertIn(
            "A return with `Origin: none` is sorted against the open board in a `/draft` session. "
            "Outside `/draft` it is relayed as before this step existed.",
            self.step,
        )

    def test_fixture_relay_and_captures(self):
        self.assertEqual(
            relay(NOTES_WITH_ORIGIN, FIXTURE_SORT),
            ["Would you like me to research FIXTURE point C? live_issue: no",
             "1 offers added as research jobs: Job #1 (matches: FIXTURE to-do). "
             "1 offers dropped as off this application."],
        )
        self.assertEqual(len(captures(NOTES_WITH_ORIGIN, FIXTURE_SORT)), 3)


if __name__ == "__main__":
    unittest.main()
