#!/usr/bin/env python3
"""
choose_issue: each implementer lane takes only its own issues, claims hold an
issue in both lanes, and each lane's lock never blocks the other.

Run: python -m pytest -q scripts/tests/test_choose_issue.py
"""

import importlib.util
import io
import json
import os
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from datetime import datetime, timezone

SCRIPTS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_spec = importlib.util.spec_from_file_location("choose_issue", os.path.join(SCRIPTS, "choose_issue.py"))
ci = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(ci)

NOW = datetime(2026, 10, 26, 15, 0, tzinfo=timezone.utc)


def issue(n, *names, pr=False):
    out = {"number": n, "state": "open", "labels": [{"name": x} for x in ("ready-for-agent",) + names]}
    if pr:
        out["pull_request"] = {"url": "x"}
    return out


def comment(cid, body, at):
    return {"id": cid, "body": body, "created_at": at}


CLAIM = ci.CLAIM_BODY
LIVE = "2026-10-26T13:00:00Z"   # 2 hours before NOW
STALE = "2026-10-26T09:00:00Z"  # 6 hours before NOW

# One cloud and one local issue queued, plus noise neither lane takes.
QUEUE = [
    issue(40, "cloud"),
    issue(31, "local"),
    issue(12, "cloud", "local"),           # relabelled local, cloud label left behind
    issue(50, "ready-for-human", "cloud", pr=True),
    {"number": 60, "state": "open", "labels": [{"name": "cloud"}]},  # not ready-for-agent
]


class Lanes(unittest.TestCase):
    def test_each_lane_takes_only_its_own(self):
        no_claims = {n: [] for n in (12, 31, 40)}
        self.assertEqual(ci.pick(QUEUE, "cloud", no_claims, now=NOW)["issue"], 40)
        self.assertEqual(ci.pick(QUEUE, "local", no_claims, now=NOW)["issue"], 12)
        self.assertEqual(ci.queue(QUEUE, "cloud"), [40])
        self.assertEqual(ci.queue(QUEUE, "local"), [12, 31])

    def test_one_cloud_one_local(self):
        two = [issue(7, "cloud"), issue(8, "local")]
        claims = {7: [], 8: []}
        self.assertEqual(ci.pick(two, "cloud", claims, now=NOW)["issue"], 7)
        self.assertEqual(ci.pick(two, "local", claims, now=NOW)["issue"], 8)

    def test_lane_order_then_oldest_first(self):
        issues = [issue(5, "local", "lane:ai"), issue(9, "local"), issue(3, "local", "lane:user"),
                  issue(4, "local"), issue(2, "local", "lane:ai")]
        self.assertEqual(ci.queue(issues, "local"), [4, 9, 3, 2, 5])

    def test_handled_and_duplicates_dropped(self):
        issues = [issue(4, "local"), issue(4, "local"), issue(6, "local")]
        self.assertEqual(ci.queue(issues, "local", handled={4}), [6])

    def test_withdrawn_issue_never_picked_in_either_lane(self):
        issues = [issue(3, "cloud", "withdrawn"), issue(4, "local", "withdrawn"),
                  issue(5, "cloud", "local", "withdrawn")]
        claims = {n: [] for n in (3, 4, 5)}
        for lane in ("cloud", "local"):
            self.assertEqual(ci.queue(issues, lane), [])
            self.assertIsNone(ci.pick(issues, lane, claims, now=NOW)["issue"])
        self.assertEqual(ci.pick(issues + [issue(9, "cloud")], "cloud", {**claims, 9: []}, now=NOW)["issue"], 9)

    def test_closed_issue_dropped(self):
        closed = issue(4, "local")
        closed["state"] = "closed"
        self.assertEqual(ci.queue([closed], "local"), [])


class Claims(unittest.TestCase):
    def test_live_claim_skipped_in_either_lane(self):
        issues = [issue(1, "local"), issue(2, "local"), issue(3, "cloud"), issue(4, "cloud")]
        claims = {1: [comment(100, CLAIM, LIVE)], 2: [], 3: [comment(101, CLAIM, LIVE)], 4: []}
        local = ci.pick(issues, "local", claims, now=NOW)
        self.assertEqual((local["issue"], local["skipped"]), (2, [{"issue": 1, "why": "claimed"}]))
        self.assertEqual(ci.pick(issues, "cloud", claims, now=NOW)["issue"], 4)

    def test_stale_claim_and_other_comments_do_not_hold(self):
        claims = {1: [comment(100, CLAIM, STALE), comment(101, "A note that names Claim stamp. in the middle", LIVE)]}
        self.assertEqual(ci.pick([issue(1, "local")], "local", claims, now=NOW)["issue"], 1)

    def test_all_claimed_chooses_none(self):
        claims = {1: [comment(100, CLAIM, LIVE)]}
        self.assertIsNone(ci.pick([issue(1, "local")], "local", claims, now=NOW)["issue"])

    def test_missing_comments_refused(self):
        with self.assertRaises(ci.Unsettled):
            ci.pick([issue(1, "local"), issue(2, "local")], "local", {2: []}, now=NOW)

    def test_comments_needed_only_up_to_the_chosen_issue(self):
        self.assertEqual(ci.pick([issue(1, "local"), issue(2, "local")], "local", {1: []}, now=NOW)["issue"], 1)


