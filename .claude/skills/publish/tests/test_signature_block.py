"""The signature block: a blank signing space, never alone on a page.

A letter this machine's `person` does not sign leaves three empty lines between "per" and
the signer's name, for the signer's own hand. When the signature is placed instead is
tested in test_render_letterhead.py.

The closing and signature block must share a page with the letter's last body paragraph.
Every paragraph from that last body paragraph to the signer's name carries keepNext and
keepLines, first in its <w:pPr> as CT_PPrBase orders them. A last paragraph longer than
LONG_LAST_PARAGRAPH characters drops keepLines for widowControl, so it may split.

The rendering test needs LibreOffice (or, failing that, Word) and pdftotext, and skips,
saying which is missing, on a machine without them.

Run: python -m unittest discover -s .claude/skills/publish/tests
"""
from __future__ import annotations

import os
import re
import shutil
import subprocess
import tempfile
import unittest
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

import support
import fill_general  # on sys.path via support
from support import LAWYER, PAYLOAD, W

KEEP = ("keepNext", "keepLines")


def parts_of(path):
    with zipfile.ZipFile(path) as z:
        return {name: z.read(name) for name in z.namelist()}


def paragraphs(document_xml):
    body = ET.fromstring(document_xml).find("{%s}body" % W)
    return [p for p in body if p.tag == "{%s}p" % W]


def text(p):
    return "".join(t.text or "" for t in p.iter("{%s}t" % W))


def ppr_children(p):
    ppr = p.find("{%s}pPr" % W)
    return [child.tag.split("}")[1] for child in ppr]


def index_of(paras, wanted):
    return next(i for i, p in enumerate(paras) if text(p) == wanted)


class Base(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.tmp = Path(self._tmp.name)

    def build(self, payload, name="letter.docx"):
        return parts_of(support.render_synthetic(self.tmp, payload, name))


class TestSigningSpace(Base):
    def test_three_empty_paragraphs_between_per_and_the_signer(self):
        paras = paragraphs(self.build(PAYLOAD)["word/document.xml"])
        per = index_of(paras, "per")
        signer = index_of(paras, LAWYER["name"])
        between = paras[per + 1:signer]
        self.assertEqual(len(between), 3)
        for p in between:
            self.assertEqual(p.findall("{%s}r" % W), [], "signing space must be empty")


class TestKeepChain(Base):
    payload = {**PAYLOAD,
               "body": ["First paragraph.", "Second paragraph.", "The last paragraph."],
               "enclosures": ["An enclosure"], "cc": ["A copy"]}

    def setUp(self):
        super().setUp()
        self.paras = paragraphs(self.build(self.payload)["word/document.xml"])
        self.last = index_of(self.paras, "The last paragraph.")
        self.signer = index_of(self.paras, LAWYER["name"])

    def test_the_chain_runs_from_the_last_body_paragraph_to_the_signer(self):
        chain = self.paras[self.last:self.signer + 1]
        self.assertEqual(len(chain), 1 + 1 + 3 + 3 + 1)  # para, blank, close/firm/per, space, signer
        for p in chain:
            self.assertEqual(ppr_children(p)[:2], list(KEEP), text(p) or "(empty)")

    def test_keep_properties_appear_once(self):
        for p in self.paras[self.last:self.signer + 1]:
            children = ppr_children(p)
            self.assertEqual([c for c in children if c in KEEP], list(KEEP))

    def test_nothing_outside_the_chain_keeps(self):
        outside = self.paras[:self.last] + self.paras[self.signer + 1:]
        self.assertIn("cc. A copy", [text(p) for p in outside])
        for p in outside:
            self.assertFalse(set(ppr_children(p)) & set(KEEP), text(p) or "(empty)")

    def test_the_chain_starts_at_the_last_body_paragraph(self):
        before = self.paras[self.last - 1]
        self.assertEqual(text(before), "")
        self.assertEqual(text(self.paras[self.last - 2]), "Second paragraph.")


class TestLongLastParagraph(Base):
    def test_a_long_last_paragraph_may_split_but_keeps_with_the_closing(self):
        long_text = "word " * (fill_general.LONG_LAST_PARAGRAPH // 5 + 1)
        paras = paragraphs(self.build({**PAYLOAD, "body": [long_text]})["word/document.xml"])
        last = next(p for p in paras if text(p) == long_text)
        self.assertEqual(ppr_children(last)[:2], ["keepNext", "widowControl"])
        self.assertNotIn("keepLines", ppr_children(last))

    def test_a_list_item_last_paragraph_joins_the_chain(self):
        paras = paragraphs(self.build({**PAYLOAD, "body": ["Intro.", "- An item"]})
                           ["word/document.xml"])
        item = next(p for p in paras if "An item" in text(p))
        self.assertEqual(ppr_children(item)[:2], list(KEEP))


class TestKeepTogether(unittest.TestCase):
    def test_after_pstyle(self):
        p = '<w:p><w:pPr><w:pStyle w:val="X"/><w:jc w:val="both"/></w:pPr></w:p>'
        self.assertEqual(fill_general.keep_together(p),
                         '<w:p><w:pPr><w:pStyle w:val="X"/><w:keepNext/><w:keepLines/>'
                         '<w:jc w:val="both"/></w:pPr></w:p>')

    def test_no_duplicates(self):
        p = '<w:p><w:pPr><w:keepNext/><w:keepLines/></w:pPr></w:p>'
        self.assertEqual(fill_general.keep_together(p), p)


# --- rendering -------------------------------------------------------------------------

def find_soffice():
    for name in ("soffice", "libreoffice"):
        if shutil.which(name):
            return shutil.which(name)
    guess = Path(os.environ.get("ProgramFiles", r"C:\Program Files")) / "LibreOffice" \
        / "program" / "soffice.exe"
    return str(guess) if guess.is_file() else None


def find_word():
    if os.name != "nt" or not shutil.which("powershell"):
        return None
    for root in (os.environ.get("ProgramFiles"), os.environ.get("ProgramFiles(x86)")):
        exe = Path(root or "") / "Microsoft Office" / "root" / "Office16" / "WINWORD.EXE"
        if exe.is_file():
            return exe
    return None


WORD_TO_PDF = (
    '$ErrorActionPreference = "Stop"\n'
    '$word = New-Object -ComObject Word.Application\n'
    '$word.Visible = $false\n'
    'try {\n'
    '    $doc = $word.Documents.Open($env:LETTER_DOCX, $false, $true)\n'
    '    $doc.ExportAsFixedFormat($env:LETTER_PDF, 17)\n'
    '    $doc.Close([ref]$false)\n'
    '} finally { $word.Quit() }\n'
)


def to_pdf(docx):
    """Render with LibreOffice, else Word; skip naming what is missing."""
    pdf = docx.with_suffix(".pdf")
    soffice = find_soffice()
    if soffice:
        subprocess.run([soffice, "--headless", "--convert-to", "pdf", "--outdir",
                        str(docx.parent), str(docx)], check=True, capture_output=True,
                       timeout=180)
    elif find_word():
        env = {**os.environ, "LETTER_DOCX": str(docx), "LETTER_PDF": str(pdf)}
        subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command",
                        WORD_TO_PDF], check=True, capture_output=True, timeout=180, env=env)
    else:
        raise unittest.SkipTest("neither LibreOffice (soffice) nor Word -- page test not run")
    return pdf


