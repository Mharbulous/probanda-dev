"""filing-checklists.md §6a, the Proposal key-type table, and jobs-create.md §3e's submission read.

§6a is the one place a job outlined from a Proposal reads its steps and its scope from, so
it must cover every key type the renderer emits, and no step frame may restate the job's title
(`<work name>: <item label>`), which `/draft`'s pre-claim check refuses. §3e's "The submission's rows"
read is run against a freshly migrated synthetic database."""

import re
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

SKILL_ROOT = Path(__file__).resolve().parents[1]
REPO = SKILL_ROOT.parents[2]
sys.path.insert(0, str(SKILL_ROOT / "references" / "scripts"))

import migrate_engine as engine  # noqa: E402

CHECKLISTS = SKILL_ROOT / "references" / "filing-checklists.md"
JOBS_CREATE = SKILL_ROOT / "references" / "jobs-create.md"
FORMS = REPO / "source" / "practice" / "mcp" / "src" / "submission" / "forms"
INVENTORY = FORMS / "proposal-inventory.ts"
SYMBOLS = FORMS / "symbol-table.ts"


def read(path):
    return path.read_text(encoding="utf-8").replace("\r\n", "\n")


def slugs():
    """ProposalSlug's members, as proposal-inventory.ts declares the union."""
    union = re.search(r"export type ProposalSlug =(.*?);", read(INVENTORY), re.S).group(1)
    return re.findall(r'"([a-z-]+)"', union)


def symbol_entries():
    """{slug: (title, actor)} off symbol-table.ts, one per slug (🥉 and 🥈 share one)."""
    entries = {}
    for chunk in re.split(r"\n  \{", read(SYMBOLS)):
        m = re.search(r'slug: "([a-z-]+)", title: "([^"]*)"', chunk)
        if m:
            actor = re.search(r'actor: "([^"]*)"', chunk)
            entries.setdefault(m.group(1), (m.group(2), actor.group(1) if actor else None))
    return entries


def table_rows():
    """§6a's rows as {key type: [keyed, frame, also writes, practitioner's own]}."""
    text = read(CHECKLISTS)
    section = text[text.index("## 6a."):text.index("## 7.")]
    rows = {}
    for line in section.splitlines():
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) == 5 and re.fullmatch(r"`[a-z-]+`", cells[0]):
            key = cells[0].strip("`")
            if key in rows:
                raise AssertionError(f"§6a has two rows for {key}")
            rows[key] = cells[1:]
    return rows


def norm(text):
    return re.sub(r"\s+", " ", text).strip().rstrip(".:;,").lower()


def frames(cell):
    return re.findall(r"`([^`]*<item>[^`]*)`", cell)


def fenced(path, needle):
    for body in re.findall(r"```sql\n(.*?)```", read(path), re.S):
        if needle in body:
            return body
    raise AssertionError(f"no ```sql block containing {needle!r}")


