"""Tests for references/jobs-run.md §8's discard, restore and suggested writes (schema v75).

Each documented script is run as written against a migrated database: a drop stamps discarded_at
and deletes no row, a restore clears it, a suggested write stamps suggested_at, and a discarded or
suggested thread is out of the documented open-thread reads. On a database held at v74 the drop
fails with `no such column` and the row stays.

Run: python -m pytest .claude/skills/drafting-data/tests/test_loose_thread_discard.py -q
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

JOBS_RUN = Path(__file__).resolve().parents[1] / "references" / "jobs-run.md"
MINUTE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$")

SEED = """
    INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L0000', 'CAN/BC/BCSC');
    INSERT INTO seeds (id, proceeding_id, created, surfaced_by, idea)
        VALUES (3, 1, '2026-10-08T09:00', 'noticed', 'Thread three.'),
               (7, 1, '2026-10-08T09:01', 'noticed', 'Thread seven.'),
               (12, 1, '2026-10-08T09:02', 'noticed', 'Thread twelve.'),
               (13, 1, '2026-10-08T09:03', 'noticed', 'Thread thirteen.');
"""


def section_8():
    text = JOBS_RUN.read_text(encoding="utf-8")
    begin = text.index("## 8. Loose-thread capture")
    return text[begin:text.index("## 9. Complete", begin)]


def script_after(heading):
    """The first fenced SQL script after a bold paragraph heading in §8."""
    text = section_8()
    return re.search(r"```sql\n(.+?)\n```", text[text.index(heading):], re.DOTALL).group(1)


def statements(script):
    return [s.strip() for s in script.split(";") if s.strip()]


class LooseThreadDiscardTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.db_path = str(Path(self._tmp.name) / "submission.sqlite")
        engine.run({"db_path": self.db_path})
        self.con = sqlite3.connect(self.db_path)
        self.addCleanup(self.con.close)
        self.con.executescript(SEED)
        self.con.commit()

    def run_script(self, heading):
        """Runs the script's writes and returns its closing confirm-read's rows."""
        *writes, read = statements(script_after(heading))
        for write in writes:
            self.con.execute(write)
        self.con.commit()
        return self.con.execute(read).fetchall()

    def state(self):
        return self.con.execute("SELECT id, discarded_at IS NOT NULL, suggested_at IS NOT NULL FROM seeds ORDER BY id").fetchall()

    def open_unranked(self):
        """The ranking's confirm-read: the open threads still to rank."""
        read = statements(script_after("**Ranking the loose threads**"))[-1]
        return self.con.execute(read).fetchone()[0]

    def test_drop_stamps_discarded_at_and_deletes_no_row(self):
        self.assertEqual(self.run_script("**Dropping a loose thread**"), [(0,)])
        self.assertEqual(self.state(), [(3, 1, 0), (7, 1, 0), (12, 1, 0), (13, 0, 0)])
        for (stamp,) in self.con.execute("SELECT discarded_at FROM seeds WHERE id IN (3, 7, 12)"):
            self.assertRegex(stamp, MINUTE)

    def test_a_second_drop_leaves_the_first_minute(self):
        self.con.execute("UPDATE seeds SET discarded_at = '2026-10-01T08:00' WHERE id = 3")
        self.run_script("**Dropping a loose thread**")
        self.assertEqual(self.con.execute("SELECT discarded_at FROM seeds WHERE id = 3").fetchone(), ("2026-10-01T08:00",))

    def test_restore_reopens_the_thread_with_its_rank(self):
        self.con.execute("UPDATE seeds SET rank = 2, rank_group = 'tooling', rank_job = 'Fix it.', rank_reason = 'Why.' WHERE id = 7")
        self.run_script("**Dropping a loose thread**")
        self.assertEqual(self.run_script("**Restoring a discarded thread**"), [(7, None)])
        self.assertEqual(self.state(), [(3, 1, 0), (7, 0, 0), (12, 1, 0), (13, 0, 0)])
        self.assertEqual(self.con.execute("SELECT rank, rank_group FROM seeds WHERE id = 7").fetchone(), (2, "tooling"))

    def test_suggested_write_stamps_suggested_at(self):
        ((seed_id, stamp),) = self.run_script("**Marking a thread suggested**")
        self.assertEqual(seed_id, 7)
        self.assertRegex(stamp, MINUTE)
        self.assertEqual(self.state(), [(3, 0, 0), (7, 0, 1), (12, 0, 0), (13, 0, 0)])

    def test_a_discarded_thread_is_not_marked_suggested(self):
        self.run_script("**Dropping a loose thread**")
        self.assertEqual(self.run_script("**Marking a thread suggested**"), [(7, None)])

    def test_discarded_and_suggested_threads_are_not_open(self):
        self.assertEqual(self.open_unranked(), 4)
        self.run_script("**Dropping a loose thread**")
        self.assertEqual(self.open_unranked(), 1, "threads 3, 7 and 12 are discarded")
        self.con.execute("UPDATE seeds SET suggested_at = '2026-10-13T10:00' WHERE id = 13")
        self.assertEqual(self.open_unranked(), 0, "thread 13 is suggested")

    def test_a_discarded_thread_cannot_be_deferred(self):
        self.run_script("**Dropping a loose thread**")
        self.assertEqual(self.run_script("**Deferring a loose thread**"), [(7, None)])

    def test_section_rules(self):
        text = " ".join(section_8().split())
        self.assertIn("it stamps `discarded_at`, the minute dropped, `YYYY-MM-DDTHH:MM` in local time, and deletes no row", text)
        self.assertIn("On a database held below v75 the write fails with `no such column`.", text)
        self.assertIn("never delete the row instead", text)
        self.assertIn("No route writes it any more: a `tooling` thread is no longer sent as a suggestion", text)
        self.assertNotIn("DELETE FROM seeds", text)


class HeldBelowV75Tests(unittest.TestCase):
    def test_the_drop_fails_on_a_v74_database_and_the_row_stays(self):
        with tempfile.TemporaryDirectory() as tmp:
            db_path = str(Path(tmp) / "submission.sqlite")
            engine.migrate(db_path, target_version=74)
            con = sqlite3.connect(db_path)
            try:
                con.executescript(SEED)
                con.commit()
                with self.assertRaisesRegex(sqlite3.OperationalError, "no such column: discarded_at"):
                    con.execute(statements(script_after("**Dropping a loose thread**"))[0])
                self.assertEqual(con.execute("SELECT COUNT(*) FROM seeds").fetchone(), (4,))
            finally:
                con.close()


if __name__ == "__main__":
    unittest.main()
