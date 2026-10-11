"""Case-data flags in a research return become proposed blocker jobs on a held job.

Spec `2026-10-05_audit-flags-to-draft-jobs-spec.md`, with the practitioner's 2026-10-05
decision that `pinpoint` flags are captured together as one idea and never block.
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


def handle(notes):
    """The rule's mechanics: captured ideas, then one proposed blocker per non-pinpoint flag."""
    flags = FLAG_LINE.findall(notes)
    pinpoints = [f for f in flags if f[0] == "pinpoint"]
    others = [f for f in flags if f[0] != "pinpoint"]
    ideas = ([pinpoints] if pinpoints else []) + [[f] for f in others]
    blockers = [
        (
            f"Resolve the case-data {kind}: {description} : {evidence}",
            f"What should case data record? {description} : {evidence}",
        )
        for kind, description, evidence in others
    ]
    return ideas, blockers


class CaseDataFlagJobTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.rule = rule()

    def test_capture_comes_first_with_pinpoints_together(self):
        self.assertIn('Capture comes first (SKILL.md section 14, "Captured ideas")', self.rule)
        self.assertIn(
            "every `pinpoint` flag together as one idea, and each other flag as its own. "
            "A `pinpoint` flag ends there, and the job carries on.",
            self.rule,
        )

    def test_discrepancy_and_correction_take_the_spin_off_path(self):
        self.assertIn(
            "Each `discrepancy` or `correction` flag is separate work this job must wait on",
            self.rule,
        )
        self.assertIn("take the Spin off path above without being asked", self.rule)
        self.assertIn("The rest is the Spin off path unchanged.", self.rule)

    def test_frames_are_fixed(self):
        self.assertIn("title `Resolve the case-data <kind>: <flag>`", self.rule)
        self.assertIn("intent `What should case data record? <flag>`", self.rule)
        self.assertIn("say they come from the research return", self.rule)

    def test_case_data_stays_the_writer_and_no_law_is_stated(self):
        self.assertIn("records the answer through `/case-data`", self.rule)
        self.assertIn("the session states no law", self.rule)

    def test_one_discrepancy_proposes_one_blocker_in_the_flags_words(self):
        ideas, blockers = handle(NOTES)
        self.assertEqual(len(ideas), 2)
        self.assertEqual(
            blockers,
            [
                (
                    "Resolve the case-data discrepancy: FIXTURE copies A and B differ "
                    "on term 3 : doc-1, doc-2",
                    "What should case data record? FIXTURE copies A and B differ "
                    "on term 3 : doc-1, doc-2",
                )
            ],
        )

    def test_no_flags_changes_nothing(self):
        self.assertIn("A return with no `case-data:` line changes nothing.", self.rule)
        self.assertEqual(handle(NOTES_NO_FLAGS), ([], []))


if __name__ == "__main__":
    unittest.main()
