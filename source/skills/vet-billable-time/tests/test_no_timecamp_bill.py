"""A bill for one matter with TimeCamp skipped (issue 293): two judged days whose reviewed blocks rest on calls,
screenshots and sent mail, with no timer entry, become invoice rows that each list their block ids. The data
is invented and written to a temp folder at run time; no TimeCamp input is given and no socket opens."""
import contextlib
import io
import json
import re
import socket
import sys
import tempfile
import unittest
from pathlib import Path

SKILL = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SKILL / "scripts"))
import blocks_export  # noqa: E402
import tie_out  # noqa: E402

MATTER = "L0001"
USER = "Pat Example"
PEOPLE = {USER: {"initials": "PE", "rate": 300, "rate_source": "the synthetic retainer"}}
DATES = ("2030-01-10", "2030-01-11")
CANDIDATES = [{"cell": day, "strength": "Strong", "who": "Lawyer"} for day in DATES]
APPROVED = {"act": "approved", "by": "the practitioner", "at": "2030-02-01T10:00:00Z"}
GATE_FETCHED = ("syncopaid_captures", "telus_calls", "gcal_events", "icloud_events", "sent_mail")
GATE_SKIPPED = ("timecamp_time_entries", "timecamp_computer_activities")


def block(block_id, start, end, description, evidence, state):
    out = {"kind": "block", "id": block_id, "date": block_id[:10], "start": start, "end": end,
           "matter": f"{MATTER} Synthetic Matter", "description": description, "matter_basis": "evidence_names_matter",
           "bill_basis": [], "flags": [], "state": state, "links": [], "staged_at": "2030-02-01T09:00:00Z",
           "evidence": [{"source": source, "ref": ref} for source, ref in evidence]}
    if state == "approved":
        out["review"] = dict(APPROVED)
    return out


BLOCKS = {"from": DATES[0], "to": DATES[1], "days": [
    {"date": "2030-01-10", "clear": True, "blocks": [
        block("2030-01-10:001", "09:00", "09:30", "Telephone call with client", [("telus_calls", "call1")], "auto_assigned"),
        block("2030-01-10:002", "10:00", "11:00", "Draft affidavit; email draft to client",
              [("syncopaid_captures", "cap1"), ("sent_mail", "mail1")], "approved")]},
    {"date": "2030-01-11", "clear": True, "blocks": [
        block("2030-01-11:001", "13:00", "13:30", "Review opposing counsel's letter; reply",
              [("syncopaid_captures", "cap2"), ("sent_mail", "mail2")], "approved")]},
]}
COVERAGE = [{"source_name": name, "local_date": day, "status": "fetched", "fetched_at": "2030-01-20T09:00:00"}
            for day in DATES for name in GATE_FETCHED] + \
           [{"source_name": name, "local_date": day, "status": "skipped", "error_detail": None, "fetched_at": "2030-01-20T09:00:00"}
            for day in DATES for name in GATE_SKIPPED]
EXPECTED = [
    {"line_key": "2030-01-10|Pat Example", "date": "2030-01-10", "user": USER,
     "block_ids": ["2030-01-10:001", "2030-01-10:002"], "hours": "1.5", "amount": "450.00", "provenance": "block"},
    {"line_key": "2030-01-11|Pat Example", "date": "2030-01-11", "user": USER,
     "block_ids": ["2030-01-11:001"], "hours": "0.5", "amount": "150.00", "provenance": "block"},
]
TIMECAMP_ARGS = ("--entries", "--connector-count", "--connector-hours", "--late-entries")


class NoNetwork:
    def __enter__(self):
        self.real = socket.socket

        def refuse(*args, **kwargs):
            raise AssertionError("the bill opened a socket")
        socket.socket = refuse

    def __exit__(self, *exc):
        socket.socket = self.real


class NoTimecampBill(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.dir = Path(tmp.name)
        for name, value in (("blocks.json", BLOCKS), ("people.json", PEOPLE), ("candidates.json", CANDIDATES),
                            ("coverage.json", COVERAGE)):
            (self.dir / name).write_text(json.dumps(value), encoding="utf-8")
        (self.dir / "judged.jsonl").write_text("".join(json.dumps({"date": d}) + "\n" for d in DATES), encoding="utf-8")
        self.export_argv = ["export", "--blocks", str(self.dir / "blocks.json"), "--matter", MATTER, "--user", USER,
                            "--people", str(self.dir / "people.json"), "--candidates", str(self.dir / "candidates.json"),
                            "--last-billed", "2030-01-01", "--decided-by", "the practitioner", "--out", str(self.dir / "vetted.json")]
        self.final_argv = ["final", "--candidates", str(self.dir / "candidates.json"), "--last-billed", "2030-01-01",
                           "--judged", str(self.dir / "judged.jsonl"), "--vetted", str(self.dir / "vetted.json"),
                           "--date", "2030-02-01", "--report-dir", str(self.dir / "report"), "--data-dir", str(self.dir / "data"),
                           "--coverage", str(self.dir / "coverage.json"), "--run-started", "2030-02-01T00:00:00"]

    def run_chain(self):
        with NoNetwork():
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                code = blocks_export.main(self.export_argv)
            self.assertEqual(code, 0, out.getvalue())
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                code = tie_out.main(self.final_argv)
            self.assertEqual(code, 0, out.getvalue())
        return json.loads((self.dir / "data" / "invoice_lines.json").read_text(encoding="utf-8"))

    def test_no_timecamp_input_is_given(self):
        for argv in (self.export_argv, self.final_argv):
            self.assertFalse(set(argv) & set(TIMECAMP_ARGS), argv)

    def test_the_two_rows_list_their_blocks(self):
        invoice = self.run_chain()
        fields = ("line_key", "date", "user", "block_ids", "hours", "amount", "provenance")
        self.assertEqual([{k: row[k] for k in fields} for row in invoice["rows"]], EXPECTED)
        self.assertEqual(invoice["subtotal"], "600.00")

    def test_every_listed_block_is_a_block_of_the_fixture_days(self):
        known = {b["id"] for day in BLOCKS["days"] for b in day["blocks"]}
        for row in self.run_chain()["rows"]:
            self.assertTrue(row["block_ids"] and set(row["block_ids"]) <= known, row)

    def test_a_skipped_timecamp_source_leaves_no_row_unavailable(self):
        self.assertTrue(all(row["unavailable"] == [] for row in self.run_chain()["rows"]))

    def test_no_report_names_timecamp(self):
        self.run_chain()
        reports = list((self.dir / "report").iterdir())
        self.assertEqual(len(reports), 2)
        for path in reports:
            self.assertNotIn("TimeCamp", path.read_text(encoding="utf-8"), path.name)


class SkillWiring(unittest.TestCase):
    """No script reads the registry, so the skill's prose holds TimeCamp's calls to the registry's `timecamp` entry."""

    def setUp(self):
        self.text = (SKILL / "SKILL.md").read_text(encoding="utf-8")

    def test_step_one_runs_only_when_the_registry_enables_timecamp(self):
        step = re.search(r"^1\. \*\*Pull the entries\.\*\*(.*)$", self.text, re.M)
        self.assertIsNotNone(step)
        self.assertIn("Only when the registry's `timecamp` source is enabled", step[1])

    def test_the_timecamp_arguments_are_given_only_when_the_registry_enables_timecamp(self):
        self.assertIn("`--entries`, `--connector-count` and `--connector-hours` only when the registry's `timecamp` source is enabled",
                      self.text)
        self.assertNotIn("--late-entries", self.text.split("## Steps")[0])


if __name__ == "__main__":
    unittest.main()
