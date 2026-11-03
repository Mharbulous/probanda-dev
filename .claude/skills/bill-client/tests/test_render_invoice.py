"""render_invoice.py and build_invoice_template.py on invented data: DRAFT on the face, no signature, totals that tie, never overwrites."""
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
import build_invoice_template  # noqa: E402
import render_invoice  # noqa: E402


def tiny_png(path):
    def chunk(tag, data):
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body))
    header = struct.pack(">IIBBBBB", 1, 1, 8, 0, 0, 0, 0)
    path.write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(b"\x00\x00")) + chunk(b"IEND", b""))


STYLE = {"colors": {"band": "#112233", "accent": "#445566", "row_tint": "#778899", "chart_series": {"ll": "#112233"}},
         "font": {"name": "Georgia", "size_pt": 10}, "table": {"banded_rows": True}}
WORDING = {"closing": ["Example Law Corporation", "Per:", "{{AUTHOR_NAME}}", "E. & O.E."], "after": [{"bold": "CHEQUE:", "text": "By mail."}]}


def invoice():
    return {"invoice_date": "February 1, 2030", "our_ref": "1.L1", "bill_number": "DRAFT", "addressee": ["Pat Client", "1 Example Street"],
            "delivery": "VIA EMAIL", "salutation": "Dear Pat,", "re": ["Client v. Other"],
            "tokens": {"{{FILE_NUMBER}}": "1.L1", "{{AUTHOR_NAME}}": "Lee Lawyer"},
            "taxes": [{"name": "GST", "rate": "0.05"}, {"name": "PST", "rate": "0.07"}]}


def lines():
    return {"rows": [{"date": "2030-01-10", "user": "Lee Lawyer", "initials": "LL", "description": "Phone call to client",
                      "unrounded_hours": "0.205", "hours": "0.3", "rate": "400.00", "amount": "120.00",
                      "support": {"evidence_rows": 1, "estimate_bases": 0}}],
            "subtotal": "120.00", "passed_on": "2030-02-01"}


def disbursement(key, amount, taxable, **extra):
    return {"line_key": f"disbursement:{key}", "line_kind": "disbursement", "description": f"Receipt {key}", "amount": amount,
            "taxable": taxable, "receipt_hash": key, "receipt_path": f"{key}.pdf", **extra}


def disbursements(*rows):
    rows = rows or (disbursement("a", "30.00", True), disbursement("b", "25.00", False))
    return {"lines": list(rows), "subtotal": str(sum(float(r["amount"]) for r in rows)),
            "taxable_subtotal": str(sum(float(r["amount"]) for r in rows if r["taxable"])), "duplicates": []}


class Base(unittest.TestCase):
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
        self.template = self.dir / "invoice.docx"

    def build(self, style=None, wording=None, out=None):
        (self.dir / "style.json").write_text(json.dumps(style or STYLE), encoding="utf-8")
        (self.dir / "wording.json").write_text(json.dumps(wording or WORDING), encoding="utf-8")
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            code = build_invoice_template.main(["--letterhead", str(self.dir / "letterhead.docx"), "--style", str(self.dir / "style.json"),
                                                "--wording", str(self.dir / "wording.json"), "--out", str(out or self.template)])
        return code, json.loads(output.getvalue())

    def run_render(self, the_invoice=None, the_lines=None, the_disbursements=None):
        (self.dir / "invoice.json").write_text(json.dumps(the_invoice or invoice()), encoding="utf-8")
        (self.dir / "lines.json").write_text(json.dumps(the_lines or lines()), encoding="utf-8")
        argv = ["--invoice", str(self.dir / "invoice.json"), "--lines", str(self.dir / "lines.json"), "--template", str(self.template),
                "--out-dir", str(self.dir), "--out-name", "2030-02-01 Draft invoice"]
        if the_disbursements:
            (self.dir / "disbursements.json").write_text(json.dumps(the_disbursements), encoding="utf-8")
            argv += ["--disbursements", str(self.dir / "disbursements.json")]
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = render_invoice.main(argv)
        return code, json.loads(out.getvalue())

    def text_of(self, path):
        document = docx.Document(path)
        table_text = [cell.text for table in document.tables for row in table.rows for cell in row.cells]
        return "\n".join([p.text for p in document.paragraphs] + table_text), document

    def summary_rows(self, path):
        return [[cell.text for cell in row.cells] for row in docx.Document(path).tables[-1].rows]


