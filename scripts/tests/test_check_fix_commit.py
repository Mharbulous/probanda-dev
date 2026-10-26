#!/usr/bin/env python3
"""
check_fix_commit: a fix commit names exactly one approved item as
`Suggestion <id> item <n>`, and no commit quotes the submitted text.

Run: python -m pytest -q scripts/tests/test_check_fix_commit.py

The suggestion below is invented for this test.
"""

import importlib.util
import io
import json
import os
import subprocess
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

SCRIPTS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_spec = importlib.util.spec_from_file_location("check_fix_commit", os.path.join(SCRIPTS, "check_fix_commit.py"))
cfc = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(cfc)

SID = "3b6f1c2a-9d4e-4f7a-8b1c-2d3e4f5a6b7c"
OTHER = "7c6b5a4f-3e2d-4c1b-8a9f-0e1d2c3b4a59"
QUOTE = "The weekly figures run together into one long line on the phone."

RECORD = {
    "suggestion_id": SID,
    "body": QUOTE,
    "item_list": [
        {"item": 1, "text": "Give each matter its own row with the hours shown first", "status": "approved"},
        {"item": 2, "text": "Print the grand total in a much larger font size", "status": "declined"},
    ],
}
SELECTION = {"suggestion_id": SID, "brief": "comment",
             "build": [{"suggestion_id": SID, "item": 1, "also": [], "refs": [f"Suggestion {SID} item 1"]}],
             "not_built": [{"suggestion_id": SID, "item": 2, "why": "declined"}]}
MERGED = {"suggestion_id": SID, "brief": "comment",
          "build": [{"suggestion_id": SID, "item": 1, "also": [{"suggestion_id": OTHER, "item": 3}],
                     "refs": [f"Suggestion {SID} item 1", f"Suggestion {OTHER} item 3"]}],
          "not_built": []}

GOOD = f"Split the summary into one row per matter\n\nEach matter now reads on its own line.\n\nSuggestion {SID} item 1\n"


def fields():
    return cfc.check_verbatim.record_fields(RECORD)


class MessageTest(unittest.TestCase):
    def failures(self, message, selection=SELECTION):
        return cfc.check_message("msg", message, fields(), cfc.units(selection), require_ref=True)[0]

    def test_the_approved_item_passes(self):
        self.assertEqual(self.failures(GOOD), [])

    def test_the_id_is_matched_whatever_its_case(self):
        self.assertEqual(self.failures(GOOD.replace(SID, SID.upper())), [])

    def test_the_declined_item_fails(self):
        got = self.failures(GOOD.replace("item 1", "item 2"))
        self.assertEqual(len(got), 1)
        self.assertIn("not an approved item", got[0])

    def test_two_items_in_one_commit_fail(self):
        selection = json.loads(json.dumps(SELECTION))
        selection["build"].append({"suggestion_id": SID, "item": 2, "also": [], "refs": [f"Suggestion {SID} item 2"]})
        got = self.failures(GOOD + f"Suggestion {SID} item 2\n", selection)
        self.assertIn("not exactly one approved unit", got[0])

    def test_another_suggestion_fails(self):
        self.assertIn("not an approved item", self.failures(GOOD.replace(SID, OTHER))[0])

    def test_no_item_named_fails(self):
        self.assertIn("names no approved item", self.failures("Split the summary into rows\n")[0])

    def test_a_suggestion_without_its_item_fails(self):
        got = self.failures(GOOD + f"See Suggestion {SID} for context.\n")
        self.assertIn("without its item number", got[0])

    def test_a_quoted_sentence_fails(self):
        got = self.failures(GOOD + "\nAs reported: the weekly figures run together into one long line on the phone\n")
        self.assertTrue(any("verbatim" in f for f in got))

    def test_a_merged_unit_needs_every_ref(self):
        self.assertIn("not exactly one approved unit", self.failures(GOOD, MERGED)[0])
        self.assertEqual(self.failures(GOOD + f"Suggestion {OTHER} item 3\n", MERGED), [])


def git(repo, *args):
    subprocess.run(["git", "-C", repo, *args], check=True, capture_output=True)


class RangeTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.repo = self.tmp.name
        git(self.repo, "init", "-q", "-b", "main")
        git(self.repo, "config", "user.email", "test@example.invalid")
        git(self.repo, "config", "user.name", "Test")
        self.commit("base.txt", "base\n", "Base")
        git(self.repo, "tag", "base")

    def tearDown(self):
        self.tmp.cleanup()

    def commit(self, name, text, message):
        Path(self.repo, name).write_text(text, encoding="utf-8")
        git(self.repo, "add", name)
        git(self.repo, "commit", "-q", "-m", message)

    def failures(self, dropped=()):
        return cfc.check_range(self.repo, "base..HEAD", fields(), cfc.units(SELECTION), set(dropped))[0]

    def test_one_fix_commit_and_a_release_commit_pass(self):
        self.commit("report.py", "rows = True\n", GOOD)
        self.commit("version.txt", "0.1.1\n", "Lawyer 0.1.1: one row per matter in the summary")
        self.assertEqual(self.failures(), [])

    def test_a_built_unit_with_no_commit_fails(self):
        self.commit("report.py", "rows = True\n", "Split the summary into rows")
        self.assertIn("no commit in base..HEAD names it", self.failures()[0])

    def test_a_dropped_unit_needs_no_commit_and_none_may_name_it(self):
        self.commit("version.txt", "0.1.1\n", "Release")
        self.assertEqual(self.failures(dropped=[(SID, 1)]), [])
        self.commit("report.py", "rows = True\n", GOOD)
        self.assertIn("was dropped", self.failures(dropped=[(SID, 1)])[0])

    def test_two_commits_for_one_item_fail(self):
        self.commit("report.py", "rows = True\n", GOOD)
        self.commit("report2.py", "more = True\n", GOOD)
        self.assertIn("one fix commit per item", self.failures()[0])

    def test_a_commit_naming_the_declined_item_fails(self):
        self.commit("report.py", "rows = True\n", GOOD)
        self.commit("total.py", "big = True\n", GOOD.replace("item 1", "item 2"))
        self.assertTrue(any("not an approved item" in f for f in self.failures()))

    def test_an_added_line_quoting_the_submitted_text_fails(self):
        self.commit("report.py", f"# {QUOTE}\nrows = True\n", GOOD)
        self.assertTrue(any("added line" in f for f in self.failures()))

    def test_main_runs_the_range_and_exits_1_on_a_failure(self):
        self.commit("report.py", "rows = True\n", GOOD.replace("item 1", "item 2"))
        with tempfile.TemporaryDirectory() as d:
            sel_path, rec_path = Path(d, "s.json"), Path(d, "r.json")
            sel_path.write_text(json.dumps(SELECTION), encoding="utf-8")
            rec_path.write_text(json.dumps(RECORD), encoding="utf-8")
            out = io.StringIO()
            with redirect_stdout(out), redirect_stderr(io.StringIO()):
                code = cfc.main(["--selection", str(sel_path), "--suggestion", str(rec_path),
                                 "--range", "base..HEAD", "--repo", self.repo])
        self.assertEqual(code, 1)
        self.assertIn("not an approved item", out.getvalue())


class MainTest(unittest.TestCase):
    def test_message_mode_passes_and_bad_arguments_exit_2(self):
        with tempfile.TemporaryDirectory() as d:
            sel_path, rec_path, msg = Path(d, "s.json"), Path(d, "r.json"), Path(d, "m.txt")
            sel_path.write_text(json.dumps(SELECTION), encoding="utf-8")
            rec_path.write_text(json.dumps(RECORD), encoding="utf-8")
            msg.write_text(GOOD, encoding="utf-8")
            with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
                self.assertEqual(cfc.main(["--selection", str(sel_path), "--suggestion", str(rec_path),
                                           "--message", str(msg)]), 0)
                self.assertEqual(cfc.main(["--selection", str(sel_path), "--message", str(msg)]), 2)
                self.assertEqual(cfc.main(["--selection", str(sel_path), "--suggestion", str(rec_path),
                                           "--message", str(msg), "--dropped", f"{SID}:1"]), 2)


if __name__ == "__main__":
    unittest.main()
