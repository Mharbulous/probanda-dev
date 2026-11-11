#!/usr/bin/env python3
"""Order a matter's candidate dates for the day reviewers, and say which to start next.

    day_plan.py order --records F [--status F] [--limit N]
    day_plan.py next  --order F --in-flight D,D [--done D,D] --limit N

order reads the matter's `candidate_date` records (a `time_pipeline__export` of the `item` rows whose key
starts `candidate_date:<matter>:`, or a JSON array of the record values) and, with --status, the reply of
`review_date__status` for those dates ({"dates": [{"date", "status", ...}]}). It prints one JSON line:
{"order": [days to review, strongest candidate first, then earliest], "judged": [days already judged],
"held": [days another bill holds], "first_wave": [the first --limit days], "limit": N}.
A range (`date_to`) is reviewed one local day at a time, each day with the range's strength. A day on two
records keeps the stronger. `held` days are left out of `order` and are asked for again once the bill that
holds them has judged them. Strength Strong, Medium, Weak, then anything else.

next reads that JSON (--order) and prints {"start": [the days to dispatch now]}: the first days of `order`
that are neither in flight nor done, so that at most --limit reviewers are ever running. A day whose
reviewer has returned moves from --in-flight to --done, and `next` is asked again.

A bad input stops with a message on stderr and exit 2.
"""
import argparse
import json
import sys
from datetime import date, timedelta
from pathlib import Path

DEFAULT_LIMIT = 10
STRENGTH = {"strong": 0, "medium": 1, "weak": 2}


def stop(message):
    sys.stderr.write(f"day_plan: {message}\n")
    sys.exit(2)


def read_text(path):
    try:
        return Path(path).read_text(encoding="utf-8")
    except OSError as err:
        stop(f"cannot read {path}: {err}")


def load_records(path):
    """The `candidate_date` record values from a store export or a JSON array."""
    text = read_text(path)
    try:
        if text.lstrip().startswith("["):
            rows = json.loads(text)
        else:
            rows = [json.loads(line) for line in text.splitlines() if line.strip()]
        values = []
        for row in rows:
            value = row.get("value", row) if row.get("op") == "set" else row
            values.append(json.loads(value) if isinstance(value, str) else value)
    except (ValueError, AttributeError) as err:
        stop(f"{path}: {err}")
    return [v for v in values if isinstance(v, dict) and v.get("kind") == "candidate_date"]


def load_status(path):
    try:
        reply = json.loads(read_text(path))
        return {entry["date"]: entry["status"] for entry in reply["dates"]}
    except (ValueError, KeyError, TypeError) as err:
        stop(f"{path}: {err}")


def days_of(record):
    try:
        first = date.fromisoformat(record["date"])
        last = date.fromisoformat(record["date_to"]) if record.get("date_to") else first
    except (ValueError, KeyError) as err:
        stop(f"candidate record {record.get('date')!r}: {err}")
    if last < first:
        stop(f"candidate record {record['date']}: date_to is before date")
    return [(first + timedelta(days=n)).isoformat() for n in range((last - first).days + 1)]


def rank(strength):
    return STRENGTH.get(str(strength).strip().lower(), len(STRENGTH))


def order(records, status=None, limit=DEFAULT_LIMIT):
    best = {}
    for record in records:
        for day in days_of(record):
            best[day] = min(best.get(day, len(STRENGTH)), rank(record.get("strength", "")))
    status = status or {}
    judged = sorted(d for d in best if status.get(d) == "judged")
    held = sorted(d for d in best if status.get(d) == "in_progress")
    todo = sorted((d for d in best if d not in judged and d not in held), key=lambda d: (best[d], d))
    return {"order": todo, "judged": judged, "held": held, "first_wave": todo[:limit], "limit": limit}


def next_days(plan, in_flight, limit, done=()):
    free = max(limit - len(in_flight), 0)
    skip = set(in_flight) | set(done)
    waiting = [d for d in plan["order"] if d not in skip]
    return waiting[:free]


def split(text):
    return [d for d in text.split(",") if d]


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="stage", required=True)
    one = sub.add_parser("order")
    one.add_argument("--records", required=True)
    one.add_argument("--status")
    one.add_argument("--limit", type=int, default=DEFAULT_LIMIT)
    two = sub.add_parser("next")
    two.add_argument("--order", required=True)
    two.add_argument("--in-flight", default="")
    two.add_argument("--done", default="")
    two.add_argument("--limit", type=int, default=DEFAULT_LIMIT)
    args = parser.parse_args(argv)
    if args.limit < 1:
        stop("--limit must be at least 1")
    if args.stage == "order":
        result = order(load_records(args.records), load_status(args.status) if args.status else None, args.limit)
    else:
        try:
            plan = json.loads(read_text(args.order))
            plan["order"]
        except (ValueError, KeyError, TypeError) as err:
            stop(f"{args.order}: {err}")
        result = {"start": next_days(plan, split(args.in_flight), args.limit, split(args.done))}
    print(json.dumps(result))


if __name__ == "__main__":
    main()
