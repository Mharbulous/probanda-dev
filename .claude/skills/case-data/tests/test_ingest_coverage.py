"""ingest-coverage (operations/ingest-coverage.md): the folder walk, then
ingest-status, then the coverage report, run against synthetic temp databases
and a temp matter folder."""

import hashlib
import importlib.util
import json
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
STATUS_PATH = CASE_DATA_ROOT / "operations" / "ingest-status.md"
OPERATION_PATH = CASE_DATA_ROOT / "operations" / "ingest-coverage.md"

spec = importlib.util.spec_from_file_location("case_data_rebuild", SCRIPTS_DIR / "rebuild.py")
rebuild = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rebuild)

MATTER_ROOT = r"C:\Users\Test\Litigation - Documents\L9000 Test Matter"
GLOBS = ["2. SOLICITOR CLIENT*", "3. CORRESPONDENCE*", "5. COURT*"]
CORRESPONDENCE = ["2. SOLICITOR CLIENT*", "3. CORRESPONDENCE*"]


def fenced(path, lang, needle):
    text = path.read_text(encoding="utf-8")
    for body in re.findall(r"```" + lang + r"\n(.*?)```", text, re.S):
        if needle in body:
            return body
    raise AssertionError(f"no ```{lang} block containing {needle!r} in {path.name}")


def load_functions():
    namespace = {}
    exec(fenced(CONVENTIONS_PATH, "python", "def stored_form("), namespace)
    exec(fenced(STATUS_PATH, "python", "def ingest_status("), namespace)
    exec(fenced(OPERATION_PATH, "python", "def scope_files("), namespace)
    exec(fenced(OPERATION_PATH, "python", "def coverage("), namespace)
    return namespace


def sha(data):
    return hashlib.sha256(data).hexdigest()


