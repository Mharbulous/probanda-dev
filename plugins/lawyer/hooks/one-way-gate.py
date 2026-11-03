#!/usr/bin/env python3
"""Hold lawyer's one-way calls until the practitioner pastes the approval block.

Hook event: PreToolUse, matcher mcp__.+(practice_data__(delete_anchor|merge_contact|issue_invoice)|mail__dedupe_apply)$.
The rules are shared/scripts/approval_gate.py's. Refuses by a JSON permissionDecision on
stdout, exit 0; allows by exiting 0 silently. Fails CLOSED on its own error.
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


def main():
    return approval_gate.check(hook_io.payload())


if __name__ == "__main__":
    hook_io.run(main, "one-way-gate", closed=approval_gate.failed)
