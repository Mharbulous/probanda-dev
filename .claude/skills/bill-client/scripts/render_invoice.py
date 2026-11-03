#!/usr/bin/env python3
"""Fill the firm's invoice template to a draft invoice, marked DRAFT and never signed.

    render_invoice.py --invoice invoice.json --lines invoice_lines.json --template invoice.docx
                      [--disbursements disbursements.json] --out-dir DIR --out-name STEM [--pdf]

--lines is tie_out.py's invoice_lines.json, written only on a pass. --disbursements is
collect_disbursements.py's output. This script recomputes every amount and refuses a figure that does
not tie, a lines file with no pass stamp, a line with neither evidence nor a recorded estimate basis, a
disbursement with its tax status unset or a flag undecided, and a dollar amount in the template's fixed
wording, which could carry an old figure. Taxable services and taxable disbursements are the base for
each tax, and non-taxable disbursements go below the taxes. --invoice holds what changes per bill, each
key required unless marked:
    invoice_date, our_ref, bill_number, salutation
    addressee, re   [line, ...]
    delivery        optional, a delivery line
    tokens          {"{{TOKEN}}": value}: the letterhead's tokens
    taxes           [{"name", "rate"}, ...], rate as a decimal string such as "0.05"
    trust_balance   optional, the matter's trust balance as a decimal string. The trust applied is
                    the lesser of it and the total. Nothing moves.
    chart           optional, the path of the chart's image

The layout and all other wording are the template's. Any other key is refused, so a signature cannot
reach the page: this script takes no signature input and adds no image but the chart. A row or paragraph
whose field has no value is removed, and a template that has lost a required field is refused. Never
overwrites: a taken name gets the next " vN". With --pdf it also writes the PDF, by Word and then by
soffice. Prints one JSON line. On a refusal it prints {"error", "detail"} and exits 1, writing nothing.
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from copy import deepcopy
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from pathlib import Path

try:
    import docx
    from docx.oxml.ns import qn
    from docx.text.paragraph import Paragraph
except ImportError:
    docx = None

CENT = Decimal("0.01")
REQUIRED = {"invoice_date", "our_ref", "bill_number", "addressee", "salutation", "re", "tokens", "taxes"}
OPTIONAL = {"delivery", "trust_balance", "chart"}
TEMPLATE_FIELDS = {"{{%s}}" % name for name in (
    "INVOICE_DATE", "OUR_REF", "BILL_NUMBER", "ADDRESSEE", "DELIVERY", "SALUTATION", "RE", "CHART", "LINE_DATE", "LINE_DESCRIPTION",
    "LINE_HOURS", "TAXABLE_SERVICES", "TAXABLE_DISBURSEMENTS", "SUBTOTAL", "TAX_NAME", "TAX_AMOUNT", "NON_TAXABLE_DISBURSEMENTS",
    "TOTAL", "TRUST_APPLIED", "AMOUNT_DUE")}
TOKEN = re.compile(r"\{\{[A-Z_]+\}\}")
DRAFT_MARK = "DRAFT: not issued and not signed"


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
    for key in ("addressee", "re"):
        if not isinstance(invoice[key], list):
            raise Refusal("bad_field", f"{key} must be a list of lines")
    with_amount = [text for text in invoice["re"] if "$" in text]
    if with_amount:
        raise Refusal("amount_in_wording", "; ".join(with_amount))
    if invoice.get("chart") and not Path(invoice["chart"]).is_file():
        raise Refusal("chart_missing", invoice["chart"])


def disbursement_totals(disbursements):
    """(taxable, non-taxable), recomputed. Refuses an unset tax status, an undecided flag or a total that does not tie."""
    taxable = non_taxable = Decimal(0)
    for line in disbursements["lines"]:
        if line.get("taxable") not in (True, False):
            raise Refusal("taxable_unset", f"Say whether this disbursement is taxable: {line['description']}")
        if line.get("flags") and not line.get("decided"):
            raise Refusal("undecided_line", f"Decide this flagged disbursement: {line['description']}")
        if line["taxable"]:
            taxable += Decimal(line["amount"])
        else:
            non_taxable += Decimal(line["amount"])
    if taxable != Decimal(disbursements["taxable_subtotal"]) or taxable + non_taxable != Decimal(disbursements["subtotal"]):
        raise Refusal("subtotal_mismatch", f"disbursements: {disbursements['subtotal']} against {taxable + non_taxable}")
    return taxable, non_taxable


def totals(lines, taxes, disbursements, trust_balance):
    """Recompute from each row's hours and rate. Refuses a figure that does not tie."""
    rows = lines.get("rows") or []
    if not lines.get("passed_on"):
        raise Refusal("not_passed", "the lines file carries no pass stamp")
    if not rows:
        raise Refusal("no_lines", "the lines file holds no rows")
    try:
        fees = Decimal(0)
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
            fees += amount
        if fees != Decimal(lines["subtotal"]):
            raise Refusal("subtotal_mismatch", f"{lines['subtotal']} against {fees}")
        taxable, non_taxable = disbursement_totals(disbursements) if disbursements else (Decimal(0), Decimal(0))
        subtotal = fees + taxable
        charged = [(tax["name"], (subtotal * Decimal(tax["rate"])).quantize(CENT, ROUND_HALF_UP)) for tax in taxes]
        total = subtotal + sum(amount for _, amount in charged) + non_taxable
        balance = Decimal(trust_balance or 0)
        if balance < 0:
            raise Refusal("bad_figure", f"trust balance {balance}")
    except (KeyError, InvalidOperation, TypeError) as err:
        raise Refusal("bad_figure", repr(err)) from err
    return {"fees": fees, "taxable_disbursements": taxable, "non_taxable_disbursements": non_taxable, "subtotal": subtotal,
            "taxes": charged, "total": total, "trust_balance": balance, "trust_applied": min(balance, total)}


