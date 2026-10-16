#!/usr/bin/env python3
"""Turn the Chrometa historical export into a JSONL file for
`time_pipeline__bulk_apply`.

This script NEVER opens the time-pipeline database. It reads the xlsx, writes a
file of write-operations, and prints a summary. The only component that touches
the database is the `bulk_apply` tool, reached through /time-pipeline-data.

Standard library only (root CLAUDE.md): an xlsx is a zip of XML, so `zipfile` +
`xml.etree` do the parsing. No openpyxl, no pandas.

The parsing and mapping rules implemented here are documented in
`build-timeline/reference/Chrometa.md`; that file is the specification and this
is its executable form. Keep the two in step.

Usage:
    python chrometa_to_jsonl.py --out C:/path/to/chrometa.jsonl
    python chrometa_to_jsonl.py --out out.jsonl --xlsx "C:/other/export.xlsx"
"""

import argparse
import datetime
import hashlib
import json
import os
import re
import sys
import zipfile
from xml.etree import ElementTree as ET

NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
RNS = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
PKG_RELS = "{http://schemas.openxmlformats.org/package/2006/relationships}"

DEFAULT_XLSX = (
    r"C:\Users\Brahm\Sync\ADMIN\TIME TRACKING\Chrometa Time Records"
    r"\Consolidated Time Summaries.xlsx"
)
DEFAULT_SHEET = "Sheet2"
DEFAULT_TIMEZONE = "America/Vancouver"

# The import's replace scope: the full nominal window, not just the dates that
# happen to carry rows. Local dates, half-open.
WINDOW_START = datetime.date(2019, 1, 1)
WINDOW_END = datetime.date(2020, 4, 1)

SOURCE = "chrometa"
NAMESPACE = "timeline"

# Columns A..M in the header row, in order. A mismatch is a hard failure.
EXPECTED_HEADER = [
    "Source.Name", "Day", "Start", "End", "Duration", "Duration (Minutes)",
    "Annotation", "Task", "Activity", "URL", "Client", "Project",
    "Marked as Exported to Tabs3?",
]
COLUMNS = "ABCDEFGHIJKLM"

# Excel's day 0. Serial 43648.678472222222 is 2019-07-02 16:17 local.
EXCEL_EPOCH = datetime.datetime(1899, 12, 30)

COMPACT = {"ensure_ascii": False, "separators": (",", ":")}


class ImportError_(Exception):
    """A failure the practitioner must see. This import is explicit and
    on-demand, so it reports rather than degrading silently."""


def load_zone(name):
    from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

    try:
        return ZoneInfo(name)
    except ZoneInfoNotFoundError:
        raise ImportError_(
            "Chrometa import failed -- this Python cannot resolve the timezone "
            "%r. Windows ships no IANA timezone database; install it with "
            "`pip install tzdata`." % name
        )


def read_shared_strings(zf):
    if "xl/sharedStrings.xml" not in zf.namelist():
        return []
    out = []
    with zf.open("xl/sharedStrings.xml") as fh:
        for _, el in ET.iterparse(fh, events=("end",)):
            if el.tag == NS + "si":
                out.append("".join(t.text or "" for t in el.iter(NS + "t")))
                el.clear()
    return out


def find_sheet_part(zf, sheet_name):
    """Map a sheet's display name to its part path via workbook.xml + rels."""
    book = ET.fromstring(zf.read("xl/workbook.xml"))
    rels = ET.fromstring(zf.read("xl/_rels/workbook.xml.rels"))
    targets = {r.get("Id"): r.get("Target") for r in rels.iter(PKG_RELS + "Relationship")}
    for sheet in book.iter(NS + "sheet"):
        if sheet.get("name") == sheet_name:
            target = targets.get(sheet.get(RNS + "id"), "")
            return "xl/" + target.lstrip("/").removeprefix("xl/")
    found = [s.get("name") for s in book.iter(NS + "sheet")]
    raise ImportError_(
        "Chrometa import failed -- sheet %r not found. Sheets present: %s"
        % (sheet_name, ", ".join(found) or "(none)")
    )


def cell_values(row, shared):
    """Return {column letter: text}. Empty cells are omitted from the XML
    entirely, so cells are read by their `r=` reference, never by position."""
    out = {}
    for c in row.findall(NS + "c"):
        col = re.match(r"([A-Z]+)", c.get("r")).group(1)
        kind = c.get("t")
        if kind == "s":
            v = c.find(NS + "v")
            out[col] = shared[int(v.text)] if v is not None else ""
        elif kind == "inlineStr":
            node = c.find(NS + "is")
            out[col] = "".join(t.text or "" for t in node.iter(NS + "t")) if node is not None else ""
        else:
            v = c.find(NS + "v")
            out[col] = v.text if v is not None else ""
    return out


