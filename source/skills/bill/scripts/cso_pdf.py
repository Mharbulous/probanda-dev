"""Read one Court Services Online PDF's fees from its text layer, for collect_disbursements.py.

read(path) returns a dict with "kind":
  sheet       "fees" [{"document", "amount", "flags"}], "package_fee", "package_fee_flags", "package_id", "filing_date"
  receipt     "amount", "fee_kind", "package_id", "filing_date"
  scanned     "pages": the scanned page numbers. No text is read: a scan is read from its images, never its
              text layer (/matter-data's design decision #71), so the file takes the pdf_pages__images route.
  unread      "reason": a CSO file whose layout was not recognised, or a PDF that would not open
  other       not a CSO file
Amounts are Decimals. Needs PyMuPDF.
"""
import re
from datetime import datetime
from decimal import Decimal
from math import ceil

import pymupdf

MIN_IMAGE_COVER = 0.5  # the same page test as pdf_pages__images
MAX_TEXT_COVER = 0.05
GRID = 100
ROW_TOLERANCE = 3

AMOUNT = re.compile(r"\$\s*(\d[\d,]*(?:\.\d{2})?)")
PACKAGE_INLINE = re.compile(r"package\s*(?:id|number|no\.?|#)?\s*[:#]?\s*(\d{5,})", re.I)
PACKAGE_LABEL = re.compile(r"package\s*(?:id|number|no\b|#)", re.I)
LONG_NUMBER = re.compile(r"\b\d{5,}\b")
STATUS = re.compile(r"\b(?:Submitted|Not Processed|Processed|Filed|Accepted|Rejected)\b")
DATE_LABEL = re.compile(r"\b(?:date|submitted|filed)\b", re.I)
DATE_FORMS = ((re.compile(r"\b\d{4}[-/]\d{2}[-/]\d{2}\b"), ("%Y %m %d",)),
              (re.compile(r"\b[A-Z][a-z]{2,8}\.? \d{1,2},? \d{4}\b"), ("%B %d %Y", "%b %d %Y")),
              (re.compile(r"\b\d{1,2}[- ][A-Z][a-z]{2,8}[- ]\d{4}\b"), ("%d %B %Y", "%d %b %Y")))
CSO_HINT = re.compile(r"court services online|\bcso\b|\bsubsht\b", re.I)


def coverage(rects, page_rect):
    """The share of the page that the rectangles cover, on a grid, overlaps counted once."""
    def cell(value, span):
        return min(GRID, max(0, ceil(value / span * GRID - 0.5)))

    cells = set()
    for x0, y0, x1, y1 in rects:
        columns = range(cell(x0, page_rect.width), cell(x1, page_rect.width))
        for row in range(cell(y0, page_rect.height), cell(y1, page_rect.height)):
            cells.update((row, column) for column in columns)
    return len(cells) / (GRID * GRID)


def is_scanned(page):
    images = [info["bbox"] for info in page.get_image_info()]
    if coverage(images, page.rect) < MIN_IMAGE_COVER:
        return False
    spans = page.get_texttrace()
    if any(span["type"] == 3 for span in spans):  # 3 is invisible text, an OCR layer over a scan
        return True
    return coverage([span["bbox"] for span in spans], page.rect) < MAX_TEXT_COVER


def page_rows(page):
    """The page's text as rows: a table's cells on one line come back as one row, left to right."""
    rows, top = [], None
    for word in sorted(page.get_text("words"), key=lambda w: w[1]):
        if top is None or word[1] - top > ROW_TOLERANCE:
            rows.append([])
            top = word[1]
        rows[-1].append(word)
    return [" ".join(w[4] for w in sorted(row, key=lambda w: w[0])) for row in rows]


def amounts_in(row):
    return [Decimal(found.replace(",", "")) for found in AMOUNT.findall(row)]


def package_id_in(rows):
    for number, row in enumerate(rows):
        found = PACKAGE_INLINE.search(row)
        if found:
            return found.group(1)
        if PACKAGE_LABEL.search(row) and number + 1 < len(rows):  # a table: the label heads a column
            found = LONG_NUMBER.search(rows[number + 1])
            if found:
                return found.group(0)
    return None


