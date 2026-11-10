#!/usr/bin/env python3
"""Refuse any write to a /housekeeping run's approval.json.

Hook event: PreToolUse, matcher Write, Edit, MultiEdit and the shell tools (Bash,
PowerShell, the device and workspace bash tools).
approval.json is written only by the approval page, when the practitioner clicks
Approve, and the housekeeping apply step moves a file only for a row it approves
(plan 2026-10-28 section 2d). So a session that writes or edits that file could
approve its own moves. This gate refuses Write and Edit of any file named
approval.json whose folder is a run id under a `housekeeping` folder.

The shell check is a heuristic. A command is refused when it names approval.json
and also names a `housekeeping` folder or a run id (such as 20260924-204013123-a1b2).
That catches the plain cases, including a cd into the run folder first, but a
command that builds the name at run time, or reaches the file through a variable
or a link, is not seen. It also refuses a command that only reads the file: the
housekeeping tools read it, so a session never needs to.

Refuses by a JSON permissionDecision on stdout, exit 0; allows by exiting 0
silently. Fails OPEN on its own error, loudly on stderr, as mail-send-gate does.
"""
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve()
# shared/scripts in the built plugin, else in this repo's source tree
sys.path[:0] = [str(p) for p in (HERE.parents[1] / "skills" / "shared" / "scripts",
                                 HERE.parents[2] / "skills" / "shared" / "scripts") if p.is_dir()]
import hook_io  # noqa: E402

RUN_ID = r"\d{8}-\d{6}(?:\d{3})?-[0-9a-f]{4}"
RUN_APPROVAL = re.compile(r"(?:^|[\\/])housekeeping[\\/]+" + RUN_ID + r"[\\/]+approval\.json$", re.IGNORECASE)
NAMES_APPROVAL = re.compile(r"approval\.json", re.IGNORECASE)
NAMES_RUN = re.compile(r"housekeeping|" + RUN_ID, re.IGNORECASE)
SHELLS = re.compile(r"Bash|PowerShell|mcp__(.+__)?(device|workspace)_+bash")

MESSAGE = (
    "Refused: a housekeeping run's approval.json is written only by the approval page, when the "
    "practitioner clicks Approve. Do not write, edit, copy, move or delete it, and do not retry "
    "another way. To change what is approved, start a new housekeeping run and serve its page."
)


def main():
    payload = hook_io.payload()
    tool_name = payload.get("tool_name") or ""
    tool_input = payload.get("tool_input") or {}
    if SHELLS.fullmatch(tool_name):
        command = tool_input.get("command")
        if isinstance(command, str) and NAMES_APPROVAL.search(command) and NAMES_RUN.search(command):
            return hook_io.deny(MESSAGE)
        return 0
    path = tool_input.get("file_path")
    if isinstance(path, str) and RUN_APPROVAL.search(path.strip()):
        return hook_io.deny(MESSAGE)
    return 0


if __name__ == "__main__":
    hook_io.run(main, "housekeeping-approval-guard")
