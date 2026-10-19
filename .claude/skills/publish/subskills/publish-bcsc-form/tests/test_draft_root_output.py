"""An individual form's .docx goes at the draft folder's root (#1324).

A deliverable-writing step takes exactly one of writing_folder (a package:
Form 32 or 33, or an affidavit sworn for one) and out_name (an individual
form). With out_name, Generate, Assemble and Amend write "<out_name>.docx" at
the root of the one 0. DRAFT* folder, create no folder, and give a taken name
the next " vN" (highest + 1), reporting the copy passed over as versioned_from.
The package path is covered by test_versioned_output.py and
test_asm32_generate_context.py, unchanged.

Run: python -m pytest .claude/skills/publish/subskills/publish-bcsc-form/tests/test_draft_root_output.py -q
"""

import contextlib
import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))

from steps.shared import paths  # noqa: E402

STEM = "2026-10-01 REQ Default judgment"
ORIGINAL = b"reviewed, signed or served"


def fake_fill(written):
    def fill(template, scalars, body, out_path, form=None):
        Path(out_path).write_bytes(written)
    return fill


class _Matter(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        self.matter = self.root / "L1234 Foo v Bar"
        self.draft = self.matter / "0. DRAFTS"
        self.draft.mkdir(parents=True)
        self.case_data = self.root / "0. CASE DATA" / "L1234 Foo"
        self.case_data.mkdir(parents=True)
        (self.matter / "coclerk.json").write_text(
            json.dumps({"case_data_dir": str(self.case_data)}), encoding="utf-8")

    def ctx(self, **extra):
        ctx = {"form_id": "form-17", "scalars": {"title": "Requisition"},
               "matter_path": str(self.matter),
               "case_data_folder": str(self.case_data)}
        ctx.update(extra)
        return ctx

    def run_gen(self, **extra):
        import fill_plain
        from steps.gen import fill as gen_fill
        ctx = self.ctx(**extra)
        with mock.patch.object(fill_plain, "fill", fake_fill(b"new fill")):
            gen_fill.calls_script(ctx)
        return ctx

    def draft_entries(self):
        return sorted(p.name for p in self.draft.iterdir())


class TestGenerate(_Matter):
    def test_writes_the_stem_at_the_draft_root_and_creates_no_folder(self):
        ctx = self.run_gen(out_name=STEM)
        out = self.draft / f"{STEM}.docx"
        self.assertEqual(Path(ctx["output_path"]), out)
        self.assertEqual(out.read_bytes(), b"new fill")
        self.assertIsNone(ctx.get("versioned_from"))
        self.assertEqual(self.draft_entries(), [f"{STEM}.docx"])

    def test_a_taken_name_gets_the_next_version_and_reports_the_one_passed_over(self):
        first = self.draft / f"{STEM}.docx"
        first.write_bytes(ORIGINAL)
        ctx = self.run_gen(out_name=STEM)
        v2 = self.draft / f"{STEM} v2.docx"
        self.assertEqual(Path(ctx["output_path"]), v2)
        self.assertEqual(ctx["versioned_from"], str(first))
        self.assertEqual(first.read_bytes(), ORIGINAL)

        ctx = self.run_gen(out_name=STEM)
        self.assertEqual(Path(ctx["output_path"]), self.draft / f"{STEM} v3.docx")
        self.assertEqual(ctx["versioned_from"], str(v2))
        self.assertEqual(v2.read_bytes(), b"new fill")

    def test_the_highest_version_counts_not_the_first_gap(self):
        v4 = self.draft / f"{STEM} v4.docx"
        v4.write_bytes(ORIGINAL)
        ctx = self.run_gen(out_name=STEM)
        self.assertEqual(Path(ctx["output_path"]), self.draft / f"{STEM} v5.docx")
        self.assertEqual(ctx["versioned_from"], str(v4))

    def test_a_bad_stem_is_refused_and_nothing_is_written(self):
        for stem in ("  ", "a/b", "a\\b", "C:x", "a*b", "a?b", 'a"b', "a<b",
                     "a>b", "a|b", "x.docx", "x.doc", "x.PDF", f"{STEM} v2"):
            with self.subTest(stem=stem):
                with self.assertRaisesRegex(RuntimeError, "--out-name"):
                    self.run_gen(out_name=stem)
        self.assertEqual(self.draft_entries(), [])

    def test_both_targets_are_refused(self):
        with self.assertRaisesRegex(RuntimeError, "not both"):
            self.run_gen(out_name=STEM, writing_folder="REQ Default judgment")
        self.assertEqual(self.draft_entries(), [])

    def test_neither_target_is_refused(self):
        with self.assertRaisesRegex(RuntimeError, "Neither"):
            self.run_gen(writing_folder="", out_name="")
        self.assertEqual(self.draft_entries(), [])

    def test_a_failed_fill_leaves_no_temporary_or_partial_file(self):
        import fill_plain
        from steps.gen import fill as gen_fill

        def failing_fill(template, scalars, body, out_path, form=None):
            Path(out_path).write_bytes(b"partial")
            raise ValueError("template broke")

        with mock.patch.object(fill_plain, "fill", failing_fill), \
                self.assertRaisesRegex(ValueError, "template broke"):
            gen_fill.calls_script(self.ctx(out_name=STEM))
        self.assertEqual(self.draft_entries(), [])

    def test_a_name_taken_during_the_fill_is_not_overwritten(self):
        target = self.draft / f"{STEM}.docx"
        real = paths._next_version

        def racing(folder, stem, suffix):
            path, prior = real(folder, stem, suffix)
            path.write_bytes(ORIGINAL)  # another writer takes the name first
            return path, prior

        with mock.patch.object(paths, "_next_version", racing), \
                self.assertRaisesRegex(RuntimeError, "Not overwriting"):
            self.run_gen(out_name=STEM)
        self.assertEqual(target.read_bytes(), ORIGINAL)
        self.assertEqual(self.draft_entries(), [f"{STEM}.docx"])


class TestAssemble(_Matter):
    def run_asm(self, **extra):
        import fill_plain
        from steps.asm import fill as asm_fill
        context = self.case_data / "context.json"
        context.write_text(json.dumps({"title": "Notice of Civil Claim"}),
                           encoding="utf-8")
        body = self.case_data / "body.md"
        body.write_text("Part 1", encoding="utf-8")
        ctx = self.ctx(form_id="form-1", asm_context_path=str(context),
                       asm_body_path=str(body), **extra)
        with mock.patch.object(fill_plain, "fill", fake_fill(b"assembled")):
            asm_fill.calls_script(ctx)
        return ctx

    def test_assemble_writes_the_stem_at_the_draft_root(self):
        ctx = self.run_asm(out_name=STEM)
        self.assertEqual(Path(ctx["output_path"]), self.draft / f"{STEM}.docx")
        self.assertEqual(self.draft_entries(), [f"{STEM}.docx"])

    def test_generate_then_assemble_versions_one_series(self):
        generated = self.run_gen(form_id="form-1", out_name=STEM)
        assembled = self.run_asm(out_name=STEM)
        self.assertEqual(Path(assembled["output_path"]),
                         self.draft / f"{STEM} v2.docx")
        self.assertEqual(assembled["versioned_from"], generated["output_path"])
        self.assertEqual(
            Path(generated["output_path"]).read_bytes(), b"new fill")


class TestPackages(_Matter):
    def test_form_32_and_33_assemblies_refuse_out_name(self):
        import fill_plain
        from steps.asm32 import fill as asm32_fill
        from steps.asm33 import fill as asm33_fill
        context = self.case_data / "context.json"
        context.write_text(json.dumps({"title": "Stay Application"}),
                           encoding="utf-8")
        body = self.case_data / "body.txt"
        body.write_text("=== PART 1: ORDER(S) SOUGHT ===\ncosts\n", encoding="utf-8")
        for name, step in (("asm32", asm32_fill), ("asm33", asm33_fill)):
            for extra in ({"out_name": STEM},
                          {"out_name": STEM, "writing_folder": "NOA Stay"}):
                with self.subTest(step=name, **extra):
                    ctx = self.ctx(form_id=None, **extra, **{
                        f"{name}_context_path": str(context),
                        f"{name}_body_path": str(body)})
                    if name == "asm33":
                        ctx["scalars"] = None
                    with mock.patch.object(fill_plain, "fill", fake_fill(b"x")), \
                            self.assertRaisesRegex(RuntimeError, "--writing-folder"):
                        step.calls_script(ctx)
        self.assertEqual(self.draft_entries(), [])


class TestAmend(_Matter):
    def run_amend(self, **extra):
        from steps.amend import run as amend_run
        original = self.case_data / "Notice of Civil Claim.docx"
        original.write_bytes(b"original pleading")
        spec = self.case_data / "amendments.json"
        spec.write_text("{}", encoding="utf-8")

        def fake_run(cmd, **kwargs):
            if "--out" in cmd:
                Path(cmd[cmd.index("--out") + 1]).write_bytes(b"marked up")
                Path(cmd[cmd.index("--clean") + 1]).write_bytes(b"clean")
            return subprocess.CompletedProcess(cmd, 0, "", "")

        ctx = {"original_docx_path": str(original),
               "amendments_spec_path": str(spec),
               "matter_path": str(self.matter), **extra}
        with mock.patch.object(amend_run.subprocess, "run", fake_run):
            amend_run.calls_script(ctx)
        return ctx

    def test_amend_writes_both_copies_at_the_draft_root(self):
        ctx = self.run_amend(out_name=STEM)
        out = self.draft / f"{STEM}.docx"
        clean = self.draft / f"{STEM} (clean).docx"
        self.assertEqual(Path(ctx["output_path"]), out)
        self.assertEqual(Path(ctx["clean_path"]), clean)
        self.assertEqual(out.read_bytes(), b"marked up")
        self.assertEqual(clean.read_bytes(), b"clean")
        self.assertEqual(self.draft_entries(), sorted([out.name, clean.name]))

    def test_each_copy_is_versioned_in_its_own_series(self):
        v2 = self.draft / f"{STEM} v2.docx"
        clean = self.draft / f"{STEM} (clean).docx"
        for p in (self.draft / f"{STEM}.docx", v2, clean):
            p.write_bytes(ORIGINAL)
        ctx = self.run_amend(out_name=STEM)
        self.assertEqual(Path(ctx["output_path"]), self.draft / f"{STEM} v3.docx")
        self.assertEqual(ctx["versioned_from"], str(v2))
        self.assertEqual(Path(ctx["clean_path"]),
                         self.draft / f"{STEM} v2 (clean).docx")
        self.assertEqual(ctx["clean_versioned_from"], str(clean))
        self.assertEqual(clean.read_bytes(), ORIGINAL)


class TestHarness(_Matter):
    def setUp(self):
        super().setUp()
        sessions = tempfile.TemporaryDirectory()
        self.addCleanup(sessions.cleanup)
        with mock.patch.dict(os.environ, {"DRAFT_BCSC_SESSIONS_DIR": sessions.name}):
            import importlib
            import harness
            self.harness = importlib.reload(harness)

    def test_init_stores_out_name_in_the_session(self):
        argv = ["harness.py", "init", "Generate a Form 17",
                "--matter-path", str(self.matter),
                "--matter-data-folder", str(self.case_data),
                "--out-name", STEM]
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
        self.assertEqual(ctx["out_name"], STEM)
        self.assertEqual(ctx["writing_folder"], "")

    def test_completion_reports_the_copies_passed_over(self):
        self.harness.load_all_steps()
        docx = self.draft / f"{STEM} v2.docx"
        docx.write_bytes(b"x")
        ctx = self.harness.new_ctx("Generate a Form 17")
        ctx.update(sequence="generate", step_index=3, current_step="shared.verify",
                   output_path=str(docx),
                   versioned_from=str(self.draft / f"{STEM}.docx"),
                   clean_versioned_from=str(self.draft / f"{STEM} (clean).docx"))
        self.harness.save_ctx(ctx)
        done = self.harness.cmd_step(
            ctx["session_id"],
            json.dumps({"passed": True, "warnings": [], "summary": "ok"}))
        self.assertEqual(done["action"], "done")
        self.assertEqual(done["versioned_from"], str(self.draft / f"{STEM}.docx"))
        self.assertEqual(done["clean_versioned_from"],
                         str(self.draft / f"{STEM} (clean).docx"))


if __name__ == "__main__":
    unittest.main()
