#!/usr/bin/env python3
"""Refuse a question widget in a session that has opened /timecamping.

Hook event: PreToolUse, matcher ^AskUserQuestion$. Every /timecamping ceremony is presented by
show-me, whose rule 1 asks each decision in plain text after its evidence and never in a widget.
A session that skipped show-me asked the practitioner about time blocks in a widget, with nothing
shown, so in a session (not a subagent) that has invoked the timecamping skill the widget is refused.
The evidence is the harness transcript, which the session being checked cannot write. A refusal is
quoted to the practitioner, so it is in plain words (shared/internals-confidentiality.md).

Refuses by a JSON permissionDecision on stdout, exit 0; allows by exiting 0 silently. Fails CLOSED
on a missing transcript or its own error.
"""
import sys
from pathlib import Path

try:
    HERE = Path(__file__).resolve()
    # shared/scripts in the built plugin, else in this repo's source tree
    sys.path[:0] = [str(p) for p in (HERE.parents[1] / "skills" / "shared" / "scripts",
                                     HERE.parents[2] / "skills" / "shared" / "scripts") if p.is_dir()]
    import hook_io
    from transcript import records
except Exception as exc:  # a crash would let the call through
    sys.stderr.write(f"Refused: ceremony-gate cannot load its helper: {exc!r}\n")
    sys.exit(2)

SKILLS = ("timecamping", "billing:timecamping")
REFUSAL = ("Refused: a question about time blocks is asked one at a time, in plain text, after the "
           "block's screenshots, the blocks around it and any gaps are shown. Show them, then ask.")


def opened(rec):
    """True when the record opens timecamping: the session's Skill call, or the typed slash command."""
    if rec.get("isSidechain"):
        return False
    content = (rec.get("message") or {}).get("content")
    if rec.get("type") == "user":
        text = content if isinstance(content, str) else " ".join(
            p.get("text") or "" for p in content or [] if isinstance(p, dict))
        return any(f"<command-name>/{name}</command-name>" in text for name in SKILLS)
    return rec.get("type") == "assistant" and any(
        isinstance(p, dict) and p.get("type") == "tool_use" and p.get("name") == "Skill"
        and str((p.get("input") or {}).get("skill", "")).lstrip("/") in SKILLS
        for p in content or [])


def opened_timecamping(path):
    return any(opened(rec) for rec in records(path))


def main():
    transcript = hook_io.payload().get("transcript_path") or ""
    if not transcript or opened_timecamping(transcript):
        return hook_io.deny(REFUSAL)
    return 0


if __name__ == "__main__":
    hook_io.run(main, "ceremony-gate", closed=lambda exc: hook_io.deny(REFUSAL))
