"""Tests for the sent-copy comparison the Sent write runs (plan Phase 15; ADR 0024 D6).

A .pdf and a .eml are read and compared with the stored paragraphs; pasted text is compared
as given; a .msg is recorded by path and not compared, and the result says so. The fixture PDF
is written here with PyMuPDF, the dependency the comparison itself uses.

Run: python -m unittest discover -s .claude/skills/drafting-data/tests
"""

import json
import subprocess
import sys
import tempfile
import unittest
from email.message import EmailMessage
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parents[1] / "references" / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))

import sent_copy_compare as compare  # noqa: E402

PARAGRAPHS = [
    "We write about the late jurisdictional objection.",
    "Your client's position was not raised in time, and we ask that it be withdrawn.",
]


class TestSentCopyCompare(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.dir = Path(self._tmp.name)

    def _pdf(self, lines):
        import pymupdf as fitz

        path = self.dir / "sent.pdf"
        doc = fitz.open()
        page = doc.new_page()
        page.insert_text((72, 72), "\n".join(lines), fontsize=10)
        doc.save(str(path))
        doc.close()
        return path

    def _eml(self, body, html=False):
        message = EmailMessage()
        message["From"] = "pat@fixture.test"
        message["To"] = "cara@counsel.test"
        message["Subject"] = "Late jurisdictional objection"
        message.set_content(body, subtype="html" if html else "plain")
        path = self.dir / "sent.eml"
        path.write_bytes(message.as_bytes())
        return path

    def test_pdf_matches_across_line_breaks(self):
        # The second paragraph wraps onto two lines in the PDF, as a letter's body does.
        path = self._pdf(["Dear Counsel:", PARAGRAPHS[0], "Your client's position was not raised in time,", "and we ask that it be withdrawn."])
        self.assertEqual(compare.run({"paragraphs": PARAGRAPHS, "path": str(path), "text": None}), {"method": "pdf", "compared": True, "missing": []})

    def test_pdf_reports_a_paragraph_it_does_not_contain(self):
        path = self._pdf([PARAGRAPHS[0]])
        result = compare.run({"paragraphs": PARAGRAPHS, "path": str(path), "text": None})
        self.assertEqual(result, {"method": "pdf", "compared": True, "missing": [PARAGRAPHS[1]]})

    def test_eml_plain_body_matches_with_curly_quotes(self):
        path = self._eml("Dear Counsel,\n\n" + PARAGRAPHS[0] + "\n\nYour client’s position was not raised in time, and we ask that it be withdrawn.\n")
        self.assertEqual(compare.run({"paragraphs": PARAGRAPHS, "path": str(path), "text": None}), {"method": "eml", "compared": True, "missing": []})

    def test_eml_html_body_is_read_when_no_plain_part(self):
        path = self._eml("<p>" + PARAGRAPHS[0] + "</p><p>Something else entirely.</p>", html=True)
        result = compare.run({"paragraphs": PARAGRAPHS, "path": str(path), "text": None})
        self.assertEqual(result, {"method": "eml", "compared": True, "missing": [PARAGRAPHS[1]]})

    def test_pasted_text_is_compared_as_given(self):
        result = compare.run({"paragraphs": PARAGRAPHS, "path": None, "text": " ".join(PARAGRAPHS)})
        self.assertEqual(result, {"method": "text", "compared": True, "missing": []})

    def test_msg_is_recorded_by_path_and_not_compared(self):
        path = self.dir / "sent.msg"
        path.write_bytes(b"\xd0\xcf\x11\xe0 not readable here")
        result = compare.run({"paragraphs": PARAGRAPHS, "path": str(path), "text": None})
        self.assertEqual(result, {"method": "msg", "compared": False, "missing": [], "note": compare.MSG_NOTE})
        self.assertIn("recorded by path", result["note"])

    def test_refusals(self):
        with self.assertRaisesRegex(ValueError, "exactly one"):
            compare.run({"paragraphs": PARAGRAPHS, "path": None, "text": None})
        docx = self.dir / "sent.docx"
        docx.write_bytes(b"x")
        with self.assertRaisesRegex(ValueError, r"\.eml, \.pdf or \.msg"):
            compare.run({"paragraphs": PARAGRAPHS, "path": str(docx), "text": None})
        with self.assertRaisesRegex(ValueError, "no such file"):
            compare.run({"paragraphs": PARAGRAPHS, "path": str(self.dir / "absent.pdf"), "text": None})

    def test_stdin_to_stdout(self):
        # The runtime's Python driver runs the script this way: one JSON request in, one result out.
        done = subprocess.run(
            [sys.executable, str(SCRIPTS_DIR / "sent_copy_compare.py")],
            input=json.dumps({"paragraphs": PARAGRAPHS, "path": None, "text": PARAGRAPHS[0]}),
            capture_output=True,
            text=True,
            check=True,
        )
        self.assertEqual(json.loads(done.stdout), {"method": "text", "compared": True, "missing": [PARAGRAPHS[1]]})


if __name__ == "__main__":
    unittest.main()
