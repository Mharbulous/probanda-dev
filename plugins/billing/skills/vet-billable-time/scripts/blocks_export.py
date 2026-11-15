#!/usr/bin/env python3
"""Turn the reviewed blocks of a matter's days into the vetted.json that tie_out.py reads, and find the
block behind an invoice line.

    blocks_export.py export --blocks F --matter M --user U --people F --last-billed D --out F
                            [--entries F] [--candidates F] [--decided-by W] [--gap TEXT ...]
    blocks_export.py lookup --line-map F --date D [--person P]

--blocks is the file time_review__export_blocks wrote, { days: [{date, clear, blocks}] }. --matter is
the matter number, matched as the whole of a block's matter or its first word. --user is the
practitioner's roster name, which every line carries: the timekeeping store holds one practitioner's
time. --people is {user_name: {initials, rate, rate_source}}. --last-billed is the matter's last billed
date. --entries, given only when the registry enables TimeCamp, is the connector's out_file for the
bill's window. --candidates is the candidate export tie_out.py reads. --out is vetted.json.

export refuses, writing nothing and exiting 1, while any day is not clear (not judged, or a block on it
still flagged), a block of the matter is neither approved, corrected, written off nor auto-assigned, a
late block (dated on or before --last-billed) was not clicked on the page, or, with --entries, an entry
on the matter has no reviewed day or is cited by no block. Otherwise it writes vetted.json and exits 0.
A bad input stops with a message on stderr and exit 2.

Each live block of the matter becomes one line, keyed by its `block_id`, in start-time order:
    a written-off block -> a write_off line, its reason the review's
    an approved or corrected block, or one auto-assigned with no doubt -> a bill line, its time the
        block's own span: `supported_seconds`, or `estimate_seconds` where the block states
        `estimate`, `duration_unbounded` or `no_evidence`
A timer entry the block cites is one of its evidence rows. A late block bills only when approved or
corrected on the page, as a late line under its work date with the review's reason as `late_reason`.
An entry that only another matter's block cites gives no line here: that matter bills it.

lookup prints, for the invoice line of a person-day, its block ids and, for each, the page address
fragment (`#<block id>`) that opens the block.
"""
import argparse
import json
import re
import sys
from pathlib import Path

ENTRY_SOURCE = "timecamp_time_entries"
LIVE_STATES_OFF = {"merged", "split"}
CLOCK = re.compile(r"^(?:\d{4}-\d{2}-\d{2}[T ])?(\d{1,2}):(\d{2})(?::(\d{2}))?")
FIGURE_BASES = {"estimate", "duration_unbounded", "no_evidence"}
CLICKED = ("approved", "corrected")


def stop(message):
    sys.stderr.write(f"blocks_export: {message}\n")
    sys.exit(2)


def load_json(path, what):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError) as err:
        stop(f"cannot read {what} {path}: {err}")


def clock_seconds(text):
    """Seconds into the day for a clock time or a timestamp, else None."""
    match = CLOCK.match(str(text or "").strip())
    if not match:
        return None
    return int(match[1]) * 3600 + int(match[2]) * 60 + int(match[3] or 0)


def span(start, end):
    first, last = clock_seconds(start), clock_seconds(end)
    return max(0, last - first) if first is not None and last is not None else None


def on_matter(block, matter):
    name = str(block.get("matter") or "").strip()
    return name == matter or name.split(" ")[0] == matter


def live(day):
    return [b for b in day["blocks"] if b.get("state") not in LIVE_STATES_OFF]


def review_words(block):
    review = block.get("review") or {}
    if review.get("act") in CLICKED:
        return f"{review['act']} on the review page by {review.get('by')} at {review.get('at')}"
    if block.get("state") == "auto_assigned":
        return "auto-assigned: the evidence names the matter and no doubt was stated"
    return None


def load_entries(path):
    entries = load_json(path, "entries")
    if not isinstance(entries, list):
        stop(f"entries {path} is not a JSON array")
    return entries


def evidence_rows(block):
    return [{"source": item["source"], "native_id": item["ref"], "time": block["start"]} for item in block.get("evidence") or []]


def problems_for_days(days, matter):
    problems = []
    for day in days:
        if not day.get("clear"):
            flagged = [b["id"] for b in live(day) if b.get("state") == "flagged"]
            reason = f"block {', '.join(flagged)} still flagged" if flagged else "the day is not judged"
            problems.append(f"{day['date']} is not clear: {reason}")
    return problems


