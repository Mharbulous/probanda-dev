import re
import unittest
from pathlib import Path


DRAFT = Path(__file__).resolve().parents[1]
SKILL = DRAFT / "SKILL.md"
DISPATCH = DRAFT / "references" / "dispatch.md"
BCSC = DRAFT / "references" / "CAN" / "BC" / "BCSC"
NOA_TYPE_FILE = BCSC / "Documents" / "notice-of-application.md"
BCSC_VENUE = BCSC / "venue.md"

# Fixture research returns. Placeholder wording, not a statement of any real amendment.
RETURN_FIRES = (
    "FIXTURE: an amending regulation now in force replaced Form 32 "
    "and rewrote r. 8-1 of the Supreme Court Civil Rules."
)
RETURN_SILENT = "FIXTURE: an amending regulation now in force replaced Form 999."


def paragraph(text, opening):
    start = text.index(opening)
    end = text.find("\n\n", start)
    return text[start:end if end != -1 else None]


def section(text, opening):
    """The paragraph that opens with `opening`, through its list and closing paragraph."""
    start = text.index(opening)
    end = text.find("\n## ", start)
    return text[start:end if end != -1 else None]


def named_rules_and_forms(text):
    forms = {f"Form {n}" for n in re.findall(r"\bForm (\d+)\b", text)}
    rules = set(re.findall(r"\b(?:r\.|[Rr]ule)\s*(\d+-\d+)\b", text))
    return forms, rules


def files_the_trigger_fires_on(research_return, files):
    """The trigger's mechanical test: a loaded file names a rule or form the return names."""
    forms, rules = named_rules_and_forms(research_return)
    fired = []
    for path in files:
        text = path.read_text(encoding="utf-8")
        names_form = any(re.search(rf"\b{re.escape(f)}\b", text) for f in forms)
        names_rule = any(re.search(rf"(?<![\d-]){re.escape(r)}(?![\d-])", text) for r in rules)
        if names_form or names_rule:
            fired.append(path)
    return fired


class ForumProcedureChangeTriggerTest(unittest.TestCase):
    """A research return reporting an in-force forum amendment refreshes the templates (fix 6)."""

    @classmethod
    def setUpClass(cls):
        cls.text = SKILL.read_text(encoding="utf-8")
        cls.rule = section(DISPATCH.read_text(encoding="utf-8"), "**Forum-procedure change.**")

    def test_trigger_fires_on_the_notice_of_application_type_file(self):
        fired = files_the_trigger_fires_on(RETURN_FIRES, [NOA_TYPE_FILE, BCSC_VENUE])
        self.assertIn(NOA_TYPE_FILE, fired)

    def test_trigger_stays_silent_when_no_loaded_file_names_the_form(self):
        self.assertEqual(
            files_the_trigger_fires_on(RETURN_SILENT, [NOA_TYPE_FILE, BCSC_VENUE]), []
        )

    def test_trigger_condition_is_stated(self):
        self.assertIn(
            "reports an amendment in force that replaces or changes a rule or form "
            "named in the open Writing's type file or its `venue.md`, "
            "a captured idea alone is not enough. Capture still comes first.",
            self.rule,
        )

    def test_source_check_runs_on_both_files(self):
        self.assertIn(
            "Run the per-file source check (section 3) on the type file and on `venue.md`",
            self.rule,
        )
        source_check = paragraph(self.text, "| Per-file source check |")
        self.assertIn(
            "again when a research return reports an amendment in force to a rule or form "
            "that file names (section 14, \"Forum-procedure change\")",
            source_check,
        )

    def test_localize_refresh_is_offered_whatever_the_check_reports(self):
        self.assertIn("Steps 2 and 3 run whatever it reports", self.rule)
        self.assertIn(
            "Offer `/localize` with `operation: refresh` on each of those files "
            "that names the rule or form",
            self.rule,
        )
        self.assertIn("run it only on the practitioner's yes", self.rule)

    def test_a_job_goes_on_the_board(self):
        self.assertIn("**Put a job on the board.**", self.rule)
        self.assertIn("title `Conform to the amendment: <amendment>`", self.rule)
        self.assertIn(
            "intent `What in this filing must change for this amendment? <amendment>`",
            self.rule,
        )
        self.assertIn("take the Spin off path", self.rule)
        self.assertIn("Holding none: outline it here", self.rule)

    def test_no_law_is_stated(self):
        self.assertIn("the session states no law", self.rule)


if __name__ == "__main__":
    unittest.main()
