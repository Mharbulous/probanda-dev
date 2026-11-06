"""Tests for references/jobs-create.md §3a, "Adding a step": a part added to a queued form job.

The documented script is run as written against a migrated database, the way drafting_data__execute
runs it. On a queued, approved job it appends the step after the highest ordinal, keeps the done
step's stamp and clears the plan approval. On a completed, superseded, shelved or in-progress job it
writes nothing, so a completed job takes a step only once reopened (jobs-closeout.md §10e).

Run: python -m pytest .claude/skills/drafting-data/tests/test_form_job_append_step.py -q
"""

import re
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

SKILL = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SKILL / "references" / "scripts"))

import migrate_engine as engine  # noqa: E402

JOBS_CREATE = SKILL / "references" / "jobs-create.md"

# Job 42 is the queued form job, its plan approved and its first part done.
SEED = """
    INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L0000', 'CAN/BC/BCSC');
    INSERT INTO filings (id, proceeding_id, kind, title) VALUES (7, 1, 'notice_of_application', 'Notice of Application');
    INSERT INTO tickets (id, proceeding_id, filing_id, title, intent, kind, billing_anchor, created, plan_approved_at) VALUES
        (42, 1, 7, 'Fill in the Notice of Application', 'Fill in the Notice of Application.', 'work', 'L0000|x', '2026-10-20T09:00', '2026-10-20T09:05');
    INSERT INTO ticket_steps (ticket_id, ordinal, text, done_at) VALUES
        (42, 1, 'Fill in Part 1 (Orders Sought).', '2026-10-20T10:00'),
        (42, 2, 'Fill in Part 2 (Factual Basis).', NULL);
"""

APPROVED = "2026-10-20T09:05"


def append_script():
    section = JOBS_CREATE.read_text(encoding="utf-8").split("## 3a. Outline afresh", 1)[1].split("\n## ", 1)[0]
    block = section.split("**Adding a step.**", 1)[1]
    return re.search(r"```sql\n(.+?)\n```", block, re.DOTALL).group(1)


class AppendStepTests(unittest.TestCase):
    def setUp(self):
        self.fresh_database()

    def fresh_database(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        db_path = Path(tmp.name) / "submission.sqlite"
        engine.run({"db_path": str(db_path)})
        self.con = sqlite3.connect(str(db_path))
        self.addCleanup(self.con.close)
        self.con.execute("PRAGMA foreign_keys = ON")
        self.con.executescript(SEED)

    def execute(self, script):
        # drafting_data__execute's own wrapper (submission/backend.ts).
        self.con.executescript("BEGIN;\n" + script + "\n;\nCOMMIT;")

    def steps(self):
        return self.con.execute("SELECT ordinal, text, done_at FROM ticket_steps WHERE ticket_id = 42 ORDER BY ordinal").fetchall()

    def approval(self):
        return self.con.execute("SELECT plan_approved_at FROM tickets WHERE id = 42").fetchone()[0]

    def test_a_queued_job_gains_the_part_and_loses_its_approval(self):
        before = self.steps()
        self.execute(append_script())
        self.assertEqual(self.steps(), before + [(3, "Fill in Part 3 (Legal Basis).", None)])
        self.assertIsNone(self.approval())

    def test_a_job_not_queued_and_live_is_never_extended(self):
        states = {
            "completed": "UPDATE tickets SET status = 'completed', completed_at = '2026-10-20T11:00' WHERE id = 42",
            "superseded": "UPDATE tickets SET status = 'superseded' WHERE id = 42",
            "shelved": "UPDATE tickets SET rejected_at = '2026-10-20T11:00' WHERE id = 42",
            "in progress": "UPDATE tickets SET status = 'wip', locked_by = 'sess-other', locked_at = '2026-10-20T11:00' WHERE id = 42",
        }
        for name, write in states.items():
            with self.subTest(name):
                self.fresh_database()
                self.con.executescript(write + ";")
                before = self.steps()
                self.execute(append_script())
                self.assertEqual(self.steps(), before)
                self.assertEqual(self.approval(), APPROVED)


if __name__ == "__main__":
    unittest.main()
