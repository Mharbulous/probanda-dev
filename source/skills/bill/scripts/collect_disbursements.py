#!/usr/bin/env python3
"""Turn a matter's receipts and Court Services Online sheets into disbursement lines, each fee once.

    collect_disbursements.py --out F [--receipts F] [--cso-dir DIR ...] [--from DATE] [--to DATE]
                             [--billing-settings F] [--decisions F]

At least one of --receipts and --cso-dir is required. Reads its inputs only, and writes only --out.

--receipts is a JSON array of {"path", "description", "amount", "taxable"}, amount a decimal string,
taxable true, false or left out. These optional fields carry what the session read from a scanned page:
"line" (a label that tells one sheet's fee lines apart, which also makes the entry a sheet line),
"package_id", "filing_date" (YYYY-MM-DD), "kind" and "flags" (a list, from the flags below).

--cso-dir is a folder searched for PDFs, repeated for each folder. A submission sheet gives one line per
Document Summary fee and one for the package fee in its Transaction Summary, and a receipt gives its total.
--from and --to, inclusive, move a dated line outside them to "outside_period".

Copies are the same bytes: two names for one file count once, the extra names are listed in "duplicates"
and in the line's "sources". A receipt and a sheet line with one Package ID and one amount are one fee: the
line takes the receipt as its receipt_path, and source_file stays the sheet. Two copies stated at different
amounts, or two sheets for one package with different fees, stop the run.

Flags name what the practitioner must decide: not_processed, rejected, fee_collected_blank,
fee_collected_differs, transaction_summary_unclear, no_package_id, no_filing_date, possible_duplicate,
matches_no_sheet_line. A line with any of them has "confirm": true and counts in "unconfirmed_subtotal", not
"subtotal". Its fee is never dropped. Tax status is never guessed: it comes from the line, or from
--billing-settings' {"disbursement_tax": {kind: true or false}} for the kinds court_filing_fee,
package_submission_fee and cso_fee. Otherwise "taxable" stays null with the flag tax_status_undecided, and the
line counts in no taxable subtotal.

--decisions is {line_key: {"charged": true or false, "taxable": true or false}}, either field optional, and
holds the practitioner's answers. charged true clears "confirm", charged false moves the line to "not_charged",
and an unknown key stops the run. Line keys stay the same from run to run.

Writes {"lines": [{"line_key", "line_kind", "description", "amount", "taxable", "receipt_hash", "receipt_path",
"source_file", "sources", "kind", "package_id", "filing_date", "flags", "confirm"}], "subtotal",
"taxable_subtotal", "unconfirmed_subtotal", "undecided": [line keys], "duplicates": [{"path", "same_as"}],
"needs_scanned_route": [{"path", "pages", "hash"}], "unread": [{"path", "reason"}], "other_files": [paths],
"outside_period": [lines], "not_charged": [lines]} and prints one JSON line of counts. A scanned file's text
layer is never read: read the pages by pdf_pages__images, and pass each fee back through --receipts, which
clears the file from "needs_scanned_route". A bad input stops with a message on stderr and exit 2.
"""
import argparse
import hashlib
import json
import sys
from decimal import Decimal, InvalidOperation
from pathlib import Path

TAX_FLAG = "tax_status_undecided"
RECEIPT_LABELS = {"package_submission_fee": "Court Services Online package submission fee", "court_filing_fee": "Court filing fee"}


def stop(message):
    sys.stderr.write(f"collect_disbursements: {message}\n")
    sys.exit(2)


def file_hash(path):
    try:
        return hashlib.sha256(Path(path).read_bytes()).hexdigest()
    except OSError as err:
        stop(f"cannot read receipt {path}: {err}")


def amount_of(receipt):
    try:
        return Decimal(str(receipt["amount"]))
    except (KeyError, InvalidOperation) as err:
        stop(f"receipt {receipt.get('path')} has no usable amount: {err!r}")


def load_json(path, what):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError) as err:
        stop(f"cannot read {what} {path}: {err}")


def make_line(key, description, amount, digest, path, kind=None, package_id=None, filing_date=None, taxable=None, flags=()):
    return {"line_key": key, "line_kind": "disbursement", "description": description, "amount": str(amount),
            "taxable": taxable if isinstance(taxable, bool) else None, "receipt_hash": digest, "receipt_path": path, "source_file": path, "sources": [path],
            "kind": kind, "package_id": package_id, "filing_date": filing_date, "flags": list(flags), "confirm": False}