class Render(Base):
    def setUp(self):
        super().setUp()
        self.assertEqual(self.build()[0], 0)

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
        for figure in ("Phone call to client", "$120.00", "$6.00", "$8.40", "$134.40", "Amount due", "Pat Client\n1 Example Street", "Lee Lawyer"):
            self.assertIn(figure, text)
        self.assertNotIn("Letterhead body text", text)
        self.assertIsNone(render_invoice.TOKEN.search(text))

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

    def test_a_missing_invoice_field_refuses(self):
        the_invoice = invoice()
        del the_invoice["salutation"]
        self.assertEqual(self.run_render(the_invoice)[1], {"error": "missing_field", "detail": "salutation"})

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

    def test_old_amount_in_the_re_line_refuses(self):
        the_invoice = invoice()
        the_invoice["re"] = ["Your balance is $500.00."]
        self.assertEqual(self.run_render(the_invoice)[1]["error"], "amount_in_wording")

    def test_old_amount_in_the_templates_wording_refuses(self):
        document = docx.Document(self.template)
        document.add_paragraph("Your balance is $500.00.")
        document.save(self.template)
        self.assertEqual(self.run_render()[1]["error"], "amount_in_wording")

    def test_second_render_never_overwrites(self):
        _, first = self.run_render()
        _, second = self.run_render()
        self.assertTrue(first["docx"].endswith("Draft invoice.docx"))
        self.assertTrue(second["docx"].endswith("Draft invoice v2.docx"))
        self.assertEqual(second["versioned_from"], "2030-02-01 Draft invoice")


class Summary(Base):
    def setUp(self):
        super().setUp()
        self.assertEqual(self.build()[0], 0)

    def test_taxable_lines_sit_above_the_taxes_and_non_taxable_below(self):
        code, out = self.run_render(the_disbursements=disbursements())
        self.assertEqual(code, 0, out)
        self.assertEqual(self.summary_rows(out["docx"]), [
            ["Taxable services", "$120.00"], ["Taxable disbursements", "$30.00"], ["Subtotal", "$150.00"],
            ["GST", "$7.50"], ["PST", "$10.50"], ["Non-taxable disbursements", "$25.00"], ["Total", "$193.00"], ["Amount due", "$193.00"]])

    def test_a_disbursement_kind_that_is_absent_loses_its_row(self):
        _, out = self.run_render()
        labels = [row[0] for row in self.summary_rows(out["docx"])]
        self.assertEqual(labels, ["Taxable services", "Subtotal", "GST", "PST", "Total", "Amount due"])

    def test_an_unset_tax_status_refuses(self):
        for taxable in (None, "yes"):
            bad = disbursements(disbursement("a", "30.00", True), disbursement("b", "25.00", False))
            bad["lines"][1]["taxable"] = taxable
            code, out = self.run_render(the_disbursements=bad)
            self.assertEqual((code, out["error"]), (1, "taxable_unset"))
            self.assertIn("Receipt b", out["detail"])
        self.assertFalse(list(self.dir.glob("2030-02-01*")))

    def test_a_flagged_line_needs_a_decision(self):
        flagged = disbursement("a", "30.00", True, flags=["not processed"])
        self.assertEqual(self.run_render(the_disbursements=disbursements(flagged))[1]["error"], "undecided_line")
        flagged["decided"] = True
        self.assertEqual(self.run_render(the_disbursements=disbursements(flagged))[0], 0)

    def test_disbursement_totals_must_tie(self):
        bad = disbursements()
        bad["subtotal"] = "99.00"
        self.assertEqual(self.run_render(the_disbursements=bad)[1]["error"], "subtotal_mismatch")

    def test_trust_applied_is_the_lesser_of_the_balance_and_the_total(self):
        the_invoice = invoice()
        the_invoice["trust_balance"] = "100.00"
        _, out = self.run_render(the_invoice)
        self.assertEqual((out["trust_applied"], out["amount_due"]), ("100.00", "34.40"))
        self.assertIn(["Trust applied", "$100.00"], self.summary_rows(out["docx"]))
        self.assertIn("We hold $100.00 in trust for you and will apply $100.00", self.text_of(out["docx"])[0])
        the_invoice["trust_balance"] = "500.00"
        _, out = self.run_render(the_invoice)
        self.assertEqual((out["trust_applied"], out["amount_due"]), ("134.40", "0.00"))

    def test_no_trust_balance_leaves_no_trust_wording(self):
        _, out = self.run_render()
        text = self.text_of(out["docx"])[0]
        self.assertNotIn("Trust applied", text)
        self.assertNotIn("in trust", text)


