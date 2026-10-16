"""Tests for scripts/build_ingest.py -- synthetic fixtures only, no database.

Run from the repo root:
    python -m unittest discover -s .claude/skills/timecamping-data/tests
"""

import json
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SKILL = Path(__file__).resolve().parents[1]
SCRIPT = SKILL / "scripts" / "build_ingest.py"
SCHEMA = SKILL / "references" / "schema.sql"

DAY = "2026-09-01"
SOURCE_TABLES = (
    "timecamp_time_entries",
    "timecamp_computer_activities",
    "syncopaid_captures",
    "telus_calls",
    "gcal_events",
    "icloud_events",
    "sent_mail",
)
LEAP_FOLDER = "Sent Items/Outbound LEAP Matter Based Emails"
SENT_MESSAGES_LEAP_FOLDER = "Sent Messages/Outbound LEAP Matter Based Emails"
ICLOUD_WORK_URL = "https://caldav.icloud.com/131943092/calendars/F627AFCE-6CEC-4E54-ABA3-8304E5B7127B/"
ICLOUD_HOME_URL = "https://caldav.icloud.com/131943092/calendars/home/"


def load_schema():
    """{table: {column: required}} from the canonical DDL. A column is required
    when it is NOT NULL with no DEFAULT (the rowid alias `id` never is)."""
    tables = {}
    for name, body in re.findall(r"CREATE TABLE (\w+) \((.*?)\);\n", SCHEMA.read_text(encoding="utf-8"), re.S):
        columns = {}
        for line in body.splitlines():
            line = line.split("--", 1)[0].strip().strip(",").strip()
            if not line:
                continue
            first = line.split()[0]
            if first.upper() in ("UNIQUE", "PRIMARY", "CHECK", "FOREIGN", "CONSTRAINT"):
                continue
            upper = line.upper()
            columns[first] = "NOT NULL" in upper and "DEFAULT" not in upper
        tables[name] = columns
    return tables


TABLES = load_schema()


def export_line(row):
    kind = "event" if row["source"] == "sent_mail" else "activity"
    return {"op": "set", "key": kind + ":" + row["id"], "value": json.dumps(row)}


def timecamp_activity(native_id, start, end="2026-09-01T16:10:00Z", application="LEAP", drop=None):
    # The stored shape surveyed from the live store on 2026-09-22.
    payload = {
        "user_id": "1715896",
        "application_id": "4463331",
        "end_time": "2026-09-01 09:10:00",
        "time_span": 300,
        "window_title_id": "999260288",
        "end_date": "2026-09-01",
        "task_id": "0",
        "entry_id": "0",
        "updated_at": "2026-09-01 09:12:37",
        "update_date": "2026-09-01",
        "application": application,
        "window_title": "Smith v Jones - LEAP",
    }
    if drop:
        del payload[drop]
    return {
        "id": "timecamp:" + native_id,
        "source": "timecamp",
        "native_id": native_id,
        "start_ts": start,
        "end_ts": end,
        "raw_type": "screen_work",
        "raw_payload": payload,
        "fetched_at": "2026-09-02T03:00:00Z",
    }


def telus_call(native_id="c2026-09-01T09:20+16045551234", payload_extra=None, drop=None):
    payload = {
        "format": "portal",
        "type": "Voice",
        "phone_number": "+16045551234",
        "contact_name": "Jesse Marlowe",
        "action": "VoIP Call",
        "action_result": "Call connected",
        "result_description": "",
    }
    payload.update(payload_extra or {})
    if drop:
        del payload[drop]
    return {
        "id": "telus:" + native_id,
        "source": "telus",
        "native_id": native_id,
        "start_ts": "2026-09-01T16:20:00Z",
        "end_ts": "2026-09-01T16:21:16Z",
        "raw_type": "phone_call",
        "raw_payload": payload,
        "fetched_at": "2026-09-02T03:00:00Z",
    }


def gcal_event(event_id="abc123", all_day=False, start_ts="2026-09-01T18:00:00Z", drop=None):
    # The stored shape surveyed from the live store on 2026-09-22 (browser
    # route: created, updated and transparency are present but null).
    payload = {
        "event_id": event_id,
        "calendar_id": "lawyer@example.com",
        "local_date": "2026-09-01",
        "all_day": all_day,
        "start_local": "11:00",
        "end_local": "11:30",
        "summary": "Meeting with Jesse",
        "location": "Zoom",
        "organizer": "jesse@example.com",
        "attendees": [{"email_or_name": "jesse@example.com", "response": "accepted"}],
        "description": "best phone number to reach you.: +1 604-555-1234",
        "transparency": None,
        "created": None,
        "updated": None,
        "route": "browser (calendar.google.com /u/2, schedule view)",
    }
    if drop:
        del payload[drop]
    return {
        "id": "gcal:" + event_id,
        "source": "gcal",
        "native_id": event_id,
        "start_ts": start_ts,
        "end_ts": "2026-09-01T18:30:00Z",
        "raw_type": None,
        "raw_payload": payload,
        "fetched_at": "2026-09-02T03:00:00Z",
    }


