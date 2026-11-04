#!/usr/bin/env python3
"""
approve_public: the person sees what changed before approving, and nothing is written without a yes.

Run: python -m pytest -q scripts/tests/test_approve_public.py
"""

import contextlib
import hashlib
import importlib.util
import io
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

import fake_repo

SCRIPTS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_spec = importlib.util.spec_from_file_location("approve_public", os.path.join(SCRIPTS, "approve_public.py"))
approve_public = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(approve_public)

CHANGELOG = "# Changelog\n\n"
FIRST_ENTRY = "## First release of the practice plugin\n\n- practice 0.1.0: one skill.\n"
PUBLIC = {
    "CHANGELOG.md": CHANGELOG + FIRST_ENTRY,
    "README.md": "# Probanda\n\nAn early release.\n",
    "plugins/lawyer/skills/x/SKILL.md": "A skill.\n",
}


class ApproveTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.repo = Path(self._tmp.name).resolve()
        fake_repo.write_assignment(self.repo, {"lawyer": {"skills": ["x", "y"]}})
        self.put("source/lawyer/plugin.json", "{}")
        self.put(".claude/skills/data/SKILL.md", "the private skill\n")
        self.put("cloud/pool/notes.md", "the pool\n")
        for rel, text in PUBLIC.items():
            self.put(f"public/{rel}", text)
        self.put("public-approved.json",
                 json.dumps({rel: hashlib.sha256(text.encode("utf-8")).hexdigest() for rel, text in PUBLIC.items()}))
        self.git("init", "-q")
        self.commit()

    def put(self, rel, text):
        path = self.repo / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(text.encode("utf-8"))

    def git(self, *args):
        subprocess.run(["git", "-C", str(self.repo), "-c", "user.name=t", "-c", "user.email=t@example.com",
                        "-c", "core.autocrlf=false", *args], check=True, capture_output=True)

    def commit(self):
        self.git("add", "-A")
        self.git("commit", "-q", "-m", "c")

    def new_entry(self, subject="Practice: a second skill", bullets="- practice 0.1.1: skill y.\n"):
        self.put("public/CHANGELOG.md", f"{CHANGELOG}## {subject}\n\n{bullets}\n{FIRST_ENTRY}")

    def approved(self):
        return json.loads((self.repo / "public-approved.json").read_text(encoding="utf-8"))

    def run_approve(self, confirmed):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = approve_public.approve(self.repo, lambda: confirmed)
        return code, out.getvalue()

    def test_a_changed_file_is_shown_as_a_diff_of_the_approved_text(self):
        self.put("public/README.md", "# Probanda\n\nIt holds a first few skills.\n")
        self.commit()
        self.put("public/README.md", "# Probanda\n\nIt holds many skills.\n")
        self.new_entry()
        code, out = self.run_approve(False)
        self.assertEqual(code, 2)
        self.assertIn("changed: README.md", out)
        self.assertIn("-An early release.", out)
        self.assertIn("+It holds many skills.", out)
        self.assertNotIn("a first few skills", out)

    def test_an_added_file_is_shown_in_full(self):
        self.put("public/plugins/lawyer/skills/y/SKILL.md", "Another skill.\nSecond line.\n")
        _, out = self.run_approve(False)
        self.assertIn("added: plugins/lawyer/skills/y/SKILL.md", out)
        self.assertIn("+Another skill.", out)
        self.assertIn("+Second line.", out)

    def test_a_changed_file_with_no_approved_text_in_history_is_shown_in_full(self):
        self.put("public-approved.json", json.dumps({**self.approved(), "README.md": "0" * 64}))
        _, out = self.run_approve(False)
        self.assertIn("approved text is not in git history", out)
        self.assertIn("+An early release.", out)

    def test_without_confirmation_nothing_is_written(self):
        self.put("public/README.md", "changed\n")
        self.new_entry()
        before = self.approved()
        code, out = self.run_approve(False)
        self.assertEqual(code, 2)
        self.assertIn("Not approved. Nothing written.", out)
        self.assertEqual(self.approved(), before)

    def test_confirmation_writes_the_new_list(self):
        self.put("public/README.md", "changed\n")
        self.new_entry()
        code, _ = self.run_approve(True)
        self.assertEqual(code, 0)
        self.assertEqual(self.approved()["README.md"], hashlib.sha256(b"changed\n").hexdigest())

    def test_a_problem_in_public_refuses_even_when_confirmed(self):
        self.put("public/notes.bin", "x")
        before = self.approved()
        code, _ = self.run_approve(True)
        self.assertEqual(code, 1)
        self.assertEqual(self.approved(), before)

    def test_a_change_without_a_new_changelog_entry_refuses_even_when_confirmed(self):
        self.put("public/README.md", "changed\n")
        before = self.approved()
        code, out = self.run_approve(True)
        self.assertEqual(code, 1)
        self.assertIn("changed: README.md", out)
        self.assertIn("CHANGELOG.md did not", out)
        self.assertEqual(self.approved(), before)

    def test_a_generic_changelog_entry_refuses(self):
        self.put("public/README.md", "changed\n")
        self.new_entry(subject="Publish updates from the repository")
        code, out = self.run_approve(True)
        self.assertEqual(code, 1)
        self.assertIn("generic", out)

    def test_a_changelog_entry_without_bullets_refuses(self):
        self.put("public/README.md", "changed\n")
        self.new_entry(bullets="Some prose.\n")
        code, out = self.run_approve(True)
        self.assertEqual(code, 1)
        self.assertIn("bullet", out)

    def test_the_commit_message_is_shown_before_asking(self):
        self.put("public/README.md", "changed\n")
        self.new_entry()
        _, out = self.run_approve(False)
        self.assertIn("Public commit message:", out)
        self.assertIn("  Practice: a second skill\n\n  - practice 0.1.1: skill y.", out)

    def test_nothing_to_approve(self):
        code, out = self.run_approve(True)
        self.assertEqual(code, 0)
        self.assertIn("Nothing to approve", out)


if __name__ == "__main__":
    unittest.main()