class IngestCoverageTests(unittest.TestCase):
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
        self.fn = load_functions()

    def tearDown(self):
        self.con.close()
        self.tmp.cleanup()

    def place(self, stored, data):
        path = self.matter.joinpath(*stored.split("\\"))
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        return sha(data)

    def source(self, source_id, file_hash, file_path, status, date=None, notes=None):
        self.con.execute(
            "INSERT INTO main.sources (source_id, category, title, file_path, file_hash, "
            "ingestion_status, date, notes) VALUES (?, 'court', ?, ?, ?, ?, ?, ?)",
            (source_id, f"Source {source_id}", file_path, file_hash, status, date, notes),
        )

    def privileged(self, source_id, file_hash, file_path, date=None):
        self.con.execute(
            "INSERT INTO privileged.privileged_sources (source_id, category, title, "
            "file_path, file_hash, date) VALUES (?, 'solicitor_client', ?, ?, ?, ?)",
            (source_id, f"Email {source_id}", file_path, file_hash, date),
        )

    def run_op(self, globs=GLOBS, correspondence=CORRESPONDENCE):
        scope = self.fn["scope_files"](str(self.matter), globs)
        probe = fenced(STATUS_PATH, "sql", "-- ingest-status probe")
        rows = [dict(r) for r in self.con.execute(
            probe, (json.dumps([f["hash"] for f in scope["files"]]),)).fetchall()]
        entries = self.fn["ingest_status"](scope["files"], rows, MATTER_ROOT, str(self.matter))
        return self.fn["coverage"](scope, entries, correspondence)

    # -- folders -----------------------------------------------------------

    def test_a_glob_with_no_match_is_missing(self):
        self.place(r"3. CORRESPONDENCE\a.pdf", b"a")
        out = self.run_op()
        self.assertEqual(out["missing"], ["2. SOLICITOR CLIENT*", "5. COURT*"])

    def test_every_match_of_a_glob_is_in_scope(self):
        self.place(r"5. COURT FILE#S-249026\nocc.pdf", b"nocc")
        self.place(r"5. COURT DOCS P-21507\order.pdf", b"order")
        out = self.run_op()
        self.assertEqual(sorted(out["to_ingest"]),
                         [r"5. COURT DOCS P-21507\order.pdf", r"5. COURT FILE#S-249026\nocc.pdf"])
        self.assertNotIn("5. COURT*", out["missing"])

    def test_a_file_at_the_matter_root_matching_a_glob_is_not_a_folder(self):
        self.place("5. COURT notes.pdf", b"loose")
        self.assertEqual(self.run_op()["missing"], GLOBS)

    # -- the walk ------------------------------------------------------------

    def test_the_walk_recurses_and_keeps_only_the_four_kinds(self):
        self.place(r"3. CORRESPONDENCE\OC\2026\a.PDF", b"a")
        self.place(r"3. CORRESPONDENCE\b.msg", b"b")
        self.place(r"3. CORRESPONDENCE\c.eml", b"c")
        self.place(r"3. CORRESPONDENCE\d.docx", b"d")
        self.place(r"3. CORRESPONDENCE\e.xls", b"e")
        self.place(r"3. CORRESPONDENCE\f.doc", b"f")
        out = self.run_op()
        self.assertEqual(sorted(out["to_ingest"]), [
            r"3. CORRESPONDENCE\OC\2026\a.PDF", r"3. CORRESPONDENCE\b.msg",
            r"3. CORRESPONDENCE\c.eml", r"3. CORRESPONDENCE\d.docx"])

    def test_tilde_and_dot_names_are_skipped_at_every_level(self):
        self.place(r"3. CORRESPONDENCE\~$lock.docx", b"lock")
        self.place(r"3. CORRESPONDENCE\.hidden\a.pdf", b"a")
        self.place(r"3. CORRESPONDENCE\~old\b.pdf", b"b")
        self.place(r"3. CORRESPONDENCE\keep.pdf", b"keep")
        self.assertEqual(self.run_op()["to_ingest"], [r"3. CORRESPONDENCE\keep.pdf"])

    # -- verdicts --------------------------------------------------------------

    def test_ingested_main_and_privileged_files_are_not_gaps(self):
        h1 = self.place(r"5. COURT FILE#1\nocc.pdf", b"nocc")
        h2 = self.place(r"2. SOLICITOR CLIENT\email.msg", b"email")
        self.source(1, h1, r"5. COURT FILE#1\nocc.pdf", "complete")
        self.privileged(1, h2, r"2. SOLICITOR CLIENT\email.msg")
        out = self.run_op()
        self.assertEqual((out["to_ingest"], out["damaged"]), ([], []))

    def test_a_file_held_only_in_the_law_store_is_not_a_gap(self):
        h = self.place(r"5. COURT FILE#1\reasons.pdf", b"reasons")
        self.con.execute(
            "INSERT INTO law.authorities (authority_id, citation, title, file_path, file_hash) "
            "VALUES (1, '2026 BCSC 1', 'Reasons', ?, ?)", (r"5. COURT FILE#1\reasons.pdf", h))
        self.assertEqual(self.run_op()["to_ingest"], [])

    def test_a_correspondence_glob_outside_the_folder_globs_fails(self):
        scope = self.fn["scope_files"](str(self.matter), GLOBS)
        with self.assertRaises(KeyError):
            self.fn["coverage"](scope, [], ["4. LAWYER BRIEF*"])

    def test_partial_failed_and_unrecorded_files_are_gaps(self):
        hp = self.place(r"5. COURT FILE#1\p.pdf", b"p")
        hf = self.place(r"5. COURT FILE#1\f.pdf", b"f")
        self.place(r"5. COURT FILE#1\n.pdf", b"n")
        self.source(1, hp, r"5. COURT FILE#1\p.pdf", "partial")
        self.source(2, hf, r"5. COURT FILE#1\f.pdf", "failed")
        self.assertEqual(sorted(self.run_op()["to_ingest"]), [
            r"5. COURT FILE#1\f.pdf", r"5. COURT FILE#1\n.pdf", r"5. COURT FILE#1\p.pdf"])

    def test_a_superseded_version_is_not_a_gap(self):
        h = self.place(r"5. COURT FILE#1\aff draft.pdf", b"draft")
        self.con.execute(
            "INSERT INTO main.sources (source_id, category, title, file_path, file_hash, "
            "ingestion_status, notes) VALUES (20, 'court', 'aff', ?, ?, 'partial', "
            "'[SUPERSEDED-BY:#34 2026-10-05 practitioner]')", (r"5. COURT FILE#1\aff draft.pdf", h))
        self.assertEqual(self.run_op()["to_ingest"], [])

    def test_a_file_in_the_superseded_folder_is_never_offered(self):
        self.place(r"0. DRAFT\Superseded\aff draft.pdf", b"draft")
        self.place(r"0. DRAFT\letter.pdf", b"letter")
        out = self.run_op(globs=["0. DRAFT*", "5. COURT*"], correspondence=[])
        self.assertEqual(out["to_ingest"], [r"0. DRAFT\letter.pdf"])

    def test_a_copy_of_an_ingested_file_is_not_a_gap(self):
        h = self.place(r"3. CORRESPONDENCE\letter.pdf", b"letter")
        self.place(r"5. COURT FILE#1\letter copy.pdf", b"letter")
        self.source(1, h, r"3. CORRESPONDENCE\letter.pdf", "complete")
        self.assertEqual(self.run_op()["to_ingest"], [])

    def test_a_copy_whose_twin_is_not_ingested_offers_the_twin_once(self):
        h = self.place(r"0. DRAFT\order.pdf", b"order")
        self.place(r"5. COURT FILE#1\order.pdf", b"order")
        self.place(r"5. COURT FILE#2\order.pdf", b"order")
        self.source(1, h, r"0. DRAFT\order.pdf", "partial")
        self.assertEqual(self.run_op()["to_ingest"], [r"0. DRAFT\order.pdf"])

    def test_two_identical_unrecorded_files_offer_the_first_once(self):
        self.place(r"3. CORRESPONDENCE\a.pdf", b"same")
        self.place(r"5. COURT FILE#1\a.pdf", b"same")
        self.assertEqual(self.run_op()["to_ingest"], [r"3. CORRESPONDENCE\a.pdf"])

    def test_an_anomaly_is_damaged_and_not_offered(self):
        h = self.place(r"5. COURT FILE#1\a.pdf", b"a")
        bare = sqlite3.connect(self.paths["main"])
        try:
            for sid in (1, 2):
                bare.execute(
                    "INSERT INTO sources (source_id, category, title, file_path, file_hash, "
                    "ingestion_status) VALUES (?, 'court', 't', ?, ?, 'complete')",
                    (sid, r"5. COURT FILE#1\a.pdf", h))
            bare.commit()
        finally:
            bare.close()
        out = self.run_op()
        self.assertEqual((out["to_ingest"], out["damaged"]), ([], [r"5. COURT FILE#1\a.pdf"]))

    def test_an_unreadable_file_is_named_with_its_error_and_not_offered(self):
        self.place(r"3. CORRESPONDENCE\b.pdf", b"b")
        real_open = open

        def locked_open(path, *args, **kwargs):
            if str(path).endswith("b.pdf"):
                raise PermissionError("locked")
            return real_open(path, *args, **kwargs)

        self.fn["open"] = locked_open
        scope = self.fn["scope_files"](str(self.matter), GLOBS)
        self.assertEqual(scope["files"], [])
        self.assertEqual(scope["unreadable"][0]["path"], r"3. CORRESPONDENCE\b.pdf")
        self.assertIn("locked", scope["unreadable"][0]["error"])

    # -- records: why each file is not held ------------------------------------

    PENDING = "SUPERSEDE-PENDING: possible other version of source #34."

    def test_a_partial_row_gives_a_record_with_its_verdict_and_source(self):
        h = self.place(r"5. COURT FILE#1\p.pdf", b"p")
        self.source(7, h, r"5. COURT FILE#1\p.pdf", "partial")
        out = self.run_op()
        self.assertEqual(out["records"], [
            {"path": r"5. COURT FILE#1\p.pdf", "verdict": "partial", "source_id": 7,
             "possible_version_of": None}])
        self.assertEqual(out["to_ingest"], [r"5. COURT FILE#1\p.pdf"])

    def test_a_marked_row_carries_the_possible_version(self):
        h = self.place(r"5. COURT FILE#1\aff draft.pdf", b"draft")
        self.source(7, h, r"5. COURT FILE#1\aff draft.pdf", "partial",
                    notes="DISCREPANCY: possible duplicate of source #3.\n" + self.PENDING)
        self.assertEqual(self.run_op()["records"], [
            {"path": r"5. COURT FILE#1\aff draft.pdf", "verdict": "partial", "source_id": 7,
             "possible_version_of": 34}])

    def test_a_free_text_note_alone_carries_no_possible_version(self):
        h = self.place(r"5. COURT FILE#1\aff draft.pdf", b"draft")
        self.source(7, h, r"5. COURT FILE#1\aff draft.pdf", "partial",
                    notes="DISCREPANCY: possible duplicate of source #34.")
        self.assertIsNone(self.run_op()["records"][0]["possible_version_of"])

    def test_records_and_to_ingest_keep_one_length_and_order(self):
        hm = self.place(r"3. CORRESPONDENCE\marked.pdf", b"marked")
        self.place(r"3. CORRESPONDENCE\new.pdf", b"new")
        hi = self.place(r"3. CORRESPONDENCE\held.pdf", b"held")
        hf = self.place(r"5. COURT FILE#1\f.pdf", b"f")
        self.place(r"5. COURT FILE#1\new copy.pdf", b"new")
        hp = self.place(r"5. COURT FILE#1\p.pdf", b"p")
        self.place(r"5. COURT FILE#1\Old\marked copy.pdf", b"marked")
        hs = self.place(r"5. COURT FILE#1\superseded.pdf", b"superseded")
        self.source(1, hm, r"3. CORRESPONDENCE\marked.pdf", "partial", notes=self.PENDING)
        self.source(2, hi, r"3. CORRESPONDENCE\held.pdf", "complete")
        self.source(3, hf, r"5. COURT FILE#1\f.pdf", "failed")
        self.source(4, hp, r"5. COURT FILE#1\p.pdf", "partial")
        self.source(5, hs, r"5. COURT FILE#1\superseded.pdf", "partial",
                    notes="[SUPERSEDED-BY:#4 2026-10-05 practitioner]")
        out = self.run_op()
        self.assertEqual(out["to_ingest"], [
            r"3. CORRESPONDENCE\marked.pdf", r"3. CORRESPONDENCE\new.pdf",
            r"5. COURT FILE#1\f.pdf", r"5. COURT FILE#1\p.pdf"])
        self.assertEqual([r["path"] for r in out["records"]], out["to_ingest"])
        self.assertEqual([(r["verdict"], r["source_id"], r["possible_version_of"]) for r in out["records"]],
                         [("partial", 1, 34), ("none", None, None), ("failed", 3, None), ("partial", 4, None)])
        for record in out["records"]:
            self.assertEqual(set(record), {"path", "verdict", "source_id", "possible_version_of"})

    def test_a_path_named_by_a_copy_takes_the_copys_verdict_and_the_twins_source(self):
        h = self.place(r"0. DRAFT\order.pdf", b"order")
        self.place(r"5. COURT FILE#1\order.pdf", b"order")
        self.place(r"5. COURT FILE#2\order.pdf", b"order")
        self.source(7, h, r"0. DRAFT\order.pdf", "partial", notes=self.PENDING)
        self.assertEqual(self.run_op()["records"], [
            {"path": r"0. DRAFT\order.pdf", "verdict": "none", "source_id": 7, "possible_version_of": 34}])

    def test_nothing_to_ingest_gives_no_records(self):
        h = self.place(r"5. COURT FILE#1\nocc.pdf", b"nocc")
        self.source(1, h, r"5. COURT FILE#1\nocc.pdf", "complete", notes=self.PENDING)
        out = self.run_op()
        self.assertEqual((out["to_ingest"], out["records"]), ([], []))

    # -- newest correspondence -------------------------------------------------

    def test_newest_correspondence_counts_only_ingested_correspondence(self):
        h1 = self.place(r"3. CORRESPONDENCE\a.pdf", b"a")
        h2 = self.place(r"2. SOLICITOR CLIENT\b.msg", b"b")
        h3 = self.place(r"5. COURT FILE#1\order.pdf", b"order")
        h4 = self.place(r"3. CORRESPONDENCE\c.pdf", b"c")
        self.source(1, h1, r"3. CORRESPONDENCE\a.pdf", "complete", date="2026-08-01")
        self.privileged(1, h2, r"2. SOLICITOR CLIENT\b.msg", date="2026-09-18")
        self.source(2, h3, r"5. COURT FILE#1\order.pdf", "complete", date="2026-09-30")
        self.source(3, h4, r"3. CORRESPONDENCE\c.pdf", "partial", date="2026-09-29")
        self.assertEqual(self.run_op()["newest_correspondence"],
                         {"date": "2026-09-18", "path": r"2. SOLICITOR CLIENT\b.msg"})

    def test_a_copy_of_ingested_correspondence_still_dates_it(self):
        h = self.place(r"0. DRAFT\letter.pdf", b"letter")
        self.place(r"3. CORRESPONDENCE\letter.pdf", b"letter")
        self.source(1, h, r"0. DRAFT\letter.pdf", "complete", date="2026-09-20")
        self.assertEqual(self.run_op()["newest_correspondence"],
                         {"date": "2026-09-20", "path": r"3. CORRESPONDENCE\letter.pdf"})

    def test_no_dated_ingested_correspondence_is_null(self):
        h = self.place(r"3. CORRESPONDENCE\a.pdf", b"a")
        self.source(1, h, r"3. CORRESPONDENCE\a.pdf", "complete")
        self.assertIsNone(self.run_op()["newest_correspondence"])


if __name__ == "__main__":
    unittest.main()
