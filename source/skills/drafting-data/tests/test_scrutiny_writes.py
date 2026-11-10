"""Tests for the scrutiny writes in references/scrutiny.md: the verified write removes every
scrutiny finding from a statement's doubt and keeps any doubt written before the first one, and
since v61 records its date and is refused on a statement with no pinpoint. The provenance read
runs as the doc states it.

Acceptance test 2 (a failed row cannot be written without a finding) is covered by
TestV46FailedScrutiny.test_a_failed_statement_without_a_finding_is_refused in
test_migrate_engine.py and is not repeated here.

Run: python -m pytest source/skills/drafting-data/tests/test_scrutiny_writes.py -q
"""

import re
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parents[1] / "references" / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))

import migrate_engine as engine  # noqa: E402

SCRUTINY_MD = Path(__file__).resolve().parents[1] / "references" / "scrutiny.md"

VERIFIED_DOUBT_CLAUSE = (
    "doubt = CASE WHEN INSTR(doubt, 'Scrutiny failed') > 0 THEN NULLIF(RTRIM(SUBSTR(doubt, 1, "
    "INSTR(doubt, 'Scrutiny failed') - 1), ' ' || char(10) || char(13)), '') ELSE doubt END"
)
FAILED_DOUBT_PREFIX = "doubt = COALESCE(doubt || ' ', '') || 'Scrutiny failed "

VERIFIED_DATE_CLAUSE = "verified_on = '<YYYY-MM-DD>', "
VERIFIED_WRITE = (
    "UPDATE statements_of_law SET verification = 'verified', scrutinized_authority_id = authority_id, "
    "scrutinized_pinpoint = pinpoint, scrutinized_excerpt = excerpt, "
    + VERIFIED_DATE_CLAUSE.replace("<YYYY-MM-DD>", "2026-10-06") + VERIFIED_DOUBT_CLAUSE + " WHERE id = ?"
)
OLD_VERIFIED_WRITE = (
    "UPDATE statements_of_law SET verification = 'verified', scrutinized_authority_id = authority_id, "
    "scrutinized_pinpoint = pinpoint, scrutinized_excerpt = excerpt, "
    "doubt = NULLIF(REPLACE(REPLACE(doubt, ?, ''), ?, ''), '') WHERE id = ?"
)

FINDING_1 = "Scrutiny failed 2026-10-02: fit failed. Answer: 6. LAW\\Topic\\answer v1.md"
FINDING_2 = "Scrutiny failed 2026-10-03: ratio failed. Answer: 6. LAW\\Topic\\answer v2.md"

SEED = """
INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L0000', 'CAN/BC/BCSC');
INSERT INTO authorities (id, proceeding_id, style_of_cause_or_title, citation, kind)
VALUES (1, 1, 'Lead Authority v. X', '2021 BCSC 1', 'case'),
       (2, 1, 'Example Act', 'SBC 2023, c 1', 'statute'),
       (3, 1, 'Killed Example Act', 'SBC 2024, c 9', 'statute');
UPDATE authorities SET killed_on = '2026-10-01' WHERE id = 3;
INSERT INTO law_assertions (id, proceeding_id, proposition) VALUES (1, 1, 'p1');
INSERT INTO statements_of_law (id, proceeding_id, law_assertion_id, authority_id, pinpoint, excerpt,
                               doubt, verification)
VALUES (1, 1, 1, 1, 'para 1', 'e1', NULL, 'lead'),
       (2, 1, 1, 1, 'para 2', 'e2', 'd2', 'lead'),
       (3, 1, 1, 1, 'para 3', 'e3', 'd3 free text', 'lead'),
       (4, 1, 1, 1, NULL, 'e4', NULL, 'lead'),
       (5, 1, 1, 2, 's 3', NULL, NULL, 'lead'),
       (6, 1, 1, 3, 's 1', NULL, NULL, 'lead');
INSERT INTO provision_currency (authority_id, provision, currency_status, checked_on, in_force_on)
VALUES (2, 's 3', 'not-found', '2026-10-01', '2024-01-01');
"""


def provenance_sql():
    """The two queries of scrutiny.md's "Read a statement's provenance", as the doc states them."""
    text = SCRUTINY_MD.read_text(encoding="utf-8")
    section = text.split("## Read a statement's provenance", 1)[1].split("\n## ", 1)[0]
    block = re.search(r"```sql\r?\n(.*?)```", section, re.S).group(1)
    return [q.strip() for q in block.split(";") if q.strip()]


class ScrutinyWriteTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Migrating takes seconds, so one seeded database is built and each test writes a copy.
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
        self.db_path = Path(self._tmp.name) / "submission.sqlite"
        self.db_path.write_bytes(self.template.read_bytes())
        self.con = sqlite3.connect(self.db_path)
        self.addCleanup(self.con.close)
        self.con.execute("PRAGMA foreign_keys = ON")

    @staticmethod
    def _state(con, statement_id):
        return con.execute("SELECT verification, doubt FROM statements_of_law WHERE id = ?", (statement_id,)).fetchone()

    @staticmethod
    def _fail(con, statement_id, finding):
        con.execute(
            "UPDATE statements_of_law SET verification = 'failed', "
            "doubt = COALESCE(doubt || ' ', '') || ? WHERE id = ?",
            (finding, statement_id),
        )

    def _verify(self, statement_id):
        self.con.execute(VERIFIED_WRITE, (statement_id,))

    def test_scrutiny_md_states_the_writes_under_test(self):
        text = SCRUTINY_MD.read_text(encoding="utf-8")
        self.assertIn(VERIFIED_DATE_CLAUSE + VERIFIED_DOUBT_CLAUSE, text)
        self.assertIn(FAILED_DOUBT_PREFIX, text)

    def test_the_verified_write_records_its_date(self):
        self._verify(1)
        self.assertEqual(self.con.execute("SELECT verified_on FROM statements_of_law WHERE id = 1").fetchone(), ("2026-10-06",))

    def test_the_verified_write_is_refused_with_no_pinpoint_until_the_pinpoint_is_recorded(self):
        with self.assertRaisesRegex(sqlite3.IntegrityError, "needs a pinpoint"):
            self._verify(4)
        self.assertEqual(self._state(self.con, 4), ("lead", None))
        self.con.execute("UPDATE statements_of_law SET pinpoint = 'para 4' WHERE id = 4")
        self._verify(4)
        self.assertEqual(
            self.con.execute("SELECT verification, scrutinized_pinpoint FROM statements_of_law WHERE id = 4").fetchone(),
            ("verified", "para 4"), "the snapshot takes the recorded pinpoint, so nothing reopens")

    def test_the_provenance_read_returns_the_statement_and_its_live_provisions(self):
        statement_q, provisions_q = provenance_sql()
        self.con.execute("UPDATE statements_of_law SET excerpt_speaker = 'Another court' WHERE id = 1")
        self._verify(1)
        self.assertEqual(
            self.con.execute(statement_q.replace("= N", "= 1")).fetchone(),
            (1, 1, "Lead Authority v. X", "2021 BCSC 1", "case", "para 1", "Another court", "verified", "2026-10-06", None),
        )
        provisions = self.con.execute(provisions_q.replace("<law_assertion_id>", "1").replace("<> N", "<> 1")).fetchall()
        self.assertEqual(provisions, [("SBC 2023, c 1", "2024-01-01")], "a killed provision counts as none")

    def test_failing_twice_then_verifying_clears_every_finding(self):
        self._fail(self.con, 1, FINDING_1)
        self._fail(self.con, 1, FINDING_2)
        self._verify(1)
        self.assertEqual(self._state(self.con, 1), ("verified", None))

    def test_doubt_written_before_a_finding_stays_without_a_trailing_space(self):
        self._fail(self.con, 2, FINDING_1)
        self._verify(2)
        self.assertEqual(self._state(self.con, 2), ("verified", "d2"))

    def test_doubt_with_no_finding_is_left_unchanged(self):
        self._verify(3)
        self.assertEqual(self._state(self.con, 3), ("verified", "d3 free text"))

    def test_a_settled_row_reopened_by_an_edit_then_verified_clears_its_finding(self):
        self._fail(self.con, 1, FINDING_1)
        self.con.execute(
            "UPDATE statements_of_law SET verification = 'settled', settled_on = '2026-10-04', "
            "settled_note = 'kept over the finding', authority_id = 1, pinpoint = 'para 1', excerpt = 'e1', "
            "scrutinized_authority_id = 1, scrutinized_pinpoint = 'para 1', scrutinized_excerpt = 'e1' WHERE id = 1"
        )
        self.assertEqual(self._state(self.con, 1), ("settled", FINDING_1))
        self.con.execute("UPDATE statements_of_law SET excerpt = 'e edited' WHERE id = 1")
        self.assertEqual(self._state(self.con, 1), ("lead", FINDING_1), "the reopen trigger keeps doubt")
        self._verify(1)
        self.assertEqual(self._state(self.con, 1), ("verified", None))

    def test_the_colon_form_of_a_finding_is_cleared(self):
        self.con.execute("UPDATE statements_of_law SET doubt = 'Scrutiny failed: wrong para.' WHERE id = 1")
        self._verify(1)
        self.assertEqual(self._state(self.con, 1), ("verified", None))

    def test_null_doubt_stays_null(self):
        self._verify(1)
        self.assertEqual(self._state(self.con, 1), ("verified", None))

    def test_the_old_replace_write_leaves_a_joining_space(self):
        # Regression record of the defect: the old write removed each finding by repeating it,
        # which left the joining space the failed write adds, so a 👃 still printed.
        self._fail(self.con, 1, FINDING_1)
        self._fail(self.con, 1, FINDING_2)
        self.con.execute(OLD_VERIFIED_WRITE, (FINDING_1, FINDING_2, 1))
        self.assertEqual(self._state(self.con, 1), ("verified", " "))


if __name__ == "__main__":
    unittest.main()
