"""Deliverables are never overwritten (#1174, #1186, workspace output rule from #1168).

When a Word or PDF deliverable's target already exists, Generate, Assemble,
Amend and Render write the first unused "<stem> vN<ext>" sibling instead, leaving the
existing file byte-for-byte unchanged. With no existing target, names are
exactly as before.

Run: python -m pytest source/skills/publish/subskills/publish-bcsc-form/tests/test_versioned_output.py
"""

import json
import subprocess
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest import mock

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))

from steps.shared import render  # noqa: E402
from steps.shared.paths import next_free_path  # noqa: E402

ORIGINAL = b"reviewed, signed or served"
FAKE_PDF = b"%PDF-1.4 << /Type /Pages /Count 1 >>"


class _Tmp(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)


class TestNextFreePath(_Tmp):
    def test_unused_path_is_returned_unchanged(self):
        p = self.root / "Notice of Application.docx"
        self.assertEqual(next_free_path(p), p)

    def test_existing_path_gets_v2(self):
        p = self.root / "Notice of Application.docx"
        p.write_bytes(ORIGINAL)
        self.assertEqual(next_free_path(p),
                         self.root / "Notice of Application v2.docx")

    def test_existing_base_and_v2_gets_v3(self):
        p = self.root / "Notice of Application.docx"
        p.write_bytes(ORIGINAL)
        (self.root / "Notice of Application v2.docx").write_bytes(ORIGINAL)
        self.assertEqual(next_free_path(p),
                         self.root / "Notice of Application v3.docx")


class _WritingFolder(_Tmp):
    def setUp(self):
        super().setUp()
        self.matter = self.root / "L1234 Foo v Bar"
        self.draft = self.matter / "0. DRAFTS" / "NOA Stay"
        self.draft.mkdir(parents=True)
        self.case_data = self.root / "0. CASE DATA" / "L1234 Foo"
        self.case_data.mkdir(parents=True)
        (self.matter / "coclerk.json").write_text(
            json.dumps({"case_data_dir": str(self.case_data)}), encoding="utf-8")

    def run_gen(self):
        import fill_plain
        from steps.gen import fill as gen_fill

        def fake_fill(template, scalars, body, out_path, form=None):
            Path(out_path).write_bytes(b"new fill")

        ctx = {"form_id": "form-32", "scalars": {"title": "Notice of Application"},
               "matter_path": str(self.matter),
               "case_data_folder": str(self.case_data),
               "writing_folder": "NOA Stay"}
        with mock.patch.object(fill_plain, "fill", fake_fill):
            gen_fill.calls_script(ctx)
        return Path(ctx["output_path"])


class TestGenerate(_WritingFolder):
    def test_no_existing_target_keeps_the_name(self):
        self.assertEqual(self.run_gen(), self.draft / "Notice of Application.docx")

    def test_existing_target_writes_v2_and_keeps_the_original(self):
        base = self.draft / "Notice of Application.docx"
        base.write_bytes(ORIGINAL)
        out = self.run_gen()
        self.assertEqual(out, self.draft / "Notice of Application v2.docx")
        self.assertEqual(out.read_bytes(), b"new fill")
        self.assertEqual(base.read_bytes(), ORIGINAL)

    def test_existing_base_and_v2_writes_v3(self):
        base = self.draft / "Notice of Application.docx"
        v2 = self.draft / "Notice of Application v2.docx"
        base.write_bytes(ORIGINAL)
        v2.write_bytes(ORIGINAL)
        self.assertEqual(self.run_gen(),
                         self.draft / "Notice of Application v3.docx")
        self.assertEqual(base.read_bytes(), ORIGINAL)
        self.assertEqual(v2.read_bytes(), ORIGINAL)


