#!/usr/bin/env python3
"""Print, for each date, the sources read, the sources missing with their recorded reason, and what no source records.

    coverage_report.py --coverage F --date D [D ...]

--coverage is the coverage read's rows as a JSON array: {source_name, local_date, status, row_count,
error_detail, fetched_at}. It reads the source log only and never opens a database. A source that was
read (fetched or empty) is present, even when it recorded nothing. A skipped or failed source is missing,
with its recorded reason verbatim. An expected source with no row for the date is missing as "not
fetched". The output holds source names, statuses, counts and reasons only, never client content.

Prints one block per date to stdout. A bad input stops with a message on stderr and exit 2.
"""
import argparse
import json
import re
import sys
from pathlib import Path

# The sources the assembly gate expects, in its order (references/splice.sql, expected_sources).
EXPECTED = (
    "timecamp_time_entries",
    "timecamp_computer_activities",
    "syncopaid_captures",
    "telus_calls",
    "gcal_events",
    "icloud_events",
    "sent_mail",
)
UNKNOWABLE = (
    "which computer was in use",
    "whether the practitioner was at the computer",
    "what was on screen where no capture exists",
    "a call's direction, where the call was read from a daily archive file",
)
DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def stop(message):
    sys.stderr.write(f"coverage_report: {message}\n")
    sys.exit(2)


def load_rows(path):
    try:
        rows = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError) as err:
        stop(f"cannot read coverage {path}: {err}")
    if not isinstance(rows, list):
        stop(f"coverage {path} is not a JSON array")
    return rows


def report(rows, day):
    log = {row.get("source_name"): row for row in rows if row.get("local_date") == day}
    names = list(EXPECTED) + sorted(name for name in log if name not in EXPECTED)
    present, missing = [], []
    for name in names:
        row = log.get(name)
        status = row.get("status") if row else None
        if status in ("fetched", "empty"):
            present.append(f"{name}: {status}, {row.get('row_count') or 0} rows")
        elif row is None:
            missing.append(f"{name}: not fetched")
        else:
            missing.append(f"{name}: {status}. {row.get('error_detail') or 'no reason recorded'}")
    lines = [f"COVERAGE {day}", "PRESENT (the source was read)"]
    lines += [f"  {line}" for line in present or ["none"]]
    lines.append("MISSING")
    lines += [f"  {line}" for line in missing or ["none"]]
    lines.append("UNKNOWABLE (no source records it)")
    lines += [f"  {line}" for line in UNKNOWABLE]
    return "\n".join(lines)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--coverage", required=True)
    parser.add_argument("--date", required=True, nargs="+")
    args = parser.parse_args(argv)
    for day in args.date:
        if not DATE.match(day):
            stop(f"date {day!r} is not YYYY-MM-DD")
    rows = load_rows(args.coverage)
    print("\n\n".join(report(rows, day) for day in args.date))
    return 0


if __name__ == "__main__":
    sys.exit(main())
