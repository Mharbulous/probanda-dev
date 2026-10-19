#!/usr/bin/env python3
"""Tell every session that a hidden Probanda skill may be installed.

Hook event: SessionStart (every source, so the note returns after a compaction).
A user-invoked skill (disable-model-invocation: true) is left out of the
session's skill list, so a session that checks only that list wrongly tells the
practitioner a skill they name does not exist. Never blocks: always exits 0.
"""
import json
import sys

NOTE = (
    "Some Probanda skills are user-invoked only, so they are installed but absent from "
    "your skill list (for example /lawyer:TLDR). Never tell the practitioner that "
    "a Probanda skill they name does not exist because it is not in your list: tell them "
    "to type it as /<plugin>:<name>, where <plugin> is the Probanda plugin that ships it "
    "(lawyer, researcher, litigator, solicitor, file-manager, timekeeper or developer). A change the practitioner "
    "wants to the plugin goes to /lawyer:suggestion, which posts it only when the "
    "researcher plugin is installed; never edit the installed plugin. Also invoke "
    "/lawyer:suggestion, at most once a session, after a task the practitioner accepted "
    "that took corrections or workarounds, or after stopping because Probanda cannot do "
    "what was needed."
)

if __name__ == "__main__":
    try:
        print(json.dumps({"hookSpecificOutput": {"hookEventName": "SessionStart", "additionalContext": NOTE}}))
    except Exception as err:  # never block a session start, but say so
        print(f"hidden-skills-note: {err}", file=sys.stderr)
    sys.exit(0)
