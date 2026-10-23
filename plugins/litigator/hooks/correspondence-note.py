#!/usr/bin/env python3
"""Tell every session that outgoing correspondence is drafted only through /draft.

Hook event: SessionStart (every source, so the note returns after a compaction).
A request worded as reviewing mail and supplementing an email, or reporting to a
client, did not trigger /draft, and the session wrote the email itself, relaying
other counsel's account as fact. This note routes every letter, email or memo
leaving the firm through /draft, whose source-trace review (draft/references/
source-trace.md) checks each fact before delivery. It lives in litigator because
lawyer may name nothing in litigator. Never blocks: always exits 0.
"""
import json
import sys

NOTE = (
    "Every letter, email or memo that leaves the firm is drafted only through /litigator:draft, "
    "never written in chat or a document: a reply, a report to a client, an email the practitioner "
    "asks you to supplement, add to or fill in from their mail or files. Invoke it before reading "
    "the mail for that purpose. A letter can be used as evidence of what it states, so it states no "
    "fact on another person's say-so: what other counsel or a third party reports is attributed to "
    "them or checked against the primary record."
)

if __name__ == "__main__":
    try:
        print(json.dumps({"hookSpecificOutput": {"hookEventName": "SessionStart", "additionalContext": NOTE}}))
    except Exception as err:  # never block a session start, but say so
        print(f"correspondence-note: {err}", file=sys.stderr)
    sys.exit(0)
