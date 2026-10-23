"""A bare /ingest is a report-only scan (operations/extract-facts.md §8). These
checks pin that the mode writes nothing, asks nothing, names no folder, reuses
the scan's classification rather than restating it, and is reachable from the
ingest skill and the router."""

import re
import unittest
from pathlib import Path


CASE_DATA_ROOT = Path(__file__).resolve().parents[1]
SCAN = (CASE_DATA_ROOT / "operations" / "extract-facts.md").read_text(encoding="utf-8")
REPORT_ONLY = SCAN.split("\n## 8. Report-only mode", 1)[1].split("\n## ", 1)[0]
ROUTER = (CASE_DATA_ROOT / "SKILL.md").read_text(encoding="utf-8")
INGEST = (CASE_DATA_ROOT.parent / "ingest" / "SKILL.md").read_text(encoding="utf-8")


class BareIngestReportContractTests(unittest.TestCase):
    def test_report_only_mode_writes_nothing_and_asks_nothing(self):
        self.assertIn("writes nothing and asks nothing", REPORT_ONLY)
        for word in ("matter_data__execute", "AskUserQuestion", "file_ops__", "Prompt"):
            with self.subTest(word=word):
                self.assertNotIn(word, REPORT_ONLY)

    def test_report_only_mode_names_no_folder(self):
        self.assertIsNone(re.search(r"\b\d+\.\s+[A-Z]{2,}", REPORT_ONLY))
        self.assertIsNone(re.search(r"\bRAW\b|\bDRAFT\b|CASEMAP", REPORT_ONLY))

    def test_report_only_mode_reuses_the_scan_semantics(self):
        for name in ("find_candidate_sources", "`classify`", "`candidates`"):
            self.assertIn(name, REPORT_ONLY)
        self.assertNotIn("SELECT", REPORT_ONLY)
        self.assertNotIn("```", REPORT_ONLY)

    def test_report_names_each_disposition(self):
        for word in ("new", "changed", "duplicate", "superseded", "partial", "corrupt",
                     "non-ingestable"):
            with self.subTest(word=word):
                self.assertIn(word, REPORT_ONLY)

    def test_bare_ingest_routes_to_the_report_only_mode(self):
        self.assertRegex(INGEST, r"0\. \*\*No document or folder named: scan, report, ingest nothing\.\*\*")
        self.assertIn("report-only scan of the whole matter", INGEST)
        row = next(line for line in ROUTER.splitlines() if line.startswith("| Bare `/ingest`"))
        self.assertIn("operations/extract-facts.md §8", row)


if __name__ == "__main__":
    unittest.main()
