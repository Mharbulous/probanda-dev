#!/usr/bin/env python3
"""Plan a resumed triage, and detect a candidate date whose cited evidence row did not save.

    resume_plan.py plan  --coverage F --today D
    resume_plan.py check --records F --evidence F

plan reads the matter's `candidate_coverage` record (an export, as candidate_list.py reads) and prints one
JSON line: {"first_run": bool, "new_days": [every day after covered_through up to --today],
"open_leads": [the leads still open], "scan_days": the new days}. The activity scan and every source search
for the whole period run only on the new days. Each open lead is searched for the whole period. With no
coverage record, first_run is true and new_days is empty: the whole period is searched once, as before.

check reads the `candidate_date` records (--records) and an export of the `evidence` namespace (--evidence)
and prints {"verdict", "dates": n, "missing": [{"date", "keys": [absent evidence keys]}]}. It exits 0 when
every key a date cites is saved and 1 otherwise. A bad input stops with a message on stderr and exit 2.
"""
import argparse
import json
import sys
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import candidate_list  # noqa: E402


def plan(coverage, today):
    if not coverage:
        return {"first_run": True, "new_days": [], "open_leads": [], "scan_days": []}
    start = date.fromisoformat(coverage["covered_through"]) + timedelta(days=1)
    end = date.fromisoformat(today)
    days = [(start + timedelta(days=n)).isoformat() for n in range(max((end - start).days + 1, 0))]
    return {"first_run": False, "new_days": days, "open_leads": coverage.get("open_leads") or [], "scan_days": days}


def evidence_keys(path):
    try:
        text = Path(path).read_text(encoding="utf-8")
    except OSError as err:
        candidate_list.stop(f"cannot read {path}: {err}")
    keys = set()
    for line in text.splitlines():
        if line.strip():
            try:
                keys.add(json.loads(line)["key"])
            except (ValueError, KeyError, TypeError) as err:
                candidate_list.stop(f"{path}: {err}")
    return keys


def check(records, saved):
    missing = []
    for record in candidate_list.ordered(records):
        absent = [k for k in record.get("evidence") or [] if k not in saved]
        if absent:
            missing.append({"date": candidate_list.cell(record), "keys": absent})
    return missing


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="stage", required=True)
    one = sub.add_parser("plan")
    one.add_argument("--coverage", required=True)
    one.add_argument("--today", required=True)
    two = sub.add_parser("check")
    two.add_argument("--records", required=True)
    two.add_argument("--evidence", required=True)
    args = parser.parse_args(argv)
    if args.stage == "plan":
        coverage = (candidate_list.load_records(args.coverage, "candidate_coverage") or [None])[0]
        print(json.dumps(plan(coverage, args.today)))
        return 0
    records = candidate_list.load_records(args.records, "candidate_date")
    missing = check(records, evidence_keys(args.evidence))
    print(json.dumps({"verdict": "fail" if missing else "pass", "dates": len(records), "missing": missing}))
    return 1 if missing else 0


if __name__ == "__main__":
    sys.exit(main())
