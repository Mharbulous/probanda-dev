"""render_invoice.py on invented data: DRAFT on the face, no signature, totals that tie, never overwrites."""
import contextlib
import io
import json
import struct
import sys
import tempfile
import unittest
import zipfile
import zlib
from pathlib import Path

import docx

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import render_invoice  # noqa: E402


def tiny_png(path):
    def chunk(tag, data):
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body))
    header = struct.pack(">IIBBBBB", 1, 1, 8, 0, 0, 0, 0)
    path.write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(b"\x00\x00")) + chunk(b"IEND", b""))


def invoice():
    return {"meta": [["Invoice Date:", "February 1, 2030"], ["Bill No:", "DRAFT"]],
            "addressee": ["Pat Client", "1 Example Street"], "delivery": "VIA EMAIL", "salutation": "Dear Pat,",
            "re": "Client v. Other", "amount_due_label": "AMOUNT DUE & OWING",
            "tokens": {"{{FILE_NUMBER}}": "1.L1"},
            "taxes": [{"name": "GST", "rate": "0.05"}, {"name": "PST", "rate": "0.07"}],
            "closing": ["Example Law Corporation", "Per:", "Lee Lawyer", "E. & O.E."],
            "after": [{"bold": "CHEQUE:", "text": "By mail."}]}


def lines():
    return {"rows": [{"date": "2030-01-10", "user": "Lee Lawyer", "initials": "LL", "description": "Phone call to client",
                      "unrounded_hours": "0.205", "hours": "0.3", "rate": "400.00", "amount": "120.00",
                      "support": {"evidence_rows": 1, "estimate_bases": 0}}],
            "subtotal": "120.00", "passed_on": "2030-02-01"}


class Render(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.dir = Path(tmp.name)
        head = docx.Document()
        head.sections[0].different_first_page_header_footer = True
        head.sections[0].first_page_header.paragraphs[0].add_run("File No.{{FILE_")
        head.sections[0].first_page_header.paragraphs[0].add_run("NUMBER}}")
        head.add_paragraph("Letterhead body text that must go")
        head.save(self.dir / "letterhead.docx")

    def run_render(self, the_invoice=None, the_lines=None):
        (self.dir / "invoice.json").write_text(json.dumps(the_invoice or invoice()), encoding="utf-8")
        (self.dir / "lines.json").write_text(json.dumps(the_lines or lines()), encoding="utf-8")
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = render_invoice.main(["--invoice", str(self.dir / "invoice.json"), "--lines", str(self.dir / "lines.json"),
                                        "--letterhead", str(self.dir / "letterhead.docx"), "--out-dir", str(self.dir),
                                        "--out-name", "2030-02-01 Draft invoice"])
        return code, json.loads(out.getvalue())

    def text_of(self, path):
        document = docx.Document(path)
        table_text = [cell.text for table in document.tables for row in table.rows for cell in row.cells]
        return "\n".join([p.text for p in document.paragraphs] + table_text), document

    def test_a_line_with_no_evidence_or_estimate_basis_is_refused_in_plain_words(self):
        bare = lines()
        bare["rows"][0]["support"] = {"evidence_rows": 0, "estimate_bases": 0}
        code, out = self.run_render(the_lines=bare)
        self.assertEqual((code, out["error"]), (1, "no_support"))
        self.assertIn("The line for 2030-01-10, Lee Lawyer has no evidence", out["detail"])
        del bare["rows"][0]["support"]
        self.assertEqual(self.run_render(the_lines=bare)[1]["error"], "no_support")

    def test_an_estimate_basis_alone_is_enough(self):
        estimated = lines()
        estimated["rows"][0]["support"] = {"evidence_rows": 0, "estimate_bases": 1}
        self.assertEqual(self.run_render(the_lines=estimated)[0], 0)

    def test_face_says_draft_and_totals_tie_to_the_lines(self):
        code, out = self.run_render()
        self.assertEqual(code, 0, out)
        self.assertEqual((out["fees"], out["taxes"], out["total"]), ("120.00", {"GST": "6.00", "PST": "8.40"}, "134.40"))
        text, document = self.text_of(out["docx"])
        self.assertIn(render_invoice.DRAFT_MARK, "\n".join(p.text for p in document.sections[0].first_page_header.paragraphs))
        for figure in ("Phone call to client", "$400.00", "$120.00", "$6.00", "$8.40", "$134.40", "AMOUNT DUE & OWING"):
            self.assertIn(figure, text)
        self.assertNotIn("Letterhead body text", text)

    def test_header_token_split_across_runs_is_filled(self):
        _, out = self.run_render()
        header = docx.Document(out["docx"]).sections[0].first_page_header.paragraphs[0].text
        self.assertEqual(header, "File No.1.L1")

    def test_unfilled_token_refuses_and_writes_nothing(self):
        the_invoice = invoice()
        the_invoice["tokens"] = {}
        code, out = self.run_render(the_invoice)
        self.assertEqual((code, out["error"]), (1, "missing_token"))
        self.assertFalse(list(self.dir.glob("2030-02-01*")))

    def test_a_signature_cannot_be_passed(self):
        the_invoice = invoice()
        the_invoice["signature"] = "signature.png"
        code, out = self.run_render(the_invoice)
        self.assertEqual((code, out["error"]), (1, "unknown_field"))

    def test_only_the_chart_adds_an_image(self):
        tiny_png(self.dir / "chart.png")
        _, plain = self.run_render()
        with zipfile.ZipFile(plain["docx"]) as package:
            self.assertFalse([n for n in package.namelist() if n.startswith("word/media/")])
        the_invoice = invoice()
        the_invoice["chart"] = str(self.dir / "chart.png")
        _, charted = self.run_render(the_invoice)
        with zipfile.ZipFile(charted["docx"]) as package:
            self.assertEqual(len([n for n in package.namelist() if n.startswith("word/media/")]), 1)

    def test_figure_that_does_not_tie_refuses(self):
        the_lines = lines()
        the_lines["rows"][0]["amount"] = "119.00"
        self.assertEqual(self.run_render(the_lines=the_lines)[1]["error"], "amount_mismatch")
        the_lines = lines()
        the_lines["subtotal"] = "121.00"
        self.assertEqual(self.run_render(the_lines=the_lines)[1]["error"], "subtotal_mismatch")

    def test_lines_with_no_pass_stamp_refuse(self):
        the_lines = lines()
        del the_lines["passed_on"]
        self.assertEqual(self.run_render(the_lines=the_lines)[1]["error"], "not_passed")

    def test_old_amount_in_fixed_wording_refuses(self):
        the_invoice = invoice()
        the_invoice["after"] = [{"bold": "NOTE:", "text": "Your balance is $500.00."}]
        self.assertEqual(self.run_render(the_invoice)[1]["error"], "amount_in_wording")

    def test_second_render_never_overwrites(self):
        _, first = self.run_render()
        _, second = self.run_render()
        self.assertTrue(first["docx"].endswith("Draft invoice.docx"))
        self.assertTrue(second["docx"].endswith("Draft invoice v2.docx"))
        self.assertEqual(second["versioned_from"], "2030-02-01 Draft invoice")


if __name__ == "__main__":
    unittest.main()
