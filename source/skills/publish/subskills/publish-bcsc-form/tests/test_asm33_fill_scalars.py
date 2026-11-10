"""asm33.fill runs with no session scalars (#1341).

A fresh harness session starts with scalars None, and the asm33 sequence
never runs gen.scalars, so asm33.fill names the .docx from the asm33
context's title, or the form-33 registry name when it has none. The shared
asm.fill treats None scalars as empty for every caller.

Run: python -m pytest source/skills/publish/subskills/publish-bcsc-form/tests/test_asm33_fill_scalars.py -q
"""

import io
import json
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest import mock

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))

from steps.asm import fill as asm_fill  # noqa: E402
from steps.asm33 import fill as asm33_fill  # noqa: E402


def _minimal_docx() -> bytes:
    """A .docx of one paragraph and no placeholder, which asm33.fill's residual scan can read."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("[Content_Types].xml",
                   '<?xml version="1.0" encoding="UTF-8"?>'
                   '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                   '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
                   '<Default Extension="xml" ContentType="application/xml"/>'
                   '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-'
                   'officedocument.wordprocessingml.document.main+xml"/></Types>')
        z.writestr("_rels/.rels",
                   '<?xml version="1.0" encoding="UTF-8"?>'
                   '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                   '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/'
                   'relationships/officeDocument" Target="word/document.xml"/></Relationships>')
        z.writestr("word/document.xml",
                   '<?xml version="1.0" encoding="UTF-8"?>'
                   '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
                   '<w:body><w:p><w:r><w:t>assembled</w:t></w:r></w:p></w:body></w:document>')
    return buf.getvalue()


MINIMAL_DOCX = _minimal_docx()


def fake_fill(template, scalars, body, out_path, form=None):
    Path(out_path).write_bytes(MINIMAL_DOCX)


def fake_render(out):
    return Path(out).with_suffix(".pdf"), 1


class _Asm33Matter(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        root = Path(tmp.name)
        self.matter = root / "L1234 Foo v Bar"
        self.draft = self.matter / "0. DRAFTS" / "NOA Stay"
        self.draft.mkdir(parents=True)
        self.case_data = root / "0. CASE DATA" / "L1234 Foo"
        self.case_data.mkdir(parents=True)
        (self.matter / "coclerk.json").write_text(
            json.dumps({"case_data_dir": str(self.case_data)}), encoding="utf-8")
        self.context = self.case_data / "form-33-context.json"
        self.body = self.case_data / "form-33-body.txt"
        self.body.write_text("=== PART 1: ORDER(S) SOUGHT ===\ncosts\n",
                             encoding="utf-8")
        self.ctx = {"matter_path": str(self.matter),
                    "case_data_folder": str(self.case_data),
                    "writing_folder": "NOA Stay", "scalars": None}

    def run_asm33_fill(self, context):
        import fill_plain
        self.context.write_text(json.dumps(context), encoding="utf-8")
        self.ctx["asm33_context_path"] = str(self.context)
        self.ctx["asm33_body_path"] = str(self.body)
        with mock.patch.object(fill_plain, "fill", fake_fill), \
                mock.patch("steps.shared.render.render_to_pdf", fake_render):
            asm33_fill.calls_script(self.ctx)
        return Path(self.ctx["output_path"])


class TestAsm33Fill(_Asm33Matter):
    def test_names_the_docx_from_the_context_title(self):
        out = self.run_asm33_fill({"title": "Response to Stay Application"})
        self.assertEqual(out, self.draft / "Response to Stay Application.docx")
        self.assertEqual(out.read_bytes(), MINIMAL_DOCX)

    def test_falls_back_to_the_registry_name_without_a_title(self):
        out = self.run_asm33_fill({})
        self.assertEqual(out, self.draft / "Application Response (Form 33).docx")

    def test_keeps_existing_session_scalars(self):
        self.ctx["scalars"] = {"title": "Session Title"}
        out = self.run_asm33_fill({"title": "Context Title"})
        self.assertEqual(out, self.draft / "Session Title.docx")


class TestSharedAsmFill(_Asm33Matter):
    def test_none_scalars_take_the_registry_name(self):
        import fill_plain
        self.context.write_text("{}", encoding="utf-8")
        self.ctx.update(form_id="form-33",
                        asm_context_path=str(self.context),
                        asm_body_path=str(self.body))
        with mock.patch.object(fill_plain, "fill", fake_fill):
            asm_fill.calls_script(self.ctx)
        self.assertEqual(Path(self.ctx["output_path"]),
                         self.draft / "Application Response (Form 33).docx")


if __name__ == "__main__":
    unittest.main()