class Template(Base):
    def test_colors_and_font_come_from_the_style_guide(self):
        self.assertEqual(self.build()[0], 0)
        with zipfile.ZipFile(self.template) as package:
            xml = package.read("word/document.xml").decode("utf-8")
        for color in ("112233", "445566", "778899"):
            self.assertIn(f'w:fill="{color}"', xml)
        self.assertIn('w:ascii="Georgia"', xml)

    def test_a_different_style_guide_gives_different_colors(self):
        other = json.loads(json.dumps(STYLE))
        other["colors"]["band"] = "#ABCDEF"
        other["table"]["banded_rows"] = False
        self.assertEqual(self.build(style=other)[0], 0)
        with zipfile.ZipFile(self.template) as package:
            xml = package.read("word/document.xml").decode("utf-8")
        self.assertIn('w:fill="ABCDEF"', xml)
        self.assertNotIn('w:fill="778899"', xml)

    def test_the_letterhead_is_only_read_and_keeps_its_tokens(self):
        before = (self.dir / "letterhead.docx").read_bytes()
        self.build()
        self.assertEqual((self.dir / "letterhead.docx").read_bytes(), before)
        built = docx.Document(self.template)
        self.assertEqual(built.sections[0].first_page_header.paragraphs[0].text, "File No.{{FILE_NUMBER}}")
        self.assertNotIn("Letterhead body text", self.text_of(self.template)[0])

    def test_an_incomplete_style_guide_refuses_and_writes_nothing(self):
        for broken in ({"colors": STYLE["colors"]}, {**STYLE, "colors": {**STYLE["colors"], "band": "teal"}}):
            code, out = self.build(style=broken)
            self.assertEqual((code, out["error"]), (1, "style_incomplete"))
        self.assertFalse(self.template.exists())

    def test_an_amount_in_the_wording_refuses(self):
        code, out = self.build(wording={"closing": ["Balance $500.00"], "after": []})
        self.assertEqual((code, out["error"]), (1, "amount_in_wording"))

    def test_it_never_overwrites(self):
        self.build()
        before = self.template.read_bytes()
        code, out = self.build()
        self.assertEqual((code, out["error"]), (1, "out_exists"))
        self.assertEqual(self.template.read_bytes(), before)

    def test_a_template_that_lost_a_figure_refuses(self):
        self.build()
        document = docx.Document(self.template)
        for row in document.tables[-1].rows:
            if row.cells[0].text == "Total":
                row._tr.getparent().remove(row._tr)
        document.save(self.template)
        code, out = self.run_render()
        self.assertEqual((code, out["error"]), (1, "template_field_missing"))
        self.assertIn("{{TOTAL}}", out["detail"])

    def test_fill_keeps_the_formatting_the_practitioner_set_in_word(self):
        self.build()
        document = docx.Document(self.template)
        paragraph = document.add_paragraph()
        paragraph.add_run("Our file: ").bold = True
        paragraph.add_run("{{OUR_")
        paragraph.add_run("REF}} ").italic = True
        paragraph.add_run("thanks").bold = True
        document.save(self.template)
        _, out = self.run_render()
        filled = next(p for p in docx.Document(out["docx"]).paragraphs if p.text.startswith("Our file"))
        self.assertEqual(filled.text, "Our file: 1.L1 thanks")
        self.assertEqual([(r.text, r.bold) for r in filled.runs if r.bold], [("Our file: ", True), ("thanks", True)])

    def test_line_rows_alternate_plain_and_tinted(self):
        self.build()
        the_lines = lines()
        the_lines["rows"] = [dict(the_lines["rows"][0], date=f"2030-01-1{n}") for n in range(3)]
        the_lines["subtotal"] = "360.00"
        _, out = self.run_render(the_lines=the_lines)
        rows = docx.Document(out["docx"]).tables[1].rows
        self.assertEqual([r.cells[0].text for r in rows[1:]], ["2030-01-10", "2030-01-11", "2030-01-12"])
        tinted = ['w:fill="778899"' in r._tr.xml for r in rows[1:]]
        self.assertEqual(tinted, [False, True, False])

    def test_a_practitioners_template_with_rate_and_amount_columns_fills(self):
        self.build()
        document = docx.Document(self.template)
        row = document.tables[1].rows[1]
        row.cells[2].paragraphs[0].runs[0].text = "{{LINE_RATE}} {{LINE_AMOUNT}}"
        document.save(self.template)
        _, out = self.run_render()
        self.assertIn("$400.00 $120.00", self.text_of(out["docx"])[0])


if __name__ == "__main__":
    unittest.main()
