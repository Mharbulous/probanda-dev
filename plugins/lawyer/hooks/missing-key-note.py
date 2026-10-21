#!/usr/bin/env python3
"""Say once, at the start of a session, that this computer holds no Probanda key.

Hook event: SessionStart, matched to startup and clear only, so the notice is not
repeated after a compaction or on resume. Posting a suggestion needs Probanda's key,
so a complaint raised in a key-less session would otherwise be lost
(docs/Specs/2026-10-20_missing-probanda-key-at-session-start-spec.md).

The key is the file source/mcp-shared/commons-key.js reads: credential.json.dpapi in
%LOCALAPPDATA%\\Coclerk\\legal-commons (else %APPDATA%, else the home folder), unless
LEGAL_COMMONS_SUPABASE_KEY or SUPABASE_SERVICE_ROLE_KEY is set. Only whether the
file exists is checked: the hook never opens it and never reads a key's value.
Outside Windows (Cowork's VM) the file is out of reach, so the hook tells the
session to ask practice_data__config_status instead.

With the key present, the hook names any suggestions held unposted in
suggestions.local.json beside probanda.json (resolved as inject-preferences.py does),
so they are shown to the practitioner and posted. Never blocks: always exits 0.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

TELL = (
    "Early in this session, before other Probanda work, tell the practitioner once, in this one "
    "sentence: \"This computer has no Probanda key yet, so suggestions to the Probanda team and "
    "changes to practice records cannot be saved; I can ask Probanda for one now.\" Do not repeat it "
    "later in the session. On their yes, follow the key-request route in the practice-data skill, "
    "Configuration, \"Probanda's key\" (key_request__submit). Never ask for the key in chat. A complaint "
    "about Probanda raised before the key is stored goes to /lawyer:suggestion, which holds it on this "
    "computer. Once the key is stored, invoke /lawyer:suggestion to show each held suggestion before "
    "posting it."
)
MISSING = "This computer holds no Probanda key. " + TELL
UNSEEN = (
    "This session cannot see whether this computer holds Probanda's key. Call "
    "practice_data__config_status once. If it reports cloud_credential: missing: " + TELL
)
HELD = (
    "This computer holds {count} suggestion(s) to the Probanda team, drafted while it had no Probanda "
    "key. Invoke /lawyer:suggestion to show each to the practitioner exactly as drafted, and post one "
    "only on their yes."
)


def key_present() -> bool | None:
    """True or False when the key's file is in reach, None when it is not."""
    if os.environ.get("LEGAL_COMMONS_SUPABASE_KEY") or os.environ.get("SUPABASE_SERVICE_ROLE_KEY"):
        return True
    if sys.platform != "win32":
        return None
    root = os.environ.get("LOCALAPPDATA") or os.environ.get("APPDATA") or str(Path.home())
    return (Path(root) / "Coclerk" / "legal-commons" / "credential.json.dpapi").is_file()


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


def held_count() -> int:
    log = config_path().parent / "suggestions.local.json"
    if not log.is_file():
        return 0
    return len(json.loads(log.read_text(encoding="utf-8")).get("held", []))


def context() -> str | None:
    present = key_present()
    if present is None:
        return UNSEEN
    if not present:
        return MISSING
    count = held_count()
    return HELD.format(count=count) if count else None


def main() -> None:
    text = context()
    if text:
        print(json.dumps({"hookSpecificOutput": {"hookEventName": "SessionStart", "additionalContext": text}}))


if __name__ == "__main__":
    try:
        main()
    except Exception as err:  # never block a session start, but say so
        print(f"missing-key-note: {err}", file=sys.stderr)
    sys.exit(0)