def pages(pdf):
    """The text of each page, one string per page."""
    if not shutil.which("pdftotext"):
        raise unittest.SkipTest("no pdftotext -- page test not run")
    out = subprocess.run(["pdftotext", "-layout", "-enc", "UTF-8", str(pdf), "-"], check=True,
                         capture_output=True, timeout=60).stdout.decode("utf-8")
    return [page for page in out.split("\f") if page.strip()]


def strip_keeps(docx, out):
    """A copy of the letter without its keep properties: the letter as it used to be."""
    parts = parts_of(docx)
    doc = parts["word/document.xml"].decode("utf-8")
    parts["word/document.xml"] = re.sub(r"<w:(keepNext|keepLines)/>", "", doc).encode("utf-8")
    return support.write_zip(out, parts)


# Body paragraphs that fill page 1 so the last paragraph ends just above the foot of it:
# with nothing keeping the block together, "Yours very truly," starts page 2 by itself.
# FILLERS is calibrated for this letter; the precondition below fails loudly if a
# renderer lays it out differently enough that the defect no longer reproduces.
FILLER = ("Filler paragraph %02d says something about the matter at modest length so "
          "that it takes up two or three lines of the page, like an ordinary paragraph "
          "of a letter to opposing counsel would.")
FILLERS = 5
TAIL = " ".join("tail%02d" % i for i in range(1, 61)) + "."


def tail_lines(page):
    return [line for line in page.splitlines() if re.search(r"\btail\d\d\b", line)]


class TestRenderedPages(Base):
    def test_the_closing_never_sits_alone_on_a_page(self):
        payload = {**PAYLOAD,
                   "body": [FILLER % i for i in range(1, FILLERS + 1)] + [TAIL],
                   "enclosures": ["Release", "Consent Dismissal Order"]}
        built = support.render_synthetic(self.tmp, payload)

        # Precondition: without the keep chain this letter shows the defect.
        before = pages(to_pdf(strip_keeps(built, self.tmp / "unkept.docx")))
        closing_page = next(p for p in before if "Yours very truly," in p)
        self.assertEqual(tail_lines(closing_page), [],
                         "payload no longer reproduces the defect -- recalibrate FILLERS")

        after = pages(to_pdf(built))
        closing_page = next(p for p in after if "Yours very truly," in p)
        self.assertGreaterEqual(len(tail_lines(closing_page)), 3)
        self.assertIn("tail01", closing_page, "the whole last paragraph should move")
        self.assertIn("tail60.", closing_page)
        self.assertIn(LAWYER["name"], closing_page)


if __name__ == "__main__":
    unittest.main()
