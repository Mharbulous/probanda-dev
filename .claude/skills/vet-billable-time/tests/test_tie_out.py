"""tie_out.py on invented data: the firm's write-off and rounding, and each check by name."""
import contextlib
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import tie_out  # noqa: E402

CANDIDATES = """# Candidate dates

| Date or range | Strength | Lawyer or Staff | Flags | Evidence, with local times |
|---|---|---|---|---|
| 2030-01-10 | Strong | Lawyer | | Call at 09:00 |
| 2030-01-12 to 2030-01-13 | Medium | Lawyer | unverified | Mail window |
| 2030-01-20 | Weak | Staff | | Touch |
"""


def entry(entry_id, day, secs, user="Pat Example"):
    return {"id": entry_id, "date": day, "duration": str(secs), "user_name": user,
            "start_time": "09:00:00", "end_time": "09:30:00"}


def line(entry_id, secs, **over):
    base = {"entry_id": entry_id, "disposition": "bill", "description": "Phone call to client, 12 min",
            "proposal_id": 7, "evidence": [{"source": "telus_calls", "native_id": "c1", "time": "09:00"}],
            "confirmed": "confirmed", "supported_seconds": secs}
    base.update(over)
    return base


class Case(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.dir = Path(tmp.name)
        (self.dir / "candidates.md").write_text(CANDIDATES, encoding="utf-8")
        self.judged(["2030-01-10", "2030-01-12", "2030-01-13"])

    def judged(self, days):
        (self.dir / "judged.jsonl").write_text("".join(json.dumps({"date": d}) + "\n" for d in days), encoding="utf-8")

    def run_tie(self, stage, entries, vetted=None, count=None, total=None, last="2030-01-01", late=None):
        (self.dir / "entries.json").write_text(json.dumps(entries), encoding="utf-8")
        argv = [stage, "--entries", str(self.dir / "entries.json"),
                "--connector-count", str(len(entries) if count is None else count),
                "--connector-hours", str(sum(int(e["duration"]) for e in entries) / 3600 if total is None else total),
                "--candidates", str(self.dir / "candidates.md"), "--last-billed", last,
                "--judged", str(self.dir / "judged.jsonl")]
        if stage == "final":
            (self.dir / "vetted.json").write_text(json.dumps(vetted), encoding="utf-8")
            argv += ["--vetted", str(self.dir / "vetted.json"), "--date", "2030-02-01",
                     "--report-dir", str(self.dir / "report"), "--data-dir", str(self.dir / "data")]
            for i, rows in enumerate(late or []):
                path = self.dir / f"late{i}.json"
                path.write_text(json.dumps(rows), encoding="utf-8")
                argv += ["--late-entries", str(path)]
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = tie_out.main(argv)
        return code, json.loads(out.getvalue())

    def vetted(self, lines, **over):
        base = {"people": {"Pat Example": {"initials": "PE", "rate": 400}, "Sam Staff": {"initials": "SS", "rate": 100}},
                "lines": lines,
                "candidates": {"2030-01-12 to 2030-01-13": {"status": "unexplained", "reason": "no entry"}},
                "gaps": ["Mobile carrier logs not reachable"]}
        base.update(over)
        return base

    def invoice(self):
        return json.loads((self.dir / "data" / "invoice_lines.json").read_text(encoding="utf-8"))


class PullStage(Case):
    def test_pass(self):
        code, out = self.run_tie("pull", [entry(1, "2030-01-10", 738)])
        self.assertEqual((code, out["verdict"]), (0, "pass"))

    def test_entry_on_last_billed_date_fails_window(self):
        code, out = self.run_tie("pull", [entry(1, "2030-01-01", 738)])
        self.assertEqual(code, 1)
        self.assertIn("window", out["failed"])

    def test_sum_and_count_tie_to_the_connector(self):
        _, out = self.run_tie("pull", [entry(1, "2030-01-10", 3600)], count=2, total=1.02)
        self.assertEqual(len(out["failed"]["connector_total"]), 2)
        code, _ = self.run_tie("pull", [entry(1, "2030-01-10", 3600)], total=1.01)
        self.assertEqual(code, 0)

    def test_unjudged_strong_or_range_day_fails_and_weak_does_not(self):
        self.judged(["2030-01-10", "2030-01-12"])
        _, out = self.run_tie("pull", [entry(1, "2030-01-10", 738)])
        self.assertEqual(out["failed"]["judged_dates"], ["2030-01-12 to 2030-01-13 (Medium): 2030-01-13 is not judged"])

    def test_a_staff_only_date_needs_no_judged_mark(self):
        path = self.dir / "candidates.md"
        path.write_text(CANDIDATES.replace("| 2030-01-20 | Weak | Staff |", "| 2030-01-20 | Strong | Staff |"), encoding="utf-8")
        self.assertEqual(self.run_tie("pull", [entry(1, "2030-01-10", 738)])[0], 0)

    def test_bad_date_cell_stops(self):
        (self.dir / "candidates.md").write_text("| Date or range | Strength |\n|---|---|\n| Jan 5 | Strong |\n", encoding="utf-8")
        with self.assertRaises(SystemExit) as caught, contextlib.redirect_stderr(io.StringIO()):
            self.run_tie("pull", [entry(1, "2030-01-10", 738)])
        self.assertEqual(caught.exception.code, 2)


class FirmRules(Case):
    def test_rounds_a_call_up_and_bills_the_rounded_figure(self):
        code, out = self.run_tie("final", [entry(1, "2030-01-10", 738)], self.vetted([line(1, 738)]))
        self.assertEqual(code, 0, out)
        self.assertEqual(self.invoice()["rows"][0]["hours"], "0.3")
        self.assertEqual(self.invoice()["subtotal"], "120.00")
        self.assertEqual(self.invoice()["passed_on"], "2030-02-01")

    def test_person_day_under_a_tenth_is_written_off_judged_per_person(self):
        entries = [entry(1, "2030-01-10", 3600), entry(2, "2030-01-10", 144, "Sam Staff")]
        code, out = self.run_tie("final", entries, self.vetted([line(1, 3600), line(2, 144)]))
        self.assertEqual(code, 0, out)
        self.assertEqual([r["user"] for r in self.invoice()["rows"]], ["Pat Example"])
        summary = (self.dir / "report" / "2030-02-01 Billable time summary.md").read_text(encoding="utf-8")
        self.assertIn("a person's day under 0.1 h", summary)

    def test_entries_sum_before_the_write_off_and_rounding(self):
        entries = [entry(1, "2030-01-10", 200), entry(2, "2030-01-10", 200)]
        code, out = self.run_tie("final", entries, self.vetted([line(1, 200), line(2, 200)]))
        self.assertEqual(code, 0, out)
        self.assertEqual(self.invoice()["rows"][0]["hours"], "0.2")

    def test_exactly_a_tenth_stays_a_tenth(self):
        _, out = self.run_tie("final", [entry(1, "2030-01-10", 360)], self.vetted([line(1, 360)]))
        self.assertEqual(out["rounded_hours"], "0.1")


class Lines(Case):
    def fails(self, name, lines, entries=None, **over):
        code, out = self.run_tie("final", entries or [entry(1, "2030-01-10", 738)], self.vetted(lines, **over))
        self.assertEqual(code, 1, out)
        self.assertIn(name, out["failed"])
        self.assertFalse((self.dir / "report").exists(), "a fail writes nothing")

    def test_missing_line_and_stray_line(self):
        self.fails("line_per_entry", [])
        self.fails("line_per_entry", [line(1, 738), line(1, 738)])

    def test_no_determination_fails(self):
        self.fails("line_evidence", [line(1, 738, proposal_id=None, evidence=[])])

    def test_no_determination_passes_on_a_confirmed_estimate_and_is_listed(self):
        code, out = self.run_tie("final", [entry(1, "2030-01-10", 738)], self.vetted(
            [line(1, None, proposal_id=None, evidence=[], no_evidence_confirmed=True, estimate_seconds=738)]))
        self.assertEqual(code, 0, out)
        summary = (self.dir / "report" / "2030-02-01 Billable time summary.md").read_text(encoding="utf-8")
        self.assertIn("| 2030-01-10 | Pat Example | 1 | confirmed |", summary)

    def test_short_description_fails(self):
        self.fails("line_description", [line(1, 738, description="Call")])

    def test_missing_rate_fails(self):
        self.fails("people", [line(1, 738)], people={})

    def test_write_off_needs_a_reason(self):
        self.fails("write_off_reasons", [{"entry_id": 1, "disposition": "write_off"}])

    def test_written_off_line_covers_its_date_and_bills_nothing(self):
        entries = [entry(1, "2030-01-10", 738), entry(2, "2030-01-15", 3600)]
        code, out = self.run_tie("final", entries, self.vetted(
            [{"entry_id": 1, "disposition": "write_off", "write_off_reason": "duplicate"}, line(2, 3600)]))
        self.assertEqual(code, 0, out)
        self.assertEqual(self.invoice()["subtotal"], "400.00")

    def test_late_line_needs_a_reason_and_bills_on_its_work_date(self):
        late = [[entry(9, "2029-12-20", 3600)]]
        lines = [line(1, 738), line(9, 3600)]
        code, out = self.run_tie("final", [entry(1, "2030-01-10", 738)], self.vetted(lines), late=late)
        self.assertEqual(code, 1)
        self.assertIn("late_lines", out["failed"])
        lines[1]["late_reason"] = "missed by the last bill"
        code, out = self.run_tie("final", [entry(1, "2030-01-10", 738)], self.vetted(lines), late=late)
        self.assertEqual(code, 0, out)
        self.assertEqual(self.invoice()["rows"][0]["date"], "2029-12-20")


class Accuracy(Case):
    def run_with_support(self, supported, billed=3600):
        return self.run_tie("final", [entry(1, "2030-01-10", billed)], self.vetted([line(1, supported)]))

    def test_bounds_are_inclusive_on_the_invoice_total(self):
        # Against perfect tracking of 1.0 h: a draft of 0.8 h and of 1.2 h pass, 0.7 h and 1.3 h fail.
        self.assertEqual(self.run_with_support(3600, billed=2880)[0], 0)
        self.assertEqual(self.run_with_support(3600, billed=4320)[0], 0)
        self.assertEqual(self.run_with_support(3600, billed=2520)[0], 1)
        code, out = self.run_with_support(3600, billed=4680)
        self.assertEqual(code, 1)
        self.assertIn("invoice_accuracy", out["failed"])

    def test_rounding_up_is_not_an_error(self):
        code, out = self.run_with_support(3540)
        self.assertEqual(code, 0, out)
        self.assertEqual(out["fees"], out["perfect_tracking"])

    def test_a_line_with_no_span_or_estimate_fails(self):
        code, out = self.run_with_support(None)
        self.assertEqual(code, 1)
        self.assertIn("invoice_accuracy", out["failed"])


class Candidates(Case):
    def test_uncovered_strong_date_fails(self):
        code, out = self.run_tie("final", [entry(1, "2030-01-15", 3600)], self.vetted([line(1, 3600)]))
        self.assertEqual(code, 1)
        self.assertEqual(out["failed"]["candidate_coverage"], ["2030-01-10 (Strong) is not covered, written off or listed unexplained"])

    def test_unexplained_needs_a_reason(self):
        code, out = self.run_tie("final", [entry(1, "2030-01-10", 3600)], self.vetted(
            [line(1, 3600)], candidates={"2030-01-12 to 2030-01-13": {"status": "unexplained", "reason": " "}}))
        self.assertEqual(code, 1)
        self.assertIn("candidate_coverage", out["failed"])

    def test_timecamp_date_off_the_list_is_named(self):
        entries = [entry(1, "2030-01-10", 3600), entry(2, "2030-01-25", 3600)]
        code, out = self.run_tie("final", entries, self.vetted([line(1, 3600), line(2, 3600)]))
        self.assertEqual(code, 0, out)
        summary = (self.dir / "report" / "2030-02-01 Billable time summary.md").read_text(encoding="utf-8")
        self.assertIn("## TimeCamp dates that were not candidates\n\n2030-01-25", summary)

    def test_audit_holds_entry_evidence_and_estimate(self):
        code, out = self.run_tie("final", [entry(1, "2030-01-10", 738)], self.vetted([line(1, 738)]))
        self.assertEqual(code, 0, out)
        audit = (self.dir / "report" / "2030-02-01 Billable time audit.md").read_text(encoding="utf-8")
        self.assertIn("## Entry 1: 2030-01-10, Pat Example", audit)
        self.assertIn("- Evidence: telus_calls c1 at 09:00", audit)
        self.assertIn("- Determination: 7", audit)


if __name__ == "__main__":
    unittest.main()
