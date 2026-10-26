#!/usr/bin/env python3
"""
local_implementer_guard: the local implementer runs only in its own clone,
never in the shared checkout or any worktree of it.

Run: python -m pytest -q scripts/tests/test_local_implementer_guard.py

Each test builds throwaway git repositories under the system temp folder.
"""

import importlib.util
import os
import subprocess
import tempfile
import unittest
from unittest import mock

SCRIPTS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_spec = importlib.util.spec_from_file_location("local_implementer_guard",
                                               os.path.join(SCRIPTS, "local_implementer_guard.py"))
guard = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(guard)

ORIGIN = "https://github.com/Mharbulous/probanda-dev.git"


def git(*args, cwd=None):
    env = dict(os.environ, GIT_AUTHOR_NAME="t", GIT_AUTHOR_EMAIL="t@example.invalid",
               GIT_COMMITTER_NAME="t", GIT_COMMITTER_EMAIL="t@example.invalid")
    subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, env=env)


def make_repo(path, origin=ORIGIN):
    os.makedirs(path)
    git("init", "-q", "-b", "main", cwd=path)
    git("commit", "-q", "--allow-empty", "-m", "start", cwd=path)
    if origin:
        git("remote", "add", "origin", origin, cwd=path)


class Guard(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = self.tmp.name
        self.appdata = os.path.join(self.root, "AppData", "Local")
        self.env = mock.patch.dict(os.environ, {"LOCALAPPDATA": self.appdata})
        self.env.start()
        self.clone = os.path.join(self.appdata, "probanda-local-implementer", "probanda-dev")
        self.shared = os.path.join(self.root, "shared", "probanda-dev")
        make_repo(self.shared)

    def tearDown(self):
        self.env.stop()
        self.tmp.cleanup()

    def test_clone_path_is_under_local_app_data(self):
        self.assertEqual(guard.clone_path(), self.clone)
        self.assertNotEqual(guard.norm(guard.clone_path()), guard.norm(self.shared))

    def test_dedicated_clone_accepted(self):
        git("clone", "-q", self.shared, self.clone)
        git("remote", "set-url", "origin", ORIGIN, cwd=self.clone)
        self.assertIsNone(guard.check(self.clone))
        self.assertEqual(guard.main(["--dir", self.clone]), 0)

    def test_shared_checkout_refused(self):
        self.assertIn("not the local implementer's own clone", guard.check(self.shared))
        self.assertEqual(guard.main(["--dir", self.shared]), 1)

    def test_worktree_of_shared_checkout_refused_elsewhere(self):
        tree = os.path.join(self.shared, ".claude", "worktrees", "agent-x")
        git("worktree", "add", "-q", "-b", "agent-x", tree, cwd=self.shared)
        self.assertIn("not the local implementer's own clone", guard.check(tree))

    def test_worktree_of_shared_checkout_refused_at_the_clone_path(self):
        os.makedirs(os.path.dirname(self.clone))
        git("worktree", "add", "-q", "-b", "local-run", self.clone, cwd=self.shared)
        self.assertIn("linked worktree", guard.check(self.clone))
        self.assertEqual(guard.main(["--dir", self.clone]), 1)

    def test_folder_inside_a_checkout_at_the_clone_path_refused(self):
        outer = os.path.join(self.appdata, "probanda-local-implementer")
        make_repo(outer)
        os.makedirs(self.clone)
        self.assertIn("inside the working tree", guard.check(self.clone))

    def test_plain_folder_refused(self):
        os.makedirs(self.clone)
        self.assertIn("not a git working tree", guard.check(self.clone))

    def test_wrong_origin_refused(self):
        make_repo(self.clone, origin="https://github.com/someone/else.git")
        self.assertIn("origin", guard.check(self.clone))
        git("remote", "set-url", "origin", "git@github.com:Mharbulous/probanda-dev.git", cwd=self.clone)
        self.assertIsNone(guard.check(self.clone))

    def test_cwd_is_the_default(self):
        git("clone", "-q", self.shared, self.clone)
        git("remote", "set-url", "origin", ORIGIN, cwd=self.clone)
        here = os.getcwd()
        try:
            os.chdir(self.clone)
            self.assertEqual(guard.main([]), 0)
            os.chdir(self.shared)
            self.assertEqual(guard.main([]), 1)
        finally:
            os.chdir(here)


if __name__ == "__main__":
    unittest.main()
