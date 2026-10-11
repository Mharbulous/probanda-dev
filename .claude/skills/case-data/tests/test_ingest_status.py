"""ingest-status (operations/ingest-status.md): the probe SQL and the verdict
function, run against synthetic temp databases and a temp matter folder."""

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
OPERATION_PATH = CASE_DATA_ROOT / "operations" / "ingest-status.md"

spec = importlib.util.spec_from_file_location("case_data_rebuild", SCRIPTS_DIR / "rebuild.py")
rebuild = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rebuild)

MATTER_ROOT = r"C:\Users\Test\Litigation - Documents\L9000 Test Matter"
ORDER_EFFECTS = "ORDER-EFFECTS-PENDING: order-effects pass not yet run"
LINKAGE = "LINKAGE-PENDING: proceeding linkage check not yet run"
DATE_ANCHOR = "DATE-ANCHOR-PENDING: date not yet recorded as an anchor"


def fenced(path, lang, needle):
    text = path.read_text(encoding="utf-8")
    for body in re.findall(r"```" + lang + r"\n(.*?)```", text, re.S):
        if needle in body:
            return body
    raise AssertionError(f"no ```{lang} block containing {needle!r} in {path.name}")


def load_functions():
    namespace = {}
    exec(fenced(CONVENTIONS_PATH, "python", "def stored_form("), namespace)
    exec(fenced(OPERATION_PATH, "python", "def ingest_status("), namespace)
    return namespace


def sha(data):
    return hashlib.sha256(data).hexdigest()


