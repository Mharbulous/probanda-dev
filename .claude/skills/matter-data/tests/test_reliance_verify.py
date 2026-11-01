"""reliance-verify: the write-back of a reliance check's answer (i), run as the
operation file's own SQL against a real matter built from schema.sql."""
import importlib.util
import re
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path


CASE_DATA_ROOT = Path(__file__).resolve().parents[1]
SCRIPTS_DIR = CASE_DATA_ROOT / "references" / "scripts"
SCHEMA_PATH = CASE_DATA_ROOT / "references" / "schema.sql"
QUERIES_PATH = CASE_DATA_ROOT / "references" / "queries.sql"
OPERATION = CASE_DATA_ROOT / "operations" / "reliance-verify.md"

sys.path.insert(0, str(SCRIPTS_DIR))
_spec = importlib.util.spec_from_file_location("case_data_rebuild", SCRIPTS_DIR / "rebuild.py")
rebuild = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(rebuild)


def op_sql(marker):
    for block in re.findall(r"```sql\n(.*?)```", OPERATION.read_text(encoding="utf-8"), re.S):
        if f"-- reliance: {marker}\n" in block:
            return block
    raise AssertionError(f"no sql block {marker!r}")


def pending_query():
    text = QUERIES_PATH.read_text(encoding="utf-8")
    start = text.index("-- @query_05d_pending_reverification")
    body = text[text.index("SELECT", start):]
    return body[:body.index(";") + 1]


class RelianceVerifyTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        sections = rebuild.parse_sections(SCHEMA_PATH.read_text(encoding="utf-8"))
        paths = {db: str(Path(tmp.name) / f"{db}.sqlite") for db in ("main", "law", "privileged")}
        for db, path in paths.items():
            c = sqlite3.connect(path)
            c.executescript(sections[db])
            c.close()
        self.con = sqlite3.connect(paths["main"])
        self.addCleanup(self.con.close)
        self.con.execute(f"ATTACH DATABASE '{paths['law']}' AS law")
        self.con.execute(f"ATTACH DATABASE '{paths['privileged']}' AS privileged")
        self.con.executescript(rebuild.views_from_queries(QUERIES_PATH.read_text(encoding="utf-8")))
        self.con.executescript("""
            INSERT INTO sources (source_id, category, title, file_path)
                VALUES (1, 'court', 'Pleading', 'a/pleading.pdf');
            INSERT INTO facts (fact_id, description, date_of_fact, source_id, source_locator,
                               verified, created_date)
                VALUES (1, 'The deposit was paid', '2026-01-02', 1, 'para. 4', 0, '2026-01-03');
            INSERT INTO facts (fact_id, description, source_id, source_locator, verified,
                               human_reviewed, created_date)
                VALUES (2, 'Already checked', 1, 'para. 5', 1, 1, '2026-01-03');
            INSERT INTO facts (fact_id, description, created_date) VALUES (3, '', NULL);
            INSERT INTO facts (fact_id, description, source_id, source_locator, verified,
                               created_date, notes)
                VALUES (4, 'Unclear fact', 1, 'p3', 0, '2026-01-03', 'old note');
        """)

    def state(self, fact_id):
        return self.con.execute(
            "SELECT description, date_of_fact, source_locator, verified, human_reviewed, "
            "pending_reverification, notes FROM main.facts WHERE fact_id = ?",
            (fact_id,)).fetchone()

    def run_op(self, marker, **params):
        self.con.execute(op_sql(marker), params)

    def correct(self, fact_id, field, current, proposed):
        self.run_op("corrected", fact_id=fact_id, field=field, current=current, proposed=proposed)

    def unresolved(self, fact_id, finding="unresolved — excerpt silent [a/pleading.pdf#p3]"):
        self.run_op("unresolved", fact_id=fact_id, finding=finding)

    def test_stored_facts_skip_a_bare_row_and_carry_the_file_path(self):
        sql = op_sql("stored facts").replace(":fact_ids", "1, 2, 3")
        rows = {r[0]: r for r in self.con.execute(sql)}
        self.assertEqual(sorted(rows), [1, 2])
        self.assertEqual(rows[1][7], "a/pleading.pdf")

    def test_confirmed_sets_verified_and_leaves_human_reviewed(self):
        self.run_op("confirmed", fact_id=1)
        self.assertEqual(self.state(1)[3:6], (1, 0, 0))

    def test_a_checked_fact_is_not_rechecked(self):
        before = self.state(2)
        self.run_op("confirmed", fact_id=2)
        self.correct(2, "description", "Already checked", "Changed")
        self.unresolved(2)
        self.assertEqual(self.state(2), before)

    def test_correction_applies_in_place_and_joins_the_backlog(self):
        self.correct(1, "date_of_fact", "2026-01-02", "2026-01-05")
        self.assertEqual(self.state(1)[:6],
                         ("The deposit was paid", "2026-01-05", "para. 4", 0, 0, 1))
        backlog = [(r[0], r[1]) for r in self.con.execute(pending_query())]
        self.assertIn(("fact", 1), backlog)

    def test_correction_with_a_stale_current_value_changes_nothing(self):
        before = self.state(1)
        self.correct(1, "description", "Some other wording", "New wording")
        self.assertEqual(self.state(1), before)

    def test_correction_never_reaches_a_human_reviewed_row(self):
        self.con.execute("UPDATE facts SET verified = 0, human_reviewed = 1 WHERE fact_id = 2")
        self.correct(2, "description", "Already checked", "Changed")
        self.assertEqual(self.state(2)[0], "Already checked")
        self.assertEqual(self.state(2)[5], 0)

    def test_unresolved_goes_to_review_with_one_note(self):
        self.unresolved(4)
        self.unresolved(4)
        description, _, _, verified, human, pending, notes = self.state(4)
        self.assertEqual((verified, human, pending), (2, 0, 0))
        self.assertTrue(notes.startswith("old note\nRELIANCE CHECK "))
        self.assertEqual(notes.count("RELIANCE CHECK"), 1)
        queue = [r[0] for r in self.con.execute(
            "SELECT record_id FROM review_queue WHERE record_type = 'fact'")]
        self.assertIn(4, queue)

    def test_no_write_stamps_the_source(self):
        self.run_op("confirmed", fact_id=1)
        self.unresolved(4)
        stamp = self.con.execute("SELECT last_verified_at FROM sources WHERE source_id = 1").fetchone()
        self.assertEqual(stamp, (None,))

    def test_only_answer_i_is_written(self):
        text = OPERATION.read_text(encoding="utf-8")
        self.assertIn("never written", text)
        self.assertNotIn("litigator", text)
        self.assertNotIn("source-tracer", text)


if __name__ == "__main__":
    unittest.main()