class Locks(unittest.TestCase):
    CLOUD_STAMP = comment(500, ci.LANES["cloud"]["body"], "2026-10-26T14:30:00Z")
    LOCAL_STAMP = comment(501, ci.LANES["local"]["body"], "2026-10-26T14:31:00Z")

    def test_cloud_lock_held_does_not_block_local(self):
        comments = [self.CLOUD_STAMP]
        self.assertEqual(ci.lock(comments, "cloud", now=NOW)["state"], "held")
        self.assertEqual(ci.lock(comments, "local", now=NOW)["state"], "free")

    def test_local_lock_held_does_not_block_cloud(self):
        comments = [self.LOCAL_STAMP]
        self.assertEqual(ci.lock(comments, "local", now=NOW)["state"], "held")
        self.assertEqual(ci.lock(comments, "cloud", now=NOW)["state"], "free")

    def test_both_held_each_lane_owns_its_own(self):
        comments = [self.CLOUD_STAMP, self.LOCAL_STAMP]
        self.assertEqual(ci.lock(comments, "cloud", own=500, now=NOW)["state"], "mine")
        self.assertEqual(ci.lock(comments, "local", own=501, now=NOW)["state"], "mine")
        self.assertEqual(ci.lock(comments, "local", own=500, now=NOW)["state"], "held")

    def test_earliest_id_wins_and_window_is_90_minutes(self):
        later = comment(502, ci.LANES["local"]["body"], "2026-10-26T14:32:00Z")
        old = comment(400, ci.LANES["local"]["body"], "2026-10-26T13:29:00Z")  # 91 minutes old
        result = ci.lock([later, self.LOCAL_STAMP, old], "local", own=502, now=NOW)
        self.assertEqual((result["state"], result["holder"]["id"]), ("held", 501))
        self.assertEqual(ci.lock([old], "local", now=NOW)["state"], "free")

    def test_lock_body_starts_with_its_prefix(self):
        for lane, spec in ci.LANES.items():
            self.assertTrue(spec["body"].startswith(spec["prefix"]), lane)
        self.assertFalse(ci.LANES["local"]["body"].startswith(ci.LANES["cloud"]["prefix"]))
        self.assertFalse(ci.LANES["cloud"]["body"].startswith(ci.LANES["local"]["prefix"]))


class Cli(unittest.TestCase):
    def run_main(self, *argv):
        out, err = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            code = ci.main(list(argv))
        return code, out.getvalue(), err.getvalue()

    def write(self, folder, name, text):
        path = os.path.join(folder, name)
        with open(path, "w", encoding="utf-8") as f:
            f.write(text)
        return path

    def test_pick_over_paginated_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            pages = self.write(tmp, "issues.json", json.dumps([issue(40, "cloud")]) + "\n" +
                               json.dumps([issue(31, "local")]))
            c31 = self.write(tmp, "c31.json", "[]")
            c40 = self.write(tmp, "c40.json", json.dumps([comment(9, CLAIM, LIVE)]))
            code, out, _ = self.run_main("pick", "--lane", "local", "--issues", pages,
                                         "--comments", f"31={c31}", "--now", "2026-10-26T15:00:00Z")
            self.assertEqual((code, json.loads(out)["issue"]), (0, 31))
            code, out, _ = self.run_main("pick", "--lane", "cloud", "--issues", pages,
                                         "--comments", f"40={c40}", "--now", "2026-10-26T15:00:00Z")
            self.assertEqual((code, json.loads(out)["issue"]), (0, None))

    def test_lock_cli(self):
        with tempfile.TemporaryDirectory() as tmp:
            page = self.write(tmp, "lock.json", json.dumps([Locks.CLOUD_STAMP]))
            code, out, _ = self.run_main("lock", "--lane", "local", "--comments", page,
                                         "--now", "2026-10-26T15:00:00Z")
            self.assertEqual((code, json.loads(out)["state"], json.loads(out)["lock_issue"]), (0, "free", 189))

    def test_bad_input_exits_2(self):
        self.assertEqual(self.run_main("pick", "--lane", "both")[0], 2)
        self.assertEqual(self.run_main("queue")[0], 2)
        with tempfile.TemporaryDirectory() as tmp:
            page = self.write(tmp, "issues.json", json.dumps([issue(1, "local")]))
            self.assertEqual(self.run_main("pick", "--lane", "local", "--issues", page)[0], 2)
            bad = self.write(tmp, "bad.json", "{}")
            self.assertEqual(self.run_main("queue", "--lane", "local", "--issues", bad)[0], 2)


