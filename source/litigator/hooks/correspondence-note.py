#!/usr/bin/env python3
"""Tell every session that /draft is the route for outgoing correspondence and the scrivener writes its words.

Hook event: SessionStart (every source, so the note returns after a compaction).
A request worded as reviewing mail and supplementing an email, or reporting to a
client, did not trigger /draft, and the session wrote the email itself, relaying
other counsel's account as fact. This note routes every letter, email or memo
leaving the firm through /draft for the document, and to lawyer:scrivener for its
words (shared/correspondence-isolation.md); /draft's source-trace review (draft/
references/source-trace.md) checks each fact before delivery. It lives in litigator because
lawyer may name nothing in litigator. Never blocks: always exits 0.
"""
import sys
from pathlib import Path

HERE = Path(__file__).resolve()
# shared/scripts in the built plugin, else in this repo's source tree
sys.path[:0] = [str(p) for p in (HERE.parents[1] / "skills" / "shared" / "scripts",
                                 HERE.parents[2] / "skills" / "shared" / "scripts") if p.is_dir()]
import hook_io  # noqa: E402

NOTE = (
    "Every letter, email or memo that leaves the firm goes through /litigator:draft, never written in "
    "chat or a document: a reply, a report to a client, an email the practitioner asks you to supplement, "
    "add to or fill in from their mail or files. /litigator:draft is the route for the document: its type, "
    "layout, recipients, saving, review and the unsent .eml. The lawyer:scrivener agent writes its words "
    "(skills/shared/correspondence-isolation.md), and /litigator:draft places them verbatim; only the "
    "practitioner's dictation is transcribed instead. Invoke /litigator:draft before reading the mail for "
    "that purpose. An email is never drafted in chat: it is written as an unsent .eml file and shown as a "
    "file card before any other drafting work. A letter can be used as evidence of what it states, so the "
    "fact-to-source review checks the scrivener's exact text before it is shown."
)

if __name__ == "__main__":
    hook_io.run(lambda: hook_io.note("SessionStart", NOTE), "correspondence-note")  # never blocks a session start
