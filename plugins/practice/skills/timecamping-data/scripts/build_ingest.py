#!/usr/bin/env python3
"""Turn one day's source material into a JSONL file for
`timecamping_data__bulk_upsert`.

This script NEVER opens a database. It reads files the caller already produced
(a `time_pipeline__export` of build-timeline's stored rows, which are activity
rows for every timeline source but sent mail and event rows for sent mail, a
TimeCamp entries response, a SyncoPaid captures response), appends one line per
source row plus one `source_fetch_log` line to `--out`, and prints a JSON
summary. The rows never pass through the caller's context: only the summary
does.

Each output line is {"table": ..., "key": [...], "row": {...}}. Row values are
JSON scalars (raw_payload is JSON-encoded here), a source row is keyed on
`native_id` and a fetch-log row on (source_name, local_date), and `id` is never
emitted. It lives in the /timecamping-data gatekeeper because it carries the
seven source tables' column names (references/schema.sql).

A required field missing from an input row is a hard failure naming it, never a
default. A failed invocation appends nothing.

Standard library only. Usage (one --out file per day, one bulk_upsert call):
    python build_ingest.py timeline --source timecamp --export tc.jsonl --date 2026-09-01 --out day.jsonl
    python build_ingest.py timeline --source sent_mail --export sm.jsonl --date 2026-09-01 --out day.jsonl
    python build_ingest.py timecamp-entries --json entries.json --date 2026-09-01 --user-id 123 --out day.jsonl
    python build_ingest.py syncopaid-captures --json captures.json --date 2026-09-01 --out day.jsonl
    python build_ingest.py fetch-log --source telus_calls --date 2026-09-01 --status skipped --out day.jsonl
"""

import argparse
import datetime
import json
import re
import sys

DEFAULT_TIMEZONE = "America/Vancouver"
UTC = datetime.timezone.utc

# source_fetch_log.source_name is the source's table name: the assembly gate
# joins on it, so an informal name ("gcal") would leave the day blocked.
SOURCE_TABLES = (
    "timecamp_time_entries",
    "timecamp_computer_activities",
    "syncopaid_captures",
    "telus_calls",
    "gcal_events",
    "icloud_events",
    "sent_mail",
)
TIMELINE_TABLES = {
    "timecamp": "timecamp_computer_activities",
    "telus": "telus_calls",
    "gcal": "gcal_events",
    "icloud": "icloud_events",
    "sent_mail": "sent_mail",
}
# The iCloud calendars in scope (build-timeline/reference/ICloudCalendar.md,
# decided on #1199). A row from any other calendar, Family included, fails.
ICLOUD_CALENDARS = ("Work", "Home")
# The sent-mail folders in scope (build-timeline/reference/SentMail.md,
# decided on #1261, Sent Messages added on #942), in precedence order. A row
# from any other folder fails. A message in several keeps its earliest copy.
SENT_MAIL_FOLDERS = (
    "Sent Items",
    "Sent Items/Outbound LEAP Matter Based Emails",
    "Sent Messages",
    "Sent Messages/Outbound LEAP Matter Based Emails",
)
SOURCE_KEY = ["native_id"]
FETCH_LOG_KEY = ["source_name", "local_date"]

COMPACT = {"ensure_ascii": False, "separators": (",", ":")}


def fail(message):
    raise SystemExit("build_ingest: " + message)


def load_zone(name):
    from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

    try:
        return ZoneInfo(name)
    except ZoneInfoNotFoundError:
        fail(
            "this Python cannot resolve the timezone %r. Windows ships no IANA "
            "timezone database; install it with `pip install tzdata`." % name
        )


def need(obj, key, where):
    if not isinstance(obj, dict):
        fail("%s is not a JSON object" % where)
    if key not in obj:
        fail("%s: required key %r is missing" % (where, key))
    return obj[key]


