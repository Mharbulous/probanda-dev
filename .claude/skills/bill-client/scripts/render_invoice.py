#!/usr/bin/env python3
"""Render a draft invoice on the firm's letterhead, marked DRAFT and never signed.

    render_invoice.py --invoice invoice.json --lines invoice_lines.json --letterhead letterhead.docx
                      --out-dir DIR --out-name STEM [--pdf]

--lines is tie_out.py's invoice_lines.json, written only on a pass. This script recomputes every
amount and refuses a figure that does not tie, a lines file with no pass stamp, a line with neither
evidence nor a recorded estimate basis, and a dollar amount
in the fixed wording, which could carry an old figure from the last invoice. --invoice holds what the last signed invoice fixes, each key required
unless marked:
    meta         [[label, value], ...], such as the invoice date, the firm's reference, the bill number
    addressee    [line, ...]
    delivery     optional, a delivery line
    salutation, re, amount_due_label
    tokens       {"{{TOKEN}}": value}: the letterhead's header and footer tokens
    taxes        [{"name", "rate"}, ...], rate as a decimal string such as "0.05"
    trust_applied  optional, a statement of the trust amount, printed under the total. Nothing moves.
    closing      [line, ...], the firm's name and the lawyer's. The signing space stays empty.
    after        [{"bold", "text"}, ...], the paragraphs after the closing, such as payment options
    chart        optional, the path of the chart's image

Any other key is refused, so a signature cannot reach the page: this script takes no signature
input and adds no image but the chart. Never overwrites: a taken name gets the next " vN". With
--pdf it also writes the PDF, by Word and then by soffice. Prints one JSON line. On a refusal it
prints {"error", "detail"} and exits 1, writing nothing.
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from pathlib import Path

CENT = Decimal("0.01")
REQUIRED = {"meta", "addressee", "salutation", "re", "amount_due_label", "tokens", "taxes", "closing", "after"}
OPTIONAL = {"delivery", "trust_applied", "chart"}
TOKEN = re.compile(r"\{\{[A-Z_]+\}\}")
DRAFT_MARK = "DRAFT: not issued and not signed"
LINE_WIDTHS = (0.95, 0.75, 2.8, 0.7, 0.75, 0.85)  # inches: Date, Person, Description, Hours, Rate, Amount


class Refusal(Exception):
    def __init__(self, code, detail):
        super().__init__(detail)
        self.code = code
        self.detail = detail


def money(value):
    return f"${value:,.2f}"


def load(path, what):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError) as err:
        raise Refusal("unreadable_input", f"{what} {path}: {err}") from err


def check_invoice(invoice):
    keys = set(invoice)
    if REQUIRED - keys:
        raise Refusal("missing_field", ", ".join(sorted(REQUIRED - keys)))
    if keys - REQUIRED - OPTIONAL:
        raise Refusal("unknown_field", ", ".join(sorted(keys - REQUIRED - OPTIONAL)))
    wording = [invoice["re"], *invoice["closing"], *(f"{i.get('bold', '')} {i.get('text', '')}" for i in invoice["after"])]
    with_amount = [text for text in wording if "$" in text]
    if with_amount:
        raise Refusal("amount_in_wording", "; ".join(with_amount))
    if invoice.get("chart") and not Path(invoice["chart"]).is_file():
        raise Refusal("chart_missing", invoice["chart"])


def totals(lines, taxes):
    """Recompute from each row's hours and rate. Refuses a figure that does not tie."""
    rows = lines.get("rows") or []
    if not lines.get("passed_on"):
        raise Refusal("not_passed", "the lines file carries no pass stamp")
    if not rows:
        raise Refusal("no_lines", "the lines file holds no rows")
    try:
        subtotal = Decimal(0)
        for row in rows:
            amount = (Decimal(row["hours"]) * Decimal(row["rate"])).quantize(CENT, ROUND_HALF_UP)
            if amount != Decimal(row["amount"]):
                raise Refusal("amount_mismatch", f"{row['date']} {row['user']}: {row['amount']} against {amount}")
            if not row["description"].strip():
                raise Refusal("no_description", f"{row['date']} {row['user']}")
            support = row.get("support") or {}
            if not support.get("evidence_rows") and not support.get("estimate_bases"):
                raise Refusal("no_support", f"The line for {row['date']}, {row['user']} has no evidence and no recorded estimate basis, "
                                            "so it cannot go on the invoice.")
            subtotal += amount
        if subtotal != Decimal(lines["subtotal"]):
            raise Refusal("subtotal_mismatch", f"{lines['subtotal']} against {subtotal}")
        charged = [(tax["name"], (subtotal * Decimal(tax["rate"])).quantize(CENT, ROUND_HALF_UP)) for tax in taxes]
    except (KeyError, InvalidOperation, TypeError) as err:
        raise Refusal("bad_figure", repr(err)) from err
    return subtotal, charged, subtotal + sum(amount for _, amount in charged)


