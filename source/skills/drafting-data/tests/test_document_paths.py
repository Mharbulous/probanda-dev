"""Re-pointing documents.file_path after a move (references/document-paths.md),
run against a freshly migrated synthetic submission database."""

import re
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

SKILL_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SKILL_ROOT / "references" / "scripts"))

import migrate_engine as engine  # noqa: E402

REFERENCE = SKILL_ROOT / "references" / "document-paths.md"
MATTER_ROOT = r"C:\Users\Test\Litigation - Documents\L9000 Test Matter"
OLD = "2026-01-05 affidavit.pdf"
NEW = r"5. COURT FILE#S-290001\2026-01-05 AFF Smith #1.pdf"


def fenced(lang, needle):
    text = REFERENCE.read_text(encoding="utf-8")
    for body in re.findall(r"```" + lang + r"\n(.*?)```", text, re.S):
        if needle in body:
            return body
    raise AssertionError(f"no ```{lang} block containing {needle!r}")


class DocumentPathTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        db_path = Path(self._tmp.name) / "submission.sqlite"
        engine.run({"db_path": str(db_path)})
        self.con = sqlite3.connect(db_path)
        self.addCleanup(self.con.close)
        self.con.execute("PRAGMA foreign_keys = ON")
        self.con.executescript(
            "INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L9000', 'CAN/BC/BCSC');"
        )
        self.select = fenced("sql", "-- document paths: rows to re-point")
        self.update = fenced("sql", "-- document paths: re-point")

    def document(self, doc_id, file_path):
        self.con.execute(
            "INSERT INTO documents (id, proceeding_id, label, file_path) VALUES (?, 1, 'd', ?)",
            (doc_id, file_path))

    def values(self, old=OLD, new=NEW):
        return {"old_path": old, "old_absolute": MATTER_ROOT + "\\" + old, "new_path": new}

    def revision(self):
        return int(self.con.execute(
            "SELECT value FROM db_meta WHERE key = 'revision'").fetchone()[0])

    def repoint(self, **kw):
        ids = [r[0] for r in self.con.execute(self.select, self.values(**kw))]
        if ids:
            self.con.execute(self.update, self.values(**kw))
        return ids

    def paths(self):
        return dict(self.con.execute("SELECT id, file_path FROM documents ORDER BY id"))

    def test_a_row_in_the_stored_form_is_re_pointed(self):
        self.document(1, OLD)
        self.document(2, "unrelated.pdf")
        self.assertEqual(self.repoint(), [1])
        self.assertEqual(self.paths(), {1: NEW, 2: "unrelated.pdf"})

    def test_a_row_holding_the_old_absolute_path_is_re_pointed_to_the_stored_form(self):
        self.document(1, MATTER_ROOT + "\\" + OLD)
        self.assertEqual(self.repoint(), [1])
        self.assertEqual(self.paths(), {1: NEW})

    def test_a_row_naming_the_old_place_in_another_case_is_re_pointed(self):
        self.document(1, OLD.upper())
        self.document(2, MATTER_ROOT.lower() + "\\" + OLD)
        self.document(3, NEW)
        self.assertEqual(self.repoint(), [1, 2])
        self.assertEqual(self.paths(), {1: NEW, 2: NEW, 3: NEW})

    def test_a_case_only_rename_re_points_the_old_spelling_only(self):
        self.document(1, OLD)
        self.document(2, OLD.upper())
        self.assertEqual(self.repoint(new=OLD.upper()), [1])
        self.assertEqual(self.paths(), {1: OLD.upper(), 2: OLD.upper()})

    def test_zero_rows_is_normal_and_moves_no_revision(self):
        self.document(1, "unrelated.pdf")
        before = self.revision()
        self.assertEqual(self.repoint(), [])
        self.con.execute(self.update, self.values())  # even run blind, nothing moves
        self.assertEqual(self.revision(), before)
        self.assertEqual(self.paths(), {1: "unrelated.pdf"})

    def test_a_second_run_finds_nothing(self):
        self.document(1, OLD)
        self.repoint()
        before = self.revision()
        self.assertEqual(self.repoint(), [])
        self.assertEqual(self.revision(), before)

    def test_a_legacy_absolute_row_already_at_the_new_place_is_normalized(self):
        self.document(1, MATTER_ROOT + "\\" + NEW)
        self.assertEqual(self.repoint(old=NEW), [1])
        self.assertEqual(self.paths(), {1: NEW})

    def test_the_stored_form_helper(self):
        namespace = {}
        exec(fenced("python", "def stored_form("), namespace)
        stored_form = namespace["stored_form"]
        self.assertEqual(stored_form(MATTER_ROOT + "/" + NEW.replace("\\", "/"), MATTER_ROOT), NEW)
        self.assertEqual(stored_form(".\\" + OLD, MATTER_ROOT), OLD)


if __name__ == "__main__":
    unittest.main()