class IngestStatusTests(unittest.TestCase):
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

    def source(self, source_id, file_hash, file_path, status, parent=None, notes=None):
        self.con.execute(
            "INSERT INTO main.sources (source_id, category, title, file_path, file_hash, "
            "ingestion_status, parent_source_id, notes) VALUES (?, 'court', ?, ?, ?, ?, ?, ?)",
            (source_id, f"Source {source_id}", file_path, file_hash, status, parent, notes),
        )

    def status(self, files):
        probe = fenced(OPERATION_PATH, "sql", "-- ingest-status probe")
        rows = [dict(r) for r in self.con.execute(
            probe, (json.dumps([f["hash"] for f in files]),)).fetchall()]
        return self.fn["ingest_status"](files, rows, MATTER_ROOT, str(self.matter))

    def one(self, path, file_hash):
        return self.status([{"path": path, "hash": file_hash}])[0]

    # -- B4.1 item 1: main sources ------------------------------------------

    def test_complete_source_at_its_own_path_is_ingested(self):
        h = self.place(r"5. COURT FILE\nocc.pdf", b"nocc")
        self.source(1, h, r"5. COURT FILE\nocc.pdf", "complete")
        out = self.one(r"5. COURT FILE\nocc.pdf", h)
        self.assertEqual((out["verdict"], out["store"], out["source_ids"]),
                         ("ingested", "main", [1]))
        self.assertEqual(out["stored_path"], r"5. COURT FILE\nocc.pdf")
        self.assertFalse(out["moved"])
        self.assertEqual(out["metadata"]["title"], "Source 1")

    def test_null_status_with_a_child_row_is_ingested(self):
        h = self.place("a.pdf", b"a")
        self.source(1, h, "a.pdf", None)
        self.con.execute(
            "INSERT INTO main.facts (fact_id, description, source_id) VALUES (1, 'x', 1)")
        self.assertEqual(self.one("a.pdf", h)["verdict"], "ingested")

    def test_null_status_without_children_is_not_ingested(self):
        h = self.place("a.pdf", b"a")
        self.source(1, h, "a.pdf", None)
        out = self.one("a.pdf", h)
        self.assertEqual((out["verdict"], out["store"], out["source_ids"]), ("none", "main", [1]))

    def test_partial_and_failed_are_reported_as_themselves(self):
        hp = self.place("p.pdf", b"p")
        hf = self.place("f.pdf", b"f")
        self.source(1, hp, "p.pdf", "partial")
        self.source(2, hf, "f.pdf", "failed")
        out = self.status([{"path": "p.pdf", "hash": hp}, {"path": "f.pdf", "hash": hf}])
        self.assertEqual([o["verdict"] for o in out], ["partial", "failed"])

    def test_an_affidavit_exhibit_is_never_the_anchor(self):
        h = self.place("aff.pdf", b"aff")
        self.source(1, h, "aff.pdf", "complete")
        self.source(2, h, "aff.pdf", None, parent=1)
        out = self.one("aff.pdf", h)
        self.assertEqual((out["verdict"], out["source_ids"]), ("ingested", [1]))

    def test_two_top_level_sources_are_an_anomaly(self):
        # The TEMP trigger refuses this on a normal connection; a bare one
        # (no triggers loaded) stands in for a legacy corrupt matter.
        h = self.place("a.pdf", b"a")
        con = sqlite3.connect(self.paths["main"])
        try:
            for sid in (1, 2):
                con.execute(
                    "INSERT INTO sources (source_id, category, title, file_path, file_hash, "
                    "ingestion_status) VALUES (?, 'court', 't', 'a.pdf', ?, 'complete')", (sid, h))
            con.commit()
        finally:
            con.close()
        out = self.one("a.pdf", h)
        self.assertEqual((out["verdict"], out["anomaly"]), ("none", "more than one top-level source"))

    def test_pending_markers_are_reported(self):
        h = self.place("order.pdf", b"order")
        self.source(1, h, "order.pdf", "complete", notes="Earlier note.")
        append = fenced(CONVENTIONS_PATH, "sql", "-- pending marker: append")
        for marker in (ORDER_EFFECTS, LINKAGE, DATE_ANCHOR):
            self.con.execute(append, {"marker": marker, "source_id": 1})
        self.assertEqual(self.one("order.pdf", h)["pending"],
                         ["order_effects", "linkage", "date_anchor"])

    def test_a_supersede_pending_marker_is_reported(self):
        h = self.place(r"5. COURT FILE\nocc filed.pdf", b"filed")
        self.source(1, h, r"5. COURT FILE\nocc filed.pdf", "complete",
                    notes="SUPERSEDE-PENDING: possible other version of source #7.")
        self.assertEqual(self.one(r"5. COURT FILE\nocc filed.pdf", h)["pending"], ["supersede"])

    # -- a superseded version (supersede-draft.md, design-decisions #64) ------

    SUPERSEDED = "DISCREPANCY: rejected filing\n[SUPERSEDED-BY:#34 2026-10-05 practitioner]"

    def test_a_superseded_source_is_held_whatever_its_status_and_names_the_kept_source(self):
        for status in ("partial", "complete", None):
            with self.subTest(status=status):
                self.con.execute("DELETE FROM main.sources")
                h = self.place(r"0. DRAFT\Superseded\aff draft.pdf", b"draft")
                self.source(20, h, r"0. DRAFT\Superseded\aff draft.pdf", status, notes=self.SUPERSEDED)
                out = self.one(r"0. DRAFT\Superseded\aff draft.pdf", h)
                self.assertEqual((out["verdict"], out["store"], out["source_ids"], out["superseded_by"]),
                                 ("superseded", "main", [20], 34))
                self.assertFalse(out["moved"])

    def test_a_superseded_source_left_outside_the_superseded_folder_is_move_pending(self):
        h = self.place(r"5. COURT FILE\aff draft.pdf", b"draft")
        self.source(20, h, r"5. COURT FILE\aff draft.pdf", "partial", notes=self.SUPERSEDED)
        out = self.one(r"5. COURT FILE\aff draft.pdf", h)
        self.assertEqual((out["verdict"], out["move_pending"]), ("superseded", True))
        self.con.execute("UPDATE main.sources SET file_path = ? WHERE source_id = 20",
                         (r"0. DRAFT\Superseded\aff draft.pdf",))
        self.place(r"0. DRAFT\Superseded\aff draft.pdf", b"draft")
        self.assertFalse(self.one(r"0. DRAFT\Superseded\aff draft.pdf", h)["move_pending"])
        h2 = self.place("a.pdf", b"a")
        self.source(1, h2, "a.pdf", "complete")
        self.assertFalse(self.one("a.pdf", h2)["move_pending"])

    def test_only_a_superseded_source_has_superseded_by(self):
        h = self.place("a.pdf", b"a")
        self.source(1, h, "a.pdf", "complete", notes="[NOT-VERSION-OF:#34 2026-10-05 strict-test]")
        self.assertEqual((self.one("a.pdf", h)["verdict"], self.one("a.pdf", h)["superseded_by"]),
                         ("ingested", None))

    def test_a_copy_of_a_superseded_file_put_back_is_a_copy_of_a_held_twin(self):
        h = self.place(r"0. DRAFT\Superseded\aff draft.pdf", b"draft")
        self.place(r"5. COURT FILE\aff draft.pdf", b"draft")
        self.source(20, h, r"0. DRAFT\Superseded\aff draft.pdf", "partial", notes=self.SUPERSEDED)
        out = self.one(r"5. COURT FILE\aff draft.pdf", h)
        self.assertEqual((out["verdict"], out["duplicate_of"], out["twin_ingested"]),
                         ("none", r"0. DRAFT\Superseded\aff draft.pdf", True))

    def test_clearing_a_marker_leaves_the_rest_of_the_note(self):
        append = fenced(CONVENTIONS_PATH, "sql", "-- pending marker: append")
        clear = fenced(CONVENTIONS_PATH, "sql", "-- pending marker: clear")
        self.source(1, "x", "a.pdf", "complete", notes="Earlier note.")
        self.source(2, "y", "b.pdf", "complete")
        for sid in (1, 2):
            for marker in (ORDER_EFFECTS, LINKAGE):
                self.con.execute(append, {"marker": marker, "source_id": sid})
        for _ in range(2):  # clearing twice is a no-op
            for sid in (1, 2):
                self.con.execute(clear, {"marker": ORDER_EFFECTS, "source_id": sid})
        notes = dict(self.con.execute("SELECT source_id, notes FROM main.sources"))
        self.assertEqual(notes, {1: "Earlier note.\n" + LINKAGE, 2: LINKAGE})
        self.con.execute(clear, {"marker": LINKAGE, "source_id": 2})
        self.assertIsNone(self.con.execute(
            "SELECT notes FROM main.sources WHERE source_id = 2").fetchone()[0])

    # -- B4.1 item 2: privileged ---------------------------------------------

    def test_a_privileged_source_is_ingested(self):
        h = self.place("memo.pdf", b"memo")
        self.con.execute(
            "INSERT INTO privileged.privileged_sources (source_id, category, title, author, "
            "file_path, file_hash) VALUES (4, 'privileged_work_product', 'Memo', 'BW', "
            "'memo.pdf', ?)", (h,))
        out = self.one("memo.pdf", h)
        self.assertEqual((out["verdict"], out["store"], out["source_ids"]),
                         ("ingested", "privileged", [4]))
        self.assertEqual(out["metadata"]["author"], "BW")

    # -- B4.1 item 3: law ------------------------------------------------------

    def authority(self, authority_id, citation, file_path, file_hash, notes=None):
        self.con.execute(
            "INSERT INTO law.authorities (authority_id, title, citation, authority_type, "
            "file_path, file_hash, notes) VALUES (?, 'A v B', ?, 'case_law', ?, ?, ?)",
            (authority_id, citation, file_path, file_hash, notes))

    def test_an_authority_row_matched_by_hash_is_ingested(self):
        h = self.place(r"6. LAW\a v b.pdf", b"case")
        self.authority(7, "2020 BCCA 1", r"6. LAW\a v b.pdf", h)
        out = self.one(r"6. LAW\a v b.pdf", h)
        self.assertEqual((out["verdict"], out["store"], out["source_ids"]), ("ingested", "law", [7]))
        self.assertEqual(out["metadata"]["citation"], "2020 BCCA 1")

    def test_a_book_of_authorities_reports_every_bundled_authority(self):
        h = self.place("boa.pdf", b"boa")
        self.authority(7, "2020 BCCA 1", "boa.pdf", h)
        self.authority(8, "2021 BCSC 2", "boa.pdf", h)
        self.assertEqual(self.one("boa.pdf", h)["source_ids"], [7, 8])

    def test_second_copies_read_by_reference_are_ingested_by_reference(self):
        # Two more files of one authority: one reused on the exact citation, one
        # on a shared neutral token (extraction-protocol.md). Either reuse is
        # recorded the same way, by the [SECOND-COPY:] marker (conventions §11).
        first = self.place(r"6. LAW\a v b.pdf", b"case")
        self.authority(7, "A v B, 2020 BCCA 1", r"6. LAW\a v b.pdf", first)
        exact = self.place(r"6. LAW\copy one.pdf", b"copy one")
        neutral = self.place(r"6. LAW\copy two.pdf", b"copy two")
        append = fenced(CONVENTIONS_PATH, "sql", "-- pending marker: append").replace(
            "main.sources", "law.authorities").replace("source_id", "authority_id")
        for h in (exact, neutral, exact):  # a repeat append is a no-op
            self.con.execute(append, {"marker": f"[SECOND-COPY:{h}]", "authority_id": 7})
        notes = self.con.execute("SELECT notes FROM law.authorities").fetchone()[0]
        self.assertEqual(notes.count("[SECOND-COPY:"), 2)
        out = self.status([{"path": r"6. LAW\copy one.pdf", "hash": exact},
                           {"path": r"6. LAW\copy two.pdf", "hash": neutral}])
        for o in out:
            self.assertEqual((o["verdict"], o["store"], o["source_ids"]),
                             ("ingested_by_reference", "law", [7]))
            self.assertIsNone(o["duplicate_of"])
        # The first file is still ingested in its own right.
        self.assertEqual(self.one(r"6. LAW\a v b.pdf", first)["verdict"], "ingested")

    def test_a_second_copy_matched_on_a_tombstone_is_held_by_the_canonical_row(self):
        # Path D (ingest-extract.md): a citation match on a merge tombstone writes
        # the marker to the canonical row, and presenting the file again adds nothing.
        first = self.place(r"6. LAW\a v b.pdf", b"case")
        self.authority(7, "A v B, 2020 BCCA 1", r"6. LAW\a v b.pdf", first)
        self.authority(9, "2020 BCCA 1", r"6. LAW\old.pdf", sha(b"old"),
                       notes="[MERGED-INTO:#7 2026-07-20 BW]")
        copy = self.place(r"6. LAW\copy.pdf", b"copy")
        append = fenced(CONVENTIONS_PATH, "sql", "-- pending marker: append").replace(
            "main.sources", "law.authorities").replace("source_id", "authority_id")
        for _ in range(2):
            self.con.execute(append, {"marker": f"[SECOND-COPY:{copy}]", "authority_id": 7})
        notes = dict(self.con.execute("SELECT authority_id, notes FROM law.authorities"))
        self.assertEqual(notes, {7: f"[SECOND-COPY:{copy}]", 9: "[MERGED-INTO:#7 2026-07-20 BW]"})
        out = self.one(r"6. LAW\copy.pdf", copy)
        self.assertEqual((out["verdict"], out["store"], out["source_ids"]),
                         ("ingested_by_reference", "law", [7]))

    def test_a_merge_tombstone_names_its_canonical_row(self):
        h = self.place("d.pdf", b"d")
        self.authority(9, "2020 BCCA 1", "d.pdf", h,
                       notes="[MERGED-INTO:#7 2026-07-20 BW] earlier")
        out = self.one("d.pdf", h)
        self.assertEqual((out["verdict"], out["merged_into"]), ("ingested", 7))

    # -- an email attachment filed beside its email (design-decisions #54) ----

    def email_with_attachment(self, attachment_status):
        """Email 1 at its own path; attachment 2 is its child with its own hash
        and no path. The attachment's bytes are then filed as a sibling file."""
        email = self.place(r"3. CORRESPONDENCE\email.eml", b"email")
        self.source(1, email, r"3. CORRESPONDENCE\email.eml", "complete")
        h = self.place(r"3. CORRESPONDENCE\invoice.pdf", b"invoice")
        self.source(2, h, None, attachment_status, parent=1)
        return h

    def test_a_filed_copy_of_a_read_attachment_is_ingested_by_reference(self):
        h = self.email_with_attachment("complete")
        out = self.one(r"3. CORRESPONDENCE\invoice.pdf", h)
        self.assertEqual((out["verdict"], out["store"], out["source_ids"]),
                         ("ingested_by_reference", "main", [2]))
        self.assertEqual((out["stored_path"], out["moved"], out["duplicate_of"]),
                         (None, False, None))
        self.assertEqual(out["metadata"]["title"], "Source 2")

    def test_an_attachment_not_read_through_is_not_a_record_of_the_file(self):
        for status in ("failed", "partial", None):
            with self.subTest(status=status):
                self.con.execute("DELETE FROM main.sources")
                h = self.email_with_attachment(status)
                out = self.one(r"3. CORRESPONDENCE\invoice.pdf", h)
                self.assertEqual((out["verdict"], out["store"], out["source_ids"]),
                                 ("none", None, []))

    def test_an_attached_affidavit_is_named_by_its_own_row_not_its_exhibit(self):
        h = self.email_with_attachment("complete")
        self.source(3, h, None, None, parent=2)
        out = self.one(r"3. CORRESPONDENCE\invoice.pdf", h)
        self.assertEqual((out["verdict"], out["source_ids"]), ("ingested_by_reference", [2]))

    def test_a_book_child_is_never_the_anchor(self):
        h = self.place(r"5. COURT FILE\book.pdf", b"book")
        self.source(1, h, r"5. COURT FILE\book.pdf", "complete")
        self.source(2, h, r"5. COURT FILE\book.pdf", "complete", parent=1)
        out = self.one(r"5. COURT FILE\book.pdf", h)
        self.assertEqual((out["verdict"], out["source_ids"]), ("ingested", [1]))

    def test_a_top_level_row_outranks_an_attachment_with_the_same_hash(self):
        h = self.email_with_attachment("failed")
        self.source(3, h, r"3. CORRESPONDENCE\invoice.pdf", "complete")
        out = self.one(r"3. CORRESPONDENCE\invoice.pdf", h)
        self.assertEqual((out["verdict"], out["source_ids"]), ("ingested", [3]))

    def test_two_copies_of_a_read_attachment_in_one_list_make_the_later_a_duplicate(self):
        h = self.email_with_attachment("complete")
        self.place("invoice copy.pdf", b"invoice")
        out = self.status([{"path": r"3. CORRESPONDENCE\invoice.pdf", "hash": h},
                           {"path": "invoice copy.pdf", "hash": h}])
        self.assertEqual(out[0]["verdict"], "ingested_by_reference")
        self.assertEqual((out[1]["verdict"], out[1]["duplicate_of"], out[1]["twin_ingested"]),
                         ("none", r"3. CORRESPONDENCE\invoice.pdf", True))

    # -- nothing stored ------------------------------------------------------

    def test_no_record_is_none(self):
        h = self.place("new.pdf", b"new")
        out = self.one("new.pdf", h)
        self.assertEqual((out["verdict"], out["store"], out["source_ids"]), ("none", None, []))

    # -- copy or the same file? ------------------------------------------------

    def test_a_twin_still_at_the_stored_path_makes_this_file_a_duplicate(self):
        h = self.place(r"3. CORRESPONDENCE\letter.pdf", b"letter")
        self.place("letter copy.pdf", b"letter")
        self.source(1, h, r"3. CORRESPONDENCE\letter.pdf", "complete")
        out = self.one("letter copy.pdf", h)
        self.assertEqual(out["verdict"], "none")
        self.assertEqual(out["duplicate_of"], r"3. CORRESPONDENCE\letter.pdf")
        self.assertTrue(out["twin_ingested"])
        self.assertFalse(out["moved"])

    def test_nothing_at_the_stored_path_means_the_file_was_moved_by_hand(self):
        h = self.place("letter.pdf", b"letter")
        self.source(1, h, r"3. CORRESPONDENCE\letter.pdf", "complete")
        out = self.one("letter.pdf", h)
        self.assertEqual((out["verdict"], out["moved"], out["duplicate_of"]),
                         ("ingested", True, None))

    def test_a_different_file_at_the_stored_path_is_not_a_twin(self):
        h = self.place("letter.pdf", b"letter")
        self.place(r"3. CORRESPONDENCE\letter.pdf", b"something else")
        self.source(1, h, r"3. CORRESPONDENCE\letter.pdf", "complete")
        self.assertTrue(self.one("letter.pdf", h)["moved"])

    def test_a_legacy_absolute_stored_path_is_the_same_file(self):
        h = self.place(r"3. CORRESPONDENCE\letter.pdf", b"letter")
        self.source(1, h, MATTER_ROOT + r"\3. correspondence/letter.pdf", "complete")
        out = self.one(r"3. CORRESPONDENCE\letter.pdf", h)
        self.assertEqual((out["verdict"], out["moved"], out["duplicate_of"]),
                         ("ingested", False, None))

    def test_two_identical_new_files_make_the_later_one_the_duplicate(self):
        h = self.place("a.pdf", b"same")
        self.place("b.pdf", b"same")
        out = self.status([{"path": "a.pdf", "hash": h}, {"path": "b.pdf", "hash": h}])
        self.assertEqual([o["verdict"] for o in out], ["none", "none"])
        self.assertIsNone(out[0]["duplicate_of"])
        self.assertEqual((out[1]["duplicate_of"], out[1]["twin_ingested"]), ("a.pdf", False))

    def test_the_ingested_file_in_the_list_is_the_twin_whatever_the_order(self):
        h = self.place(r"5. COURT FILE\nocc.pdf", b"nocc")
        self.place("nocc.pdf", b"nocc")
        self.source(1, h, r"5. COURT FILE\nocc.pdf", "complete")
        out = self.status([{"path": "nocc.pdf", "hash": h},
                           {"path": r"5. COURT FILE\nocc.pdf", "hash": h}])
        self.assertEqual((out[0]["verdict"], out[0]["duplicate_of"]),
                         ("none", r"5. COURT FILE\nocc.pdf"))
        self.assertEqual((out[1]["verdict"], out[1]["duplicate_of"]), ("ingested", None))

    def test_a_copy_of_a_file_ingested_by_reference_has_an_ingested_twin(self):
        first = self.place(r"6. LAW\a v b.pdf", b"case")
        h = self.place(r"6. LAW\copy.pdf", b"copy")
        self.place("copy again.pdf", b"copy")
        self.authority(7, "A v B, 2020 BCCA 1", r"6. LAW\a v b.pdf", first, notes=f"[SECOND-COPY:{h}]")
        out = self.status([{"path": r"6. LAW\copy.pdf", "hash": h}, {"path": "copy again.pdf", "hash": h}])
        self.assertEqual((out[0]["verdict"], out[0]["duplicate_of"]), ("ingested_by_reference", None))
        self.assertEqual((out[1]["verdict"], out[1]["duplicate_of"], out[1]["twin_ingested"]),
                         ("none", r"6. LAW\copy.pdf", True))

    def test_two_copies_of_a_file_moved_by_hand_leave_one_candidate(self):
        h = self.place("a.pdf", b"same")
        self.place("b.pdf", b"same")
        self.source(1, h, r"3. CORRESPONDENCE\gone.pdf", "complete")
        out = self.status([{"path": "a.pdf", "hash": h}, {"path": "b.pdf", "hash": h}])
        self.assertEqual((out[0]["verdict"], out[0]["moved"]), ("ingested", True))
        self.assertEqual((out[1]["verdict"], out[1]["duplicate_of"], out[1]["twin_ingested"]),
                         ("none", "a.pdf", True))


