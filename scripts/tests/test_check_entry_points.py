#!/usr/bin/env python3
"""
entry-point-registry, ported from CoClerk's plugin-packager tests/test_entry_point_registry.py.

The data runtime imports Python by bare module name from the skills tree, so a
rename inside that file must fail the check rather than only the installed plugin.
These tests rename symbols in TEMP files, never the real skills-tree file; the last
class reads the real repo to pin the registry against it.

Run: python -m pytest -q scripts/tests/test_check_entry_points.py
"""

import importlib.util
import os
import tempfile
import unittest

SCRIPTS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_spec = importlib.util.spec_from_file_location("check_plugin", os.path.join(SCRIPTS, "check_plugin.py"))
check_plugin = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(check_plugin)

MIGRATE_ENGINE_REAL = os.path.join(
    check_plugin.REPO, ".claude", "skills", "drafting-data", "references", "scripts", "migrate_engine.py")
MIGRATE_TS_REAL = check_plugin.server_path(
    check_plugin.REPO, check_plugin.server_owner(check_plugin.REPO, "data"), "data", "src", "submission", "migrate.ts")

FIXTURE_MODULE = '''\
class MigrateError(RuntimeError):
    def __init__(self, message, code=None, details=None):
        super().__init__(message)
        self.message = message

    def as_dict(self):
        return {"message": self.message}


def run(request):
    return {}
'''
SYMBOLS = ("run", "MigrateError", "MigrateError.as_dict")


class TestEntryPointViolations(unittest.TestCase):

    def _write(self, text):
        fd, path = tempfile.mkstemp(suffix=".py")
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(text)
        self.addCleanup(os.remove, path)
        return path

    def test_green_path_no_violations(self):
        self.assertEqual(check_plugin.entry_point_violations(self._write(FIXTURE_MODULE), SYMBOLS), [])

    def test_deliberate_rename_of_a_function_is_caught(self):
        path = self._write(FIXTURE_MODULE.replace("def run(request):", "def run2(request):"))
        violations = check_plugin.entry_point_violations(path, SYMBOLS)
        self.assertEqual(len(violations), 1)
        self.assertIn("'run'", violations[0])

    def test_deliberate_removal_of_a_class_is_caught(self):
        removed = FIXTURE_MODULE.split("class MigrateError")[0] + "def run(request):\n    return {}\n"
        violations = check_plugin.entry_point_violations(self._write(removed), SYMBOLS)
        self.assertEqual(len(violations), 2)  # MigrateError itself, and its as_dict

    def test_deliberate_rename_of_a_method_is_caught(self):
        path = self._write(FIXTURE_MODULE.replace("def as_dict(self):", "def to_dict(self):"))
        self.assertEqual(check_plugin.entry_point_violations(path, SYMBOLS),
                         [f"{path}: 'MigrateError.as_dict' not found at top level"])

    def test_missing_file(self):
        violations = check_plugin.entry_point_violations(
            os.path.join(tempfile.gettempdir(), "does-not-exist-98213.py"), ("run",))
        self.assertEqual(len(violations), 1)
        self.assertIn("not found", violations[0])

    def test_unparseable_file(self):
        violations = check_plugin.entry_point_violations(self._write("def broken(:\n"), ("run",))
        self.assertEqual(len(violations), 1)
        self.assertIn("could not parse", violations[0])

    def test_import_and_assignment_targets_count_as_top_level_names(self):
        path = self._write("from somewhere import run\nMigrateError = run\n")
        self.assertEqual(check_plugin.entry_point_violations(path, ("run", "MigrateError")), [])


class TestConsumerImportViolations(unittest.TestCase):

    def _write(self, text, suffix=".ts"):
        fd, path = tempfile.mkstemp(suffix=suffix)
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(text)
        self.addCleanup(os.remove, path)
        return path

    def test_consumer_importing_only_pinned_names_is_clean(self):
        path = self._write("from migrate_engine import MigrateError, run\n")
        self.assertEqual(
            check_plugin.consumer_import_violations(path, "migrate_engine", ("run", "MigrateError")), [])

    def test_consumer_importing_an_unpinned_name_is_caught(self):
        path = self._write("from migrate_engine import MigrateError, run, extra_helper\n")
        violations = check_plugin.consumer_import_violations(path, "migrate_engine", ("run", "MigrateError"))
        self.assertEqual(len(violations), 1)
        self.assertIn("extra_helper", violations[0])

    def test_import_line_does_not_swallow_the_following_statement(self):
        path = self._write(
            "def main():\n    from migrate_engine import MigrateError, run\n    try:\n        pass\n")
        self.assertEqual(
            check_plugin.consumer_import_violations(path, "migrate_engine", ("run", "MigrateError")), [])

    def test_missing_consumer_file(self):
        violations = check_plugin.consumer_import_violations(
            os.path.join(tempfile.gettempdir(), "does-not-exist-98214.ts"), "migrate_engine", ("run",))
        self.assertEqual(len(violations), 1)
        self.assertIn("not found", violations[0])


class TestRegistryAgainstTheRealRepo(unittest.TestCase):
    """Read-only pin: every real ENTRY_POINT_REGISTRY entry is consistent with the repo."""

    def test_migrate_engine_entry_is_consistent(self):
        self.assertTrue(os.path.isfile(MIGRATE_ENGINE_REAL), MIGRATE_ENGINE_REAL)
        self.assertTrue(os.path.isfile(MIGRATE_TS_REAL), MIGRATE_TS_REAL)
        entry = check_plugin.ENTRY_POINT_REGISTRY[0]
        violations = check_plugin.entry_point_violations(MIGRATE_ENGINE_REAL, entry["symbols"])
        violations += check_plugin.consumer_import_violations(MIGRATE_TS_REAL, "migrate_engine", entry["symbols"])
        self.assertEqual(violations, [])


if __name__ == "__main__":
    unittest.main()
