#!/usr/bin/env python3
"""
export_public: the allowlist, the refusals, and the target rules.

Run: python -m pytest -q scripts/tests/test_export_public.py
"""

import contextlib
import importlib.util
import io
import json
import os
import tempfile
import unittest
from pathlib import Path

SCRIPTS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_spec = importlib.util.spec_from_file_location("export_public", os.path.join(SCRIPTS, "export_public.py"))
export_public = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(export_public)

# Built from parts so this file holds no line the publish scan itself reports.
DDL = "CREATE" + " TABLE a (id)"

MARKETPLACE = json.dumps({"name": "probanda", "plugins": [{"name": "probanda", "source": "./plugins/probanda"}]})
CLEAN = {
    ".claude-plugin/marketplace.json": MARKETPLACE,
    "README.md": "# Probanda\n",
    "plugins/probanda/.claude-plugin/plugin.json": json.dumps({"name": "probanda", "version": "1"}),
    "plugins/probanda/skills/x/SKILL.md": "A skill.\n",
}
# Present in the repo, never on the allowlist.
NOT_EXPORTED = {
    "CLAUDE.md": "dev notes\n",
    "COMMANDMENTS.md": "rules\n",
    "source/probanda/plugin.json": "{}",
    "scripts/export_public.py": "x\n",
    "plugins/other/README.md": "another plugin\n",
}


def fake_file_problems(path, data):
    text = data.decode("utf-8", errors="replace")
    return [(path, n, "contains schema DDL", line) for n, line in enumerate(text.split("\n"), 1) if DDL in line]


class ExportTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.tmp = Path(self._tmp.name).resolve()
        self.repo = self.tmp / "repo"
        self.target = self.tmp / "out"

    def repo_with(self, files, extra=None):
        for rel, text in {**files, **(extra or {})}.items():
            path = self.repo / rel
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(text.encode("utf-8"))

    def run_export(self, target=None, plan=False, built=None):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = export_public.export(self.repo, target, plan, built=built, file_problems=fake_file_problems)
        return code, out.getvalue(), err.getvalue()

    def exported(self):
        return sorted(p.relative_to(self.target).as_posix() for p in self.target.rglob("*") if p.is_file())

    def test_clean_repo_exports_exactly_the_allowlist(self):
        self.repo_with(CLEAN, NOT_EXPORTED)
        code, _, _ = self.run_export(self.target)
        self.assertEqual(code, 0)
        self.assertEqual(self.exported(), sorted(CLEAN))

    def test_exported_bytes_are_the_source_bytes(self):
        self.repo_with(CLEAN)
        (self.repo / "README.md").write_bytes(b"line\r\nnext\n")
        self.run_export(self.target)
        self.assertEqual((self.target / "README.md").read_bytes(), b"line\r\nnext\n")

    def test_license_ships_when_present(self):
        self.repo_with(CLEAN, {"LICENSE": "terms\n"})
        self.run_export(self.target)
        self.assertIn("LICENSE", self.exported())

    def test_python_caches_are_skipped(self):
        self.repo_with(CLEAN, {"plugins/probanda/skills/x/__pycache__/a.cpython-312.pyc": "x",
                               "plugins/probanda/skills/x/b.pyc": "x"})
        self.run_export(self.target)
        self.assertEqual(self.exported(), sorted(CLEAN))

    def test_schema_ddl_in_an_exported_file_refuses_and_writes_nothing(self):
        self.repo_with(CLEAN, {"plugins/probanda/skills/x/ref.md": f"{DDL}\n"})
        code, out, _ = self.run_export(self.target)
        self.assertEqual(code, 1)
        self.assertIn("REFUSED", out)
        self.assertFalse(self.target.exists())

    def test_problem_in_a_file_outside_the_allowlist_does_not_refuse(self):
        self.repo_with(CLEAN, {"source/probanda/mcp/a.ts": f"{DDL}\n"})
        self.assertEqual(self.run_export(self.target)[0], 0)

    def test_missing_required_file_refuses(self):
        self.repo_with({k: v for k, v in CLEAN.items() if k != "README.md"})
        code, out, _ = self.run_export(self.target)
        self.assertEqual(code, 1)
        self.assertIn("missing: README.md", out)

    def test_missing_plugin_tree_refuses(self):
        self.repo_with({"README.md": "x\n", ".claude-plugin/marketplace.json": MARKETPLACE})
        code, out, _ = self.run_export(self.target)
        self.assertEqual(code, 1)
        self.assertIn("missing: plugins/probanda/", out)

    def test_unpinned_plugin_name_refuses_with_the_real_checker(self):
        self.repo_with(CLEAN, {"plugins/probanda/.claude-plugin/plugin.json": json.dumps({"name": "other"})})
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = export_public.export(self.repo, self.target, True)
        self.assertEqual(code, 1)
        self.assertIn("is not on the pinned list", out.getvalue())

    def test_stale_built_plugin_refuses(self):
        self.repo_with(CLEAN)
        fresh = {".claude-plugin/plugin.json": CLEAN["plugins/probanda/.claude-plugin/plugin.json"].encode(),
                 "skills/x/SKILL.md": b"A different skill.\n"}
        code, out, _ = self.run_export(self.target, built=lambda: fresh)
        self.assertEqual(code, 1)
        self.assertIn("changed: skills/x/SKILL.md", out)
        self.assertFalse(self.target.exists())

    def test_current_built_plugin_passes(self):
        self.repo_with(CLEAN)
        fresh = {".claude-plugin/plugin.json": CLEAN["plugins/probanda/.claude-plugin/plugin.json"].encode(),
                 "skills/x/SKILL.md": CLEAN["plugins/probanda/skills/x/SKILL.md"].encode()}
        self.assertEqual(self.run_export(self.target, built=lambda: fresh)[0], 0)

    def test_plan_writes_nothing_and_reports_the_gate(self):
        self.repo_with(CLEAN)
        code, out, _ = self.run_export(plan=True)
        self.assertEqual(code, 0)
        self.assertIn("PLAN OK", out)
        self.repo_with({}, {"plugins/probanda/skills/x/ref.md": f"{DDL}\n"})
        self.assertEqual(self.run_export(plan=True)[0], 1)
        self.assertFalse(self.target.exists())

    def test_target_inside_the_repo_is_refused(self):
        self.repo_with(CLEAN)
        code, _, err = self.run_export(self.repo / "out")
        self.assertEqual(code, 2)
        self.assertIn("STOP", err)

    def test_target_holding_the_repo_is_refused(self):
        self.repo_with(CLEAN)
        self.assertEqual(self.run_export(self.tmp)[0], 2)

    def test_non_empty_target_without_git_is_refused(self):
        self.repo_with(CLEAN)
        self.target.mkdir()
        (self.target / "keep.txt").write_text("mine")
        self.assertEqual(self.run_export(self.target)[0], 2)
        self.assertTrue((self.target / "keep.txt").exists())

    def test_git_checkout_target_is_replaced_but_keeps_dot_git(self):
        self.repo_with(CLEAN)
        (self.target / ".git").mkdir(parents=True)
        (self.target / ".git" / "HEAD").write_text("ref")
        (self.target / "old.md").write_text("from an earlier export")
        (self.target / "plugins" / "gone").mkdir(parents=True)
        (self.target / "plugins" / "gone" / "x.md").write_text("x")
        self.assertEqual(self.run_export(self.target)[0], 0)
        self.assertEqual(self.exported(), sorted([*CLEAN, ".git/HEAD"]))

    def test_refused_export_leaves_an_existing_checkout_untouched(self):
        self.repo_with(CLEAN, {"plugins/probanda/skills/x/ref.md": f"{DDL}\n"})
        (self.target / ".git").mkdir(parents=True)
        (self.target / "old.md").write_text("from an earlier export")
        self.assertEqual(self.run_export(self.target)[0], 1)
        self.assertTrue((self.target / "old.md").exists())


class StalePathsTest(unittest.TestCase):
    def test_reports_added_removed_and_changed(self):
        files = {"plugins/probanda/a.md": b"1", "plugins/probanda/b.md": b"1", "README.md": b"x"}
        built = {"a.md": b"2", "c.md": b"1"}
        self.assertEqual(export_public.stale_paths(files, built), ["added: c.md", "removed: b.md", "changed: a.md"])


if __name__ == "__main__":
    unittest.main()
