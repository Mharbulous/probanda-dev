"""Bill-style lines on invented data: the invoice row's format, an inferred staff line's record, the blank-note list."""
import contextlib
import io
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))
import blank_staff_notes  # noqa: E402
import tie_out  # noqa: E402

CANDIDATES = """| Date or range | Strength | Lawyer or Staff | Flags | Evidence, with local times |
|---|---|---|---|---|
| 2030-01-10 | Strong | Both | | Call at 09:00 |
"""
LAWYER = "Pat Example"
STAFF = "Sam Staff"
BASIS = "Inferred from lawyer's time ending 10:30 and documents saved 10:40; practitioner confirmed"


def entry(entry_id, user, start, secs=1800, note=""):
    return {"id": entry_id, "date": "2030-01-10", "duration": str(secs), "user_name": user,
            "start_time": start, "end_time": "23:00:00", "description": note}


def lawyer_line(entry_id, description):
    return {"entry_id": entry_id, "disposition": "bill", "description": description, "proposal_id": 7,
            "evidence": [{"source": "telus_calls", "native_id": f"c{entry_id}", "time": "09:00"}],
            "confirmed": "confirmed", "supported_seconds": 1800}


def staff_line(**over):
    base = {"entry_id": 3, "disposition": "bill", "description": "Organize filed documents in the file",
            "no_evidence_confirmed": True, "estimate_seconds": 1800, "confirmed": BASIS}
    base.update(over)
    return base


class Lines(unittest.TestCase):
    def final(self, staff):
        """Run the final tie-out on two blank-note lawyer entries and one staff entry, all in one day."""
        lines = [lawyer_line(1, "Telephone call with client"), lawyer_line(2, "review draft affidavit"), staff]
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            entries = [entry(1, LAWYER, "09:00:00"), entry(2, LAWYER, "10:00:00"), entry(3, STAFF, "11:00:00")]
            (root / "entries.json").write_text(json.dumps(entries), encoding="utf-8")
            (root / "candidates.md").write_text(CANDIDATES, encoding="utf-8")
            (root / "judged.jsonl").write_text(json.dumps({"date": "2030-01-10"}) + "\n", encoding="utf-8")
            vetted = {"people": {LAWYER: {"initials": "PE", "rate": 400}, STAFF: {"initials": "SS", "rate": 100}},
                      "lines": lines, "candidates": {}, "gaps": []}
            (root / "vetted.json").write_text(json.dumps(vetted), encoding="utf-8")
            argv = ["final", "--entries", str(root / "entries.json"), "--connector-count", "3", "--connector-hours", "1.5",
                    "--candidates", str(root / "candidates.md"), "--last-billed", "2030-01-01",
                    "--judged", str(root / "judged.jsonl"), "--vetted", str(root / "vetted.json"), "--date", "2030-02-01",
                    "--report-dir", str(root / "report"), "--data-dir", str(root / "data")]
            with contextlib.redirect_stdout(io.StringIO()) as out:
                code = tie_out.main(argv)
            result = {"code": code, "verdict": json.loads(out.getvalue())}
            if code == 0:
                result["rows"] = json.loads((root / "data" / "invoice_lines.json").read_text(encoding="utf-8"))["rows"]
                result["audit"] = (root / "report" / "2030-02-01 Billable time audit.md").read_text(encoding="utf-8")
            return result

    def test_blank_note_lawyer_day_is_one_row_in_bill_style(self):
        result = self.final(staff_line())
        self.assertEqual(result["code"], 0, result["verdict"])
        row = next(r for r in result["rows"] if r["user"] == LAWYER)
        self.assertEqual({k: row[k] for k in ("date", "initials", "description", "hours")},
                         {"date": "2030-01-10", "initials": "PE",
                          "description": "Telephone call with client; review draft affidavit", "hours": "1.0"})

    def test_a_confirmed_inferred_staff_line_keeps_its_basis_in_the_audit(self):
        result = self.final(staff_line())
        self.assertEqual(result["code"], 0, result["verdict"])
        self.assertIn(BASIS, result["audit"])

    def test_an_unconfirmed_staff_line_fails_so_it_never_reaches_the_draft(self):
        result = self.final(staff_line(no_evidence_confirmed=False))
        self.assertEqual(result["code"], 1)
        self.assertIn("line_evidence", result["verdict"]["failed"])


class BlankStaffNotes(unittest.TestCase):
    ENTRIES = [entry(4, STAFF, "14:00:00", note="   "), entry(3, STAFF, "11:00:00"),
               entry(5, STAFF, "15:00:00", note="Organized the pleadings folder"), entry(1, LAWYER, "09:00:00")]

    def test_lists_only_blank_staff_entries_in_order(self):
        found = blank_staff_notes.blank_staff_notes(self.ENTRIES, {STAFF})
        self.assertEqual([e["id"] for e in found], [3, 4])

    def test_cli_prints_one_list_and_leaves_the_entries_file_unchanged(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "entries.json"
            path.write_text(json.dumps(self.ENTRIES), encoding="utf-8")
            before = path.read_bytes()
            done = subprocess.run([sys.executable, str(SCRIPTS / "blank_staff_notes.py"), "--entries", str(path), "--staff", STAFF],
                                  capture_output=True, text=True, check=True)
            self.assertEqual(path.read_bytes(), before)
        self.assertEqual(len(done.stdout.strip().splitlines()), 1)
        self.assertEqual(json.loads(done.stdout)["count"], 2)


if __name__ == "__main__":
    unittest.main()
