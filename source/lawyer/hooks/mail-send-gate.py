#!/usr/bin/env python3
"""Refuse a model mail send and name the draft route instead.

Hook event: PreToolUse, matcher mcp__.+_(send_email|forward_email|reply_to_email)$.
The model never sends email to anyone: an outgoing email is an unsent .eml the
practitioner sends from Outlook (docs/adr/0032, skills/shared/email.md, the one
source for the route; draft/references/letters.md sections 8 and 10). This gate refuses a send, forward or reply and its reason
names that route, so the model learns it at the tool boundary instead of
searching for it. The reason is in plain words, because a refusal is quoted to the
practitioner verbatim (shared/internals-confidentiality.md): it points at the shared
email rules, which name the tool.

Two calls pass: any call with dryRun true, and the executive-assistant morning
briefing, recognised by its subject prefix "Morning briefing". The prefix only
keeps the briefing working. It is not the security boundary: the mail server's
own guard refuses every real send except one to the From address itself.

Refuses by a JSON permissionDecision on stdout, exit 0; allows by exiting 0
silently. Fails OPEN on its own error, loudly on stderr, as staged-file-gate does.
"""
import sys
from pathlib import Path

HERE = Path(__file__).resolve()
# shared/scripts in the built plugin, else in this repo's source tree
sys.path[:0] = [str(p) for p in (HERE.parents[1] / "skills" / "shared" / "scripts",
                                 HERE.parents[2] / "skills" / "shared" / "scripts") if p.is_dir()]
import hook_io  # noqa: E402

BRIEFING_PREFIX = "Morning briefing"

MESSAGE = (
    "Refused: Probanda never sends email itself. The practitioner sends it from Outlook. This is "
    "an instruction, not a question: do not retry this send, or any other way to send, forward or "
    "reply, and follow these steps, as the shared email rules say. "
    "1. Save the message as an unsent email through the drafting tools' email step: to and cc, "
    "subject, the message alone (the signature adds the closing and the name), and a file name "
    "under the firm's naming convention. Attach only files saved on the PC, copying any other file "
    "to the PC first. "
    "2. Present the saved email as a file card, say where it was saved, and tell the practitioner "
    "to open it in Outlook, check it and click Send."
)


def allowed(tool_input):
    if tool_input.get("dryRun") is True:
        return True
    subject = tool_input.get("subject")
    return isinstance(subject, str) and subject.startswith(BRIEFING_PREFIX)


def main():
    tool_input = hook_io.payload().get("tool_input") or {}
    if not allowed(tool_input):
        return hook_io.deny(MESSAGE)
    return 0


if __name__ == "__main__":
    hook_io.run(main, "mail-send-gate")
