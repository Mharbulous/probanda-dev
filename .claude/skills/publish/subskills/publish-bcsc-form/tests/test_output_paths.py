"""Output paths under the workspace output rule (#1168).

Working files go to <case-data folder>/<workflow>/, the case-data folder being
the path the caller passes, checked against coclerk.json's case_data_dir. Final
documents go to <the one 0. DRAFT* folder>/<Writing folder>/. Nothing creates
a lawyer-brief or CoWork folder.

Run: python -m pytest .claude/skills/publish/subskills/publish-bcsc-form/tests/test_output_paths.py
"""

import contextlib
import io
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))

from steps.shared.paths import (  # noqa: E402
    SUBSTANCE_WORKFLOW,
    case_data_output_dir,
    writing_output_dir,
)

WINDOWS_CASE_DATA_DIR = "C:\\Users\\someone\\Firm\\0. CASE DATA\\L1234 Foo\\"


class _MatterFixture(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        self.matter = self.root / "Litigation" / "L1234 Foo v Bar"
        (self.matter / "0. DRAFTS").mkdir(parents=True)
        self.case_data = self.root / "0. CASE DATA" / "L1234 Foo"
        self.case_data.mkdir(parents=True)
        self.write_pointer(WINDOWS_CASE_DATA_DIR)

    def write_pointer(self, case_data_dir):
        (self.matter / "coclerk.json").write_text(
            json.dumps({"case_data_dir": case_data_dir}), encoding="utf-8")

    def assert_no_legacy_folders(self):
        created = [p for p in self.root.rglob("*") if p.is_dir() and (
            p.name.casefold() == "cowork" or "lawyer brief" in p.name.casefold())]
        self.assertEqual(created, [])


class TestCaseDataOutputDir(_MatterFixture):
    def test_workflow_folder_is_created_under_the_case_data_folder(self):
        d = case_data_output_dir(self.matter, self.case_data, SUBSTANCE_WORKFLOW)
        self.assertEqual(d, self.case_data / SUBSTANCE_WORKFLOW)
        self.assertTrue(d.is_dir())
        self.assert_no_legacy_folders()

    def test_missing_case_data_folder_fails_and_is_not_created(self):
        missing = self.root / "0. CASE DATA" / "L9999 Nobody"
        with self.assertRaisesRegex(RuntimeError, "/matter-data initialize"):
            case_data_output_dir(self.matter, missing, SUBSTANCE_WORKFLOW)
        self.assertFalse(missing.exists())

    def test_unset_case_data_folder_fails_naming_the_init_option(self):
        with self.assertRaisesRegex(RuntimeError, "--case-data-folder"):
            case_data_output_dir(self.matter, "", SUBSTANCE_WORKFLOW)

    def test_folder_named_differently_from_case_data_dir_fails(self):
        other = self.root / "0. CASE DATA" / "L5678 Other"
        other.mkdir()
        with self.assertRaisesRegex(RuntimeError, "L1234 Foo"):
            case_data_output_dir(self.matter, other, SUBSTANCE_WORKFLOW)
        self.assertFalse((other / SUBSTANCE_WORKFLOW).exists())

    def test_windows_case_data_dir_matches_a_posix_style_path(self):
        # The pointer holds a Windows path; the script is handed the path it
        # sees, here in forward-slash form as in Cowork's Linux sandbox.
        d = case_data_output_dir(
            self.matter, self.case_data.as_posix(), SUBSTANCE_WORKFLOW)
        self.assertEqual(d, self.case_data / SUBSTANCE_WORKFLOW)

    def test_sandbox_style_case_data_dir_matches(self):
        self.write_pointer("/sessions/abc/mnt/0. CASE DATA/L1234 Foo")
        d = case_data_output_dir(self.matter, self.case_data, SUBSTANCE_WORKFLOW)
        self.assertEqual(d, self.case_data / SUBSTANCE_WORKFLOW)

    def test_nul_padded_pointer_is_read(self):
        body = json.dumps({"case_data_dir": WINDOWS_CASE_DATA_DIR}).encode("utf-8")
        (self.matter / "coclerk.json").write_bytes(b"\x00\x00" + body + b"\x00" * 16)
        d = case_data_output_dir(self.matter, self.case_data, SUBSTANCE_WORKFLOW)
        self.assertEqual(d, self.case_data / SUBSTANCE_WORKFLOW)

    def test_case_only_name_difference_is_accepted(self):
        self.write_pointer("C:\\Users\\someone\\Firm\\0. CASE DATA\\l1234 FOO")
        d = case_data_output_dir(self.matter, self.case_data, SUBSTANCE_WORKFLOW)
        self.assertEqual(d, self.case_data / SUBSTANCE_WORKFLOW)

    def test_matter_without_coclerk_json_fails(self):
        (self.matter / "coclerk.json").unlink()
        with self.assertRaisesRegex(RuntimeError, "/matter-data initialize"):
            case_data_output_dir(self.matter, self.case_data, SUBSTANCE_WORKFLOW)


class TestWritingOutputDir(_MatterFixture):
    def test_writing_folder_is_created_under_the_one_draft_folder(self):
        d = writing_output_dir(self.matter, "2026-10-01 NOA Stay application")
        self.assertEqual(
            d, self.matter / "0. DRAFTS" / "2026-10-01 NOA Stay application")
        self.assertTrue(d.is_dir())
        self.assert_no_legacy_folders()

    def test_writing_folder_name_must_be_one_segment(self):
        for name in ("", ".", "..", "a/b", "a\\b", "../escape", "C:x"):
            with self.subTest(name=name):
                with self.assertRaisesRegex(RuntimeError, "one path segment"):
                    writing_output_dir(self.matter, name)
        self.assertEqual(list((self.matter / "0. DRAFTS").iterdir()), [])

    def test_missing_draft_folder_fails_and_is_not_created(self):
        (self.matter / "0. DRAFTS").rmdir()
        with self.assertRaisesRegex(RuntimeError, "No draft folder"):
            writing_output_dir(self.matter, "NOA Stay application")
        self.assertEqual(list(self.matter.glob("0. DRAFT*")), [])

    def test_two_draft_folders_fail_as_ambiguous(self):
        (self.matter / "0. DRAFT").mkdir()
        with self.assertRaisesRegex(RuntimeError, "Ambiguous draft folder"):
            writing_output_dir(self.matter, "NOA Stay application")


class TestSessionCarriesTheFolders(_MatterFixture):
    def setUp(self):
        super().setUp()
        sessions = tempfile.TemporaryDirectory()
        self.addCleanup(sessions.cleanup)
        with mock.patch.dict(os.environ, {"DRAFT_BCSC_SESSIONS_DIR": sessions.name}):
            import importlib
            import harness
            self.harness = importlib.reload(harness)

    def test_init_cli_stores_the_folders_in_the_session(self):
        argv = ["harness.py", "init", "Generate a Form 17",
                "--matter-path", str(self.matter),
                "--case-data-folder", str(self.case_data),
                "--writing-folder", "REQ Default judgment"]
        out = io.StringIO()
        cwd = os.getcwd()
        try:
            with mock.patch.object(sys, "argv", argv), \
                    contextlib.redirect_stdout(out), \
                    self.assertRaises(SystemExit):
                self.harness.main()
        finally:
            os.chdir(cwd)
        ctx = self.harness.load_ctx(json.loads(out.getvalue())["session_id"])
        self.assertEqual(ctx["matter_path"], str(self.matter))
        self.assertEqual(ctx["case_data_folder"], str(self.case_data))
        self.assertEqual(ctx["writing_folder"], "REQ Default judgment")

    def test_steps_resolve_the_substance_folder_from_the_session(self):
        from steps.asm import locate_inputs
        from steps.draft import part1
        ctx = {"matter_path": str(self.matter),
               "case_data_folder": str(self.case_data)}
        expected = self.case_data / SUBSTANCE_WORKFLOW
        self.assertEqual(locate_inputs._draft_dir(ctx), expected)
        self.assertEqual(part1._draft_dir(ctx), expected)
        self.assert_no_legacy_folders()

    def test_generate_completion_names_the_context_file(self):
        """The done payload carries gen.fill's context.json path (#1240)."""
        self.harness.load_all_steps()
        docx = self.matter / "out.docx"
        docx.write_bytes(b"x")
        context = self.case_data / SUBSTANCE_WORKFLOW / "context.json"
        ctx = self.harness.new_ctx("Generate a Form 32")
        ctx.update(sequence="generate", step_index=3, current_step="shared.verify",
                   output_path=str(docx), context_path=str(context))
        self.harness.save_ctx(ctx)
        done = self.harness.cmd_step(
            ctx["session_id"],
            json.dumps({"passed": True, "warnings": [], "summary": "ok"}))
        self.assertEqual(done["action"], "done")
        self.assertEqual(done["context_path"], str(context))


if __name__ == "__main__":
    unittest.main()
