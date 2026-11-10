"""Tests for scripts/import_calls.py -- synthetic fixtures only, built in memory,
no database.

Run from the repo root:
    python -m unittest discover -s .claude/skills/timecamping-data/tests
"""

import csv
import io
import json
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

SKILL = Path(__file__).resolve().parents[1]
SCRIPT = SKILL / "scripts" / "import_calls.py"

OWN = "4 - Pat Example"
OWN_2 = "15 - Pat forward"
OTHER = "10 - Reception"
PORTAL_HEADER = ["Type", "Phone Number", "Name", "Date", "Time", "Action", "Action Result", "Result Description", "Duration"]
ARCHIVE_HEADER = [
    "Type", "Direction", "From", "To", "Extension", "Forwarded To", "Name", "Date", "Time",
    "Action", "Action Result", "Result Description", "Duration",
]
MAY = "may2026-05-01_may2026-05-31 rcvd 2026-06-01 EF TELUS Business Connect.zip"
THIRTIETH = "apr2026-04-30_may2026-05-30 rcvd 2026-05-31 EF TELUS Business Connect.zip"


def portal(number="(604) 555-0101", name="Jesse Marlowe", date="Thu 2026-05-28", time="1:39 PM",
           action="VoIP Call", result="Call connected", duration="0:01:16", kind="Voice"):
    return [kind, number, name, date, time, action, result, "", duration]


def archive(direction="Outgoing", caller="(604) 555-0100", called="(604) 555-0101", ext=OWN, name="Jesse Marlowe",
            date="Thu 2026-05-28", time="2:08 PM", action="VoIP Call", result="Call connected",
            duration="0:08:22", kind="Voice"):
    return [kind, direction, caller, called, ext, "", name, date, time, action, result, "", duration]


class ImportCallsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.dir = Path(self.tmp.name)
        self.folder = self.dir / "archive"
        self.folder.mkdir()
        self.out = self.dir / "calls.jsonl"

    def write_zip(self, name, header, rows, bom=True):
        text = io.StringIO()
        writer = csv.writer(text, quoting=csv.QUOTE_ALL)
        writer.writerow(header)
        writer.writerows(rows)
        data = text.getvalue().encode("utf-8-sig" if bom else "utf-8")
        with zipfile.ZipFile(self.folder / name, "w") as archive_file:
            archive_file.writestr("log.csv", data)

    def run_script(self, *extra, ok=True):
        proc = subprocess.run(
            [sys.executable, str(SCRIPT), "--folder", str(self.folder), "--own-extension", OWN,
             "--own-extension", OWN_2, "--out", str(self.out), *map(str, extra)],
            capture_output=True, text=True, encoding="utf-8",
        )
        if ok:
            self.assertEqual(proc.returncode, 0, proc.stderr)
            return json.loads(proc.stdout)
        self.assertNotEqual(proc.returncode, 0)
        return proc

    def lines(self):
        return [json.loads(l) for l in self.out.read_text(encoding="utf-8").splitlines()]

    def calls(self):
        return [l["row"] for l in self.lines() if l["table"] == "telus_calls"]

    def log(self):
        return {l["row"]["local_date"]: l["row"] for l in self.lines() if l["table"] == "source_fetch_log"}

    # --- formats ------------------------------------------------------------

    def test_archive_outgoing_counterparty_is_to_and_columns_are_mapped(self):
        self.write_zip(MAY, ARCHIVE_HEADER, [archive()])
        self.run_script()
        [row] = self.calls()
        self.assertEqual(row["native_id"], "c2026-05-28T14:08+16045550101")
        self.assertEqual(row["phone_number"], "+16045550101")
        self.assertEqual(row["start_ts"], "2026-05-28T21:08:00Z")
        self.assertEqual(row["end_ts"], "2026-05-28T21:16:22Z")
        self.assertEqual(row["local_date"], "2026-05-28")
        self.assertEqual(row["duration_seconds"], 502)
        self.assertEqual(row["raw_type"], "phone_call")
        payload = json.loads(row["raw_payload"])
        self.assertEqual(payload["format"], "archive")
        self.assertEqual(payload["direction"], "Outgoing")
        self.assertEqual(payload["extension"], OWN)
        self.assertEqual(payload["contact_name"], "Jesse Marlowe")

    def test_archive_incoming_counterparty_is_from(self):
        self.write_zip(MAY, ARCHIVE_HEADER, [archive(direction="Incoming", caller="(604) 555-0102", called="(604) 555-0100")])
        self.run_script()
        self.assertEqual(self.calls()[0]["phone_number"], "+16045550102")

    def test_portal_iso_date_has_no_direction(self):
        self.write_zip("2026-05-28 rcvd 2026-05-29 EF TELUS Business Connect.zip", PORTAL_HEADER, [portal()])
        self.run_script()
        [row] = self.calls()
        self.assertEqual(row["native_id"], "c2026-05-28T13:39+16045550101")
        payload = json.loads(row["raw_payload"])
        self.assertEqual(payload["format"], "portal")
        self.assertIsNone(payload["direction"])

    def test_portal_slash_date_is_day_first(self):
        self.write_zip("08122020 rcvd 2020-12-09 EF TELUS Business Connect.zip", PORTAL_HEADER,
                       [portal(date="Mon 07/12/2020", time="9:05 AM")])
        self.run_script()
        [row] = self.calls()
        self.assertEqual(row["local_date"], "2020-12-07")
        self.assertEqual(row["start_ts"], "2020-12-07T17:05:00Z")

    def test_bom_is_optional(self):
        self.write_zip(MAY, ARCHIVE_HEADER, [archive()], bom=False)
        self.assertEqual(self.run_script()["rows_kept"], 1)

    def test_a_wrong_weekday_stops_that_file_only(self):
        self.write_zip(MAY, ARCHIVE_HEADER, [archive(date="Mon 2026-05-28")])
        self.write_zip("2026-05-28 rcvd 2026-05-29 EF TELUS Business Connect.zip", PORTAL_HEADER, [portal()])
        summary = self.run_script()
        self.assertEqual(summary["rows_kept"], 1)
        [failed] = summary["files_failed"]
        self.assertEqual(failed["file"], MAY)
        self.assertIn("line 2", failed["error"])
        self.assertNotIn("2026-05-01", self.log(), "a failed file covers nothing")

    def test_a_bad_time_or_duration_stops_the_file(self):
        for row in (archive(time="25:00"), archive(duration="9:00:00"), archive(duration="abc")):
            self.write_zip(MAY, ARCHIVE_HEADER, [row])
            summary = self.run_script()
            self.assertEqual((summary["rows_kept"], len(summary["files_failed"])), (0, 1), row)

    def test_a_non_zip_entry_and_a_foreign_header_are_named(self):
        (self.folder / "broken.zip").write_bytes(b"not a zip")
        self.write_zip("other.zip", ["Some", "Columns"], [["a", "b"]])
        (self.folder / "notes.txt").write_text("ignored", encoding="utf-8")
        summary = self.run_script()
        self.assertEqual(sorted(f["file"] for f in summary["files_failed"]), ["broken.zip", "other.zip"])
        self.assertEqual(summary["files_read"], 0)

    def test_extracted_subfolder_is_ignored(self):
        (self.folder / "Extracted").mkdir()
        (self.folder / "Extracted" / "copy.csv").write_text("x", encoding="utf-8")
        self.write_zip(MAY, ARCHIVE_HEADER, [archive()])
        summary = self.run_script()
        self.assertEqual((summary["files_read"], summary["files_failed"]), (1, []))

    # --- which rows are calls -----------------------------------------------

    def test_legs_fax_and_other_extensions_are_dropped_and_counted(self):
        self.write_zip(MAY, ARCHIVE_HEADER, [
            archive(),
            archive(kind="", time="2:08 PM", action="FindMe", result="Stopped"),
            archive(kind="Fax", action="Outgoing Fax", result="Sent"),
            archive(ext=OTHER, time="3:00 PM"),
        ])
        summary = self.run_script()
        self.assertEqual(summary["rows_kept"], 1)
        self.assertEqual(summary["legs_dropped"], 1)
        self.assertEqual(summary["fax_dropped"], 1)
        self.assertEqual(summary["other_extension_dropped"], 1)

    def test_both_own_extensions_are_kept_with_the_extension_recorded(self):
        self.write_zip(MAY, ARCHIVE_HEADER, [archive(), archive(ext=OWN_2, time="3:00 PM")])
        self.run_script()
        self.assertEqual(sorted(json.loads(r["raw_payload"])["extension"] for r in self.calls()), sorted([OWN, OWN_2]))

    def test_every_outcome_is_kept_and_a_voicemail_is_typed(self):
        self.write_zip(MAY, ARCHIVE_HEADER, [
            archive(time="1:00 PM", result="Missed", duration="0:00:00"),
            archive(time="1:01 PM", result="Voicemail", duration="0:00:09"),
            archive(time="1:02 PM", result="Some New Outcome", duration="0:00:03"),
        ])
        self.run_script()
        rows = sorted(self.calls(), key=lambda r: r["start_ts"])
        self.assertEqual([r["action_result"] for r in rows], ["Missed", "Voicemail", "Some New Outcome"])
        self.assertEqual([r["raw_type"] for r in rows], ["phone_call", "voicemail", "phone_call"])

    def test_phone_normalization_flags(self):
        self.write_zip(MAY, ARCHIVE_HEADER, [
            archive(time="1:00 PM", called="10"),
            archive(time="1:01 PM", called=""),
            archive(time="1:02 PM", called="123456789012"),
            archive(time="1:03 PM", called="1 604 555 0101"),
        ])
        summary = self.run_script()
        rows = sorted(self.calls(), key=lambda r: r["start_ts"])
        self.assertEqual([r["phone_number"] for r in rows], ["10", "anonymous", "123456789012", "+16045550101"])
        self.assertEqual([r["is_internal"] for r in rows], [1, 0, 0, 0])
        self.assertTrue(json.loads(rows[1]["raw_payload"])["anonymous"])
        self.assertTrue(json.loads(rows[2]["raw_payload"])["unnormalized"])
        self.assertEqual(summary["unnormalized"], 1)

    # --- two rows with one key ----------------------------------------------

    def test_ringout_pair_is_one_call(self):
        self.write_zip(MAY, ARCHIVE_HEADER, [
            archive(action="RingOut PC", duration="0:02:00"),
            archive(direction="Incoming", caller="(604) 555-0101", called="(604) 555-0100",
                    action="Phone Call", duration="0:02:00"),
        ])
        summary = self.run_script()
        [row] = self.calls()
        self.assertEqual(row["action"], "RingOut PC")
        self.assertEqual(summary["ringout_dropped"], 1)

    def test_same_minute_calls_take_ordinals_longest_first(self):
        self.write_zip(MAY, ARCHIVE_HEADER, [
            archive(result="Missed", duration="0:00:00"),
            archive(duration="0:03:00"),
        ])
        self.run_script()
        by_id = {r["native_id"]: r["duration_seconds"] for r in self.calls()}
        self.assertEqual(by_id, {"c2026-05-28T14:08+16045550101": 180, "c2026-05-28T14:08+16045550101#2": 0})

    def test_one_call_on_two_own_extensions_keeps_the_longer(self):
        self.write_zip(MAY, ARCHIVE_HEADER, [
            archive(ext=OWN_2, duration="0:01:00"),
            archive(ext=OWN, duration="0:01:05"),
        ])
        summary = self.run_script()
        [row] = self.calls()
        self.assertEqual(row["duration_seconds"], 65)
        self.assertEqual(json.loads(row["raw_payload"])["extension"], OWN)
        self.assertEqual(summary["extension_duplicates_dropped"], 1)

    def test_a_later_file_replaces_the_row_and_a_changed_duration_is_counted(self):
        self.write_zip("2026-05-28 rcvd 2026-05-29 EF TELUS Business Connect.zip", PORTAL_HEADER,
                       [portal(time="2:08 PM", duration="0:08:21")])
        self.write_zip(MAY, ARCHIVE_HEADER, [archive()])
        summary = self.run_script()
        [row] = self.calls()
        self.assertEqual(json.loads(row["raw_payload"])["format"], "archive", "the archive sorts after the daily files")
        self.assertEqual(row["duration_seconds"], 502)
        self.assertEqual(summary["duration_changed_between_files"], 1)

    def test_rolling_daily_files_hold_one_call_once(self):
        self.write_zip("2026-05-28 rcvd 2026-05-29 EF TELUS Business Connect.zip", PORTAL_HEADER, [portal()])
        self.write_zip("2026-05-29 rcvd 2026-05-30 EF TELUS Business Connect.zip", PORTAL_HEADER, [portal()])
        summary = self.run_script()
        self.assertEqual(summary["rows_kept"], 1)
        self.assertEqual(summary["duration_changed_between_files"], 0)

    # --- coverage -----------------------------------------------------------

    def test_a_calendar_month_covers_every_day_of_it(self):
        self.write_zip(MAY, ARCHIVE_HEADER, [archive()])
        summary = self.run_script()
        log = self.log()
        self.assertEqual(summary["dates_covered"], 31)
        self.assertEqual(len(log), 31)
        self.assertEqual((log["2026-05-28"]["status"], log["2026-05-28"]["row_count"]), ("fetched", 1))
        self.assertEqual((log["2026-05-29"]["status"], log["2026-05-29"]["row_count"]), ("empty", 0))
        self.assertEqual(log["2026-05-29"]["source_name"], "telus_calls")

    def test_a_header_only_month_is_empty_for_every_day(self):
        self.write_zip(MAY, ARCHIVE_HEADER, [])
        self.run_script()
        self.assertEqual({row["status"] for row in self.log().values()}, {"empty"})
        self.assertEqual(len(self.log()), 31)

    def test_a_thirtieth_series_file_covers_nothing_but_keeps_its_calls(self):
        self.write_zip(THIRTIETH, ARCHIVE_HEADER, [archive(ext=OWN_2)])
        summary = self.run_script()
        self.assertEqual(summary["rows_kept"], 1)
        self.assertEqual(self.log(), {})

    def test_a_header_only_thirtieth_file_writes_no_status(self):
        self.write_zip(THIRTIETH, ARCHIVE_HEADER, [])
        self.run_script()
        self.assertEqual(self.lines(), [])

    def test_a_daily_file_covers_its_own_date_and_the_one_before(self):
        self.write_zip("2026-05-28 rcvd 2026-05-29 EF TELUS Business Connect.zip", PORTAL_HEADER, [portal()])
        self.run_script()
        self.assertEqual(sorted(self.log()), ["2026-05-27", "2026-05-28"])

    def test_a_packed_daily_name_is_day_first(self):
        self.write_zip("08122020 rcvd 2020-12-09 EF TELUS Business Connect.zip", PORTAL_HEADER, [])
        self.run_script()
        self.assertEqual(sorted(self.log()), ["2020-12-07", "2020-12-08"])

    # --- the run ------------------------------------------------------------

    def test_importing_twice_gives_the_same_rows_apart_from_fetched_at(self):
        self.write_zip(MAY, ARCHIVE_HEADER, [archive(), archive(result="Missed", duration="0:00:00")])
        self.run_script()
        first = self.lines()
        self.run_script()
        second = self.lines()

        def stable(lines):
            return [{**line, "row": {k: v for k, v in line["row"].items() if k != "fetched_at"}} for line in lines]

        self.assertEqual(stable(first), stable(second))

    def test_timeline_file_holds_the_days_calls_as_set_lines(self):
        self.write_zip(MAY, ARCHIVE_HEADER, [archive(), archive(date="Fri 2026-05-29")])
        timeline = self.dir / "day.jsonl"
        summary = self.run_script("--timeline-out", "2026-05-28", "--timeline-file", timeline)
        self.assertEqual(summary["timeline"], {"date": "2026-05-28", "rows": 1, "covered": True})
        [line] = [json.loads(l) for l in timeline.read_text(encoding="utf-8").splitlines()]
        self.assertEqual(line["op"], "set")
        self.assertEqual(line["key"], "activity:telus:c2026-05-28T14:08+16045550101")
        value = json.loads(line["value"])
        self.assertEqual(value["source"], "telus")
        self.assertEqual(value["raw_payload"]["phone_number"], "+16045550101")
        self.assertEqual(value["start_ts"], "2026-05-28T21:08:00Z")

    def test_timeline_for_a_date_no_archive_covers_says_so(self):
        self.write_zip(MAY, ARCHIVE_HEADER, [archive()])
        timeline = self.dir / "day.jsonl"
        summary = self.run_script("--timeline-out", "2026-09-01", "--timeline-file", timeline)
        self.assertEqual(summary["timeline"], {"date": "2026-09-01", "rows": 0, "covered": False})
        self.assertEqual(timeline.read_text(encoding="utf-8"), "")

    def test_a_missing_folder_fails(self):
        proc = subprocess.run(
            [sys.executable, str(SCRIPT), "--folder", str(self.dir / "nope"), "--own-extension", OWN, "--out", str(self.out)],
            capture_output=True, text=True, encoding="utf-8",
        )
        self.assertNotEqual(proc.returncode, 0)
        self.assertIn("folder not found", proc.stderr)
        self.assertFalse(self.out.exists())


if __name__ == "__main__":
    unittest.main()
