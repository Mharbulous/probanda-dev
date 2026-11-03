#!/usr/bin/env python3
"""Tie a matter's vetted billable time to the TimeCamp connector, and do the billing arithmetic.

    tie_out.py pull  --entries F --connector-count N --connector-hours H
                     --candidates F --last-billed D --judged F
    tie_out.py final (the same) --vetted F [--late-entries F ...]
                     --date D --report-dir DIR --data-dir DIR
                     [--coverage F --run-started T] [--increment-seconds N] [--minimum-seconds N]

pull runs before any line is shown: the entries sit after the last billed date, they tie to the
connector, and every Strong and Medium candidate date not marked Staff has a judged mark. final adds the checks on
the vetted lines, and on a pass writes `<date> Billable time audit.md` and `<date> Billable time
summary.md` to --report-dir, and invoice_lines.json, line_map.json and time_entries.json (line_map.py)
to --data-dir, each rewritten in place. On a fail it writes nothing. Either prints one JSON line, the verdict and each failing check by name,
and exits 0 on a pass and 1 on a fail. A bad input stops with a message on stderr and exit 2.

Inputs:
    --entries       the connector's out_file: a JSON array of TimeCamp entries
    --connector-*   the count and totals.hours the same connector call returned
    --candidates    the /get-candidate-dates list, Markdown, one table by date
    --judged        JSON lines, each with a "date": the dates /timecamping has judged
    --late-entries  a connector out_file for one earlier date, for a late line
    --vetted        {"people": {user_name: {"initials", "rate", "rate_source"}},
                     "lines": [{"entry_id", "disposition": "bill" | "write_off", "description",
                                "proposal_id", "determination_id",
                                "evidence": [{"source", "native_id", "time", ...its metadata}],
                                "confirmed", "supported_seconds", "estimate_seconds",
                                "no_evidence_confirmed", "write_off_reason", "late_reason",
                                "excluded": [{"marker", "seconds", "confirmed"}]}],
                     "estimates": [{"key", "date", "user", "seconds", "description",
                                    "basis": [evidence row, ...], "method", "reason",
                                    "approved_by", "approved_at"}],
                     "candidates": {date cell: {"status": "written_off" | "unexplained", "reason"}},
                     "decided_by": who made the rulings,
                     "gaps": [text]}
    --coverage      a JSON array of the source log's rows {source_name, local_date, status,
                    error_detail, fetched_at}. A skipped row whose error_detail starts "unavailable:"
                    is shown on that date's line and reports. With --run-started, a row fetched at or
                    after it for a date off the candidate list, a late line or an estimate fails.

An estimate is documented work with no TimeCamp entry, approved by the practitioner: it joins its
person-day like an entry. "excluded" is non-billable time the practitioner approved taking off an
entry; it comes off before the person-day is totalled. Evidence rows hold metadata only.

Firm rules, unless --increment-seconds and --minimum-seconds say otherwise: a person's day under
0.1 h is written off; every other person-day rounds up to the next 0.1 h; lines keep unrounded time. Perfect-tracking total: the same rules and rates applied to
what each billed line's evidence supports, or the practitioner's estimate where nothing bounds it.
The draft passes when its fees are within 80% to 120% of that total. All time is integer seconds.
"""
import argparse
import json
import re
import sys
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path

import line_map

TENTH_SECONDS = 360
MIN_DESCRIPTION = 10
JUDGED_STRENGTHS = {"Strong", "Medium"}
NOT_EVIDENCE_FIELDS = {"raw_payload", "ocr_text", "body", "text", "notes"}
UNAVAILABLE = "unavailable:"
DATE_CELL = re.compile(r"^(\d{4}-\d{2}-\d{2})(?: to (\d{4}-\d{2}-\d{2}))?$")
CENT = Decimal("0.01")


def stop(message):
    sys.stderr.write(f"tie_out: {message}\n")
    sys.exit(2)


def load_json(path, what):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError) as err:
        stop(f"cannot read {what} {path}: {err}")


