#!/usr/bin/env python3
"""Block the shared legal-commons pool's write tools (Probanda phase 1).

Probanda ships the commons read side only. Pushing matter-derived principles or
rule records to the shared pool is withheld until COMMANDMENTS.md says how it may
be done, so every write tool is refused here.
"""
import json
import sys

json.load(sys.stdin)
print(json.dumps({
    "hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": "deny",
        "permissionDecisionReason": (
            "Probanda's shared legal-commons pool is read-only for now. Writing to it "
            "(push, amend, link, merge, record, stamp, retire) is not available in this "
            "plugin. Tell the user the write was not made."
        ),
    }
}))
