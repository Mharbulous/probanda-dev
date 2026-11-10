"""inject-practice-quirks.py: the index of the practice's quirks is injected, rules first and no bodies, with the
old single note after it until it is migrated; a fact-only note when the config is out of reach or unreadable;
and silence when there are none."""
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


def config(tmp_path: Path, value: dict | str) -> Path:
    path = tmp_path / "probanda.json"
    path.write_text(value if isinstance(value, str) else json.dumps(value), encoding="utf-8")
    return path


def entry(kind: str, title: str, created: str = "2026-11-01", areas=("email",), retired=None, body="A body."):
    return {"id": f"id-{title}", "type": kind, "areas": list(areas), "title": title, "body": body,
            "created_on": created, "last_confirmed_on": created, "retired_on": retired}


def practice(tmp_path: Path, entries: list, **extra) -> Path:
    root = tmp_path / "0. CASE DATA"
    (root / "_practice" / "quirks").mkdir(parents=True)
    (root / "_practice" / "quirks" / "quirks.json").write_text(
        json.dumps({"version": 1, "entries": entries}), encoding="utf-8")
    return config(tmp_path, {"case_data_root": str(root), **extra})


def test_injects_the_index_with_rules_first_and_no_bodies(tmp_path):
    path = practice(tmp_path, [
        entry("knowledge", "A forwarding rule copies the mailbox", "2026-11-02", ("email", "tools")),
        entry("rule", "Never open the main mailbox", "2026-11-03", body="SECRET BODY"),
        entry("rule", "Draft emails as .eml files", "2026-11-01"),
        entry("knowledge", "Retired fact", retired="2026-11-04"),
    ])
    text = context(run(path))
    assert text.startswith("Practice quirks: short entries about how this practice works")
    lines = text.split("\n")[1:]
    assert lines == ["- [rule][email] Draft emails as .eml files",
                     "- [rule][email] Never open the main mailbox",
                     "- [knowledge][email, tools] A forwarding rule copies the mailbox"]
    assert "SECRET BODY" not in text and "Retired fact" not in text


def test_caps_the_index_and_says_how_many_are_not_shown(tmp_path):
    path = practice(tmp_path, [entry("knowledge", f"Fact {n:03d}", f"2026-11-{n % 28 + 1:02d}") for n in range(65)])
    lines = context(run(path)).split("\n")[1:]
    assert len(lines) == 61
    assert lines[-1] == "- 5 more entries are not shown here."


def test_injects_the_old_note_after_the_index_until_it_is_migrated(tmp_path):
    path = practice(tmp_path, [entry("rule", "Never open the main mailbox")], practice_quirks="Mail routes through iCloud.")
    text = context(run(path))
    assert text.index("[rule][email] Never open the main mailbox") < text.index("Practitioner environment notes:")
    assert text.endswith("\n---\nMail routes through iCloud.\n---")
    only_note = context(run(config(tmp_path, {"practice_quirks": "Mail routes through iCloud."})))
    assert "Practitioner environment notes: facts about this practitioner's setup" in only_note
    assert only_note.endswith("\n---\nMail routes through iCloud.\n---")


def test_says_only_that_quirks_are_out_of_reach_when_the_config_is(tmp_path):
    text = context(run(tmp_path / "absent" / "probanda.json"))
    assert text.startswith("This session cannot read the device settings file")
    assert "out of this session's reach" in text
    assert "No quirks are in this context." in text


ASKS = ("call ", "invoke ", "read its", "offer ", "carry on", "copy the", "say once", "ask again")


def test_every_branch_states_facts_only(tmp_path):
    """No branch asks the model to act, names a tool or names a skill (issue #227)."""
    texts = [
        context(run(tmp_path / "absent" / "probanda.json")),
        context(run(practice(tmp_path, [entry("rule", "Never open the main mailbox")], practice_quirks="Old note."))),
        context(run(config(tmp_path, "{not json"))),
        context(run(config(tmp_path, {"practice_quirks": ["a"]}))),
        context(run(config(tmp_path, {"case_data_root": str(tmp_path / "gone"), "practice_quirks": "Old note."}))),
    ]
    for text in texts:
        frame = text.split("\n---\n")[0]
        assert "__" not in frame and "/lawyer:" not in frame, frame
        lowered = frame.lower()
        for ask in ASKS:
            assert ask not in lowered, (ask, frame)


def test_says_when_the_quirks_cannot_be_read(tmp_path):
    assert "is not valid JSON" in context(run(config(tmp_path, "{not json")))
    assert "is not a string" in context(run(config(tmp_path, {"practice_quirks": ["a"]})))
    root = tmp_path / "0. CASE DATA"
    (root / "_practice" / "quirks").mkdir(parents=True)
    (root / "_practice" / "quirks" / "quirks.json").write_text("{not json", encoding="utf-8")
    assert "is malformed" in context(run(config(tmp_path, {"case_data_root": str(root)})))


def test_an_unreachable_practice_folder_still_shows_the_old_note(tmp_path):
    text = context(run(config(tmp_path, {"case_data_root": str(tmp_path / "gone"), "practice_quirks": "Old note."})))
    assert "No quirks are in this context." in text
    assert text.endswith("\n---\nOld note.\n---")


def test_no_output_when_there_are_no_quirks(tmp_path):
    for value in ({}, {"practice_quirks": ""}, {"practice_quirks": None}):
        result = run(config(tmp_path, {"case_data_root": str(tmp_path), **value}))
        assert result.returncode == 0
        assert result.stdout == b""
    result = run(practice(tmp_path, [entry("rule", "Retired rule", retired="2026-11-04")]))
    assert result.stdout == b""
