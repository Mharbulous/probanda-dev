"""housekeeping-log (operations/housekeeping-log.md): the record upserts for every
outcome, the retry counting rule, the retry tick, and the lookup read, run
against a synthetic v8.8 main database."""

import importlib.util
import re
import sqlite3
import sys
import unittest
from pathlib import Path


CASE_DATA_ROOT = Path(__file__).resolve().parents[1]
SCRIPTS_DIR = CASE_DATA_ROOT / "references" / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))
SCHEMA_PATH = CASE_DATA_ROOT / "references" / "schema.sql"
OPERATION_PATH = CASE_DATA_ROOT / "operations" / "housekeeping-log.md"

spec = importlib.util.spec_from_file_location("case_data_rebuild", SCRIPTS_DIR / "rebuild.py")
rebuild = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rebuild)


def block(first_line):
    text = OPERATION_PATH.read_text(encoding="utf-8")
    for body in re.findall(r"```sql\n(.*?)```", text, re.S):
        if body.startswith(first_line):
            return body
    raise AssertionError(f"no sql block starting {first_line!r}")


SETTLED = block("-- housekeeping-log record: settled verdict")
FAILURE = block("-- housekeeping-log record: ingest failure")
RETRY = block("-- housekeeping-log retry")
LOOKUP = block("-- housekeeping-log lookup")


