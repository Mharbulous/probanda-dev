"""ceremony-gate.py: no question widget in a session that has opened /timecamping."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / ".claude" / "skills" / "shared" / "tests"))
from hook_runner import run_hook  # noqa: E402

HOOK = Path(__file__).resolve().parent.parent / "hooks" / "ceremony-gate.py"
PLUGIN_JSON = Path(__file__).resolve().parents[1] / "plugin.json"


def skill_call(skill: str, sidechain: bool = False) -> dict:
    return {"type": "assistant", "isSidechain": sidechain, "message": {"content": [
        {"type": "tool_use", "id": "t1", "name": "Skill", "input": {"skill": skill}}]}}


def slash(command: str) -> dict:
    return {"type": "user", "origin": {"kind": "human"}, "message": {"role": "user", "content":
            f"<command-message>{command}</command-message>\n<command-name>/{command}</command-name>"}}


def decision(tmp_path: Path, lines: list | None) -> str | None:
    payload = {"hook_event_name": "PreToolUse", "tool_name": "AskUserQuestion", "tool_input": {}}
    if lines is not None:
        path = tmp_path / "session.jsonl"
        path.write_text("".join(json.dumps(line) + "\n" for line in lines), encoding="utf-8")
        payload["transcript_path"] = str(path)
    result = run_hook(HOOK, payload, text=True)
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout)["hookSpecificOutput"]["permissionDecision"] if result.stdout.strip() else None


@pytest.mark.parametrize("record", [skill_call("timecamping"), skill_call("timekeeper:timecamping"),
                                    slash("timekeeper:timecamping"), slash("timecamping")])
def test_refused_after_timecamping_opens(tmp_path, record):
    assert decision(tmp_path, [record]) == "deny"


def test_allowed_in_other_sessions(tmp_path):
    assert decision(tmp_path, [skill_call("bill-client"), slash("lawyer:show-me")]) is None


def test_subagent_skill_call_does_not_count(tmp_path):
    assert decision(tmp_path, [skill_call("timecamping", sidechain=True)]) is None


def test_missing_transcript_fails_closed(tmp_path):
    assert decision(tmp_path, None) == "deny"


def test_registered_on_the_widget():
    entries = json.loads(PLUGIN_JSON.read_text(encoding="utf-8"))["hooks"]["PreToolUse"]
    matchers = [e["matcher"] for e in entries if any("ceremony-gate.py" in " ".join(h["args"]) for h in e["hooks"])]
    assert matchers == ["^AskUserQuestion$"]
