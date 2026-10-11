"""Regression lock for case-data flags: the audit notes' fixed shape and the gate's relay.

Spec `2026-10-05_audit-flags-to-draft-jobs-spec.md`: every case-data flag in an audit
return reaches the practitioner as a proposed action. The audit agent writes each flag
in one fixed line, the gate relays each in one line with the offer to record it, and a
`/draft` session holding a job takes its own rule instead.
"""
import re
import unittest
from pathlib import Path


SHARED = Path(__file__).resolve().parents[2] / "shared"
SHAPE = "`case-data: <kind> : <short description> : <evidence ids>`"
FLAG_LINE = re.compile(
    r"^case-data: (discrepancy|correction|pinpoint) : (.+?) : (.+)$", re.MULTILINE
)

# Fixture notes. Placeholder wording, no matter content.
NOTES_ONE_DISCREPANCY = """# Internal research notes
Flags
case-data: discrepancy : FIXTURE copies A and B of the instrument differ on term 3 : doc-1, doc-2
/ingest: FIXTURE decision file
"""
NOTES_NO_FLAGS = """# Internal research notes
/ingest: FIXTURE decision file
"""


def read(name):
    return (SHARED / name).read_text(encoding="utf-8")


def flat(text):
    return " ".join(text.split())


def between(text, start, end):
    begin = text.index(start)
    return text[begin:text.index(end, begin)]


def relay_lines(notes):
    """The gate's relay: one line per flag, with the offer to record it."""
    return [
        f"{kind}: {description} ({evidence}). Record it through /case-data?"
        for kind, description, evidence in FLAG_LINE.findall(notes)
    ]


class FlagShapeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.step_six = flat(
            between(read("legal-audit-protocol.md"), "### Step 6", "## Fallback ladder")
        )

    def test_notes_carry_every_case_data_flag(self):
        self.assertIn(
            "every `/ingest` and `/consolidation-push` flag, every case-data flag, "
            "and the Step 5 offers",
            self.step_six,
        )

    def test_shape_is_fixed(self):
        self.assertIn(f"Write each on one line under a `Flags` heading, in exactly this shape: {SHAPE}", self.step_six)
        self.assertIn("`discrepancy`, `correction` or `pinpoint`", self.step_six)

    def test_flag_states_no_law_and_writes_nothing(self):
        self.assertIn(
            "A flag says what the record shows, never what the law is, "
            "and you never record it yourself.",
            self.step_six,
        )


class GateRelayTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.after = flat(
            between(read("legal-research.md"), "**After the answer", "**Statute currency.**")
        )

    def test_each_flag_is_relayed_in_one_line_with_the_offer(self):
        self.assertIn(
            "Relay each `case-data:` flag in the return's notes in one line: its kind, "
            "its description and its evidence ids, with the offer to record it through "
            "`/case-data`. Record nothing without the practitioner's yes.",
            self.after,
        )

    def test_a_draft_job_takes_its_own_rule(self):
        self.assertIn(
            "A `/draft` session holding a job handles them by its own rule instead "
            "(`/draft` `references/job-session.md`, \"Case-data flags in a research return\")",
            self.after,
        )

    def test_one_discrepancy_flag_relays_one_line(self):
        self.assertEqual(
            relay_lines(NOTES_ONE_DISCREPANCY),
            [
                "discrepancy: FIXTURE copies A and B of the instrument differ on term 3 "
                "(doc-1, doc-2). Record it through /case-data?"
            ],
        )

    def test_no_flags_relays_nothing(self):
        self.assertIn("A return with no flag adds no line.", self.after)
        self.assertEqual(relay_lines(NOTES_NO_FLAGS), [])


if __name__ == "__main__":
    unittest.main()