def serial_to_local(serial, label, row_no):
    """Excel serial number to a naive local datetime at minute precision.
    `Start`/`End`/`Day` are numbers in this export, not text."""
    try:
        days = float(serial)
    except (TypeError, ValueError):
        raise ImportError_(
            "Chrometa import failed -- row %d has an unparseable %s value %r."
            % (row_no, label, serial)
        )
    whole = int(days)
    return EXCEL_EPOCH + datetime.timedelta(days=whole, minutes=round((days - whole) * 1440.0))


def to_utc_iso(naive_local, zone):
    return (
        naive_local.replace(tzinfo=zone)
        .astimezone(datetime.timezone.utc)
        .strftime("%Y-%m-%dT%H:%M:%SZ")
    )


def blank(value):
    return (value or "").strip() == ""


def number(text):
    """Duration (Minutes) is numeric. Keep it a number, integral where it is."""
    if blank(text):
        return None
    value = float(text)
    return int(value) if value.is_integer() else value


def parse_rows(zf, sheet_part, shared, zone):
    """Yield one dict per data row, in sheet order. Rows with a blank `Start`
    are the sheet's own trailing total rows: skipped, counted, not an error."""
    rows_read = 0
    footer_skipped = 0
    records = []
    with zf.open(sheet_part) as fh:
        for _, el in ET.iterparse(fh, events=("end",)):
            if el.tag != NS + "row":
                continue
            row_no = int(el.get("r"))
            cells = cell_values(el, shared)
            el.clear()
            if row_no == 1:
                header = [cells.get(c, "") for c in COLUMNS]
                if header != EXPECTED_HEADER:
                    raise ImportError_(
                        "Chrometa import failed -- unexpected columns.\n  expected: %s\n  found:    %s"
                        % (EXPECTED_HEADER, header)
                    )
                continue
            rows_read += 1
            if blank(cells.get("C")):
                footer_skipped += 1
                continue
            start_local = serial_to_local(cells.get("C"), "Start", row_no)
            end_local = serial_to_local(cells.get("D"), "End", row_no)
            activity = cells.get("I", "")
            client = cells.get("K", "")
            start_ts = to_utc_iso(start_local, zone)
            end_ts = to_utc_iso(end_local, zone)
            # No stable id column exists. Activity is freeform and can contain
            # the `:` id separator, so the composite is hashed, not embedded.
            composite = "%s|%s|%s|%s" % (start_ts, end_ts, activity, client)
            records.append({
                "native_id": hashlib.sha1(composite.encode("utf-8")).hexdigest()[:16],
                "start_local": start_local,
                "end_local": end_local,
                "start_ts": start_ts,
                "end_ts": end_ts,
                "annotation": cells.get("G", ""),
                "payload": {
                    "source_file": cells.get("A", ""),
                    "day": (
                        serial_to_local(cells.get("B"), "Day", row_no).date().isoformat()
                        if not blank(cells.get("B")) else None
                    ),
                    "duration": cells.get("E", ""),
                    "duration_minutes": number(cells.get("F")),
                    "annotation": None if blank(cells.get("G")) else cells.get("G"),
                    "task": None if blank(cells.get("H")) else cells.get("H"),
                    "activity": activity,
                    "url": cells.get("J", ""),
                    "client": client,
                    "project": cells.get("L", ""),
                    "marked_exported_to_tabs3": cells.get("M", ""),
                },
            })
    return records, rows_read, footer_skipped


def collapse_duplicates(records):
    """Group by native_id and keep one row per group. Duration is identical
    within a group, so not collapsing would double-count the same minutes.

    Keep the annotated row where only one side is annotated. Where two sides
    carry distinct non-empty annotations, keep the first in sheet order and
    park the others in `_collapsed_annotations` -- the only synthetic key in
    raw_payload, its leading underscore marking it as not a source column."""
    groups = {}
    for rec in records:
        groups.setdefault(rec["native_id"], []).append(rec)

    kept = []
    collapsed = 0
    for group in groups.values():
        collapsed += len(group) - 1
        winner = next((r for r in group if not blank(r["annotation"])), group[0])
        extras = [
            r["annotation"] for r in group
            if r is not winner and not blank(r["annotation"]) and r["annotation"] != winner["annotation"]
        ]
        if extras:
            winner["payload"]["_collapsed_annotations"] = extras
        kept.append(winner)
    return kept, collapsed


def local_dates(rec):
    """Every local date the activity's half-open [start, end) interval touches.
    An activity ending at exactly 00:00 does not reach the following day."""
    first = rec["start_local"].date()
    if rec["end_local"] > rec["start_local"]:
        last = (rec["end_local"] - datetime.timedelta(microseconds=1)).date()
    else:
        last = first
    out = []
    day = first
    while day <= last:
        out.append(day)
        day += datetime.timedelta(days=1)
    return out


