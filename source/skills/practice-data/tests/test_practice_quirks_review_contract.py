"""The Practice quirks procedure: entries, the paste step for rules, and the review of memory lines the practitioner brings."""
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
        self.assertEqual(titles, ["Entries", "Read", "Write", "Review of memory lines", "Content", "Mail routing",
                                  "Limits", "Old note"])

    def test_entries_draw_the_line_between_a_quirk_and_a_preference(self):
        entries = bullet("Entries")
        self.assertIn("A rule names no skill", entries)
        self.assertIn("is a preference", entries)

    def test_a_rule_is_saved_only_after_the_practitioner_pastes_it(self):
        write = bullet("Write")
        self.assertIn("A rule is saved only in the practitioner's own words", write)
        self.assertIn("Paste this whole block back into chat to save it.", write)
        self.assertIn('"Yes" or "Approved" never saves a rule', write)
        self.assertIn("A subagent never writes a quirk", write)

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
        self.assertIn("knowledge entry", review)
        self.assertIn("rule entry", review)

    def test_a_skills_standing_instruction_is_never_a_quirk(self):
        review = bullet("Review of memory lines")
        self.assertIn("A standing instruction for a named skill is never saved as a quirk", review)
        self.assertIn("`shared/paralegal-posture.md` section 9", review)
        self.assertIn("Never save a Rule from a memory line", review)

    def test_practitioner_removes_the_memory_line(self):
        review = bullet("Review of memory lines")
        self.assertIn("the practitioner can remove it from memory themselves", review)
        self.assertIn("Probanda does not read or edit memory", review)

    def test_the_old_note_is_migrated_and_then_cleared(self):
        old = bullet("Old note")
        self.assertIn("a non-empty write to the old note is refused", old)
        self.assertIn("`practice_quirks`, `\"\"`", old)


if __name__ == "__main__":
    unittest.main()
