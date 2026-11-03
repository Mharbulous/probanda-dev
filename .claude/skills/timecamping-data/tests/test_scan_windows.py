"""scan_windows.py on invented rows: calls in window titles and non-billable markers."""
import contextlib
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import scan_windows  # noqa: E402


def row(title, end="2030-01-10 09:05:00", span=300, entry="11", task="77", app=""):
    return {"end_time": end, "time_span": span, "application": app, "window_title": title, "entry_id": entry, "task_id": task}


class Case(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.dir = Path(tmp.name)

    def write(self, name, value):
        path = self.dir / name
        path.write_text(json.dumps(value), encoding="utf-8")
        return str(path)

    def run_scan(self, *argv):
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(scan_windows.main(list(argv) + ["--out", str(self.dir / "out.json")]), 0)
        return json.loads((self.dir / "out.json").read_text(encoding="utf-8"))


class Phones(Case):
    NUMBERS = [{"name": "Pat Example", "number": "(604) 555-0100"}]

    def scan(self, rows, tasks=("55",)):
        return self.run_scan("phones", "--activities", self.write("a.json", rows), "--numbers", self.write("n.json", self.NUMBERS), "--tasks", *tasks)

    def test_a_bare_number_title_on_another_task_is_a_flagged_call(self):
        found = self.scan([row("6045550100")])
        self.assertEqual(len(found), 1)
        call = found[0]
        self.assertEqual((call["date"], call["start"], call["end"], call["seconds"]), ("2030-01-10", "09:00:00", "09:05:00", 300))
        self.assertEqual((call["entry_id"], call["task_id"], call["name"]), ("11", "77", "Pat Example"))
        self.assertTrue(call["off_task"])
        self.assertFalse(call["no_entry"])

    def test_a_row_with_no_entry_is_flagged(self):
        call = self.scan([row("604-555-0100", entry="0", task="0")])[0]
        self.assertTrue(call["no_entry"])
        self.assertTrue(call["off_task"])

    def test_a_match_on_the_matters_task_is_not_off_task(self):
        self.assertFalse(self.scan([row("+1 604.555.0100")], tasks=("77",))[0]["off_task"])

    def test_other_numbers_and_longer_digit_runs_do_not_match(self):
        self.assertEqual(self.scan([row("6045550199"), row("Invoice 16045550100999"), row("Draft letter")]), [])


class Markers(Case):
    MARKERS = [{"id": "evidence:marker:1", "pattern": "Code Editor"}]

    def scan(self, rows):
        return self.run_scan("markers", "--activities", self.write("a.json", rows), "--markers", self.write("m.json", self.MARKERS))

    def test_seconds_total_per_entry_and_marker_ignoring_case(self):
        found = self.scan([row("plugin - code editor", span=100), row("other - CODE EDITOR", span=50), row("x - Code Editor", span=25, entry="12")])
        self.assertEqual([(f["entry_id"], f["seconds"]) for f in found], [("11", 150), ("12", 25)])
        self.assertEqual(found[0]["marker"], "evidence:marker:1")
        self.assertEqual(found[0]["windows"], ["plugin - code editor", "other - CODE EDITOR"])

    def test_the_application_name_can_match(self):
        self.assertEqual(self.scan([row("Untitled", app="Code Editor")])[0]["seconds"], 300)

    def test_an_unmatched_row_gives_nothing(self):
        self.assertEqual(self.scan([row("Client letter")]), [])

    def test_a_marker_with_no_pattern_stops(self):
        with self.assertRaises(SystemExit) as caught, contextlib.redirect_stderr(io.StringIO()):
            self.run_scan("markers", "--activities", self.write("a.json", [row("x")]), "--markers", self.write("m.json", [{"id": "m"}]))
        self.assertEqual(caught.exception.code, 2)


if __name__ == "__main__":
    unittest.main()
