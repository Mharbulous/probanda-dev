#!/usr/bin/env python3
"""
check_publishable's --new-since comparison: a change fails only for a problem its base lacks.

Run: python -m pytest -q scripts/tests/test_check_publishable.py
"""

import importlib.util
import os
import unittest
from pathlib import Path, PurePosixPath

SCRIPTS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_spec = importlib.util.spec_from_file_location("check_publishable", os.path.join(SCRIPTS, "check_publishable.py"))
check_publishable = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(check_publishable)

# Built from parts so this file holds no line the scan itself reports.
DDL_A = "CREATE" + " TABLE a (id)"
DDL_B = "CREATE" + " TABLE b (id)"


def problems(files):
    found = []
    for name, text in files.items():
        found += check_publishable.file_problems(PurePosixPath(name), text.encode("utf-8"))
    return found


class NewProblemsTest(unittest.TestCase):
    def new(self, base, head):
        return [(str(p[0]), p[1], p[2]) for p in check_publishable.new_problems(problems(base), problems(head))]

    def test_unchanged_problems_are_not_new(self):
        files = {"a.md": f"x\n{DDL_A}\n"}
        self.assertEqual(self.new(files, files), [])

    def test_added_line_is_new(self):
        self.assertEqual(self.new({"a.md": f"{DDL_A}\n"}, {"a.md": f"{DDL_A}\n{DDL_B}\n"}),
                         [("a.md", 2, "contains schema DDL")])

    def test_second_copy_of_an_existing_line_is_new(self):
        self.assertEqual(self.new({"a.md": f"{DDL_A}\n"}, {"a.md": f"{DDL_A}\n", "b.md": f"{DDL_A}\n"}),
                         [("b.md", 1, "contains schema DDL")])

    def test_line_moved_within_a_file_is_not_new(self):
        self.assertEqual(self.new({"a.md": f"{DDL_A}\nx\n"}, {"a.md": f"x\ny\n  {DDL_A}\r\n"}), [])

    def test_renamed_file_is_not_new(self):
        self.assertEqual(self.new({"a.md": f"{DDL_A}\n", "s.sql": "x"}, {"b.md": f"{DDL_A}\n", "t.sql": "x"}), [])

    def test_edited_problem_line_is_new(self):
        self.assertEqual(self.new({"a.md": f"{DDL_A}\n"}, {"a.md": f"{DDL_B}\n"}),
                         [("a.md", 1, "contains schema DDL")])

    def test_forbidden_file_with_other_bytes_is_new(self):
        self.assertEqual(self.new({"s.sql": "x"}, {"t.sql": "y"}), [("t.sql", 1, "forbidden file type")])

    def test_removed_problem_is_not_new(self):
        self.assertEqual(self.new({"a.md": f"{DDL_A}\n{DDL_B}\n"}, {"a.md": f"{DDL_B}\n"}), [])

    def test_head_commit_matches_a_clean_worktree(self):
        root = os.path.dirname(SCRIPTS)
        if check_publishable.git(root, "status", "--porcelain", "--untracked-files=no"):
            self.skipTest("tracked files differ from HEAD")
        _, worktree = check_publishable.worktree_problems(Path(root))
        self.assertEqual(check_publishable.new_problems(check_publishable.commit_problems(root, "HEAD"), worktree), [])


class RulingsTest(unittest.TestCase):
    RULINGS = [{"store": "s", "hop": "1 -> 2", "date": "2026-10-29", "ruling": "r",
                "problems": [{"message": "contains schema DDL", "content": DDL_A}]}]

    def new(self, base, head):
        found = check_publishable.new_problems(problems(base), problems(head))
        return [(str(p[0]), p[1], p[2]) for p in check_publishable.unruled(found, self.RULINGS)]

    def test_ruled_problem_is_not_new(self):
        self.assertEqual(self.new({"a.md": "x\n"}, {"a.md": f"x\n{DDL_A}\n"}), [])

    def test_unruled_problem_is_new(self):
        self.assertEqual(self.new({"a.md": "x\n"}, {"a.md": f"x\n{DDL_B}\n"}),
                         [("a.md", 2, "contains schema DDL")])

    def test_one_ruling_covers_the_source_and_its_built_copy(self):
        head = {"src/m.md": f"{DDL_A}\n", "plugins/p/m.md": f"{DDL_A}\n"}
        self.assertEqual(self.new({}, head), [])


class CloudFolderTest(unittest.TestCase):
    def messages(self, name, text, scan):
        return [p[2] for p in scan(PurePosixPath(name), text.encode("utf-8"))]

    def test_schema_file_under_cloud_is_not_reported_by_the_repo_scan(self):
        self.assertEqual(self.messages("cloud/pool/schema.sql", f"{DDL_A}\n", check_publishable.repo_file_problems), [])

    def test_schema_file_elsewhere_is_still_reported_by_the_repo_scan(self):
        self.assertEqual(self.messages("docs/schema.sql", f"{DDL_A}\n", check_publishable.repo_file_problems),
                         ["forbidden file type", "contains schema DDL"])

    def test_other_problems_under_cloud_are_still_reported(self):
        machine_path = "C:" + "\\Users\\someone\\pool"
        self.assertEqual(self.messages("cloud/pool/notes.md", f"{machine_path}\n", check_publishable.repo_file_problems),
                         ["contains a path from a maintainer's machine"])
        self.assertEqual(self.messages("cloud/pool/secret.env", "x\n", check_publishable.repo_file_problems),
                         ["forbidden file type"])

    def test_published_files_get_no_cloud_exception(self):
        self.assertEqual(self.messages("cloud/pool/schema.sql", f"{DDL_A}\n", check_publishable.file_problems),
                         ["forbidden file type", "contains schema DDL"])


if __name__ == "__main__":
    unittest.main()
