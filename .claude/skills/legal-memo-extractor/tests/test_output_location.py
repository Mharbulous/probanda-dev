"""Output-location tests for extract_memo_index.py. Stdlib only.

Run from the skill root:
    python -m unittest tests.test_output_location -v
"""
from __future__ import annotations

import io
import json
import os
import sys
import tempfile
import unittest
from contextlib import redirect_stderr
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                os.pardir, "scripts"))

import extract_memo_index as emi  # noqa: E402

CASE_DATA_NAME = "L1234 Smith"


class TempMatter(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.root = Path(self._tmp.name)
        self.matter = self.root / "L1234 Smith v Jones"
        self.case_data = self.root / "0. CASE DATA" / CASE_DATA_NAME
        self.memos = self.matter / "6. LAW" / "memos"
        self.memos.mkdir(parents=True)
        self.case_data.mkdir(parents=True)
        self.write_pointer("..\\0. CASE DATA\\" + CASE_DATA_NAME)

    def write_pointer(self, case_data_dir):
        (self.matter / "coclerk.json").write_text(
            json.dumps({"case_data_dir": case_data_dir}), encoding="utf-8")

    def run_main(self, *extra):
        err = io.StringIO()
        with redirect_stderr(err):
            code = emi.main(["--input-dir", str(self.memos),
                             "--matter-root", str(self.matter), *extra])
        return code, err.getvalue()

    def assert_no_old_folders(self):
        for _root, dirs, _files in os.walk(self.root):
            self.assertNotIn("CoWork", dirs)
            self.assertNotIn("4. LAWYER BRIEF", dirs)


class TestStandardOutputDir(TempMatter):
    def test_is_the_case_data_subfolder_and_creates_nothing(self):
        out = emi.standard_output_dir(self.matter, self.case_data)
        self.assertEqual(out, self.case_data / "legal-memo-extractor")
        self.assertFalse(out.exists())
        self.assert_no_old_folders()

    def test_absolute_windows_case_data_dir_matches_by_last_segment(self):
        self.write_pointer("C:\\Users\\x\\Litigation\\0. CASE DATA\\" + CASE_DATA_NAME)
        out = emi.standard_output_dir(self.matter, self.case_data)
        self.assertEqual(out.parent, self.case_data)

    def test_missing_case_data_folder_raises_and_is_not_created(self):
        self.case_data.rmdir()
        with self.assertRaises(FileNotFoundError) as ctx:
            emi.standard_output_dir(self.matter, self.case_data)
        self.assertIn("/case-data initialize", str(ctx.exception))
        self.assertFalse(self.case_data.exists())

    def test_name_mismatch_raises(self):
        self.write_pointer("..\\0. CASE DATA\\L9999 Other")
        with self.assertRaises(ValueError) as ctx:
            emi.standard_output_dir(self.matter, self.case_data)
        self.assertIn("case_data_dir", str(ctx.exception))

    def test_nul_padded_pointer_is_read(self):
        body = json.dumps({"case_data_dir": "..\\0. CASE DATA\\" + CASE_DATA_NAME})
        (self.matter / "coclerk.json").write_bytes(
            b"\x00\x00" + body.encode("utf-8") + b"\x00" * 16)
        out = emi.standard_output_dir(self.matter, self.case_data)
        self.assertEqual(out, self.case_data / "legal-memo-extractor")

    def test_case_only_name_difference_is_accepted(self):
        self.write_pointer("..\\0. CASE DATA\\" + CASE_DATA_NAME.upper())
        out = emi.standard_output_dir(self.matter, self.case_data)
        self.assertEqual(out, self.case_data / "legal-memo-extractor")

    def test_missing_pointer_raises(self):
        (self.matter / "coclerk.json").unlink()
        with self.assertRaises(FileNotFoundError):
            emi.standard_output_dir(self.matter, self.case_data)


class TestMainOutputResolution(TempMatter):
    def test_without_case_data_folder_refuses(self):
        code, err = self.run_main()
        self.assertEqual(code, 2)
        self.assertIn("--case-data-folder", err)
        self.assert_no_old_folders()

    def test_mismatched_case_data_folder_refuses_before_parsing(self):
        other = self.root / "0. CASE DATA" / "L9999 Other"
        other.mkdir()
        code, err = self.run_main("--case-data-folder", str(other))
        self.assertEqual(code, 2)
        self.assertIn("does not match", err)
        self.assertEqual(list(other.iterdir()), [])
        self.assert_no_old_folders()

    def test_valid_case_data_folder_passes_resolution(self):
        # An empty memo folder stops after output resolution, with nothing written.
        with redirect_stderr(io.StringIO()):
            code = emi.main(["--input-dir", str(self.memos),
                             "--matter-root", str(self.matter),
                             "--case-data-folder", str(self.case_data)])
        self.assertEqual(code, 1)
        self.assertEqual(list(self.case_data.iterdir()), [])
        self.assert_no_old_folders()


if __name__ == "__main__":
    unittest.main()
