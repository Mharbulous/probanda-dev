#!/usr/bin/env python3
"""
release_changes: a plugin's last bump is the last commit that changed the "version" line
of its source/<plugin>/plugin.json, not the last commit that touched the file.

Run: python -m pytest -q scripts/tests/test_release_changes.py

Each test builds a throwaway git repository under the system's temporary folder.
"""

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent.parent / "release_changes.py"
MANIFEST = "source/lawyer/plugin.json"
BUILT = "plugins/lawyer/skills/dyu/SKILL.md"


def manifest(version, author="Probanda Legal"):
    return json.dumps({"name": "lawyer", "version": version, "author": {"name": author}}, indent=2) + "\n"


class Repo:
    def __init__(self, root):
        self.root = Path(root)
        self.git("init", "-q", "-b", "main")
        self.git("config", "user.name", "Test")
        self.git("config", "user.email", "test@example.invalid")
        self.git("config", "commit.gpgsign", "false")

    def git(self, *args):
        return subprocess.run(["git", "-C", str(self.root), *args], check=True, capture_output=True,
                              text=True).stdout.strip()

    def commit(self, message, write):
        for rel, text in write.items():
            path = self.root / rel
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text, encoding="utf-8")
            self.git("add", rel)
        self.git("commit", "-q", "-m", message)
        return self.git("rev-parse", "HEAD")


def release_changes(root):
    result = subprocess.run([sys.executable, str(SCRIPT), "--repo", str(root)], capture_output=True, text=True)
    return result.returncode, result.stdout.splitlines()


class LastBump(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.repo = Repo(self.tmp.name)
        assignment = {"status": "cutover", "plugins": {
            "lawyer": {"requires": [], "skills": ["dyu"], "agents": [], "hooks": {}, "servers": []}}}
        self.bump = self.repo.commit("Lawyer 0.1.0", {
            "source/assignment.json": json.dumps(assignment), MANIFEST: manifest("0.1.0"), BUILT: "dyu v1\n"})

    def tearDown(self):
        self.tmp.cleanup()

    def test_plugin_json_edit_without_a_version_change_is_not_a_bump(self):
        self.repo.commit("Drop the author's URL and rebuild", {MANIFEST: manifest("0.1.0", "Probanda"),
                                                                BUILT: "dyu v2\n"})
        code, lines = release_changes(self.tmp.name)
        self.assertEqual((code, lines), (1, [f"released: lawyer (1 files under plugins/lawyer/ changed since {self.bump[:8]})"]))

    def test_version_change_is_a_bump(self):
        self.repo.commit("Rebuild", {BUILT: "dyu v2\n"})
        self.repo.commit("Lawyer 0.1.1", {MANIFEST: manifest("0.1.1")})
        code, lines = release_changes(self.tmp.name)
        self.assertEqual((code, lines), (0, ["nothing changed since each plugin's last bump"]))


if __name__ == "__main__":
    unittest.main()
