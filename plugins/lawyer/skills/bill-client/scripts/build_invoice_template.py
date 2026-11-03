#!/usr/bin/env python3
"""Build the firm's first invoice template from its letterhead and style guide, once.

    build_invoice_template.py --letterhead letterhead.docx --style style.json --wording wording.json --out invoice.docx

--style is the firm profile's `style`: {"colors": {"band", "accent", "row_tint", "chart_series"},
"font": {"name", "size_pt"}, "table": {"banded_rows"}}, each color "#RRGGBB". --wording is the firm's
fixed wording, with no dollar amount: {"closing": [line, ...], "after": [{"bold", "text"}, ...]}. A
closing line may hold the letterhead's {{AUTHOR_NAME}}, and the signing space stays empty. The only
images are the letterhead's. --out must not exist. It is a working copy for the practitioner to correct
in Word: this script never writes to the firm folder. Prints one JSON line. On a refusal it prints
{"error", "detail"} and exits 1, writing nothing.
"""
import argparse
import json
import re
import sys
from pathlib import Path

from render_invoice import Refusal, load, check_template, docx

if docx:
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn
    from docx.shared import Pt, RGBColor

LINE_COLUMNS = (("Date", "{{LINE_DATE}}", 1.0), ("Description", "{{LINE_DESCRIPTION}}", None), ("By", "{{LINE_BY}}", 0.6), ("Hours", "{{LINE_HOURS}}", 0.7))
DETAILS = (("Invoice Date: ", "{{INVOICE_DATE}}"), ("Our Ref: ", "{{OUR_REF}}"), ("Bill No: ", "{{BILL_NUMBER}}"))
SUMMARY = (("Taxable services", "{{TAXABLE_SERVICES}}"), ("Taxable disbursements", "{{TAXABLE_DISBURSEMENTS}}"), ("Subtotal", "{{SUBTOTAL}}"),
           ("{{TAX_NAME}}", "{{TAX_AMOUNT}}"), ("Non-taxable disbursements", "{{NON_TAXABLE_DISBURSEMENTS}}"), ("Total", "{{TOTAL}}"),
           ("Trust applied", "{{TRUST_APPLIED}}"), ("Amount due", "{{AMOUNT_DUE}}"))
TRUST_SENTENCE = "We hold {{TRUST_BALANCE}} in trust for you and will apply {{TRUST_APPLIED}} to this invoice."
HEX = re.compile(r"#[0-9A-Fa-f]{6}")


def check_style(style):
    try:
        colors = [style["colors"][name] for name in ("band", "accent", "row_tint")]
        style["font"]["name"], style["font"]["size_pt"], style["table"]["banded_rows"]
    except (KeyError, TypeError) as err:
        raise Refusal("style_incomplete", f"the style guide has no {err}") from err
    bad = [color for color in colors if not isinstance(color, str) or not HEX.fullmatch(color)]
    if bad:
        raise Refusal("style_incomplete", f"not a #RRGGBB color: {', '.join(map(str, bad))}")


class Page:
    """Writes into the emptied letterhead body, in the style guide's font."""

    def __init__(self, document, style):
        self.document = document
        self.style = style
        section = document.sections[0]
        self.width = section.page_width - section.left_margin - section.right_margin

    def add_run(self, paragraph, text, bold=False, color=None):
        run = paragraph.add_run(text)
        run.bold = bold
        run.font.name = self.style["font"]["name"]
        run.font.size = Pt(self.style["font"]["size_pt"])
        if color:
            run.font.color.rgb = RGBColor.from_string(color[1:])
        return run

    def add_paragraph(self, text="", bold=False, right=False, after=11):
        paragraph = self.document.add_paragraph()
        if text:
            self.add_run(paragraph, text, bold)
        if right:
            paragraph.alignment = WD_ALIGN_PARAGRAPH.RIGHT
        paragraph.paragraph_format.space_after = Pt(after)
        return paragraph

    def add_table(self, rows, widths):
        """A fixed table as wide as the bands: a width of None takes what the others leave."""
        rest = self.width - sum(width for width in widths if width)
        table = self.document.add_table(rows=rows, cols=len(widths))
        table.autofit = False
        for index, width in enumerate(widths):
            table.columns[index].width = width or rest
            for cell in table.columns[index].cells:
                cell.width = width or rest
        return table


def shade(cell, color):
    fill = OxmlElement("w:shd")
    fill.set(qn("w:val"), "clear")
    fill.set(qn("w:color"), "auto")
    fill.set(qn("w:fill"), color[1:])
    cell._tc.get_or_add_tcPr().append(fill)


