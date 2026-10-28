"""Tests for references/jobs-run.md §8a: a loose thread captured with no job held.

The documented insert lands with no origin job, is listed by the Milestone's uncharted-thread
read for its proceeding, and cannot be written without a proceeding.

Run: python -m pytest .claude/skills/drafting-data/tests/test_no_job_capture.py -q
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

# The Milestone's read of a proceeding's uncharted threads (render-work-board.ts), no deletions.
BOARD_READ = (
    "SELECT id, filing_id, origin_ticket_id, created, surfaced_by, idea FROM seeds "
    "WHERE (charted_into IS NULL) AND discarded_at IS NULL AND suggested_at IS NULL "
    "AND proceeding_id = ? ORDER BY id"
)


def section_8a():
    text = JOBS_RUN.read_text(encoding="utf-8")
    begin = text.index("### 8a. With no job held")
    return text[begin:text.index("## 9. Complete", begin)]


def documented_insert():
    return re.search(r"```sql\n(INSERT INTO seeds .+?)\n```", section_8a(), re.DOTALL).group(1)


class NoJobCaptureTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.db_path = str(Path(self._tmp.name) / "submission.sqlite")
        engine.run({"db_path": self.db_path})
        self.con = sqlite3.connect(self.db_path)
        self.con.execute("PRAGMA foreign_keys = ON")
        self.con.execute(
            "INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L0000', 'CAN/BC/BCSC')"
        )
        self.con.commit()

    def tearDown(self):
        self.con.close()
        self._tmp.cleanup()

    def test_documented_insert_lands_with_no_origin_job(self):
        self.con.executescript(documented_insert())
        rows = self.con.execute(BOARD_READ, (1,)).fetchall()
        self.assertEqual(len(rows), 1)
        _, filing_id, origin, _, surfaced_by, idea = rows[0]
        self.assertIsNone(filing_id)
        self.assertIsNone(origin)
        self.assertTrue(surfaced_by.startswith("research answer "))
        self.assertTrue(idea.endswith("live_issue: no"))

    def test_a_thread_needs_a_proceeding(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.con.execute(
                "INSERT INTO seeds (proceeding_id, filing_id, origin_ticket_id, created, surfaced_by, idea) "
                "VALUES (NULL, NULL, NULL, '2026-01-01T09:00', 'research answer x.md', 'idea')"
            )

    def test_section_rules(self):
        text = " ".join(section_8a().split())
        self.assertIn("`origin_ticket_id` NULL", text)
        self.assertIn("ask the practitioner once which proceeding the draft serves", text)
        self.assertIn("None: there is no board.", text)
        self.assertIn(
            '("With a board, the return\'s open items are sorted against it")', text
        )
        self.assertIn(
            "Never create a proceeding here, never create a job other than §3i's research offer job, "
            "and never assign anything: a loose thread is consumed only by a later outlining session "
            "(§3) or by §3i's add path.",
            text,
        )


if __name__ == "__main__":
    unittest.main()