class KeyTypeTableTests(unittest.TestCase):
    def setUp(self):
        self.rows = table_rows()

    def test_every_key_type_the_renderer_emits_has_exactly_one_row(self):
        self.assertEqual(sorted(self.rows), sorted(set(slugs())))

    def test_every_frame_names_its_item_once_and_never_restates_the_title(self):
        symbols = symbol_entries()
        for key, (_, frame_cell, _, _) in self.rows.items():
            with self.subTest(key=key):
                found = frames(frame_cell)
                self.assertTrue(found, f"{key}: no step frame")
                title = f"{symbols[key][0]}: <item>"
                for frame in found:
                    self.assertEqual(frame.count("<item>"), 1, frame)
                    self.assertTrue(frame.endswith(": <item>"), frame)
                    self.assertNotEqual(norm(frame), norm(title), f"{key}: the frame restates the title")

    def test_frames_are_distinct(self):
        all_frames = [f for _, cell, _, _ in self.rows.values() for f in frames(cell)]
        self.assertEqual(len(all_frames), len(set(all_frames)))

    def test_the_practitioners_own_marks_every_practitioner_actor(self):
        symbols = symbol_entries()
        for key, (_, _, _, own) in self.rows.items():
            with self.subTest(key=key):
                self.assertIn(own, ("yes", "no"))
                if symbols[key][1] == "practitioner":
                    self.assertEqual(own, "yes")

    def test_every_table_named_exists_in_the_schema(self):
        with tempfile.TemporaryDirectory() as tmp:
            db_path = Path(tmp) / "submission.sqlite"
            engine.run({"db_path": str(db_path)})
            con = sqlite3.connect(db_path)
            try:
                tables = {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
            finally:
                con.close()
        for key, (keyed, _, writes, _) in self.rows.items():
            for name in re.findall(r"`([a-z_]+)`", keyed + " " + writes):
                with self.subTest(key=key, table=name):
                    self.assertIn(name, tables)

    def test_intakes_single_step_example_is_its_frame(self):
        frame = frames(self.rows["exhibit-pinpoint"][1])[0]
        item = "M. Reyes: Overtime for the final week was recorded in the Site Diary."
        text = read(JOBS_CREATE)
        intake = text[text.index("## 3e. Intake"):text.index("## 3f.")]
        self.assertIn(f"VALUES (2, 1, '{frame.replace('<item>', item)}')", intake)


class OneTitleOneJobTests(unittest.TestCase):
    """§3e's "One title, one job": the note-ups of one Act are one job, one step per provision."""

    def setUp(self):
        text = read(JOBS_CREATE)
        self.section = text[text.index("**One title, one job.**"):text.index("**Grouped Proposals.**")]

    def test_note_ups_are_not_excluded(self):
        self.assertNotIn("other than note-ups", self.section)

    def test_the_example_job_steps_are_its_provisions_never_its_title(self):
        sql = re.search(r"```sql\n(.*?)```", self.section, re.S).group(1)
        items = set(re.findall(r"'note-up:authorities:\d+', '([^']*)'", sql))
        self.assertEqual(len(items), 1, "the example's keys name one Act")
        title = f"Note up: {items.pop()}"
        steps = re.findall(r"INSERT INTO ticket_steps \(ticket_id, ordinal, text\) VALUES \(2, \d+, '([^']*)'\)", sql)
        self.assertGreaterEqual(len(steps), 2)
        self.assertEqual(len(steps), len(set(steps)))
        for step in steps:
            self.assertTrue(step.startswith(title + ", "), step)
            self.assertNotEqual(norm(step), norm(title))


class SubmissionRowsTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        db_path = Path(self._tmp.name) / "submission.sqlite"
        engine.run({"db_path": str(db_path)})
        self.con = sqlite3.connect(db_path)
        self.addCleanup(self.con.close)
        self.con.execute("PRAGMA foreign_keys = ON")
        self.con.executescript("""
            INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L9000', 'CAN/BC/BCSC');
            INSERT INTO filings (id, proceeding_id, kind, title) VALUES (8, 1, 'notice_of_application', 'Notice of Application');
            INSERT INTO witnesses (id, proceeding_id, name) VALUES (40, 1, 'Witness A'), (41, 1, 'Witness B');
            INSERT INTO documents (id, proceeding_id, label) VALUES (50, 1, 'Affidavit #1'), (51, 1, 'Exhibit A'), (52, 1, 'Other');
            INSERT INTO facts (id, proceeding_id, postulate) VALUES (60, 1, 'Fact one.'), (61, 1, 'Fact two.');
            INSERT INTO statements_of_fact (id, proceeding_id, fact_id, witness_id, instrument, exhibit_id)
              VALUES (70, 1, 60, 40, 50, 51), (71, 1, 61, 41, 52, NULL);
            INSERT INTO authorities (id, proceeding_id, style_of_cause_or_title, kind) VALUES (80, 1, 'Example Act', 'statute'), (81, 1, 'Other Act', 'statute');
            INSERT INTO law_assertions (id, proceeding_id, proposition) VALUES (90, 1, 'Proposition one.'), (91, 1, 'Proposition two.');
            INSERT INTO statements_of_law (id, proceeding_id, law_assertion_id, authority_id, verification)
              VALUES (100, 1, 90, 80, 'lead'), (101, 1, 91, 81, 'lead');
            INSERT INTO submissions (id, proceeding_id, contention, ordinal) VALUES (3, 1, 'Contention three.', 1), (4, 1, 'Contention four.', 2);
            INSERT INTO filing_submissions (id, filing_id, submission_id, document, ordinal) VALUES (110, 8, 3, 'form', 1), (111, 8, 4, 'form', 2);
            INSERT INTO submission_facts (submission_id, fact_id) VALUES (3, 60), (4, 61);
            INSERT INTO submission_law (submission_id, law_assertion_id) VALUES (3, 90), (4, 91);
        """)
        self.read = fenced(JOBS_CREATE, "UNION SELECT 'filing_submissions'")

    def test_returns_the_submissions_own_rows_and_no_others(self):
        rows = set(self.con.execute(self.read))
        self.assertEqual(rows, {
            ("submissions", 3), ("filing_submissions", 110), ("facts", 60), ("statements_of_fact", 70),
            ("witnesses", 40), ("documents", 50), ("documents", 51),
            ("law_assertions", 90), ("statements_of_law", 100), ("authorities", 80),
        })


if __name__ == "__main__":
    unittest.main()
