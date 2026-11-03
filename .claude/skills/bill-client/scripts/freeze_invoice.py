#!/usr/bin/env python3
"""Write an issued invoice's frozen copy: everything behind each line, as it stood when it issued.

    freeze_invoice.py --line-map F --meta F --out-dir DIR --data-dir DIR [--disbursements F]

--line-map is tie_out.py's line_map.json. --disbursements is collect_disbursements.py's output. --meta
is {"matter", "invoice_number", "issue_date", "date_to", "amount", "taxes", "signed_copy_path",
"trust_application"}, amount and taxes as decimal strings, trust_application optional.

Writes two files to --out-dir, `<date> Invoice <number> audit.json` and `.md`, and refuses if either
exists: a frozen copy is never rewritten. The JSON file's sha256 is the snapshot hash, printed and
named in issue_records.json, which goes to --data-dir with the lines and adjustments for the issue
record. Refuses when fees, disbursements and taxes do not add up to the amount, a fee line has neither
evidence nor an estimate basis, or the signed copy cannot be read. Prints one JSON line. On a
refusal it prints {"error", "detail"} and exits 1, writing nothing.
"""
import argparse
import hashlib
import json
import sys
from decimal import Decimal, InvalidOperation
from pathlib import Path

REQUIRED_META = ("matter", "invoice_number", "issue_date", "date_to", "amount", "taxes", "signed_copy_path")


class Refusal(Exception):
    def __init__(self, code, detail):
        super().__init__(detail)
        self.code = code
        self.detail = detail


def load(path, what):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError) as err:
        raise Refusal("unreadable_input", f"{what} {path}: {err}") from err


def plain_hours(seconds):
    return f"{int(seconds) / 3600:.3f} h"


def check_support(lines):
    for line in lines:
        support = line.get("support") or {}
        if not support.get("evidence_rows") and not support.get("estimate_bases"):
            raise Refusal("no_support", f"The line for {line.get('date')}, {line.get('user')} has no evidence and no recorded estimate basis.")


def check_total(meta, line_map, disbursements):
    try:
        total = Decimal(line_map["subtotal"]) + Decimal(meta["taxes"]) + Decimal(disbursements.get("subtotal", "0"))
        if total != Decimal(meta["amount"]):
            raise Refusal("amount_mismatch", f"The lines, disbursements and taxes come to {total}, but the invoice states {meta['amount']}.")
    except (KeyError, InvalidOperation) as err:
        raise Refusal("bad_figure", repr(err)) from err


def report(snapshot):
    invoice = snapshot["invoice"]
    out = [f"# Invoice {invoice['invoice_number']}: what supports each charge", "",
           f"Matter {invoice['matter']}, dated {invoice['issue_date']}, covering work to {invoice['date_to']}, for {invoice['amount']}.", ""]
    for line in snapshot["lines"]:
        out += [f"## {line['date']}, {line['user']}: {line['hours']} h at {line['rate']}, {line['amount']}", "",
                f"Billed as: {line['description']}", f"Rate from: {line.get('rate_source') or 'not recorded'}",
                f"Tracked before rounding: {line['unrounded_hours']} h. {line['rounding']['rule']}.", ""]
        for gone in line.get("unavailable") or []:
            out.append(f"Source unavailable: {gone['source']}, {gone['reason']}.")
        for entry in line["entries"]:
            out.append(f"- Time entry {entry['entry_id']}, {entry.get('start')} to {entry.get('end')}, tracked {plain_hours(entry['tracked_seconds'])}, "
                       f"billed {plain_hours(entry['billed_seconds'])}. Ruling: {entry.get('ruling') or 'none'}")
            out += [f"  - Evidence: {row.get('source')} {row.get('native_id')} at {row.get('time')}" for row in entry["evidence"]]
            out += [f"  - {a['kind']}: {plain_hours(a['seconds'])}, {a['reason']}" for a in entry["adjustments"]]
        for estimate in line["estimates"]:
            out.append(f"- Estimate, {plain_hours(estimate['seconds'])}: {estimate['method']}. Why: {estimate['reason']}. "
                       f"Approved by {estimate['approved_by']} on {estimate['approved_at']}.")
            out += [f"  - Evidence: {row.get('source')} {row.get('native_id')} at {row.get('time')}" for row in estimate["basis"]]
        out.append("")
    for line in snapshot["disbursements"]:
        out += [f"## Disbursement: {line['description']}, {line['amount']}", "", f"Receipt: {line['receipt_path']} (sha256 {line['receipt_hash']})", ""]
    if snapshot["not_billed"]:
        out += ["## Not billed", ""]
        out += [f"- {item.get('source_key')}: {item.get('description') or ''}" for item in snapshot["not_billed"]]
        out.append("")
    return "\n".join(out)