class TestAssemble(_WritingFolder):
    """Assemble writes the same {title}.docx that Generate does (#1186)."""

    def run_asm(self):
        import fill_plain
        from steps.asm import fill as asm_fill

        context = self.case_data / "context.json"
        context.write_text(json.dumps({"title": "Notice of Application"}),
                           encoding="utf-8")
        body = self.case_data / "body.md"
        body.write_text("Part 1", encoding="utf-8")

        def fake_fill(template, scalars, body, out_path, form=None):
            Path(out_path).write_bytes(b"assembled")

        ctx = {"form_id": "form-32", "scalars": {"title": "Notice of Application"},
               "matter_path": str(self.matter),
               "writing_folder": "NOA Stay",
               "asm_context_path": str(context), "asm_body_path": str(body)}
        with mock.patch.object(fill_plain, "fill", fake_fill):
            asm_fill.calls_script(ctx)
        return Path(ctx["output_path"])

    def test_no_existing_target_keeps_the_name(self):
        self.assertEqual(self.run_asm(), self.draft / "Notice of Application.docx")

    def test_existing_target_writes_v2_and_keeps_the_original(self):
        base = self.draft / "Notice of Application.docx"
        base.write_bytes(ORIGINAL)
        out = self.run_asm()
        self.assertEqual(out, self.draft / "Notice of Application v2.docx")
        self.assertEqual(out.read_bytes(), b"assembled")
        self.assertEqual(base.read_bytes(), ORIGINAL)

    def test_existing_base_and_v2_writes_v3(self):
        base = self.draft / "Notice of Application.docx"
        v2 = self.draft / "Notice of Application v2.docx"
        base.write_bytes(ORIGINAL)
        v2.write_bytes(ORIGINAL)
        self.assertEqual(self.run_asm(),
                         self.draft / "Notice of Application v3.docx")
        self.assertEqual(base.read_bytes(), ORIGINAL)
        self.assertEqual(v2.read_bytes(), ORIGINAL)

    def test_generate_then_assemble_does_not_halt(self):
        generated = self.run_gen()
        assembled = self.run_asm()
        self.assertEqual(generated, self.draft / "Notice of Application.docx")
        self.assertEqual(assembled, self.draft / "Notice of Application v2.docx")
        self.assertEqual(generated.read_bytes(), b"new fill")
        self.assertEqual(assembled.read_bytes(), b"assembled")


class TestAmend(_Tmp):
    def setUp(self):
        super().setUp()
        self.matter = self.root / "L1234 Foo v Bar"
        self.draft = self.matter / "0. DRAFTS" / "NCC Amend"
        self.draft.mkdir(parents=True)
        self.original = self.root / "Notice of Civil Claim.docx"
        self.original.write_bytes(b"original pleading")
        self.spec = self.root / "amendments.json"
        self.spec.write_text("{}", encoding="utf-8")

    def run_amend(self):
        from steps.amend import run as amend_run

        def fake_run(cmd, **kwargs):
            if "--out" in cmd:
                # amend.py opens each output with ZipFile(..., 'w'), which
                # truncates; model that by overwriting.
                Path(cmd[cmd.index("--out") + 1]).write_bytes(b"marked up")
                Path(cmd[cmd.index("--clean") + 1]).write_bytes(b"clean")
            return subprocess.CompletedProcess(cmd, 0, "", "")

        ctx = {"original_docx_path": str(self.original),
               "amendments_spec_path": str(self.spec),
               "matter_path": str(self.matter),
               "writing_folder": "NCC Amend"}
        with mock.patch.object(amend_run.subprocess, "run", fake_run):
            amend_run.calls_script(ctx)
        return Path(ctx["output_path"]), Path(ctx["clean_path"])

    def test_no_existing_targets_keep_the_names(self):
        out, clean = self.run_amend()
        self.assertEqual(out, self.draft / "Amended Notice of Civil Claim.docx")
        self.assertEqual(
            clean, self.draft / "Amended Notice of Civil Claim (clean).docx")

    def test_existing_targets_are_each_versioned_and_kept(self):
        base = self.draft / "Amended Notice of Civil Claim.docx"
        base_clean = self.draft / "Amended Notice of Civil Claim (clean).docx"
        base.write_bytes(ORIGINAL)
        base_clean.write_bytes(ORIGINAL)
        out, clean = self.run_amend()
        self.assertEqual(out, self.draft / "Amended Notice of Civil Claim v2.docx")
        self.assertEqual(
            clean, self.draft / "Amended Notice of Civil Claim (clean) v2.docx")
        self.assertEqual(out.read_bytes(), b"marked up")
        self.assertEqual(clean.read_bytes(), b"clean")
        self.assertEqual(base.read_bytes(), ORIGINAL)
        self.assertEqual(base_clean.read_bytes(), ORIGINAL)

    def test_marked_up_and_clean_are_versioned_independently(self):
        base = self.draft / "Amended Notice of Civil Claim.docx"
        base.write_bytes(ORIGINAL)
        (self.draft / "Amended Notice of Civil Claim v2.docx").write_bytes(ORIGINAL)
        out, clean = self.run_amend()
        self.assertEqual(out, self.draft / "Amended Notice of Civil Claim v3.docx")
        self.assertEqual(
            clean, self.draft / "Amended Notice of Civil Claim (clean).docx")