def parse_instant(value, where):
    """An ISO 8601 instant with an offset (or Z), as an aware UTC datetime.
    Sub-microsecond digits (SyncoPaid writes seven) are dropped before parsing."""
    if isinstance(value, str):
        text = re.sub(r"(\.\d{6})\d+", r"\1", value.strip())
        if text.endswith("Z"):
            text = text[:-1] + "+00:00"
        try:
            parsed = datetime.datetime.fromisoformat(text)
        except ValueError:
            parsed = None
        if parsed is not None and parsed.tzinfo is not None:
            return parsed.astimezone(UTC)
    fail("%s: %r is not an ISO 8601 instant with a UTC offset" % (where, value))


def utc_text(instant):
    return instant.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def now_utc():
    return utc_text(datetime.datetime.now(UTC))


def parse_date(text):
    try:
        return datetime.date.fromisoformat(text)
    except ValueError:
        fail("--date %r is not YYYY-MM-DD" % text)


def local_date(instant, zone):
    return instant.astimezone(zone).date().isoformat()


def day_bounds_utc(day, zone):
    start = datetime.datetime.combine(day, datetime.time(), tzinfo=zone)
    end = datetime.datetime.combine(day + datetime.timedelta(days=1), datetime.time(), tzinfo=zone)
    return start.astimezone(UTC), end.astimezone(UTC)


def source_line(table, row):
    return {"table": table, "key": SOURCE_KEY, "row": row}


def fetch_log_line(table, day, status, row_count, error_detail=None):
    return {
        "table": "source_fetch_log",
        "key": FETCH_LOG_KEY,
        "row": {
            "source_name": table,
            "local_date": day,
            "status": status,
            "row_count": row_count,
            "error_detail": error_detail,
            "fetched_at": now_utc(),
        },
    }


def append(out, lines):
    with open(out, "a", encoding="utf-8", newline="\n") as fh:
        for line in lines:
            fh.write(json.dumps(line, **COMPACT) + "\n")


def read_json(path):
    try:
        with open(path, "r", encoding="utf-8-sig") as fh:
            return json.load(fh)
    except FileNotFoundError:
        fail("file not found: %s" % path)
    except ValueError as exc:
        fail("%s is not valid JSON: %s" % (path, exc))


def payload_json(obj):
    return json.dumps(obj, **COMPACT)


# --- timeline (build-timeline's stored rows, via time_pipeline__export) -------
#
# The stored row shape is build-timeline/SKILL.md's activity row schema: id,
# source, native_id, start_ts, end_ts (UTC), raw_type, raw_payload (an object),
# fetched_at. TimeCamp and GCal payload keys are the shapes surveyed from the
# live store on 2026-09-22. Telus's follow time-sorting (`phone_number`/
# `contact_name`) and snake-cased CSV columns: the store held no Telus row to
# survey, and TelusConnect.md pins only `format`, `Direction`, `internal`,
# `anonymous` and `unnormalized`. Any required key missing is a hard failure
# naming it; a present key's null value passes through where the column is nullable.
#
# Sent mail is the exception: its stored rows are build-timeline/SKILL.md's
# event row schema, one instant `ts` and no start_ts or end_ts, exported under
# the prefix `event:sent_mail:`, and filtered to the local date of `ts`.


def map_timecamp(row, payload, where):
    # Stored only inside raw_payload, but splice.sql reads it to attribute the
    # row to its entry (#1102), so a fetch that drops it must fail here.
    need(payload, "entry_id", where + " raw_payload")
    return {
        "native_id": need(row, "native_id", where),
        "application": need(payload, "application", where + " raw_payload"),
        "window_title": need(payload, "window_title", where + " raw_payload"),
        "timecamp_task_id": need(payload, "task_id", where + " raw_payload"),
    }