def load_entries(path):
    entries = load_json(path, "entries")
    if not isinstance(entries, list):
        stop(f"entries {path} is not a JSON array")
    for entry in entries:
        for field in ("id", "date", "duration", "user_name"):
            if field not in entry:
                stop(f"entries {path}: an entry has no {field}")
    return entries


def seconds(entry):
    return int(entry["duration"])


def days_in(cell):
    """The dates a candidate's date cell covers."""
    match = DATE_CELL.match(cell)
    if not match:
        stop(f"candidates: date cell {cell!r} is not YYYY-MM-DD or YYYY-MM-DD to YYYY-MM-DD")
    first = date.fromisoformat(match[1])
    last = date.fromisoformat(match[2]) if match[2] else first
    return [(first + timedelta(days=n)).isoformat() for n in range((last - first).days + 1)]


def load_candidates(path):
    """Each row of the table whose first header is `Date or range`: {cell, strength, who, days}."""
    try:
        text = Path(path).read_text(encoding="utf-8")
    except OSError as err:
        stop(f"cannot read candidates {path}: {err}")
    rows = []
    header = None
    for line in text.splitlines():
        if not line.lstrip().startswith("|"):
            header = None
            continue
        cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
        if header is None:
            if cells[0] == "Date or range":
                header = cells
            continue
        if set(cells[0]) <= {"-", ":"}:
            continue
        row = dict(zip(header, cells))
        rows.append({"cell": cells[0], "strength": row.get("Strength", ""), "who": row.get("Lawyer or Staff", ""),
                     "days": days_in(cells[0])})
    if not rows:
        stop(f"candidates {path} holds no table headed 'Date or range'")
    return rows


def load_judged(path):
    try:
        lines = Path(path).read_text(encoding="utf-8").splitlines()
    except FileNotFoundError:
        return set()
    except OSError as err:
        stop(f"cannot read judged dates {path}: {err}")
    try:
        return {json.loads(line)["date"] for line in lines if line.strip()}
    except (ValueError, KeyError, TypeError) as err:
        stop(f"judged dates {path}: {err}")


def check_window(entries, last_billed):
    return [f"entry {e['id']} is dated {e['date']}, not after {last_billed}" for e in entries if e["date"] <= last_billed]


def check_connector(entries, count, hours):
    total = sum(seconds(e) for e in entries) / 3600
    problems = []
    if len(entries) != count:
        problems.append(f"{len(entries)} rows against the connector's {count}")
    if round(abs(total - hours), 6) > 0.01:
        problems.append(f"{total:.4f} h against the connector's {hours} h")
    return problems


def check_judged(candidates, judged):
    """A Staff row is exempt: /timecamping judges only the practitioner's own time."""
    return [f"{row['cell']} ({row['strength']}): {day} is not judged" for row in candidates
            if row["strength"] in JUDGED_STRENGTHS and row["who"] != "Staff" for day in row["days"] if day not in judged]


