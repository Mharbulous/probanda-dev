"""Case-data flags in a research return: a contradicted record is corrected first, every
other flag is captured first, and a flag becomes a blocker job only when the practitioner asks.

Spec `2026-10-05_audit-flags-to-draft-jobs-spec.md`, as changed by e7eab6b (no blocker
unasked) and 3502a12 (correct a record a primary source contradicts).
"""
import re
import unittest
from pathlib import Path


DRAFT = Path(__file__).resolve().parents[1]
JOB_SESSION = DRAFT / "references" / "job-session.md"
FLAG_LINE = re.compile(
    r"^case-data: (discrepancy|correction|pinpoint) : (.+?) : (.+)$", re.MULTILINE
)

# Fixture notes. Placeholder wording, no matter content.
NOTES = """# Internal research notes
Flags
case-data: discrepancy : FIXTURE copies A and B differ on term 3 : doc-1, doc-2
case-data: pinpoint : FIXTURE add para 14 to fact 9 : ev-9
case-data: pinpoint : FIXTURE add para 22 to fact 11 : ev-11
"""
NOTES_NO_FLAGS = "# Internal research notes\n"


def flat(text):
    return " ".join(text.split())


def rule():
    text = JOB_SESSION.read_text(encoding="utf-8")
    start = text.index("- **Case-data flags in a research return:**")
    return flat(text[start:text.index("\n", start)])


def handle(notes, covered=(), asked=()):
    """The rule's mechanics: corrections first, captured ideas, then blockers only where asked.

    `covered` names the descriptions of `correction` or `discrepancy` flags that SKILL.md
    rule 9 covers; `asked` names the descriptions the practitioner says this job must wait on.
    """
    flags = FLAG_LINE.findall(notes)
    corrected = [f for f in flags if f[0] != "pinpoint" and f[1] in covered]
    rest = [f for f in flags if f not in corrected]
    pinpoints = [f for f in rest if f[0] == "pinpoint"]
    others = [f for f in rest if f[0] != "pinpoint"]
    ideas = ([pinpoints] if pinpoints else []) + [[f] for f in others]
    blockers = [
        (
            f"Resolve the matter-data {kind}: {description} : {evidence}",
            f"What should case data record? {description} : {evidence}",
        )
        for kind, description, evidence in rest
        if description in asked
    ]
    return corrected, ideas, blockers


class CaseDataFlagJobTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.rule = rule()

    def test_a_contradicted_record_is_corrected_first(self):
        self.assertIn(
            "For each `correction` or `discrepancy` flag, first read the source its evidence "
            "ids name: where SKILL.md rule 9 covers the flag, correct the record",
            self.rule,
        )
        self.assertIn("and capture nothing.", self.rule)
        corrected, ideas, blockers = handle(
            NOTES, covered=("FIXTURE copies A and B differ on term 3",)
        )
        self.assertEqual(len(corrected), 1)
        self.assertEqual(len(ideas), 1)
        self.assertEqual(blockers, [])

    def test_capture_comes_first_with_pinpoints_together(self):
        self.assertIn(
            'For every other flag, capture comes first (SKILL.md section 14, "Captured ideas")',
            self.rule,
        )
        self.assertIn(
            "every `pinpoint` flag together as one idea, and each other flag as its own.",
            self.rule,
        )
        self.assertIn("and the job carries on.", self.rule)

    def test_no_blocker_is_proposed_unless_the_practitioner_asks(self):
        self.assertIn(
            "No blocker is proposed unasked: a flag becomes a blocker only when the "
            "practitioner says this job must wait on it",
            self.rule,
        )
        self.assertIn("Then take the Spin off path above for that flag.", self.rule)
        self.assertIn("The rest is the Spin off path unchanged.", self.rule)
        corrected, ideas, blockers = handle(NOTES)
        self.assertEqual((len(corrected), len(ideas), blockers), (0, 2, []))

    def test_frames_are_fixed(self):
        self.assertIn("title `Resolve the case-data <kind>: <flag>`", self.rule)
        self.assertIn("intent `What should case data record? <flag>`", self.rule)
        self.assertIn("say they come from the research return", self.rule)

    def test_case_data_stays_the_writer_and_no_law_is_stated(self):
        self.assertIn("records the answer through `/matter-data`", self.rule)
        self.assertIn("the session states no law", self.rule)

    def test_an_asked_discrepancy_proposes_one_blocker_in_the_flags_words(self):
        corrected, ideas, blockers = handle(
            NOTES, asked=("FIXTURE copies A and B differ on term 3",)
        )
        self.assertEqual(corrected, [])
        self.assertEqual(len(ideas), 2)
        self.assertEqual(
            blockers,
            [
                (
                    "Resolve the matter-data discrepancy: FIXTURE copies A and B differ "
                    "on term 3 : doc-1, doc-2",
                    "What should case data record? FIXTURE copies A and B differ "
                    "on term 3 : doc-1, doc-2",
                )
            ],
        )

    def test_no_flags_changes_nothing(self):
        self.assertIn("A return with no `case-data:` line changes nothing.", self.rule)
        self.assertEqual(handle(NOTES_NO_FLAGS), ([], [], []))


if __name__ == "__main__":
    unittest.main()
