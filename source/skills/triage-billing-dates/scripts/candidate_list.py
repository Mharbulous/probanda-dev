#!/usr/bin/env python3
"""Turn a matter's stored candidate dates into the `Candidate dates` file and the export tie_out.py reads.

    candidate_list.py render --records F --coverage F --out F
    candidate_list.py export --records F --out F

--records is an export of the time-pipeline store's `item` rows whose key starts `candidate_date:<matter>:`
(`time_pipeline__export`, JSONL of {"op": "set", "key", "value"}), or a JSON array of the record values.
--coverage is the same kind of export of the one `candidate_coverage:<matter>` row.

A candidate_date record: {"kind": "candidate_date", "matter", "date", "date_to" (optional), "strength",
"who", "flags": [..], "found_at", "evidence": [evidence row keys], "summary": text with local times}.
A candidate_coverage record: {"kind": "candidate_coverage", "matter", "covered_through", "period_start",
"write_offs": [{"date", "reason"}], "nothing_found": [text], "open_leads": [{"lead", "source"}]}.

render writes the Markdown table, then Write-offs, Sources checked and Unexplored leads, rewriting --out.
export writes a JSON array of {"cell", "strength", "who", "flags"}, one per record, by date. Either prints
one JSON line with the count. A bad input stops with a message on stderr and exit 2.
"""
import argparse
import json
import sys
from pathlib import Path

HEADERS = ["Date or range", "Strength", "Lawyer or Staff", "Flags", "Evidence, with local times"]


def stop(message):
    sys.stderr.write(f"candidate_list: {message}\n")
    sys.exit(2)


def load_records(path, kind):
    """The record values of one kind, from a store export or a JSON array."""
    try:
        text = Path(path).read_text(encoding="utf-8")
    except OSError as err:
        stop(f"cannot read {path}: {err}")
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
    return [v for v in values if isinstance(v, dict) and v.get("kind") == kind]


def cell(record):
    first, last = record["date"], record.get("date_to")
    return f"{first} to {last}" if last and last != first else first


def ordered(records):
    return sorted(records, key=lambda r: (r["date"], r.get("date_to") or ""))


def table_row(record):
    cells = [cell(record), record.get("strength", ""), record.get("who", ""),
             ", ".join(record.get("flags") or []), record.get("summary", "")]
    return "| " + " | ".join(str(c).replace("|", "/").replace("\n", " ") for c in cells) + " |"


def render(records, coverage):
    out = ["# Candidate dates", "", "| " + " | ".join(HEADERS) + " |", "|" + "---|" * len(HEADERS)]
    out += [table_row(r) for r in ordered(records)]
    out += ["", "## Write-offs", ""]
    out += [f"- {w['date']}: {w['reason']}" for w in coverage.get("write_offs") or []] or ["None."]
    out += ["", "## Sources checked, nothing found", ""]
    out += [f"- {t}" for t in coverage.get("nothing_found") or []] or ["None."]
    out += ["", "## Unexplored leads", ""]
    out += [f"- {lead['source']}: {lead['lead']}" for lead in coverage.get("open_leads") or []] or ["None."]
    return "\n".join(out) + "\n"


def export(records):
    return [{"cell": cell(r), "strength": r.get("strength", ""), "who": r.get("who", ""), "flags": r.get("flags") or []}
            for r in ordered(records)]


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="stage", required=True)
    one = sub.add_parser("render")
    one.add_argument("--records", required=True)
    one.add_argument("--coverage", required=True)
    one.add_argument("--out", required=True)
    two = sub.add_parser("export")
    two.add_argument("--records", required=True)
    two.add_argument("--out", required=True)
    args = parser.parse_args(argv)
    records = load_records(args.records, "candidate_date")
    if args.stage == "render":
        coverage = (load_records(args.coverage, "candidate_coverage") or [{}])[0]
        text = render(records, coverage)
    else:
        text = json.dumps(export(records), indent=2) + "\n"
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text(text, encoding="utf-8")
    print(json.dumps({"stage": args.stage, "dates": len(records)}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
