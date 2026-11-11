"""screenshot_pick.py picks the first, a middle and the last capture, and each window-title change."""
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))
import screenshot_pick  # noqa: E402


def caps(*titles):
    return [{"id": f"c{n}", "windowTitle": t, "screenshotId": f"s{n}"} for n, t in enumerate(titles)]


def ids(result):
    return [p["id"] for p in result["picked"]]


class Pick(unittest.TestCase):
    def test_first_middle_last_of_a_steady_stretch(self):
        result = screenshot_pick.pick(caps(*["Word"] * 9))
        self.assertEqual(ids(result), ["c0", "c4", "c8"])
        self.assertEqual([p["why"] for p in result["picked"]], [["first"], ["middle"], ["last"]])

    def test_each_title_change_is_picked(self):
        result = screenshot_pick.pick(caps("A", "A", "A", "B", "B", "C", "C", "C", "C"))
        self.assertEqual(ids(result), ["c0", "c3", "c4", "c5", "c8"])
        self.assertEqual(dict((p["id"], p["why"]) for p in result["picked"])["c3"], ["title_change"])

    def test_a_null_title_equals_another_null_title_but_not_a_named_one(self):
        result = screenshot_pick.pick(caps(None, None, "A", None, None))
        self.assertEqual(ids(result), ["c0", "c2", "c3", "c4"])

    def test_small_stretches(self):
        self.assertEqual(screenshot_pick.pick([]), {"picked": [], "dispatches": []})
        self.assertEqual(ids(screenshot_pick.pick(caps("A"))), ["c0"])
        self.assertEqual(ids(screenshot_pick.pick(caps("A", "A"))), ["c0", "c1"])

    def test_a_middle_capture_showing_the_same_screen_as_the_one_before_is_dropped(self):
        captures = caps("A", "A", "A", "A", "A")
        captures[2]["screenshotId"] = captures[1]["screenshotId"]
        self.assertEqual(ids(screenshot_pick.pick(captures)), ["c0", "c4"])

    def test_picks_are_grouped_five_to_a_dispatch(self):
        result = screenshot_pick.pick(caps(*[f"T{n}" for n in range(12)]))
        self.assertEqual([len(d) for d in result["dispatches"]], [5, 5, 2])
        self.assertEqual([i for d in result["dispatches"] for i in d], ids(result))

    def test_cli(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "caps.json"
            path.write_text(json.dumps(caps("A", "B", "B")), encoding="utf-8")
            done = subprocess.run([sys.executable, str(SCRIPTS / "screenshot_pick.py"), "pick", "--captures", str(path)],
                                  capture_output=True, text=True)
            self.assertEqual(done.returncode, 0, done.stderr)
            self.assertEqual(ids(json.loads(done.stdout)), ["c0", "c1", "c2"])
            path.write_text("{}", encoding="utf-8")
            bad = subprocess.run([sys.executable, str(SCRIPTS / "screenshot_pick.py"), "pick", "--captures", str(path)],
                                 capture_output=True, text=True)
            self.assertEqual(bad.returncode, 2)


if __name__ == "__main__":
    unittest.main()