def person_days(items, increment=TENTH_SECONDS, minimum=TENTH_SECONDS):
    """{(date, user): seconds} into billed increments and written-off person-days."""
    billed, written_off = {}, {}
    for key, total in items.items():
        if total < minimum:
            written_off[key] = total
        else:
            billed[key] = -(-total // increment)
    return billed, written_off


def unit_hours(units, increment=TENTH_SECONDS):
    return Decimal(units * increment) / 3600


def fees(billed, people, increment=TENTH_SECONDS):
    return sum((unit_hours(units, increment) * Decimal(str(people[user]["rate"]))).quantize(CENT, ROUND_HALF_UP)
               for (_, user), units in billed.items())


def tally(pairs):
    totals = {}
    for key, value in pairs:
        totals[key] = totals.get(key, 0) + value
    return totals


def check_lines(lines, by_id, main_ids, people):
    """One line per entry, and each billed line complete. Returns {check name: problems}."""
    seen = {}
    for line in lines:
        seen.setdefault(str(line.get("entry_id")), []).append(line)
    per_entry = [f"entry {i} has no line" for i in main_ids if i not in seen]
    per_entry += [f"line for entry {i} matches no connector entry" for i in seen if i not in by_id]
    per_entry += [f"entry {i} has {len(group)} lines" for i, group in seen.items() if len(group) > 1]
    evidence, description, rates, late, disposition, written, excluded = [], [], [], [], [], [], []
    for line in lines:
        entry_id = str(line.get("entry_id"))
        if entry_id not in by_id:
            continue
        if entry_id not in main_ids and not (line.get("late_reason") or "").strip():
            late.append(f"entry {entry_id} is outside the window with no late_reason")
        if line.get("disposition") == "write_off":
            if not (line.get("write_off_reason") or "").strip():
                written.append(f"entry {entry_id} is written off with no reason")
            continue
        if line.get("disposition") != "bill":
            disposition.append(f"entry {entry_id} has disposition {line.get('disposition')!r}")
            continue
        judged = line.get("proposal_id") is not None and line.get("evidence")
        word = line.get("no_evidence_confirmed") and line.get("estimate_seconds") is not None
        if not (judged or word):
            evidence.append(f"entry {entry_id} has no determination with evidence and no confirmed estimate")
        if not (line.get("confirmed") or "").strip():
            evidence.append(f"entry {entry_id} records no confirmation")
        evidence += not_metadata(line.get("evidence"), f"entry {entry_id}")
        for item in line.get("excluded") or []:
            if not item.get("marker") or not int(item.get("seconds") or 0) > 0 or not (item.get("confirmed") or "").strip():
                excluded.append(f"entry {entry_id} excludes time with no marker, seconds or approval")
        if line_map.excluded_seconds(line) > seconds(by_id[entry_id]):
            excluded.append(f"entry {entry_id} excludes more than it tracked")
        if len((line.get("description") or "").strip()) < MIN_DESCRIPTION:
            description.append(f"entry {entry_id} has a description under {MIN_DESCRIPTION} characters")
        person = people.get(by_id[entry_id]["user_name"], {})
        if not person.get("rate") or not person.get("initials"):
            rates.append(f"{by_id[entry_id]['user_name']} has no rate or initials")
    return {"line_per_entry": per_entry, "line_disposition": disposition, "late_lines": late,
            "write_off_reasons": written, "line_evidence": evidence, "line_description": description,
            "line_exclusions": excluded, "people": sorted(set(rates))}


def not_metadata(rows, where):
    """Evidence rows hold metadata and references, never a mail body, document text or OCR."""
    return [f"{where} cites a row holding {field}" for row in rows or [] for field in sorted(NOT_EVIDENCE_FIELDS & set(row))]


def check_estimates(estimates, people):
    problems = []
    keys = [item.get("key") for item in estimates]
    problems += [f"estimate key {key!r} is used twice" for key in sorted({k for k in keys if keys.count(k) > 1}, key=str)]
    for item in estimates:
        name = f"estimate {item.get('key')}"
        missing = [field for field in ("key", "date", "user", "description", "basis", "method", "reason", "approved_by", "approved_at")
                   if not item.get(field)]
        if missing:
            problems.append(f"{name} has no {', '.join(missing)}")
            continue
        if not int(item.get("seconds") or 0) > 0:
            problems.append(f"{name} has no minutes")
        if len(item["description"].strip()) < MIN_DESCRIPTION:
            problems.append(f"{name} has a description under {MIN_DESCRIPTION} characters")
        person = people.get(item["user"], {})
        if not person.get("rate") or not person.get("initials"):
            problems.append(f"{item['user']} has no rate or initials")
        problems += not_metadata(item["basis"], name)
    return problems


def load_coverage(path):
    rows = load_json(path, "coverage")
    if not isinstance(rows, list):
        stop(f"coverage {path} is not a JSON array")
    return rows


def unavailable_by_date(coverage):
    out = {}
    for row in coverage:
        detail = row.get("error_detail") or ""
        if row.get("status") == "skipped" and detail.startswith(UNAVAILABLE):
            out.setdefault(row["local_date"], []).append({"source": row["source_name"], "reason": detail[len(UNAVAILABLE):].strip()})
    return out


def check_scope(coverage, run_started, allowed):
    """Evidence fetched in this run stays on this matter's dates."""
    if not run_started:
        return []
    return sorted({f"{row['local_date']} was fetched in this run but is off this matter's dates" for row in coverage
                   if str(row.get("fetched_at") or "") >= run_started and row.get("status") in ("fetched", "empty")
                   and row.get("local_date") not in allowed})


def supported(line):
    """What this line's evidence supports, or the estimate where nothing bounds it."""
    value = line.get("supported_seconds")
    return value if value is not None else line.get("estimate_seconds")


def check_accuracy(billable, by_id, people, draft_fees, estimates=(), increment=TENTH_SECONDS, minimum=TENTH_SECONDS):
    unbounded = [str(l["entry_id"]) for l in billable if supported(l) is None]
    if unbounded:
        return [f"no supported span or estimate for entries {', '.join(unbounded)}"], None
    pairs = [((by_id[str(l["entry_id"])]["date"], by_id[str(l["entry_id"])]["user_name"]), int(supported(l))) for l in billable]
    pairs += [((e["date"], e["user"]), int(e["seconds"])) for e in estimates]
    perfect_billed, _ = person_days(tally(pairs), increment, minimum)
    perfect = fees(perfect_billed, people, increment)
    if not perfect:
        return ["the perfect-tracking total is nil"], perfect
    if not perfect * 4 <= draft_fees * 5 <= perfect * 6:
        return [f"draft fees {draft_fees} are outside 80% to 120% of the perfect-tracking {perfect}"], perfect
    return [], perfect


def check_coverage(candidates, billed_days, dispositions):
    problems = []
    for row in candidates:
        if row["strength"] not in JUDGED_STRENGTHS or set(row["days"]) & billed_days:
            continue
        given = dispositions.get(row["cell"]) or {}
        if given.get("status") not in ("written_off", "unexplained") or not (given.get("reason") or "").strip():
            problems.append(f"{row['cell']} ({row['strength']}) is not covered, written off or listed unexplained")
    return problems


def hours(total_seconds):
    return f"{total_seconds / 3600:.3f}"


def audit_text(the_date, lines, by_id, estimates=(), unavailable=None):
    out = [f"# Billable time audit, {the_date}", ""]
    for item in sorted(estimates, key=lambda e: (e["date"], e["key"])):
        out.append(f"## Estimate {item['key']}: {item['date']}, {item['user']}, {hours(int(item['seconds']))} h")
        out.append(f"- Description: {item['description']}")
        out.append(f"- How it was estimated: {item['method']}. Why: {item['reason']}")
        out.append(f"- Approved by {item['approved_by']} on {item['approved_at']}")
        out += [f"- Evidence: {row.get('source')} {row.get('native_id')} at {row.get('time')}" for row in item["basis"]]
        out.append("")
    for day, gone in sorted((unavailable or {}).items()):
        out += [f"## Sources unavailable on {day}", ""] + [f"- {g['source']}: {g['reason']}" for g in gone] + [""]
    for line in sorted(lines, key=lambda l: (by_id[str(l["entry_id"])]["date"], by_id[str(l["entry_id"])].get("start_time", ""))):
        entry = by_id[str(line["entry_id"])]
        out.append(f"## Entry {entry['id']}: {entry['date']}, {entry['user_name']}, "
                   f"{entry.get('start_time', '')} to {entry.get('end_time', '')}, {hours(seconds(entry))} h")
        out.append(f"- Disposition: {line['disposition']}")
        if line.get("description"):
            out.append(f"- Description: {line['description']}")
        out.append(f"- Determination: {line.get('proposal_id') if line.get('proposal_id') is not None else 'none'}")
        for row in line.get("evidence") or []:
            out.append(f"- Evidence: {row.get('source')} {row.get('native_id')} at {row.get('time')}")
        if line.get("confirmed"):
            out.append(f"- Practitioner: {line['confirmed']}")
        for item in line.get("excluded") or []:
            out.append(f"- Taken off as non-billable: {hours(int(item['seconds']))} h, matching {item['marker']}. Practitioner: {item['confirmed']}")
        if line.get("supported_seconds") is not None:
            out.append(f"- Evidence supports: {hours(line['supported_seconds'])} h")
        if line.get("estimate_seconds") is not None:
            out.append(f"- Practitioner's estimate: {hours(line['estimate_seconds'])} h")
        if line.get("write_off_reason"):
            out.append(f"- Written off because: {line['write_off_reason']}")
        if line.get("late_reason"):
            out.append(f"- Late line because: {line['late_reason']}")
        out.append("")
    return "\n".join(out)


def table(headers, rows):
    out = ["| " + " | ".join(headers) + " |", "|" + "---|" * len(headers)]
    out += ["| " + " | ".join(str(c).replace("|", "/") for c in row) + " |" for row in rows]
    return out + [""]


def summary_text(the_date, result, vetted, by_id, not_candidates, unavailable=None):
    lines = vetted["lines"]
    out = [f"# Billable time summary, {the_date}", "", "## Person-day totals", ""]
    out += table(["Date", "Person", "Unrounded h", "Rounded h", "Rate", "Amount"],
                 [(r["date"], r["user"], r["unrounded_hours"], r["hours"], r["rate"], r["amount"]) for r in result["rows"]])
    out += [f"Fees {result['subtotal']}, on {result['rounded_hours']} h rounded from {result['unrounded_hours']} h.",
            f"Perfect-tracking fees {result['perfect']}: the draft is within 80% to 120% of it.", "", "## Lines", ""]
    billed = [l for l in lines if l["disposition"] == "bill"]
    out += table(["Date", "Person", "Start", "End", "Hours", "Description", "Entry"],
                 [(by_id[str(l["entry_id"])]["date"], by_id[str(l["entry_id"])]["user_name"],
                   by_id[str(l["entry_id"])].get("start_time", ""), by_id[str(l["entry_id"])].get("end_time", ""),
                   hours(seconds(by_id[str(l["entry_id"])])), l["description"], l["entry_id"]) for l in billed])
    out += ["## Write-offs", ""]
    rows = [(by_id[str(l["entry_id"])]["date"], by_id[str(l["entry_id"])]["user_name"],
             hours(seconds(by_id[str(l["entry_id"])])), l["write_off_reason"]) for l in lines if l["disposition"] == "write_off"]
    rows += [(day, user, hours(total), "a person's day under 0.1 h") for (day, user), total in result["under_minimum"].items()]
    out += table(["Date", "Person", "Hours", "Why"], rows) if rows else ["None.", ""]
    out += ["## Estimates: documented work with no TimeCamp entry", ""]
    rows = [(e["date"], e["user"], hours(int(e["seconds"])), e["description"], e["reason"],
             "; ".join(f"{b.get('source')} {b.get('native_id')}" for b in e["basis"])) for e in vetted.get("estimates") or []]
    out += table(["Date", "Person", "Estimated h", "Description", "Why", "Evidence"], rows) if rows else ["None.", ""]
    out += ["## Non-billable time taken off", ""]
    rows = [(by_id[str(l["entry_id"])]["date"], l["entry_id"], hours(int(i["seconds"])), i["marker"], i["confirmed"])
            for l in billed for i in l.get("excluded") or []]
    out += table(["Date", "Entry", "Hours", "Matched", "Approval"], rows) if rows else ["None.", ""]
    out += ["## Sources unavailable", ""]
    rows = [(day, g["source"], g["reason"]) for day, gone in sorted((unavailable or {}).items()) for g in gone]
    out += table(["Date", "Source", "Why"], rows) if rows else ["None.", ""]
    out += ["## Late lines", ""]
    rows = [(by_id[str(l["entry_id"])]["date"], l["entry_id"], l["late_reason"]) for l in billed if l.get("late_reason")]
    out += table(["Work date", "Entry", "Why"], rows) if rows else ["None.", ""]
    out += ["## Billed on the practitioner's word, with no judged evidence", ""]
    rows = [(by_id[str(l["entry_id"])]["date"], by_id[str(l["entry_id"])]["user_name"], l["entry_id"], l["confirmed"])
            for l in billed if l.get("no_evidence_confirmed")]
    out += table(["Date", "Person", "Entry", "Confirmation"], rows) if rows else ["None.", ""]
    out += ["## Unexplained candidate dates", ""]
    rows = [(cell, given["reason"]) for cell, given in (vetted.get("candidates") or {}).items() if given.get("status") == "unexplained"]
    out += table(["Date", "Note"], rows) if rows else ["None.", ""]
    out += ["## TimeCamp dates that were not candidates", ""]
    out += [", ".join(not_candidates) if not_candidates else "None.", "", "## Gaps", ""]
    out += [f"- {gap}" for gap in vetted.get("gaps") or []] or ["None."]
    return "\n".join(out) + "\n"


def run_final(args, entries, candidates, failures):
    vetted = load_json(args.vetted, "vetted lines")
    late_entries = [e for path in args.late_entries for e in load_entries(path)]
    by_id = {str(e["id"]): e for e in entries + late_entries}
    main_ids = {str(e["id"]) for e in entries}
    people = vetted.get("people") or {}
    lines = vetted.get("lines") or []
    estimates = vetted.get("estimates") or []
    increment, minimum = args.increment_seconds, args.minimum_seconds
    coverage = load_coverage(args.coverage) if args.coverage else []
    for name, problems in check_lines(lines, by_id, main_ids, people).items():
        failures[name] = problems
    failures["estimates"] = check_estimates(estimates, people)

    known = [l for l in lines if str(l.get("entry_id")) in by_id]
    billable = [l for l in known if l.get("disposition") == "bill"]
    if any(failures.values()):
        return None
    per_day = tally([((by_id[str(l["entry_id"])]["date"], by_id[str(l["entry_id"])]["user_name"]),
                      seconds(by_id[str(l["entry_id"])]) - line_map.excluded_seconds(l)) for l in billable]
                    + [((e["date"], e["user"]), int(e["seconds"])) for e in estimates])
    billed, under_minimum = person_days(per_day, increment, minimum)
    draft_fees = fees(billed, people, increment) if billed else Decimal(0)
    failures["rounding"] = [f"{key} rounds below its unrounded time" for key, units in billed.items()
                            if units * increment < per_day[key]]
    failures["invoice_accuracy"], perfect = check_accuracy(billable, by_id, people, draft_fees, estimates, increment, minimum)
    billed_days = {day for day, _ in billed} | {by_id[str(l["entry_id"])]["date"] for l in known if l["disposition"] == "write_off"}
    billed_days |= {day for day, _ in under_minimum}
    failures["candidate_coverage"] = check_coverage(candidates, billed_days, vetted.get("candidates") or {})
    days_listed = {day for row in candidates for day in row["days"]}
    failures["run_scope"] = check_scope(coverage, args.run_started, days_listed | {e["date"] for e in late_entries} | {e["date"] for e in estimates})
    if any(failures.values()):
        return None

    unavailable = unavailable_by_date(coverage)
    tenths = increment % TENTH_SECONDS == 0
    rows = []
    for (day, user), units in sorted(billed.items()):
        tracked = [l for l in billable if (by_id[str(l["entry_id"])]["date"], by_id[str(l["entry_id"])]["user_name"]) == (day, user)]
        estimated = [e for e in estimates if (e["date"], e["user"]) == (day, user)]
        wording = [l["description"].strip() for l in tracked] + [e["description"].strip() for e in estimated]
        rate = Decimal(str(people[user]["rate"]))
        billed_hours = unit_hours(units, increment)
        rows.append({"line_key": f"{day}|{user}", "date": day, "user": user, "initials": people[user]["initials"],
                     "description": "; ".join(dict.fromkeys(wording)),
                     "unrounded_hours": hours(per_day[(day, user)]), "hours": f"{billed_hours:.1f}" if tenths else f"{billed_hours:.2f}",
                     "rate": str(rate.quantize(CENT)),
                     "amount": str((billed_hours * rate).quantize(CENT, ROUND_HALF_UP)),
                     "provenance": "+".join(name for name, held in (("tracker", tracked), ("estimate", estimated)) if held),
                     "rounding": {"from_seconds": per_day[(day, user)], "rule": f"a person's day rounds up to the next {increment} seconds"},
                     "support": {"evidence_rows": sum(len(l.get("evidence") or []) for l in tracked) + sum(len(e["basis"]) for e in estimated),
                                 "estimate_bases": len(estimated) + sum(1 for l in tracked if l.get("no_evidence_confirmed"))},
                     "unavailable": unavailable.get(day, [])})
    result = {"rows": rows, "subtotal": str(draft_fees.quantize(CENT)), "perfect": str(perfect),
              "unrounded_hours": hours(sum(per_day[k] for k in billed)),
              "rounded_hours": f"{sum(unit_hours(u, increment) for u in billed.values()):.1f}" if tenths else f"{sum(unit_hours(u, increment) for u in billed.values()):.2f}",
              "under_minimum": under_minimum}
    not_candidates = sorted({e["date"] for e in entries} - days_listed)

    report_dir = Path(args.report_dir)
    report_dir.mkdir(parents=True, exist_ok=True)
    (report_dir / f"{args.date} Billable time audit.md").write_text(audit_text(args.date, known, by_id, estimates, unavailable), encoding="utf-8")
    (report_dir / f"{args.date} Billable time summary.md").write_text(
        summary_text(args.date, result, vetted, by_id, not_candidates, unavailable), encoding="utf-8")
    data_dir = Path(args.data_dir)
    data_dir.mkdir(parents=True, exist_ok=True)
    (data_dir / "invoice_lines.json").write_text(
        json.dumps({"passed_on": args.date, **{k: result[k] for k in ("rows", "subtotal", "unrounded_hours", "rounded_hours")}}, indent=2), encoding="utf-8")
    adjustments = line_map.adjustments_for(known, estimates, by_id, under_minimum, args.date, vetted.get("decided_by") or "the practitioner")
    (data_dir / "line_map.json").write_text(json.dumps(
        {**line_map.build(args.date, rows, known, estimates, by_id, people, under_minimum, adjustments, vetted, not_candidates),
         "subtotal": result["subtotal"]}, indent=2), encoding="utf-8")
    (data_dir / "time_entries.json").write_text(
        json.dumps(line_map.time_entries(known, estimates, by_id, under_minimum), indent=2), encoding="utf-8")
    return result


def parse(argv):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="stage", required=True)
    for stage in ("pull", "final"):
        one = sub.add_parser(stage)
        one.add_argument("--entries", required=True)
        one.add_argument("--connector-count", type=int, required=True)
        one.add_argument("--connector-hours", type=float, required=True)
        one.add_argument("--candidates", required=True)
        one.add_argument("--last-billed", required=True)
        one.add_argument("--judged", required=True)
    final = sub.choices["final"]
    final.add_argument("--vetted", required=True)
    final.add_argument("--late-entries", action="append", default=[])
    final.add_argument("--date", required=True)
    final.add_argument("--report-dir", required=True)
    final.add_argument("--data-dir", required=True)
    final.add_argument("--coverage")
    final.add_argument("--run-started")
    final.add_argument("--increment-seconds", type=int, default=TENTH_SECONDS)
    final.add_argument("--minimum-seconds", type=int, default=TENTH_SECONDS)
    return parser.parse_args(argv)


def main(argv=None):
    args = parse(argv)
    entries = load_entries(args.entries)
    candidates = load_candidates(args.candidates)
    failures = {
        "window": check_window(entries, args.last_billed),
        "connector_total": check_connector(entries, args.connector_count, args.connector_hours),
        "judged_dates": check_judged(candidates, load_judged(args.judged)),
    }
    result = None
    if args.stage == "final" and not any(failures.values()):
        result = run_final(args, entries, candidates, failures)
    failed = {name: problems for name, problems in failures.items() if problems}
    verdict = {"verdict": "fail" if failed else "pass", "stage": args.stage, "entries": len(entries), "failed": failed}
    if result:
        verdict.update(fees=result["subtotal"], perfect_tracking=result["perfect"], rounded_hours=result["rounded_hours"])
    print(json.dumps(verdict))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
