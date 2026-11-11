"""No memory question about old events, and every ceremony opens with the generated coverage report."""
import unittest
from pathlib import Path

SKILLS = Path(__file__).resolve().parents[2]
TIMECAMPING = SKILLS / "timecamping" / "SKILL.md"
INFERENCE = SKILLS / "timecamping" / "reference" / "inference.md"
SHOW_ME = SKILLS / "show-me" / "SKILL.md"
DATA = SKILLS / "timecamping-data" / "SKILL.md"


def read(path):
    return path.read_text(encoding="utf-8")


class Ceremony(unittest.TestCase):
    def test_no_recall_wording(self):
        for path in (TIMECAMPING, INFERENCE):
            text = read(path).lower()
            for phrase in ("do you remember", "light elicitation", "don't remember"):
                self.assertNotIn(phrase, text, f"{phrase!r} in {path.name}")

    def test_step_6_names_the_coverage_report_once(self):
        text = read(TIMECAMPING)
        step6 = text[text.index("### Step 6"):text.index("### Step 7")]
        self.assertEqual(step6.count("coverage_report.py"), 1)

    def test_show_me_rule_4(self):
        text = read(SHOW_ME)
        self.assertNotIn("Why unavailable", text)
        for needle in ("60 hours", "without reminders", "unknowable"):
            self.assertIn(needle, text)

    def test_p6_still_defaults_to_tbd(self):
        text = read(INFERENCE)
        self.assertIn("**t.b.d.**", text)
        self.assertIn("t.b.d. is the default, not the terminus", text)

    def test_coverage_read_carries_row_count_and_names_the_script(self):
        text = read(DATA)
        self.assertIn("row_count, error_detail", text)
        self.assertIn("coverage_report.py", text)


if __name__ == "__main__":
    unittest.main()
