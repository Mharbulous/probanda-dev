"""blocks_export.py on invented data: the reviewed blocks of a fixture bill become the vetted.json that
tie_out.py passes, and an invoice line resolves to its blocks (build plan slice 11, spec criterion 1). Here the
registry enables TimeCamp, so the entries are given; test_no_timecamp_bill.py runs the same chain without them."""
import contextlib
import copy
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import blocks_export  # noqa: E402
import tie_out  # noqa: E402

MATTER = "L0001"
USER = "Pat Example"
PEOPLE = {USER: {"initials": "PE", "rate": 300, "rate_source": "the synthetic retainer"}}
CANDIDATES = [
    {"cell": "2030-01-10", "strength": "Strong", "who": "Lawyer"},
    {"cell": "2030-01-11", "strength": "Strong", "who": "Lawyer"},
    {"cell": "2030-01-12", "strength": "Medium", "who": "Lawyer"},
]
ENTRIES = [
    {"id": "E1", "date": "2030-01-10", "duration": "1800", "user_name": USER, "start_time": "09:00:00", "end_time": "09:30:00"},
    {"id": "E2", "date": "2030-01-11", "duration": "3600", "user_name": USER, "start_time": "10:00:00", "end_time": "11:00:00"},
    {"id": "E3", "date": "2030-01-11", "duration": "720", "user_name": USER, "start_time": "11:00:00", "end_time": "11:12:00"},
]
APPROVED = {"act": "approved", "by": "the practitioner", "at": "2030-02-01T10:00:00Z"}


def block(day, n, start, end, description, entry=None, matter=f"{MATTER} Synthetic Matter", state="approved", **over):
    evidence = [{"source": "telus_calls", "ref": "call1"}]
    if entry:
        evidence.append({"source": "timecamp_time_entries", "ref": entry})
    base = {"kind": "block", "id": f"{day}:{n:03d}", "date": day, "start": start, "end": end, "matter": matter,
            "description": description, "matter_basis": "evidence_names_matter", "bill_basis": [], "flags": [],
            "state": state, "evidence": evidence, "links": [], "staged_at": "2030-02-01T09:00:00Z"}
    if state in ("approved", "corrected"):
        base["review"] = dict(APPROVED, act=state)
    base.update(over)
    return base


def days():
    return {"from": "2030-01-10", "to": "2030-01-12", "days": [
        {"date": "2030-01-10", "clear": True, "blocks": [
            block("2030-01-10", 1, "09:00", "09:30", "Telephone call with client; review draft affidavit", "E1"),
            block("2030-01-10", 2, "13:00", "14:00", "Synthetic work elsewhere", matter="L0002 Another Matter", state="auto_assigned")]},
        {"date": "2030-01-11", "clear": True, "blocks": [
            block("2030-01-11", 1, "10:00", "11:00", "Draft notice of application; review court file", "E2"),
            block("2030-01-11", 2, "11:00", "11:12", "Non-billable administration", "E3", state="written_off",
                  review={"act": "written_off", "by": "the practitioner", "at": "2030-02-01T10:05:00Z", "reason": "not chargeable to the client"}),
            block("2030-01-11", 3, "14:00", "14:30", "Review correspondence from opposing counsel", None,
                  bill_basis=["estimate"], flags=["bill:estimate"]),
            block("2030-01-11", 4, "15:00", "15:30", "Original kept behind a merge", None, state="merged")]},
        {"date": "2030-01-12", "clear": True, "blocks": [
            block("2030-01-12", 1, "09:00", "10:00", "Synthetic work elsewhere", matter="L0002 Another Matter", state="auto_assigned")]},
    ]}


