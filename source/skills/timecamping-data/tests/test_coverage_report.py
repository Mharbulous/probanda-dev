"""coverage_report.py on an invented source log: what is present, missing and unknowable for a date."""
import contextlib
import io
import json
import re
import sys
import tempfile
import unittest
from pathlib import Path

SKILL = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SKILL / "scripts"))
import coverage_report  # noqa: E402

DAY = "2030-01-10"
LOG = [
    {"source_name": "timecamp_time_entries", "local_date": DAY, "status": "fetched", "row_count": 14, "error_detail": None, "fetched_at": "x"},
    {"source_name": "syncopaid_captures", "local_date": DAY, "status": "empty", "row_count": 0, "error_detail": None, "fetched_at": "x"},
    {"source_name": "telus_calls", "local_date": DAY, "status": "skipped", "row_count": 0,
     "error_detail": "unavailable: call logs not uploaded for this period", "fetched_at": "x"},
    {"source_name": "sent_mail", "local_date": DAY, "status": "skipped", "row_count": 0, "error_detail": None, "fetched_at": "x"},
    {"source_name": "icloud_events", "local_date": "2030-01-11", "status": "fetched", "row_count": 4, "error_detail": None, "fetched_at": "x"},
]


class Report(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.path = Path(tmp.name) / "coverage.json"
        self.path.write_text(json.dumps(LOG), encoding="utf-8")

    def run_report(self, *dates):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.assertEqual(coverage_report.main(["--coverage", str(self.path), "--date", *dates]), 0)
        return out.getvalue()

    def section(self, text, name):
        match = re.search(rf"^{name}\b.*?\n(.*?)(?=^\S|\Z)", text, re.S | re.M)
        self.assertIsNotNone(match, f"no {name} section in:\n{text}")
        return match.group(1)

    def test_present_holds_fetched_and_empty_with_counts(self):
        present = self.section(self.run_report(DAY), "PRESENT")
        self.assertIn("  timecamp_time_entries: fetched, 14 rows\n", present)
        self.assertIn("  syncopaid_captures: empty, 0 rows\n", present)

    def test_missing_holds_the_reason_verbatim_and_not_fetched(self):
        missing = self.section(self.run_report(DAY), "MISSING")
        self.assertIn("  telus_calls: skipped. unavailable: call logs not uploaded for this period\n", missing)
        self.assertIn("  gcal_events: not fetched\n", missing)

    def test_a_null_reason_prints_no_reason_recorded(self):
        missing = self.section(self.run_report(DAY), "MISSING")
        self.assertIn("  sent_mail: skipped. no reason recorded\n", missing)

    def test_unknowable_names_the_computer_in_use(self):
        unknowable = self.section(self.run_report(DAY), "UNKNOWABLE")
        self.assertIn("which computer was in use", unknowable)

    def test_never_suggests_another_device(self):
        for line in self.run_report(DAY, "2030-01-11").splitlines():
            self.assertNotIn("another device", line.lower())

    def test_two_dates_print_two_blocks(self):
        text = self.run_report(DAY, "2030-01-11")
        blocks = text.strip().split("\n\n")
        self.assertEqual([b.splitlines()[0] for b in blocks], [f"COVERAGE {DAY}", "COVERAGE 2030-01-11"])
        self.assertIn("icloud_events: fetched, 4 rows", blocks[1])

    def test_a_coverage_file_that_is_not_an_array_exits_2(self):
        self.path.write_text(json.dumps({"rows": LOG}), encoding="utf-8")
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as stopped:
            coverage_report.main(["--coverage", str(self.path), "--date", DAY])
        self.assertEqual(stopped.exception.code, 2)

    def test_expected_matches_the_assembly_gate(self):
        splice = (SKILL / "references" / "splice.sql").read_text(encoding="utf-8")
        block = re.search(r"expected_sources\(source_name, alias\) AS \(\s*VALUES(.*?)\n\)", splice, re.S).group(1)
        self.assertEqual(list(coverage_report.EXPECTED), re.findall(r"\('(\w+)',", block))


if __name__ == "__main__":
    unittest.main()
