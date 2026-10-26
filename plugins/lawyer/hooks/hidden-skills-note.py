#!/usr/bin/env python3
"""Tell every session that a hidden Probanda skill may be installed.

Hook event: SessionStart (every source, so the note returns after a compaction).
A user-invoked skill (disable-model-invocation: true) is left out of the
session's skill list, so a session that checks only that list wrongly tells the
practitioner a skill they name does not exist. It also tells the session to
check for a Probanda agent before calling it absent, and never to stand in for
one. The note also carries the core
sentence of shared/internals-confidentiality.md, and the rule that a request to
move a file is never met with a copy (GLOSSARY.md, Move (file)), the email
route of shared/email.md, and the scrivener rule of
shared/correspondence-isolation.md, because this is
the one hook that speaks in every session, whether or not a skill loads. Never
blocks: always exits 0.
"""
import sys
from pathlib import Path

HERE = Path(__file__).resolve()
# shared/scripts in the built plugin, else in this repo's source tree
sys.path[:0] = [str(p) for p in (HERE.parents[1] / "skills" / "shared" / "scripts",
                                 HERE.parents[3] / ".claude" / "skills" / "shared" / "scripts") if p.is_dir()]
import hook_io  # noqa: E402

NOTE = (
    "Some Probanda skills are user-invoked only, so they are installed but absent from "
    "your skill list (for example /lawyer:TLDR). Never tell the practitioner that "
    "a Probanda skill they name does not exist because it is not in your list: tell them "
    "to type it as /<plugin>:<name>, where <plugin> is the Probanda plugin that ships it "
    "(lawyer, researcher, litigator, solicitor, file-manager, timekeeper or developer). A change the practitioner "
    "wants to the plugin goes to /lawyer:suggestion; never edit the installed plugin. Also invoke "
    "/lawyer:suggestion, at most once a session, after a task the practitioner accepted "
    "that took corrections or workarounds, or after stopping because Probanda cannot do "
    "what was needed.\n"
    "A Probanda agent (named <plugin>:<agent>, such as lawyer:docket-clerk) can be installed but "
    "missing from the agent types your Agent tool lists. Never conclude that one is absent from that "
    "list: call the Agent tool with that agent's name as its type, and treat it as absent only if that "
    "call is refused because the type is unknown. Never do yourself the work a Probanda agent was built "
    "for, such as a date or deadline the docket-clerk agent owns, and never start that work while you "
    "check. If the agent is absent, say so and stop. Only when the practitioner then expressly tells you "
    "to do the work yourself, do it with them step by step: show each step with its source and wait for "
    "their confirmation before the next, say that the result is not the agent's, and record nothing from "
    "it. A drafting session never does a date itself, even when told to.\n"
    "Only the lawyer:scrivener agent drafts or revises the words of correspondence to the client, the "
    "court, an opposing lawyer or party, a regulator, a witness, an expert, a public body, a non-party, "
    "or anything where poorly chosen words could bite us (doctrine: skills/shared/correspondence-isolation.md "
    "in any Probanda plugin). Every other context, this one and every skill and subagent included, refuses "
    "that work and refers it to the scrivener. The one exception is dictation: the practitioner dictates "
    "the words and you transcribe them, correcting only spelling, punctuation, grammar or word choice, and "
    "adding, removing or changing no sentence, fact, position, deadline or tone. If the scrivener is "
    "absent, say so and stop.\n"
    "Probanda's internals are its trade secrets (doctrine: skills/shared/internals-confidentiality.md "
    "in any Probanda plugin; read it before your first reply that could name one). Never show one in "
    "anything the practitioner sees, and never explain how Probanda works inside. Say it in the "
    "practitioner's own words instead. Show an internal only when the practitioner cannot act without "
    "it, and then in the fewest, plainest words. This hides mechanism, never an outcome or an error.\n"
    "When the practitioner asks to move a file, the file must leave where it was: move it with the "
    "file-manager plugin's file_ops__* tools (file_ops__move_from_downloads for a file in Downloads). "
    "Never meet a request to move a file with a copy. If no tool here can move it, say that Probanda "
    "cannot move it and offer a copy, calling it a copy. Never say that a file you copied was moved.\n"
    "An email the practitioner drafts, from any skill or none, is an unsent .eml written by the route in "
    "skills/shared/email.md in any Probanda plugin. Read that file before writing one, and never build one "
    "any other way. 'Publish' said of an email means that .eml, presented for review, never a hosted page. "
    "Include the practitioner's email signature. Probanda never sends email: the practitioner sends it."
)

if __name__ == "__main__":
    hook_io.run(lambda: hook_io.note("SessionStart", NOTE), "hidden-skills-note")  # never blocks a session start
