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
  states nothing and passes. Other steps pass.
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
import json
import sys

REVIEWER = "source-tracer"

EMAIL_MESSAGE = (
    "Refused: an email is written only after every fact it states has been checked against its own "
    "source. Have the facts in this exact text checked, settle what the check finds, then write the "
    "email again with the same text."
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


def result_text(content):
    if isinstance(content, list):
        return "\n".join(p.get("text", "") for p in content if isinstance(p, dict))
    return content if isinstance(content, str) else ""


def read_transcript(path):
    """(prompts of returned source-tracer calls, texts of returned write_email results), the
    session's own calls only."""
    reviews, writes, results = {}, {}, {}
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            try:
                rec = json.loads(line)
            except ValueError:
                continue  # a line the harness is still writing
            if rec.get("isSidechain"):
                continue
            content = (rec.get("message") or {}).get("content")
            parts = [p for p in content if isinstance(p, dict)] if isinstance(content, list) else []
            for part in parts:
                if part.get("type") == "tool_use":
                    name = part.get("name") or ""
                    tool_input = part.get("input") or {}
                    if name in ("Agent", "Task") and str(tool_input.get("subagent_type", "")).endswith(REVIEWER):
                        reviews[part.get("id")] = tool_input.get("prompt") or ""
                    elif name.endswith("drafting_forms__draft_harness") and tool_input.get("step") == "write_email":
                        writes[part.get("id")] = True
                elif part.get("type") == "tool_result" and not part.get("is_error"):
                    results[part.get("tool_use_id")] = result_text(part.get("content"))
    returned = [prompt for use_id, prompt in reviews.items() if use_id in results]
    written = [results[use_id] for use_id in writes if use_id in results]
    return returned, written


def deny(message):
    sys.stdout.write(json.dumps({"hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": "deny",
        "permissionDecisionReason": message,
    }}) + "\n")
    return 0


def main():
    payload = json.load(sys.stdin)
    name = payload.get("tool_name") or ""
    tool_input = payload.get("tool_input") or {}
    if name in ("Write", "Edit", "MultiEdit"):
        path = str(tool_input.get("file_path") or "")
        return deny(HAND_MESSAGE) if path.casefold().endswith(".eml") else 0
    is_write = name.endswith("drafting_forms__draft_harness")
    if is_write and tool_input.get("step") != "write_email":
        return 0
    body = norm(str(tool_input.get("body") or ""))
    if is_write and not body:
        return 0  # an empty body states nothing to trace
    transcript = payload.get("transcript_path") or ""
    if not transcript:
        return deny(EMAIL_MESSAGE if is_write else SAVE_MESSAGE)
    reviewed, written = read_transcript(transcript)
    if is_write:
        return 0 if any(body in norm(prompt) for prompt in reviewed) else deny(EMAIL_MESSAGE)
    target = path_key(str(tool_input.get("eml_path") or ""))
    return 0 if target and any(target in path_key(text) for text in written) else deny(SAVE_MESSAGE)


if __name__ == "__main__":
    try:
        try:
            sys.stderr.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass
        sys.exit(main())
    except SystemExit:
        raise
    except Exception as exc:  # fail CLOSED, loudly
        sys.stderr.write("correspondence-review-gate hook error: " + type(exc).__name__ + ": " + str(exc) + "\n")
        sys.exit(deny(ERROR_MESSAGE))
