#!/usr/bin/env python3
"""List the staff entries with a blank TimeCamp note, so the practitioner can ask staff to add one.

    blank_staff_notes.py --entries F --staff NAME [--staff NAME ...]

--entries is the connector's out_file; --staff is each user name the firm roster marks staff.
Prints one JSON line, {"count", "entries": [{"id", "date", "user_name", "start_time", "end_time"}]},
in date order. Reads only: nothing here can write to TimeCamp.
"""
import argparse
import json

from tie_out import load_entries

SHOWN = ("id", "date", "user_name", "start_time", "end_time")


def blank_staff_notes(entries, staff):
    blank = [e for e in entries if e["user_name"] in staff and not (e.get("description") or "").strip()]
    return [{field: e.get(field) for field in SHOWN} for e in sorted(blank, key=lambda e: (e["date"], e.get("start_time", "")))]


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--entries", required=True)
    parser.add_argument("--staff", action="append", required=True)
    args = parser.parse_args(argv)
    found = blank_staff_notes(load_entries(args.entries), set(args.staff))
    print(json.dumps({"count": len(found), "entries": found}))


if __name__ == "__main__":
    main()
