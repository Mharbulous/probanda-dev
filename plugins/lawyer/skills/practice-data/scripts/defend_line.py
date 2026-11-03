#!/usr/bin/env python3
"""Answer "what supports this charge?" from an issued invoice's frozen copy, in plain words.

    defend_line.py --snapshot F --hash H [--date D] [--person P]

--snapshot is the frozen audit JSON and --hash the snapshot hash recorded on the invoice. --date and
--person narrow it to one line; with neither it covers every line. It reads that one file and opens no
connection. Prints the answer to stdout and exits 0. If the file's hash differs from the recorded
one it prints that and exits 1, because the file is no longer what was issued. If no line matches, or the
file cannot be read, it says so on stderr and exits 2.
"""
import argparse
import hashlib
import json
import sys
from pathlib import Path

# What each kind of evidence is called when shown to a person.
EVIDENCE_NAMES = {
    "timecamp_time_entries": "time tracker entry",
    "timecamp_computer_activities": "computer activity",
    "syncopaid_captures": "screen capture",
    "telus_calls": "phone call record",
    "gcal_events": "calendar event",
    "icloud_events": "calendar event",
    "sent_mail": "sent email",
    "document": "document",
    "filing": "court filing",
    "statement": "your statement",
    "received_mail": "received email",
    "call_window": "calling-app window",
}
HIDDEN_FIELDS = {"source", "native_id", "time", "key"}


def stop(message):
    sys.stderr.write(f"defend_line: {message}\n")
    sys.exit(2)


def hours(seconds):
    return f"{int(seconds) / 3600:.3f} hours"


def evidence_text(row):
    source = str(row.get("source") or "")
    family = source.split(":")[1] if source.startswith("evidence:") else source
    name = EVIDENCE_NAMES.get(family, "record")
    details = ", ".join(str(value) for field, value in row.items() if field not in HIDDEN_FIELDS and value not in (None, "", []))
    return f"{name} at {row.get('time')}" + (f": {details}" if details else "")


def adjustments_text(adjustments):
    words = {"trim": "Trimmed", "write_off": "Written off", "restoration": "Restored", "credit": "Credited"}
    return [f"{words.get(a['kind'], 'Adjusted')} {hours(a['seconds'])}: {a['reason']} ({a['decided_by']}, {a['decided_at']})"
            for a in adjustments if a.get("seconds")]


def answer(line, invoice):
    out = [f"Charge on {line['date']} by {line['user']}: {line['hours']} hours at {line['rate']}, {line['amount']}",
           f"Description on the invoice: {line['description']}",
           f"Rate from: {line.get('rate_source') or 'no source recorded'}",
           f"Time before rounding: {line['unrounded_hours']} hours. Rounded because {line['rounding']['rule']}."]
    out += [f"Could not be checked: {g['source']}, because {g['reason']}." for g in line.get("unavailable") or []]
    for entry in line["entries"]:
        out.append(f"Time entry {entry['entry_id']}: {entry.get('start')} to {entry.get('end')}, tracked {hours(entry['tracked_seconds'])}, "
                   f"billed {hours(entry['billed_seconds'])}")
        out += [f"  Evidence: {evidence_text(row)}" for row in entry["evidence"]]
        if entry.get("ruling"):
            out.append(f"  Your ruling: {entry['ruling']}")
        out += [f"  {text}" for text in adjustments_text(entry["adjustments"])]
    for estimate in line["estimates"]:
        out.append(f"Estimate: {hours(estimate['seconds'])}, by {estimate['method']}, because {estimate['reason']}. "
                   f"Approved by {estimate['approved_by']} on {estimate['approved_at']}.")
        out += [f"  Rests on: {evidence_text(row)}" for row in estimate["basis"]]
    out.append(f"This is the record as it stood when invoice {invoice['invoice_number']} issued.")
    return "\n".join(out)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--snapshot", required=True)
    parser.add_argument("--hash", required=True)
    parser.add_argument("--date")
    parser.add_argument("--person")
    args = parser.parse_args(argv)
    try:
        body = Path(args.snapshot).read_bytes()
    except OSError as err:
        stop(f"cannot read the frozen copy {args.snapshot}: {err}")
    if hashlib.sha256(body).hexdigest() != args.hash:
        print(f"The frozen copy at {args.snapshot} has changed since the invoice issued, so it cannot be relied on.")
        return 1
    try:
        snapshot = json.loads(body)
    except ValueError as err:
        stop(f"the frozen copy {args.snapshot} is not readable: {err}")
    lines = [line for line in snapshot["lines"]
             if (not args.date or line["date"] == args.date)
             and (not args.person or args.person.casefold() in (line["user"].casefold(), line["initials"].casefold()))]
    if not lines:
        stop("no line on this invoice matches that date and person")
    print("\n\n".join(answer(line, snapshot["invoice"]) for line in lines))
    return 0


if __name__ == "__main__":
    sys.exit(main())
