"""day_plan.py orders candidate dates for the day reviewers, and a recorded run on synthetic days shows 10 at once."""
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))
import day_plan  # noqa: E402

SCRIPT = SCRIPTS / "day_plan.py"


def record(date, strength, date_to=None):
    value = {"kind": "candidate_date", "matter": "M", "date": date, "strength": strength}
    if date_to:
        value["date_to"] = date_to
    return value


class Order(unittest.TestCase):
    def test_strongest_first_then_earliest(self):
        records = [record("2030-01-05", "Weak"), record("2030-01-09", "Strong"), record("2030-01-02", "Medium"),
                   record("2030-01-03", "Strong")]
        self.assertEqual(day_plan.order(records)["order"], ["2030-01-03", "2030-01-09", "2030-01-02", "2030-01-05"])

    def test_a_range_is_reviewed_a_day_at_a_time_and_a_day_on_two_records_keeps_the_stronger(self):
        records = [record("2030-01-01", "Weak", "2030-01-03"), record("2030-01-02", "Strong")]
        self.assertEqual(day_plan.order(records)["order"], ["2030-01-02", "2030-01-01", "2030-01-03"])

    def test_judged_and_held_days_are_left_out_and_named(self):
        records = [record("2030-01-01", "Strong"), record("2030-01-02", "Strong"), record("2030-01-03", "Weak")]
        plan = day_plan.order(records, {"2030-01-01": "judged", "2030-01-02": "in_progress", "2030-01-03": "not_started"})
        self.assertEqual((plan["order"], plan["judged"], plan["held"]), (["2030-01-03"], ["2030-01-01"], ["2030-01-02"]))

    def test_first_wave_is_the_limit(self):
        records = [record(f"2030-02-{n:02d}", "Strong") for n in range(1, 26)]
        plan = day_plan.order(records)
        self.assertEqual((len(plan["first_wave"]), len(plan["order"]), plan["limit"]), (10, 25, 10))
        self.assertEqual(plan["first_wave"], plan["order"][:10])

    def test_an_unknown_strength_sorts_last(self):
        records = [record("2030-01-01", "???"), record("2030-01-09", "Weak")]
        self.assertEqual(day_plan.order(records)["order"], ["2030-01-09", "2030-01-01"])


class Cli(unittest.TestCase):
    def run_cli(self, *args):
        done = subprocess.run([sys.executable, str(SCRIPT), *args], capture_output=True, text=True)
        return done

    def test_order_reads_a_store_export_and_a_status_reply_and_next_follows_it(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            lines = [json.dumps({"op": "set", "key": f"candidate_date:M:2030-03-{n:02d}",
                                 "value": json.dumps(record(f"2030-03-{n:02d}", "Strong"))}) for n in range(1, 13)]
            (tmp / "dates.jsonl").write_text("\n".join(lines) + "\n", encoding="utf-8")
            (tmp / "status.json").write_text(json.dumps({"dates": [{"date": "2030-03-01", "status": "judged", "judged_at": "x", "judged_by": "b"}]}), encoding="utf-8")
            done = self.run_cli("order", "--records", str(tmp / "dates.jsonl"), "--status", str(tmp / "status.json"))
            self.assertEqual(done.returncode, 0, done.stderr)
            plan = json.loads(done.stdout)
            self.assertEqual(plan["judged"], ["2030-03-01"])
            self.assertEqual(len(plan["order"]), 11)
            (tmp / "plan.json").write_text(done.stdout, encoding="utf-8")
            nxt = json.loads(self.run_cli("next", "--order", str(tmp / "plan.json"), "--in-flight", "2030-03-02,2030-03-03").stdout)
            self.assertEqual(nxt["start"], plan["order"][2:10])

    def test_a_bad_input_stops_with_exit_2(self):
        done = self.run_cli("order", "--records", "no-such-file.json")
        self.assertEqual(done.returncode, 2)
        self.assertIn("day_plan:", done.stderr)


class RecordedRun(unittest.TestCase):
    """A run on 25 synthetic days: the scheduler keeps 10 reviewers running, strongest first, and every
    reviewer returns a status line. Nothing in the run can put a question to the practitioner."""

    def test_ten_at_once_strongest_first_and_no_question(self):
        strengths = ["Strong"] * 8 + ["Medium"] * 9 + ["Weak"] * 8
        records = [record(f"2030-04-{n + 1:02d}", s) for n, s in enumerate(strengths)]
        plan = day_plan.order(records)
        running, started, finished, questions, peak, log = [], [], [], 0, 0, []
        while len(finished) < len(plan["order"]):
            for day in day_plan.next_days(plan, running, 10, finished):
                running.append(day)
                started.append(day)
                log.append(f"start {day}")
            peak = max(peak, len(running))
            self.assertLessEqual(len(running), 10)
            # The oldest running reviewer returns its status line.
            day = running.pop(0)
            reply = f"status: staged, 2, 0, none\nend: {day}"
            self.assertTrue(reply.startswith("status: ") and reply.splitlines()[-1] == f"end: {day}")
            questions += reply.count("?")
            finished.append(day)
            log.append(f"done {day}")
        self.assertEqual(peak, 10)
        self.assertEqual(started, plan["order"])
        self.assertEqual(sorted(finished), sorted(plan["order"]))
        self.assertEqual(questions, 0)
        self.assertEqual(log[:10], [f"start {d}" for d in plan["order"][:10]])
        self.assertTrue(set(started[:8]) == {r["date"] for r in records if r["strength"] == "Strong"})


if __name__ == "__main__":
    unittest.main()