def free_stem(out_dir, stem):
    """The stem itself, or the next " vN" with no .docx or .pdf of that name."""
    candidate, n = stem, 1
    while (out_dir / f"{candidate}.docx").exists() or (out_dir / f"{candidate}.pdf").exists():
        n += 1
        candidate = f"{stem} v{n}"
    return candidate


def fill_tokens(paragraph, tokens):
    text = paragraph.text
    if not TOKEN.search(text):
        return
    for token, value in tokens.items():
        text = text.replace(token, value)
    left = TOKEN.findall(text)
    if left:
        raise Refusal("missing_token", ", ".join(left))
    paragraph.runs[0].text = text
    for run in paragraph.runs[1:]:
        run.text = ""


def prepare_letterhead(document, tokens):
    """Fill the header and footer tokens, mark each header DRAFT, and empty the body."""
    for section in document.sections:
        for part in (section.header, section.first_page_header, section.footer, section.first_page_footer):
            for paragraph in part.paragraphs:
                fill_tokens(paragraph, tokens)
        for header in (section.header, section.first_page_header):
            header.add_paragraph().add_run(DRAFT_MARK).bold = True
    body = document.element.body
    for child in list(body):
        if not child.tag.endswith("}sectPr"):
            body.remove(child)


def align_right(cell, text, bold=False):
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    paragraph = cell.paragraphs[0]
    paragraph.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    paragraph.add_run(text).bold = bold


def add_lines_table(document, rows):
    from docx.shared import Inches
    headers = ("Date", "Person", "Description", "Hours", "Rate", "Amount")
    table = document.add_table(rows=1, cols=len(headers))
    table.autofit = False
    for column, (cell, header) in enumerate(zip(table.rows[0].cells, headers)):
        if column >= 3:
            align_right(cell, header, True)
        else:
            cell.paragraphs[0].add_run(header).bold = True
    for row in rows:
        for column, (cell, text) in enumerate(zip(table.add_row().cells, row)):
            if column >= 3:
                align_right(cell, text)
            else:
                cell.text = text
    for row in table.rows:
        for cell, width in zip(row.cells, LINE_WIDTHS):
            cell.width = Inches(width)


def add_block(document, lines=()):
    """A paragraph with a blank line after it, since the letterhead's Normal style has no spacing."""
    from docx.shared import Pt
    paragraph = document.add_paragraph("\n".join(lines))
    paragraph.paragraph_format.space_after = Pt(11)
    return paragraph


def write_body(document, invoice, lines, subtotal, charged, total):
    for index, (label, value) in enumerate(invoice["meta"]):
        paragraph = add_block(document) if index == len(invoice["meta"]) - 1 else document.add_paragraph()
        paragraph.add_run(f"{label} ").bold = True
        paragraph.add_run(value)
    add_block(document, invoice["addressee"])
    if invoice.get("delivery"):
        add_block(document).add_run(invoice["delivery"]).bold = True
    add_block(document, [invoice["salutation"]])
    paragraph = add_block(document)
    paragraph.add_run("Re: ").bold = True
    paragraph.add_run(invoice["re"]).bold = True
    add_lines_table(document, [(r["date"], r["initials"], r["description"], r["hours"], money(Decimal(r["rate"])),
                                money(Decimal(r["amount"]))) for r in lines["rows"]])
    document.add_paragraph()
    if invoice.get("chart"):
        document.add_picture(invoice["chart"])
    summary = document.add_table(rows=0, cols=2)
    figures = [("Fees", money(subtotal), False)] + [(name, money(amount), False) for name, amount in charged]
    for label, figure, bold in figures + [(invoice["amount_due_label"], money(total), True)]:
        cells = summary.add_row().cells
        align_right(cells[0], label, bold)
        align_right(cells[1], figure, bold)
    if invoice.get("trust_applied"):
        document.add_paragraph(invoice["trust_applied"])
    document.add_paragraph()
    add_block(document, invoice["closing"])
    for item in invoice["after"]:
        paragraph = add_block(document)
        if item.get("bold"):
            paragraph.add_run(f"{item['bold']} ").bold = True
        paragraph.add_run(item.get("text", ""))