def issue_records(line_map, disbursements):
    def fee_line(line):
        keys = [e["source_key"] for e in line["entries"]] + [e["source_key"] for e in line["estimates"]]
        return {"line_key": line["line_key"], "line_kind": "fee", "entry_date": line["date"], "timekeeper": line["user"],
                "description": line["description"], "hours": line["hours"], "rate": line["rate"], "rate_source": line.get("rate_source"),
                "amount": line["amount"], "provenance": line["provenance"], "rounding": line.get("rounding"), "entry_source_keys": keys}

    def disbursement_line(line):
        return {k: line[k] for k in ("line_key", "line_kind", "description", "amount", "receipt_hash")}

    return {"lines": [fee_line(l) for l in line_map["lines"]] + [disbursement_line(l) for l in disbursements.get("lines", [])],
            "adjustments": line_map["adjustments"]}


def freeze(args):
    line_map = load(args.line_map, "line map")
    meta = load(args.meta, "meta")
    disbursements = load(args.disbursements, "disbursements") if args.disbursements else {}
    missing = [field for field in REQUIRED_META if not meta.get(field)]
    if missing:
        raise Refusal("missing_field", ", ".join(missing))
    check_support(line_map.get("lines") or [])
    check_total(meta, line_map, disbursements)
    try:
        signed_hash = hashlib.sha256(Path(meta["signed_copy_path"]).read_bytes()).hexdigest()
    except OSError as err:
        raise Refusal("no_signed_copy", f"{meta['signed_copy_path']}: {err}") from err

    out_dir = Path(args.out_dir)
    stem = f"{meta['issue_date']} Invoice {meta['invoice_number']} audit"
    json_path, report_path = out_dir / f"{stem}.json", out_dir / f"{stem}.md"
    taken = [str(p) for p in (json_path, report_path) if p.exists()]
    if taken:
        raise Refusal("already_frozen", "; ".join(taken))
    snapshot = {"invoice": {**meta, "signed_copy_hash": signed_hash}, "lines": line_map["lines"], "disbursements": disbursements.get("lines", []),
                "not_billed": line_map.get("not_billed", []), "adjustments": line_map["adjustments"],
                "unexplained": line_map.get("unexplained", {}), "gaps": line_map.get("gaps", []), "not_candidates": line_map.get("not_candidates", [])}
    body = json.dumps(snapshot, indent=2, sort_keys=True).encode("utf-8")
    digest = hashlib.sha256(body).hexdigest()
    out_dir.mkdir(parents=True, exist_ok=True)
    with json_path.open("xb") as handle:
        handle.write(body)
    with report_path.open("xb") as handle:
        handle.write(report(snapshot).encode("utf-8"))

    data_dir = Path(args.data_dir)
    data_dir.mkdir(parents=True, exist_ok=True)
    records_path = data_dir / "issue_records.json"
    records_path.write_text(json.dumps(issue_records(line_map, disbursements), indent=2), encoding="utf-8")
    return {"snapshot_path": str(json_path), "snapshot_hash": digest, "report_path": str(report_path),
            "signed_copy_hash": signed_hash, "records_file": str(records_path)}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--line-map", required=True)
    parser.add_argument("--meta", required=True)
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--data-dir", required=True)
    parser.add_argument("--disbursements")
    try:
        print(json.dumps(freeze(parser.parse_args(argv))))
    except Refusal as refused:
        print(json.dumps({"error": refused.code, "detail": refused.detail}))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