def map_telus(row, payload, where, start, end):
    # Telus rows carry a minute-precision start and end = start + the CSV's
    # Duration (TelusConnect.md), so the interval is the call's duration.
    return {
        "native_id": need(row, "native_id", where),
        "phone_number": need(payload, "phone_number", where + " raw_payload"),
        "contact_name": need(payload, "contact_name", where + " raw_payload"),
        "action": need(payload, "action", where + " raw_payload"),
        "action_result": need(payload, "action_result", where + " raw_payload"),
        "result_description": need(payload, "result_description", where + " raw_payload"),
        "duration_seconds": int((end - start).total_seconds()),
        "raw_type": need(row, "raw_type", where),
        # TelusConnect.md sets `internal: true` on an extension and nothing otherwise.
        "is_internal": 1 if payload.get("internal") is True else 0,
    }


def bool_flag(value, key, where):
    if not isinstance(value, bool):
        fail("%s raw_payload: %s %r is not a boolean" % (where, key, value))
    return 1 if value else 0


def map_gcal(row, payload, where):
    attendees = payload.get("attendees")
    return {
        # gcal_events.native_id is the stored row id, 'gcal:{event_id}' (schema.sql).
        "native_id": need(row, "id", where),
        "calendar_id": need(payload, "calendar_id", where + " raw_payload"),
        "all_day": bool_flag(need(payload, "all_day", where + " raw_payload"), "all_day", where),
        "title": need(payload, "summary", where + " raw_payload"),
        # GoogleCalendar.md: description, location and attendees are optional.
        # transparency, created and updated are nullable columns: null on the
        # browser route, and the connector route may omit them.
        "description": payload.get("description"),
        "location": payload.get("location"),
        "transparency": payload.get("transparency"),
        "attendees": None if attendees is None else payload_json(attendees),
        "created": payload.get("created"),
        "updated": payload.get("updated"),
    }


def map_icloud(row, payload, where):
    # The payload is the extension's event verbatim plus calendar_url, which the
    # fetch records from the qualified calendar list (ICloudCalendar.md).
    calendar = need(payload, "calendar", where + " raw_payload")
    if calendar not in ICLOUD_CALENDARS:
        fail("%s raw_payload: calendar %r is not an iCloud calendar in scope (%s)"
             % (where, calendar, ", ".join(ICLOUD_CALENDARS)))
    return {
        # native_id is '{uid}_{local start date}', with #2, #3 for further same-day
        # occurrences of one uid (build-timeline/reference/ICloudCalendar.md).
        "native_id": need(row, "native_id", where),
        "calendar": calendar,
        "calendar_url": need(payload, "calendar_url", where + " raw_payload"),
        "all_day": bool_flag(need(payload, "allDay", where + " raw_payload"), "allDay", where),
        "busy": bool_flag(need(payload, "busy", where + " raw_payload"), "busy", where),
        "title": need(payload, "title", where + " raw_payload"),
        # The extension omits location when an event has none, and returns
        # notes only when asked for them.
        "location": payload.get("location"),
        "notes": payload.get("notes"),
        "uid": need(payload, "uid", where + " raw_payload"),
    }


def recipients(payload, key, where):
    # The extension leaves cc out when a message has none (seen live on #942).
    if key == "cc" and key not in payload:
        return payload_json([])
    value = need(payload, key, where + " raw_payload")
    if not isinstance(value, list):
        fail("%s raw_payload: %s %r is not a JSON array" % (where, key, value))
    return payload_json(value)


def map_sent_mail(row, payload, where):
    # The payload is the extension's search result message verbatim, never a
    # body (build-timeline/reference/SentMail.md).
    folder = need(payload, "folder", where + " raw_payload")
    if folder not in SENT_MAIL_FOLDERS:
        fail("%s raw_payload: folder %r is not a sent-mail folder in scope (%s)"
             % (where, folder, ", ".join(SENT_MAIL_FOLDERS)))
    sender = need(payload, "from", where + " raw_payload")
    if not isinstance(sender, str):
        fail("%s raw_payload: from %r is not a string" % (where, sender))
    # native_id is the RFC 5322 Message-ID, angle brackets stripped (SentMail.md).
    # A bracketed one would load a second key for the same email.
    native_id = need(row, "native_id", where)
    if not isinstance(native_id, str) or native_id.startswith("<") or native_id.endswith(">"):
        fail("%s: native_id %r is not a Message-ID with its angle brackets stripped" % (where, native_id))
    return {
        "native_id": native_id,
        "sent_ts": row["ts"],
        "folder": folder,
        "from_address": sender,
        "subject": need(payload, "subject", where + " raw_payload"),
        "to_recipients": recipients(payload, "to", where),
        "cc_recipients": recipients(payload, "cc", where),
        "uid": need(payload, "uid", where + " raw_payload"),
    }


