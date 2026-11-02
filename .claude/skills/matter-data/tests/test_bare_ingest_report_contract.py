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

    def test_says_not_yet_ingested_throughout(self):
        for text in (REPORT_ONLY, INGEST, ROUTER):
            self.assertIn("not yet ingested", text)
            self.assertNotIn("not yet held", text)
            self.assertNotIn("does not hold yet", text)

    def test_report_ends_with_one_proposal_stated_once(self):
        last_bullet = REPORT_ONLY.rstrip().rsplit("\n   - ", 1)[1]
        self.assertTrue(last_bullet.startswith("**One proposal, last, as a statement.**"))
        self.assertIn("With 19 or fewer in all, propose all of them as one batch", last_bullet)
        self.assertIn("the first folder, in the order below, with 20 or more", last_bullet)
        self.assertIn("With no such folder, propose all of them together", last_bullet)
        self.assertIn("An all-files batch is handed over in this same order", last_bullet)
        self.assertEqual(len(re.findall(r"\b19\b", REPORT_ONLY)), 1)
        self.assertEqual(len(re.findall(r"\b20\b", REPORT_ONLY)), 1)

    def test_priority_order_is_by_type_with_no_type_last(self):
        order = ("client communications", "retainer and billing", "opposing lawyers",
                 "court filings", "witnesses and experts", "searches", "work product",
                 "trial materials", "disbursement records", "documents exchanged",
                 "authorities", "any folder the map gives no type")
        positions = [REPORT_ONLY.index(name) for name in order]
        self.assertEqual(positions, sorted(positions))
        self.assertIn("listed and produced", REPORT_ONLY)
        self.assertIn("raw and unreviewed", REPORT_ONLY)

    def test_step_zero_relays_the_proposal(self):
        self.assertIn("ending with its proposal", INGEST)
        self.assertNotIn("The practitioner then names what to ingest", INGEST)

    def test_bare_ingest_routes_to_the_report_only_mode(self):
        self.assertRegex(INGEST, r"0\. \*\*No document or folder named: scan, report, ingest nothing\.\*\*")
        self.assertIn("report-only scan of the whole matter", INGEST)
        row = next(line for line in ROUTER.splitlines() if line.startswith("| Bare `/ingest`"))
        self.assertIn("operations/extract-facts.md §8", row)


if __name__ == "__main__":
    unittest.main()