def free_stem(out_dir, stem):
    """The stem itself, or the next " vN" with no .docx or .pdf of that name."""
    candidate, n = stem, 1
    while (out_dir / f"{candidate}.docx").exists() or (out_dir / f"{candidate}.pdf").exists():
        n += 1
        candidate = f"{stem} v{n}"
    return candidate


def stories(document):
    """The body and every header and footer the document defines."""
    yield document._body
    for section in document.sections:
        for part in (section.header, section.first_page_header, section.even_page_header,
                     section.footer, section.first_page_footer, section.even_page_footer):
            if not part.is_linked_to_previous:
                yield part


def paragraphs_of(story, element=None):
    """Every paragraph, including those in tables and text boxes."""
    return [Paragraph(p, story) for p in (story._element if element is None else element).iter(qn("w:p"))]


def own_text(paragraph):
    return "".join(run.text for run in paragraph.runs)


def fill_paragraph(paragraph, values):
    """Replace each field that has a value, keeping each run's formatting. A value takes the run its field starts in."""
    runs = paragraph.runs
    texts = [run.text for run in runs]
    for match in reversed(list(TOKEN.finditer("".join(texts)))):
        if match.group() not in values:
            continue
        at = 0
        for index, piece in enumerate(texts):
            begin, end = max(match.start() - at, 0), min(match.end() - at, len(piece))
            if begin < end:
                texts[index] = piece[:begin] + (values[match.group()] if at <= match.start() else "") + piece[end:]
            at += len(piece)
    for run, text in zip(runs, texts):
        if run.text != text:
            run.text = text


def repeat_rows(document, prefix, items):
    """One row per item, cycling through the rows that hold a field with this prefix, so a plain row and a tinted one alternate."""
    body = document._body
    patterns = [tr for tr in body._element.iter(qn("w:tr"))
                if any(prefix in own_text(paragraph) for paragraph in paragraphs_of(body, tr))]
    for index, item in enumerate(items):
        row = deepcopy(patterns[index % len(patterns)])
        patterns[0].addprevious(row)
        for paragraph in paragraphs_of(body, row):
            fill_paragraph(paragraph, item)
    for tr in patterns:
        tr.getparent().remove(tr)


def remove_empty(story, values):
    """Remove each paragraph with a field that has no value, or its whole table row."""
    for paragraph in paragraphs_of(story):
        if any(values.get(token, "") is None for token in TOKEN.findall(own_text(paragraph))):
            target = next(paragraph._p.iterancestors(qn("w:tr")), paragraph._p)
            if target.getparent() is not None:
                target.getparent().remove(target)


def check_template(document):
    """Refuses a dollar amount in the fixed wording, or a required field the template has lost."""
    texts = [own_text(paragraph) for story in stories(document) for paragraph in paragraphs_of(story)]
    with_amount = [text for text in texts if "$" in text]
    if with_amount:
        raise Refusal("amount_in_wording", "; ".join(with_amount))
    lost = TEMPLATE_FIELDS - {token for text in texts for token in TOKEN.findall(text)}
    if lost:
        raise Refusal("template_field_missing", ", ".join(sorted(lost)))


