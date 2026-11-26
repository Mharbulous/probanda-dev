"""Markdown emphasis in a form's Part paragraphs and an affidavit's paragraphs fills as Word
bold and italic runs, with no asterisk left in the text (spec 2026-11-26, docx conversion keeps
italics). Each case fills the real template through fill_plain.fill and reads the .docx back.

Run: python -m pytest source/skills/publish/subskills/publish-bcsc-form/tests/test_part_emphasis.py -q
"""

import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

from lxml import etree

SKILL_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SKILL_ROOT / "scripts"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import harness  # noqa: E402
from fill_ooxml import WN, _para_text  # noqa: E402
from fill_plain import fill  # noqa: E402
from test_asmaff import CONTEXT as AFFIDAVIT_CONTEXT  # noqa: E402
from test_caption_contract import RENDER_CONTEXT  # noqa: E402


def fill_body(form_id: str, body_text: str, context: dict) -> etree._Element:
    spec = harness.REGISTRY[form_id]
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "out.docx"
        fill(SKILL_ROOT / spec["template"], context, body_text, out, form=spec["fill_form_arg"])
        with zipfile.ZipFile(out) as z:
            return etree.fromstring(z.read("word/document.xml")).find(WN("body"))


def runs_of(body: etree._Element, needle: str) -> list[tuple[str, bool, bool]]:
    """The (text, bold, italic) runs of the one paragraph whose text contains needle."""
    [para] = [p for p in body.iter(WN("p")) if needle in _para_text(p)]
    out = []
    for r in para.iter(WN("r")):
        text = "".join(t.text or "" for t in r.iter(WN("t")))
        if text:
            out.append((text, r.find(f"{WN('rPr')}/{WN('b')}") is not None,
                        r.find(f"{WN('rPr')}/{WN('i')}") is not None))
    return out


class PartEmphasis(unittest.TestCase):
    def assertItalic(self, body, needle, italic_text):
        runs = runs_of(body, needle)
        self.assertIn((italic_text, False, True), runs)
        self.assertNotIn("*", "".join(text for text, _, _ in runs))

    def test_form_32_numbered_excerpt_and_citation_lines(self):
        body = fill_body("form-32", "\n".join([
            "=== PART 2: FACTUAL BASIS ===",
            "The order in *Alpha v Beta* was made.",
            "> the court _must_ stay them",
            ">> *Gamma v Delta*, 2020 BCCA 1, para 4",
        ]), RENDER_CONTEXT)
        self.assertItalic(body, "was made", "Alpha v Beta")
        self.assertItalic(body, "stay them", "must")
        self.assertItalic(body, "2020 BCCA 1", "Gamma v Delta")

    def test_form_33_numbered_and_quoted_lines_including_the_citation(self):
        body = fill_body("form-33", "\n".join([
            "=== PART 4: FACTUAL BASIS ===",
            "The order in *Alpha v Beta* was made.",
            "=== PART 5: LEGAL BASIS ===",
            "The test is settled.",
            "> the court must stay them",
            "> *Gamma v Delta*, 2020 BCCA 1, para 4",
        ]), RENDER_CONTEXT)
        self.assertItalic(body, "was made", "Alpha v Beta")
        self.assertItalic(body, "2020 BCCA 1", "Gamma v Delta")

    def test_notice_of_civil_claim_bold_and_bold_italic(self):
        body = fill_body("form-1", "\n".join([
            "=== PART 1: STATEMENT OF FACTS ===",
            "The **plaintiff** relies on ***Alpha v Beta***.",
        ]), RENDER_CONTEXT)
        runs = runs_of(body, "relies on")
        self.assertIn(("plaintiff", True, False), runs)
        self.assertIn(("Alpha v Beta", True, True), runs)
        self.assertNotIn("*", "".join(text for text, _, _ in runs))

    def test_affidavit_paragraph(self):
        context = dict(AFFIDAVIT_CONTEXT, deponent_name="R. Deponent", affidavit_ordinal="1st",
                       affidavit_paragraphs=['I read *Alpha v Beta*, marked as **Exhibit "A"**.'])
        body = fill_body("affidavit", "", context)
        runs = runs_of(body, "I read")
        self.assertIn(("Alpha v Beta", False, True), runs)
        self.assertIn(('Exhibit "A"', True, False), runs)
        self.assertNotIn("*", "".join(text for text, _, _ in runs))


if __name__ == "__main__":
    unittest.main()