class Collection:
    """The lines so far, by file hash, with every copy of a file noted against them."""

    def __init__(self):
        self.sheet_lines, self.receipts, self.duplicates = [], [], []
        self.first_path = {}  # file hash to the first name it was seen under

    def seen(self, digest, path):
        """True when this file's bytes were already taken, noting this name as a copy of them."""
        first = self.first_path.get(digest)
        if first is None:
            self.first_path[digest] = path
            return False
        if Path(path).resolve() != Path(first).resolve():
            self.duplicates.append({"path": path, "same_as": first})
            for line in self.sheet_lines + self.receipts:
                if line["receipt_hash"] == digest:
                    line["sources"].append(path)
        return True

    def add_stated(self, entries):
        held = {}
        for entry in entries:
            digest = file_hash(entry["path"])
            amount = amount_of(entry)
            label = entry.get("line")
            line_key = f"disbursement:{digest[:12]}" + (f":{label}" if label is not None else "")
            line = held.get(line_key)
            if line:
                if Decimal(line["amount"]) != amount:
                    stop(f"{entry['path']} and {line['receipt_path']} are one receipt stated at two amounts")
                self.duplicates.append({"path": entry["path"], "same_as": line["receipt_path"]})
                line["sources"].append(entry["path"])
                continue
            self.first_path.setdefault(digest, entry["path"])
            line = make_line(line_key, entry["description"], amount, digest, entry["path"], entry.get("kind"), entry.get("package_id"),
                             entry.get("filing_date"), entry.get("taxable"), entry.get("flags") or ())
            held[line_key] = line
            (self.receipts if label is None else self.sheet_lines).append(line)


def parsed_flags(read):
    return ([] if read["package_id"] else ["no_package_id"]) + ([] if read["filing_date"] else ["no_filing_date"])


def submitted(read):
    return f", submitted {read['filing_date']}" if read["filing_date"] else ""


def sheet_lines_of(read, digest, path):
    parsed = {"package_id": read["package_id"], "filing_date": read["filing_date"]}
    lines = [make_line(f"disbursement:{digest[:12]}:{number}", f"Court filing fee: {fee['document']}{submitted(read)}", fee["amount"], digest, path,
                       "court_filing_fee", flags=fee["flags"] + parsed_flags(read), **parsed) for number, fee in enumerate(read["fees"], 1)]
    if read["package_fee"]:
        lines.append(make_line(f"disbursement:{digest[:12]}:package", f"Court Services Online package submission fee{submitted(read)}", read["package_fee"], digest, path,
                               "package_submission_fee", flags=read["package_fee_flags"] + parsed_flags(read), **parsed))
    return lines


def receipt_line_of(read, digest, path):
    label = RECEIPT_LABELS.get(read["fee_kind"], "Court Services Online fee")
    return make_line(f"disbursement:{digest[:12]}", label + submitted(read), read["amount"], digest, path, read["fee_kind"], read["package_id"], read["filing_date"], flags=parsed_flags(read))


def fees_of(lines):
    return sorted(Decimal(line["amount"]) for line in lines)


def add_sheet(read, digest, path, found, sheets):
    """Add one sheet's lines, unless its package is already held: then the same fees are a copy, and different fees stop the run."""
    lines = sheet_lines_of(read, digest, path)
    package = read["package_id"]
    if not package or package not in sheets:
        found.sheet_lines.extend(lines)
        sheets[package] = path
        return
    held = [line for line in found.sheet_lines if line["package_id"] == package]
    if fees_of(held) != fees_of(lines):
        stop(f"{path} and {sheets[package]} state different fees for package {package}")
    found.duplicates.append({"path": path, "same_as": sheets[package]})
    for line in held:
        line["sources"].append(path)


def read_folders(folders, found):
    """Read every PDF under the folders into the collection. Returns what could not be read as a fee."""
    try:
        import cso_pdf
    except ImportError as err:
        stop(f"{err.name or err} is not installed for the Python running this script ({sys.executable}). Install it into that interpreter: "
             f'"{sys.executable}" -m pip install PyMuPDF. If this is a Cowork cloud sandbox, which blocks pypi, run the script on the PC instead.')
    for folder in folders:
        if not Path(folder).is_dir():
            stop(f"no such folder: {folder}")
    needs_scanned, unread, other = [], [], []
    sheets = {line["package_id"]: line["source_file"] for line in found.sheet_lines if line["package_id"]}
    paths = sorted({path for folder in folders for path in Path(folder).rglob("*") if path.is_file() and path.suffix.lower() == ".pdf"})
    for pdf in paths:
        path, digest = str(pdf), file_hash(pdf)
        if found.seen(digest, path):
            continue
        read = cso_pdf.read(pdf)
        if read["kind"] == "scanned":
            needs_scanned.append({"path": path, "pages": read["pages"], "hash": digest})
        elif read["kind"] == "unread":
            unread.append({"path": path, "reason": read["reason"]})
        elif read["kind"] == "other":
            other.append(path)
        elif read["kind"] == "receipt":
            found.receipts.append(receipt_line_of(read, digest, path))
        else:
            add_sheet(read, digest, path, found, sheets)
            if not read["package_fee"]:
                unread.append({"path": path, "reason": "submission sheet with no package fee in a transaction summary"})
    return needs_scanned, unread, other


