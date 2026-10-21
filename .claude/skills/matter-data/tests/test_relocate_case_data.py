"""Tests for relocate_case_data.py, behind `matter_data__relocate` (ADR 0013).

A matter's case data moves from the firm-level '0. CASE DATA\\<matter> ' folder into
MATTER_ROOT\\0. CASE DATA. The tool copies, verifies, then re-points; it deletes
nothing, and on any failure the pointer files stay byte-identical.
"""

import hashlib
import json
import os
import shutil
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

import migrate_engine  # noqa: E402
import rebuild  # noqa: E402
import relocate_case_data as relocate  # noqa: E402


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


class RelocateTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        env = {k: v for k, v in os.environ.items() if k != "COCLERK_CASE_DATA_ROOT"}
        patcher = mock.patch.dict(os.environ, env, clear=True)
        patcher.start()
        self.addCleanup(patcher.stop)
        library = Path(self.temp.name) / "Litigation - Documents"
        self.matter_root = library / "T9999 Scratch Matter"
        self.old = library / "0. CASE DATA" / "T9999 Scratch Matter"
        self.target = self.matter_root / "0. CASE DATA"
        self.matter_root.mkdir(parents=True)
        self.old.mkdir(parents=True)

        sections = rebuild.parse_sections(SCHEMA_PATH.read_text(encoding="utf-8"))
        for db in ("main", "law", "privileged"):
            con = sqlite3.connect(self.old / f"{db}.sqlite")
            con.executescript(sections[db])
            con.execute("PRAGMA user_version = 90")
            con.commit()
            con.close()
        con = sqlite3.connect(self.old / "main.sqlite")
        con.executemany("INSERT INTO matter_metadata(key, value) VALUES (?, ?)",
                        [("matter_id", "T9999"), ("short_name", "Scratch Matter")])
        con.commit()
        con.close()
        # A fourth database beside the three, as the drafting database sits there.
        shutil.copy2(self.old / "law.sqlite", self.old / "submission.sqlite")
        con = sqlite3.connect(self.old / "submission.sqlite")
        con.execute("PRAGMA user_version = 7")
        con.commit()
        con.close()
        (self.old / "evidence.sql").write_text("-- Case Data evidence dump -- schema v9.0\n", encoding="utf-8")
        (self.old / "mockups").mkdir()
        (self.old / "mockups" / "draft.md").write_text("# Draft\n", encoding="utf-8")
        (self.old / "form-sessions").mkdir()

        pointer = json.dumps({
            "schema_version": 5,
            "matter_root": str(self.matter_root),
            "case_data_dir": str(self.old),
            "evidence_sql_path": os.path.relpath(self.old / "evidence.sql", self.matter_root),
        }, indent=2)
        for name in ("probanda.json", "coclerk.json"):
            (self.matter_root / name).write_text(pointer, encoding="utf-8")

    def tearDown(self):
        self.temp.cleanup()

    def pointer_bytes(self):
        return {name: (self.matter_root / name).read_bytes() for name in ("probanda.json", "coclerk.json")}

    def old_hashes(self):
        return {str(p.relative_to(self.old)): sha(p) for p in self.old.rglob("*") if p.is_file()}

    def test_plan_lists_files_and_writes_nothing(self):
        before = self.pointer_bytes()
        result = relocate.run({"mode": "plan", "matter_root": str(self.matter_root)})
        self.assertEqual(Path(result["target"]), self.target)
        self.assertEqual(Path(result["old_folder"]), self.old)
        paths = {Path(f["path"]) for f in result["files"]}
        self.assertIn(Path("privileged.sqlite"), paths)
        self.assertIn(Path("mockups") / "draft.md", paths)
        self.assertEqual(self.pointer_bytes(), before)
        self.assertFalse(self.target.exists())

    def test_apply_copies_verifies_repoints_and_leaves_the_old_folder(self):
        before_old = self.old_hashes()
        before_ptr = self.pointer_bytes()
        result = relocate.run({"mode": "apply", "matter_root": str(self.matter_root)})

        self.assertEqual(Path(result["case_data_dir"]), self.target)
        self.assertEqual(self.old_hashes(), before_old, "the old folder is untouched")
        after = {str(p.relative_to(self.target)): sha(p) for p in self.target.rglob("*") if p.is_file()}
        self.assertEqual(after, before_old, "every file copied byte-identical")
        self.assertTrue((self.target / "form-sessions").is_dir(), "empty subfolders are copied too")
        for name in ("probanda.json", "coclerk.json"):
            pointer = json.loads((self.matter_root / name).read_text(encoding="utf-8"))
            self.assertEqual(pointer["case_data_dir"], "0. CASE DATA")
            self.assertEqual(Path(pointer["evidence_sql_path"]), Path("0. CASE DATA") / "evidence.sql")
            backups = list(self.matter_root.glob(name + ".bak-*"))
            self.assertEqual(len(backups), 1)
            self.assertEqual(backups[0].read_bytes(), before_ptr[name])
        self.assertEqual(list(self.matter_root.glob(".probanda_relocate_*")), [])

        import resolve_paths
        resolved = resolve_paths.resolve_pointer(str(self.matter_root))
        self.assertEqual(Path(resolved["case_data_dir"]), self.target)

    def test_privileged_sqlite_is_copied_byte_identical(self):
        relocate.run({"mode": "apply", "matter_root": str(self.matter_root)})
        self.assertEqual(sha(self.target / "privileged.sqlite"), sha(self.old / "privileged.sqlite"))

    def test_failed_verification_leaves_pointers_byte_identical_and_old_folder_intact(self):
        before_old = self.old_hashes()
        before_ptr = self.pointer_bytes()

        def failing_verify(copies):
            raise migrate_engine.MigrateError("migrate_refused", "PRAGMA integrity_check on main reported 'bad'")

        with mock.patch.object(migrate_engine, "verify", failing_verify):
            with self.assertRaises(migrate_engine.MigrateError) as caught:
                relocate.run({"mode": "apply", "matter_root": str(self.matter_root)})

        self.assertIn("integrity_check", caught.exception.message)
        self.assertEqual(self.pointer_bytes(), before_ptr)
        self.assertEqual(self.old_hashes(), before_old)
        self.assertFalse(self.target.exists())
        staging = caught.exception.details["staging"]
        self.assertTrue(os.path.isdir(staging), "the staging folder stays and is named")

    def test_refuses_when_the_target_is_not_empty(self):
        self.target.mkdir()
        (self.target / "stray.txt").write_text("x", encoding="utf-8")
        before_ptr = self.pointer_bytes()
        with self.assertRaises(migrate_engine.MigrateError) as caught:
            relocate.run({"mode": "apply", "matter_root": str(self.matter_root)})
        self.assertEqual(caught.exception.code, "relocate_refused")
        self.assertIn("not empty", caught.exception.message)
        self.assertEqual(self.pointer_bytes(), before_ptr)
        self.assertEqual(list(self.matter_root.glob(".probanda_relocate_*")), [])
        self.assertEqual(list(self.matter_root.glob("*.bak-*")), [])

    def test_an_empty_target_folder_is_kept_and_filled(self):
        self.target.mkdir()
        before_old = self.old_hashes()
        relocate.run({"mode": "apply", "matter_root": str(self.matter_root)})
        after = {str(p.relative_to(self.target)): sha(p) for p in self.target.rglob("*") if p.is_file()}
        self.assertEqual(after, before_old)
        self.assertEqual(list(self.matter_root.glob(".probanda_relocate_*")), [])

    def test_refuses_a_matter_already_relocated(self):
        relocate.run({"mode": "apply", "matter_root": str(self.matter_root)})
        with self.assertRaises(migrate_engine.MigrateError) as caught:
            relocate.run({"mode": "plan", "matter_root": str(self.matter_root)})
        self.assertIn("already in the matter folder", caught.exception.message)

    def locked_coclerk(self, failures):
        """os.replace that raises PermissionError on coclerk.json `failures` times, as a cloud
        sync client does while it syncs the file, then behaves normally."""
        real_replace = os.replace
        left = [failures]

        def replace(src, dst):
            if str(dst).endswith("coclerk.json") and left[0] > 0:
                left[0] -= 1
                raise PermissionError(13, "Access is denied", str(src))
            return real_replace(src, dst)
        return replace

    def test_a_briefly_locked_pointer_is_retried_and_both_pointers_match(self):
        with mock.patch.object(migrate_engine.os, "replace", self.locked_coclerk(2)), \
                mock.patch.object(migrate_engine.time, "sleep"):
            relocate.run({"mode": "apply", "matter_root": str(self.matter_root)})
        ptr = self.pointer_bytes()
        self.assertEqual(ptr["probanda.json"], ptr["coclerk.json"])
        self.assertEqual(json.loads(ptr["coclerk.json"])["case_data_dir"], "0. CASE DATA")

    def test_a_pointer_that_stays_locked_reports_the_true_state(self):
        before_old = self.old_hashes()
        with mock.patch.object(migrate_engine.os, "replace", self.locked_coclerk(10 ** 6)), \
                mock.patch.object(migrate_engine, "REPLACE_RETRY_SECONDS", 0):
            with self.assertRaises(migrate_engine.MigrateError) as caught:
                relocate.run({"mode": "apply", "matter_root": str(self.matter_root)})
        exc = caught.exception
        self.assertEqual(exc.code, "relocate_incomplete")
        self.assertEqual([Path(p).name for p in exc.details["rewritten"]], ["probanda.json"])
        self.assertEqual([Path(p).name for p in exc.details["not_rewritten"]], ["coclerk.json"])
        self.assertEqual(Path(exc.details["leftover_tmp"]), self.matter_root / "coclerk.json.tmp")
        self.assertTrue((self.matter_root / "coclerk.json.tmp").is_file())
        after = {str(p.relative_to(self.target)): sha(p) for p in self.target.rglob("*") if p.is_file()}
        self.assertEqual(after, before_old, "the verified copy is in place")


if __name__ == "__main__":
    unittest.main()
