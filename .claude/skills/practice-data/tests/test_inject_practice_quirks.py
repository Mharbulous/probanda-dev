"""inject-practice-quirks.py: the practitioner's notes are injected, a fact-only note when the config is
out of reach, a note when it cannot be read, and silence when there are none."""
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "shared" / "tests"))
from hook_runner import run_hook  # noqa: E402

HOOK = Path(__file__).resolve().parents[1] / "hooks" / "inject-practice-quirks.py"


def run(config: Path) -> subprocess.CompletedProcess:
    env = {**os.environ, "COCLERK_CONFIG_PATH": str(config)}
    return run_hook(HOOK, env=env)


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


def test_says_only_that_the_notes_are_out_of_reach_when_the_config_is(tmp_path):
    text = context(run(tmp_path / "absent" / "probanda.json"))
    assert text.startswith("Practitioner environment notes:")
    assert "out of this session's reach" in text
    assert "No notes are in this context." in text


ASKS = ("call ", "invoke ", "read its", "offer ", "carry on", "copy the", "say once", "ask again")


def test_every_branch_states_facts_only(tmp_path):
    """No branch asks the model to act, names a tool or names a skill (issue #227)."""
    texts = [
        context(run(tmp_path / "absent" / "probanda.json")),
        context(run(config(tmp_path, json.dumps({"practice_quirks": "Mail routes through iCloud."})))),
        context(run(config(tmp_path, "{not json"))),
        context(run(config(tmp_path, json.dumps({"practice_quirks": ["a"]})))),
    ]
    for text in texts:
        frame = text.split("\n---\n")[0]
        assert "__" not in frame and "/lawyer:" not in frame, frame
        lowered = frame.lower()
        for ask in ASKS:
            assert ask not in lowered, (ask, frame)


def test_says_when_the_notes_cannot_be_read(tmp_path):
    assert "is not valid JSON" in context(run(config(tmp_path, "{not json")))
    assert "is not a string" in context(run(config(tmp_path, json.dumps({"practice_quirks": ["a"]}))))


def test_no_output_when_there_are_no_notes(tmp_path):
    for text in ("{}", json.dumps({"practice_quirks": ""}), json.dumps({"practice_quirks": None})):
        result = run(config(tmp_path, text))
        assert result.returncode == 0
        assert result.stdout == b""
