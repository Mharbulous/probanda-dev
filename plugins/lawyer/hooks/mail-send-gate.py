#!/usr/bin/env python3
"""Refuse a model mail send and name the draft route instead.

Hook event: PreToolUse, matcher mcp__.+mail_(send_email|forward_email|reply_to_email).
The model never sends email to anyone: an outgoing email is an unsent .eml the
practitioner sends from Outlook (docs/adr/0032, skills/shared/email.md, the one
source for the route; draft/references/letters.md sections 8 and 10). This gate refuses a send, forward or reply and its reason
names that route, so the model learns it at the tool boundary instead of
searching for it.

Two calls pass: any call with dryRun true, and the executive-assistant morning
briefing, recognised by its subject prefix "Morning briefing". The prefix only
keeps the briefing working. It is not the security boundary: the mail server's
own guard refuses every real send except one to the From address itself.

Refuses by a JSON permissionDecision on stdout, exit 0; allows by exiting 0
silently. Fails OPEN on its own error, loudly on stderr, as staged-file-gate does.
"""
import json
import sys

BRIEFING_PREFIX = "Morning briefing"

MESSAGE = (
    "Refused (skills/shared/email.md): the model never sends email. The practitioner sends it "
    "from Outlook. This is an instruction, not a question: do not retry this call or any other mail "
    "send, forward or reply tool, and follow these steps. "
    "1. If this is a client letter whose first line reads `Counsel's review: pending`, the roster "
    "lawyer's request to send it, with no change asked, is their approval: rewrite the first line "
    "to the approval line with their words verbatim (letters.md section 10) before anything else. "
    "2. Call drafting_forms__draft_harness (ToolSearch it; on a remote-device host its name carries "
    "the host's prefix) with step write_email: to and cc, subject, body (the message only, with no closing and no name: the signature adds them), and output_name (a bare "
    "/file-naming stem, or `Send copy` with folder set to the letter's own folder for a client "
    "letter). attachments are PC paths: copy a container-only file to the PC with "
    "device_commit_files first. "
    "3. Present the .eml as a file card, give its PC path from the result, and tell the practitioner "
    "to open it in Outlook, check it and click Send."
)


def allowed(tool_input):
    if tool_input.get("dryRun") is True:
        return True
    subject = tool_input.get("subject")
    return isinstance(subject, str) and subject.startswith(BRIEFING_PREFIX)


def main():
    payload = json.load(sys.stdin)
    tool_input = payload.get("tool_input") or {}
    if not allowed(tool_input):
        sys.stdout.write(json.dumps({"hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": MESSAGE,
        }}) + "\n")
    return 0


if __name__ == "__main__":
    try:
        try:
            sys.stderr.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass
        sys.exit(main())
    except SystemExit:
        raise
    except Exception as exc:  # fail OPEN, loudly
        sys.stderr.write("mail-send-gate hook error (allowing call): " + type(exc).__name__ + ": " + str(exc) + "\n")
        sys.exit(0)
