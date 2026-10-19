import importlib.util
import json
import os
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest import mock


SCRIPT = Path(__file__).parents[1] / "references" / "scripts" / "resolve_paths.py"
SPEC = importlib.util.spec_from_file_location("case_data_resolve_paths", SCRIPT)
resolve_paths = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(resolve_paths)


class ResolvePathsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        litigation_root = Path(self.temp.name) / "Litigation - Documents"
        self.matter_root = litigation_root / "T9999 Scratch Matter"
        self.live_dir = litigation_root / "0. CASE DATA" / "T9999 Scratch Matter"
        self.matter_root.mkdir(parents=True)

    def tearDown(self):
        self.temp.cleanup()

    def write_db(self, directory, value="live", version=90, metadata=None):
        directory = Path(directory)
        directory.mkdir(parents=True, exist_ok=True)
        con = sqlite3.connect(directory / "main.sqlite")
        con.execute(f"PRAGMA user_version = {version}")
        con.execute("CREATE TABLE marker(value TEXT)")
        con.execute("INSERT INTO marker VALUES (?)", (value,))
        if metadata:
            con.execute("CREATE TABLE matter_metadata(key TEXT PRIMARY KEY, value TEXT)")
            con.executemany("INSERT INTO matter_metadata VALUES (?, ?)", metadata.items())
        con.commit()
        con.close()

    def write_pointer(self, stored):
        pointer_path = self.matter_root / "probanda.json"
        pointer_path.write_text(json.dumps({
            "schema_version": 5,
            "matter_root": r"C:\Users\DeletedProfile\Litigation - Documents\T9999 Scratch Matter",
            "case_data_dir": stored,
            "evidence_sql_path": "../0. CASE DATA/T9999 Scratch Matter/evidence.sql",
        }), encoding="utf-8")
        return pointer_path

    def test_missing_evidence_path_defaults_to_the_case_data_folder(self):
        self.write_db(self.live_dir)
        pointer_path = self.matter_root / "coclerk.json"
        pointer_path.write_text(json.dumps({
            "schema_version": 5,
            "case_data_dir": str(self.live_dir),
        }), encoding="utf-8")

        resolved = resolve_paths.resolve_pointer(str(self.matter_root))

        self.assertEqual(Path(resolved["evidence_sql"]), self.live_dir / "evidence.sql")
        healed = json.loads(pointer_path.read_text(encoding="utf-8"))
        self.assertEqual(
            Path(healed["evidence_sql_path"]),
            Path("..", "0. CASE DATA", "T9999 Scratch Matter", "evidence.sql"))
        # The legacy coclerk.json pointer is read and migrated to probanda.json.
        migrated = json.loads((self.matter_root / "probanda.json").read_text(encoding="utf-8"))
        self.assertEqual(migrated, healed)

    def test_stale_nominee_loses_to_live_derived_database_and_warns(self):
        self.write_db(self.live_dir)
        pointer_path = self.write_pointer(r"C:\Users\DeletedProfile\matter-data")
        warnings = []

        resolved = resolve_paths.resolve_pointer(str(self.matter_root), warn=warnings.append)

        self.assertEqual(Path(resolved["case_data_dir"]), self.live_dir)
        self.assertIn("stored case_data_dir", warnings[0].lower())
        healed = json.loads(pointer_path.read_text(encoding="utf-8"))
        self.assertEqual(Path(healed["case_data_dir"]), self.live_dir)
        self.assertEqual(Path(healed["matter_root"]), self.matter_root)

    def test_valid_absolute_and_relative_nonstandard_nominees_remain_supported(self):
        absolute = Path(self.temp.name) / "absolute-custom"
        self.write_db(absolute, "absolute")
        self.write_pointer(str(absolute))
        self.assertEqual(
            Path(resolve_paths.resolve_pointer(str(self.matter_root))["case_data_dir"]),
            absolute,
        )

        relative = self.matter_root / "relative-custom"
        self.write_db(relative, "relative")
        self.write_pointer("relative-custom")
        self.assertEqual(
            Path(resolve_paths.resolve_pointer(str(self.matter_root))["case_data_dir"]),
            relative,
        )

    def test_empty_nominee_uses_live_derived_location(self):
        self.write_db(self.live_dir)
        self.write_pointer("")
        resolved = resolve_paths.resolve_pointer(str(self.matter_root))
        self.assertEqual(Path(resolved["case_data_dir"]), self.live_dir)

    def test_existing_empty_nominee_loses_to_live_derived_location(self):
        self.write_db(self.live_dir)
        empty = self.matter_root / "empty-nominee"
        empty.mkdir()
        self.write_pointer("empty-nominee")
        resolved = resolve_paths.resolve_pointer(str(self.matter_root))
        self.assertEqual(Path(resolved["case_data_dir"]), self.live_dir)

    def test_stale_sandbox_nominee_loses_to_live_derived_location(self):
        self.write_db(self.live_dir)
        self.write_pointer("/sessions/expired/0. CASE DATA/T9999 Scratch Matter")
        resolved = resolve_paths.resolve_pointer(str(self.matter_root))
        self.assertEqual(Path(resolved["case_data_dir"]), self.live_dir)

    def test_live_metadata_identity_beats_renamed_matter_folder(self):
        renamed_root = self.matter_root.parent / "T9999 Renamed Matter"
        self.matter_root.rename(renamed_root)
        self.matter_root = renamed_root
        original = self.live_dir.parent / "T9999 Original Name"
        self.write_db(original, metadata={
            "matter_id": "T9999",
            "short_name": "Original Name",
        })
        self.write_pointer(r"C:\Users\DeletedProfile\0. CASE DATA\T9999 Original Name")
        resolved = resolve_paths.resolve_pointer(str(self.matter_root))
        self.assertEqual(Path(resolved["case_data_dir"]), original)

    def test_missing_canonical_nominee_is_bootstrap_not_drift(self):
        self.write_pointer(str(self.live_dir))
        warnings = []
        resolved = resolve_paths.resolve_pointer(
            str(self.matter_root), migrate_only=True, warn=warnings.append
        )
        self.assertEqual(Path(resolved["case_data_dir"]), self.live_dir)
        self.assertEqual(warnings, [])

    def test_migrate_only_allows_an_old_live_derived_database(self):
        self.write_db(self.live_dir, version=76)
        self.write_pointer(r"C:\Users\DeletedProfile\matter-data")
        resolved = resolve_paths.resolve_pointer(str(self.matter_root), migrate_only=True)
        self.assertEqual(Path(resolved["case_data_dir"]), self.live_dir)

    def test_sandbox_resolution_uses_live_database_but_preserves_durable_host_breadcrumb(self):
        self.write_db(self.live_dir)
        durable = r"C:\Users\HostProfile\0. CASE DATA\T9999 Scratch Matter"
        pointer_path = self.write_pointer(durable)

        resolved = resolve_paths.resolve_pointer(
            str(self.matter_root), running_in_sandbox=True
        )

        self.assertEqual(Path(resolved["case_data_dir"]), self.live_dir)
        self.assertEqual(
            json.loads(pointer_path.read_text(encoding="utf-8"))["case_data_dir"],
            durable,
        )