def icloud_event(uid="E1F2-0001", calendar="Work", start_ts="2026-09-01T17:00:00Z",
                 end_ts="2026-09-01T17:30:00Z", drop=None, **payload_extra):
    # The event as the legal plugin's contacts-calendars-email server's calendar__list_events returns it with
    # includeNotes, plus calendar_url, which the fetch records from the
    # qualified calendar list (build-timeline/reference/ICloudCalendar.md).
    payload = {
        "calendar": calendar,
        "title": "Call with Jesse",
        "start": "2026-09-01T10:00:00-07:00",
        "end": "2026-09-01T10:30:00-07:00",
        "allDay": False,
        "location": "Zoom",
        "busy": True,
        "uid": uid,
        "url": ICLOUD_WORK_URL + uid + ".ics",
        "etag": '"mf2x4k1"',
        "notes": "Dial-in in the invite",
        "calendar_url": ICLOUD_HOME_URL if calendar == "Home" else ICLOUD_WORK_URL,
    }
    payload.update(payload_extra)
    if drop:
        del payload[drop]
    native_id = "%s_%s" % (uid, DAY)
    return {
        "id": "icloud:" + native_id,
        "source": "icloud",
        "native_id": native_id,
        "start_ts": start_ts,
        "end_ts": end_ts,
        "raw_type": None,
        "raw_payload": payload,
        "fetched_at": "2026-09-02T03:00:00Z",
    }


def sent_email(message_id="CAF1a2b3@mail.example.com", folder="Sent Items", ts="2026-09-01T17:05:00Z",
               drop=None, **payload_extra):
    # The message as the iCloud extension's mail_search_emails returns it, never
    # with a body (build-timeline/reference/SentMail.md), stored as an event row.
    payload = {
        "uid": 4812,
        "folder": folder,
        "date": "2026-09-01T10:05:00-07:00",
        "from": "Example Lawyer <lawyer@example.com>",
        "to": ["jesse@example.com"],
        "cc": [],
        "subject": "Re: Smith v Jones (L8948) - Settlement Memo",
        "messageId": "<" + message_id + ">",
        "seen": True,
        "size": 18422,
    }
    payload.update(payload_extra)
    if drop:
        del payload[drop]
    return {
        "id": "sent_mail:" + message_id,
        "source": "sent_mail",
        "native_id": message_id,
        "ts": ts,
        "raw_type": "email_sent",
        "raw_payload": payload,
        "fetched_at": "2026-09-02T03:00:00Z",
    }


def timecamp_entry(entry_id, user_id="111", date=DAY, start="09:00:00", end="09:30:00"):
    return {
        "id": entry_id,
        "duration": "1800",
        "user_id": user_id,
        "user_name": "Example Lawyer",
        "task_id": "115517729",
        "date": date,
        "start_time": start,
        "end_time": end,
        "locked": "1",
        "name": "Phone calls (to be sorted)",
        "billable": 1,
        "invoiceId": "0",
        "color": "#E5C947",
        "description": "",
        "task_note": "",
    }


def capture(capture_id, captured_at):
    return {
        "id": capture_id,
        "capturedAtUtc": captured_at,
        "capturedAtLocal": "ignored",
        "windowTitle": "Inbox - Outlook",
        "processName": "OUTLOOK",
        "appPath": "C:\\Program Files\\OUTLOOK.EXE",
        "screenshotState": "Recorded",
        "mouseClicksSincePreviousCapture": 2,
        "keyboardEventsSincePreviousCapture": 0,
        "screenshot": {"id": "shot-" + capture_id, "path": "x.enc", "encrypted": True, "fileExists": False},
        "ocr": {"status": "Succeeded", "textLength": 5, "text": "hello"},
        "matterSignal": {"state": "NoMatterSignal", "resolvedMatterDisplay": None, "candidateMatterDisplays": []},
    }


def captures_response(captures, **header):
    body = {
        "generatedAtUtc": "2026-09-02T03:00:00Z",
        "dataDirectory": "C:\\SyncoPaid",
        "fromUtcInclusive": "2026-09-01T07:00:00Z",
        "toUtcExclusive": "2026-09-02T07:00:00Z",
        "localTimeZone": "Pacific Standard Time",
        "matterIdFilter": None,
        "totalCapturesInWindow": len(captures),
        "returnedCaptures": len(captures),
        "truncated": False,
        "ocrTextIncluded": True,
    }
    body.update(header)
    body["captures"] = captures
    return body


class BuildIngestTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.dir = Path(self.tmp.name)
        self.out = self.dir / "ingest.jsonl"

    def write_jsonl(self, name, lines):
        path = self.dir / name
        path.write_text("".join(json.dumps(line) + "\n" for line in lines), encoding="utf-8")
        return path

    def write_json(self, name, obj):
        path = self.dir / name
        path.write_text(json.dumps(obj), encoding="utf-8")
        return path

    def run_script(self, *args, ok=True):
        proc = subprocess.run(
            [sys.executable, str(SCRIPT), *map(str, args)],
            capture_output=True,
            text=True,
            encoding="utf-8",
        )
        if ok:
            self.assertEqual(proc.returncode, 0, proc.stderr)
        else:
            self.assertNotEqual(proc.returncode, 0, "expected a failure; stdout: " + proc.stdout)
        return proc

    def lines(self):
        if not self.out.exists():
            return []
        return [json.loads(l) for l in self.out.read_text(encoding="utf-8").splitlines() if l]

    def assert_shape(self, line):
        table = line["table"]
        self.assertIn(table, TABLES)
        columns = TABLES[table]
        row = line["row"]
        self.assertNotIn("id", row, "the script must never emit id")
        for column, value in row.items():
            self.assertIn(column, columns, "%s.%s is not in schema.sql" % (table, column))
            self.assertIsInstance(value, (type(None), bool, int, float, str), "%s.%s is nested" % (table, column))
        for column, required in columns.items():
            if required:
                self.assertIn(column, row, "%s.%s is NOT NULL without a default" % (table, column))
        expected_key = ["source_name", "local_date"] if table == "source_fetch_log" else ["native_id"]
        self.assertEqual(line["key"], expected_key)

    def timeline(self, source, rows, *extra, ok=True):
        export = self.write_jsonl("export-%s.jsonl" % source, [export_line(r) for r in rows])
        return self.run_script(
            "timeline", "--source", source, "--export", export, "--date", DAY, "--out", self.out, *extra, ok=ok
        )

    # --- line shape against schema.sql ------------------------------------

    def test_every_subcommand_emits_schema_shaped_lines(self):
        self.timeline("timecamp", [timecamp_activity("48291", "2026-09-01T16:05:00Z")])
        self.timeline("telus", [telus_call()])
        self.timeline("gcal", [gcal_event()])
        self.timeline("icloud", [icloud_event()])
        self.timeline("sent_mail", [sent_email()])
        self.run_script(
            "timecamp-entries", "--json", self.write_json("tc.json", [timecamp_entry("282918696")]),
            "--date", DAY, "--user-id", "111", "--out", self.out,
        )
        self.run_script(
            "syncopaid-captures",
            "--json", self.write_json("sp.json", captures_response([capture("a", "2026-09-01T16:02:30.0416109Z")])),
            "--date", DAY, "--out", self.out,
        )
        self.run_script("fetch-log", "--source", "telus_calls", "--date", DAY, "--status", "skipped", "--out", self.out)

        lines = self.lines()
        for line in lines:
            self.assert_shape(line)
        self.assertEqual(
            sorted(l["table"] for l in lines if l["table"] != "source_fetch_log"),
            sorted([
                "timecamp_computer_activities", "telus_calls", "gcal_events", "icloud_events", "sent_mail",
                "timecamp_time_entries", "syncopaid_captures",
            ]),
        )
        self.assertEqual(
            sorted(l["row"]["source_name"] for l in lines if l["table"] == "source_fetch_log"),
            sorted(SOURCE_TABLES + ("telus_calls",)),
        )

    def test_raw_payload_is_a_json_string_of_the_whole_source_record(self):
        self.timeline("telus", [telus_call()])
        row = self.lines()[0]["row"]
        self.assertIsInstance(row["raw_payload"], str)
        self.assertEqual(json.loads(row["raw_payload"]), telus_call()["raw_payload"])

    # --- timeline ----------------------------------------------------------

    def test_local_date_boundary_is_the_practitioners_zone(self):
        late = timecamp_activity("1", "2026-09-02T02:00:00Z", "2026-09-02T02:05:00Z")
        early = timecamp_activity("2", "2026-09-01T06:59:59Z", "2026-09-01T07:05:00Z")
        summary = json.loads(self.timeline("timecamp", [late, early]).stdout)
        rows = [l["row"] for l in self.lines() if l["table"] == "timecamp_computer_activities"]
        self.assertEqual([r["native_id"] for r in rows], ["1"])
        self.assertEqual(rows[0]["local_date"], DAY)
        self.assertEqual(summary["rows"], 1)

    def test_timeline_keeps_only_the_date_and_logs_fetched_with_the_count(self):
        rows = [
            timecamp_activity("1", "2026-09-01T16:05:00Z"),
            timecamp_activity("2", "2026-08-31T16:05:00Z"),
            timecamp_activity("3", "2026-09-01T20:00:00Z"),
        ]
        self.timeline("timecamp", rows)
        lines = self.lines()
        activity = [l["row"] for l in lines if l["table"] == "timecamp_computer_activities"]
        self.assertEqual([r["native_id"] for r in activity], ["1", "3"])
        self.assertEqual(activity[0]["application"], "LEAP")
        self.assertEqual(activity[0]["window_title"], "Smith v Jones - LEAP")
        self.assertEqual(activity[0]["timecamp_task_id"], "0")
        self.assertEqual(activity[0]["fetched_at"], "2026-09-02T03:00:00Z")
        log = [l["row"] for l in lines if l["table"] == "source_fetch_log"]
        self.assertEqual(len(log), 1)
        self.assertEqual(
            {k: log[0][k] for k in ("source_name", "local_date", "status", "row_count")},
            {"source_name": "timecamp_computer_activities", "local_date": DAY, "status": "fetched", "row_count": 2},
        )

    def test_timecamp_null_application_is_kept_as_null(self):
        self.timeline("timecamp", [timecamp_activity("1", "2026-09-01T16:05:00Z", application=None)])
        row = [l["row"] for l in self.lines() if l["table"] == "timecamp_computer_activities"][0]
        self.assertIsNone(row["application"])
        self.assertEqual(row["timecamp_task_id"], "0")

    def test_timecamp_missing_task_id_fails_naming_it(self):
        proc = self.timeline("timecamp", [timecamp_activity("1", "2026-09-01T16:05:00Z", drop="task_id")], ok=False)
        self.assertIn("'task_id'", proc.stderr)
        self.assertEqual(self.lines(), [], "a failed run must append nothing")

    def test_timecamp_missing_entry_id_fails_naming_it(self):
        # splice.sql attributes each row to its entry from this key (#1102).
        proc = self.timeline("timecamp", [timecamp_activity("1", "2026-09-01T16:05:00Z", drop="entry_id")], ok=False)
        self.assertIn("'entry_id'", proc.stderr)
        self.assertEqual(self.lines(), [], "a failed run must append nothing")

    def test_timeline_with_no_rows_on_the_date_logs_empty(self):
        self.timeline("telus", [])
        self.assertEqual(
            [(l["table"], l["row"]["status"], l["row"]["row_count"]) for l in self.lines()],
            [("source_fetch_log", "empty", 0)],
        )

    def test_telus_maps_columns_duration_and_internal_flag(self):
        internal = telus_call("c2026-09-01T10:00+10", payload_extra={"phone_number": "10", "internal": True})
        self.timeline("telus", [telus_call(), internal])
        rows = [l["row"] for l in self.lines() if l["table"] == "telus_calls"]
        self.assertEqual(rows[0]["native_id"], "c2026-09-01T09:20+16045551234")
        self.assertEqual(rows[0]["phone_number"], "+16045551234")
        self.assertEqual(rows[0]["contact_name"], "Jesse Marlowe")
        self.assertEqual(rows[0]["action_result"], "Call connected")
        self.assertEqual(rows[0]["duration_seconds"], 76)
        self.assertEqual(rows[0]["raw_type"], "phone_call")
        self.assertEqual([r["is_internal"] for r in rows], [0, 1])

    def test_telus_missing_required_payload_key_fails_naming_it(self):
        proc = self.timeline("telus", [telus_call(drop="contact_name")], ok=False)
        self.assertIn("contact_name", proc.stderr)
        self.assertEqual(self.lines(), [], "a failed run must append nothing")

    def test_gcal_maps_native_id_title_attendees_and_all_day(self):
        all_day = gcal_event("day1", all_day=True, start_ts="2026-09-01T07:00:00Z")
        self.timeline("gcal", [gcal_event(), all_day])
        rows = [l["row"] for l in self.lines() if l["table"] == "gcal_events"]
        self.assertEqual([r["native_id"] for r in rows], ["gcal:abc123", "gcal:day1"])
        self.assertEqual(rows[0]["calendar_id"], "lawyer@example.com")
        self.assertEqual(rows[0]["title"], "Meeting with Jesse")
        self.assertEqual(
            json.loads(rows[0]["attendees"]), [{"email_or_name": "jesse@example.com", "response": "accepted"}]
        )
        self.assertEqual((rows[0]["transparency"], rows[0]["created"], rows[0]["updated"]), (None, None, None))
        self.assertEqual([r["all_day"] for r in rows], [0, 1])

    def test_gcal_missing_calendar_id_fails_naming_it(self):
        proc = self.timeline("gcal", [gcal_event(drop="calendar_id")], ok=False)
        self.assertIn("calendar_id", proc.stderr)

    def test_gcal_absent_optional_keys_yield_null(self):
        for key in ("transparency", "created", "updated"):
            self.out.unlink(missing_ok=True)
            self.timeline("gcal", [gcal_event(drop=key)])
            row = [l["row"] for l in self.lines() if l["table"] == "gcal_events"][0]
            self.assertIn(key, row)
            self.assertIsNone(row[key])

    def test_gcal_missing_all_day_fails_naming_it(self):
        proc = self.timeline("gcal", [gcal_event(drop="all_day")], ok=False)
        self.assertIn(repr("all_day"), proc.stderr)
        self.assertEqual(self.lines(), [], "a failed run must append nothing")

    def test_a_row_from_another_source_fails(self):
        proc = self.timeline("gcal", [telus_call()], ok=False)
        self.assertIn("telus", proc.stderr)

    def test_icloud_maps_calendar_identity_flags_and_native_id(self):
        # A free, all-day Home event with no location or notes, stored as reported.
        home = icloud_event(
            "H9", calendar="Home", start_ts="2026-09-01T07:00:00Z", end_ts="2026-09-02T07:00:00Z",
            drop="notes", allDay=True, busy=False, start="2026-09-01", end="2026-09-02", title="Dentist",
        )
        del home["raw_payload"]["location"]
        summary = json.loads(self.timeline("icloud", [icloud_event(), home]).stdout)
        rows = [l["row"] for l in self.lines() if l["table"] == "icloud_events"]
        self.assertEqual([r["native_id"] for r in rows], ["E1F2-0001_2026-09-01", "H9_2026-09-01"])
        work = rows[0]
        self.assertEqual(
            {k: work[k] for k in ("calendar", "calendar_url", "title", "all_day", "busy", "location", "notes", "uid")},
            {
                "calendar": "Work", "calendar_url": ICLOUD_WORK_URL, "title": "Call with Jesse", "all_day": 0,
                "busy": 1, "location": "Zoom", "notes": "Dial-in in the invite", "uid": "E1F2-0001",
            },
        )
        self.assertEqual((work["start_ts"], work["end_ts"], work["local_date"]), ("2026-09-01T17:00:00Z", "2026-09-01T17:30:00Z", DAY))
        self.assertNotIn("etag", work)
        self.assertEqual(json.loads(work["raw_payload"]), icloud_event()["raw_payload"])
        self.assertEqual(
            {k: rows[1][k] for k in ("calendar", "calendar_url", "all_day", "busy", "location", "notes", "end_ts")},
            {
                "calendar": "Home", "calendar_url": ICLOUD_HOME_URL, "all_day": 1, "busy": 0,
                "location": None, "notes": None, "end_ts": "2026-09-02T07:00:00Z",
            },
        )
        log = [l["row"] for l in self.lines() if l["table"] == "source_fetch_log"]
        self.assertEqual((log[0]["source_name"], log[0]["status"], log[0]["row_count"]), ("icloud_events", "fetched", 2))
        self.assertEqual(summary["table"], "icloud_events")

    def test_icloud_with_no_events_on_the_date_logs_empty(self):
        self.timeline("icloud", [icloud_event(start_ts="2026-08-31T17:00:00Z", end_ts="2026-08-31T17:30:00Z")])
        self.assertEqual(
            [(l["table"], l["row"]["source_name"], l["row"]["status"]) for l in self.lines()],
            [("source_fetch_log", "icloud_events", "empty")],
        )

    def test_icloud_row_with_no_calendar_identity_fails(self):
        proc = self.timeline("icloud", [icloud_event(drop="calendar")], ok=False)
        self.assertIn("'calendar'", proc.stderr)
        self.assertEqual(self.lines(), [], "a failed run must append nothing")
        for value in (None, ""):
            proc = self.timeline("icloud", [icloud_event(calendar=value)], ok=False)
            self.assertIn("calendar", proc.stderr)
            self.assertEqual(self.lines(), [], "a failed run must append nothing")

    def test_icloud_row_from_a_calendar_out_of_scope_fails(self):
        # Only Work and Home are read and stored; Family never is.
        proc = self.timeline("icloud", [icloud_event(), icloud_event("F1", calendar="Family")], ok=False)
        self.assertIn("Family", proc.stderr)
        self.assertEqual(self.lines(), [], "a failed run must append nothing")

    def test_icloud_missing_required_payload_keys_fail_naming_them(self):
        for key in ("calendar_url", "allDay", "busy", "uid", "title"):
            proc = self.timeline("icloud", [icloud_event(drop=key)], ok=False)
            self.assertIn(repr(key), proc.stderr)
            self.assertEqual(self.lines(), [], "a failed run must append nothing")

    def test_icloud_non_boolean_busy_fails(self):
        proc = self.timeline("icloud", [icloud_event(busy="yes")], ok=False)
        self.assertIn("busy", proc.stderr)

    def test_sent_mail_maps_an_event_row_to_its_columns(self):
        cc = sent_email("B2@mail.example.com", LEAP_FOLDER, ts="2026-09-01T18:00:00Z",
                        to=["a@example.com", "b@example.com"], cc=["c@example.com"])
        summary = json.loads(self.timeline("sent_mail", [sent_email(), cc]).stdout)
        rows = [l["row"] for l in self.lines() if l["table"] == "sent_mail"]
        self.assertEqual([r["native_id"] for r in rows], ["CAF1a2b3@mail.example.com", "B2@mail.example.com"])
        first = rows[0]
        self.assertEqual(
            {k: first[k] for k in ("sent_ts", "local_date", "folder", "from_address", "subject", "uid", "fetched_at")},
            {
                "sent_ts": "2026-09-01T17:05:00Z", "local_date": DAY, "folder": "Sent Items",
                "from_address": "Example Lawyer <lawyer@example.com>",
                "subject": "Re: Smith v Jones (L8948) - Settlement Memo", "uid": 4812,
                "fetched_at": "2026-09-02T03:00:00Z",
            },
        )
        self.assertNotIn("start_ts", first)
        self.assertNotIn("end_ts", first)
        self.assertEqual((json.loads(first["to_recipients"]), json.loads(first["cc_recipients"])), (["jesse@example.com"], []))
        self.assertEqual(json.loads(first["raw_payload"]), sent_email()["raw_payload"])
        self.assertEqual(rows[1]["folder"], LEAP_FOLDER)
        self.assertEqual(
            (json.loads(rows[1]["to_recipients"]), json.loads(rows[1]["cc_recipients"])),
            (["a@example.com", "b@example.com"], ["c@example.com"]),
        )
        log = [l["row"] for l in self.lines() if l["table"] == "source_fetch_log"]
        self.assertEqual((log[0]["source_name"], log[0]["status"], log[0]["row_count"]), ("sent_mail", "fetched", 2))
        self.assertEqual(summary["table"], "sent_mail")

    def test_sent_mail_keeps_only_messages_sent_on_the_local_day(self):
        # The search window is wider than the day (SentMail.md), so the day is cut here by ts.
        evening = sent_email("late@x", ts="2026-09-02T02:56:00Z", date="2026-09-01T19:56:00-07:00")
        before = sent_email("before@x", ts="2026-09-01T06:59:59Z", date="2026-08-31T23:59:59-07:00")
        after = sent_email("after@x", ts="2026-09-02T07:00:00Z", date="2026-09-02T00:00:00-07:00")
        summary = json.loads(self.timeline("sent_mail", [before, evening, after]).stdout)
        rows = [l["row"] for l in self.lines() if l["table"] == "sent_mail"]
        self.assertEqual([(r["native_id"], r["local_date"]) for r in rows], [("late@x", DAY)])
        self.assertEqual((summary["rows"], summary["considered"]), (1, 3))

    def test_sent_mail_with_no_message_on_the_date_logs_empty(self):
        self.timeline("sent_mail", [sent_email(ts="2026-08-31T17:05:00Z")])
        self.assertEqual(
            [(l["table"], l["row"]["source_name"], l["row"]["status"]) for l in self.lines()],
            [("source_fetch_log", "sent_mail", "empty")],
        )

    def test_sent_mail_row_from_a_folder_out_of_scope_fails(self):
        # Only Sent Items, Sent Messages and their LEAP subfolders (#942).
        for folder in ("Sent Items/Other", "Sent Messages/Other", "INBOX", None):
            proc = self.timeline("sent_mail", [sent_email(), sent_email("x@y", folder=folder)], ok=False)
            self.assertIn(repr(folder), proc.stderr)
            self.assertEqual(self.lines(), [], "a failed run must append nothing")

    def test_sent_mail_native_id_with_angle_brackets_fails(self):
        # A bracketed Message-ID would load a second key for the same email.
        proc = self.timeline("sent_mail", [sent_email("<CAF1a2b3@mail.example.com>")], ok=False)
        self.assertIn("angle brackets", proc.stderr)
        self.assertEqual(self.lines(), [], "a failed run must append nothing")

    def test_sent_mail_message_in_both_folders_is_one_row_and_the_sent_items_copy_wins(self):
        sent_items = sent_email(uid=4812)
        leap = sent_email(folder=LEAP_FOLDER, uid=77)
        for order in ([sent_items, leap], [leap, sent_items]):
            self.out.unlink(missing_ok=True)
            summary = json.loads(self.timeline("sent_mail", order).stdout)
            rows = [l["row"] for l in self.lines() if l["table"] == "sent_mail"]
            self.assertEqual([(r["native_id"], r["folder"], r["uid"]) for r in rows],
                             [("CAF1a2b3@mail.example.com", "Sent Items", 4812)])
            self.assertEqual(summary["rows"], 1)

    def test_sent_mail_message_in_several_folders_keeps_the_first_in_folder_order(self):
        # Folder order is Sent Items, its LEAP subfolder, Sent Messages, its LEAP subfolder (#942).
        copies = [sent_email(folder=SENT_MESSAGES_LEAP_FOLDER, uid=9), sent_email(folder="Sent Messages", uid=3001),
                  sent_email(folder=LEAP_FOLDER, uid=77)]
        for order in (copies, copies[::-1]):
            self.out.unlink(missing_ok=True)
            json.loads(self.timeline("sent_mail", order).stdout)
            rows = [l["row"] for l in self.lines() if l["table"] == "sent_mail"]
            self.assertEqual([(r["folder"], r["uid"]) for r in rows], [(LEAP_FOLDER, 77)])
        self.out.unlink(missing_ok=True)
        self.timeline("sent_mail", [copies[1], copies[2], copies[0]])
        rows = [l["row"] for l in self.lines() if l["table"] == "sent_mail"]
        self.assertEqual([(r["folder"], r["uid"]) for r in rows], [(LEAP_FOLDER, 77)])
        self.out.unlink(missing_ok=True)
        self.timeline("sent_mail", copies[:2])
        rows = [l["row"] for l in self.lines() if l["table"] == "sent_mail"]
        self.assertEqual([(r["folder"], r["uid"]) for r in rows], [("Sent Messages", 3001)])

    def test_sent_mail_message_twice_in_one_folder_fails_naming_it(self):
        for folder in ("Sent Items", LEAP_FOLDER, "Sent Messages", SENT_MESSAGES_LEAP_FOLDER):
            proc = self.timeline("sent_mail", [sent_email(folder=folder), sent_email(folder=folder)], ok=False)
            self.assertIn("CAF1a2b3@mail.example.com", proc.stderr)
            self.assertEqual(self.lines(), [], "a failed run must append nothing")
        # Also when a copy from an earlier folder is already kept.
        proc = self.timeline("sent_mail", [sent_email(), sent_email(folder="Sent Messages"),
                                           sent_email(folder="Sent Messages")], ok=False)
        self.assertIn("appears twice in folder 'Sent Messages'", proc.stderr)
        self.assertEqual(self.lines(), [], "a failed run must append nothing")

    def test_sent_mail_missing_required_fields_fail_naming_them(self):
        for key in ("folder", "from", "to", "subject", "uid"):
            proc = self.timeline("sent_mail", [sent_email(drop=key)], ok=False)
            self.assertIn(repr(key), proc.stderr)
            self.assertEqual(self.lines(), [], "a failed run must append nothing")
        no_ts = sent_email()
        del no_ts["ts"]
        proc = self.timeline("sent_mail", [no_ts], ok=False)
        self.assertIn("'ts'", proc.stderr)
        self.assertEqual(self.lines(), [], "a failed run must append nothing")

    def test_sent_mail_with_no_cc_key_loads_an_empty_cc_list(self):
        # The extension leaves cc out when a message has no cc recipient (seen live on #942).
        self.timeline("sent_mail", [sent_email(drop="cc")])
        rows = [l["row"] for l in self.lines() if l["table"] == "sent_mail"]
        self.assertEqual([json.loads(r["cc_recipients"]) for r in rows], [[]])
        self.assertNotIn('"cc"', rows[0]["raw_payload"], "raw_payload stays verbatim")

    def test_sent_mail_recipients_that_are_not_a_list_fail(self):
        for key in ("to", "cc"):
            proc = self.timeline("sent_mail", [sent_email(**{key: "jesse@example.com"})], ok=False)
            self.assertIn("%s 'jesse@example.com' is not a JSON array" % key, proc.stderr)

    # --- timecamp-entries --------------------------------------------------

    def test_timecamp_entries_filter_to_the_user_and_date_and_convert_local_times(self):
        entries = [
            timecamp_entry("1"),
            timecamp_entry("2", user_id="222"),
            timecamp_entry("3", date="2026-08-31"),
        ]
        summary = json.loads(
            self.run_script(
                "timecamp-entries", "--json", self.write_json("tc.json", entries),
                "--date", DAY, "--user-id", "111", "--out", self.out,
            ).stdout
        )
        rows = [l["row"] for l in self.lines() if l["table"] == "timecamp_time_entries"]
        self.assertEqual([r["native_id"] for r in rows], ["1"])
        row = rows[0]
        self.assertEqual((row["start_ts"], row["end_ts"]), ("2026-09-01T16:00:00Z", "2026-09-01T16:30:00Z"))
        self.assertEqual(row["local_date"], DAY)
        self.assertEqual(row["duration_seconds"], 1800)
        self.assertEqual(row["timecamp_task_id"], "115517729")
        self.assertEqual(row["task_display"], "Phone calls (to be sorted)")
        self.assertEqual(row["task_color"], "#E5C947")
        self.assertEqual((row["billable"], row["locked"]), (1, 1))
        self.assertIsInstance(row["raw_payload"], str)
        self.assertEqual(summary["rows"], 1)
        log = [l["row"] for l in self.lines() if l["table"] == "source_fetch_log"]
        self.assertEqual((log[0]["source_name"], log[0]["status"], log[0]["row_count"]), ("timecamp_time_entries", "fetched", 1))

    def test_timecamp_entries_with_none_for_the_user_log_empty(self):
        self.run_script(
            "timecamp-entries", "--json", self.write_json("tc.json", [timecamp_entry("2", user_id="222")]),
            "--date", DAY, "--user-id", "111", "--out", self.out,
        )
        self.assertEqual([(l["table"], l["row"]["status"]) for l in self.lines()], [("source_fetch_log", "empty")])

    # --- syncopaid-captures ------------------------------------------------

    def test_capture_end_ts_chains_to_the_next_capture_and_the_last_is_null(self):
        caps = [
            capture("a", "2026-09-01T16:02:30.0416109Z"),
            capture("b", "2026-09-01T16:03:00.5Z"),
            capture("c", "2026-09-01T16:04:10Z"),
        ]
        self.run_script(
            "syncopaid-captures", "--json", self.write_json("sp.json", captures_response(caps)),
            "--date", DAY, "--out", self.out,
        )
        rows = [l["row"] for l in self.lines() if l["table"] == "syncopaid_captures"]
        self.assertEqual(
            [(r["native_id"], r["captured_at"], r["end_ts"]) for r in rows],
            [
                ("2026-09-01T16:02:30Z", "2026-09-01T16:02:30Z", "2026-09-01T16:03:00Z"),
                ("2026-09-01T16:03:00Z", "2026-09-01T16:03:00Z", "2026-09-01T16:04:10Z"),
                ("2026-09-01T16:04:10Z", "2026-09-01T16:04:10Z", None),
            ],
        )
        first = rows[0]
        self.assertEqual(first["local_date"], DAY)
        self.assertEqual((first["process_name"], first["window_title"]), ("OUTLOOK", "Inbox - Outlook"))
        self.assertEqual((first["mouse_clicks"], first["keyboard_events"]), (2, 0))
        self.assertEqual((first["screenshot_ref"], first["ocr_text"]), ("shot-a", "hello"))
        self.assertIsNone(first["syncopaid_matter_id"])
        self.assertIsNone(first["syncopaid_matter_display"])
        self.assertEqual(json.loads(first["raw_payload"])["id"], "a")
        log = [l["row"] for l in self.lines() if l["table"] == "source_fetch_log"]
        self.assertEqual((log[0]["source_name"], log[0]["status"], log[0]["row_count"]), ("syncopaid_captures", "fetched", 3))

    def test_captures_in_the_same_second_get_ordinal_suffixes_in_full_precision_order(self):
        # File order within the second is reversed; full precision decides the ordinal.
        caps = [
            capture("later-id", "2026-09-01T16:02:30.9Z"),
            capture("earlier-id", "2026-09-01T16:02:30.1Z"),
            capture("middle-id", "2026-09-01T16:02:30.5Z"),
            capture("next-id", "2026-09-01T16:03:00Z"),
        ]
        self.run_script(
            "syncopaid-captures", "--json", self.write_json("sp.json", captures_response(caps)),
            "--date", DAY, "--out", self.out,
        )
        rows = [l["row"] for l in self.lines() if l["table"] == "syncopaid_captures"]
        self.assertEqual(
            [(json.loads(r["raw_payload"])["id"], r["native_id"], r["captured_at"], r["end_ts"]) for r in rows],
            [
                ("earlier-id", "2026-09-01T16:02:30Z", "2026-09-01T16:02:30Z", "2026-09-01T16:02:30Z"),
                ("middle-id", "2026-09-01T16:02:30Z#2", "2026-09-01T16:02:30Z", "2026-09-01T16:02:30Z"),
                ("later-id", "2026-09-01T16:02:30Z#3", "2026-09-01T16:02:30Z", "2026-09-01T16:03:00Z"),
                ("next-id", "2026-09-01T16:03:00Z", "2026-09-01T16:03:00Z", None),
            ],
        )

    def test_a_capture_repeated_in_the_response_fails_naming_it(self):
        caps = [capture("dup-id", "2026-09-01T16:02:30.1Z"), capture("dup-id", "2026-09-01T16:02:30.1Z")]
        proc = self.run_script(
            "syncopaid-captures", "--json", self.write_json("sp.json", captures_response(caps)),
            "--date", DAY, "--out", self.out, ok=False,
        )
        self.assertIn("dup-id", proc.stderr)
        self.assertEqual(self.lines(), [])

    def test_captures_out_of_order_fail_naming_both_ids_and_instants(self):
        caps = [
            capture("a", "2026-09-01T16:02:30Z"),
            capture("late-id", "2026-09-01T16:04:10Z"),
            capture("early-id", "2026-09-01T16:03:00.5Z"),
        ]
        proc = self.run_script(
            "syncopaid-captures", "--json", self.write_json("sp.json", captures_response(caps)),
            "--date", DAY, "--out", self.out, ok=False,
        )
        for text in ("late-id", "early-id", "2026-09-01T16:04:10Z", "2026-09-01T16:03:00Z"):
            self.assertIn(text, proc.stderr)
        self.assertEqual(self.lines(), [])

    def test_a_window_that_is_not_the_requested_local_day_fails(self):
        body = captures_response([capture("a", "2026-09-01T16:02:30Z")], fromUtcInclusive="2026-09-01T00:00:00Z")
        proc = self.run_script(
            "syncopaid-captures", "--json", self.write_json("sp.json", body), "--date", DAY, "--out", self.out, ok=False
        )
        self.assertIn("fromUtcInclusive", proc.stderr)

        body = captures_response([capture("a", "2026-09-01T16:02:30Z")], toUtcExclusive="2026-09-02T00:00:00Z")
        proc = self.run_script(
            "syncopaid-captures", "--json", self.write_json("sp.json", body), "--date", DAY, "--out", self.out, ok=False
        )
        self.assertIn("toUtcExclusive", proc.stderr)
        self.assertEqual(self.lines(), [])

    def test_a_truncated_response_fails(self):
        body = captures_response([capture("a", "2026-09-01T16:02:30Z")], truncated=True)
        proc = self.run_script(
            "syncopaid-captures", "--json", self.write_json("sp.json", body), "--date", DAY, "--out", self.out, ok=False
        )
        self.assertIn("truncated", proc.stderr)
        self.assertEqual(self.lines(), [])

    # --- fetch-log and --out -----------------------------------------------

    def test_fetch_log_emits_skipped_and_failed_with_row_count_zero(self):
        self.run_script("fetch-log", "--source", "telus_calls", "--date", DAY, "--status", "skipped", "--out", self.out)
        self.run_script(
            "fetch-log", "--source", "gcal_events", "--date", DAY, "--status", "failed",
            "--error-detail", "gcal not fetched by build-timeline for 2026-09-01; route unqualified", "--out", self.out,
        )
        rows = [l["row"] for l in self.lines()]
        self.assertEqual(
            [(r["source_name"], r["status"], r["row_count"], r["error_detail"]) for r in rows],
            [
                ("telus_calls", "skipped", 0, None),
                ("gcal_events", "failed", 0, "gcal not fetched by build-timeline for 2026-09-01; route unqualified"),
            ],
        )
        for line in self.lines():
            self.assert_shape(line)

    def test_fetch_log_records_every_icloud_exit_that_produces_no_rows(self):
        # build-timeline/reference/ICloudCalendar.md, Exit paths: registry off,
        # calendar not configured, Work calendar missing from the list.
        exits = [
            ("skipped", None),
            ("failed", "iCloud calendar not configured: run mail__configure_credential with the calendar fields,"
                       " or set the icloud source's enabled to false to record skipped"),
            ("failed", "iCloud calendar list has no Work calendar (" + ICLOUD_WORK_URL + "); run"
                       " mail__configure_credential again for that account, or update the identity table in"
                       " ICloudCalendar.md"),
        ]
        for status, detail in exits:
            self.out.unlink(missing_ok=True)
            args = ["fetch-log", "--source", "icloud_events", "--date", DAY, "--status", status, "--out", self.out]
            if detail:
                args[-2:-2] = ["--error-detail", detail]
            self.run_script(*args)
            lines = self.lines()
            self.assertEqual(len(lines), 1)
            self.assert_shape(lines[0])
            row = lines[0]["row"]
            self.assertEqual(
                (row["source_name"], row["status"], row["row_count"], row["error_detail"]),
                ("icloud_events", status, 0, detail),
            )

    def test_fetch_log_records_every_sent_mail_exit_that_produces_no_rows(self):
        # build-timeline/reference/SentMail.md, Exit paths.
        exits = [
            ("skipped", None),
            ("failed", "iCloud Sent Items copy not yet confirmed complete (#1262); set the sent_mail source's"
                       " copy_confirmed to the date its close check passes"),
            ("failed", "iCloud mail has no Sent Items folder; reconnect the iCloud extension to the account"
                       " that holds the Microsoft 365 copy"),
            ("failed", "iCloud mail has an unlisted folder under Sent Items: Sent Items/Other; add it to the"
                       " in-scope folder table in SentMail.md after review"),
            ("failed", "Sent Items search for 2026-09-01 truncated (returned 500 of 612); narrow the window"),
        ]
        for status, detail in exits:
            self.out.unlink(missing_ok=True)
            args = ["fetch-log", "--source", "sent_mail", "--date", DAY, "--status", status, "--out", self.out]
            if detail:
                args[-2:-2] = ["--error-detail", detail]
            self.run_script(*args)
            lines = self.lines()
            self.assertEqual(len(lines), 1)
            self.assert_shape(lines[0])
            row = lines[0]["row"]
            self.assertEqual(
                (row["source_name"], row["status"], row["row_count"], row["error_detail"]),
                ("sent_mail", status, 0, detail),
            )

    def test_fetch_log_refuses_a_name_that_is_not_a_source_table(self):
        for informal in ("gcal", "icloud"):
            proc = self.run_script(
                "fetch-log", "--source", informal, "--date", DAY, "--status", "skipped", "--out", self.out, ok=False
            )
            self.assertIn(informal, proc.stderr)

    def test_out_is_appended_to_not_overwritten(self):
        self.out.write_text(json.dumps({"table": "sentinel", "key": [], "row": {}}) + "\n", encoding="utf-8")
        self.run_script("fetch-log", "--source", "telus_calls", "--date", DAY, "--status", "skipped", "--out", self.out)
        self.run_script("fetch-log", "--source", "gcal_events", "--date", DAY, "--status", "empty", "--out", self.out)
        self.assertEqual([l["table"] for l in self.lines()], ["sentinel", "source_fetch_log", "source_fetch_log"])


if __name__ == "__main__":
    unittest.main()
