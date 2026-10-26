#!/usr/bin/env python3
"""Raise an AI-noticed suggestion card at the next reply in which the session would otherwise wait
for the practitioner (docs/Plans/2026-10-25_suggestion-design.md, decisions 2 to 5; lifecycle plan
Phase 5).

Hook event: Stop. The suggestion store, ${CLAUDE_PLUGIN_DATA}/suggestions/suggestions.json, holds the
observations Probanda recorded about its own work (records of kind "observation") and, in its
`ai_noticed` field, the last answer the lawyer data server reached about raising one
(source/lawyer/mcp/src/suggestions/observation.ts). The daily cap and the suppression are decided
there, and only there: this hook never decides eligibility. It blocks the end of the reply, once,
telling the session to run /lawyer:suggestion's AI-noticed card, when

- the store holds an observation that has not been shown, and
- the answer is stale: there is none yet, or it was reached for another session or before the newest
  observation, or it named an observation to raise, or the time it holds good until has passed.

So it asks at most once per session for the same observations, and not again on a day the cap was
reached, until the next local midnight. The data server's build checks the cap and suppression
again, in the write that marks the observation shown.

Never blocks when stop_hook_active is set, so it never blocks twice in a row. Needs no Cowork tool:
the session shows the card with whichever file-card route it has. Reads the store only, through no
lock (the server writes it whole, by temp file and rename). Fails OPEN on its own error, loudly on
stderr, so a bug here never traps a session.
"""
from __future__ import annotations

import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve()
# shared/scripts in the built plugin, else in this repo's source tree
sys.path[:0] = [str(p) for p in (HERE.parents[1] / "skills" / "shared" / "scripts",
                                 HERE.parents[3] / ".claude" / "skills" / "shared" / "scripts") if p.is_dir()]
import hook_io  # noqa: E402

# The session ids the data server takes (observation.ts, sessionIdOf).
SESSION_ID = re.compile(r"[A-Za-z0-9_-]{1,128}")

RAISE = (
    "Before ending this reply: Probanda noticed something about its own work that may become a "
    "suggestion card. Invoke /lawyer:suggestion and follow its section on a card Probanda noticed, "
    "with this session id: {session_id}. Write nothing in chat about it, before or after: show only "
    "the card, or end the reply with nothing more if no card is built."
)


def store_path() -> Path | None:
    data = os.environ.get("CLAUDE_PLUGIN_DATA", "")
    # An unsubstituted "${CLAUDE_PLUGIN_DATA}" from a host that does not know the variable is unset too.
    if not data or "${" in data or not Path(data).is_absolute():
        return None
    return Path(data) / "suggestions" / "suggestions.json"


def parse_time(value) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        when = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return when if when.tzinfo else when.replace(tzinfo=timezone.utc)


def should_raise(store: dict, session_id: str, now: datetime) -> bool:
    records = store.get("records") if isinstance(store, dict) else None
    if not isinstance(records, list):
        return False
    observations = [r for r in records if isinstance(r, dict) and r.get("kind") == "observation"]
    if not any(r.get("displayed_at") is None for r in observations):
        return False
    latest = observations[-1].get("record_id")
    answer = store.get("ai_noticed")
    if not isinstance(answer, dict) or answer.get("latest_observation") != latest:
        return True
    if answer.get("session_id") == session_id:
        return False  # this session was already asked about these observations
    if answer.get("next") is not None:
        return True
    until = parse_time(answer.get("recheck_at"))
    return until is None or now >= until


def stop(payload: dict, now: datetime | None = None) -> int:
    if payload.get("stop_hook_active"):
        return 0
    session_id = payload.get("session_id")
    if not isinstance(session_id, str) or not SESSION_ID.fullmatch(session_id):
        return 0
    path = store_path()
    if path is None or not path.is_file():
        return 0
    store = json.loads(path.read_text(encoding="utf-8"))
    if should_raise(store, session_id, now or datetime.now(timezone.utc)):
        sys.stdout.write(json.dumps({"decision": "block", "reason": RAISE.format(session_id=session_id)}) + "\n")
    return 0


def main() -> int:
    payload = hook_io.payload()
    if payload.get("hook_event_name", "Stop") != "Stop":
        return 0
    return stop(payload)


if __name__ == "__main__":
    hook_io.run(main, "ai-noticed-card")
