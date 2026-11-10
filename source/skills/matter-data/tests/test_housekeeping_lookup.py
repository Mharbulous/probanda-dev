"""Tests for housekeeping_lookup.py, the host-side run of operations/ingest-status.md and
operations/housekeeping-log.md mode `lookup` that the file-manager plugin's
housekeeping__candidates spawns once per run (design-decisions.md #73).

Each fixture is a matter-data folder holding main, law and privileged built from the
canonical schema.sql, main stamped at the current version, beside a temp matter folder.

Run: python -m unittest discover -s source/skills/matter-data/tests -p "test_housekeeping_lookup.py"
"""

import hashlib
import os
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

CASE_DATA_ROOT = Path(__file__).resolve().parents[1]
SCRIPTS_DIR = CASE_DATA_ROOT / "references" / "scripts"
SCHEMA_PATH = CASE_DATA_ROOT / "references" / "schema.sql"

sys.path.insert(0, str(SCRIPTS_DIR))

import housekeeping_lookup  # noqa: E402
import rebuild  # noqa: E402
import resolve_paths  # noqa: E402

DATABASES = ("main", "law", "privileged")


def sha(data):
    return hashlib.sha256(data).hexdigest()


class HousekeepingLookupTests(unittest.TestCase):
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

    def source(self, source_id, file_hash, file_path, status="complete"):
        self.write("main",
                   "INSERT INTO sources (source_id, category, title, file_path, file_hash, ingestion_status) "
                   "VALUES (?, 'court', ?, ?, ?, ?)",
                   (source_id, f"Source {source_id}", file_path, file_hash, status))

    def log(self, file_hash, file_name, outcome, reviewed_at="2026-10-01", reason=None,
            failure_class=None, retry_next_run=None):
        self.write("main",
                   "INSERT INTO housekeeping_reviews (file_hash, file_name, folder_type, outcome, "
                   "reviewed_at, reason, failure_class, retry_next_run) "
                   "VALUES (?, ?, 'Correspondence', ?, ?, ?, ?, ?)",
                   (file_hash, file_name, outcome, reviewed_at, reason, failure_class, retry_next_run))

    def run_script(self, files):
        return housekeeping_lookup.run({
            "case_data_dir": str(self.case_data_dir), "matter_root": str(self.matter),
            "files": files})

    # -- ingest status ---------------------------------------------------------

    def test_ingest_status_per_file_in_input_order(self):
        self.build()
        main = self.place(r"5. COURT FILE\nocc.pdf", b"nocc")
        priv = self.place(r"2. SOLICITOR CLIENT\email.msg", b"email")
        second = self.place(r"6. LAW\copy of reasons.pdf", b"second copy")
        moved = self.place(r"3. CORRESPONDENCE\moved.pdf", b"moved")
        stored = self.place(r"3. CORRESPONDENCE\stored.pdf", b"twin")
        copy = self.place(r"4. LAWYER BRIEF\copy.pdf", b"twin")
        fresh = self.place("loose.pdf", b"fresh")
        self.source(1, main, r"5. COURT FILE\nocc.pdf")
        self.source(2, moved, r"Old Folder\moved.pdf")
        self.source(3, stored, r"3. CORRESPONDENCE\stored.pdf")
        self.write("privileged",
                   "INSERT INTO privileged_sources (source_id, category, title, file_path, file_hash) "
                   "VALUES (1, 'solicitor_client', 'Email', ?, ?)", (r"2. SOLICITOR CLIENT\email.msg", priv))
        self.write("law",
                   "INSERT INTO authorities (authority_id, title, file_path, file_hash, notes) "
                   "VALUES (1, 'Reasons', '6. LAW\\reasons.pdf', ?, ?)",
                   (sha(b"first copy"), f"[SECOND-COPY:{second}]"))
        files = [
            {"path": "loose.pdf", "hash": fresh},
            {"path": r"2. SOLICITOR CLIENT\email.msg", "hash": priv},
            {"path": r"3. CORRESPONDENCE\moved.pdf", "hash": moved},
            {"path": r"4. LAWYER BRIEF\copy.pdf", "hash": copy},
            {"path": r"5. COURT FILE\nocc.pdf", "hash": main},
            {"path": r"6. LAW\copy of reasons.pdf", "hash": second},
        ]
        out = self.run_script(files)
        self.assertEqual(out["status"], "ok")
        self.assertEqual([e["path"] for e in out["ingest"]], [f["path"] for f in files])
        got = {e["path"]: e for e in out["ingest"]}
        self.assertEqual(got["loose.pdf"]["verdict"], "none")
        self.assertEqual((got[r"2. SOLICITOR CLIENT\email.msg"]["verdict"],
                          got[r"2. SOLICITOR CLIENT\email.msg"]["store"]), ("ingested", "privileged"))
        self.assertEqual((got[r"3. CORRESPONDENCE\moved.pdf"]["verdict"],
                          got[r"3. CORRESPONDENCE\moved.pdf"]["moved"]), ("ingested", True))
        self.assertEqual((got[r"4. LAWYER BRIEF\copy.pdf"]["verdict"],
                          got[r"4. LAWYER BRIEF\copy.pdf"]["duplicate_of"],
                          got[r"4. LAWYER BRIEF\copy.pdf"]["twin_ingested"]),
                         ("none", r"3. CORRESPONDENCE\stored.pdf", True))
        self.assertEqual((got[r"5. COURT FILE\nocc.pdf"]["verdict"],
                          got[r"5. COURT FILE\nocc.pdf"]["source_ids"],
                          got[r"5. COURT FILE\nocc.pdf"]["metadata"]["title"]),
                         ("ingested", [1], "Source 1"))
        self.assertEqual((got[r"6. LAW\copy of reasons.pdf"]["verdict"],
                          got[r"6. LAW\copy of reasons.pdf"]["store"]), ("ingested_by_reference", "law"))

    # -- review log -------------------------------------------------------------

    def test_review_log_join_rules(self):
        self.build()
        renamed_by_hand = self.place(r"3. CORRESPONDENCE\renamed by hand.pdf", b"a")
        same_name = self.place(r"3. CORRESPONDENCE\2026-01-01 LF kept.pdf", b"b edited")
        failed = self.place(r"3. CORRESPONDENCE\failed.pdf", b"c")
        unknown = self.place(r"3. CORRESPONDENCE\unknown.pdf", b"d")
        # Filed without ingest under an older name: matches by hash after the rename.
        self.log(renamed_by_hand, "old name.pdf", "not_ingested")
        # Settled under this name, with other bytes: matches by name.
        self.log(sha(b"b"), "2026-01-01 LF kept.pdf", "renamed")
        # Two failures for one hash: the newest is reported.
        self.log(failed, "failed.pdf", "ingest_failed", "2026-09-01", "malformed JSON", "extractor", 1)
        self.log(failed, "failed again.pdf", "ingest_failed", "2026-10-01", "render failed", "deterministic", 0)
        out = self.run_script([
            {"path": r"3. CORRESPONDENCE\renamed by hand.pdf", "hash": renamed_by_hand},
            {"path": r"3. CORRESPONDENCE\2026-01-01 LF kept.pdf", "hash": same_name},
            {"path": r"3. CORRESPONDENCE\failed.pdf", "hash": failed},
            {"path": r"3. CORRESPONDENCE\unknown.pdf", "hash": unknown},
        ])
        hand, kept, fail, none = out["reviews"]
        self.assertEqual((hand["reviewed"], hand["outcome"], hand["matched_on"], hand["not_ingested"]),
                         (True, "not_ingested", "hash", True))
        self.assertEqual((kept["reviewed"], kept["outcome"], kept["matched_on"], kept["not_ingested"]),
                         (True, "renamed", "name", False))
        self.assertEqual((fail["reviewed"], fail["not_ingested"]), (False, False))
        self.assertEqual(fail["ingest_failure"], {"reason": "render failed", "failure_class": "deterministic",
                                                  "retry_next_run": 0, "reviewed_at": "2026-10-01"})
        self.assertEqual(none, {"reviewed": False, "outcome": None, "reviewed_at": None, "matched_on": None,
                                "not_ingested": False, "ingest_failure": None})

    def test_a_hash_match_is_preferred_over_a_name_match(self):
        self.build()
        h = self.place(r"3. CORRESPONDENCE\x.pdf", b"x")
        self.log(sha(b"other"), "x.pdf", "manual_review", "2026-10-02")
        self.log(h, "earlier name.pdf", "renamed", "2026-09-01")
        review = self.run_script([{"path": r"3. CORRESPONDENCE\x.pdf", "hash": h}])["reviews"][0]
        self.assertEqual((review["outcome"], review["matched_on"]), ("renamed", "hash"))

    def test_an_empty_log_reviews_nothing_and_an_empty_list_reads_nothing(self):
        self.build()
        h = self.place("a.pdf", b"a")
        out = self.run_script([{"path": "a.pdf", "hash": h}])
        self.assertEqual(out["reviews"][0]["reviewed"], False)
        self.assertEqual(self.run_script([]), {"status": "ok", "ingest": [], "reviews": []})

    # -- statuses and read discipline ------------------------------------------

    def test_no_case_data_database_is_not_applicable(self):
        self.assertEqual(self.run_script([])["status"], "not_applicable")

    def test_a_database_behind_the_current_version_is_unavailable_and_names_migrate(self):
        self.build(version=resolve_paths.EXPECTED_USER_VERSION - 1)
        h = self.place("a.pdf", b"a")
        out = self.run_script([{"path": "a.pdf", "hash": h}])
        self.assertEqual(out["status"], "unavailable")
        self.assertIn("matter_data__migrate", out["reason"])

    def test_the_native_files_are_unchanged_and_the_tagged_staging_folder_is_removed(self):
        self.build()
        h = self.place("a.pdf", b"a")
        before = {name: path.read_bytes() for name, path in self.paths.items()}
        staging_root = Path(self._tmp.name) / "staging"
        staging_root.mkdir()
        with mock.patch.dict(os.environ, {"COCLERK_STAGING_TAG": "0123456789abcdef"}), \
                mock.patch("tempfile.tempdir", str(staging_root)):
            self.assertEqual(self.run_script([{"path": "a.pdf", "hash": h}])["status"], "ok")
        self.assertEqual({name: path.read_bytes() for name, path in self.paths.items()}, before)
        self.assertEqual(list(staging_root.iterdir()), [])


if __name__ == "__main__":
    unittest.main()