def rule_under(paragraph, color):
    edge = OxmlElement("w:bottom")
    for name, value in (("val", "single"), ("sz", "8"), ("space", "6"), ("color", color[1:])):
        edge.set(qn(f"w:{name}"), value)
    border = OxmlElement("w:pBdr")
    border.append(edge)
    paragraph._p.get_or_add_pPr().append(border)


def write_heading_block(page):
    table = page.add_table(1, (None, int(page.width * 0.4)))
    inset = OxmlElement("w:left")  # no cell padding, so the address lines up with the text below it
    inset.set(qn("w:w"), "0")
    inset.set(qn("w:type"), "dxa")
    padding = OxmlElement("w:tblCellMar")
    padding.append(inset)
    table._tbl.tblPr.find(qn("w:tblLook")).addprevious(padding)
    left, right = table.rows[0].cells
    page.add_run(left.paragraphs[0], "{{ADDRESSEE}}")
    for index, (label, field) in enumerate(DETAILS):
        paragraph = right.paragraphs[0] if index == 0 else right.add_paragraph()
        page.add_run(paragraph, label, bold=True)
        page.add_run(paragraph, field)
    page.add_paragraph(after=0)
    page.add_paragraph("{{DELIVERY}}", bold=True, right=True)
    page.add_paragraph("{{SALUTATION}}")
    paragraph = page.document.add_paragraph()
    rule_under(paragraph, page.style["colors"]["band"])
    paragraph.paragraph_format.space_after = Pt(11)
    page.add_run(paragraph, "Re: ", bold=True)
    page.add_run(paragraph, "{{RE}}", bold=True)


def write_lines_table(page):
    colors, banded = page.style["colors"], page.style["table"]["banded_rows"]
    widths = [int(width * 914400) if width else None for _, _, width in LINE_COLUMNS]
    table = page.add_table(3 if banded else 2, widths)
    header = table.rows[0]
    header._tr.get_or_add_trPr().append(OxmlElement("w:tblHeader"))
    for cell, (title, _, _) in zip(header.cells, LINE_COLUMNS):
        shade(cell, colors["band"])
        page.add_run(cell.paragraphs[0], title, bold=True, color="#FFFFFF")
    for offset, row in enumerate(table.rows[1:]):
        for cell, (_, field, _) in zip(row.cells, LINE_COLUMNS):
            if offset:
                shade(cell, colors["row_tint"])
            page.add_run(cell.paragraphs[0], field)
    page.add_paragraph()


def write_summary(page):
    band, accent = page.style["colors"]["band"], page.style["colors"]["accent"]
    table = page.add_table(len(SUMMARY), (None, int(page.width * 0.2)))
    for row, (label, field) in zip(table.rows, SUMMARY):
        strong = field in ("{{TOTAL}}", "{{AMOUNT_DUE}}")
        for cell, text in zip(row.cells, (label, field)):
            if field == "{{AMOUNT_DUE}}":
                shade(cell, accent)
            cell.paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.RIGHT
            page.add_run(cell.paragraphs[0], text, bold=strong, color=band if strong else None)
    page.add_paragraph(after=0)
    page.add_paragraph(TRUST_SENTENCE)


def write_closing(page, wording):
    for line in wording["closing"]:
        page.add_paragraph(line, after=0)
    page.add_paragraph()
    for item in wording["after"]:
        paragraph = page.add_paragraph()
        if item.get("bold"):
            page.add_run(paragraph, f"{item['bold']} ", bold=True)
        page.add_run(paragraph, item.get("text", ""))


def build(args):
    if docx is None:
        raise Refusal("python_docx_missing", "this step needs the python-docx package")
    style = load(args.style, "style")
    wording = load(args.wording, "wording")
    check_style(style)
    if not isinstance(wording.get("closing"), list) or not isinstance(wording.get("after"), list):
        raise Refusal("bad_field", "the wording needs a closing list and an after list")
    out = Path(args.out)
    if out.exists():
        raise Refusal("out_exists", str(out))
    try:
        document = docx.Document(args.letterhead)
    except Exception as err:  # python-docx raises several unrelated types on a bad package
        raise Refusal("bad_letterhead", f"{args.letterhead}: {err}") from err
    body = document.element.body
    for child in list(body):
        if child.tag != qn("w:sectPr"):
            body.remove(child)
    page = Page(document, style)
    write_heading_block(page)
    write_lines_table(page)
    page.add_paragraph("{{CHART}}")
    write_summary(page)
    write_closing(page, wording)
    check_template(document)
    document.save(out)
    return {"template": str(out)}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--letterhead", required=True)
    parser.add_argument("--style", required=True)
    parser.add_argument("--wording", required=True)
    parser.add_argument("--out", required=True)
    try:
        print(json.dumps(build(parser.parse_args(argv))))
    except Refusal as refused:
        print(json.dumps({"error": refused.code, "detail": refused.detail}))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