def cmd_timeline(args):
    zone = load_zone(args.timezone)
    day = parse_date(args.date).isoformat()
    table = TIMELINE_TABLES[args.source]
    considered = 0
    lines = []
    kept = {}  # sent mail: native_id -> its index in lines
    folders_seen = {}  # sent mail: native_id -> the folders it was read from
    try:
        fh = open(args.export, "r", encoding="utf-8")
    except FileNotFoundError:
        fail("file not found: %s" % args.export)
    with fh:
        for line_no, raw in enumerate(fh, 1):
            raw = raw.strip()
            if not raw:
                continue
            try:
                entry = json.loads(raw)
            except ValueError as exc:
                fail("%s line %d is not valid JSON: %s" % (args.export, line_no, exc))
            if need(entry, "op", "export line %d" % line_no) != "set":
                fail("export line %d is not a set line" % line_no)
            try:
                row = json.loads(need(entry, "value", "export line %d" % line_no))
            except (TypeError, ValueError) as exc:
                fail("export line %d value is not a JSON row: %s" % (line_no, exc))
            considered += 1
            where = "timeline row %r" % entry.get("key")
            source = need(row, "source", where)
            if source != args.source:
                fail("%s is from source %r, not %r" % (where, source, args.source))
            if args.source == "sent_mail":
                start = parse_instant(need(row, "ts", where), where + " ts")
            else:
                start = parse_instant(need(row, "start_ts", where), where + " start_ts")
                end = parse_instant(need(row, "end_ts", where), where + " end_ts")
            if local_date(start, zone) != day:
                continue
            payload = need(row, "raw_payload", where)
            if not isinstance(payload, dict):
                fail("%s raw_payload is not a JSON object" % where)
            if args.source == "timecamp":
                mapped = map_timecamp(row, payload, where)
            elif args.source == "telus":
                mapped = map_telus(row, payload, where, start, end)
            elif args.source == "gcal":
                mapped = map_gcal(row, payload, where)
            elif args.source == "icloud":
                mapped = map_icloud(row, payload, where)
            else:
                mapped = map_sent_mail(row, payload, where)
            if args.source != "sent_mail":
                mapped.update({"start_ts": row["start_ts"], "end_ts": row["end_ts"]})
            mapped.update({
                "local_date": day,
                "raw_payload": payload_json(payload),
                "fetched_at": need(row, "fetched_at", where),
            })
            if args.source == "sent_mail":
                native_id = mapped["native_id"]
                if native_id in kept:
                    # One row per Message-ID; the earliest folder's copy wins (SentMail.md).
                    if mapped["folder"] in folders_seen[native_id]:
                        fail("%s: Message-ID %r appears twice in folder %r" % (where, native_id, mapped["folder"]))
                    folders_seen[native_id].add(mapped["folder"])
                    other = lines[kept[native_id]]["row"]["folder"]
                    if SENT_MAIL_FOLDERS.index(mapped["folder"]) < SENT_MAIL_FOLDERS.index(other):
                        lines[kept[native_id]] = source_line(table, mapped)
                    continue
                kept[native_id] = len(lines)
                folders_seen[native_id] = {mapped["folder"]}
            lines.append(source_line(table, mapped))
    rows = len(lines)
    status = "fetched" if rows else "empty"
    lines.append(fetch_log_line(table, day, status, rows))
    append(args.out, lines)
    return {"table": table, "date": day, "status": status, "rows": rows, "considered": considered}


