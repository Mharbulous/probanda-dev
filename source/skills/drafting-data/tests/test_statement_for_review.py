"""Tests for statement_for_review.py, the read-only statement read behind
drafting_forms__draft_harness's scrutiny_review step (references/scrutiny.md).

Run: python -m pytest source/skills/drafting-data/tests/test_statement_for_review.py -q
"""

import hashlib
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parents[1] / "references" / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))

import migrate_engine as engine  # noqa: E402
import statement_for_review  # noqa: E402

FINDING = ("Scrutiny failed 2026-10-02: para 16 states the test for a summary trial, not the "
           "proposition. Answer: 6. LAW\\Summary Judgment\\research-lawyer answer v11.md, "
           "and see 6. LAW\\other.md.")

SEED = f"""
INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L8443', 'CAN/BC/BCCA'),
                                                             (2, 'L8443', 'CAN/BC/BCSC');
INSERT INTO authorities (id, proceeding_id, style_of_cause_or_title, citation, kind)
VALUES (1, 1, 'Bockhold v CIBC Wood Gundy', '2026 BCCA 74', 'case'),
       (2, 1, 'Hryniak v Mauldin', '2014 SCC 7', 'case'),
       (3, 2, 'Other v Proceeding', '2020 BCSC 1', 'case');
INSERT INTO law_assertions (id, proceeding_id, proposition)
VALUES (1, 1, 'Summary judgment is available where there is no genuine issue for trial.');
INSERT INTO statements_of_law (id, proceeding_id, law_assertion_id, authority_id, pinpoint,
                               excerpt, doubt, verification)
VALUES (1, 1, 1, 1, 'para 16', 'The stored excerpt.', '{FINDING.replace("'", "''")}', 'failed'),
       (2, 1, NULL, 2, 'para 49', NULL, NULL, 'lead');
"""


class StatementForReviewTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Migrating takes seconds, so one seeded database is built and each test reads a copy.
        cls._template_dir = tempfile.TemporaryDirectory()
        cls.template = Path(cls._template_dir.name) / "submission.sqlite"
        engine.run({"db_path": str(cls.template)})
        con = sqlite3.connect(cls.template)
        try:
            con.executescript(SEED)
            con.commit()
        finally:
            con.close()

    @classmethod
    def tearDownClass(cls):
        cls._template_dir.cleanup()

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.db_path = Path(self._tmp.name) / "L8443 Example" / "submission.sqlite"
        self.db_path.parent.mkdir()
        self.db_path.write_bytes(self.template.read_bytes())
        self.before = hashlib.sha256(self.db_path.read_bytes()).hexdigest()

    def tearDown(self):
        self.assertEqual(hashlib.sha256(self.db_path.read_bytes()).hexdigest(), self.before,
                         "the read changed the database")

    def read(self, statement_id, proposed_authority_id=None):
        return statement_for_review.run({"db_path": str(self.db_path), "statement_id": statement_id,
                                         "proposed_authority_id": proposed_authority_id})

    def test_a_failed_statement_reads_with_its_authority_finding_and_answer_file(self):
        result = self.read(1)
        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["statement"], {
            "id": 1,
            "proposition": "Summary judgment is available where there is no genuine issue for trial.",
            "authority": {"id": 1, "title": "Bockhold v CIBC Wood Gundy", "citation": "2026 BCCA 74",
                          "kind": "case"},
            "pinpoint": "para 16",
            "verification": "failed",
        })
        self.assertEqual(result["excerpt"], "The stored excerpt.")
        self.assertEqual(result["finding"], FINDING)
        self.assertEqual(result["answer_file_named"],
                         "6. LAW\\Summary Judgment\\research-lawyer answer v11.md")
        self.assertNotIn("proposed_authority", result)

    def test_a_finding_naming_no_answer_file_reads_null(self):
        con = sqlite3.connect(self.db_path)
        try:
            con.execute("UPDATE statements_of_law SET doubt = 'Scrutiny failed 2026-10-02: wrong para.' "
                        "WHERE id = 1")
            con.commit()
        finally:
            con.close()
        self.before = hashlib.sha256(self.db_path.read_bytes()).hexdigest()
        self.assertIsNone(self.read(1)["answer_file_named"])

    def test_an_answer_file_path_with_an_apostrophe_is_read_whole(self):
        con = sqlite3.connect(self.db_path)
        try:
            con.execute("UPDATE statements_of_law SET doubt = ? WHERE id = 1",
                        ("Scrutiny failed: wrong para. Answer: "
                         "6. LAW\\Plaintiff's authorities\\research-lawyer answer v3.md.",))
            con.commit()
        finally:
            con.close()
        self.before = hashlib.sha256(self.db_path.read_bytes()).hexdigest()
        self.assertEqual(self.read(1)["answer_file_named"],
                         "6. LAW\\Plaintiff's authorities\\research-lawyer answer v3.md")

    def test_a_proposed_authority_of_the_same_proceeding_is_returned(self):
        result = self.read(1, proposed_authority_id=2)
        self.assertEqual(result["proposed_authority"],
                         {"id": 2, "title": "Hryniak v Mauldin", "citation": "2014 SCC 7", "kind": "case"})

    def test_a_proposed_authority_of_another_proceeding_is_not_found(self):
        self.assertEqual(self.read(1, proposed_authority_id=3)["status"], "proposed_authority_not_found")

    def test_a_statement_with_no_excerpt_says_so(self):
        result = self.read(2)
        self.assertEqual(result["status"], "no_excerpt")
        self.assertIsNone(result["statement"]["proposition"])
        self.assertIsNone(result["answer_file_named"])

    def test_an_unknown_statement_is_not_found(self):
        result = self.read(99)
        self.assertEqual(result["status"], "not_found")
        self.assertIn("99", result["detail"])


if __name__ == "__main__":
    unittest.main()
