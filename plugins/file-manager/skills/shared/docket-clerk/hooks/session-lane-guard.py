#!/usr/bin/env python3
"""Keep auditing Probanda's guidance out of drafting sessions.

Hook events: PreToolUse for the drafting skills the model invokes (these enter
the drafting lane) and for rules__audit, and UserPromptSubmit for a drafting
skill the practitioner types as a slash command. rules__audit enters no lane
and is refused in a drafting session.

The lane marker in the temp dir is a cache: when it is missing, as after a session
resumes on another host, the lane is rebuilt from the session transcript.
Fails OPEN on any unexpected error, loudly.
"""
import json
import re
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
import hook_io  # noqa: E402

LANES = {
    "drafting": {"draft", "publish", "polish-substance", "assemble", "prepare", "work"},
}
SLASH_RE = re.compile(r"^\s*/([\w.:-]+)")
COMMAND_RE = re.compile(r"<command-name>/?([\w.:-]+)</command-name>")
AUDIT_TOOL_RE = re.compile(r"(?:^|__)rules__audit$")


def entry(payload):
    """Return (lane, label) for what this event would start; lane is None if neither."""
    if payload.get("hook_event_name") == "UserPromptSubmit":
        match = SLASH_RE.match(payload.get("prompt") or "")
        raw = match.group(1) if match else ""
    elif payload.get("tool_name") == "Skill":
        raw = (payload.get("tool_input") or {}).get("skill") or ""
    else:
        raw = ""
    return skill_lane(raw)


def skill_lane(raw):
    """Return (lane, label) for a skill name, bare or plugin-qualified."""
    name = raw.lstrip("/").split(":")[-1]
    return next((lane for lane, names in LANES.items() if name in names), None), f"/{name}"


def started(label):
    """What started the session's work, in parentheses, only when it is a slash command."""
    return f" ({label})" if label.startswith("/") else ""


def lane_from_transcript(path):
    """Return [lane, label] for the first lane the main session entered, or None."""
    with open(path, encoding="utf-8") as lines:
        for line in lines:
            record = json.loads(line) if line.strip() else {}
            if record.get("isSidechain"):
                continue
            content = (record.get("message") or {}).get("content")
            if record.get("type") == "user":
                texts = [content] if isinstance(content, str) else [
                    part.get("text") or "" for part in content or [] if part.get("type") == "text"]
                for text in texts:
                    match = COMMAND_RE.search(text) or SLASH_RE.match(text)
                    lane, label = skill_lane(match.group(1) if match else "")
                    if lane:
                        return [lane, label]
            elif record.get("type") == "assistant" and isinstance(content, list):
                for part in content:
                    if part.get("type") == "tool_use" and part.get("name") == "Skill":
                        lane, label = skill_lane((part.get("input") or {}).get("skill") or "")
                        if lane:
                            return [lane, label]
    return None


def main():
    payload = hook_io.payload()
    session = re.sub(r"[^\w-]", "", payload.get("session_id") or "")
    if not session:
        return 0
    marker = Path(tempfile.gettempdir()) / f"coclerk-lane-{session}"
    held = marker.read_text(encoding="utf-8").split("\n") if marker.exists() else None
    if held is None and payload.get("transcript_path"):
        held = lane_from_transcript(payload["transcript_path"])
        if held:
            marker.write_text("\n".join(held), encoding="utf-8")
    if AUDIT_TOOL_RE.search(payload.get("tool_name") or ""):
        # The audit shows rules hidden from /draft (rules-DAG spec §4.9); it enters no lane.
        if held and held[0] == "drafting":
            return hook_io.refuse("Blocked: auditing Probanda's guidance is for a review session, never a drafting "
                                  f"session{started(held[1])}. Start a new session for the audit.")
        return 0
    lane, label = entry(payload)
    if lane is not None and held is None:
        marker.write_text(f"{lane}\n{label}", encoding="utf-8")
    return 0


if __name__ == "__main__":
    hook_io.run(main, "session-lane-guard")
