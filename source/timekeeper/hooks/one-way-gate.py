#!/usr/bin/env python3
"""Hold timekeeper's one-way calls until the practitioner pastes the approval block.

Hook event: PreToolUse, matcher mcp__.+time_pipeline__(delete|bulk_apply)$.
TimeCamp's update_entry is not gated: its original evidence stays on file, so a wrong note can be
rebuilt (practitioner decision, 2026-11-05).
A bulk_apply is one-way only when it removes or replaces something. This hook cannot see the
file or the store (in Cowork both are on another machine), so it goes by the counts in the call's
`expect`, which the server produced in a preview and refuses to write against if they are wrong.
A preview writes nothing and passes. The rules are shared/scripts/approval_gate.py's. Refuses by
a JSON permissionDecision on stdout, exit 0; allows by exiting 0 silently. Fails CLOSED on its
own error.
"""
import sys
from pathlib import Path

try:
    HERE = Path(__file__).resolve()
    # shared/scripts in the built plugin, else in this repo's source tree
    sys.path[:0] = [str(p) for p in (HERE.parents[1] / "skills" / "shared" / "scripts",
                                     HERE.parents[3] / ".claude" / "skills" / "shared" / "scripts") if p.is_dir()]
    import approval_gate
    import hook_io
except Exception as exc:  # a crash would let the call through
    sys.stderr.write(f"Refused: one-way-gate cannot load its helper: {exc!r}\n")
    sys.exit(2)

PREVIEW_FIRST = ("Refused: call this tool with preview true first, then call it again with the counts the "
                 "preview returned as expect. Nothing was written.")


def whole_counts(expect):
    return isinstance(expect, dict) and all(
        type(expect.get(count)) is int and expect[count] >= 0 for count in ("added", "replaced", "removed"))


def main():
    payload = hook_io.payload()
    if (payload.get("tool_name") or "").endswith("time_pipeline__bulk_apply"):
        tool_input = payload.get("tool_input") or {}
        if tool_input.get("preview") is True:
            return 0
        expect = tool_input.get("expect")
        if not whole_counts(expect):
            return hook_io.deny(PREVIEW_FIRST)
        if not expect["replaced"] and not expect["removed"]:
            return 0
    return approval_gate.check(payload)


if __name__ == "__main__":
    hook_io.run(main, "one-way-gate", closed=approval_gate.failed)
