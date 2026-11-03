#!/usr/bin/env python3
"""Turn a folder of TELUS Business Connect call-log zips into one JSONL file for
`timecamping_data__bulk_upsert`.

This script NEVER opens a database and never changes a file in the folder. It
reads each top-level *.zip in name order, reads the zip's one CSV in memory, and
writes `--out` afresh: one `telus_calls` line per call, then one
`source_fetch_log` line per date the archive covers. It prints a JSON summary.
The rows never pass through the caller's context: only the summary does.

A file's header decides its format. `portal` has no Direction and dates its rows
`Thu 2026-08-27`, or `Mon 07/12/2020` (DD/MM/YYYY) in the earliest files. `archive`
has Direction, From, To and Extension, and only its Voice rows on an own
extension are calls. A second carrier gets its own adapter and its own table, as
gcal_events and icloud_events did, because the assembly gate keys on table names.

A validation error stops that file: nothing from it is kept, its dates stay
uncovered, and the summary's `files_failed` names the file, line and value.

`--timeline-out DATE --timeline-file P` also writes that date's calls as
`time_pipeline__bulk_apply` set lines, for /build-timeline.

Standard library only. Usage:
    python import_calls.py --folder F --own-extension "4 - Name" [--own-extension E2]
        [--timezone TZ] --out O [--timeline-out DATE --timeline-file P]
"""

import argparse
import calendar
import collections
import csv
import datetime
import io
import json
import os
import re
import zipfile

from build_ingest import (
    COMPACT,
    DEFAULT_TIMEZONE,
    fail,
    fetch_log_line,
    load_zone,
    now_utc,
    parse_date,
    payload_json,
    source_line,
    utc_text,
)

TABLE = "telus_calls"
PORTAL_COLUMNS = ("type", "phone number", "date", "time", "action", "action result", "duration")
ARCHIVE_COLUMNS = ("type", "direction", "from", "to", "extension", "date", "time", "action", "action result", "duration")
MAX_DURATION_SECONDS = 8 * 3600
RINGOUT = "RingOut PC"
WEEKDAYS = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")


class FileError(Exception):
    """A file that cannot be read as a call log. It stops that file only."""


# --- reading one zip -----------------------------------------------------------


def read_rows(path):
    """The zip's one CSV as (format, [(line number, {lowercase column: value})])."""
    try:
        with zipfile.ZipFile(path) as archive:
            members = [n for n in archive.namelist() if n.lower().endswith(".csv")]
            if len(members) != 1:
                raise FileError("holds %d CSV files, not 1" % len(members))
            raw = archive.read(members[0])
    except zipfile.BadZipFile:
        raise FileError("is not a zip file")
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise FileError("is not UTF-8 encoded")
    reader = csv.reader(io.StringIO(text))
    try:
        header = [cell.strip().lower() for cell in next(reader)]
    except StopIteration:
        raise FileError("has no header row")
    if "phone number" in header:
        kind, required = "portal", PORTAL_COLUMNS
    elif "direction" in header:
        kind, required = "archive", ARCHIVE_COLUMNS
    else:
        raise FileError("has an unknown header: %s" % ", ".join(header))
    missing = [column for column in required if column not in header]
    if missing:
        raise FileError("is missing column(s) %s; found %s" % (", ".join(missing), ", ".join(header)))
    rows = []
    for cells in reader:
        cells = [cell.strip() for cell in cells]
        if not any(cells) or cells[0].startswith("#"):
            continue
        rows.append((reader.line_num, dict(zip(header, cells))))
    return kind, rows


def parse_call_date(value, line):
    """`Thu 2026-08-27` or `Mon 07/12/2020`. The weekday must agree, which is what
    proves the slash form is day first."""
    match = re.fullmatch(r"([A-Za-z]{3}) (?:(\d{4})-(\d{2})-(\d{2})|(\d{2})/(\d{2})/(\d{4}))", value)
    if not match:
        raise FileError("line %d: Date %r is neither `Thu 2026-08-27` nor `Mon 07/12/2020`" % (line, value))
    weekday, year, month, day, slash_day, slash_month, slash_year = match.groups()
    try:
        if year:
            parsed = datetime.date(int(year), int(month), int(day))
        else:
            parsed = datetime.date(int(slash_year), int(slash_month), int(slash_day))
    except ValueError:
        raise FileError("line %d: Date %r is not a real date" % (line, value))
    if WEEKDAYS[parsed.weekday()] != weekday:
        raise FileError("line %d: Date %r: %s is not a %s" % (line, value, parsed.isoformat(), weekday))
    return parsed


def parse_time(value, line):
    try:
        return datetime.datetime.strptime(value, "%I:%M %p").time()
    except ValueError:
        raise FileError("line %d: Time %r is not `1:39 PM`" % (line, value))