# --- timecamp-entries (timecamping/reference/TimeCampEntries.md) -------------


def cmd_timecamp_entries(args):
    zone = load_zone(args.timezone)
    day = parse_date(args.date)
    entries = read_json(args.json)
    if not isinstance(entries, list):
        fail("%s is not a JSON array of time entries" % args.json)
    fetched_at = now_utc()
    lines = []
    for i, entry in enumerate(entries):
        where = "time entry %d" % i
        if str(need(entry, "user_id", where)) != str(args.user_id):
            continue
        if need(entry, "date", where) != day.isoformat():
            continue
        where = "time entry %r" % need(entry, "id", where)
        start = datetime.datetime.combine(day, datetime.time.fromisoformat(need(entry, "start_time", where)), tzinfo=zone)
        end = datetime.datetime.combine(day, datetime.time.fromisoformat(need(entry, "end_time", where)), tzinfo=zone)
        if end < start:
            fail("%s ends (%s) before it starts (%s)" % (where, entry["end_time"], entry["start_time"]))
        lines.append(source_line("timecamp_time_entries", {
            "native_id": str(entry["id"]),
            "start_ts": utc_text(start),
            "end_ts": utc_text(end),
            "local_date": day.isoformat(),
            "duration_seconds": int(need(entry, "duration", where)),
            "timecamp_task_id": need(entry, "task_id", where),
            "task_display": need(entry, "name", where),
            "task_color": need(entry, "color", where),
            "description": need(entry, "description", where),
            "billable": int(need(entry, "billable", where)),
            "locked": int(need(entry, "locked", where)),
            "raw_payload": payload_json(entry),
            "fetched_at": fetched_at,
        }))
    rows = len(lines)
    status = "fetched" if rows else "empty"
    lines.append(fetch_log_line("timecamp_time_entries", day.isoformat(), status, rows))
    append(args.out, lines)
    return {"table": "timecamp_time_entries", "date": day.isoformat(), "status": status, "rows": rows, "considered": len(entries)}


# --- syncopaid-captures (timecamping/reference/SyncoPaidCaptures.md) ---------


def nested(capture, key, inner, where):
    value = need(capture, key, where)
    return None if value is None else need(value, inner, "%s %s" % (where, key))