class TestRender(_Tmp):
    """Each backend is driven with its renderer faked, writing FAKE_PDF."""

    def setUp(self):
        super().setUp()
        self.docx = self.root / "Notice of Application.docx"
        self.docx.write_bytes(b"docx")

    def _word_com(self):
        def export(path, fmt):
            Path(path).write_bytes(FAKE_PDF)
        doc = mock.Mock()
        doc.ExportAsFixedFormat.side_effect = export
        doc.ComputeStatistics.return_value = 1
        word = mock.Mock()
        word.Documents.Open.return_value = doc
        client = types.ModuleType("win32com.client")
        client.DispatchEx = lambda name: word
        win32com = types.ModuleType("win32com")
        win32com.client = client
        pythoncom = types.ModuleType("pythoncom")
        pythoncom.CoInitialize = pythoncom.CoUninitialize = lambda: None
        return [
            mock.patch.dict(sys.modules, {"win32com": win32com,
                                          "win32com.client": client,
                                          "pythoncom": pythoncom}),
            mock.patch.object(render, "_has_word", lambda: True),
        ]

    def _word_powershell(self):
        def fake_run(cmd, **kwargs):
            Path(kwargs["env"]["COCLERK_RENDER_PDF"]).write_bytes(FAKE_PDF)
            return subprocess.CompletedProcess(cmd, 0, "", "")
        return [
            mock.patch.object(render, "_has_word", lambda: False),
            mock.patch.object(render, "_has_powershell_word", lambda: True),
            mock.patch.object(render.subprocess, "run", fake_run),
        ]

    def _soffice(self):
        def fake_run(cmd, **kwargs):
            outdir = Path(cmd[cmd.index("--outdir") + 1])
            (outdir / (Path(cmd[-1]).stem + ".pdf")).write_bytes(FAKE_PDF)
            return subprocess.CompletedProcess(cmd, 0, "", "")
        return [
            mock.patch.object(render, "_has_word", lambda: False),
            mock.patch.object(render, "_has_powershell_word", lambda: False),
            mock.patch.object(render, "_find_soffice", lambda: "soffice"),
            mock.patch.object(render.subprocess, "run", fake_run),
        ]

    def render_with(self, backend):
        patches = getattr(self, backend)()
        for p in patches:
            p.start()
        try:
            return render.render_to_pdf(self.docx)
        finally:
            for p in reversed(patches):
                p.stop()

    BACKENDS = ("_word_com", "_word_powershell", "_soffice")

    def test_no_existing_pdf_keeps_the_name(self):
        for backend in self.BACKENDS:
            with self.subTest(backend=backend):
                pdf, pages = self.render_with(backend)
                self.assertEqual(pdf, self.docx.with_suffix(".pdf").resolve())
                self.assertEqual(pages, 1)
                pdf.unlink()

    def test_existing_pdf_is_versioned_and_kept(self):
        base = self.root / "Notice of Application.pdf"
        for backend in self.BACKENDS:
            with self.subTest(backend=backend):
                base.write_bytes(ORIGINAL)
                pdf, _ = self.render_with(backend)
                self.assertEqual(
                    pdf, (self.root / "Notice of Application v2.pdf").resolve())
                self.assertEqual(pdf.read_bytes(), FAKE_PDF)
                self.assertEqual(base.read_bytes(), ORIGINAL)
                pdf.unlink()

    def test_existing_base_and_v2_pdf_writes_v3(self):
        base = self.root / "Notice of Application.pdf"
        v2 = self.root / "Notice of Application v2.pdf"
        base.write_bytes(ORIGINAL)
        v2.write_bytes(ORIGINAL)
        for backend in self.BACKENDS:
            with self.subTest(backend=backend):
                pdf, _ = self.render_with(backend)
                self.assertEqual(
                    pdf, (self.root / "Notice of Application v3.pdf").resolve())
                self.assertEqual(base.read_bytes(), ORIGINAL)
                self.assertEqual(v2.read_bytes(), ORIGINAL)
                pdf.unlink()

    def test_versioned_docx_renders_its_own_pdf(self):
        (self.root / "Notice of Application.pdf").write_bytes(ORIGINAL)
        self.docx = self.root / "Notice of Application v2.docx"
        self.docx.write_bytes(b"docx")
        pdf, _ = self.render_with("_soffice")
        self.assertEqual(
            pdf, (self.root / "Notice of Application v2.pdf").resolve())


if __name__ == "__main__":
    unittest.main()
