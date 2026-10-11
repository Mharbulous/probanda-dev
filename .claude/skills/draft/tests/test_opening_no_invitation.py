import unittest
from pathlib import Path


DISPATCH = Path(__file__).resolve().parents[1] / "references" / "dispatch.md"
PROCEDURE = Path(__file__).resolve().parents[1] / "references" / "procedure.md"


def paragraph(text, opening):
    start = text.index(opening)
    end = text.find("\n", start)
    return text[start:end if end != -1 else None]


class OpeningAddsNothingTest(unittest.TestCase):
    """A bare /draft that dispatches nothing says only the skill's lines (#1369)."""

    @classmethod
    def setUpClass(cls):
        cls.text = DISPATCH.read_text(encoding="utf-8")
        cls.procedure = PROCEDURE.read_text(encoding="utf-8")

    def test_opening_waits_without_inviting_a_reply(self):
        opening = paragraph(self.text, "**Opening.**")
        self.assertIn("When nothing was dispatched, wait, with no line inviting a reply", opening)
        self.assertIn("The reply routes below.", opening)

    def test_reply_options_sentence_is_gone(self):
        self.assertNotIn("The practitioner can name a job from the board", self.text)

    def test_idle_report_exclusion_is_limited_to_the_idle_report(self):
        idle = paragraph(self.text, "**Idle report.**")
        self.assertNotIn("is not mentioned", idle)
        self.assertIn(
            "A job without the tag gets no idle line "
            "and no remark on whether it is idle",
            idle,
        )

    def test_skip_line_still_names_a_recent_job(self):
        idle = paragraph(self.text, "**Idle report.**")
        self.assertIn("a Dispatch skip line still names it", idle)

    def test_fast_open_step_3_says_no_board_unchanged_line(self):
        step3 = paragraph(self.procedure, "3. **At most one more line.**")
        self.assertIn("Otherwise say nothing, not even that the board is unchanged.", step3)


if __name__ == "__main__":
    unittest.main()
