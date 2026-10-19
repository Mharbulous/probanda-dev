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
import os
import sys
from pathlib import Path

FRAMING = (
    "Your saved preferences: standing instructions this person asked Probanda to follow. "
    "Apply each one when its skill runs. They never loosen a verification, approval or "
    "privilege rule. To stop one, retire it with preferences__write."
)
POINTER = (
    "This person may have saved preferences for Probanda skills, stored out of this session's "
    "reach. Before the first Probanda skill runs, call preferences__read and apply each entry "
    "when its skill runs. When the call fails with person_unset or finds no entries, carry on "
    "without them."
)


def config_path() -> Path:
    override = os.environ.get("COCLERK_CONFIG_PATH")
    if override:
        return Path(override)
    appdata = os.environ.get("APPDATA") or str(Path.home() / "AppData" / "Roaming")
    candidates = [
        Path(appdata) / "Probanda" / "probanda.json",
        Path(appdata) / "Coclerk" / "probanda.json",
        Path(appdata) / "Coclerk" / "coclerk.json",
    ]
    return next((path for path in candidates if path.is_file()), candidates[0])


def context() -> str | None:
    path = config_path()
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
        lines = [f"- {entry['skill']}: {entry['instruction']}" for entry in active]
    except (OSError, ValueError, KeyError, TypeError, AttributeError) as err:
        return f"Saved preferences could not be read: {prefs} is malformed ({err!r})."
    if not lines:
        return None
    return FRAMING + "\n" + "\n".join(lines)


def main() -> None:
    text = context()
    if text:
        print(json.dumps({"hookSpecificOutput": {"hookEventName": "SessionStart", "additionalContext": text}}))


if __name__ == "__main__":
    try:
        main()
    except Exception as err:  # never block a session start, but say so
        print(f"inject-preferences: {err}", file=sys.stderr)
    sys.exit(0)
