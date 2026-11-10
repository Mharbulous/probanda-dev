#!/usr/bin/env python3
"""Inject this person's saved preferences at the start of every session.

Hook event: SessionStart (every source, so the preferences return after a compaction).
A preference is a standing instruction to one named skill, saved with preferences__write
in <case_data_root>\\_practice\\preferences\\<person>.json. `case_data_root` and `person`
come from the per-user probanda.json, resolved as mcp/src/config-path.ts resolves it:
COCLERK_CONFIG_PATH, else %APPDATA%\\Probanda\\probanda.json, else the legacy
%APPDATA%\\Coclerk\\probanda.json or %APPDATA%\\Coclerk\\coclerk.json. Modelled on inject-practice-quirks.py.

In Cowork the hook runs in the sandbox VM, where probanda.json and the case data folder
are out of reach: the hook then tells the session to read the preferences with the tool.
Never blocks the session: always exits 0.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve()
# shared/scripts in the built plugin, else in this repo's source tree
sys.path[:0] = [str(p) for p in (HERE.parents[1] / "skills" / "shared" / "scripts",
                                 HERE.parents[2] / "skills" / "shared" / "scripts") if p.is_dir()]
import hook_io  # noqa: E402

FRAMING = (
    "Your saved preferences: standing instructions (Rules) this person asked Probanda to follow, "
    "each with the date they created it. Apply each one when its skill runs. They never loosen a "
    "verification, approval or privilege rule. Refuse a request that conflicts with one by quoting it "
    "and its date: \"I cannot do X because on <date> you created the rule, `<the rule>`. If you want me "
    "to do X you must first change or remove that rule.\" A Rule changes only in the person's own words: "
    "show proposed wording in a code block and ask them to paste it into chat, since \"Approved\" never "
    "adopts it. Retire one with preferences__write only when they ask to remove or replace it."
)
POINTER = (
    "This person may have saved preferences for Probanda skills, stored out of this session's "
    "reach. Call preferences__read in the same round trip as a skill's first tool call, or after its "
    "card, and before any job work, and apply each entry "
    "when its skill runs. An entry's skill is the plugin the skill ships in, a colon, then the skill "
    "name, as in lawyer:show-me. Each entry is a Rule: refuse a request that conflicts with one by quoting "
    "it and its created_on date. When the call fails with person_unset or finds no entries, carry on "
    "without them."
)


def context() -> str | None:
    path = hook_io.config_path()
    if not path.is_file():
        return POINTER
    try:
        config = json.loads(path.read_text(encoding="utf-8"))
        root, person = config.get("case_data_root"), config.get("person")
    except (OSError, ValueError, AttributeError) as err:
        return f"Saved preferences could not be read: {path} is not valid JSON ({err})."
    if not person:
        return None
    if not isinstance(root, str) or not root or not Path(root).is_dir():
        return POINTER
    prefs = Path(root) / "_practice" / "preferences" / f"{person}.json"
    if not prefs.is_file():
        return None
    try:
        entries = json.loads(prefs.read_text(encoding="utf-8"))["entries"]
        active = [entry for entry in entries if entry.get("retired_on") is None]
        lines = [f"- {entry['skill']}: {entry['instruction']} (created {entry['created_on']})" for entry in active]
    except (OSError, ValueError, KeyError, TypeError, AttributeError) as err:
        return f"Saved preferences could not be read: {prefs} is malformed ({err!r})."
    if not lines:
        return None
    return FRAMING + "\n" + "\n".join(lines)


def main() -> None:
    text = context()
    if text:
        hook_io.note("SessionStart", text)


if __name__ == "__main__":
    hook_io.run(main, "inject-preferences")  # never blocks a session start
