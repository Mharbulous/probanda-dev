"""asm32 reads its caption from the emitter's publish sidecar, not a Generate context.json.

The Generate context.json handoff (#1237) is gone (publish never blocks, 937c727).
asm32.locate needs only form-32.md; asm32.transform merges the frontmatter
hearing scalars over the sidecar's caption and prints a placeholder, with a
missing_datum warning, for each caption field the sidecar lacks; asm32.fill
names the .docx from the caption's title when the asm32 session carries no
Generate scalars.

Run: python -m pytest .claude/skills/publish/subskills/publish-bcsc-form/tests/test_asm32_generate_context.py -q
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

from steps.asm32 import fill as asm32_fill  # noqa: E402
from steps.asm32 import locate, transform  # noqa: E402
from steps.asm32.common import required_scalars_present  # noqa: E402

BODY = "## Part 2\n\n1. A fact.\n\n## Part 3\n\n2. A proposition.\n\n## Part 4\n\n- A document\n"

FORM32 = "\n".join([
    "---",
    "proposed_hearing: September 1, 2026",
    "hearing_place: 800 Smithe Street",
    "registry: Vancouver",
    "time_estimate: 45 minutes",
    'orders: [{"order": 1, "text": "costs"}]',
    "associate_judge: no",
    "---",
    "",
    BODY,
])

FULL_CONTEXT = {
    "title": "Stay Application", "applicant_names": "A",
    "to_affected_parties": "B", "court_file_number": "S-1",
    "registry": "Vancouver", "proposed_hearing": "stale",
    "duration_hours": "9", "duration_minutes": "9",
    "associate_judge": "yes",
}


def _minimal_docx() -> bytes:
    """A .docx of one paragraph and no placeholder, which the fill's residual scan can read."""
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


class _Asm32Matter(unittest.TestCase):
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
        self.substance = self.case_data / "bcsc-form-substance"
        self.substance.mkdir()
        self.form32 = self.substance / "form-32.md"
        self.form32.write_text(FORM32, encoding="utf-8")
        self.sidecar = self.substance / "form-32-publish.json"
        self.ctx = {"matter_path": str(self.matter),
                    "case_data_folder": str(self.case_data),
                    "writing_folder": "NOA Stay", "scalars": None,
                    "form_id": "form-32"}

    def write_sidecar(self, caption):
        self.sidecar.write_text(json.dumps({"caption": caption, "warnings": []}), encoding="utf-8")

    def run_locate(self):
        ok, msg = locate.precondition(self.ctx)
        self.assertTrue(ok, msg)
        result = json.loads(locate.build_prompt(self.ctx))["data"]
        ok, msg = locate.validate(result, self.ctx)
        self.assertTrue(ok, msg)
        locate.apply(self.ctx, result)


class TestLocate(_Asm32Matter):
    def test_locate_succeeds_with_no_context_json(self):
        self.assertFalse((self.substance / "context.json").exists())
        self.run_locate()
        self.assertEqual(self.ctx["asm32_form32_path"], str(self.form32))
        self.assertNotIn("asm_context_path", self.ctx)


class TestTransform(_Asm32Matter):
    def test_transform_merges_the_sidecar_caption_under_the_frontmatter(self):
        self.write_sidecar(FULL_CONTEXT)
        self.run_locate()
        self.ctx["asm32_validated"] = True
        result = json.loads(transform.build_prompt(self.ctx))["data"]
        merged = json.loads(Path(result["context_path"]).read_text(encoding="utf-8"))
        self.assertEqual(Path(result["context_path"]),
                         self.substance / "form-32-context.json")
        self.assertEqual(merged["applicant_names"], "A")
        self.assertEqual(merged["title"], "Stay Application")
        self.assertEqual(merged["court_file_number"], "S-1")
        self.assertEqual(merged["proposed_hearing"], "September 1, 2026")
        self.assertEqual(merged["duration_hours"], "0")
        self.assertEqual(merged["duration_minutes"], "45")
        self.assertEqual(merged["associate_judge"], "no")
        self.assertEqual(required_scalars_present(merged), (True, []))

    def test_transform_prints_a_placeholder_for_each_caption_field_the_sidecar_lacks(self):
        self.write_sidecar({"title": "X"})
        self.run_locate()
        self.ctx["asm32_validated"] = True
        result = json.loads(transform.build_prompt(self.ctx))["data"]
        merged = json.loads(Path(result["context_path"]).read_text(encoding="utf-8"))
        self.assertEqual(merged["applicant_names"], "[APPLICANT NAME(S)]")
        self.assertEqual(merged["to_affected_parties"], "[TO AFFECTED PARTIES]")
        self.assertEqual(merged["court_file_number"], "[COURT FILE NUMBER]")
        self.assertEqual(required_scalars_present(merged), (True, []))
        self.assertIn({"kind": "missing_datum", "field_or_id": "applicant_names",
                       "message": "Name of applicant: not recorded. The form shows [APPLICANT NAME(S)]."},
                      result["publish_warnings"])


class TestFill(_Asm32Matter):
    def test_fill_names_the_docx_from_the_caption_title_with_no_session_scalars(self):
        import fill_plain

        full = self.substance / "form-32-context.json"
        full.write_text(json.dumps(FULL_CONTEXT), encoding="utf-8")
        body = self.substance / "form-32-body.txt"
        body.write_text("=== PART 1: ORDER(S) SOUGHT ===\ncosts\n", encoding="utf-8")
        self.ctx["asm32_context_path"] = str(full)
        self.ctx["asm32_body_path"] = str(body)

        def fake_fill(template, scalars, body, out_path, form=None):
            Path(out_path).write_bytes(MINIMAL_DOCX)

        def fake_render(out):
            return Path(out).with_suffix(".pdf"), 1

        with mock.patch.object(fill_plain, "fill", fake_fill), \
                mock.patch("steps.shared.render.render_to_pdf", fake_render), \
                mock.patch("steps.shared.render.extract_form32_tail", lambda out: ""):
            asm32_fill.calls_script(self.ctx)
        self.assertEqual(Path(self.ctx["output_path"]),
                         self.draft / "Stay Application.docx")


if __name__ == "__main__":
    unittest.main()
