#!/usr/bin/env python3
"""Keep drafting and deadline work in separate sessions.

Hook events: PreToolUse for the drafting skills the model invokes (these enter
the drafting lane) and for the deadline-bearing practice-data tools (these enter
the deadline lane), and UserPromptSubmit for a drafting skill the practitioner
types as a slash command. No skill enters the deadline lane: date work runs only
through the legal:docket-clerk agent. The first lane a session enters locks
the other lane out for the rest of that session. rules__audit enters no lane
and is refused in a drafting session.

One exception: the legal:docket-clerk agent may call the deadline tools in
a drafting session. SubagentStart tells it its mode (recorded-only in the
drafting lane, full otherwise, and a fresh session enters the deadline lane),
and SubagentStop refuses a drafting-lane return that carries a date or a duration.
Policy: .claude/skills/shared/deadline-isolation.md. Fails OPEN on any unexpected
error, loudly.
"""
import json
import re
import sys
import tempfile
from pathlib import Path

LANES = {
    "drafting": {"draft", "publish", "polish-substance", "assemble", "prepare"},
}
SLASH_RE = re.compile(r"^\s*/([\w.:-]+)")
DEADLINE_TOOL_RE = re.compile(
    r"(?:^|__)(practice_data__(?:active_deadlines|open_tasks|upsert_deadline|upsert_anchor|delete_anchor|rule_overlay|upsert_rule_overlay|render_practice_board))$")
AUDIT_TOOL_RE = re.compile(r"(?:^|__)rules__audit$")
AGENT = "legal:docket-clerk"
MONTH = r"(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)"
DATE_RE = re.compile(
    r"\d{4}-\d{2}-\d{2}"
    r"|\d{1,2}/\d{1,2}/\d{2,4}"
    rf"|\b{MONTH}\.?\s+\d|\d(?:st|nd|rd|th)?\s+{MONTH}\b"
    r"|\d+\s+(?:business\s+|calendar\s+|clear\s+)?(?:days?|weeks?|months?)\b",
    re.IGNORECASE)
STOP_REASON = ("Drafting lane: return only the recorded-only lines (recorded N anchors, M deadlines; "
               "K items need a deadline session; freshness not verified), or the three decline lines "
               "(status: declined; reason: recorded-only mode: drafting session; route: the prompt "
               "for a non-drafting session, with every date and duration as a bracketed placeholder). "
               "No date, no day count.")


def entry(payload):
    """Return (lane, label) for what this event would start; lane is None if neither."""
    tool = DEADLINE_TOOL_RE.search(payload.get("tool_name") or "")
    if tool:
        return "deadline", tool.group(1)
    if payload.get("hook_event_name") == "UserPromptSubmit":
        match = SLASH_RE.match(payload.get("prompt") or "")
        raw = match.group(1) if match else ""
    elif payload.get("tool_name") == "Skill":
        raw = (payload.get("tool_input") or {}).get("skill") or ""
    else:
        raw = ""
    name = raw.lstrip("/").split(":")[-1]
    return next((lane for lane, names in LANES.items() if name in names), None), f"/{name}"


def subagent_start(marker, held):
    """Tell the docket-clerk agent its mode; a fresh session enters the deadline lane."""
    if held is None:
        marker.write_text(f"deadline\n{AGENT}", encoding="utf-8")
    context = "LANE: drafting. Recorded-only mode." if held and held[0] == "drafting" else "LANE: open. Full mode."
    print(json.dumps({"hookSpecificOutput": {"hookEventName": "SubagentStart", "additionalContext": context}}))
    return 0


def subagent_stop(payload, held):
    """Refuse a drafting-lane return that carries a date or a duration."""
    if held and held[0] == "drafting" and DATE_RE.search(payload.get("last_assistant_message") or ""):
        print(json.dumps({"decision": "block", "reason": STOP_REASON}))
    return 0


def main():
    payload = json.load(sys.stdin)
    session = re.sub(r"[^\w-]", "", payload.get("session_id") or "")
    if not session:
        return 0
    marker = Path(tempfile.gettempdir()) / f"coclerk-lane-{session}"
    held = marker.read_text(encoding="utf-8").split("\n") if marker.exists() else None
    event = payload.get("hook_event_name")
    if event == "SubagentStart":
        return subagent_start(marker, held)
    if event == "SubagentStop":
        return subagent_stop(payload, held)
    if AUDIT_TOOL_RE.search(payload.get("tool_name") or ""):
        # The audit shows rules hidden from /draft (rules-DAG spec §4.9); it enters no lane.
        if held and held[0] == "drafting":
            sys.stderr.write("Blocked: rules__audit is for review and testing sessions, never a drafting "
                             f"session ({held[1]}). Start a new session to audit the rules.\n")
            return 2
        return 0
    lane, label = entry(payload)
    if lane is None:
        return 0
    if (held and held[0] == "drafting" and DEADLINE_TOOL_RE.search(payload.get("tool_name") or "")
            and payload.get("agent_id") and payload.get("agent_type") == AGENT):
        return 0
    if held is None:
        marker.write_text(f"{lane}\n{label}", encoding="utf-8")
        return 0
    if held[0] == lane:
        return 0
    sys.stderr.write(
        f"Blocked: this session has already entered the {held[0]} lane ({held[1]}). Drafting and "
        "deadline work stay in separate sessions so a draft is never shaped by a known "
        f"deadline. Start a new session for {label}.\n"
    )
    return 2


if __name__ == "__main__":
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except Exception as exc:  # fail OPEN, loudly
        sys.stderr.write(f"session-lane-guard hook error (allowing): {type(exc).__name__}: {exc}\n")
        sys.exit(0)
