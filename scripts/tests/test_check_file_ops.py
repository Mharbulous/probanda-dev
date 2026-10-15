#!/usr/bin/env python3
"""
check_file_ops: a file-changing operation outside file-manager is found, and a ruling settles it.

Run: python -m pytest -q scripts/tests/test_check_file_ops.py
"""

import importlib.util
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_spec = importlib.util.spec_from_file_location("check_file_ops", os.path.join(SCRIPTS, "check_file_ops.py"))
check_file_ops = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(check_file_ops)

PLUGINS = {
    "practice": {"requires": [], "skills": ["show-me"], "agents": [], "hooks": {}, "servers": []},
    "file-manager": {"requires": ["practice"], "skills": ["file-apply"], "agents": [], "hooks": {}, "servers": []},
}


def make_repo(root, files, plugins=PLUGINS):
    (root / "source").mkdir(parents=True, exist_ok=True)
    (root / "source" / "assignment.json").write_text(json.dumps({"plugins": plugins}), encoding="utf-8")
    for rel, text in files.items():
        path = root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")


class ScanTest(unittest.TestCase):
    def pairs(self, files, plugins=PLUGINS):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_repo(root, files, plugins)
            return sorted({(f["file"], f["op"]) for f in check_file_ops.scan(root)})

    def test_python_operations_are_found_and_str_replace_is_not(self):
        code = ("import os, shutil\nos.rename(a, b)\nshutil.move(a, b)\np.unlink()\n"
                "name = name.replace('x', 'y')\nos.replace(a, b)\n")
        self.assertEqual(self.pairs({".claude/skills/show-me/scripts/x.py": code}),
                         [(".claude/skills/show-me/scripts/x.py", op)
                          for op in ("os.rename", "os.replace", "path.unlink", "shutil.move")])

    def test_prose_that_tells_the_model_to_rename_is_found(self):
        self.assertEqual(self.pairs({".claude/skills/show-me/SKILL.md": "Then rename the file (F2).\n"}),
                         [(".claude/skills/show-me/SKILL.md", "prose rename")])

    def test_file_manager_and_tests_are_not_scanned(self):
        self.assertEqual(self.pairs({".claude/skills/file-apply/scripts/apply.py": "os.rename(a, b)\n",
                                     ".claude/skills/show-me/tests/test_x.py": "os.remove(a)\n"}), [])

    def test_server_source_is_read_by_its_imports_and_fs_names_by_their_import(self):
        plugins = json.loads(json.dumps(PLUGINS))
        plugins["practice"]["servers"] = ["data"]
        files = {
            "source/practice/mcp/src/index.ts": 'import { go } from "./a.js";\nrename(x);\n',
            "source/practice/mcp/src/a.ts": 'import { renameSync as mv } from "node:fs";\nexport const go = () => mv(a, b);\n',
            "source/practice/mcp/src/file-manager-only.ts": 'import { unlinkSync } from "node:fs";\nunlinkSync(a);\n',
        }
        self.assertEqual(self.pairs(files, plugins), [("source/practice/mcp/src/a.ts", "fs.rename")])


class RulingTest(unittest.TestCase):
    FILE = ".claude/skills/show-me/scripts/x.py"

    def run_main(self, rulings):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_repo(root, {self.FILE: "os.remove(tmp)\n"})
            (root / "source" / "file-ops.json").write_text(json.dumps({"allowed": rulings}), encoding="utf-8")
            old, sys.argv = sys.argv, ["check_file_ops.py", "--repo", str(root)]
            try:
                return check_file_ops.main()
            finally:
                sys.argv = old

    RULING = {"file": FILE, "op": "os.remove", "why": "temp", "note": "its own temp file"}

    def test_unruled_hit_fails(self):
        self.assertEqual(self.run_main([]), 1)

    def test_ruled_hit_passes(self):
        self.assertEqual(self.run_main([self.RULING]), 0)

    def test_stale_ruling_fails(self):
        stale = {**self.RULING, "op": "shutil.rmtree"}
        self.assertEqual(self.run_main([self.RULING, stale]), 1)

    def test_unknown_why_fails(self):
        self.assertEqual(self.run_main([{**self.RULING, "why": "user-file"}]), 1)


if __name__ == "__main__":
    unittest.main()
