#!/usr/bin/env python3
"""Refuse a verdict on copies of an email from anything but the email-reader agent.

Hook event: PreToolUse, matcher mcp__(.+__)?plugin_lawyer_contacts-calendars-email__mail__dedupe_record_verdicts.
The mail server cannot identify its caller, and a verdict decides which copy may go to Trash and
which is read into case data, so only the agent holding the judging rules may record one. The main
session has no agent_type, so its call is refused too. Refuses by a JSON permissionDecision on
stdout, exit 0, in fixed text; allows by exiting 0 silently. Fails CLOSED on its own error.
"""
import sys
from pathlib import Path

try:
    HERE = Path(__file__).resolve()
    # shared/scripts in the built plugin, else in this repo's source tree
    sys.path[:0] = [str(p) for p in (HERE.parents[1] / "skills" / "shared" / "scripts",
                                     HERE.parents[3] / ".claude" / "skills" / "shared" / "scripts") if p.is_dir()]
    import hook_io
except Exception as exc:  # a crash would let the call through
    sys.stderr.write(f"Refused: verdict-gate cannot load its helper: {exc!r}\n")
    sys.exit(2)

READER = "lawyer:email-reader"
REFUSAL = "Refused: a verdict on copies of an email is recorded only by the step that checks those copies. Nothing was recorded."


def main():
    return 0 if hook_io.payload().get("agent_type") == READER else hook_io.deny(REFUSAL)


if __name__ == "__main__":
    hook_io.run(main, "verdict-gate", closed=lambda exc: hook_io.deny(REFUSAL))