def word_convert(docx_path, pdf_path):
    # Paths travel in environment variables, never in the script. No $doc.Close(): Word can drop
    # the COM connection there after a good export, and Quit(0) closes without saving.
    script = ('$ErrorActionPreference = "Stop"\n'
              '$word = New-Object -ComObject Word.Application\n'
              '$word.Visible = $false\n'
              'try {\n'
              '    $doc = $word.Documents.Open($env:INVOICE_DOCX)\n'
              '    $doc.ExportAsFixedFormat($env:INVOICE_PDF, 17)\n'
              '} finally {\n'
              '    $word.Quit([ref]0)\n'
              '}\n')
    env = {**os.environ, "INVOICE_DOCX": str(docx_path.resolve()), "INVOICE_PDF": str(pdf_path.resolve())}
    proc = subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", script],
                          capture_output=True, text=True, timeout=120, env=env)
    if proc.returncode != 0 or not pdf_path.is_file():
        raise RuntimeError(f"rc={proc.returncode} stderr={proc.stderr.strip()!r}")


def soffice_convert(docx_path, pdf_path):
    with tempfile.TemporaryDirectory() as out_dir:
        proc = subprocess.run(["soffice", "--headless", "--convert-to", "pdf", "--outdir", out_dir, str(docx_path)],
                              capture_output=True, text=True, timeout=120)
        produced = Path(out_dir) / f"{docx_path.stem}.pdf"
        if proc.returncode != 0 or not produced.is_file():
            raise RuntimeError(f"rc={proc.returncode} stderr={proc.stderr.strip()!r}")
        shutil.copyfile(produced, pdf_path)


def convert(docx_path, pdf_path):
    errors = []
    for name, step in (("word", word_convert), ("soffice", soffice_convert)):
        try:
            step(docx_path, pdf_path)
            return
        except (OSError, RuntimeError, subprocess.SubprocessError) as err:
            errors.append(f"{name}: {err}")
    raise Refusal("pdf_failed", f"the .docx was written, but no PDF: {'; '.join(errors)}")


def render(args):
    try:
        import docx
    except ImportError as err:
        raise Refusal("python_docx_missing", "this step needs the python-docx package") from err
    invoice = load(args.invoice, "invoice")
    lines = load(args.lines, "lines")
    check_invoice(invoice)
    subtotal, charged, total = totals(lines, invoice["taxes"])
    out_dir = Path(args.out_dir)
    if not out_dir.is_dir():
        raise Refusal("no_out_dir", str(out_dir))
    try:
        document = docx.Document(args.letterhead)
    except Exception as err:  # python-docx raises several unrelated types on a bad package
        raise Refusal("bad_letterhead", f"{args.letterhead}: {err}") from err
    prepare_letterhead(document, invoice["tokens"])
    write_body(document, invoice, lines, subtotal, charged, total)
    stem = free_stem(out_dir, args.out_name)
    docx_path = out_dir / f"{stem}.docx"
    document.save(docx_path)
    result = {"docx": str(docx_path), "fees": str(subtotal),
              "taxes": {name: str(amount) for name, amount in charged}, "total": str(total)}
    if stem != args.out_name:
        result["versioned_from"] = args.out_name
    if args.pdf:
        pdf_path = out_dir / f"{stem}.pdf"
        convert(docx_path, pdf_path)
        result["pdf"] = str(pdf_path)
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--invoice", required=True)
    parser.add_argument("--lines", required=True)
    parser.add_argument("--letterhead", required=True)
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--out-name", required=True)
    parser.add_argument("--pdf", action="store_true")
    try:
        print(json.dumps(render(parser.parse_args(argv))))
    except Refusal as refused:
        print(json.dumps({"error": refused.code, "detail": refused.detail}))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
