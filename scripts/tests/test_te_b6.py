"""Tests for the temporary B6 spike test: the hook te_b6.py and the server state-mcp.js.

Run: python scripts/tests/test_te_b6.py"""
import hashlib
import importlib.util
import json
import os
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
HOOK = REPO / "source" / "tokeneconomizer" / "scripts" / "te_b6.py"
SERVER = REPO / "source" / "tokeneconomizer" / "state-mcp" / "dist" / "state-mcp.js"
SPEC = REPO / "docs" / "Specs" / "2026-10-28_tokeneconomizer-cowork-adaptation-spec.md"
RESTORE_TOOL = "mcp__remote-devices__plugin_tokeneconomizer_state__restore_state"
SAVE_TOOL = "mcp__remote-devices__plugin_tokeneconomizer_state__save_state"

loaded = importlib.util.spec_from_file_location("te_b6", HOOK)
te_b6 = importlib.util.module_from_spec(loaded)
loaded.loader.exec_module(te_b6)


class Temp(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.home = Path(tmp.name) / "home"
        self.local = Path(tmp.name) / "local"
        self.env = {**os.environ, "TOKENECONOMIZER_HOME": str(self.home), "LOCALAPPDATA": str(self.local)}

    def hook(self, event, **fields):
        result = subprocess.run([sys.executable, str(HOOK)], input=json.dumps({"hook_event_name": event, **fields}),
                                capture_output=True, text=True, env=self.env, check=True)
        return json.loads(result.stdout)

    def prompt(self, text):
        return self.hook("UserPromptSubmit", prompt=text, session_id="s", permission_mode="default")

    def log(self):
        with open(self.home / "b6" / "log.jsonl", encoding="utf-8") as f:
            return [json.loads(line) for line in f]


class HookTest(Temp):
    def test_unarmed_prints_nothing_and_writes_nothing(self):
        self.assertEqual(self.prompt("hello"), {})
        self.assertEqual(self.hook("PostToolUse", tool_name=SAVE_TOOL, tool_response="x"), {})
        self.assertEqual(self.hook("PostToolUseFailure", tool_name=SAVE_TOOL, error="no"), {})
        self.assertEqual(self.hook("PermissionDenied", tool_name=SAVE_TOOL, reason="no"), {})
        self.assertEqual(self.prompt("te-b6-end"), {})
        self.assertFalse(self.home.exists())

    def test_arming_asks_nothing_and_end_disarms(self):
        self.assertEqual(self.prompt("te-b6-arm-save. Reply."), {})
        self.assertEqual(self.prompt("te-b6-end. Print the logs."), {})
        self.assertEqual(self.prompt("an ordinary prompt"), {})
        self.assertEqual([e["event"] for e in self.log()], ["arm", "end"])

    def test_save_asks_are_the_fixed_text_for_n_1_to_10_then_stop(self):
        self.prompt("te-b6-arm-save")
        for n in range(1, 11):
            out = self.prompt(f"prompt {n}")["hookSpecificOutput"]
            self.assertEqual(out["hookEventName"], "UserPromptSubmit")
            self.assertEqual(out["additionalContext"], te_b6.SAVE_ASK.format(n=n, payload=te_b6.payload(n)))
        self.assertEqual(self.prompt("prompt 11"), {})
        asks = [e for e in self.log() if e["event"] == "ask"]
        self.assertEqual([e["n"] for e in asks], list(range(1, 11)))
        self.assertTrue(all(e["ask_chars"] > 0 and e["permission_mode"] == "default" for e in asks))

    def test_restore_asks_once_with_the_fixed_text(self):
        self.prompt("te-b6-arm-restore")
        self.assertEqual(self.prompt("first")["hookSpecificOutput"]["additionalContext"], te_b6.RESTORE_ASK)
        self.assertEqual(self.prompt("second"), {})

    def test_the_spec_holds_both_asks_word_for_word(self):
        spec = SPEC.read_text(encoding="utf-8")
        self.assertIn(te_b6.SAVE_ASK, spec)
        self.assertIn(te_b6.RESTORE_ASK, spec)

    def test_no_ask_tells_the_model_to_hide_the_call(self):
        for ask in (te_b6.SAVE_ASK.format(n=1, payload=te_b6.payload(1)), te_b6.RESTORE_ASK):
            self.assertIn("You are free to mention", ask)
            rest = ask.replace("You are free to mention", "")
            self.assertIsNone(re.search(r"\b(mention|quiet|quietly|silent|silently|hide)\b", rest, re.I))

    def test_payload_shape(self):
        for n in range(1, 11):
            text = te_b6.payload(n)
            self.assertEqual(text, te_b6.payload(n))
            self.assertTrue(650 <= len(text.encode("ascii")) <= 800, n)
            self.assertLessEqual(len(text), 4000)
            for line in text.split("\n"):
                self.assertIn("synthetic", line)
                self.assertIn('"', line)
                self.assertIn("\\", line)
                json.loads(line)
        self.assertEqual(len({te_b6.payload(n) for n in range(1, 11)}), 10)

    def test_denied_and_failure_hooks_log_in_full_and_emit_nothing(self):
        self.prompt("te-b6-arm-save")
        reason = "refused: exact words " * 40
        self.assertEqual(self.hook("PermissionDenied", tool_name=SAVE_TOOL, reason=reason), {})
        self.assertEqual(self.hook("PostToolUseFailure", tool_name=SAVE_TOOL, error=reason), {})
        self.assertEqual(self.hook("PostToolUseFailure", tool_name="Bash", error="other"), {})
        denied, failure, other = self.log()[1:]
        self.assertEqual((denied["event"], denied["reason"]), ("denied", reason))
        self.assertEqual((failure["failed"], failure["error"]), (True, reason))
        self.assertEqual((other["tool_name"], other["failed"]), ("Bash", True))
        self.assertNotIn("error", other)

    def test_all_three_response_shapes_give_the_same_restored_file(self):
        rest = te_b6.payload(1) + "\n" + te_b6.payload(2)
        text = '{"server":"b6-1"}\n' + rest
        expected = hashlib.sha256(rest.encode("utf-8")).hexdigest()
        self.prompt("te-b6-arm-restore")
        for response in (text, [{"type": "text", "text": text}], {"content": [{"type": "text", "text": text}]}):
            with self.subTest(shape=type(response).__name__):
                self.assertEqual(self.hook("PostToolUse", tool_name=RESTORE_TOOL, tool_response=response), {})
                self.assertEqual((self.home / "b6" / "restored.txt").read_bytes(), rest.encode("utf-8"))
                self.assertEqual(self.log()[-1]["restored_sha256"], expected)


class ServerTest(Temp):
    def server(self, *requests):
        lines = [json.dumps({"jsonrpc": "2.0", "id": i, **r}) for i, r in enumerate(requests, 1)]
        result = subprocess.run(["node", str(SERVER)], input="\n".join(lines) + "\n", capture_output=True, text=True,
                                encoding="utf-8", env=self.env, check=True)
        return [json.loads(line) for line in result.stdout.splitlines()]

    def call(self, name, **arguments):
        return self.server({"method": "tools/call", "params": {"name": name, "arguments": arguments}})[0]["result"]

    @property
    def store(self):
        return self.local / "TokenEconomizer" / "b6"

    def test_lists_the_two_tools_with_their_descriptions(self):
        _, listed = self.server({"method": "initialize", "params": {"protocolVersion": "2025-06-18"}},
                                {"method": "tools/list"})
        tools = {t["name"]: t for t in listed["result"]["tools"]}
        self.assertEqual(set(tools), {"save_state", "restore_state"})
        self.assertEqual(tools["save_state"]["description"],
                         "Saves one numbered block of TokenEconomizer state to a file on the user's computer so a "
                         "later Cowork session can restore it. Writes nothing else.")
        self.assertEqual(tools["restore_state"]["description"],
                         "Returns every block of TokenEconomizer state saved by save_state. Changes nothing except "
                         "its own read log.")
        self.assertEqual(tools["save_state"]["annotations"], {"readOnlyHint": False, "destructiveHint": False})
        self.assertEqual(tools["restore_state"]["annotations"], {"readOnlyHint": False})

    def test_save_and_restore_round_trip(self):
        blocks = {n: te_b6.payload(n) for n in (2, 1)}
        for n, lines in blocks.items():
            saved = self.call("save_state", n=n, lines=lines)
            digest = hashlib.sha256(lines.encode("utf-8")).hexdigest()
            self.assertEqual(saved["content"][0]["text"], f"saved n={n} sha256={digest} bytes={len(lines)}")
            self.assertEqual((self.store / f"save-{n}.txt").read_bytes(), lines.encode("utf-8"))
        first, _, rest = self.call("restore_state")["content"][0]["text"].partition("\n")
        self.assertEqual(rest, blocks[1] + "\n" + blocks[2])
        head = json.loads(first)
        self.assertEqual(head, {"server": "b6-1", "platform": head["platform"], "store": str(self.store), "count": 2,
                                "sha256": hashlib.sha256(rest.encode("utf-8")).hexdigest()})
        self.assertEqual(len((self.store / "save-log.jsonl").read_text(encoding="utf-8").splitlines()), 2)
        self.assertEqual(len((self.store / "restore-log.jsonl").read_text(encoding="utf-8").splitlines()), 1)

    def test_refuses_n_outside_1_to_10_and_overlong_lines(self):
        for arguments in ({"n": 0, "lines": "x"}, {"n": 11, "lines": "x"}, {"n": 1.5, "lines": "x"},
                          {"n": 1, "lines": "x" * 4001}):
            with self.subTest(arguments=arguments):
                self.assertTrue(self.call("save_state", **arguments)["isError"])
        self.assertFalse(self.store.exists())

    def test_never_overwrites(self):
        self.call("save_state", n=1, lines="first")
        self.assertTrue(self.call("save_state", n=1, lines="second")["isError"])
        self.assertEqual((self.store / "save-1.txt").read_text(encoding="utf-8"), "first")

    def test_source_has_no_delete_move_or_network_use(self):
        source = SERVER.read_text(encoding="utf-8")
        self.assertIsNone(re.search(r"\b(rename\w*|unlink\w*|rm\w*|https?|net|fetch)\b", source))
        self.assertEqual(sorted(re.findall(r'require\("([^"]+)"\)', source)), ["crypto", "fs", "os", "path"])


if __name__ == "__main__":
    unittest.main()
