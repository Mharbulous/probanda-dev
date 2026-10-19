"""Tests for references/jobs-closeout.md §10c, moving jobs to another board of the same proceeding.

Each documented script is run as written against a migrated database: the whole-board move takes
board 7's queued jobs and open loose threads to board 8 and keeps their edges, a job in progress on
board 7 refuses it, and a note-up job, a job keyed on the Writing's own rows, a deleted job and a
completed job stay. §9a's close of board 7 then supersedes none of the moved jobs. The amended
"What never changes" sentence of jobs-create.md §3a and the pointers at §10c are pinned too.

Run: python -m pytest .claude/skills/drafting-data/tests/test_move_jobs.py -q
"""

import re
import shutil
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

SKILL = Path(__file__).resolve().parents[1]
SKILLS = SKILL.parent
sys.path.insert(0, str(SKILL / "references" / "scripts"))

import migrate_engine as engine  # noqa: E402

JOBS_CLOSEOUT = SKILL / "references" / "jobs-closeout.md"
JOBS_CREATE = SKILL / "references" / "jobs-create.md"

# Board 7 is a Writing, board 8 a Job Board with no Writing, both in proceeding 1; board 9 is in
# proceeding 2. On board 7: queued jobs 41 and 42 (42 shelved) with a waits-on edge between them,
# a note-up job 43, a job 44 keyed on a filing_facts row, deleted job 45, completed job 46.
SEED = """
    INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L0000', 'CAN/BC/BCSC'), (2, 'L0000', 'CAN/BC/BCCA');
    INSERT INTO filings (id, proceeding_id, kind, title) VALUES
        (7, 1, 'notice_of_application', 'Notice of Application'),
        (8, 1, 'task-board', 'Costs work'),
        (9, 2, 'task-board', 'Appeal work');
    INSERT INTO tickets (id, proceeding_id, filing_id, title, intent, kind, billing_anchor, created) VALUES
        (41, 1, 7, 'Job one', 'Job one', 'work', 'L0000|x', '2026-10-19T09:00'),
        (42, 1, 7, 'Job two', 'Job two', 'work', 'L0000|x', '2026-10-19T09:00'),
        (43, 1, 7, 'Note up all cited authorities', 'Note up all cited authorities', 'work', 'L0000|x', '2026-10-19T09:00'),
        (44, 1, 7, 'Fact pointer', 'Fact pointer', 'work', 'L0000|x', '2026-10-19T09:00'),
        (45, 1, 7, 'Deleted job', 'Deleted job', 'work', 'L0000|x', '2026-10-19T09:00'),
        (46, 1, 7, 'Done job', 'Done job', 'work', 'L0000|x', '2026-10-19T09:00');
    UPDATE tickets SET rejected_at = '2026-10-19T09:30' WHERE id = 42;
    UPDATE tickets SET deleted_at = '2026-10-19T09:30' WHERE id = 45;
    UPDATE tickets SET status = 'completed', completed_at = '2026-10-19T09:30' WHERE id = 46;
    INSERT INTO ticket_blocks (blocker_id, blocked_id) VALUES (41, 42);
    INSERT INTO ticket_proposals (ticket_id, proposal_key, item) VALUES
        (41, 'authority-excerpt:statements_of_law:12', 'Smith v. Jones'),
        (43, 'note-up:authorities:3', 'Smith v. Jones, 2023 BCCA 182'),
        (44, 'exhibit-pinpoint:filing_facts:2', 'Fact two');
    INSERT INTO seeds (id, proceeding_id, filing_id, created, surfaced_by, idea, discarded_at) VALUES
        (3, 1, 7, '2026-10-19T09:00', 'noticed', 'Open thread.', NULL),
        (4, 1, 7, '2026-10-19T09:00', 'noticed', 'Dropped thread.', '2026-10-19T09:30');
"""

MOVED = {41, 42}
STAYED = {43, 44, 45, 46}


def flat(text):
    return " ".join(text.split())


def section_10c():
    return JOBS_CLOSEOUT.read_text(encoding="utf-8").split("## 10c. Move jobs to another board", 1)[1].split("\n## ", 1)[0]


def scripts_10c():
    """The read-first, the whole-board move, the one-job move and the confirm-read, in order."""
    return re.findall(r"```sql\n(.+?)\n```", section_10c(), re.DOTALL)


def close_script_9a():
    section = JOBS_CLOSEOUT.read_text(encoding="utf-8").split("## 9a.", 1)[1].split("\n## ", 1)[0]
    return re.findall(r"```sql\n(.+?)\n```", section, re.DOTALL)[1]


class MoveJobsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls._template_dir = tempfile.TemporaryDirectory()
        cls.template = str(Path(cls._template_dir.name) / "template.sqlite")
        engine.run({"db_path": cls.template})

    @classmethod
    def tearDownClass(cls):
        cls._template_dir.cleanup()

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.db_path = str(Path(self._tmp.name) / "submission.sqlite")
        shutil.copyfile(self.template, self.db_path)
        self.con = sqlite3.connect(self.db_path)
        self.addCleanup(self.con.close)
        self.con.execute("PRAGMA foreign_keys = ON")
        self.con.executescript(SEED)
        self.con.commit()

    def run_script(self, script):
        before = self.con.total_changes
        self.con.executescript(script)
        return self.con.total_changes - before

    def board_of(self, job):
        return self.con.execute("SELECT filing_id FROM tickets WHERE id = ?", (job,)).fetchone()[0]

    def test_there_are_four_scripts(self):
        self.assertEqual(len(scripts_10c()), 4)

    def test_the_whole_board_move_takes_queued_jobs_and_open_threads(self):
        _, move, _, confirm = scripts_10c()
        self.assertEqual(self.run_script(move), 3)
        for job in MOVED:
            self.assertEqual(self.board_of(job), 8, job)
        for job in STAYED:
            self.assertEqual(self.board_of(job), 7, job)
        self.assertEqual(self.con.execute("SELECT id, filing_id FROM seeds ORDER BY id").fetchall(), [(3, 8), (4, 7)])
        self.assertEqual(self.con.execute("SELECT blocker_id, blocked_id FROM ticket_blocks").fetchall(), [(41, 42)])
        self.assertEqual(self.con.execute("SELECT rejected_at FROM tickets WHERE id = 42").fetchone()[0],
                         "2026-10-19T09:30", "a shelved job moves still shelved")
        rows = self.con.execute(confirm).fetchall()
        self.assertEqual({row[0] for row in rows if row[1] == 8}, MOVED)

    def test_the_read_first_names_the_jobs_that_stay(self):
        read_first = scripts_10c()[0]
        wip_read, stays_read = [s.strip() for s in read_first.split(";") if s.strip()]
        self.assertEqual(self.con.execute(wip_read).fetchall(), [])
        self.assertEqual({row[0] for row in self.con.execute(stays_read)}, {43, 44})

    def test_a_job_in_progress_on_the_source_refuses_the_move(self):
        self.con.execute("UPDATE tickets SET status = 'wip', locked_by = 'sess-b2', locked_at = '2026-10-19T10:00' "
                         "WHERE id = 41")
        self.con.commit()
        _, move, one, _ = scripts_10c()
        self.assertEqual(self.run_script(move), 0)
        self.assertEqual(self.run_script(one), 0)
        self.assertEqual(self.board_of(42), 7)
        self.assertEqual(self.con.execute("SELECT filing_id FROM seeds WHERE id = 3").fetchone()[0], 7)
        wip_read = scripts_10c()[0].split(";")[0]
        self.assertEqual([row[0] for row in self.con.execute(wip_read)], [41])

    def test_the_one_job_move_takes_only_that_job(self):
        one = scripts_10c()[2]
        self.assertEqual(self.run_script(one), 1)
        self.assertEqual(self.board_of(42), 8)
        self.assertEqual(self.board_of(41), 7)
        self.assertEqual(self.con.execute("SELECT filing_id FROM seeds WHERE id = 3").fetchone()[0], 7)

    def test_the_one_job_move_leaves_a_note_up_job(self):
        one = scripts_10c()[2].replace("id = 42", "id = 43")
        self.assertEqual(self.run_script(one), 0)
        self.assertEqual(self.board_of(43), 7)

    def test_a_target_in_another_proceeding_or_retired_moves_nothing(self):
        _, move, _, _ = scripts_10c()
        self.assertEqual(self.run_script(move.replace("filing_id = 8", "filing_id = 9")
                                         .replace("f.id = 8", "f.id = 9")), 0)
        self.con.execute("UPDATE filings SET retired_on = '2026-10-19', retirement_reason = 'other' WHERE id = 8")
        self.con.commit()
        self.assertEqual(self.run_script(move), 0)
        self.assertEqual(self.board_of(41), 7)

    def test_a_later_close_of_the_source_supersedes_none_of_the_moved_jobs(self):
        _, move, _, _ = scripts_10c()
        self.run_script(move)
        self.run_script(close_script_9a())
        statuses = dict(self.con.execute("SELECT id, status FROM tickets").fetchall())
        for job in MOVED:
            self.assertEqual(statuses[job], "queued", job)
        self.assertEqual(statuses[43], "superseded")
        self.assertEqual(statuses[44], "superseded")


class SectionTextTests(unittest.TestCase):
    def test_jobs_create_3a_lets_filing_id_change_by_10c_only(self):
        text = flat(JOBS_CREATE.read_text(encoding="utf-8"))
        self.assertIn("**What never changes, whatever the practitioner says:** `proceeding_id`, `kind`, `created` and "
                      "`billing_anchor`. `filing_id` changes only by `jobs-closeout.md` §10c's move, never in an "
                      "outline afresh.", text)

    def test_every_route_points_at_10c(self):
        for path in (SKILL / "SKILL.md", SKILLS / "draft" / "rules" / "nodes" / "housekeeping.md",
                     SKILLS / "draft" / "references" / "dispatch.md",
                     SKILLS / "draft" / "references" / "retire-filing.md"):
            self.assertRegex(path.read_text(encoding="utf-8"), r"jobs-closeout\.md`? §10c", path.name)

    def test_the_move_carries_the_wip_guard_on_every_statement(self):
        move = scripts_10c()[1]
        statements = [s for s in move.split(";") if s.strip()]
        self.assertEqual(len(statements), 2)
        for statement in statements:
            self.assertIn("NOT EXISTS (SELECT 1 FROM tickets w WHERE w.filing_id = 7 AND w.status = 'wip')", statement)


if __name__ == "__main__":
    unittest.main()
