#!/usr/bin/env python3
"""
export_public: only public/ ships, only when it is clean and approved, and only into a safe target.

Run: python -m pytest -q scripts/tests/test_export_public.py
"""

import contextlib
import hashlib
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
PUBLIC = {
    ".claude-plugin/marketplace.json": MARKETPLACE,
    "README.md": "# Probanda\n",
    "plugins/probanda/.claude-plugin/plugin.json": json.dumps({"name": "probanda", "version": "1"}),
    "plugins/probanda/skills/x/SKILL.md": "A skill.\n",
}
# In the repo, outside public/: never exported.
PRIVATE = {
    "CLAUDE.md": "dev notes\n",
    "COMMANDMENTS.md": "rules\n",
    "README.md": "the private readme\n",
    "source/probanda/plugin.json": "{}",
    "plugins/probanda/skills/secret/SKILL.md": "the development plugin\n",
    ".claude/skills/data/schema.sql": f"{DDL};\n",
}


class ExportTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.tmp = Path(self._tmp.name).resolve()
        self.repo = self.tmp / "repo"
        self.target = self.tmp / "out"

    def put(self, rel, text):
        path = self.repo / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(text.encode("utf-8"))

    def repo_with(self, public, approve=True):
        for rel, text in PRIVATE.items():
            self.put(rel, text)
        for rel, text in public.items():
            self.put(f"public/{rel}", text)
        if approve:
            self.approve(public)

    def approve(self, public):
        self.put("public-approved.json",
                 json.dumps({rel: hashlib.sha256(text.encode("utf-8")).hexdigest() for rel, text in public.items()}))

    def run_export(self, target=None, plan=False):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = export_public.export(self.repo, target, plan)
        return code, out.getvalue(), err.getvalue()

    def exported(self):
        return sorted(p.relative_to(self.target).as_posix() for p in self.target.rglob("*") if p.is_file())

    def test_exports_exactly_public_and_nothing_else(self):
        self.repo_with(PUBLIC)
        code, _, _ = self.run_export(self.target)
        self.assertEqual(code, 0)
        self.assertEqual(self.exported(), sorted(PUBLIC))
        self.assertEqual((self.target / "README.md").read_bytes(), b"# Probanda\n")

    def test_unapproved_tree_refuses_and_writes_nothing(self):
        self.repo_with(PUBLIC, approve=False)
        code, out, _ = self.run_export(self.target)
        self.assertEqual(code, 1)
        self.assertIn("not approved, added: README.md", out)
        self.assertFalse(self.target.exists())

    def test_file_changed_after_approval_refuses(self):
        self.repo_with(PUBLIC)
        self.put("public/README.md", "# Probanda\n\nA new line.\n")
        code, out, _ = self.run_export(self.target)
        self.assertEqual(code, 1)
        self.assertIn("not approved, changed: README.md", out)

    def test_file_added_after_approval_refuses(self):
        self.repo_with(PUBLIC)
        self.put("public/plugins/probanda/skills/y/SKILL.md", "Another skill.\n")
        code, out, _ = self.run_export(self.target)
        self.assertEqual(code, 1)
        self.assertIn("not approved, added: plugins/probanda/skills/y/SKILL.md", out)

    def test_file_removed_after_approval_refuses(self):
        self.repo_with(PUBLIC)
        (self.repo / "public/plugins/probanda/skills/x/SKILL.md").unlink()
        code, out, _ = self.run_export(self.target)
        self.assertEqual(code, 1)
        self.assertIn("not approved, removed: plugins/probanda/skills/x/SKILL.md", out)

    def test_approved_trade_secret_still_refuses(self):
        public = {**PUBLIC, "plugins/probanda/skills/x/ref.md": f"{DDL}\n"}
        self.repo_with(public)
        code, out, _ = self.run_export(self.target)
        self.assertEqual(code, 1)
        self.assertIn("contains schema DDL", out)
        self.assertFalse(self.target.exists())

    def test_missing_required_file_refuses(self):
        public = {k: v for k, v in PUBLIC.items() if k != "README.md"}
        self.repo_with(public)
        code, out, _ = self.run_export(self.target)
        self.assertEqual(code, 1)
        self.assertIn("missing: public/README.md", out)

    def test_no_public_folder_refuses(self):
        for rel, text in PRIVATE.items():
            self.put(rel, text)
        code, out, _ = self.run_export(self.target)
        self.assertEqual(code, 1)
        self.assertIn("missing: public/.claude-plugin/marketplace.json", out)

    def test_plan_writes_nothing_and_reports_the_gate(self):
        self.repo_with(PUBLIC)
        code, out, _ = self.run_export(plan=True)
        self.assertEqual(code, 0)
        self.assertIn("PLAN OK", out)
        self.put("public/README.md", "changed\n")
        self.assertEqual(self.run_export(plan=True)[0], 1)
        self.assertFalse(self.target.exists())

    def test_target_inside_the_repo_is_refused(self):
        self.repo_with(PUBLIC)
        code, _, err = self.run_export(self.repo / "out")
        self.assertEqual(code, 2)
        self.assertIn("STOP", err)

    def test_target_holding_the_repo_is_refused(self):
        self.repo_with(PUBLIC)
        self.assertEqual(self.run_export(self.tmp)[0], 2)

    def test_non_empty_target_without_git_is_refused(self):
        self.repo_with(PUBLIC)
        self.target.mkdir()
        (self.target / "keep.txt").write_text("mine")
        self.assertEqual(self.run_export(self.target)[0], 2)
        self.assertTrue((self.target / "keep.txt").exists())

    def test_git_checkout_target_is_replaced_but_keeps_dot_git(self):
        self.repo_with(PUBLIC)
        (self.target / ".git").mkdir(parents=True)
        (self.target / ".git" / "HEAD").write_text("ref")
        (self.target / "old.md").write_text("from an earlier export")
        (self.target / "plugins" / "gone").mkdir(parents=True)
        (self.target / "plugins" / "gone" / "x.md").write_text("x")
        self.assertEqual(self.run_export(self.target)[0], 0)
        self.assertEqual(self.exported(), sorted([*PUBLIC, ".git/HEAD"]))

    def test_refused_export_leaves_an_existing_checkout_untouched(self):
        self.repo_with(PUBLIC, approve=False)
        (self.target / ".git").mkdir(parents=True)
        (self.target / "old.md").write_text("from an earlier export")
        self.assertEqual(self.run_export(self.target)[0], 1)
        self.assertTrue((self.target / "old.md").exists())


if __name__ == "__main__":
    unittest.main()