class HousekeepingLogTests(unittest.TestCase):
    def setUp(self):
        sections = rebuild.parse_sections(SCHEMA_PATH.read_text(encoding="utf-8"))
        self.con = sqlite3.connect(":memory:")
        self.con.executescript(sections["main"])

    def tearDown(self):
        self.con.close()

    def settle(self, file_hash, file_name, outcome, folder_type="Correspondence"):
        self.con.execute(SETTLED, {"file_hash": file_hash, "file_name": file_name,
                                   "folder_type": folder_type, "outcome": outcome})

    def fail(self, file_hash, file_name, failure_class, reason="it failed", folder_type=None):
        self.con.execute(FAILURE, {"file_hash": file_hash, "file_name": file_name,
                                   "folder_type": folder_type, "reason": reason,
                                   "failure_class": failure_class})

    def retry(self, file_hash):
        self.con.execute(RETRY, {"file_hash": file_hash})

    def rows(self):
        return self.con.execute(
            "SELECT file_hash, file_name, folder_type, outcome, reason, failure_class, "
            "retry_next_run FROM housekeeping_reviews ORDER BY review_id").fetchall()

    def retry_flag(self, file_hash, file_name):
        return self.con.execute(
            "SELECT retry_next_run FROM housekeeping_reviews "
            "WHERE file_hash = ? AND file_name = ?", (file_hash, file_name)).fetchone()[0]

    # -- settled verdicts ------------------------------------------------------

    def test_each_settled_outcome_is_recorded_with_no_failure_columns(self):
        for i, outcome in enumerate(("renamed", "manual_review", "not_ingested")):
            self.settle(f"h{i}", f"f{i}.pdf", outcome)
        self.assertEqual(self.rows(), [
            ("h0", "f0.pdf", "Correspondence", "renamed", None, None, None),
            ("h1", "f1.pdf", "Correspondence", "manual_review", None, None, None),
            ("h2", "f2.pdf", "Correspondence", "not_ingested", None, None, None),
        ])
        date = self.con.execute("SELECT date('now','localtime')").fetchone()[0]
        self.assertEqual({r[0] for r in self.con.execute(
            "SELECT reviewed_at FROM housekeeping_reviews")}, {date})

    def test_a_second_verdict_on_the_same_name_overwrites_the_first(self):
        self.settle("h", "a.pdf", "manual_review")
        self.settle("h", "a.pdf", "renamed", folder_type="Law")
        self.assertEqual(self.rows(), [("h", "a.pdf", "Law", "renamed", None, None, None)])

    def test_the_same_bytes_under_a_new_name_are_a_new_row(self):
        self.settle("h", "old.pdf", "renamed")
        self.settle("h", "new.pdf", "renamed")
        self.assertEqual(len(self.rows()), 2)

    def test_a_settled_verdict_clears_an_earlier_failure_on_that_name(self):
        self.fail("h", "a.pdf", "extractor")
        self.settle("h", "a.pdf", "not_ingested")
        self.assertEqual(self.rows(), [("h", "a.pdf", "Correspondence", "not_ingested",
                                        None, None, None)])

    # -- ingest failures and the retry counting rule ----------------------------

    def test_a_first_extractor_failure_buys_one_retry(self):
        self.fail("h", "a.pdf", "extractor", reason="malformed JSON")
        self.assertEqual(self.rows(), [("h", "a.pdf", None, "ingest_failed",
                                        "malformed JSON", "extractor", 1)])

    def test_a_first_deterministic_failure_is_never_retried(self):
        self.fail("h", "a.docx", "deterministic", reason="render failure")
        self.assertEqual(self.retry_flag("h", "a.docx"), 0)

    def test_any_later_failure_is_not_retried(self):
        self.fail("h", "a.pdf", "extractor")
        self.fail("h", "a.pdf", "extractor", reason="unavailable again")
        self.assertEqual(self.rows(), [("h", "a.pdf", None, "ingest_failed",
                                        "unavailable again", "extractor", 0)])

    def test_a_later_failure_under_another_name_counts_by_hash(self):
        self.fail("h", "a.pdf", "extractor")
        self.fail("h", "renamed by hand.pdf", "extractor")
        self.assertEqual(self.retry_flag("h", "renamed by hand.pdf"), 0)

    def test_changed_bytes_start_again_at_a_first_failure(self):
        self.fail("h", "a.pdf", "extractor")
        self.fail("h", "a.pdf", "extractor")
        self.fail("h-edited", "a.pdf", "extractor")
        self.assertEqual(self.retry_flag("h-edited", "a.pdf"), 1)

    def test_a_first_failure_on_a_file_with_a_settled_row_still_buys_a_retry(self):
        self.settle("h", "a.pdf", "renamed")
        self.fail("h", "a.pdf", "extractor", folder_type="Correspondence")
        self.assertEqual(self.rows(), [("h", "a.pdf", "Correspondence", "ingest_failed",
                                        "it failed", "extractor", 1)])

    def test_each_retry_tick_buys_exactly_one_attempt(self):
        self.fail("h", "a.pdf", "deterministic")
        self.retry("h")
        self.assertEqual(self.retry_flag("h", "a.pdf"), 1)
        self.fail("h", "a.pdf", "deterministic")  # the bought attempt failed
        self.assertEqual(self.retry_flag("h", "a.pdf"), 0)
        self.retry("h")
        self.assertEqual(self.retry_flag("h", "a.pdf"), 1)

    def test_a_retry_tick_touches_only_failure_rows(self):
        self.settle("h", "a.pdf", "renamed")
        self.retry("h")
        self.assertEqual(self.retry_flag("h", "a.pdf"), None)

    # -- lookup ------------------------------------------------------------------

    def test_lookup_reads_the_new_columns_by_hash_or_name(self):
        self.settle("h1", "a.pdf", "not_ingested")
        self.fail("h2", "b.pdf", "extractor", reason="malformed JSON")
        self.settle("h3", "c.pdf", "renamed")
        sql = LOOKUP.replace("<hash placeholders>", "?, ?").replace("<name placeholders>", "?")
        rows = self.con.execute(sql + " ORDER BY file_hash", ("h1", "h2", "c.pdf")).fetchall()
        self.assertEqual([(r[0], r[3], r[5], r[6], r[7]) for r in rows], [
            ("h1", "not_ingested", None, None, None),
            ("h2", "ingest_failed", "malformed JSON", "extractor", 1),
            ("h3", "renamed", None, None, None),
        ])


if __name__ == "__main__":
    unittest.main()
