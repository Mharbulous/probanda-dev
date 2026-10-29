"""inject-practice-quirks.py: the practitioner's notes are injected, the pointer when the config is
out of reach, a note when it cannot be read, and silence when there are none."""
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

HOOK = Path(__file__).resolve().parents[1] / "hooks" / "inject-practice-quirks.py"


def run(config: Path) -> subprocess.CompletedProcess:
    env = {**os.environ, "COCLERK_CONFIG_PATH": str(config)}
    return subprocess.run([sys.executable, str(HOOK)], env=env, capture_output=True, timeout=30)


def context(result: subprocess.CompletedProcess) -> str:
    assert result.returncode == 0
    output = json.loads(result.stdout)
    assert list(output["hookSpecificOutput"]) == ["hookEventName", "additionalContext"]
    assert output["hookSpecificOutput"]["hookEventName"] == "SessionStart"
    return output["hookSpecificOutput"]["additionalContext"]


def config(tmp_path: Path, text: str) -> Path:
    path = tmp_path / "probanda.json"
    path.write_text(text, encoding="utf-8")
    return path


def test_injects_the_notes_between_rules(tmp_path):
    text = context(run(config(tmp_path, json.dumps({"practice_quirks": "Mail routes through iCloud."}))))
    assert text.startswith("Practitioner environment notes: facts about this practitioner's setup")
    assert text.endswith("\n---\nMail routes through iCloud.\n---")


def test_points_to_the_tool_when_the_config_is_out_of_reach(tmp_path):
    text = context(run(tmp_path / "absent" / "probanda.json"))
    assert text.startswith("Practitioner environment notes:")
    assert "Call practice_data__config_status " + "in the same round trip as a skill's first tool call" in text
    assert "before any mail, calendar or file lookup" in text


def test_says_when_the_notes_cannot_be_read(tmp_path):
    assert "is not valid JSON" in context(run(config(tmp_path, "{not json")))
    assert "is not a string" in context(run(config(tmp_path, json.dumps({"practice_quirks": ["a"]}))))


def test_no_output_when_there_are_no_notes(tmp_path):
    for text in ("{}", json.dumps({"practice_quirks": ""}), json.dumps({"practice_quirks": None})):
        result = run(config(tmp_path, text))
        assert result.returncode == 0
        assert result.stdout == b""