class Handback(unittest.TestCase):
    EARLIER = comment(70, "Hand-back (hook-refused): a check was refused.", LIVE)

    def test_a_listed_reason_goes_to_a_person(self):
        for reason in ci.NEEDS_PERSON:
            self.assertEqual(ci.handback(reason, [])["add"], ["ready-for-human"], reason)

    def test_any_other_reason_goes_back_to_triage_once(self):
        first = ci.handback("hook-refused", [])
        self.assertEqual((first["add"], first["remove"]), (["needs-triage"], ["ready-for-agent"]))
        self.assertEqual(ci.handback("hook-refused", [self.EARLIER])["add"], ["ready-for-human"])

    def test_a_suggestion_issue_always_goes_to_a_person(self):
        self.assertEqual(ci.handback("hook-refused", [], ["suggestion", "local"])["add"], ["ready-for-human"])

    def test_only_the_marker_counts_as_an_earlier_hand_back(self):
        others = [comment(71, "Handed back by the local implementer.", LIVE),
                  comment(72, "A note about a Hand-back (x): in the middle.", LIVE)]
        self.assertEqual(ci.handback("hook-refused", others)["earlier"], 0)

    def test_the_comment_prefix_names_the_reason_and_is_counted_later(self):
        prefix = ci.handback("merge-conflict", [])["comment_prefix"]
        self.assertEqual(prefix, "Hand-back (merge-conflict):")
        self.assertEqual(ci.handback("x", [comment(73, prefix + " why", LIVE)])["earlier"], 1)

    def test_cli(self):
        with tempfile.TemporaryDirectory() as tmp:
            comments = os.path.join(tmp, "c.json")
            with open(comments, "w", encoding="utf-8") as f:
                # Two pages back to back, as `gh api --paginate` prints them.
                f.write(json.dumps([self.EARLIER]) + json.dumps([]))
            detail = os.path.join(tmp, "i.json")
            with open(detail, "w", encoding="utf-8") as f:
                json.dump({"number": 5, "labels": [{"name": "local"}]}, f)
            out = io.StringIO()
            with redirect_stdout(out):
                code = ci.main(["handback", "--reason", "suite", "--comments", comments, "--issue", detail])
            self.assertEqual((code, json.loads(out.getvalue())["add"]), (0, ["ready-for-human"]))
            with redirect_stderr(io.StringIO()):
                self.assertEqual(ci.main(["handback", "--comments", comments]), 2)
                self.assertEqual(ci.main(["handback", "--reason", "suite"]), 2)


class Untriaged(unittest.TestCase):
    def bare(self, n, *names):
        return {"number": n, "state": "open", "labels": [{"name": x} for x in names]}

    def test_a_handed_back_issue_is_taken_again(self):
        self.assertEqual(ci.untriaged([self.bare(5, "bug", "needs-triage", "local")]), [5])

    def test_only_open_issues_with_no_state_label_newest_first(self):
        issues = [
            self.bare(200),
            self.bare(202, "enhancement", "needs-triage"),
            self.bare(226, "suggestion", "needs-triage", "lane:user"),
            self.bare(183, "enhancement", "local"),
            self.bare(190, "ready-for-human"),
            self.bare(191, "ready-for-agent"),
            self.bare(192, "needs-info"),
            self.bare(193, "wontfix"),
            self.bare(194, "withdrawn", "suggestion"),
            self.bare(195, "wayfinder:map"),
            self.bare(196, "wayfinder:task"),
            {**self.bare(197), "pull_request": {"url": "x"}},
            {**self.bare(198), "state": "closed"},
            self.bare(200),
        ]
        self.assertEqual(ci.untriaged(issues), [226, 202, 200, 183])

    def test_cli_needs_no_lane(self):
        with tempfile.TemporaryDirectory() as folder:
            path = os.path.join(folder, "issues.json")
            with open(path, "w", encoding="utf-8") as f:
                # Two pages back to back, as `gh api --paginate` prints them.
                f.write(json.dumps([self.bare(5)]) + json.dumps([self.bare(9)]))
            out = io.StringIO()
            with redirect_stdout(out):
                code = ci.main(["untriaged", "--issues", path])
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(out.getvalue()), {"queue": [9, 5]})


if __name__ == "__main__":
    unittest.main()