def parse_duration(value, line):
    match = re.fullmatch(r"(\d+):(\d{2}):(\d{2})", value)
    if not match:
        raise FileError("line %d: Duration %r is not H:MM:SS" % (line, value))
    seconds = int(match.group(1)) * 3600 + int(match.group(2)) * 60 + int(match.group(3))
    if seconds > MAX_DURATION_SECONDS:
        raise FileError("line %d: Duration %r is over 8 hours" % (line, value))
    return seconds


def normalize_phone(value):
    """(the stored number, its payload flags). A withheld caller and a misdial are
    real calls, so neither is an error."""
    digits = re.sub(r"\D", "", value)
    if not digits:
        return "anonymous", {"anonymous": True}
    if len(digits) == 10:
        return "+1" + digits, {}
    if len(digits) == 11 and digits.startswith("1"):
        return "+" + digits, {}
    if len(digits) <= 4:
        return digits, {"internal": True}
    return digits, {"unnormalized": True}


def calls_in_file(kind, rows, own_extensions, counts):
    """The file's Voice rows on an own extension, as calls. The counterparty of an
    archive row is From on an incoming call and To on an outgoing one."""
    calls = []
    for line, row in rows:
        row_type = row.get("type", "")
        if row_type == "Fax":
            counts["fax_dropped"] += 1
            continue
        if row_type != "Voice":
            counts["legs_dropped"] += 1
            continue
        extension = None
        direction = None
        if kind == "archive":
            extension = row.get("extension", "")
            if extension not in own_extensions:
                counts["other_extension_dropped"] += 1
                continue
            direction = row.get("direction", "")
            if direction not in ("Incoming", "Outgoing"):
                raise FileError("line %d: Direction %r is neither Incoming nor Outgoing" % (line, direction))
            counterparty = row.get("from" if direction == "Incoming" else "to", "")
        else:
            counterparty = row.get("phone number", "")
        phone, flags = normalize_phone(counterparty)
        counts["unnormalized"] += 1 if flags.get("unnormalized") else 0
        day = parse_call_date(row.get("date", ""), line)
        at = parse_time(row.get("time", ""), line)
        calls.append({
            "kind": kind,
            "extension": extension,
            "direction": direction,
            "phone": phone,
            "flags": flags,
            "day": day,
            "at": at,
            "seconds": parse_duration(row.get("duration", ""), line),
            "name": row.get("name", ""),
            "action": row.get("action", ""),
            "result": row.get("action result", ""),
            "description": row.get("result description", ""),
            "key": "c%sT%s%s" % (day.isoformat(), at.strftime("%H:%M"), phone),
        })
    return calls


# --- two rows with one key -----------------------------------------------------


def collapse_ringout(group, counts):
    """A click-to-call writes a RingOut PC row and a leg with the same duration."""
    durations = {call["seconds"] for call in group if call["action"] == RINGOUT}
    kept = [call for call in group if call["action"] == RINGOUT or call["seconds"] not in durations]
    counts["ringout_dropped"] += len(group) - len(kept)
    return kept


def collapse_extensions(group, counts):
    """The same call on two own extensions is one call, the longer of the two. Two
    rows on one extension stay two calls."""
    kept = []
    for call in sorted(group, key=lambda c: -c["seconds"]):
        twin = next((k for k in kept if call["extension"] not in k["extensions"]), None)
        if twin is None:
            kept.append(dict(call, extensions={call["extension"]}))
        else:
            twin["extensions"].add(call["extension"])
            counts["extension_duplicates_dropped"] += 1
    return kept


def resolve_keys(calls, counts):
    """(native_id, call) for each distinct call. Same-minute calls are ordered by
    duration, longest first, and the rest take #2, #3."""
    groups = collections.OrderedDict()
    for call in calls:
        groups.setdefault(call["key"], []).append(call)
    resolved = []
    for key, group in groups.items():
        group = collapse_extensions(collapse_ringout(group, counts), counts)
        for ordinal, call in enumerate(group, 1):
            resolved.append((key if ordinal == 1 else "%s#%d" % (key, ordinal), call))
    return resolved


# --- what a file covers --------------------------------------------------------


def covered_dates(name):
    """The dates a file's name vouches for as complete. A calendar-month archive
    holds its whole month. A daily portal file holds its own date and the one before.
    Any other window, the 30th-to-30th series included, vouches for nothing."""
    window = re.match(r"[a-z]{3}(\d{4}-\d{2}-\d{2})_[a-z]{3}(\d{4}-\d{2}-\d{2}) rcvd", name)
    if window:
        first = datetime.date.fromisoformat(window.group(1))
        last = datetime.date.fromisoformat(window.group(2))
        month_end = calendar.monthrange(first.year, first.month)[1]
        if first.day == 1 and (last.year, last.month, last.day) == (first.year, first.month, month_end):
            return [first + datetime.timedelta(days=i) for i in range(month_end)]
        return []
    iso = re.match(r"(\d{4}-\d{2}-\d{2}) rcvd", name)
    packed = re.match(r"(\d{2})(\d{2})(\d{4}) rcvd", name)
    if iso:
        day = datetime.date.fromisoformat(iso.group(1))
    elif packed:
        day = datetime.date(int(packed.group(3)), int(packed.group(2)), int(packed.group(1)))
    else:
        return []
    return [day - datetime.timedelta(days=1), day]


