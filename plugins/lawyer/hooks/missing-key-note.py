#!/usr/bin/env python3
"""Say once, at the start of a session, that this computer holds no Probanda key.

Hook event: SessionStart, matched to startup and clear only, so the notice is not
repeated after a compaction or on resume. Posting a suggestion needs Probanda's key,
so a complaint raised in a key-less session would otherwise be lost
(docs/Specs/2026-10-20_missing-probanda-key-at-session-start-spec.md).

The key is the Windows Credential Manager entry source/mcp-shared/commons-key.js
reads, the generic credential Probanda/cloud-key, unless LEGAL_COMMONS_SUPABASE_KEY
or SUPABASE_SERVICE_ROLE_KEY is set. Only whether the entry exists is checked: the
hook frees the handle at once and never decodes, keeps or prints a key's value.
Tests set PROBANDA_CLOUD_KEY_TARGET to look up another target instead.
A key an earlier version saved as a file is moved into the entry by the first
server read, so before that read the hook may still say the key is missing.
Outside Windows (Cowork's VM) the store is out of reach, so the hook tells the
session to ask practice_data__config_status instead.

With the key present, the hook names any suggestions held unposted, so each is
offered once as a suggestion card. Nothing is held any more: a suggestion submitted
from its card with no key is kept unsent and sent by the data server once the key is
stored. The held drafts are the held records of the lawyer data
server's suggestion store, suggestions/suggestions.json beside probanda.json
(source/lawyer/mcp/src/suggestions/store.ts), plus, until that store has read it,
those of the old suggestions.local.json beside probanda.json (resolved as
inject-preferences.py does). Never blocks: always exits 0.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve()
# shared/scripts in the built plugin, else in this repo's source tree
sys.path[:0] = [str(p) for p in (HERE.parents[1] / "skills" / "shared" / "scripts",
                                 HERE.parents[3] / ".claude" / "skills" / "shared" / "scripts") if p.is_dir()]
import hook_io  # noqa: E402

TELL = (
    "Early in this session, before other Probanda work, tell the practitioner once, in this one "
    "sentence: \"This computer has no Probanda key yet, so suggestions to the Probanda team cannot be "
    "sent and changes to practice records cannot be saved; I can ask Probanda for one now.\" Do not repeat it "
    "later in the session. On their yes, follow the key-request route in the practice-data skill, "
    "operations/credentials.md, \"Probanda's key\" (key_request__submit). Never ask for the key in chat. A complaint "
    "about Probanda raised before the key is stored still goes to /lawyer:suggestion: once the "
    "practitioner submits its card, the suggestion is kept on this computer and sent by itself after "
    "the key is stored."
)
MISSING = "This computer holds no Probanda key. " + TELL
UNSEEN = (
    "This session cannot see whether this computer holds Probanda's key. Call "
    "practice_data__config_status once. If it reports cloud_credential: missing: " + TELL
)
HELD = (
    "This computer holds {count} suggestion(s) to the Probanda team, drafted while it had no Probanda "
    "key, before suggestions were shown as cards. Invoke /lawyer:suggestion to offer each once as a "
    "card; one is sent only if the practitioner submits its card."
)


CLOUD_KEY_TARGET = "Probanda/cloud-key"
CRED_TYPE_GENERIC = 1
ERROR_NOT_FOUND = 1168


def key_present() -> bool | None:
    """True or False when Credential Manager is in reach, None when it is not."""
    if os.environ.get("LEGAL_COMMONS_SUPABASE_KEY") or os.environ.get("SUPABASE_SERVICE_ROLE_KEY"):
        return True
    if sys.platform != "win32":
        return None
    import ctypes

    advapi32 = ctypes.windll.advapi32
    handle = ctypes.c_void_p()
    target = os.environ.get("PROBANDA_CLOUD_KEY_TARGET", CLOUD_KEY_TARGET)
    if advapi32.CredReadW(target, CRED_TYPE_GENERIC, 0, ctypes.byref(handle)):
        advapi32.CredFree(handle)
        return True
    return False if ctypes.GetLastError() == ERROR_NOT_FOUND else None


def held_count() -> int:
    count = 0
    migrated = False
    store = hook_io.config_path().parent / "suggestions" / "suggestions.json"
    if store.is_file():
        stored = json.loads(store.read_text(encoding="utf-8"))
        count += sum(1 for record in stored.get("records", []) if record.get("kind") == "held")
        migrated = bool(stored.get("migrated_log"))
    if not migrated:
        log = hook_io.config_path().parent / "suggestions.local.json"
        if log.is_file():
            count += len(json.loads(log.read_text(encoding="utf-8")).get("held", []))
    return count


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
        hook_io.note("SessionStart", text)


if __name__ == "__main__":
    hook_io.run(main, "missing-key-note")  # never blocks a session start