def block_line(block, user, last_billed):
    """The vetted line for one live block of the matter, or a problem string."""
    review = block.get("review") or {}
    seconds = span(block["start"], block["end"])
    base = {"block_id": block["id"], "date": block["date"], "user": user}
    if block.get("state") == "written_off":
        return {**base, "disposition": "write_off", "supported_seconds": seconds or 0,
                "write_off_reason": str(review.get("reason") or "").strip() or "written off on the review page"}, None
    words = review_words(block)
    if not words:
        return None, f"block {block['id']} is {block.get('state')}, not approved"
    late = block["date"] <= last_billed
    if late and review.get("act") not in CLICKED:
        return None, (f"block {block['id']} (#{block['id']}) is dated on or before the last billed date {last_billed} and was not "
                      "clicked on the review page: approve or correct it to bill it as a late line, or write it off. "
                      "The default is write-off when the last bill is over three months old")
    if not seconds:
        return None, f"block {block['id']} has no readable start and end"
    bases = set(block.get("bill_basis") or [])
    line = {**base, "disposition": "bill", "description": block["description"].strip(), "proposal_id": block["id"],
            "evidence": evidence_rows(block), "confirmed": f"{block['id']} {words}"}
    if bases & FIGURE_BASES:
        line.update(estimate_seconds=seconds, no_evidence_confirmed="no_evidence" in bases)
    else:
        line["supported_seconds"] = seconds
    if late:
        line["late_reason"] = str(review.get("reason") or "").strip() or "late line approved on the review page"
    return line, None


def entry_problems(entries, by_day):
    """With TimeCamp on: an entry on the matter that the review never saw."""
    problems = []
    for entry in entries:
        day = by_day.get(entry["date"])
        if day is None:
            problems.append(f"entry {entry['id']} on {entry['date']} has no reviewed day")
        elif not any(e["source"] == ENTRY_SOURCE and str(e["ref"]) == str(entry["id"]) for b in live(day) for e in b.get("evidence") or []):
            problems.append(f"entry {entry['id']} on {entry['date']} is cited by no block")
    return problems


def candidate_dispositions(candidates, days, billed_days):
    """A Strong or Medium candidate whose every day is judged and holds no time for the matter is written off."""
    out = {}
    judged = {d["date"] for d in days if d.get("clear")}
    for row in candidates:
        if row.get("strength") not in ("Strong", "Medium"):
            continue
        cell = row["cell"]
        first, _, last = cell.partition(" to ")
        # a range is covered only when every day in it is judged: tie_out lists the days it needs
        if first == (last or first) and first in judged and first not in billed_days:
            out[cell] = {"status": "written_off", "reason": "the reviewed day holds no time for this matter"}
    return out


def start_order(block):
    start = clock_seconds(block["start"])
    return (block["date"], start is None, start or 0, block["id"])


def build(args):
    blocks_file = load_json(args.blocks, "blocks")
    days = blocks_file.get("days") if isinstance(blocks_file, dict) else None
    if not isinstance(days, list):
        stop(f"blocks {args.blocks} is not the file time_review__export_blocks writes")
    people = load_json(args.people, "people")
    problems = problems_for_days(days, args.matter)
    if args.entries:
        problems += entry_problems(load_entries(args.entries), {d["date"]: d for d in days})

    lines = []
    for block in sorted((b for day in days for b in live(day) if on_matter(b, args.matter)), key=start_order):
        line, problem = block_line(block, args.user, args.last_billed)
        if problem:
            problems.append(problem)
        else:
            lines.append(line)

    candidates = {}
    if args.candidates:
        rows = load_json(args.candidates, "candidates")
        candidates = candidate_dispositions(rows, days, {line["date"] for line in lines}) if isinstance(rows, list) else {}
    return problems, {"people": people, "lines": lines, "candidates": candidates,
                      "decided_by": args.decided_by, "gaps": list(args.gap)}


def export(args):
    problems, vetted = build(args)
    if problems:
        print(json.dumps({"verdict": "fail", "problems": problems}, indent=2))
        return 1
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(vetted, indent=2), encoding="utf-8")
    print(json.dumps({"verdict": "pass", "lines": len(vetted["lines"]), "out": str(out)}))
    return 0


def lookup(args):
    line_map = load_json(args.line_map, "line map")
    found = [line for line in line_map.get("lines") or [] if line["date"] == args.date
             and (not args.person or args.person.casefold() in (line["user"].casefold(), line["initials"].casefold()))]
    if not found:
        stop("no invoice line matches that date and person")
    for line in found:
        ids = line.get("block_ids") or []
        print(json.dumps({"line_key": line["line_key"], "blocks": [{"block": i, "fragment": f"#{i}"} for i in ids]}))
    return 0


def parse(argv):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="stage", required=True)
    one = sub.add_parser("export")
    one.add_argument("--blocks", required=True)
    one.add_argument("--entries")
    one.add_argument("--matter", required=True)
    one.add_argument("--user", required=True)
    one.add_argument("--people", required=True)
    one.add_argument("--last-billed", required=True)
    one.add_argument("--out", required=True)
    one.add_argument("--candidates")
    one.add_argument("--decided-by", default="the practitioner")
    one.add_argument("--gap", action="append", default=[])
    two = sub.add_parser("lookup")
    two.add_argument("--line-map", required=True)
    two.add_argument("--date", required=True)
    two.add_argument("--person")
    return parser.parse_args(argv)


def main(argv=None):
    args = parse(argv)
    return export(args) if args.stage == "export" else lookup(args)


if __name__ == "__main__":
    sys.exit(main())
