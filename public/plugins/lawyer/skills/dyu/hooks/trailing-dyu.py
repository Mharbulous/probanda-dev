#!/usr/bin/env python3
"""Load the dyu skill when a message ends with /dyu.

Hook event: UserPromptSubmit. The host runs a typed skill only when its name
starts the message, and the practitioner types /dyu as the last word. When the
prompt ends with /dyu, $dyu or /lawyer:dyu, this prints the skill's text as
context for that turn. Any other prompt prints nothing.
"""
import json
import re
import sys
from pathlib import Path

TRAILING_RE = re.compile(r"(?:^|\s)[/$](?:lawyer:)?dyu[\s.!?]*$", re.IGNORECASE)
SKILL_MD = Path(__file__).resolve().parent.parent / "SKILL.md"
HEADING = "# DYU"
LEAD = ("The user's message ends with /dyu, which invokes the dyu skill. Its text follows. "
        "Follow it for this reply, and do not call the Skill tool for dyu.\n\n")


def main():
    prompt = json.load(sys.stdin).get("prompt") or ""
    if not TRAILING_RE.search(prompt):
        return 0
    text = SKILL_MD.read_text(encoding="utf-8")
    body = text[text.index(HEADING):]
    print(json.dumps({"hookSpecificOutput": {
        "hookEventName": "UserPromptSubmit", "additionalContext": LEAD + body}}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
