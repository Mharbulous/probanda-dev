#!/usr/bin/env python3
"""Refuse to write an outgoing email whose facts the source-trace review has not read.

Hook event: PreToolUse, matcher drafting_forms__draft_harness | mail__save_draft |
Write | Edit | MultiEdit. Every outgoing letter, email or memo passes
draft/references/source-trace.md before it is delivered: the litigator:source-tracer
agent reads the exact text and checks each fact against its own source. This gate
holds the delivery end of that rule:

- draft_harness step write_email passes only when the session itself (not a
  subagent) has spawned source-tracer with a prompt holding the call's body,
  whitespace aside, and that agent has returned. An empty or whitespace-only body
  states nothing and passes, and so does a subject carrying the word DRAFT in
  capitals, which marks an unchecked draft. Other steps pass.
- mail__save_draft passes only for an .eml a write_email call in this session wrote.
- Write, Edit or MultiEdit of an .eml is refused: shared/email.md's route is the only
  author of one.

The evidence is the harness transcript, which the session being checked cannot
write. The gate cannot see whether each finding was then resolved, or the text of a
letter attached to the email: draft SKILL.md ban 20 holds those. A refusal is quoted
to the practitioner verbatim, so it is in plain words
(shared/internals-confidentiality.md).

Refuses by a JSON permissionDecision on stdout, exit 0; allows by exiting 0
silently. Fails CLOSED on a missing transcript or its own error, as
practitioner-words-gate does.
"""
import re
import sys
from pathlib import Path

try:
    HERE = Path(__file__).resolve()
    # shared/scripts in the built plugin, else in this repo's source tree
    sys.path[:0] = [str(p) for p in (HERE.parents[1] / "skills" / "shared" / "scripts",
                                     HERE.parents[2] / "skills" / "shared" / "scripts") if p.is_dir()]
    import hook_io
    from transcript import practitioner_turns
except Exception as exc:  # a crash would let the call through
    sys.stderr.write(f"Refused: correspondence-review-gate cannot load its helper: {exc!r}\n")
    sys.exit(2)

REVIEWER = "source-tracer"

EMAIL_MESSAGE = (
    "Refused: an email is written only after every fact it states has been checked against its own "
    "source, unless its subject carries the word DRAFT in capitals. Have the facts in this exact text "
    "checked and settle what the check finds, or put DRAFT in the subject, then write the email again."
)
SAVE_MESSAGE = (
    "Refused: only an email written and checked in this session can be put in the Drafts folder. "
    "Write the email here first."
)
HAND_MESSAGE = (
    "Refused: an email file is never written by hand. Write the email through the drafting route, "
    "which checks its facts first."
)
ERROR_MESSAGE = "Refused: the check that this email's facts were reviewed could not run. Try again."


def norm(text):
    return " ".join(text.split())


def path_key(text):
    return text.replace("\\\\", "/").replace("\\", "/").casefold()


def read_transcript(path):
    """(prompts of returned source-tracer calls, texts of returned write_email results), the
    session's own calls only."""
    calls = [call for segment in practitioner_turns(path) for call in segment.calls
             if not call.sidechain and call.result is not None and not call.is_error]
    returned = [call.input.get("prompt") or "" for call in calls if call.name in ("Agent", "Task")
                and str(call.input.get("subagent_type", "")).endswith(REVIEWER)]
    written = [call.result for call in calls if call.name.endswith("drafting_forms__draft_harness")
               and call.input.get("step") == "write_email"]
    return returned, written


def failed(exc):
    sys.stderr.write("correspondence-review-gate hook error: " + type(exc).__name__ + ": " + str(exc) + "\n")
    return hook_io.deny(ERROR_MESSAGE)


def main():
    payload = hook_io.payload()
    name = payload.get("tool_name") or ""
    tool_input = payload.get("tool_input") or {}
    if name in ("Write", "Edit", "MultiEdit"):
        path = str(tool_input.get("file_path") or "")
        return hook_io.deny(HAND_MESSAGE) if path.casefold().endswith(".eml") else 0
    is_write = name.endswith("drafting_forms__draft_harness")
    if is_write and tool_input.get("step") != "write_email":
        return 0
    body = norm(str(tool_input.get("body") or ""))
    if is_write and (not body or re.search(r"\bDRAFT\b", str(tool_input.get("subject") or ""))):
        return 0  # an empty body states nothing to trace; a DRAFT subject marks it unchecked
    transcript = payload.get("transcript_path") or ""
    if not transcript:
        return hook_io.deny(EMAIL_MESSAGE if is_write else SAVE_MESSAGE)
    reviewed, written = read_transcript(transcript)
    if is_write:
        return 0 if any(body in norm(prompt) for prompt in reviewed) else hook_io.deny(EMAIL_MESSAGE)
    target = path_key(str(tool_input.get("eml_path") or ""))
    return 0 if target and any(target in path_key(text) for text in written) else hook_io.deny(SAVE_MESSAGE)


if __name__ == "__main__":
    hook_io.run(main, "correspondence-review-gate", closed=failed)  # fail CLOSED, loudly
