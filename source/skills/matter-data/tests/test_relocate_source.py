"""relocate-source (operations/relocate-source.md): the probe, the plan function
and its one-call write, run against synthetic temp databases."""

import hashlib
import importlib.util
import re
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path


CASE_DATA_ROOT = Path(__file__).resolve().parents[1]
SCRIPTS_DIR = CASE_DATA_ROOT / "references" / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))
SCHEMA_PATH = CASE_DATA_ROOT / "references" / "schema.sql"
TRIGGERS_PATH = CASE_DATA_ROOT / "references" / "triggers.sql"
CONVENTIONS_PATH = CASE_DATA_ROOT / "shared" / "conventions.md"
OPERATION_PATH = CASE_DATA_ROOT / "operations" / "relocate-source.md"

spec = importlib.util.spec_from_file_location("case_data_rebuild", SCRIPTS_DIR / "rebuild.py")
rebuild = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rebuild)

MATTER_ROOT = r"C:\Users\Test\Litigation - Documents\L9000 Test Matter"
OLD = "2026-01-05 letter.pdf"
NEW = r"3. CORRESPONDENCE\2026-01-05 LTR Smith re costs.pdf"


def fenced(path, lang, needle):
    text = path.read_text(encoding="utf-8")
    for body in re.findall(r"```" + lang + r"\n(.*?)```", text, re.S):
        if needle in body:
            return body
    raise AssertionError(f"no ```{lang} block containing {needle!r} in {path.name}")


class RelocateSourceTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        self.matter = root / "matter"
        self.matter.mkdir()
        self.paths = {name: root / f"{name}.sqlite" for name in ("main", "law", "privileged")}
        sections = rebuild.parse_sections(SCHEMA_PATH.read_text(encoding="utf-8"))
        for name, path in self.paths.items():
            con = sqlite3.connect(path)
            try:
                con.executescript(sections[name])
            finally:
                con.close()
        self.con = sqlite3.connect(self.paths["main"])
        self.con.execute("ATTACH DATABASE ? AS law", (str(self.paths["law"]),))
        self.con.execute("ATTACH DATABASE ? AS privileged", (str(self.paths["privileged"]),))
        self.con.executescript(TRIGGERS_PATH.read_text(encoding="utf-8"))
        self.con.row_factory = sqlite3.Row
        namespace = {}
        exec(fenced(CONVENTIONS_PATH, "python", "def stored_form("), namespace)
        exec(fenced(OPERATION_PATH, "python", "def relocate_plan("), namespace)
        self.relocate_plan = namespace["relocate_plan"]
        self.hash = hashlib.sha256(b"letter").hexdigest()

    def tearDown(self):
        self.con.close()
        self.tmp.cleanup()

    def place(self, stored, data=b"letter"):
        path = self.matter.joinpath(*stored.split("\\"))
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)

    def source(self, source_id, file_path, parent=None):
        self.con.execute(
            "INSERT INTO main.sources (source_id, category, title, file_path, file_hash, "
            "parent_source_id) VALUES (?, 'correspondence', 't', ?, ?, ?)",
            (source_id, file_path, self.hash, parent))

    def probe(self):
        sql = fenced(OPERATION_PATH, "sql", "-- relocate-source probe")
        return [dict(r) for r in self.con.execute(sql, (self.hash,)).fetchall()]

    def relocate(self, store="main", old=OLD, new=NEW):
        plan = self.relocate_plan(self.probe(), store, self.hash, old, new,
                                  MATTER_ROOT, str(self.matter))
        if plan["sql"]:
            self.con.executescript("BEGIN;\n" + plan["sql"] + "\nCOMMIT;")
        return plan

    def paths_now(self):
        return {(r["store"], r["id"]): r["file_path"] for r in self.probe()}

    def test_a_moved_file_is_re_pointed_in_the_stored_form(self):
        self.place(NEW)
        self.source(1, OLD)
        plan = self.relocate()
        self.assertEqual(plan["outcome"], "relocated")
        self.assertEqual(self.paths_now(), {("main", 1): NEW})

    def test_a_second_call_is_already_current_and_writes_nothing(self):
        self.place(NEW)
        self.source(1, OLD)
        self.relocate()
        plan = self.relocate()
        self.assertEqual((plan["outcome"], plan["sql"]), ("already_current", None))
        self.assertEqual([r["action"] for r in plan["rows"]], ["already"])

    def test_no_record_in_the_named_store_is_a_failure(self):
        self.source(1, OLD)
        plan = self.relocate(store="privileged")
        self.assertEqual((plan["outcome"], plan["reason"], plan["sql"]),
                         ("failed", "no_rows", None))
        self.assertEqual(self.paths_now(), {("main", 1): OLD})

    def test_an_unknown_hash_is_a_failure(self):
        plan = self.relocate()
        self.assertEqual((plan["outcome"], plan["reason"]), ("failed", "no_rows"))

    def test_every_record_of_the_file_moves_together(self):
        # An affidavit body and its exhibit, the privileged row a promotion
        # kept, and a merged authority's tombstone all share the file's hash.
        self.place(NEW)
        self.source(1, OLD)
        self.source(2, OLD, parent=1)
        self.con.execute(
            "INSERT INTO privileged.privileged_sources (source_id, category, title, "
            "file_path, file_hash) VALUES (5, 'other', 'Before promotion', ?, ?)",
            (OLD, self.hash))
        self.con.execute(
            "INSERT INTO law.authorities (authority_id, title, citation, file_path, "
            "file_hash, notes) VALUES (9, 'A v B', '2020 BCCA 1', ?, ?, "
            "'[MERGED-INTO:#7 2026-07-20 BW] ')", (OLD, self.hash))
        plan = self.relocate()
        self.assertEqual(plan["outcome"], "relocated")
        self.assertEqual(set(self.paths_now().values()), {NEW})
        self.assertEqual(len(self.paths_now()), 4)

    def test_a_legacy_absolute_path_is_rewritten_to_the_stored_form(self):
        self.place(NEW)
        self.source(1, MATTER_ROOT + "/" + OLD)
        self.assertEqual(self.relocate()["outcome"], "relocated")
        self.assertEqual(self.paths_now(), {("main", 1): NEW})

    def test_a_legacy_form_of_the_new_path_is_rewritten_too(self):
        self.place(NEW)
        self.source(1, MATTER_ROOT + "\\" + NEW)
        self.assertEqual(self.relocate()["outcome"], "relocated")
        self.assertEqual(self.paths_now(), {("main", 1): NEW})

    def test_a_stale_path_left_behind_is_repaired(self):
        # The file was moved by hand from 'gone.pdf' before this move: nothing
        # with its hash is at the stored path any more.
        self.place(NEW)
        self.source(1, "gone.pdf")
        self.assertEqual(self.relocate()["outcome"], "relocated")
        self.assertEqual(self.paths_now(), {("main", 1): NEW})

    def test_a_twin_at_the_stored_path_is_never_re_pointed(self):
        # The stored record belongs to the copy still at 'filed.pdf'; the file
        # being moved is the other copy.
        self.place("filed.pdf")
        self.place(NEW)
        self.source(1, "filed.pdf")
        plan = self.relocate()
        self.assertEqual((plan["outcome"], plan["reason"], plan["sql"]),
                         ("failed", "twin_at_stored_path", None))
        self.assertEqual(self.paths_now(), {("main", 1): "filed.pdf"})

    def test_a_quote_in_a_file_name_survives_the_literal(self):
        new = r"3. CORRESPONDENCE\2026-01-05 LTR O'Brien re costs.pdf"
        self.place(new)
        self.source(1, OLD)
        self.relocate(new=new)
        self.assertEqual(self.paths_now(), {("main", 1): new})

    def test_an_email_attachment_is_never_given_a_path(self):
        # Design-decisions #54: an attachment's bytes live inside its email
        # (#51), so filing a standalone copy of them never re-points it.
        self.place(NEW)
        self.source(1, OLD)
        self.source(2, None, parent=9)
        plan = self.relocate()
        self.assertEqual(plan["outcome"], "relocated")
        self.assertEqual([r["id"] for r in plan["rows"]], [1])
        paths = dict(self.con.execute("SELECT source_id, file_path FROM main.sources"))
        self.assertEqual(paths, {1: NEW, 2: None})

    def test_a_file_held_only_as_an_email_attachment_has_no_record_to_re_point(self):
        self.place(NEW)
        self.source(2, None, parent=9)
        plan = self.relocate()
        self.assertEqual((plan["outcome"], plan["reason"], plan["sql"]),
                         ("failed", "no_rows", None))
        self.assertIsNone(self.con.execute(
            "SELECT file_path FROM main.sources WHERE source_id = 2").fetchone()[0])

    def test_the_write_is_one_statement_per_store(self):
        self.place(NEW)
        self.source(1, OLD)
        self.source(2, OLD, parent=1)
        plan = self.relocate_plan(self.probe(), "main", self.hash, OLD, NEW,
                                  MATTER_ROOT, str(self.matter))
        self.assertEqual(plan["sql"].count("UPDATE"), 1)
        self.assertIn("source_id IN (1, 2)", plan["sql"])
        self.assertIn(f"file_hash = '{self.hash}'", plan["sql"])


if __name__ == "__main__":
    unittest.main()
