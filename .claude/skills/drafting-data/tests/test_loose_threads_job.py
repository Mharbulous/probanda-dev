"""Tests for references/jobs-create.md §3j, the loose-threads job, and its held-job consumption write.

Each documented script is run as written against a migrated database: §3j's three calls write one
job its session created, with the fixed step and whole-board scope, and the held job marks a thread
it worked as consumed only while this session holds its lock. The text of the rules around them is
pinned too: jobs-run.md §7's scope paragraph, §8's ranking permission and SKILL.md's row.

Run: python -m pytest .claude/skills/drafting-data/tests/test_loose_threads_job.py -q
"""

import re
import shutil
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

SKILL = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SKILL / "references" / "scripts"))

import migrate_engine as engine  # noqa: E402

JOBS_CREATE = SKILL / "references" / "jobs-create.md"
JOBS_RUN = SKILL / "references" / "jobs-run.md"
JOBS_STOCK = SKILL / "references" / "jobs-stock.md"

STEP = ("Rank the open loose threads if any is unranked, "
        "then work the top thread that is not deferred and not tooling")
TITLE = "work on loose threads"

# The Milestone's read of a proceeding's open threads (test_no_job_capture.py's BOARD_READ).
BOARD_READ = ("SELECT id FROM seeds WHERE (charted_into IS NULL) AND discarded_at IS NULL "
              "AND suggested_at IS NULL AND proceeding_id = 1 ORDER BY id")

SEED = """
    INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L0000', 'CAN/BC/BCSC');
    INSERT INTO filings (id, proceeding_id, kind, title) VALUES (1, 1, 'notice_of_application', 'Notice of Application');
    INSERT INTO seeds (id, proceeding_id, created, surfaced_by, idea)
        VALUES (3, 1, '2026-10-08T09:00', 'noticed', 'Thread three.'),
               (7, 1, '2026-10-08T09:01', 'noticed', 'Thread seven.');
"""


def flat(text):
    return " ".join(text.split())


def section(text, opening, closing):
    start = text.index(opening)
    return text[start:text.index(closing, start)]


def section_3j():
    return JOBS_CREATE.read_text(encoding="utf-8").split("## 3j. The loose-threads job", 1)[1].split("\n## ", 1)[0]


def scripts_3j():
    """Call 1, Call 2 and Call 3, in order."""
    return re.findall(r"```sql\n(.+?)\n```", section_3j(), re.DOTALL)


def consumption_script():
    text = JOBS_CREATE.read_text(encoding="utf-8")
    after = text[text.index("**Consuming a loose thread the held job worked**"):]
    return re.search(r"```sql\n(.+?)\n```", after, re.DOTALL).group(1)


def statements(script):
    return [s.strip() for s in script.split(";") if s.strip()]


def counsel_review_scope():
    """The substance tables jobs-stock.md §3c names for counsel's review."""
    bullet = re.search(r"^- Scope: `entity_id` NULL on every substance table of the Writing.*$",
                       JOBS_STOCK.read_text(encoding="utf-8"), re.M).group(0)
    return re.findall(r"`([a-z_]+)`", bullet.split("That is", 1)[1])


class LooseThreadsJobTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # One migration for the class: each test copies the migrated file.
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

    def create(self):
        """§3j's three calls as a session runs them, Call 3 on the id Call 2 recovered."""
        call1, call2, call3 = scripts_3j()
        self.con.executescript(call1)
        rows = self.con.execute(call2).fetchall()
        self.assertEqual(len(rows), 1, "Call 2 recovers exactly one job")
        job = rows[0][0]
        self.con.executescript(call3.replace("VALUES (60, ", f"VALUES ({job}, "))
        return job

    def lock(self, job, token="sess-a1"):
        self.con.execute("UPDATE tickets SET status = 'wip', locked_by = ?, locked_at = '2026-10-13T09:00' "
                         "WHERE id = ?", (token, job))
        self.con.commit()

    def consume(self, job):
        """The held-job consumption write and its confirm-read, on job `job` and thread 7."""
        write, read = statements(consumption_script().replace("42", str(job)))
        self.con.execute(write)
        self.con.commit()
        return self.con.execute(read).fetchall()

    def test_the_three_calls_write_one_job_its_session_created(self):
        job = self.create()
        row = self.con.execute("SELECT title, intent, kind, session_proposed, created_by, status FROM tickets "
                               "WHERE id = ?", (job,)).fetchone()
        self.assertEqual(row, (TITLE, TITLE, "work", 0, "sess-a1", "queued"))
        self.assertEqual(self.con.execute("SELECT ordinal, text FROM ticket_steps WHERE ticket_id = ?",
                                          (job,)).fetchall(), [(1, STEP)])

    def test_the_scope_is_the_whole_board(self):
        job = self.create()
        rows = self.con.execute("SELECT entity, entity_id FROM ticket_scope WHERE ticket_id = ? ORDER BY rowid",
                                (job,)).fetchall()
        self.assertEqual([entity for entity, _ in rows], counsel_review_scope())
        self.assertEqual({entity_id for _, entity_id in rows}, {None})

    def test_call_2_passes_over_an_older_job_of_the_same_title(self):
        older = self.create()
        self.con.execute("UPDATE tickets SET status = 'completed', completed_at = '2026-10-13T09:00' WHERE id = ?",
                         (older,))
        self.con.commit()
        self.assertNotEqual(self.create(), older)

    def test_the_held_job_consumes_the_thread_it_worked(self):
        job = self.create()
        self.lock(job)
        self.assertEqual(self.consume(job), [(7, job)])
        self.assertEqual(self.con.execute(BOARD_READ).fetchall(), [(3,)])

    def test_the_consumption_writes_nothing_without_this_sessions_lock(self):
        job = self.create()
        self.lock(job, token="sess-b2")
        self.assertEqual(self.consume(job), [(7, None)])
        self.assertEqual(self.con.execute(BOARD_READ).fetchall(), [(3,), (7,)])

    def test_a_consumed_thread_is_not_consumed_again(self):
        job = self.create()
        self.lock(job)
        self.con.execute("UPDATE seeds SET charted_into = ? WHERE id = 7", (job,))
        other = self.create()
        self.lock(other)
        self.assertEqual(self.consume(other), [(7, job)])


class SectionTextTests(unittest.TestCase):
    def test_section_3j_rules(self):
        text = flat(section_3j())
        self.assertIn("- Title: the practitioner's instruction, cleaned by §3's rule. Intent: the instruction, character for character.", text)
        self.assertIn("so `session_proposed` is `0`", text)
        self.assertIn(f"Step 1, fixed text that lives here and nowhere else, and that a session never rewords: `{STEP}`",
                      text)
        self.assertIn("- Scope: the whole board, `entity_id` NULL on every substance table", text)
        self.assertIn("`created_by` is this session's token.", text)
        self.assertNotEqual(STEP, TITLE, "the pre-claim check refuses a step equal to the title")

    def test_the_consumption_write_is_lock_guarded(self):
        script = consumption_script()
        self.assertIn("AND EXISTS (SELECT 1 FROM tickets WHERE id = 42 AND locked_by = 'sess-a1')", script)
        self.assertIn("AND charted_into IS NULL", script)
        text = flat(JOBS_CREATE.read_text(encoding="utf-8"))
        self.assertIn("No other assigned job runs this write.", text)

    def test_jobs_run_7_holds_whole_board_scope_and_the_foreign_scope_read(self):
        scope = flat(section(JOBS_RUN.read_text(encoding="utf-8"), "## 7.", "## 8."))
        self.assertIn("**The loose-threads job** (`jobs-create.md` §3j) holds whole-board scope", scope)
        self.assertIn("the practitioner's instruction to work on the loose threads is the expansion", scope)
        self.assertIn("the job also runs `paragraph-revision.md` §3's foreign-scope read before each substance write",
                      scope)

    def test_jobs_run_8_lets_the_loose_threads_job_rank(self):
        capture = flat(section(JOBS_RUN.read_text(encoding="utf-8"), "## 8. Loose-thread capture", "## 9. Complete"))
        self.assertIn("**Ranking the loose threads** (`/draft`'s loose-thread triage, v66): only in an outlining "
                      "session, or by the job whose intent is working the loose threads.", capture)
        self.assertIn("One more consumer holds a job: the job whose intent is working the loose threads consumes "
                      "the thread it worked", capture)

    def test_skill_md_routes_the_create(self):
        self.assertIn("| Create the loose-threads job | The practitioner says to work on the loose threads in a "
                      "session holding no job; that job then consumes each thread it works "
                      "| `references/jobs-create.md` §3j |",
                      (SKILL / "SKILL.md").read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
