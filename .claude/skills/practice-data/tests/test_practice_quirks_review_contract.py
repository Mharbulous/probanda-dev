"""The Practice quirks review of memory lines the practitioner brings."""
import re
import unittest
from pathlib import Path


SKILL_ROOT = Path(__file__).resolve().parents[1]
SKILL = (SKILL_ROOT / "operations" / "practice-quirks.md").read_text(encoding="utf-8")


def section():
    match = re.search(r"# Practice quirks\n(.*?)(?=\n## |\Z)", SKILL, re.S)
    assert match, "Practice quirks"
    return match.group(1)


def bullet(title):
    match = re.search(rf"^- \*\*{re.escape(title)}\.\*\* (.*)$", section(), re.M)
    assert match, title
    return match.group(1)


class PracticeQuirksReviewTests(unittest.TestCase):
    def test_bullets_in_order(self):
        titles = re.findall(r"^- \*\*(.+?)\.\*\*", section(), re.M)
        self.assertEqual(titles, ["Read", "Write", "Review of memory lines", "Content", "Mail routing", "Cap"])

    def test_write_names_the_review_as_a_trigger(self):
        self.assertIn("sort lines they bring from the assistant's memory", bullet("Write"))

    def test_four_bins(self):
        review = bullet("Review of memory lines")
        for name in ("*personal*", "*one matter*", "*every matter*", "*standing instruction*"):
            with self.subTest(bin=name):
                self.assertIn(name, review)

    def test_never_searches_memory(self):
        review = bullet("Review of memory lines")
        self.assertIn("brings the lines themselves", review)
        self.assertIn("never searches memory on its own", review)

    def test_write_goes_through_the_existing_route(self):
        review = bullet("Review of memory lines")
        self.assertIn('"Write" above', review)
        self.assertIn("explicit yes", review)
        self.assertIn("`practice_quirks`", review)

    def test_standing_instruction_is_never_a_note(self):
        review = bullet("Review of memory lines")
        self.assertIn("A standing instruction is never saved as a note", review)
        self.assertIn("`shared/paralegal-posture.md` section 9", review)
        self.assertIn("Never save a Rule from a memory line", review)

    def test_practitioner_removes_the_memory_line(self):
        review = bullet("Review of memory lines")
        self.assertIn("the practitioner can remove it from memory themselves", review)
        self.assertIn("Probanda does not read or edit memory", review)


if __name__ == "__main__":
    unittest.main()