def place_chart(document, chart):
    section = document.sections[0]
    for paragraph in paragraphs_of(document._body):
        if "{{CHART}}" in own_text(paragraph):
            for run in paragraph.runs:
                run.text = ""
            paragraph.runs[0].add_picture(chart, width=section.page_width - section.left_margin - section.right_margin)


def shown(amount):
    return money(amount) if amount else None


def fill_template(document, invoice, lines, figures):
    check_template(document)
    repeat_rows(document, "{{LINE_", [{"{{LINE_DATE}}": r["date"], "{{LINE_BY}}": r["initials"], "{{LINE_DESCRIPTION}}": r["description"],
                                       "{{LINE_HOURS}}": r["hours"], "{{LINE_RATE}}": money(Decimal(r["rate"])),
                                       "{{LINE_AMOUNT}}": money(Decimal(r["amount"]))} for r in lines["rows"]])
    repeat_rows(document, "{{TAX_", [{"{{TAX_NAME}}": name, "{{TAX_AMOUNT}}": money(amount)} for name, amount in figures["taxes"]])
    if invoice.get("chart"):
        place_chart(document, invoice["chart"])
    values = {**invoice["tokens"], "{{INVOICE_DATE}}": invoice["invoice_date"], "{{OUR_REF}}": invoice["our_ref"],
              "{{BILL_NUMBER}}": invoice["bill_number"], "{{ADDRESSEE}}": "\n".join(invoice["addressee"]),
              "{{DELIVERY}}": invoice.get("delivery"), "{{SALUTATION}}": invoice["salutation"], "{{RE}}": "\n".join(invoice["re"]),
              "{{CHART}}": None, "{{TAXABLE_SERVICES}}": money(figures["fees"]),
              "{{TAXABLE_DISBURSEMENTS}}": shown(figures["taxable_disbursements"]), "{{SUBTOTAL}}": money(figures["subtotal"]),
              "{{NON_TAXABLE_DISBURSEMENTS}}": shown(figures["non_taxable_disbursements"]), "{{TOTAL}}": money(figures["total"]),
              "{{TRUST_APPLIED}}": shown(figures["trust_applied"]), "{{TRUST_BALANCE}}": shown(figures["trust_balance"]),
              "{{AMOUNT_DUE}}": money(figures["total"] - figures["trust_applied"])}
    for story in stories(document):
        remove_empty(story, values)
        for paragraph in paragraphs_of(story):
            fill_paragraph(paragraph, values)
    left = [token for story in stories(document) for paragraph in paragraphs_of(story) for token in TOKEN.findall(own_text(paragraph))]
    if left:
        raise Refusal("missing_token", ", ".join(left))
    for section in document.sections:
        for header in (section.header, section.first_page_header):
            header.add_paragraph().add_run(DRAFT_MARK).bold = True


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
    if docx is None:
        raise Refusal("python_docx_missing", "this step needs the python-docx package")
    invoice = load(args.invoice, "invoice")
    lines = load(args.lines, "lines")
    check_invoice(invoice)
    disbursements = load(args.disbursements, "disbursements") if args.disbursements else None
    figures = totals(lines, invoice["taxes"], disbursements, invoice.get("trust_balance"))
    out_dir = Path(args.out_dir)
    if not out_dir.is_dir():
        raise Refusal("no_out_dir", str(out_dir))
    try:
        document = docx.Document(args.template)
    except Exception as err:  # python-docx raises several unrelated types on a bad package
        raise Refusal("bad_template", f"{args.template}: {err}") from err
    fill_template(document, invoice, lines, figures)
    stem = free_stem(out_dir, args.out_name)
    docx_path = out_dir / f"{stem}.docx"
    document.save(docx_path)
    result = {"docx": str(docx_path), "fees": str(figures["fees"]), "taxable_disbursements": str(figures["taxable_disbursements"]),
              "non_taxable_disbursements": str(figures["non_taxable_disbursements"]),
              "taxes": {name: str(amount) for name, amount in figures["taxes"]}, "total": str(figures["total"]),
              "trust_applied": str(figures["trust_applied"]), "amount_due": str(figures["total"] - figures["trust_applied"])}
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
    parser.add_argument("--template", required=True)
    parser.add_argument("--disbursements")
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
