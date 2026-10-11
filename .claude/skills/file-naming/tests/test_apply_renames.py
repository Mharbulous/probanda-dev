"""apply_renames.py swaps and chains names safely, all or nothing (#1390)."""

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
SCRIPT = SCRIPTS / "apply_renames.py"
sys.path.insert(0, str(SCRIPTS))

import apply_renames  # noqa: E402


class ApplyRenamesTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)
        self.dir = self.tmp / "folder"
        self.dir.mkdir()

    def tearDown(self):
        self._tmp.cleanup()

    def file(self, name, content=None):
        path = self.dir / name
        path.write_text(content if content is not None else name, encoding="utf-8")
        return path

    def pairs(self, *names, folder=None):
        folder = folder or self.dir
        return [{"src": str(folder / a), "dst": str(folder / b)} for a, b in names]

    def apply(self, renames, expected_total=None):
        manifest = self.tmp / "manifest.json"
        manifest.write_text(json.dumps({
            "expected_total": len(renames) if expected_total is None else expected_total,
            "renames": renames}), encoding="utf-8")
        return subprocess.run([sys.executable, "-B", str(SCRIPT), str(manifest)],
                              capture_output=True, text=True)

    def listing(self):
        return sorted(os.listdir(self.dir))

    def assertNoStaging(self):
        self.assertFalse([n for n in self.listing() if ".swaptmp." in n], self.listing())

    def test_swap_two_folders(self):
        for name in ("AFF#1 ChenM", "AFF#2 LeeK"):
            (self.dir / name).mkdir()
            (self.dir / name / "draft.docx").write_text(name, encoding="utf-8")
        proc = self.apply(self.pairs(("AFF#1 ChenM", "AFF#2 LeeK"),
                                     ("AFF#2 LeeK", "AFF#1 ChenM")))
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual((self.dir / "AFF#2 LeeK" / "draft.docx").read_text(), "AFF#1 ChenM")
        self.assertEqual((self.dir / "AFF#1 ChenM" / "draft.docx").read_text(), "AFF#2 LeeK")
        self.assertNoStaging()

    def test_swap_two_files(self):
        self.file("a.txt")
        self.file("b.txt")
        proc = self.apply(self.pairs(("a.txt", "b.txt"), ("b.txt", "a.txt")))
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual((self.dir / "b.txt").read_text(), "a.txt")
        self.assertEqual((self.dir / "a.txt").read_text(), "b.txt")
        self.assertEqual(self.listing(), ["a.txt", "b.txt"])

    def test_three_element_chain(self):
        for name in ("a.txt", "b.txt", "c.txt"):
            self.file(name)
        proc = self.apply(self.pairs(("a.txt", "b.txt"), ("b.txt", "c.txt"), ("c.txt", "d.txt")))
        self.assertEqual(proc.returncode, 0, proc.stderr)
        for name, content in (("b.txt", "a.txt"), ("c.txt", "b.txt"), ("d.txt", "c.txt")):
            self.assertEqual((self.dir / name).read_text(), content)
        self.assertEqual(self.listing(), ["b.txt", "c.txt", "d.txt"])

    def test_rejects_existing_dst_that_is_not_a_source(self):
        self.file("a.txt")
        self.file("b.txt")
        proc = self.apply(self.pairs(("a.txt", "b.txt")))
        self.assertEqual(proc.returncode, 1)
        self.assertIn("destination already exists", proc.stderr)
        self.assertEqual((self.dir / "a.txt").read_text(), "a.txt")

    def test_rejects_cross_folder_pair(self):
        self.file("a.txt")
        other = self.tmp / "other"
        other.mkdir()
        proc = self.apply([{"src": str(self.dir / "a.txt"), "dst": str(other / "a.txt")}])
        self.assertEqual(proc.returncode, 1)
        self.assertIn("not an in-place rename", proc.stderr)
        self.assertEqual(self.listing(), ["a.txt"])

    def test_rejects_count_mismatch(self):
        self.file("a.txt")
        proc = self.apply(self.pairs(("a.txt", "b.txt")), expected_total=2)
        self.assertEqual(proc.returncode, 1)
        self.assertIn("expected_total", proc.stderr)
        self.assertEqual(self.listing(), ["a.txt"])

    def test_rejects_duplicate_dst(self):
        self.file("a.txt")
        self.file("b.txt")
        proc = self.apply(self.pairs(("a.txt", "c.txt"), ("b.txt", "C.txt")))
        self.assertEqual(proc.returncode, 1)
        self.assertIn("destination", proc.stderr)
        self.assertEqual(self.listing(), ["a.txt", "b.txt"])

    def test_rejects_duplicate_src(self):
        self.file("a.txt")
        proc = self.apply(self.pairs(("a.txt", "b.txt"), ("a.txt", "c.txt")))
        self.assertEqual(proc.returncode, 1)
        self.assertIn("source", proc.stderr)
        self.assertEqual(self.listing(), ["a.txt"])

    def test_case_only_rename(self):
        self.file("lower.txt")
        proc = self.apply(self.pairs(("lower.txt", "LOWER.txt")))
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(self.listing(), ["LOWER.txt"])

    def test_rollback_restores_every_source(self):
        real_rename = os.rename
        # Two pairs: calls 1-2 stage. Three pairs: calls 1-3 stage. Failing on a
        # later call exercises the pass-2 undo as well as the restore.
        for names, fail_on in (((("a.txt", "b.txt"), ("b.txt", "a.txt")), 2),
                               ((("a.txt", "b.txt"), ("b.txt", "a.txt")), 3),
                               ((("a.txt", "b.txt"), ("b.txt", "c.txt"), ("c.txt", "d.txt")), 5)):
            with self.subTest(fail_on=fail_on, pairs=len(names)):
                for src, _ in names:
                    self.file(src)
                calls = []

                def flaky(src, dst):
                    calls.append(src)
                    if len(calls) == fail_on:
                        raise OSError("injected failure")
                    real_rename(src, dst)

                with mock.patch.object(apply_renames.os, "rename", side_effect=flaky):
                    error = apply_renames.two_pass(self.pairs(*names))
                self.assertIn("injected failure", error)
                self.assertEqual(self.listing(), sorted(src for src, _ in names))
                for src, _ in names:
                    self.assertEqual((self.dir / src).read_text(), src)
                self.assertNoStaging()
                for name in self.listing():
                    (self.dir / name).unlink()


if __name__ == "__main__":
    unittest.main()
