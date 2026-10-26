#!/usr/bin/env python3
"""
withdrawals: a tombstone closes its issue and labels it `withdrawn`, an issue
already closed withdrawn needs nothing, a live suggestion and a withdrawal made
before intake filed anything need nothing, and the closed issue leaves the queue
of both implementer lanes.

Run: python -m pytest -q scripts/tests/test_withdrawals.py
"""

import importlib.util
import io
import json
import os
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout

SCRIPTS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def load(name):
    spec = importlib.util.spec_from_file_location(name, os.path.join(SCRIPTS, f"{name}.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


wd = load("withdrawals")
ci = load("choose_issue")

TOMB = "11111111-1111-4111-8111-111111111111"
DONE = "22222222-2222-4222-8222-222222222222"
LIVE = "33333333-3333-4333-8333-333333333333"
LINE_ONLY = "44444444-4444-4444-8444-444444444444"


def issue(n, sid, *names, state="open"):
    return {"number": n, "state": state, "labels": [{"name": x} for x in ("suggestion",) + names],
            "body": f"## Suggestion\n\n**In short:** a paraphrase.\n\nSuggestion {sid}\n"}


def tombstone(sid, n):
    return {"suggestion_id": sid, "status": "withdrawn", "issue_number": n, "title": None, "body": None,
            "badge": "Withdrawn", "item_list": []}


ISSUES = [
    issue(70, TOMB, "ready-for-agent", "cloud", "lane:user"),
    issue(71, DONE, "withdrawn", "lane:user", state="closed"),
    issue(72, LIVE, "ready-for-agent", "local", "lane:user"),
    issue(73, LINE_ONLY, "ready-for-human", "cloud", "lane:ai"),
]


def apply(issues, actions):
    """What intake's writes leave on GitHub, for the chooser."""
    out = [json.loads(json.dumps(i)) for i in issues]
    for act in actions:
        target = next(i for i in out if i["number"] == act["issue"])
        if act["add_label"]:
            target["labels"].append({"name": "withdrawn"})
        if act["close"]:
            target["state"] = "closed"
    return out


class Decide(unittest.TestCase):
    def test_tombstone_with_open_issue_is_labelled_and_closed(self):
        result = wd.decide([tombstone(TOMB, 70)], ISSUES)
        self.assertEqual(result["actions"],
                         [{"issue": 70, "suggestion_id": TOMB, "comment": True, "add_label": True, "close": True}])
        self.assertEqual(result["unmatched"], [])

    def test_issue_already_closed_withdrawn_needs_nothing(self):
        result = wd.decide([tombstone(DONE, 71)], ISSUES)
        self.assertEqual(result["actions"], [])
        self.assertEqual(result["done"], [{"issue": 71, "suggestion_id": DONE}])

    def test_live_suggestion_needs_nothing(self):
        live = {"suggestion_id": LIVE, "status": "under review", "issue_number": 72, "title": "t", "body": "b"}
        submitted = {"suggestion_id": TOMB, "status": "submitted", "issue_number": 70}
        result = wd.decide([live, submitted], ISSUES)
        self.assertEqual((result["actions"], result["done"], result["unmatched"]), ([], [], []))

    def test_withdrawal_before_intake_leaves_nothing_to_do(self):
        # suggestion-withdraw deleted the row (no issue number was recorded), and
        # intake never filed an issue: no row, no issue, no action.
        result = wd.decide([], ISSUES)
        self.assertEqual((result["actions"], result["done"], result["unmatched"]), ([], [], []))

    def test_issue_found_by_its_suggestion_line(self):
        row = tombstone(LINE_ONLY.upper(), None)
        result = wd.decide([row], ISSUES)
        self.assertEqual([a["issue"] for a in result["actions"]], [73])

    def test_closed_unlabelled_issue_is_labelled_not_reopened(self):
        closed = issue(80, TOMB, "ready-for-human", state="closed")
        result = wd.decide([tombstone(TOMB, 80)], [closed])
        self.assertEqual(result["actions"],
                         [{"issue": 80, "suggestion_id": TOMB, "comment": True, "add_label": True, "close": False}])

    def test_run_cut_short_after_labelling_closes_without_a_second_comment(self):
        half = issue(70, TOMB, "ready-for-agent", "cloud", "withdrawn")
        result = wd.decide([tombstone(TOMB, 70)], [half])
        self.assertEqual(result["actions"],
                         [{"issue": 70, "suggestion_id": TOMB, "comment": False, "add_label": False, "close": True}])

    def test_tombstone_with_no_issue_listed_is_unmatched(self):
        result = wd.decide([tombstone(TOMB, 999)], [])
        self.assertEqual(result["actions"], [])
        self.assertEqual(result["unmatched"], [{"suggestion_id": TOMB, "issue_number": 999}])

    def test_pull_requests_ignored(self):
        pr = issue(70, TOMB)
        pr["pull_request"] = {"url": "x"}
        self.assertEqual(wd.decide([tombstone(TOMB, 70)], [pr])["unmatched"][0]["issue_number"], 70)

    def test_comment_quotes_nothing_and_names_the_withdrawal(self):
        self.assertIn("Withdrawn by its sender", wd.COMMENT)
        self.assertNotIn("Suggestion ", wd.COMMENT)


class Queue(unittest.TestCase):
    def test_tombstone_removes_its_issue_from_the_queue(self):
        self.assertEqual(ci.queue(ISSUES, "cloud"), [70])
        after = apply(ISSUES, wd.decide([tombstone(TOMB, 70)], ISSUES)["actions"])
        self.assertEqual(ci.queue(after, "cloud"), [])
        self.assertEqual(ci.queue(after, "local"), [72])


class Cli(unittest.TestCase):
    def run_cli(self, *args):
        out, err = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            code = wd.main(list(args))
        return code, out.getvalue(), err.getvalue()

    def test_reads_a_reply_and_a_paginated_issue_list(self):
        with tempfile.TemporaryDirectory() as d:
            rows = os.path.join(d, "rows.json")
            issues = os.path.join(d, "issues.json")
            with open(rows, "w", encoding="utf-8") as f:
                json.dump({"suggestions": [tombstone(TOMB, 70)]}, f)
            with open(issues, "w", encoding="utf-8") as f:
                f.write(json.dumps(ISSUES[:2]) + "\n" + json.dumps(ISSUES[2:]))
            code, out, _ = self.run_cli("--rows", rows, "--issues", issues)
        self.assertEqual(code, 0)
        self.assertEqual([a["issue"] for a in json.loads(out)["actions"]], [70])

    def test_missing_input_decides_nothing(self):
        code, out, err = self.run_cli("--rows", "/nonexistent/rows.json", "--issues", "/nonexistent/i.json")
        self.assertEqual((code, out), (2, ""))
        self.assertIn("nothing is decided", err)
        self.assertEqual(self.run_cli()[0], 2)


if __name__ == "__main__":
    unittest.main()