class Case(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.dir = Path(tmp.name)
        self.days = days()
        self.entries = copy.deepcopy(ENTRIES)

    def write(self, name, value):
        path = self.dir / name
        path.write_text(json.dumps(value), encoding="utf-8")
        return str(path)

    def export(self, last_billed="2030-01-01"):
        argv = ["export", "--blocks", self.write("blocks.json", self.days), "--entries", self.write("entries.json", self.entries),
                "--matter", MATTER, "--user", USER, "--people", self.write("people.json", PEOPLE), "--last-billed", last_billed,
                "--candidates", self.write("candidates.json", CANDIDATES), "--out", str(self.dir / "vetted.json")]
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = blocks_export.main(argv)
        return code, json.loads(out.getvalue())

    def tie(self, stage="final"):
        (self.dir / "judged.jsonl").write_text("".join(json.dumps({"date": d}) + "\n" for d in ("2030-01-10", "2030-01-11", "2030-01-12")), encoding="utf-8")
        argv = [stage, "--entries", str(self.dir / "entries.json"), "--connector-count", str(len(self.entries)),
                "--connector-hours", str(sum(int(e["duration"]) for e in self.entries) / 3600),
                "--candidates", str(self.dir / "candidates.json"), "--last-billed", "2030-01-01",
                "--judged", str(self.dir / "judged.jsonl")]
        if stage == "final":
            argv += ["--vetted", str(self.dir / "vetted.json"), "--date", "2030-02-01",
                     "--report-dir", str(self.dir / "report"), "--data-dir", str(self.dir / "data")]
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = tie_out.main(argv)
        return code, json.loads(out.getvalue())

    def test_the_export_of_a_fixture_bill_passes_the_final_tie_out(self):
        code, reply = self.export()
        self.assertEqual((code, reply["verdict"], reply["lines"]), (0, "pass", 4), reply)
        code, verdict = self.tie()
        self.assertEqual((code, verdict["verdict"]), (0, "pass"), verdict)
        # 1.5 h on the 11th (3600 s + the 1800 s estimate block; the written-off 720 s bills nothing) and 0.5 h on the 10th.
        self.assertEqual(verdict["fees"], "600.00")

    def test_each_kind_of_block_becomes_the_line_the_tie_out_expects(self):
        self.export()
        vetted = json.loads((self.dir / "vetted.json").read_text(encoding="utf-8"))
        # Ticket 291 decision 1: one line per live block of the matter, keyed by block_id, carrying its date and user.
        by_block = {line["block_id"]: line for line in vetted["lines"]}
        self.assertEqual(list(by_block), ["2030-01-10:001", "2030-01-11:001", "2030-01-11:002", "2030-01-11:003"])
        first = by_block["2030-01-10:001"]
        self.assertEqual((first["disposition"], first["supported_seconds"], first["date"], first["user"]), ("bill", 1800, "2030-01-10", USER))
        self.assertNotIn("entry_id", first)
        self.assertIn({"source": "timecamp_time_entries", "native_id": "E1", "time": "09:00"}, first["evidence"])
        self.assertIn("approved on the review page", first["confirmed"])
        self.assertEqual(by_block["2030-01-11:002"]["disposition"], "write_off")
        self.assertEqual(by_block["2030-01-11:002"]["write_off_reason"], "not chargeable to the client")
        # Ticket 291 decisions 1 and 2: a block stating `estimate` bills its own span as estimate_seconds, with no estimates list.
        self.assertEqual(by_block["2030-01-11:003"]["estimate_seconds"], 1800)
        self.assertNotIn("estimates", vetted)
        self.assertEqual(vetted["candidates"], {"2030-01-12": {"status": "written_off", "reason": "the reviewed day holds no time for this matter"}})
        self.assertNotIn("2030-01-11:004", json.dumps(vetted), "an original kept behind a merge is not billed")

    def test_a_line_of_the_invoice_resolves_to_its_block(self):
        self.export()
        self.assertEqual(self.tie()[0], 0)
        line_map = json.loads((self.dir / "data" / "line_map.json").read_text(encoding="utf-8"))
        by_date = {line["date"]: line for line in line_map["lines"]}
        self.assertEqual(by_date["2030-01-10"]["block_ids"], ["2030-01-10:001"])
        self.assertEqual(by_date["2030-01-11"]["block_ids"], ["2030-01-11:001", "2030-01-11:003"])
        self.assertEqual(by_date["2030-01-11"]["entries"][0]["block_ids"], ["2030-01-11:001"])
        # Every block id on an invoice line is a block in the reviewed days.
        known = {b["id"] for d in self.days["days"] for b in d["blocks"]}
        self.assertTrue({i for line in line_map["lines"] for i in line["block_ids"]} <= known)

        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = blocks_export.main(["lookup", "--line-map", str(self.dir / "data" / "line_map.json"), "--date", "2030-01-11", "--person", "PE"])
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(out.getvalue())["blocks"][0], {"block": "2030-01-11:001", "fragment": "#2030-01-11:001"})

    def test_a_flagged_block_or_an_unjudged_day_refuses_the_export(self):
        self.days["days"][1]["clear"] = False
        self.days["days"][1]["blocks"][0].update(state="flagged", flags=["matter:indirect_only"])
        code, reply = self.export()
        self.assertEqual(code, 1)
        self.assertTrue(any("2030-01-11:001 still flagged" in p for p in reply["problems"]), reply)
        self.assertFalse((self.dir / "vetted.json").exists())

    def test_an_entry_no_block_cites_refuses_the_export(self):
        self.entries.append({"id": "E9", "date": "2030-01-10", "duration": "600", "user_name": USER})
        code, reply = self.export()
        self.assertEqual(code, 1)
        self.assertIn("entry E9 on 2030-01-10 is cited by no block", reply["problems"])

    def test_a_block_with_no_entry_bills_from_its_own_span(self):
        # Ticket 289 decisions 1 and 3: evidence that bounds a block's time is supported time, not an estimate.
        self.days["days"][1]["blocks"][2].update(bill_basis=[], flags=[], state="auto_assigned")
        self.days["days"][1]["blocks"][2].pop("review")
        code, reply = self.export()
        self.assertEqual(code, 0, reply)
        vetted = json.loads((self.dir / "vetted.json").read_text(encoding="utf-8"))
        line = [l for l in vetted["lines"] if l["block_id"] == "2030-01-11:003"][0]
        self.assertEqual((line["disposition"], line["supported_seconds"]), ("bill", 1800))
        self.assertNotIn("estimate_seconds", line)

    def test_a_late_block_bills_only_after_a_click(self):
        # Ticket 289 decision 4: a block dated on or before the last billed date is late.
        code, reply = self.export(last_billed="2030-01-10")
        self.assertEqual(code, 0, reply)
        vetted = json.loads((self.dir / "vetted.json").read_text(encoding="utf-8"))
        late = [l for l in vetted["lines"] if l["block_id"] == "2030-01-10:001"][0]
        self.assertEqual(late["late_reason"], "late line approved on the review page")
        self.assertNotIn("late_reason", [l for l in vetted["lines"] if l["block_id"] == "2030-01-11:001"][0])
        self.days["days"][0]["blocks"][0].update(state="auto_assigned")
        self.days["days"][0]["blocks"][0].pop("review")
        code, reply = self.export(last_billed="2030-01-10")
        self.assertEqual(code, 1)
        problem = [p for p in reply["problems"] if "2030-01-10:001" in p][0]
        self.assertIn("#2030-01-10:001", problem)
        self.assertIn("write-off when the last bill is over three months old", problem)

    def test_an_estimate_needs_a_click_on_the_page(self):
        self.days["days"][1]["blocks"][2].update(state="flagged")
        self.days["days"][1]["blocks"][2].pop("review", None)
        self.days["days"][1]["clear"] = False
        code, reply = self.export()
        self.assertEqual(code, 1)

    def test_time_moved_to_another_matter_gives_no_line_on_this_bill(self):
        # Ticket 292 decision 5: the other matter's bill carries that time, under its block.
        self.days["days"][0]["blocks"][0].update(matter="L0002 Another Matter")
        code, reply = self.export()
        self.assertEqual(code, 0, reply)
        vetted = json.loads((self.dir / "vetted.json").read_text(encoding="utf-8"))
        self.assertNotIn("2030-01-10:001", [line["block_id"] for line in vetted["lines"]])
        self.assertEqual(vetted["candidates"]["2030-01-10"]["status"], "written_off")

    def test_an_unreviewed_chat_vetted_line_has_no_blocks(self):
        line_map = {"lines": [{"date": "2030-01-10", "user": USER, "initials": "PE", "line_key": "2030-01-10|Pat Example"}]}
        path = self.write("old_line_map.json", line_map)
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            blocks_export.main(["lookup", "--line-map", path, "--date", "2030-01-10"])
        self.assertEqual(json.loads(out.getvalue())["blocks"], [])


if __name__ == "__main__":
    unittest.main()
