"""candidate_list.py and resume_plan.py on invented records: the file, the export, the resume plan, the lost-save detector."""
import contextlib
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "vet-billable-time" / "scripts"))
import candidate_list  # noqa: E402
import resume_plan  # noqa: E402
import tie_out  # noqa: E402

M = "m-100"


def record(day, strength, who="Lawyer", flags=(), evidence=(), date_to=None, summary="Call at 09:00"):
    value = {"kind": "candidate_date", "matter": M, "date": day, "strength": strength, "who": who,
             "flags": list(flags), "found_at": "2030-02-01T09:00:00", "evidence": list(evidence), "summary": summary}
    if date_to:
        value["date_to"] = date_to
    return {"op": "set", "key": f"candidate_date:{M}:{day}", "value": json.dumps(value)}


RECORDS = [
    record("2030-01-12", "Medium", flags=["unverified"], date_to="2030-01-13", summary="Mail window", evidence=["received_mail:r1"]),
    record("2030-01-10", "Strong", evidence=["document:d1", "filing:f1"]),
    record("2030-01-20", "Weak", who="Staff", summary="Touch"),
]
COVERAGE = {"op": "set", "key": f"candidate_coverage:{M}", "value": json.dumps({
    "kind": "candidate_coverage", "matter": M, "covered_through": "2030-01-31", "period_start": "2030-01-01",
    "write_offs": [{"date": "2029-12-01", "reason": "older than three months"}],
    "nothing_found": ["Drafts folder"],
    "open_leads": [{"lead": "Court filing receipts", "source": "Court Services Online"}]})}

EXPECTED = """# Candidate dates

| Date or range | Strength | Lawyer or Staff | Flags | Evidence, with local times |
|---|---|---|---|---|
| 2030-01-10 | Strong | Lawyer |  | Call at 09:00 |
| 2030-01-12 to 2030-01-13 | Medium | Lawyer | unverified | Mail window |
| 2030-01-20 | Weak | Staff |  | Touch |

## Write-offs

- 2029-12-01: older than three months

## Sources checked, nothing found

- Drafts folder

## Unexplored leads

- Court Services Online: Court filing receipts
"""


class Case(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.dir = Path(tmp.name)

    def write(self, name, rows):
        path = self.dir / name
        path.write_text("".join(json.dumps(r) + "\n" for r in rows), encoding="utf-8")
        return str(path)

    def run_main(self, module, argv):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = module.main(argv)
        return code, json.loads(out.getvalue())


class Render(Case):
    def test_the_generated_file_matches_the_fixture(self):
        out = self.dir / "list.md"
        self.run_main(candidate_list, ["render", "--records", self.write("r.jsonl", RECORDS),
                                       "--coverage", self.write("c.jsonl", [COVERAGE]), "--out", str(out)])
        self.assertEqual(out.read_text(encoding="utf-8"), EXPECTED)

    def test_export_is_read_by_tie_out_without_parsing_markdown(self):
        out = self.dir / "candidates.json"
        self.run_main(candidate_list, ["export", "--records", self.write("r.jsonl", RECORDS), "--out", str(out)])
        rows = tie_out.load_candidates(str(out))
        self.assertEqual([(r["cell"], r["strength"], r["who"]) for r in rows],
                         [("2030-01-10", "Strong", "Lawyer"), ("2030-01-12 to 2030-01-13", "Medium", "Lawyer"), ("2030-01-20", "Weak", "Staff")])
        self.assertEqual(rows[1]["days"], ["2030-01-12", "2030-01-13"])

    def test_a_bad_input_stops(self):
        bad = self.dir / "bad.jsonl"
        bad.write_text("not json", encoding="utf-8")
        with self.assertRaises(SystemExit) as caught, contextlib.redirect_stderr(io.StringIO()):
            candidate_list.main(["export", "--records", str(bad), "--out", str(self.dir / "o.json")])
        self.assertEqual(caught.exception.code, 2)


class Resume(Case):
    def test_a_resume_names_only_the_new_days_and_the_open_leads(self):
        code, plan = self.run_main(resume_plan, ["plan", "--coverage", self.write("c.jsonl", [COVERAGE]), "--today", "2030-02-03"])
        self.assertEqual(code, 0)
        self.assertEqual(plan["new_days"], ["2030-02-01", "2030-02-02", "2030-02-03"])
        self.assertEqual(plan["scan_days"], plan["new_days"])
        self.assertEqual(plan["open_leads"], [{"lead": "Court filing receipts", "source": "Court Services Online"}])
        self.assertFalse(plan["first_run"])

    def test_no_new_day_when_covered_through_today(self):
        _, plan = self.run_main(resume_plan, ["plan", "--coverage", self.write("c.jsonl", [COVERAGE]), "--today", "2030-01-31"])
        self.assertEqual(plan["new_days"], [])

    def test_no_coverage_record_is_a_first_run(self):
        _, plan = self.run_main(resume_plan, ["plan", "--coverage", self.write("c.jsonl", []), "--today", "2030-02-03"])
        self.assertTrue(plan["first_run"])
        self.assertEqual(plan["new_days"], [])


class Detector(Case):
    def evidence(self, keys):
        return self.write("e.jsonl", [{"op": "set", "key": k, "value": "{}"} for k in keys])

    def test_a_list_with_every_row_saved_passes(self):
        keys = ["received_mail:r1", "document:d1", "filing:f1"]
        code, out = self.run_main(resume_plan, ["check", "--records", self.write("r.jsonl", RECORDS), "--evidence", self.evidence(keys)])
        self.assertEqual((code, out["verdict"], out["missing"]), (0, "pass", []))

    def test_one_missing_evidence_row_reports_that_date(self):
        keys = ["received_mail:r1", "document:d1"]
        code, out = self.run_main(resume_plan, ["check", "--records", self.write("r.jsonl", RECORDS), "--evidence", self.evidence(keys)])
        self.assertEqual(code, 1)
        self.assertEqual(out["missing"], [{"date": "2030-01-10", "keys": ["filing:f1"]}])


if __name__ == "__main__":
    unittest.main()
