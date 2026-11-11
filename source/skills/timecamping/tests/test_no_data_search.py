"""A stretch is no data only after a verified, narrowed search (practitioner, 2026-11-11)."""
import unittest
from pathlib import Path

SKILLS = Path(__file__).resolve().parents[2]
TIMECAMPING = SKILLS / "timecamping" / "SKILL.md"
INFERENCE = SKILLS / "timecamping" / "reference" / "inference.md"
TRIAGE = SKILLS / "triage-billing-dates" / "SKILL.md"

SECTION = "## Step 6: a no-data stretch"


def read(path):
    return path.read_text(encoding="utf-8")


def no_data_section():
    text = read(INFERENCE)
    start = text.index(SECTION)
    end = text.index("\n## ", start + len(SECTION))
    return " ".join(text[start:end].split())


class NoDataSearch(unittest.TestCase):
    def test_grid_row_points_to_the_search(self):
        text = read(TIMECAMPING)
        step6 = text[text.index("### Step 6"):text.index("### Step 7")]
        row = next(line for line in step6.splitlines() if line.startswith("| No data"))
        self.assertIn("verified", row)
        self.assertIn("a no-data stretch", row)
        self.assertIn("t.b.d.", row)

    def test_missing_source_is_not_absence(self):
        section = no_data_section()
        self.assertIn("MISSING", section)
        self.assertIn("is not an absence", section)

    def test_search_is_narrowed_to_the_days_files(self):
        section = no_data_section()
        for needle in ("3 or 4", "even a minute", "never the whole practice"):
            self.assertIn(needle, section)

    def test_what_is_searched(self):
        section = no_data_section()
        for needle in (
            "court",
            "site visit",
            "witness meeting",
            "Calendars",
            "sent and received",
            "3 days before",
            "3 days after",
            "disbursements",
            "receipts",
            "courthouse parking",
        ):
            self.assertIn(needle, section)

    def test_reuses_triage_phase_2(self):
        section = no_data_section()
        self.assertIn("/triage-billing-dates", section)
        self.assertIn("Phase 2", section)
        triage = read(TRIAGE)
        for bullet in ("**Mail, deduplicated across all folders**", "**Documents, in every matter folder that holds work**", "**Calendar**"):
            self.assertIn(bullet, triage)

    def test_found_evidence_is_asked_about_never_memory(self):
        section = no_data_section()
        self.assertIn("show-me rule 4", section)
        self.assertIn("never about memory", section)

    def test_nothing_found_is_a_tbd_glitch_ceremony(self):
        section = no_data_section()
        self.assertIn("technical glitch", section)
        self.assertIn("SyncoPaid or TimeCamp", section)
        self.assertIn("**t.b.d.**", section)
        self.assertIn("2026-11-11", section)


if __name__ == "__main__":
    unittest.main()