class FolderScanClassifyTests(unittest.TestCase):
    """extract-facts.md §3 classify agrees with ingest-status: on a standalone
    copy of an email attachment (design-decisions #54), on the privileged store,
    and on a source that was not read through (#1311); and it reads every stored
    path form, reports corruption and catches a file overwritten by a copy (#1334);
    and on an authority the law store holds (#1326)."""

    def setUp(self):
        sections = rebuild.parse_sections(SCHEMA_PATH.read_text(encoding="utf-8"))
        self.tmp = tempfile.TemporaryDirectory()
        self.con = sqlite3.connect(":memory:")
        self.con.executescript(sections["main"])
        for name in ("privileged", "law"):
            path = Path(self.tmp.name) / f"{name}.sqlite"
            con = sqlite3.connect(path)
            try:
                con.executescript(sections[name])
            finally:
                con.close()
            self.con.execute(f"ATTACH DATABASE ? AS {name}", (str(path),))
        namespace = {}
        exec(fenced(CONVENTIONS_PATH, "python", "def stored_form("), namespace)
        exec(fenced(CASE_DATA_ROOT / "operations" / "extract-facts.md", "python",
                    "def classify("), namespace)
        self.classify = lambda con, path, file_hash: namespace["classify"](
            con, path, file_hash, MATTER_ROOT)
        self.extract = namespace["EXTRACT"]
        self.con.execute(
            "INSERT INTO sources (source_id, category, title, file_path, file_hash, "
            "ingestion_status) VALUES (1, 'correspondence', 'email', 'email.eml', 'e', 'complete')")

    def tearDown(self):
        self.con.close()
        self.tmp.cleanup()

    def held(self, status):
        self.con.execute(
            "INSERT INTO sources (source_id, category, title, file_path, file_hash, "
            "ingestion_status) VALUES (5, 'court', 'order', 'order.pdf', 'o', ?)", (status,))

    def test_a_privileged_source_at_the_same_path_is_unchanged(self):
        self.con.execute(
            "INSERT INTO privileged.privileged_sources (source_id, category, title, "
            "file_path, file_hash) VALUES (7, 'solicitor_client', 'advice', 'advice.eml', 'p')")
        # A failed main row for the same bytes must not decide the scan.
        self.con.execute(
            "INSERT INTO sources (source_id, category, title, file_path, file_hash, "
            "ingestion_status) VALUES (8, 'correspondence', 'advice', 'advice.eml', 'p', 'failed')")
        for path, expected in (("advice.eml", "unchanged"), ("copy\\advice.eml", "duplicate")):
            with self.subTest(path=path):
                result = self.classify(self.con, path, "p")
                self.assertEqual(result, expected)
                self.assertNotIn(result, self.extract)

    def test_a_failed_or_empty_source_is_re_extracted(self):
        for status in ("failed", None):
            with self.subTest(status=status):
                self.con.execute("DELETE FROM sources WHERE source_id = 5")
                self.held(status)
                result = self.classify(self.con, "order.pdf", "o")
                self.assertEqual(result, "re-extract")
                self.assertIn(result, self.extract)

    def test_a_partial_source_is_neither_unchanged_nor_batch_extracted(self):
        self.held("partial")
        result = self.classify(self.con, "order.pdf", "o")
        self.assertEqual(result, "partial")
        self.assertNotIn(result, self.extract)

    def test_a_complete_source_or_one_with_child_rows_is_unchanged(self):
        self.held("complete")
        self.assertEqual(self.classify(self.con, "order.pdf", "o"), "unchanged")
        self.con.execute("DELETE FROM sources WHERE source_id = 5")
        self.held(None)
        for table, insert in (
                ("facts", "INSERT INTO facts (fact_id, description, source_id) VALUES (1, 'x', 5)"),
                ("witnesses", "INSERT INTO witnesses (witness_id, name, witness_type, "
                              "report_source_id) VALUES (1, 'Dr X', 'expert', 5)")):
            with self.subTest(table=table):
                self.con.execute("DELETE FROM facts")
                self.con.execute("DELETE FROM witnesses")
                self.assertEqual(self.classify(self.con, "order.pdf", "o"), "re-extract")
                self.con.execute(insert)
                self.assertEqual(self.classify(self.con, "order.pdf", "o"), "unchanged")

    def attachment(self, status):
        self.con.execute(
            "INSERT INTO sources (source_id, category, title, file_path, file_hash, "
            "ingestion_status, parent_source_id) VALUES (2, 'correspondence', 'invoice.pdf', "
            "NULL, 'a', ?, 1)", (status,))

    def test_a_copy_of_a_read_attachment_is_a_duplicate(self):
        self.attachment("complete")
        self.assertEqual(self.classify(self.con, "invoice.pdf", "a"), "duplicate")

    def test_a_copy_of_an_attachment_not_read_through_is_new(self):
        for status in ("failed", "partial", None):
            with self.subTest(status=status):
                self.con.execute("DELETE FROM sources WHERE source_id = 2")
                self.attachment(status)
                self.assertEqual(self.classify(self.con, "invoice.pdf", "a"), "new")

    def test_an_affidavit_exhibit_never_makes_its_body_a_duplicate(self):
        self.con.execute(
            "INSERT INTO sources (source_id, category, title, file_path, file_hash, "
            "ingestion_status) VALUES (3, 'court', 'aff', 'aff.pdf', 'f', 'complete')")
        self.con.execute(
            "INSERT INTO sources (source_id, category, title, file_path, file_hash, "
            "parent_source_id) VALUES (4, 'court', 'Exhibit A', 'aff.pdf', 'f', 3)")
        self.assertEqual(self.classify(self.con, "aff.pdf", "f"), "unchanged")

    def test_an_exhibit_row_never_stands_in_for_its_body_status(self):
        # The exhibit has the lower id, so an unfiltered path lookup would read
        # its NULL status, with no child rows, as an ingest that never ran.
        self.con.execute(
            "INSERT INTO sources (source_id, category, title, file_path, file_hash, "
            "ingestion_status) VALUES (4, 'court', 'aff', 'aff.pdf', 'f', 'complete')")
        self.con.execute(
            "INSERT INTO sources (source_id, category, title, file_path, file_hash, "
            "parent_source_id) VALUES (3, 'court', 'Exhibit A', 'aff.pdf', 'f', 4)")
        self.assertEqual(self.classify(self.con, "aff.pdf", "f"), "unchanged")

    def test_a_legacy_or_differently_cased_stored_path_is_the_same_file(self):
        scanned = r"5. COURT FILE\order.pdf"
        for stored in (MATTER_ROOT + "\\" + scanned, "5. COURT FILE/order.pdf",
                       r"5. court file\ORDER.PDF"):
            for status, file_hash, expected in (("complete", "o", "unchanged"),
                                                ("failed", "o", "re-extract"),
                                                ("partial", "o", "partial"),
                                                ("complete", "edited", "changed")):
                with self.subTest(stored=stored, status=status, file_hash=file_hash):
                    self.con.execute("DELETE FROM sources WHERE source_id = 5")
                    self.con.execute(
                        "INSERT INTO sources (source_id, category, title, file_path, file_hash, "
                        "ingestion_status) VALUES (5, 'court', 'order', ?, 'o', ?)",
                        (stored, status))
                    self.assertEqual(self.classify(self.con, scanned, file_hash), expected)

    def test_a_privileged_path_differing_only_in_form_or_case_is_unchanged(self):
        for i, stored in enumerate((MATTER_ROOT + r"\3. CORRESPONDENCE\advice.eml",
                                    "3. CORRESPONDENCE/advice.eml",
                                    r"3. correspondence\ADVICE.EML")):
            with self.subTest(stored=stored):
                self.con.execute("DELETE FROM privileged.privileged_sources")
                self.con.execute(
                    "INSERT INTO privileged.privileged_sources (source_id, category, title, "
                    "file_path, file_hash) VALUES (?, 'solicitor_client', 'advice', ?, 'p')",
                    (7 + i, stored))
                self.assertEqual(
                    self.classify(self.con, r"3. CORRESPONDENCE\advice.eml", "p"), "unchanged")

    def test_two_top_level_rows_with_the_hash_are_reported_as_corruption(self):
        # Only legacy data can hold this: this class never loads triggers.sql,
        # whose top-level hash trigger would refuse the second insert.
        self.held("complete")
        self.con.execute(
            "INSERT INTO sources (source_id, category, title, file_path, file_hash, "
            "ingestion_status) VALUES (6, 'court', 'order', 'copy.pdf', 'o', 'complete')")
        for path in ("order.pdf", "copy.pdf", "third.pdf"):
            with self.subTest(path=path):
                result = self.classify(self.con, path, "o")
                self.assertEqual(result, "corrupt")
                self.assertNotIn(result, self.extract)

    def test_a_path_match_whose_new_bytes_are_held_elsewhere_is_a_duplicate(self):
        self.held("complete")
        # order.pdf now holds the bytes of the registered email.
        result = self.classify(self.con, "order.pdf", "e")
        self.assertEqual(result, "duplicate")
        self.assertNotIn(result, self.extract)
        self.con.execute(
            "INSERT INTO privileged.privileged_sources (source_id, category, title, "
            "file_path, file_hash) VALUES (7, 'solicitor_client', 'advice', 'advice.eml', 'p')")
        self.assertEqual(self.classify(self.con, "order.pdf", "p"), "duplicate")
        self.attachment("complete")
        self.assertEqual(self.classify(self.con, "order.pdf", "a"), "duplicate")

    def authority(self, notes=None):
        self.con.execute(
            "INSERT INTO law.authorities (authority_id, title, citation, authority_type, "
            "file_path, file_hash, notes) VALUES (7, 'A v B', '2020 BCCA 1', 'case_law', "
            "?, 'c', ?)", (r"6. LAW\a v b.pdf", notes))

    def test_an_authority_the_law_store_holds_is_never_extracted_again(self):
        self.authority()
        # A failed main row for the same bytes must not decide the scan.
        self.con.execute(
            "INSERT INTO sources (source_id, category, title, file_path, file_hash, "
            "ingestion_status) VALUES (8, 'court', 'a v b', ?, 'c', 'failed')",
            (r"6. LAW\a v b.pdf",))
        for path, expected in ((r"6. LAW\a v b.pdf", "unchanged"),
                               (r"6. law\A V B.PDF", "unchanged"),
                               (r"6. LAW\Cases\copy.pdf", "duplicate")):
            with self.subTest(path=path):
                result = self.classify(self.con, path, "c")
                self.assertEqual(result, expected)
                self.assertNotIn(result, self.extract)

    def test_a_superseded_version_is_held_at_any_path(self):
        self.con.execute(
            "INSERT INTO sources (source_id, category, title, file_path, file_hash, ingestion_status, notes) "
            "VALUES (20, 'court', 'aff', ?, 's', 'partial', "
            "'[SUPERSEDED-BY:#34 2026-10-05 practitioner]')", (r"0. DRAFT\Superseded\aff.pdf",))
        for path in (r"0. DRAFT\Superseded\aff.pdf", r"5. COURT FILE\aff.pdf"):
            with self.subTest(path=path):
                result = self.classify(self.con, path, "s")
                self.assertEqual(result, "superseded")
                self.assertNotIn(result, self.extract)

    def test_a_second_copy_read_by_reference_is_a_duplicate(self):
        self.authority(notes="[SECOND-COPY:s]")
        result = self.classify(self.con, r"6. LAW\second copy.pdf", "s")
        self.assertEqual(result, "duplicate")
        self.assertNotIn(result, self.extract)
        self.assertEqual(self.classify(self.con, r"6. LAW\other.pdf", "x"), "new")


class StoredFormTests(unittest.TestCase):
    def test_stored_form_is_matter_relative_with_backslashes(self):
        stored_form = load_functions()["stored_form"]
        self.assertEqual(stored_form(MATTER_ROOT + r"\5. COURT FILE\a.pdf", MATTER_ROOT),
                         r"5. COURT FILE\a.pdf")
        self.assertEqual(stored_form("5. COURT FILE/a.pdf", MATTER_ROOT), r"5. COURT FILE\a.pdf")
        self.assertEqual(stored_form(r".\a.pdf", MATTER_ROOT), "a.pdf")
        self.assertEqual(stored_form(MATTER_ROOT.upper() + r"\a.pdf", MATTER_ROOT), "a.pdf")
        self.assertEqual(stored_form(r"D:\Elsewhere\a.pdf", MATTER_ROOT), r"D:\Elsewhere\a.pdf")


if __name__ == "__main__":
    unittest.main()
