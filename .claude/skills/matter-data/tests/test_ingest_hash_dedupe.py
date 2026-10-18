import importlib.util
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path


CASE_DATA_ROOT = Path(__file__).resolve().parents[1]
TEST_TMP = CASE_DATA_ROOT.parents[2] / ".test-tmp"
TEST_TMP.mkdir(exist_ok=True)
TRIGGERS_PATH = CASE_DATA_ROOT / "references" / "triggers.sql"
SCHEMA_PATH = CASE_DATA_ROOT / "references" / "schema.sql"
INGEST_GATE_PATH = CASE_DATA_ROOT / "operations" / "ingest.md"
INGEST_EXTRACT_PATH = CASE_DATA_ROOT / "operations" / "ingest-extract.md"
INGEST_ROUTER_PATH = CASE_DATA_ROOT.parents[2] / ".claude" / "skills" / "ingest" / "SKILL.md"

sys.path.insert(0, str(CASE_DATA_ROOT / "references" / "scripts"))

spec = importlib.util.spec_from_file_location(
    "case_data_rebuild", CASE_DATA_ROOT / "references" / "scripts" / "rebuild.py"
)
rebuild = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rebuild)


class IngestHashDedupeTests(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory(dir=TEST_TMP)
        root = Path(self.tempdir.name)
        self.paths = {
            name: root / f"{name}.sqlite" for name in ("main", "law", "privileged")
        }
        sections = rebuild.parse_sections(SCHEMA_PATH.read_text(encoding="utf-8"))
        for name, path in self.paths.items():
            con = sqlite3.connect(path)
            try:
                con.executescript(sections[name])
            finally:
                con.close()

    def tearDown(self):
        self.tempdir.cleanup()

    def connect(self, load_triggers=True):
        con = sqlite3.connect(self.paths["main"])
        con.execute("ATTACH DATABASE ? AS law", (str(self.paths["law"]),))
        con.execute("ATTACH DATABASE ? AS privileged", (str(self.paths["privileged"]),))
        if load_triggers:
            con.executescript(TRIGGERS_PATH.read_text(encoding="utf-8"))
        return con

    @staticmethod
    def insert_source(con, source_id, file_hash, parent_source_id=None):
        con.execute(
            "INSERT INTO sources "
            "(source_id, category, title, file_hash, parent_source_id) "
            "VALUES (?, 'court', ?, ?, ?)",
            (source_id, f"Source {source_id}", file_hash, parent_source_id),
        )

    def test_serialized_same_hash_writes_leave_one_top_level_source(self):
        winner = self.connect()
        loser = self.connect()
        try:
            self.insert_source(winner, 1, "same-hash")
            winner.commit()
            with self.assertRaisesRegex(
                sqlite3.IntegrityError, "duplicate top-level source file_hash"
            ):
                self.insert_source(loser, 2, "same-hash")
            self.assertEqual(
                loser.execute(
                    "SELECT source_id FROM sources "
                    "WHERE file_hash = 'same-hash' AND parent_source_id IS NULL"
                ).fetchall(),
                [(1,)],
            )
        finally:
            loser.close()
            winner.close()

    def test_affidavit_child_may_share_body_hash(self):
        con = self.connect()
        try:
            self.insert_source(con, 1, "affidavit-hash")
            self.insert_source(con, 2, "affidavit-hash", parent_source_id=1)
            self.assertEqual(
                con.execute(
                    "SELECT source_id, parent_source_id FROM sources ORDER BY source_id"
                ).fetchall(),
                [(1, None), (2, 1)],
            )
        finally:
            con.close()

    def test_unrelated_hashes_insert_normally(self):
        con = self.connect()
        try:
            self.insert_source(con, 1, "hash-a")
            self.insert_source(con, 2, "hash-b")
            self.assertEqual(con.execute("SELECT COUNT(*) FROM sources").fetchone()[0], 2)
        finally:
            con.close()

    def test_existing_duplicates_do_not_prevent_trigger_loading(self):
        con = self.connect(load_triggers=False)
        try:
            self.insert_source(con, 1, "old-duplicate")
            self.insert_source(con, 2, "old-duplicate")
            con.executescript(TRIGGERS_PATH.read_text(encoding="utf-8"))
            with self.assertRaisesRegex(
                sqlite3.IntegrityError, "duplicate top-level source file_hash"
            ):
                self.insert_source(con, 3, "old-duplicate")
        finally:
            con.close()

    def test_gate_query_distinguishes_top_level_source_from_child(self):
        con = self.connect()
        try:
            self.insert_source(con, 1, "shared-hash")
            self.insert_source(con, 2, "shared-hash", parent_source_id=1)
            rows = con.execute(
                "SELECT source_id, parent_source_id, title, file_path, "
                "ingestion_status, last_verified_at "
                "FROM main.sources WHERE file_hash = ?",
                ("shared-hash",),
            ).fetchall()
            self.assertEqual([row[0] for row in rows if row[1] is None], [1])
            self.assertEqual([row[0] for row in rows if row[1] is not None], [2])
        finally:
            con.close()
    def test_gate_and_recovery_contract_identify_parent_and_race_winner(self):
        gate = INGEST_GATE_PATH.read_text(encoding="utf-8")
        extract = INGEST_EXTRACT_PATH.read_text(encoding="utf-8")
        router = INGEST_ROUTER_PATH.read_text(encoding="utf-8")

        self.assertIn("parent_source_id", gate)
        self.assertIn("more than one top-level", gate)
        self.assertIn("duplicate top-level source file_hash", extract)
        self.assertIn("re-run the Step 3 hash lookup", extract)
        self.assertIn("Do not intentionally run ingestions into the same matter in parallel", router)

        recovery = self.line_starting(extract, "- **Recover from a same-hash insert race")
        self.assertIn("Step 4", recovery)
        self.assertIn("`complete`, or NULL with child rows, goes to `ingest-verify.md`", recovery)
        self.assertIn("`failed`, or NULL with no child rows, takes the re-extraction rule", recovery)
        self.assertIn("A `partial` winner takes the table's `partial` row", recovery)
        self.assertNotIn("instead of retrying fresh extraction", recovery)

    @staticmethod
    def line_starting(text, prefix):
        return next(line for line in text.splitlines() if line.startswith(prefix))

    def test_re_extraction_reuses_the_existing_top_level_row(self):
        extract = INGEST_EXTRACT_PATH.read_text(encoding="utf-8")
        rule = self.line_starting(extract, "- **Re-extraction reuses the existing top-level row.**")
        self.assertIn("reuses that row's `source_id`", rule)
        self.assertIn("`ingestion_status` to `partial`", rule)
        self.assertIn("`privileged_sources`", rule)

        privilege = self.line_starting(extract, "- **A re-extraction never resolves privilege.**")
        self.assertIn("stop and report it", privilege)
        self.assertIn("`privilege_status`", privilege)
        self.assertIn("resolve-privilege.md", privilege)

        path_b = self.line_starting(extract, "Each answer registers a top-level row.")
        self.assertIn("its `privileged_sources` row for Yes", path_b)
        self.assertIn("stop and report it", path_b)

        registering_lines = {
            "Path A": "   - register `main.sources`",
            "Path B": "Each answer registers a top-level row.",
            "Path E": "1. **Register the book**",
            "email": "For `.eml` and `.msg`, attachments are child sources",
        }
        for path, prefix in registering_lines.items():
            with self.subTest(path=path):
                self.assertIn("re-extraction rule", self.line_starting(extract, prefix))

    def test_unattended_re_extraction_routes_inherit_the_reuse(self):
        unattended = (CASE_DATA_ROOT / "operations" / "ingest-unattended.md").read_text(encoding="utf-8")
        for prefix in ("| `failed` | re-extract", "| `none` with no record, or a main record with no child rows |"):
            with self.subTest(route=prefix):
                self.assertIn("re-extraction rule", self.line_starting(unattended, prefix))

    def test_in_place_status_update_passes_the_hash_trigger_but_a_second_insert_does_not(self):
        con = self.connect()
        try:
            self.insert_source(con, 1, "failed-hash")
            con.execute("UPDATE sources SET ingestion_status = 'failed' WHERE source_id = 1")
            con.execute(
                "UPDATE sources SET ingestion_status = 'partial', title = 'Re-extracted' "
                "WHERE source_id = 1"
            )
            with self.assertRaisesRegex(
                sqlite3.IntegrityError, "duplicate top-level source file_hash"
            ):
                self.insert_source(con, 2, "failed-hash")
            self.assertEqual(
                con.execute(
                    "SELECT source_id, ingestion_status FROM sources "
                    "WHERE file_hash = 'failed-hash' AND parent_source_id IS NULL"
                ).fetchall(),
                [(1, "partial")],
            )
        finally:
            con.close()

    def test_affidavit_body_registers_partial_before_exhibits(self):
        extract = INGEST_EXTRACT_PATH.read_text(encoding="utf-8")
        step = next(
            line for line in extract.splitlines()
            if line.startswith("3. **Register the body source**")
        )

        self.assertIn("ingestion_status = 'partial'", step)


if __name__ == "__main__":
    unittest.main()