def cmd_syncopaid_captures(args):
    zone = load_zone(args.timezone)
    day = parse_date(args.date)
    body = read_json(args.json)
    expected_from, expected_to = day_bounds_utc(day, zone)
    for field, expected in (("fromUtcInclusive", expected_from), ("toUtcExclusive", expected_to)):
        got = parse_instant(need(body, field, "captures response"), "captures response " + field)
        if got != expected:
            fail("captures response %s is %s, but local date %s starts/ends at %s" % (
                field, utc_text(got), day.isoformat(), utc_text(expected)))
    if need(body, "truncated", "captures response") is not False:
        fail("captures response is truncated (truncated=%r); page the query rather than ingest a partial day"
             % body["truncated"])
    captures = need(body, "captures", "captures response")
    if not isinstance(captures, list):
        fail("captures response `captures` is not a JSON array")

    timed = []
    seen_ids = set()
    for i, cap in enumerate(captures):
        where = "capture %d" % i
        cap_id = need(cap, "id", where)
        # A repeated capture would otherwise take a #2 suffix and load as a phantom row.
        if cap_id in seen_ids:
            fail("capture %r appears more than once in the captures response" % (cap_id,))
        seen_ids.add(cap_id)
        instant = parse_instant(need(cap, "capturedAtUtc", where), where + " capturedAtUtc")
        second = utc_text(instant.replace(microsecond=0))
        # end_ts chains to the next capture, so file order must be time order to the second.
        if timed and second < timed[-1][1]:
            fail("capture %r at %s comes after capture %r at %s in file order; captures must not go back a second"
                 % (cap_id, second, timed[-1][2]["id"], timed[-1][1]))
        timed.append((instant, second, cap))
    # Captures sharing a second: the first by full precision keeps the bare id,
    # the rest get #2, #3, ... (the Telus same-minute rule).
    timed.sort(key=lambda t: t[0])
    instants = [second for _, second, _ in timed]
    native_ids = []
    for i, second in enumerate(instants):
        ordinal = ordinal + 1 if i and instants[i - 1] == second else 1
        native_ids.append(second if ordinal == 1 else "%s#%d" % (second, ordinal))

    fetched_at = now_utc()
    lines = []
    for i, (_, second, cap) in enumerate(timed):
        where = "capture %r" % cap["id"]
        lines.append(source_line("syncopaid_captures", {
            "native_id": native_ids[i],
            "captured_at": second,
            "end_ts": instants[i + 1] if i + 1 < len(instants) else None,
            "local_date": local_date(parse_instant(second, where), zone),
            "process_name": need(cap, "processName", where),
            "window_title": need(cap, "windowTitle", where),
            "mouse_clicks": need(cap, "mouseClicksSincePreviousCapture", where),
            "keyboard_events": need(cap, "keyboardEventsSincePreviousCapture", where),
            "screenshot_ref": nested(cap, "screenshot", "id", where),
            "ocr_text": nested(cap, "ocr", "text", where),
            # The confirmed capture shape carries a matter display, no matter id.
            "syncopaid_matter_id": None,
            "syncopaid_matter_display": nested(cap, "matterSignal", "resolvedMatterDisplay", where),
            "raw_payload": payload_json(cap),
            "fetched_at": fetched_at,
        }))
    rows = len(lines)
    status = "fetched" if rows else "empty"
    lines.append(fetch_log_line("syncopaid_captures", day.isoformat(), status, rows))
    append(args.out, lines)
    return {"table": "syncopaid_captures", "date": day.isoformat(), "status": status, "rows": rows}


# --- fetch-log (the exits that produce no rows) -------------------------------


def cmd_fetch_log(args):
    if args.source not in SOURCE_TABLES:
        fail("--source %r is not a source table; use one of: %s" % (args.source, ", ".join(SOURCE_TABLES)))
    day = parse_date(args.date).isoformat()
    append(args.out, [fetch_log_line(args.source, day, args.status, 0, args.error_detail)])
    return {"table": args.source, "date": day, "status": args.status, "rows": 0}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("timeline", help="build-timeline rows from a time_pipeline__export file")
    p.add_argument("--source", required=True, choices=sorted(TIMELINE_TABLES))
    p.add_argument("--export", required=True)
    p.set_defaults(func=cmd_timeline)

    p = sub.add_parser("timecamp-entries", help="a TimeCamp /entries/ response")
    p.add_argument("--json", required=True)
    p.add_argument("--user-id", required=True)
    p.set_defaults(func=cmd_timecamp_entries)

    p = sub.add_parser("syncopaid-captures", help="a SyncoPaid `evidence query` response")
    p.add_argument("--json", required=True)
    p.set_defaults(func=cmd_syncopaid_captures)

    p = sub.add_parser("fetch-log", help="a status line for an exit that produced no rows")
    p.add_argument("--source", required=True)
    p.add_argument("--status", required=True, choices=["skipped", "failed", "empty"])
    p.add_argument("--error-detail")
    p.set_defaults(func=cmd_fetch_log)

    for p in sub.choices.values():
        p.add_argument("--date", required=True)
        p.add_argument("--out", required=True)
        if p.get_default("func") is not cmd_fetch_log:
            p.add_argument("--timezone", default=DEFAULT_TIMEZONE)

    args = parser.parse_args(argv)
    print(json.dumps(args.func(args), **COMPACT))


if __name__ == "__main__":
    main()
