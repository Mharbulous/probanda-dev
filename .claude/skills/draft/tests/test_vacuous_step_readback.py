import unittest
from pathlib import Path


JOB_SESSION = Path(__file__).resolve().parents[1] / "references" / "job-session.md"
TAKE_OVER = Path(__file__).resolve().parents[1] / "references" / "take-over.md"


def paragraph(text, opening):
    start = text.index(opening)
    end = text.find("\n", start)
    return text[start:end if end != -1 else None]


class VacuousStepReadBackTest(unittest.TestCase):
    """A step that only restates the job's title is named as naming no work, never offered for approval."""

    @classmethod
    def setUpClass(cls):
        cls.text = JOB_SESSION.read_text(encoding="utf-8")
        cls.rule = paragraph(cls.text, "**A step that only restates the title.**")

    def test_step_is_compared_with_the_title_after_normalising(self):
        self.assertIn(
            "compare each step not yet done with the job's title, ignoring case, "
            "surrounding and repeated whitespace, and trailing punctuation",
            self.rule,
        )

    def test_read_back_names_it_and_asks_how_it_should_read(self):
        self.assertIn("only restates the job's title and so names no work, then ask how it should read", self.rule)
        self.assertIn("Propose no wording.", self.rule)

    def test_no_approval_offer(self):
        self.assertIn("Never read it back as a step to approve, and never ask whether it is still right.", self.rule)
        self.assertIn("approval as stated is not offered", self.rule)

    def test_taken_over_read_back_defers_to_the_rule(self):
        taken_over = paragraph(TAKE_OVER.read_text(encoding="utf-8"), "**A taken-over job:**")
        self.assertIn(
            "Where an unfinished step only restates the title (`references/job-session.md`, "
            '"A step that only restates the title"), name it as naming no work '
            "and ask how it should read instead, never whether it is still right.",
            taken_over,
        )

    def test_multi_step_read_back_withholds_approval(self):
        multi = paragraph(self.text, "**A newly assigned job of two or more steps:**")
        self.assertIn("A step that only restates the title (above) gets no approve offer.", multi)

    def test_one_step_dispatch_is_unchanged(self):
        self.assertIn(
            "A newly assigned one-step job has no read-back and is dispatched on its recorded intent as below, unchanged.",
            self.rule,
        )
        one_step = paragraph(self.text, "**A newly assigned one-step job**")
        self.assertIn("runs on its creation approval. No pause", one_step)


if __name__ == "__main__":
    unittest.main()
