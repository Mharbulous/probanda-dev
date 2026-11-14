#!/usr/bin/env python3
"""Refuse a session's own use of the approval page or the secret behind the approval proof.

Hook event: PreToolUse, matcher the shell tools (Bash, PowerShell, the device and workspace
bash tools), Read, WebFetch and the browser tools (Claude in Chrome, the app's browser pane).
A tool that checks its own approval (mcp/src/approval/gate.ts) runs once the practitioner
clicks Approve on its page at http://127.0.0.1:<port>/approve/<link>, or with a proof made
with the device secret page-api.secret. A session that opened that page, posted to it, or read
the secret could approve its own step. This gate refuses any of these tools when an argument
names an /approve/ address on this computer or page-api.secret.

The check is a tripwire, not a proof: a command that builds the address or the file name at run
time is not seen. Refuses by a JSON permissionDecision on stdout, exit 0; allows by exiting 0
silently. Fails OPEN on its own error, loudly on stderr, as housekeeping-approval-guard does.
"""
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve()
# shared/scripts in the built plugin, else in this repo's source tree
sys.path[:0] = [str(p) for p in (HERE.parents[1] / "skills" / "shared" / "scripts",
                                 HERE.parents[2] / "skills" / "shared" / "scripts") if p.is_dir()]
import hook_io  # noqa: E402

NAMED = re.compile(r"(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?/+approve/|page-api\.secret", re.IGNORECASE)

MESSAGE = (
    "Refused: a step is approved only by the practitioner, on the approval page in their own browser. "
    "Do not open, read or post to that page or its secret, and do not retry another way. Give the "
    "practitioner the page's link and wait for them."
)


def main():
    payload = hook_io.payload()
    if any(NAMED.search(text) for text in hook_io.strings(payload.get("tool_input") or {})):
        return hook_io.deny(MESSAGE)
    return 0


if __name__ == "__main__":
    hook_io.run(main, "approval-page-guard")