class StagingTagTests(unittest.TestCase):
    """#1060: the probe and guard temp copies carry the data runtime's per-call tag."""

    def prefixes(self, tag):
        with tempfile.TemporaryDirectory() as temp:
            db = Path(temp) / "main.sqlite"
            con = sqlite3.connect(db)
            con.execute("PRAGMA user_version = 90")
            con.close()
            prefixes = []
            real = tempfile.mkdtemp

            def recording(*args, **kwargs):
                prefixes.append(kwargs.get("prefix"))
                return real(*args, **kwargs)

            env = {k: v for k, v in os.environ.items() if k != "COCLERK_STAGING_TAG"}
            if tag:
                env["COCLERK_STAGING_TAG"] = tag
            with mock.patch.dict(os.environ, env, clear=True), \
                    mock.patch("tempfile.mkdtemp", recording):
                resolve_paths.identity_from_metadata(str(db))
                resolve_paths._read_user_version(str(db))
            return prefixes

    def test_tagged_under_the_runtime(self):
        self.assertEqual(self.prefixes("0123456789abcdef"),
                         ["coclerk_probe_0123456789abcdef_", "coclerk_guard_0123456789abcdef_"])

    def test_untagged_when_run_by_hand(self):
        self.assertEqual(self.prefixes(None), ["coclerk_probe_", "coclerk_guard_"])


if __name__ == "__main__":
    unittest.main()