def date_in(text):
    for pattern, formats in DATE_FORMS:
        found = pattern.search(text)
        if found:
            cleaned = re.sub(r"[-/]", " ", found.group(0).replace(",", "").replace(".", ""))
            for form in formats:
                try:
                    return datetime.strptime(cleaned, form).date().isoformat()
                except ValueError:
                    pass
    return None


def filing_date_in(rows):
    labelled = [row for row in rows if DATE_LABEL.search(row)]
    for row in labelled + rows:
        found = date_in(row)
        if found:
            return found
    return None


def section(rows, start, end):
    if start is None:
        return []
    return rows[start + 1:end] if end is not None and end > start else rows[start + 1:]


def heading_at(rows, words):
    return next((n for n, row in enumerate(rows) if words in row.lower()), None)


def fee_of(row):
    """A Document Summary row's fee: the first amount is the fee, a second is the Fee Collected column."""
    amounts = amounts_in(row)
    if not amounts or not amounts[0] or re.search(r"\btotal\b", row, re.I):
        return None
    flags = []
    if re.search(r"not\s+processed", row, re.I):
        flags.append("not_processed")
    if "Rejected" in row:
        flags.append("rejected")
    collected = amounts[1] if len(amounts) > 1 else None
    if not collected:
        flags.append("fee_collected_blank")
    elif collected != amounts[0]:
        flags.append("fee_collected_differs")
    name = (STATUS.split(row, maxsplit=1)[0] if STATUS.search(row) else AMOUNT.split(row, maxsplit=1)[0])
    return {"document": re.sub(r"^\d+\s+", "", name).strip() or "Document fee", "amount": amounts[0], "flags": flags, "collected": collected}


def read_sheet(rows):
    documents, transactions = heading_at(rows, "document summary"), heading_at(rows, "transaction summary")
    fees = [fee for fee in map(fee_of, section(rows, documents, transactions)) if fee]
    charged = [row for row in section(rows, transactions, documents) if amounts_in(row)]
    named = next((row for row in charged if re.search(r"package\s+submission", row, re.I)), None)
    package_fee = amounts_in(named or charged[-1])[-1] if charged else None
    clear = named or (len(charged) == 1 and not any(fee["collected"] for fee in fees))
    if not fees and not package_fee:
        return {"kind": "unread", "reason": "submission sheet with no fee line and no transaction summary amount"}
    return {"kind": "sheet", "fees": fees, "package_fee": package_fee, "package_fee_flags": [] if clear or not charged else ["transaction_summary_unclear"],
            "package_id": package_id_in(rows), "filing_date": filing_date_in(rows)}


def read_receipt(rows, text):
    totals = [row for row in rows if re.search(r"\btotal\b", row, re.I) and amounts_in(row)]
    if not re.search(r"package", text, re.I) or not totals:
        return None
    fee_kind = ("package_submission_fee" if re.search(r"package\s+submission", text, re.I)
                else "court_filing_fee" if re.search(r"filing\s+fee", text, re.I) else "cso_fee")
    return {"kind": "receipt", "amount": amounts_in(totals[-1])[-1], "fee_kind": fee_kind, "package_id": package_id_in(rows), "filing_date": filing_date_in(rows)}


def read(path):
    try:
        with pymupdf.open(path) as doc:
            scanned = [number for number, page in enumerate(doc, 1) if is_scanned(page)]
            if scanned:
                return {"kind": "scanned", "pages": scanned}
            rows = [row for page in doc for row in page_rows(page)]
    except (OSError, ValueError, RuntimeError) as err:  # PyMuPDF's errors derive from RuntimeError and ValueError
        return {"kind": "unread", "reason": f"cannot open: {err}"}
    text = "\n".join(rows)
    if heading_at(rows, "document summary") is not None:
        return read_sheet(rows)
    receipt = read_receipt(rows, text)
    if receipt:
        return receipt
    if CSO_HINT.search(text) or CSO_HINT.search(str(path)):
        return {"kind": "unread", "reason": "names Court Services Online, but the layout was not recognised"}
    return {"kind": "other"}
