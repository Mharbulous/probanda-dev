#!/usr/bin/env python3
"""Hold timekeeper's one-way calls until the practitioner pastes the approval block.

Hook event: PreToolUse, matcher mcp__.+time_pipeline__(delete|bulk_apply)$|mcp__.+timecamp__update_entry$.
A bulk_apply is one-way only when its file carries a delete or delete_prefix line; any other
passes. The rules are shared/scripts/approval_gate.py's. Refuses by a JSON permissionDecision
on stdout, exit 0; allows by exiting 0 silently. Fails CLOSED on its own error.
"""
import json
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

DELETES = {"delete", "delete_prefix"}


def deletes(path):
    """Whether a bulk_apply file holds a delete line. A file that cannot be read is gated."""
    try:
        lines = Path(path).read_text(encoding="utf-8").splitlines()
    except (OSError, ValueError, TypeError):
        return True
    for line in lines:
        try:
            if line.strip() and json.loads(line).get("op") in DELETES:
                return True
        except (ValueError, AttributeError):
            return True
    return False


def main():
    payload = hook_io.payload()
    if (payload.get("tool_name") or "").endswith("time_pipeline__bulk_apply") and \
            not deletes((payload.get("tool_input") or {}).get("path")):
        return 0
    return approval_gate.check(payload)


if __name__ == "__main__":
    hook_io.run(main, "one-way-gate", closed=approval_gate.failed)
