"""Tests for resolve_authority_source.py, the read-only authority-file resolver the drafting
runtime spawns for a scrutiny review (operations/verify-law.md §2, design-decisions.md #61).

Each fixture is a temp matter tree with a `6. LAW` folder and a case-data folder holding a
law.sqlite built from the canonical schema.sql. The Word conversion test calls Microsoft Word and
is skipped where Word is not installed.

Run: python -m pytest .claude/skills/matter-data/tests/test_resolve_authority_source.py -q
"""

import hashlib
import os
import sqlite3
import sys
import tempfile
import time
import types
import unittest
from pathlib import Path
from unittest import mock

CASE_DATA_ROOT = Path(__file__).resolve().parents[1]
SCRIPTS_DIR = CASE_DATA_ROOT / "references" / "scripts"
SCHEMA_PATH = CASE_DATA_ROOT / "references" / "schema.sql"

sys.path.insert(0, str(SCRIPTS_DIR))

import rebuild  # noqa: E402
import resolve_authority_source as resolver  # noqa: E402

PDF_BYTES = b"%PDF-1.4\n% Bockhold v CIBC Wood Gundy\n"
RTF_BYTES = (b"{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Times New Roman;}}\\f0\\fs24 "
             b"[1] The appeal is dismissed.\\par }")
CITATION = "Bockhold v CIBC Wood Gundy, 2026 BCCA 74"


def sha256(data):
    return hashlib.sha256(data).hexdigest()


class ResolveAuthoritySourceTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        base = Path(self._tmp.name)
        self.matter = base / "L8443 Example"
        self.law_dir = self.matter / "6. LAW"
        self.law_dir.mkdir(parents=True)
        self.case_data_dir = base / "0. CASE DATA" / "L8443 Example"
        self.case_data_dir.mkdir(parents=True)
        self.cache_dir = base / "cache"
        con = sqlite3.connect(self.case_data_dir / "law.sqlite")
        try:
            con.executescript(rebuild.parse_sections(SCHEMA_PATH.read_text(encoding="utf-8"))["law"])
            con.commit()
        finally:
            con.close()

    def authority(self, citation, stored_path, data, notes=None):
        con = sqlite3.connect(self.case_data_dir / "law.sqlite")
        try:
            con.execute(
                "INSERT INTO authorities (title, citation, authority_type, file_path, file_hash, notes) "
                "VALUES (?, ?, 'case_law', ?, ?, ?)",
                ("Bockhold v CIBC Wood Gundy", citation, stored_path, sha256(data), notes))
            con.commit()
        finally:
            con.close()

    def write(self, relative, data):
        path = self.matter / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        return path

    def resolve(self, citation=CITATION, **extra):
        return resolver.run({"case_data_dir": str(self.case_data_dir), "matter_root": str(self.matter),
                             "citation": citation, "cache_dir": str(self.cache_dir), **extra})

    def test_a_recorded_path_whose_hash_matches_resolves_and_a_pdf_is_returned_as_is(self):
        path = self.write(r"6. LAW\Bockhold.pdf", PDF_BYTES)
        self.authority(CITATION, r"6. LAW\Bockhold.pdf", PDF_BYTES)
        result = self.resolve()
        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["arm"], "recorded_path")
        self.assertEqual(os.path.normcase(result["path"]), os.path.normcase(str(path)))
        self.assertEqual(result["sha256"], sha256(PDF_BYTES))
        self.assertTrue(result["hash_identity"])
        self.assertEqual(result["source_format"], "pdf")
        self.assertIsNone(result["converter"])
        self.assertEqual(result["pdf"], result["path"])
        self.assertEqual((result["tried"], result["searched"]), ([], []))
        self.assertFalse(self.cache_dir.exists())

    def test_the_neutral_citation_matches_a_row_carrying_a_pinpoint_suffix(self):
        self.write(r"6. LAW\Bockhold.pdf", PDF_BYTES)
        self.authority("2026 BCCA 74 at para 16", r"6. LAW\Bockhold.pdf", PDF_BYTES)
        self.assertEqual(self.resolve()["arm"], "recorded_path")

    def test_a_renamed_file_is_found_by_hash_with_the_stale_path_in_tried(self):
        moved = self.write(r"6. LAW\Summary Judgment\2026 BCCA 74 Bockhold.pdf", PDF_BYTES)
        self.authority(CITATION, r"6. LAW\Bockhold.pdf", PDF_BYTES)
        result = self.resolve()
        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["arm"], "hash_search")
        self.assertEqual(os.path.normcase(result["path"]), os.path.normcase(str(moved)))
        self.assertTrue(result["hash_identity"])
        self.assertEqual(len(result["tried"]), 1)
        self.assertEqual(result["tried"][0]["reason"], "missing")
        self.assertEqual(os.path.normcase(result["tried"][0]["path"]),
                         os.path.normcase(str(self.law_dir / "Bockhold.pdf")))
        self.assertFalse(result["search_truncated"])

    def test_a_changed_file_with_no_copy_is_unresolved_naming_what_was_tried_and_searched(self):
        self.write(r"6. LAW\Bockhold.pdf", PDF_BYTES + b"edited")
        self.write(r"TRASH\Bockhold.pdf", PDF_BYTES)  # a skipped folder is never searched
        self.authority(CITATION, r"6. LAW\Bockhold.pdf", PDF_BYTES)
        result = self.resolve()
        self.assertEqual(result["status"], "unresolved")
        self.assertEqual([t["reason"] for t in result["tried"]], ["hash mismatch"])
        self.assertEqual([os.path.normcase(p) for p in result["searched"]],
                         [os.path.normcase(str(self.law_dir)), os.path.normcase(str(self.matter))])
        self.assertFalse(result["search_truncated"])

    def test_two_live_rows_matching_the_citation_are_ambiguous_and_a_merge_tombstone_is_not_one(self):
        self.write(r"6. LAW\Bockhold.pdf", PDF_BYTES)
        self.authority(CITATION, r"6. LAW\Bockhold.pdf", PDF_BYTES)
        self.authority("2026 BCCA 74", r"6. LAW\Bockhold copy.pdf", PDF_BYTES,
                       notes="[MERGED-INTO:#1 2026-10-01 BW] ")
        self.assertEqual(self.resolve("2026 BCCA 74, para 16")["arm"], "recorded_path")

        self.authority("2026 BCCA 74 (CanLII)", r"6. LAW\Bockhold 2.pdf", PDF_BYTES)
        result = self.resolve("2026 BCCA 74, para 16")
        self.assertEqual(result["status"], "authority_ambiguous")
        self.assertEqual(sorted(c["citation"] for c in result["candidates"]),
                         sorted([CITATION, "2026 BCCA 74 (CanLII)"]))

    def test_a_named_file_with_no_stored_authority_resolves_without_hash_identity(self):
        self.write(r"6. LAW\Downloaded.pdf", PDF_BYTES)
        result = self.resolve(source_path=r"6. LAW\Downloaded.pdf")
        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["arm"], "named_path")
        self.assertFalse(result["hash_identity"])

    def test_a_cached_conversion_is_reused_without_word(self):
        self.write(r"6. LAW\Bockhold.doc", RTF_BYTES)
        self.authority(CITATION, r"6. LAW\Bockhold.doc", RTF_BYTES)
        self.cache_dir.mkdir()
        cached = self.cache_dir / (sha256(RTF_BYTES) + ".pdf")
        cached.write_bytes(PDF_BYTES)
        os.utime(cached, (1_700_000_000, 1_700_000_000))
        with mock.patch.object(resolver.subprocess, "run", side_effect=AssertionError("Word was started")):
            result = self.resolve()
        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["source_format"], "rtf")
        self.assertEqual(result["converter"], "word")
        self.assertTrue(result["cached"])
        self.assertEqual(os.path.normcase(result["pdf"]), os.path.normcase(str(cached)))
        self.assertEqual(cached.stat().st_mtime, 1_700_000_000)

    def test_the_hash_search_skips_cloud_only_files_unread_and_counts_them(self):
        self.write(r"6. LAW\Cloud\Bockhold.pdf", PDF_BYTES)
        self.write(r"6. LAW\Cloud\Offline.pdf", PDF_BYTES)
        self.authority(CITATION, r"6. LAW\Bockhold.pdf", PDF_BYTES)
        real_stat = os.stat
        attributes = {"Bockhold.pdf": 0x400000, "Offline.pdf": 0x1000}

        def fake_stat(path, *args, **kwargs):
            name = os.path.basename(path)
            if "Cloud" in str(path) and name in attributes:
                return types.SimpleNamespace(st_file_attributes=attributes[name])
            return real_stat(path, *args, **kwargs)

        with mock.patch.object(resolver.os, "stat", side_effect=fake_stat), \
                mock.patch.object(resolver, "_sha256", side_effect=AssertionError("a cloud-only file was read")):
            result = self.resolve()
        self.assertEqual(result["status"], "unresolved")
        self.assertEqual(result["skipped_cloud_only"], 2)
        self.assertEqual(result["unreadable"], [])

    def test_a_file_the_hash_search_cannot_read_is_listed_as_unreadable(self):
        locked = self.write(r"6. LAW\Locked.pdf", b"%PDF-1.4\nother\n")
        moved = self.write(r"6. LAW\Summary Judgment\Bockhold.pdf", PDF_BYTES)
        self.authority(CITATION, r"6. LAW\Bockhold.pdf", PDF_BYTES)
        real_sha256 = resolver._sha256

        def fake_sha256(path):
            if os.path.basename(path) == "Locked.pdf":
                raise PermissionError(13, "in use", path)
            return real_sha256(path)

        with mock.patch.object(resolver, "_sha256", side_effect=fake_sha256):
            result = self.resolve()
        self.assertEqual(result["status"], "ok")
        self.assertEqual(os.path.normcase(result["path"]), os.path.normcase(str(moved)))
        self.assertEqual([os.path.normcase(p) for p in result["unreadable"]], [os.path.normcase(str(locked))])
        self.assertEqual(result["skipped_cloud_only"], 0)

    def test_word_is_not_started_with_under_five_seconds_left(self):
        source = self.write(r"6. LAW\Bockhold.doc", RTF_BYTES)
        with mock.patch.object(resolver, "_word_installed", return_value=True), \
                mock.patch.object(resolver.subprocess, "run", side_effect=AssertionError("Word was started")):
            result = resolver._convert(str(source), sha256(RTF_BYTES), str(self.cache_dir),
                                       time.monotonic() - (resolver.DEADLINE_S - 4))
        self.assertEqual(result, ("conversion_failed", "no time left for Word; call again", None, False))
        self.assertFalse(self.cache_dir.exists())

    def test_a_word_timeout_kills_only_the_word_it_started_by_pid(self):
        source = self.write(r"6. LAW\Bockhold.doc", RTF_BYTES)
        snapshots = iter(['"WINWORD.EXE","100","Console","1","90,000 K"\n',
                          '"WINWORD.EXE","100","Console","1","90,000 K"\n'
                          '"WINWORD.EXE","200","Console","1","60,000 K"\n'])
        calls = []

        def fake_run(args, **kwargs):
            calls.append(args)
            if args[0] == "tasklist":
                return types.SimpleNamespace(returncode=0, stdout=next(snapshots), stderr="")
            if args[0] == "powershell":
                raise resolver.subprocess.TimeoutExpired(args, kwargs["timeout"])
            return types.SimpleNamespace(returncode=0, stdout="", stderr="")

        with mock.patch.object(resolver, "_word_installed", return_value=True), \
                mock.patch.object(resolver.subprocess, "run", side_effect=fake_run):
            status, detail, pdf, cached = resolver._convert(
                str(source), sha256(RTF_BYTES), str(self.cache_dir), time.monotonic())
        self.assertEqual((status, pdf, cached), ("conversion_failed", None, False))
        self.assertIn("killed WINWORD.EXE PIDs: 200", detail)
        self.assertEqual([c for c in calls if c[0] == "taskkill"], [["taskkill", "/PID", "200", "/F"]])
        self.assertEqual(list(self.cache_dir.iterdir()), [])

    @unittest.skipUnless(resolver._word_installed(), "Word not installed")
    def test_word_converts_an_rtf_doc_into_the_cache(self):
        self.write(r"6. LAW\Bockhold.doc", RTF_BYTES)
        self.authority(CITATION, r"6. LAW\Bockhold.doc", RTF_BYTES)
        result = self.resolve()
        self.assertEqual(result["status"], "ok", result.get("detail"))
        self.assertEqual(result["source_format"], "rtf")
        self.assertEqual(result["converter"], "word")
        self.assertFalse(result["cached"])
        cached = self.cache_dir / (sha256(RTF_BYTES) + ".pdf")
        self.assertEqual(os.path.normcase(result["pdf"]), os.path.normcase(str(cached)))
        self.assertTrue(cached.read_bytes().startswith(b"%PDF"))
        self.assertEqual(sorted(p.name for p in self.cache_dir.iterdir()), [cached.name])
        self.assertEqual((self.law_dir / "Bockhold.doc").read_bytes(), RTF_BYTES)


if __name__ == "__main__":
    unittest.main()