def build_operations(kept, zone, fetched_at):
    """The write plan, in the order bulk_apply applies it."""
    kept.sort(key=lambda r: (r["start_ts"], r["native_id"]))
    ops = []
    by_date = {}
    cross_midnight = 0

    # 1. Drop every Chrometa activity row currently stored. The replace scope is
    #    the whole fixed window and every Chrometa row lies inside it, so this
    #    replaces Step 4.2's per-row range check outright.
    ops.append({"op": "delete_prefix", "prefix": "activity:%s:" % SOURCE})

    # 2. The rows themselves.
    ids = []
    for rec in kept:
        row_id = "%s:%s" % (SOURCE, rec["native_id"])
        ids.append(row_id)
        ops.append({
            "op": "set",
            "key": "activity:%s" % row_id,
            "value": json.dumps({
                "id": row_id,
                "source": SOURCE,
                "native_id": rec["native_id"],
                "start_ts": rec["start_ts"],
                "end_ts": rec["end_ts"],
                "raw_type": "screen_work",
                "raw_payload": rec["payload"],
                "fetched_at": fetched_at,
            }, **COMPACT),
        })
        dates = local_dates(rec)
        if len(dates) > 1:
            cross_midnight += 1
        for day in dates:
            if not (WINDOW_START <= day < WINDOW_END):
                raise ImportError_(
                    "Chrometa import failed -- row %s touches %s, outside the "
                    "fixed window [%s, %s)." % (row_id, day, WINDOW_START, WINDOW_END)
                )
            by_date.setdefault(day, []).append(row_id)

    # 3. This source's own index. No other source writes it, so a plain set is
    #    safe here in a way it is not for the shared by-date indexes.
    ops.append({
        "op": "set",
        "key": "index:activity:by-source:%s" % SOURCE,
        "value": json.dumps(ids, **COMPACT),
    })

    # 4. The by-date indexes are shared with every other source, so each one is
    #    merged, never overwritten. Every date in the window gets a line, not
    #    just the dates with rows: an empty `add` is what strips a stale
    #    Chrometa id from a date a corrected export no longer touches.
    day = WINDOW_START
    while day < WINDOW_END:
        ops.append({
            "op": "merge",
            "key": "index:activity:by-date:%s" % day.isoformat(),
            "add": by_date.get(day, []),
            "drop_prefix": "%s:" % SOURCE,
        })
        day += datetime.timedelta(days=1)

    # 5. Source metadata. The range is the full nominal window, so a later
    #    coverage check knows the window was checked, not merely un-fetched.
    window = [
        to_utc_iso(datetime.datetime.combine(WINDOW_START, datetime.time()), zone),
        to_utc_iso(datetime.datetime.combine(WINDOW_END, datetime.time()), zone),
    ]
    ops.append({
        "op": "set",
        "key": "source:%s:ranges" % SOURCE,
        "value": json.dumps([window], **COMPACT),
    })
    ops.append({"op": "set", "key": "source:%s:fetched_at" % SOURCE, "value": fetched_at})

    return ops, len(by_date), cross_midnight


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", required=True, help="JSONL file to write")
    ap.add_argument("--xlsx", default=DEFAULT_XLSX)
    ap.add_argument("--sheet", default=DEFAULT_SHEET)
    ap.add_argument("--timezone", default=DEFAULT_TIMEZONE)
    args = ap.parse_args(argv)

    if not os.path.isfile(args.xlsx):
        raise ImportError_("Chrometa import failed -- file not found at %s." % args.xlsx)

    zone = load_zone(args.timezone)
    fetched_at = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    try:
        zf = zipfile.ZipFile(args.xlsx)
    except zipfile.BadZipFile as exc:
        raise ImportError_("Chrometa import failed -- %s is not readable as xlsx (%s)." % (args.xlsx, exc))

    with zf:
        shared = read_shared_strings(zf)
        sheet_part = find_sheet_part(zf, args.sheet)
        records, rows_read, footer_skipped = parse_rows(zf, sheet_part, shared, zone)

    kept, collapsed = collapse_duplicates(records)
    ops, dates_with_rows, cross_midnight = build_operations(kept, zone, fetched_at)

    with open(args.out, "w", encoding="utf-8", newline="\n") as fh:
        for op in ops:
            fh.write(json.dumps(op, **COMPACT) + "\n")

    print(json.dumps({
        "xlsx": args.xlsx,
        "sheet": args.sheet,
        "timezone": args.timezone,
        "out": os.path.abspath(args.out),
        "rows_read": rows_read,
        "footer_rows_skipped": footer_skipped,
        "duplicates_collapsed": collapsed,
        "activities": len(kept),
        "dates_with_rows": dates_with_rows,
        "cross_midnight_activities": cross_midnight,
        "jsonl_lines": len(ops),
        "fetched_at": fetched_at,
    }, indent=2))


if __name__ == "__main__":
    try:
        main()
    except ImportError_ as exc:
        print(str(exc), file=sys.stderr)
        raise SystemExit(1)