def link_receipts(sheet_lines, receipts):
    """One fee, counted once: each receipt joins the sheet line with its Package ID and amount. Returns the receipts left over."""
    linked, left = set(), []
    for receipt in receipts:
        package = receipt["package_id"]
        amount = Decimal(receipt["amount"])
        for_package = [line for line in sheet_lines if package and line["package_id"] == package]
        match = next((line for line in for_package if line["line_key"] not in linked and Decimal(line["amount"]) == amount), None)
        if match:
            linked.add(match["line_key"])
            match["receipt_hash"], match["receipt_path"] = receipt["receipt_hash"], receipt["receipt_path"]
            match["sources"] += receipt["sources"]
            match["filing_date"] = match["filing_date"] or receipt["filing_date"]
            if match["taxable"] is None:
                match["taxable"] = receipt["taxable"]
            continue
        same_package = for_package + [line for line in left if package and line["package_id"] == package]
        if any(Decimal(line["amount"]) == amount for line in same_package):
            receipt["flags"].append("possible_duplicate")
        elif for_package:
            receipt["flags"].append("matches_no_sheet_line")
        left.append(receipt)
    return left


def settle(lines, settings, decisions):
    """Apply the tax settings and the practitioner's decisions. Returns the lines still charged and those decided not charged."""
    tax_by_kind = (settings or {}).get("disbursement_tax") or {}
    unknown = set(decisions) - {line["line_key"] for line in lines}
    if unknown:
        stop(f"decisions name lines this run does not hold: {', '.join(sorted(unknown))}")
    kept, not_charged = [], []
    for line in lines:
        decision = decisions.get(line["line_key"], {})
        for taxable in (decision.get("taxable"), line["taxable"], tax_by_kind.get(line["kind"])):
            if isinstance(taxable, bool):
                line["taxable"] = taxable
                break
        if line["taxable"] is None:
            line["flags"].append(TAX_FLAG)
        line["confirm"] = any(flag != TAX_FLAG for flag in line["flags"]) and decision.get("charged") is not True
        (not_charged if decision.get("charged") is False else kept).append(line)
    return kept, not_charged


def in_period(line, start, end):
    when = line["filing_date"]
    return not when or ((not start or when >= start) and (not end or when <= end))


def total(lines):
    return str(sum((Decimal(line["amount"]) for line in lines), Decimal(0)))


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--receipts")
    parser.add_argument("--cso-dir", action="append", default=[])
    parser.add_argument("--from", dest="date_from")
    parser.add_argument("--to", dest="date_to")
    parser.add_argument("--billing-settings")
    parser.add_argument("--decisions")
    parser.add_argument("--out", required=True)
    args = parser.parse_args(argv)
    if not args.receipts and not args.cso_dir:
        stop("give --receipts, --cso-dir or both")

    found = Collection()
    found.add_stated(load_json(args.receipts, "receipts") if args.receipts else [])
    needs_scanned, unread, other = read_folders(args.cso_dir, found) if args.cso_dir else ([], [], [])
    all_lines = found.sheet_lines + link_receipts(found.sheet_lines, found.receipts)
    outside = [line for line in all_lines if not in_period(line, args.date_from, args.date_to)]
    inside = [line for line in all_lines if in_period(line, args.date_from, args.date_to)]
    settings = load_json(args.billing_settings, "billing settings") if args.billing_settings else {}
    decisions = load_json(args.decisions, "decisions") if args.decisions else {}
    rows, not_charged = settle(inside, settings, decisions)

    certain = [row for row in rows if not row["confirm"]]
    result = {"lines": rows, "subtotal": total(certain), "taxable_subtotal": total(row for row in certain if row["taxable"] is True),
              "unconfirmed_subtotal": total(row for row in rows if row["confirm"]),
              "undecided": [row["line_key"] for row in rows if row["confirm"] or row["taxable"] is None], "duplicates": found.duplicates,
              "needs_scanned_route": needs_scanned, "unread": unread, "other_files": other, "outside_period": outside, "not_charged": not_charged}
    Path(args.out).write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps({"lines": len(rows), "duplicates": len(found.duplicates), "subtotal": result["subtotal"], "unconfirmed_subtotal": result["unconfirmed_subtotal"],
                      "undecided": len(result["undecided"]), "needs_scanned_route": len(needs_scanned), "unread": len(unread), "outside_period": len(outside)}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
