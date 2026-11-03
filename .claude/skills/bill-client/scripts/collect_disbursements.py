#!/usr/bin/env python3
"""Turn a matter's receipts into disbursement lines, one per receipt however many copies are saved.

    collect_disbursements.py --receipts F --out F

--receipts is a JSON array of {"path", "description", "amount", "taxable"}, amount a decimal string.
Copies are the same bytes: two names for one receipt make one line, and the extra names are listed. Two
copies stated at different amounts stop the run. Writes {"lines": [...], "subtotal", "taxable_subtotal",
"duplicates": [...]} to --out, reads the receipts only, and prints one JSON line. A bad input stops
with a message on stderr and exit 2.
"""
import argparse
import hashlib
import json
import sys
from decimal import Decimal, InvalidOperation
from pathlib import Path


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


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--receipts", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args(argv)
    try:
        receipts = json.loads(Path(args.receipts).read_text(encoding="utf-8"))
    except (OSError, ValueError) as err:
        stop(f"cannot read receipts {args.receipts}: {err}")

    lines, duplicates = {}, []
    for receipt in receipts:
        digest = file_hash(receipt["path"])
        amount = amount_of(receipt)
        held = lines.get(digest)
        if held:
            if Decimal(held["amount"]) != amount:
                stop(f"{receipt['path']} and {held['receipt_path']} are one receipt stated at two amounts")
            duplicates.append({"path": receipt["path"], "same_as": held["receipt_path"]})
            continue
        lines[digest] = {"line_key": f"disbursement:{digest[:12]}", "line_kind": "disbursement", "description": receipt["description"],
                         "amount": str(amount), "taxable": bool(receipt.get("taxable")), "receipt_hash": digest, "receipt_path": receipt["path"]}
    rows = list(lines.values())
    result = {"lines": rows, "subtotal": str(sum((Decimal(r["amount"]) for r in rows), Decimal(0))),
              "taxable_subtotal": str(sum((Decimal(r["amount"]) for r in rows if r["taxable"]), Decimal(0))), "duplicates": duplicates}
    Path(args.out).write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps({"lines": len(rows), "duplicates": len(duplicates), "subtotal": result["subtotal"]}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
