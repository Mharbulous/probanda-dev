"""inject-preferences.py: local injection, the pointer when the file is out of reach, and
silence when there is nothing to apply."""
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

HOOK = Path(__file__).resolve().parent.parent / "inject-preferences.py"


def run(config: Path) -> subprocess.CompletedProcess:
    env = {**os.environ, "COCLERK_CONFIG_PATH": str(config)}
    return subprocess.run([sys.executable, str(HOOK)], env=env, capture_output=True, text=True, timeout=30)


def setup(tmp_path: Path, entries: list | None, person: str | None = "bd") -> Path:
    root = tmp_path / "0. CASE DATA"
    root.mkdir()
    config = tmp_path / "probanda.json"
    config.write_text(json.dumps({"case_data_root": str(root), "person": person}), encoding="utf-8")
    if entries is not None:
        prefs = root / "_practice" / "preferences"
        prefs.mkdir(parents=True)
        (prefs / "bd.json").write_text(json.dumps({"person": "bd", "entries": entries}), encoding="utf-8")
    return config


def entry(skill: str, instruction: str, retired_on: str | None = None) -> dict:
    return {"id": f"id-{skill}", "skill": skill, "instruction": instruction, "created_on": "2026-10-19",
            "retired_on": retired_on, "plugin_version": "0.2.4"}


def context(result: subprocess.CompletedProcess) -> str:
    assert result.returncode == 0
    return json.loads(result.stdout)["hookSpecificOutput"]["additionalContext"]


def test_injects_active_entries_from_the_local_file(tmp_path):
    config = setup(tmp_path, [entry("lawyer:draft", "Use short paragraphs."),
                              entry("lawyer:show-me", "Old habit.", retired_on="2026-10-18")])
    text = context(run(config))
    assert text.startswith("Your saved preferences")
    assert "- lawyer:draft: Use short paragraphs. (created 2026-10-19)" in text
    assert "Old habit." not in text


def test_the_framing_says_to_refuse_a_conflict_by_quoting_the_rule_and_its_date(tmp_path):
    text = context(run(setup(tmp_path, [entry("lawyer:draft", "Use short paragraphs.")])))
    assert "Refuse a request that conflicts with one by quoting it and its date" in text
    assert "on <date> you created the rule, `<the rule>`" in text
    assert "\"Approved\" never adopts it" in text
    assert "created_on date" in context(run(tmp_path / "absent" / "probanda.json"))


def test_points_to_the_tool_when_the_config_is_out_of_reach(tmp_path):
    text = context(run(tmp_path / "absent" / "probanda.json"))
    assert "preferences__read" in text


def test_points_to_the_tool_when_the_case_data_root_is_out_of_reach(tmp_path):
    config = tmp_path / "probanda.json"
    config.write_text(json.dumps({"case_data_root": str(tmp_path / "missing"), "person": "bd"}), encoding="utf-8")
    assert "preferences__read" in context(run(config))


def test_no_output_when_there_are_no_entries(tmp_path):
    for entries in (None, [], [entry("lawyer:draft", "Gone.", retired_on="2026-10-18")]):
        sub = tmp_path / str(len(list(tmp_path.iterdir())))
        sub.mkdir()
        result = run(setup(sub, entries))
        assert result.returncode == 0
        assert result.stdout == ""


def test_no_output_when_person_is_unset(tmp_path):
    result = run(setup(tmp_path, [entry("lawyer:draft", "Use short paragraphs.")], person=None))
    assert result.returncode == 0
    assert result.stdout == ""


def test_a_malformed_file_is_reported_not_raised(tmp_path):
    config = setup(tmp_path, [])
    (tmp_path / "0. CASE DATA" / "_practice" / "preferences" / "bd.json").write_text("{not json", encoding="utf-8")
    assert "could not be read" in context(run(config))
