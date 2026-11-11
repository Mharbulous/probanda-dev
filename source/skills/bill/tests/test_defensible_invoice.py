"""One invented invoice from tie_out through the frozen copy to "what supports this charge?", with no network."""
import contextlib
import hashlib
import importlib.util
import io
import json
import socket
import sys
import tempfile
import unittest
from pathlib import Path

SKILLS = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(SKILLS / "vet-billable-time" / "scripts"))


def load(skill, name):
    spec = importlib.util.spec_from_file_location(name, SKILLS / skill / "scripts" / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


tie_out = load("vet-billable-time", "tie_out")
freeze_invoice = load("bill", "freeze_invoice")
defend_line = load("practice-data", "defend_line")

CANDIDATES = """| Date or range | Strength | Lawyer or Staff | Flags | Evidence, with local times |
|---|---|---|---|---|
| 2030-01-10 | Strong | Lawyer | | Call at 09:00 |
| 2030-01-15 | Strong | Lawyer | | Filing at 11:00 |
"""
VETTED = {
    "people": {"Pat Example": {"initials": "PE", "rate": 100, "rate_source": "Signed retainer, 2029-12-01"}},
    "decided_by": "Pat Example",
    "lines": [{"entry_id": 1, "disposition": "bill", "description": "Telephone call with client", "proposal_id": 7,
               "determination_id": 70, "evidence": [{"source": "telus_calls", "native_id": "c1", "time": "09:00", "duration_seconds": 738}],
               "confirmed": "Yes, that was the client", "supported_seconds": 3000,
               "excluded": [{"marker": "evidence:marker:1", "seconds": 600, "confirmed": "Take it off"}]}],
    "estimates": [{"key": "e1", "date": "2030-01-15", "user": "Pat Example", "seconds": 1800, "description": "Draft and file an affidavit",
                   "basis": [{"source": "evidence:filing", "native_id": "p9", "time": "11:00", "package": "p9"}],
                   "method": "document creation to PDF save", "reason": "No tracker entry", "approved_by": "Pat Example", "approved_at": "2030-01-20"}],
    "candidates": {},
    "gaps": [],
}
ENTRIES = [{"id": 1, "date": "2030-01-10", "duration": "3600", "user_name": "Pat Example", "start_time": "09:00:00", "end_time": "10:00:00"}]
COVERAGE = [{"source_name": "telus_calls", "local_date": "2030-01-15", "status": "skipped",
             "error_detail": "unavailable: the carrier changed", "fetched_at": "2030-02-01T09:00:00"}]


class NoNetwork:
    def __enter__(self):
        self.real = socket.socket
        def refuse(*args, **kwargs):
            raise AssertionError("the defend read opened a socket")
        socket.socket = refuse

    def __exit__(self, *exc):
        socket.socket = self.real


class Defensible(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.dir = Path(tmp.name)
        for name, value in (("entries.json", ENTRIES), ("vetted.json", VETTED), ("coverage.json", COVERAGE)):
            (self.dir / name).write_text(json.dumps(value), encoding="utf-8")
        (self.dir / "candidates.md").write_text(CANDIDATES, encoding="utf-8")
        (self.dir / "judged.jsonl").write_text('{"date": "2030-01-10"}\n{"date": "2030-01-15"}\n', encoding="utf-8")
        (self.dir / "signed.pdf").write_bytes(b"%PDF-invented")
        self.data = self.dir / "data"
        with contextlib.redirect_stdout(io.StringIO()):
            code = tie_out.main(["final", "--entries", str(self.dir / "entries.json"), "--connector-count", "1", "--connector-hours", "1",
                                 "--candidates", str(self.dir / "candidates.md"), "--last-billed", "2030-01-01",
                                 "--judged", str(self.dir / "judged.jsonl"), "--vetted", str(self.dir / "vetted.json"), "--date", "2030-02-01",
                                 "--report-dir", str(self.dir / "report"), "--data-dir", str(self.data),
                                 "--coverage", str(self.dir / "coverage.json")])
        self.assertEqual(code, 0)

    def freeze(self, amount="133.40", extra=None):
        meta = {"matter": "M1", "invoice_number": "101", "issue_date": "2030-02-02", "date_to": "2030-01-31", "amount": amount,
                "taxes": "0.00", "signed_copy_path": str(self.dir / "signed.pdf"), **(extra or {})}
        (self.dir / "meta.json").write_text(json.dumps(meta), encoding="utf-8")
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = freeze_invoice.main(["--line-map", str(self.data / "line_map.json"), "--meta", str(self.dir / "meta.json"),
                                        "--out-dir", str(self.dir / "billing"), "--data-dir", str(self.data)])
        return code, json.loads(out.getvalue())

    def defend(self, result, *argv):
        out = io.StringIO()
        with NoNetwork(), contextlib.redirect_stdout(out):
            code = defend_line.main(["--snapshot", result["snapshot_path"], "--hash", result["snapshot_hash"], *argv])
        return code, out.getvalue()

    def subtotal(self):
        return json.loads((self.data / "line_map.json").read_text(encoding="utf-8"))["subtotal"]

    def test_the_recomputed_hash_matches_and_the_report_covers_every_line(self):
        code, result = self.freeze(self.subtotal())
        self.assertEqual(code, 0, result)
        self.assertEqual(hashlib.sha256(Path(result["snapshot_path"]).read_bytes()).hexdigest(), result["snapshot_hash"])
        report = Path(result["report_path"]).read_text(encoding="utf-8")
        self.assertIn("## 2030-01-10, Pat Example", report)
        self.assertIn("## 2030-01-15, Pat Example", report)

    def test_every_fee_line_is_defended_from_the_frozen_copy_alone(self):
        _, result = self.freeze(self.subtotal())
        code, text = self.defend(result)
        self.assertEqual(code, 0)
        for words in ("Time entry 1", "phone call record at 09:00", "Your ruling: Yes, that was the client", "Signed retainer, 2029-12-01",
                      "Telephone call with client", "Trimmed 0.167 hours", "Estimate: 0.500 hours", "document creation to PDF save",
                      "court filing at 11:00", "Could not be checked: telus_calls, because the carrier changed", "as it stood when invoice 101 issued"):
            self.assertIn(words, text)

    def test_one_line_can_be_asked_about_by_date_and_person(self):
        _, result = self.freeze(self.subtotal())
        _, text = self.defend(result, "--date", "2030-01-15", "--person", "pe")
        self.assertIn("Estimate:", text)
        self.assertNotIn("Time entry 1", text)

    def test_nothing_internal_reaches_the_answer(self):
        _, result = self.freeze(self.subtotal())
        _, text = self.defend(result)
        for word in ("source_key", "native_id", "proposal", "evidence:", "line_key", "time_entry", "provenance"):
            self.assertNotIn(word, text)

    def test_a_changed_frozen_copy_is_called_out(self):
        _, result = self.freeze(self.subtotal())
        path = Path(result["snapshot_path"])
        path.write_bytes(path.read_bytes() + b" ")
        code, text = self.defend(result)
        self.assertEqual(code, 1)
        self.assertIn("has changed since the invoice issued", text)

    def test_the_frozen_copy_is_never_rewritten(self):
        _, first = self.freeze(self.subtotal())
        before = Path(first["snapshot_path"]).read_bytes()
        code, second = self.freeze(self.subtotal(), {"trust_application": {"applied": "1.00"}})
        self.assertEqual((code, second["error"]), (1, "already_frozen"))
        self.assertEqual(Path(first["snapshot_path"]).read_bytes(), before)

    def test_an_issue_that_stopped_can_resume_from_the_same_copy(self):
        _, first = self.freeze(self.subtotal())
        code, again = self.freeze(self.subtotal())
        self.assertEqual(code, 0)
        self.assertEqual(again["snapshot_hash"], first["snapshot_hash"])

    def test_a_total_that_does_not_tie_or_a_missing_signed_copy_writes_nothing(self):
        code, out = self.freeze("1.00")
        self.assertEqual((code, out["error"]), (1, "amount_mismatch"))
        code, out = self.freeze(self.subtotal(), {"signed_copy_path": str(self.dir / "gone.pdf")})
        self.assertEqual((code, out["error"]), (1, "no_signed_copy"))
        self.assertFalse((self.dir / "billing").exists())

    def freeze_with(self, line):
        path = self.dir / "disbursements.json"
        path.write_text(json.dumps({"lines": [line], "subtotal": "0"}), encoding="utf-8")
        (self.dir / "meta.json").write_text(json.dumps({
            "matter": "M1", "invoice_number": "101", "issue_date": "2030-02-02", "date_to": "2030-01-31", "amount": self.subtotal(),
            "taxes": "0.00", "signed_copy_path": str(self.dir / "signed.pdf")}), encoding="utf-8")
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = freeze_invoice.main(["--line-map", str(self.data / "line_map.json"), "--meta", str(self.dir / "meta.json"),
                                        "--out-dir", str(self.dir / "billing"), "--data-dir", str(self.data), "--disbursements", str(path)])
        return code, json.loads(out.getvalue())

    def test_a_disbursement_awaiting_a_decision_is_refused_and_nothing_is_written(self):
        line = {"line_key": "d", "line_kind": "disbursement", "description": "Invented filing fee", "amount": "25.00",
                "receipt_hash": "a" * 64, "receipt_path": "r.pdf", "taxable": False, "confirm": True}
        self.assertEqual(self.freeze_with(line)[1]["error"], "disbursement_unconfirmed")
        self.assertEqual(self.freeze_with({**line, "confirm": False, "taxable": None})[1]["error"], "disbursement_tax_undecided")
        self.assertFalse((self.dir / "billing").exists())

    def test_the_issue_records_name_every_entry_and_adjustment(self):
        _, result = self.freeze(self.subtotal())
        records = json.loads(Path(result["records_file"]).read_text(encoding="utf-8"))
        self.assertEqual([l["entry_source_keys"] for l in records["lines"]], [["timecamp:1"], ["estimate:e1"]])
        self.assertEqual(records["adjustments"][0]["marker"], "evidence:marker:1")


if __name__ == "__main__":
    unittest.main()
