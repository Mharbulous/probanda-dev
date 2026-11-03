"""ai-noticed-card.py: the Stop hook raises the AI-noticed card when the suggestion store holds an
observation not yet shown and the data server's answer is stale; it stays silent under
stop_hook_active, under the daily cap and under suppression (both decided by the server's answer),
and for a session already asked. Run in Claude Code's shape, with no Cowork tool anywhere.

Runnable as `python3 test_ai_noticed_card.py` (unittest) or under pytest."""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / ".claude" / "skills" / "shared" / "tests"))
from hook_runner import run_hook  # noqa: E402

HOOK = Path(__file__).resolve().parent.parent / "hooks" / "ai-noticed-card.py"
MCP = Path(__file__).resolve().parent.parent / "mcp"
SESSION = "5f0c2a9e-7b1d-4e3a-9c8b-2d6e1f4a7b30"
OTHER = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d"


def observation(record_id: str, displayed: bool = False) -> dict:
    return {
        "kind": "observation", "record_id": record_id, "created_at": "2026-10-26T17:00:00.000Z",
        "fingerprint": {"plugin": "litigator", "version": "0.5.0", "skill": "draft", "kind": "tool_error"},
        "observation": {"kind": "tool_error", "tool": "plugin_lawyer_data__drafting_data__query", "error_code": "not_found"},
        "raw_observation": ["A Probanda tool returned an error.", "Tool: plugin_lawyer_data__drafting_data__query", "Error code: not_found"],
        "displayed_at": "2026-10-26T17:05:00.000Z" if displayed else None, "card_id": "c1" if displayed else None,
    }


def iso(when: datetime) -> str:
    return when.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


class AiNoticedCardHook(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp(prefix="ai-noticed-"))
        self.config = self.dir / "device" / "probanda.json"
        self.store = self.config.parent / "suggestions" / "suggestions.json"
        self.store.parent.mkdir(parents=True)
        self.config.write_text("{}", encoding="utf-8")

    def tearDown(self):
        shutil.rmtree(self.dir, ignore_errors=True)

    def write(self, records, answer=None):
        store = {"version": 1, "migrated_log": None, "records": records}
        if answer is not None:
            store["ai_noticed"] = answer
        self.store.write_text(json.dumps(store), encoding="utf-8")

    def run_hook(self, payload=None):
        # Claude Code's Stop payload: no Cowork tool or bridge is named anywhere.
        body = {"session_id": SESSION, "transcript_path": str(self.dir / "transcript.jsonl"), "cwd": str(self.dir),
                "permission_mode": "default", "hook_event_name": "Stop", "stop_hook_active": False}
        body.update(payload or {})
        env = dict(os.environ, COCLERK_CONFIG_PATH=str(self.config))
        result = run_hook(HOOK, json.dumps(body), env=env, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stderr, "")
        return result.stdout

    def assert_raised(self, out):
        decision = json.loads(out)
        self.assertEqual(decision["decision"], "block")
        reason = decision["reason"]
        self.assertIn("/lawyer:suggestion", reason)
        self.assertIn(SESSION, reason)
        self.assertIn("Write nothing in chat", reason)
        for cowork in ("present_files", "SendUserFile", "cowork", "device_"):
            self.assertNotIn(cowork, reason, "the hook needs no Cowork tool")

    def test_an_observation_not_yet_shown_raises_the_card_in_claude_code(self):
        self.write([observation("o1")])
        self.assert_raised(self.run_hook())

    def test_stop_hook_active_never_raises(self):
        self.write([observation("o1")])
        self.assertEqual(self.run_hook({"stop_hook_active": True}), "")

    def test_nothing_to_raise_when_every_observation_was_shown_or_there_is_none(self):
        self.write([observation("o1", displayed=True)])
        self.assertEqual(self.run_hook(), "")
        self.write([])
        self.assertEqual(self.run_hook(), "")
        self.store.unlink()
        self.assertEqual(self.run_hook(), "")

    def test_the_daily_cap_keeps_it_silent_until_the_answer_runs_out(self):
        now = datetime.now(timezone.utc)
        capped = {"checked_at": iso(now), "session_id": OTHER, "next": None, "latest_observation": "o2",
                  "recheck_at": iso(now + timedelta(hours=3))}
        self.write([observation("o1", displayed=True), observation("o2")], capped)
        self.assertEqual(self.run_hook(), "", "another session reached the cap today")
        capped["recheck_at"] = iso(now - timedelta(minutes=1))
        self.write([observation("o1", displayed=True), observation("o2")], capped)
        self.assert_raised(self.run_hook())

    def test_suppression_keeps_it_silent_and_a_session_is_asked_once(self):
        now = datetime.now(timezone.utc)
        suppressed = {"checked_at": iso(now), "session_id": OTHER, "next": None, "latest_observation": "o1",
                      "recheck_at": iso(now + timedelta(hours=5))}
        self.write([observation("o1")], suppressed)
        self.assertEqual(self.run_hook(), "", "the server found the fingerprint suppressed")
        asked = dict(suppressed, session_id=SESSION, next="o1", recheck_at=None)
        self.write([observation("o1")], asked)
        self.assertEqual(self.run_hook(), "", "this session was already asked about these observations")
        self.write([observation("o1"), observation("o2")], asked)
        self.assert_raised(self.run_hook())

    def test_an_answer_that_named_an_observation_for_another_session_raises(self):
        answer = {"checked_at": iso(datetime.now(timezone.utc)), "session_id": OTHER, "next": "o1",
                  "latest_observation": "o1", "recheck_at": None}
        self.write([observation("o1")], answer)
        self.assert_raised(self.run_hook())

    def test_a_payload_with_no_valid_session_id_raises_nothing(self):
        self.write([observation("o1")])
        self.assertEqual(self.run_hook({"session_id": "not a session id"}), "")

    @unittest.skipUnless(shutil.which("node") and (MCP / "build" / "suggestions" / "observation.js").is_file(),
                         "needs node and the data server's build")
    def test_the_hook_follows_the_answer_the_data_server_writes(self):
        script = self.dir / "drive.mjs"
        build = (MCP / "build" / "suggestions" / "observation.js").as_uri()
        script.write_text(
            f"const obs = await import({json.dumps(build)});\n"
            "const seams = { plugins: () => [{ plugin: 'litigator', version: '0.5.0', skills: ['draft'] }], texts: () => new Map() };\n"
            "const [op, session] = process.argv.slice(2);\n"
            "const out = op === 'record'\n"
            "  ? await obs.recordObservation({ kind: 'tool_error', skill: 'draft', tool: 'drafting_data__query', error_code: 'not_found' }, process.env, seams)\n"
            "  : await obs.nextObservation({ session_id: session }, process.env, seams);\n"
            "process.stdout.write(JSON.stringify(out));\n", encoding="utf-8")
        env = dict(os.environ, COCLERK_CONFIG_PATH=str(self.config))

        def node(*args):
            done = subprocess.run(["node", str(script), *args], env=env, capture_output=True, text=True, timeout=60)
            self.assertEqual(done.returncode, 0, done.stderr)
            return json.loads(done.stdout)

        self.assertTrue(node("record")["recorded"])
        self.assert_raised(self.run_hook())
        self.assertIsNotNone(node("next", SESSION)["observation"])
        self.assertEqual(self.run_hook(), "", "asked once in this session")


if __name__ == "__main__":
    unittest.main()
