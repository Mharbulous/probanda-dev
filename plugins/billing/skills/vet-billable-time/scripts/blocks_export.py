#!/usr/bin/env python3
"""Turn the reviewed blocks of a matter's days into the vetted.json that tie_out.py reads, and find the
block behind an invoice line.

    blocks_export.py export --blocks F --entries F [--late-entries F ...] --matter M --user U --people F
                            --out F [--candidates F] [--decided-by W] [--gap TEXT ...]
    blocks_export.py lookup --line-map F --date D [--person P]

--blocks is the file time_review__export_blocks wrote, { days: [{date, clear, blocks}] }. --entries is the
connector's out_file for the bill's window, and each --late-entries one for an earlier date. --matter is
the matter number, matched as the whole of a block's matter or its first word. --user is the name
TimeCamp gives the practitioner, who owns every estimate. --people is {user_name: {initials, rate,
rate_source}}. --candidates is the candidate export tie_out.py reads. --out is vetted.json.

export refuses, writing nothing and exiting 1, while any day is not clear (not judged, or a block on it
still flagged), or a block of the matter rests on no TimeCamp entry and states no estimate, or an
entry on the matter has no block. Otherwise it writes vetted.json and exits 0. A bad input stops with
a message on stderr and exit 2.

Each TimeCamp entry becomes one line, joined to the reviewed blocks of its day that cite it (evidence
source timecamp_time_entries, ref the entry id):
    a block written off, or one that moved the time to another matter  -> a write_off line
    an approved or corrected block, or one auto-assigned with no doubt -> a bill line, its words the
        blocks' descriptions joined with "; ", its supported seconds the overlap of the blocks with the
        entry, or its estimate where the block states duration_unbounded or no_evidence
A block of the matter that cites no entry becomes an estimate, only when it states `estimate`, `late_line` or
`proposed_writeoff` and has been approved or corrected on the page. Every line and estimate carries
`block_ids`, which line_map.py carries to line_map.json so an invoice line opens its blocks.

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
ESTIMATE_BASES = {"estimate", "late_line", "proposed_writeoff"}
UNBOUNDED_BASES = {"duration_unbounded", "no_evidence"}


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


def overlap(block, entry):
    """Seconds the block and the entry share, or None where either has no readable times."""
    a, b = clock_seconds(block["start"]), clock_seconds(block["end"])
    c, d = clock_seconds(entry.get("start_time")), clock_seconds(entry.get("end_time"))
    if None in (a, b, c, d):
        return None
    return max(0, min(b, d) - max(a, c))


def on_matter(block, matter):
    name = str(block.get("matter") or "").strip()
    return name == matter or name.split(" ")[0] == matter


def live(day):
    return [b for b in day["blocks"] if b.get("state") not in LIVE_STATES_OFF]


def review_words(block):
    review = block.get("review") or {}
    if review.get("act") in ("approved", "corrected"):
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


def entry_line(entry, cited, matter, late):
    """The vetted line for one TimeCamp entry and the live blocks that cite it, or a problem string."""
    ids = [b["id"] for b in cited]
    mine = [b for b in cited if on_matter(b, matter)]
    written = [b for b in mine if b.get("state") == "written_off"]
    if not mine:
        return {"entry_id": str(entry["id"]), "disposition": "write_off", "block_ids": ids,
                "write_off_reason": "the reviewed block puts this time on another matter"}, None
    if len(written) == len(mine):
        reasons = "; ".join(str((b.get("review") or {}).get("reason") or "").strip() for b in written).strip("; ")
        return {"entry_id": str(entry["id"]), "disposition": "write_off", "block_ids": ids,
                "write_off_reason": reasons or "written off on the review page"}, None
    billable = [b for b in mine if b.get("state") != "written_off"]
    confirmed = []
    for b in billable:
        words = review_words(b)
        if not words:
            return None, f"block {b['id']} is {b.get('state')}, not approved"
        confirmed.append(f"{b['id']} {words}")
    unbounded = any(set(b.get("bill_basis") or []) & UNBOUNDED_BASES for b in billable)
    shares = [overlap(b, entry) for b in billable]
    line = {"entry_id": str(entry["id"]), "disposition": "bill", "block_ids": ids,
            "description": "; ".join(dict.fromkeys(b["description"].strip() for b in billable)),
            "proposal_id": billable[0]["id"], "evidence": [row for b in billable for row in evidence_rows(b)],
            "confirmed": "; ".join(confirmed)}
    if all(s is not None for s in shares):
        seconds = sum(shares)
    else:
        seconds = sum(span(b["start"], b["end"]) or 0 for b in billable)
    if unbounded:
        line.update(estimate_seconds=seconds, no_evidence_confirmed=any("no_evidence" in (b.get("bill_basis") or []) for b in billable))
    else:
        line["supported_seconds"] = seconds
    if late:
        line["late_reason"] = "; ".join(str((b.get("review") or {}).get("reason") or "late line reviewed on the page") for b in billable)
    return line, None


def estimate_for(block, user):
    review = block.get("review") or {}
    seconds = span(block["start"], block["end"])
    if review.get("act") not in ("approved", "corrected") or not seconds:
        return None, f"block {block['id']} states an estimate but is not approved with readable times"
    return {"key": block["id"], "date": block["date"], "user": user, "seconds": seconds, "description": block["description"].strip(),
            "basis": evidence_rows(block), "method": "the reviewed block's own span, approved on the review page",
            "reason": "documented work with no TimeCamp entry: " + ", ".join(block.get("bill_basis") or []),
            "approved_by": review.get("by"), "approved_at": review.get("at"), "block_ids": [block["id"]]}, None


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


def build(args):
    blocks_file = load_json(args.blocks, "blocks")
    days = blocks_file.get("days") if isinstance(blocks_file, dict) else None
    if not isinstance(days, list):
        stop(f"blocks {args.blocks} is not the file time_review__export_blocks writes")
    by_day = {d["date"]: d for d in days}
    people = load_json(args.people, "people")
    problems = problems_for_days(days, args.matter)

    lines, cited_ids = [], set()
    batches = [(load_entries(args.entries), False)] + [(load_entries(path), True) for path in args.late_entries]
    for entries, late in batches:
        for entry in entries:
            day = by_day.get(entry["date"])
            if day is None:
                problems.append(f"entry {entry['id']} on {entry['date']} has no reviewed day")
                continue
            cited = [b for b in live(day) if any(e["source"] == ENTRY_SOURCE and str(e["ref"]) == str(entry["id"]) for e in b.get("evidence") or [])]
            if not cited:
                problems.append(f"entry {entry['id']} on {entry['date']} is cited by no block")
                continue
            line, problem = entry_line(entry, cited, args.matter, late)
            if problem:
                problems.append(f"entry {entry['id']}: {problem}")
            else:
                lines.append(line)
                cited_ids.update(b["id"] for b in cited)

    estimates = []
    for day in days:
        for block in live(day):
            if block["id"] in cited_ids or not on_matter(block, args.matter):
                continue
            if any(e["source"] == ENTRY_SOURCE for e in block.get("evidence") or []):
                continue  # rests on an entry that is not on this bill's pull: a late line's own pull carries it
            if block.get("state") == "written_off":
                continue
            if not set(block.get("bill_basis") or []) & ESTIMATE_BASES:
                problems.append(f"block {block['id']} rests on no TimeCamp entry and states no estimate")
                continue
            item, problem = estimate_for(block, args.user)
            if problem:
                problems.append(problem)
            else:
                estimates.append(item)

    billed_days = {e["date"] for e in estimates} | {entry["date"] for entries, _ in batches for entry in entries}
    candidates = {}
    if args.candidates:
        rows = load_json(args.candidates, "candidates")
        candidates = candidate_dispositions(rows, days, billed_days) if isinstance(rows, list) else {}
    return problems, {"people": people, "lines": lines, "estimates": estimates, "candidates": candidates,
                      "decided_by": args.decided_by, "gaps": list(args.gap)}


def export(args):
    problems, vetted = build(args)
    if problems:
        print(json.dumps({"verdict": "fail", "problems": problems}, indent=2))
        return 1
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(vetted, indent=2), encoding="utf-8")
    print(json.dumps({"verdict": "pass", "lines": len(vetted["lines"]), "estimates": len(vetted["estimates"]), "out": str(out)}))
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
    one.add_argument("--entries", required=True)
    one.add_argument("--late-entries", action="append", default=[])
    one.add_argument("--matter", required=True)
    one.add_argument("--user", required=True)
    one.add_argument("--people", required=True)
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
