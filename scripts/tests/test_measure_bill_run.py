"""scripts/measure_bill_run.py against invented transcripts in a throwaway folder.

Run: python -m pytest -q scripts/tests/test_measure_bill_run.py
"""
import contextlib
import io
import json
import os
import shutil
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import measure_bill_run  # noqa: E402

SECRET = "invented matter text"


def usage(fresh, write, read, out):
    return {"input_tokens": fresh, "cache_creation_input_tokens": write,
            "cache_read_input_tokens": read, "output_tokens": out, "service_tier": "standard"}


def assistant(message_id, model, use, time, block, sidechain=False):
    return {"type": "assistant", "isSidechain": sidechain, "timestamp": time,
            "message": {"id": message_id, "model": model, "usage": use, "content": [block]}}


def user(time, content, sidechain=False, meta=False, origin=None):
    row = {"type": "user", "isSidechain": sidechain, "timestamp": time, "message": {"content": content}}
    if meta:
        row["isMeta"] = True
    if origin:
        row["origin"] = {"kind": origin}
    return row


def text(words):
    return {"type": "text", "text": words}


def call(call_id, name, args=None):
    return {"type": "tool_use", "id": call_id, "name": name, "input": args or {}}


MAIN = [
    {"type": "custom-title", "customTitle": SECRET},
    user("2026-01-01T10:05:00Z", SECRET, origin="human"),
    user("2026-01-01T10:05:10Z", "<local-command-stdout>" + SECRET + "</local-command-stdout>"),
    user("2026-01-01T10:05:20Z", SECRET, origin="peer"),
    # One message written as three rows, one per content block, same usage on each.
    assistant("m1", "model-a", usage(2, 100, 0, 10), "2026-01-01T10:06:00Z", text(SECRET)),
    assistant("m1", "model-a", usage(2, 100, 0, 10), "2026-01-01T10:06:01Z",
              call("t1", "AskUserQuestion", {"questions": [{"question": SECRET}]})),
    assistant("m1", "model-a", usage(2, 100, 0, 10), "2026-01-01T10:06:02Z", call("t2", "Agent", {"prompt": SECRET})),
    user("2026-01-01T10:07:00Z", [{"type": "tool_result", "tool_use_id": "t1", "content": SECRET}]),
    user("2026-01-01T10:07:30Z", SECRET, meta=True, origin="human"),
    assistant("m2", "model-b", usage(3, 0, 200, 20), "2026-01-01T10:08:00Z",
              call("t3", "mcp__ccd_turn__wrap_up", {"recap": SECRET, "ask": SECRET})),
    assistant("m3", "model-a", usage(1, 0, 300, 5), "2026-01-01T10:09:00Z",
              call("t4", "mcp__ccd_turn__wrap_up", {"recap": SECRET})),
    # Out of time order: the last message is written before an earlier one.
    user("2026-01-01T11:35:00Z", [{"type": "text", "text": SECRET}], origin="human"),
    user("2026-01-01T10:00:00Z", "<command-name>" + SECRET + "</command-name>", origin="human"),
]

SUB_ONE = [
    user("2026-01-01T10:10:00Z", SECRET, sidechain=True),
    assistant("s1", "model-a", usage(1, 50, 0, 7), "2026-01-01T10:11:00Z", text(SECRET), sidechain=True),
    assistant("s1", "model-a", usage(1, 50, 0, 7), "2026-01-01T10:11:01Z", call("u1", "Read"), sidechain=True),
]

SUB_TWO = [
    user("2026-01-01T10:20:00Z", SECRET, sidechain=True),
    assistant("s2", "model-a", usage(4, 0, 40, 3), "2026-01-01T10:21:00Z", text(SECRET), sidechain=True),
]


class MeasureTest(unittest.TestCase):
    def setUp(self):
        self.root = os.path.realpath(tempfile.mkdtemp(prefix="measure-bill-run-"))
        self.addCleanup(shutil.rmtree, self.root, ignore_errors=True)

    def put(self, name, rows):
        path = os.path.join(self.root, name)
        with open(path, "w", encoding="utf-8") as f:
            for row in rows:
                f.write(json.dumps(row) + "\n")
            f.write("\n")
        return path

    def run_script(self, *paths):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = measure_bill_run.main(list(paths))
        return code, out.getvalue(), err.getvalue()

    def full_run(self):
        return self.run_script(self.put("main-session.jsonl", MAIN),
                               self.put("agent-one.jsonl", SUB_ONE), self.put("agent-two.jsonl", SUB_TWO))

    def test_counts(self):
        code, out, _ = self.full_run()
        self.assertEqual(code, 0)
        lines = out.splitlines()
        # m1 counted once, not three times.
        self.assertIn("main: 3 messages, in 606 (fresh 6, cache write 100, cache read 500), out 35", lines)
        self.assertIn("  model-a: in 403 (fresh 3, cache write 100, cache read 300), out 15", lines)
        self.assertIn("  model-b: in 203 (fresh 3, cache write 0, cache read 200), out 20", lines)
        self.assertIn("subagent 1: 1 messages, in 51 (fresh 1, cache write 50, cache read 0), out 7", lines)
        self.assertIn("subagent 2: 1 messages, in 44 (fresh 4, cache write 0, cache read 40), out 3", lines)
        self.assertIn("total: in 701 (fresh 11, cache write 150, cache read 540), out 45", lines)
        self.assertIn("subagents: 2 (Agent calls in main: 1)", lines)
        self.assertIn("questions asked of the practitioner: 2 (AskUserQuestion 1, wrap_up with an ask 1; "
                      "plain-text questions are not counted)", lines)
        # Typed: the three human-origin rows, a slash command among them. Not the system notice,
        # the other session's message, the tool result or the meta row.
        self.assertIn("messages typed by the practitioner: 3", lines)
        self.assertIn("minutes, first message to last: 95.0", lines)

    def test_prints_no_path_name_or_text(self):
        _, out, _ = self.full_run()
        for leak in (self.root, "main-session", "agent-one", "agent-two", ".jsonl", SECRET, "2026"):
            self.assertNotIn(leak, out)

    def test_main_file_may_come_anywhere(self):
        _, first, _ = self.full_run()
        _, second, _ = self.run_script(self.put("a.jsonl", SUB_ONE), self.put("b.jsonl", MAIN),
                                       self.put("c.jsonl", SUB_TWO))
        self.assertEqual(first, second)

    def test_typed_count_without_origin_is_not_recorded(self):
        no_origin = [{k: v for k, v in row.items() if k != "origin"} for row in MAIN]
        _, out, _ = self.run_script(self.put("main.jsonl", no_origin))
        self.assertIn("messages typed by the practitioner: not recorded", out.splitlines())

    def test_no_main_session_is_refused(self):
        code, out, err = self.run_script(self.put("agent-one.jsonl", SUB_ONE))
        self.assertEqual((code, out), (2, ""))
        self.assertIn("found 0", err)

    def test_two_main_sessions_are_refused(self):
        code, _, err = self.run_script(self.put("a.jsonl", MAIN), self.put("b.jsonl", MAIN))
        self.assertEqual(code, 2)
        self.assertIn("found 2", err)

    def test_unreadable_file_is_refused_without_naming_it(self):
        bad = os.path.join(self.root, "broken.jsonl")
        with open(bad, "w", encoding="utf-8") as f:
            f.write("{" + SECRET + "\n")
        code, _, err = self.run_script(bad)
        self.assertEqual(code, 2)
        self.assertNotIn("broken", err)
        self.assertNotIn(SECRET, err)


if __name__ == "__main__":
    unittest.main()
