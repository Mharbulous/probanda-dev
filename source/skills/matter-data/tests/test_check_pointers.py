import hashlib
import importlib.util
import json
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).parents[1] / "references" / "scripts" / "check_pointers.py"
sys.path.insert(0, str(SCRIPT.parent))
SPEC = importlib.util.spec_from_file_location("case_data_check_pointers", SCRIPT)
check_pointers = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(check_pointers)


class CheckPointersTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name) / "Litigation - Documents"
        self.matter = self.root / "T9999 Scratch Matter"
        self.case_data = self.root / "0. CASE DATA" / "T9999 Scratch Matter"
        self.matter.mkdir(parents=True)
        self.case_data.mkdir(parents=True)
        for name in ("main.sqlite", "law.sqlite", "privileged.sqlite"):
            con = sqlite3.connect(self.case_data / name)
            con.execute("PRAGMA user_version = 90")
            con.close()
        evidence = self.case_data / "evidence.sql"
        evidence.write_text("-- Case Data evidence dump -- schema v9.0\n", encoding="utf-8")
        self.pointer = self.matter / "coclerk.json"

    def tearDown(self):
        self.temp.cleanup()

    def write_pointer(self, stored):
        self.pointer.write_text(json.dumps({
            "schema_version": 5,
            "matter_root": str(self.matter),
            "case_data_dir": stored,
            "evidence_sql_path": "../0. CASE DATA/T9999 Scratch Matter/evidence.sql",
        }, indent=2), encoding="utf-8")

    def run_check(self, *extra):
        return subprocess.run(
            [sys.executable, str(SCRIPT), str(self.root), *extra],
            text=True,
            capture_output=True,
            check=False,
        )

    def test_healthy_pointer_reports_resolution_and_current_version(self):
        self.write_pointer(str(self.case_data))
        result = self.run_check()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("HEALTHY", result.stdout)
        self.assertIn("user_version=90", result.stdout)
        self.assertIn("stored=selected", result.stdout)

    def test_stale_pointer_is_unhealthy_and_the_check_is_read_only(self):
        self.write_pointer(r"C:\Users\DeletedProfile\0. CASE DATA\T9999 Scratch Matter")
        before = hashlib.sha256(self.pointer.read_bytes()).hexdigest()
        result = self.run_check()
        after = hashlib.sha256(self.pointer.read_bytes()).hexdigest()

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("UNHEALTHY", result.stdout)
        self.assertIn("stored!=selected", result.stdout)
        self.assertEqual(after, before)

    def test_bad_sqlite_header_and_bad_config_root_are_unhealthy(self):
        self.write_pointer(str(self.case_data))
        (self.case_data / "law.sqlite").write_bytes(b"not sqlite")
        config = Path(self.temp.name) / "coclerk.json"
        config.write_text(json.dumps({
            "case_data_root": str(Path(self.temp.name) / "missing-case-root"),
            "repo_root": str(Path(self.temp.name) / "missing-repo-root"),
        }), encoding="utf-8")

        result = self.run_check("--config", str(config))

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("law.sqlite:bad-header", result.stdout)
        self.assertIn("case_data_root:missing", result.stdout)
        self.assertIn("repo_root:missing", result.stdout)

    def test_repo_root_is_optional_in_practice_config(self):
        self.write_pointer(str(self.case_data))
        config = Path(self.temp.name) / "coclerk.json"
        config.write_text(json.dumps({
            "case_data_root": str(self.root / "0. CASE DATA"),
        }), encoding="utf-8")

        result = self.run_check("--config", str(config))

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertNotIn("repo_root:", result.stdout)

    def test_sqlite_header_check_does_not_use_whole_file_reads(self):
        self.write_pointer(str(self.case_data))
        original = Path.read_bytes

        def guarded_read_bytes(path):
            if path.suffix == ".sqlite":
                raise AssertionError("whole SQLite file read")
            return original(path)

        Path.read_bytes = guarded_read_bytes
        try:
            self.assertEqual(
                check_pointers._sqlite_status(self.case_data / "main.sqlite"),
                "ok",
            )
        finally:
            Path.read_bytes = original


if __name__ == "__main__":
    unittest.main()