# --- rows ----------------------------------------------------------------------


def call_row(native_id, call, zone, fetched_at):
    start = datetime.datetime.combine(call["day"], call["at"], tzinfo=zone)
    end = start + datetime.timedelta(seconds=call["seconds"])
    # time-sorting and splice.sql read these payload keys.
    payload = {
        "format": call["kind"],
        "direction": call["direction"],
        "extension": call["extension"],
        "phone_number": call["phone"],
        "contact_name": call["name"],
        "action": call["action"],
        "action_result": call["result"],
        "result_description": call["description"],
    }
    payload.update(call["flags"])
    return {
        "native_id": native_id,
        "start_ts": utc_text(start),
        "end_ts": utc_text(end),
        "local_date": call["day"].isoformat(),
        "phone_number": call["phone"],
        "contact_name": call["name"],
        "action": call["action"],
        "action_result": call["result"],
        "result_description": call["description"],
        "duration_seconds": call["seconds"],
        "raw_type": "voicemail" if call["result"] == "Voicemail" else "phone_call",
        "is_internal": 1 if call["flags"].get("internal") else 0,
        "raw_payload": payload_json(payload),
        "fetched_at": fetched_at,
    }


def timeline_line(row):
    """A /build-timeline activity row, as a time_pipeline__bulk_apply set line."""
    value = {
        "id": "telus:" + row["native_id"],
        "source": "telus",
        "native_id": row["native_id"],
        "start_ts": row["start_ts"],
        "end_ts": row["end_ts"],
        "raw_type": row["raw_type"],
        "raw_payload": json.loads(row["raw_payload"]),
        "fetched_at": row["fetched_at"],
    }
    return {"op": "set", "key": "activity:" + value["id"], "value": payload_json(value)}


def write_lines(path, lines):
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        for line in lines:
            fh.write(json.dumps(line, **COMPACT) + "\n")


def run(args):
    if not os.path.isdir(args.folder):
        fail("folder not found: %s" % args.folder)
    if bool(args.timeline_out) != bool(args.timeline_file):
        fail("--timeline-out and --timeline-file go together")
    zone = load_zone(args.timezone)
    own = set(args.own_extension)
    fetched_at = now_utc()
    names = sorted(n for n in os.listdir(args.folder) if n.lower().endswith(".zip"))

    totals = collections.Counter()
    failed = []
    rows = {}
    covered = set()
    for name in names:
        counts = collections.Counter()
        try:
            kind, raw = read_rows(os.path.join(args.folder, name))
            calls = resolve_keys(calls_in_file(kind, raw, own, counts), counts)
        except FileError as exc:
            failed.append({"file": name, "error": str(exc)})
            continue
        totals.update(counts)
        totals["files_read"] += 1
        covered.update(covered_dates(name))
        for native_id, call in calls:
            row = call_row(native_id, call, zone, fetched_at)
            earlier = rows.get(native_id)
            if earlier and earlier["duration_seconds"] != row["duration_seconds"]:
                totals["duration_changed_between_files"] += 1
            rows[native_id] = row

    per_day = collections.Counter(row["local_date"] for row in rows.values())
    lines = [source_line(TABLE, rows[native_id]) for native_id in sorted(rows)]
    for day in sorted(d.isoformat() for d in covered):
        lines.append(fetch_log_line(TABLE, day, "fetched" if per_day[day] else "empty", per_day[day]))
    write_lines(args.out, lines)

    summary = {
        "table": TABLE,
        "rows_kept": len(rows),
        "dates_covered": len(covered),
        "files_failed": failed,
    }
    for key in ("files_read", "legs_dropped", "fax_dropped", "other_extension_dropped", "ringout_dropped",
                "extension_duplicates_dropped", "unnormalized", "duration_changed_between_files"):
        summary[key] = totals[key]
    if args.timeline_out:
        day = parse_date(args.timeline_out)
        day_rows = [rows[n] for n in sorted(rows) if rows[n]["local_date"] == day.isoformat()]
        write_lines(args.timeline_file, [timeline_line(row) for row in day_rows])
        summary["timeline"] = {"date": day.isoformat(), "rows": len(day_rows), "covered": day in covered}
    return summary


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--folder", required=True)
    parser.add_argument("--own-extension", required=True, action="append")
    parser.add_argument("--timezone", default=DEFAULT_TIMEZONE)
    parser.add_argument("--out", required=True)
    parser.add_argument("--timeline-out")
    parser.add_argument("--timeline-file")
    print(json.dumps(run(parser.parse_args(argv)), **COMPACT))


if __name__ == "__main__":
    main()
