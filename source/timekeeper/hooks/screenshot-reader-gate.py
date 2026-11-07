#!/usr/bin/env python3
"""Keep the screenshot reader to decrypted screenshots, on the model and effort its file pins.

Hook event: PreToolUse, matcher ^(Read|Agent|Task)$. Plugin agents ignore hooks in their own
frontmatter, and a dispatch's model outranks the agent file's, so both limits live here.
- Read by timekeeper:screenshot-reader: allowed only for a .png whose folder is named
  syncopaid-screens. Reads by any other caller pass.
- A dispatch of the screenshot reader that passes model or effort is refused.
Refuses by a JSON permissionDecision on stdout, exit 0; allows by exiting 0 silently.
Fails CLOSED on its own error.
"""
import os
import sys
from pathlib import Path

try:
    HERE = Path(__file__).resolve()
    # shared/scripts in the built plugin, else in this repo's source tree
    sys.path[:0] = [str(p) for p in (HERE.parents[1] / "skills" / "shared" / "scripts",
                                     HERE.parents[3] / ".claude" / "skills" / "shared" / "scripts") if p.is_dir()]
    import hook_io
except Exception as exc:  # a crash would let the call through
    sys.stderr.write(f"Refused: screenshot-reader-gate cannot load its helper: {exc!r}\n")
    sys.exit(2)

READER = "timekeeper:screenshot-reader"
FOLDER = "syncopaid-screens"
READ_REFUSAL = f"Refused: the screenshot reader opens only .png files in a {FOLDER} folder. Nothing was read."
DISPATCH_REFUSAL = "Refused: the screenshot reader's model and effort are fixed. Dispatch it again without model or effort."


def allowed_screenshot(file_path):
    path = Path(os.path.realpath(file_path))
    return path.suffix.lower() == ".png" and path.parent.name.lower() == FOLDER


def main():
    payload = hook_io.payload()
    tool_input = payload.get("tool_input") or {}
    if payload.get("tool_name") == "Read":
        if payload.get("agent_type") != READER or allowed_screenshot(str(tool_input.get("file_path", ""))):
            return 0
        return hook_io.deny(READ_REFUSAL)
    if str(tool_input.get("subagent_type", "")).split(":")[-1] == READER.split(":")[-1] and (
            "model" in tool_input or "effort" in tool_input):
        return hook_io.deny(DISPATCH_REFUSAL)
    return 0


if __name__ == "__main__":
    hook_io.run(main, "screenshot-reader-gate", closed=lambda exc: hook_io.deny(READ_REFUSAL))
