"""Tests for ingest_coverage.py, the host-side run of operations/ingest-coverage.md
the drafting runtime spawns at session entry (design-decisions.md #60).

Each fixture is a case-data folder holding main, law and privileged built from
the canonical schema.sql, main stamped at the current version, beside a temp
matter folder.

Run: python -m unittest discover -s .claude/skills/matter-data/tests -p "test_ingest_coverage_script.py"
"""

import hashlib
import json
import os
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path
from unittest import mock

CASE_DATA_ROOT = Path(__file__).resolve().parents[1]
SCRIPTS_DIR = CASE_DATA_ROOT / "references" / "scripts"
SCHEMA_PATH = CASE_DATA_ROOT / "references" / "schema.sql"

sys.path.insert(0, str(SCRIPTS_DIR))

import ingest_coverage  # noqa: E402
import rebuild  # noqa: E402
import resolve_paths  # noqa: E402

DATABASES = ("main", "law", "privileged")


def sha(data):
    return hashlib.sha256(data).hexdigest()


class IngestCoverageScriptTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        root = Path(self._tmp.name)
        self.matter = root / "matter"
        self.matter.mkdir()
        self.case_data_dir = root / "matter-data"
        self.case_data_dir.mkdir()
        self.paths = {name: self.case_data_dir / f"{name}.sqlite" for name in DATABASES}

    def build(self, version=resolve_paths.EXPECTED_USER_VERSION):
        sections = rebuild.parse_sections(SCHEMA_PATH.read_text(encoding="utf-8"))
        for name, path in self.paths.items():
            con = sqlite3.connect(path)
            try:
                con.executescript(sections[name])
                if name == "main":
                    con.execute(f"PRAGMA user_version = {version}")
                con.commit()
            finally:
                con.close()

    def write(self, name, sql, params=()):
        con = sqlite3.connect(self.paths[name])
        try:
            con.execute(sql, params)
            con.commit()
        finally:
            con.close()

    def place(self, stored, data):
        path = self.matter.joinpath(*stored.split("\\"))
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        return sha(data)

    def run_script(self):
        return ingest_coverage.run({
            "case_data_dir": str(self.case_data_dir), "matter_root": str(self.matter),
            "folder_globs": ingest_coverage.FOLDER_GLOBS,
            "correspondence_globs": ingest_coverage.CORRESPONDENCE_GLOBS})

    def test_an_unrecorded_discovery_file_is_to_ingest(self):
        self.build()
        self.place(r"7. DISCOVERY\list of documents.pdf", b"lod")
        out = self.run_script()
        self.assertEqual(out["status"], "ok")
        self.assertEqual(out["to_ingest"], [r"7. DISCOVERY\list of documents.pdf"])
        self.assertEqual(out["missing"], ["2. SOLICITOR CLIENT*", "3. CORRESPONDENCE*", "5. COURT*"])
        self.assertEqual(out["records"], [
            {"path": r"7. DISCOVERY\list of documents.pdf", "verdict": "none",
             "source_id": None, "possible_version_of": None}])
        self.assertEqual(
            set(out),
            {"status", "to_ingest", "records", "damaged", "unreadable", "folders", "missing",
             "newest_correspondence", "checked_at"})
        self.assertEqual(list(out["folders"]), list(ingest_coverage.FOLDER_GLOBS))
        self.assertEqual(datetime.fromisoformat(out["checked_at"]).utcoffset(), timedelta(0))

    def test_each_file_to_ingest_has_its_record_in_the_same_order(self):
        self.build()
        hm = self.place(r"5. COURT FILE#1\aff draft.pdf", b"draft")
        hp = self.place(r"5. COURT FILE#1\order.pdf", b"order")
        self.place(r"7. DISCOVERY\list of documents.pdf", b"lod")
        insert = ("INSERT INTO sources (source_id, category, title, file_path, file_hash, "
                  "ingestion_status, notes) VALUES (?, 'court', ?, ?, ?, 'partial', ?)")
        self.write("main", insert, (7, "Affidavit", r"5. COURT FILE#1\aff draft.pdf", hm,
                                    "SUPERSEDE-PENDING: possible other version of source #34."))
        self.write("main", insert, (8, "Order", r"5. COURT FILE#1\order.pdf", hp,
                                    "DISCREPANCY: possible duplicate of source #34."))
        out = self.run_script()
        self.assertEqual(out["to_ingest"], [
            r"5. COURT FILE#1\aff draft.pdf", r"5. COURT FILE#1\order.pdf",
            r"7. DISCOVERY\list of documents.pdf"])
        self.assertEqual(out["records"], [
            {"path": r"5. COURT FILE#1\aff draft.pdf", "verdict": "partial", "source_id": 7,
             "possible_version_of": 34},
            {"path": r"5. COURT FILE#1\order.pdf", "verdict": "partial", "source_id": 8,
             "possible_version_of": None},
            {"path": r"7. DISCOVERY\list of documents.pdf", "verdict": "none", "source_id": None,
             "possible_version_of": None}])

    def test_a_court_file_folder_with_a_file_number_is_walked(self):
        self.build()
        self.place(r"5. COURT FILE#S-290004\nocc.pdf", b"nocc")
        out = self.run_script()
        self.assertEqual(out["to_ingest"], [r"5. COURT FILE#S-290004\nocc.pdf"])
        self.assertNotIn("5. COURT*", out["missing"])

    def test_a_file_held_only_in_law_or_privileged_is_not_a_gap(self):
        self.build()
        h1 = self.place(r"5. COURT FILE#1\reasons.pdf", b"reasons")
        h2 = self.place(r"2. SOLICITOR CLIENT\email.msg", b"email")
        self.write("law",
                   "INSERT INTO authorities (authority_id, citation, title, file_path, file_hash) "
                   "VALUES (1, '2026 BCSC 1', 'Reasons', ?, ?)", (r"5. COURT FILE#1\reasons.pdf", h1))
        self.write("privileged",
                   "INSERT INTO privileged_sources (source_id, category, title, file_path, file_hash, date) "
                   "VALUES (1, 'solicitor_client', 'Email', ?, ?, '2026-09-18')",
                   (r"2. SOLICITOR CLIENT\email.msg", h2))
        out = self.run_script()
        self.assertEqual((out["to_ingest"], out["damaged"]), ([], []))
        self.assertEqual(out["newest_correspondence"],
                         {"date": "2026-09-18", "path": r"2. SOLICITOR CLIENT\email.msg"})

    def test_no_case_data_database_is_not_applicable(self):
        out = self.run_script()
        self.assertEqual(out["status"], "not_applicable")
        self.assertIn(str(self.case_data_dir), out["reason"])

    def test_a_database_behind_the_current_version_is_unavailable_and_names_migrate(self):
        self.build(version=resolve_paths.EXPECTED_USER_VERSION - 1)
        self.place(r"3. CORRESPONDENCE\a.pdf", b"a")
        out = self.run_script()
        self.assertEqual(out["status"], "unavailable")
        self.assertIn("matter_data__migrate", out["reason"])

    def test_the_native_files_are_unchanged_and_the_tagged_staging_folder_is_removed(self):
        self.build()
        self.place(r"3. CORRESPONDENCE\a.pdf", b"a")
        before = {name: path.read_bytes() for name, path in self.paths.items()}
        staging_root = Path(self._tmp.name) / "staging"
        staging_root.mkdir()
        with mock.patch.dict(os.environ, {"COCLERK_STAGING_TAG": "0123456789abcdef"}), \
                mock.patch("tempfile.tempdir", str(staging_root)):
            self.assertEqual(self.run_script()["status"], "ok")
        self.assertEqual({name: path.read_bytes() for name, path in self.paths.items()}, before)
        self.assertEqual(list(staging_root.iterdir()), [])

    def test_the_cli_prints_json(self):
        self.build()
        self.place(r"3. CORRESPONDENCE\a.pdf", b"a")
        res = subprocess.run(
            [sys.executable, str(SCRIPTS_DIR / "ingest_coverage.py"), str(self.case_data_dir), str(self.matter)],
            capture_output=True, text=True, stdin=subprocess.DEVNULL)
        self.assertEqual(res.returncode, 0, res.stderr)
        out = json.loads(res.stdout)
        self.assertEqual((out["status"], out["to_ingest"]), ("ok", [r"3. CORRESPONDENCE\a.pdf"]))


if __name__ == "__main__":
    unittest.main()
