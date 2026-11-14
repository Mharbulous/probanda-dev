#!/usr/bin/env python3
"""Turn a lone shell delete into a move to TRASH, while file-manager is enabled.

Hook events:
  SessionStart: writes this session's marker naming this plugin's root
    (delete_targets.record_file_manager). The lawyer plugin's delete hook reads it, so it
    knows file-manager is enabled here.
  PreToolUse, matcher Bash and PowerShell: a lone `rm`/`unlink` (Bash) or a lone
    `Remove-Item` or one of its aliases (PowerShell) whose every target is a literal absolute
    path outside a Git worktree and the OS temp dir (or inside a client matter folder) is
    allowed with its command replaced by a call to this plugin's trash CLI
    (files-mcp/dist/trash-cli.js), which moves each target with the same code as the
    file_ops__trash tool: a matter file to <matter root>/TRASH/<relative path>, anything else
    to <home>/TRASH/<path relative to home>, or <drive>:/TRASH/<path relative to the drive
    root> outside home. delete_targets.trash_targets decides eligibility; anything else gets
    no decision here, and the lawyer hook judges it as before.

The lawyer hook returns the same rewrite for the same command while the marker is present,
so the two decisions never conflict. device_bash is left alone: its files are on another
machine, where this CLI cannot reach them.

An error while judging a command leaves it undecided, for the lawyer hook to deny. Any later
error fails CLOSED (exit 2 blocks the call): a crash must never let a delete it meant to
rewrite run as a delete.
"""
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve()
# shared/scripts in the built plugin, else in this repo's source tree
sys.path[:0] = [str(p) for p in (HERE.parents[1] / "skills" / "shared" / "scripts",
                                 HERE.parents[2] / "skills" / "shared" / "scripts") if p.is_dir()]
try:
    import hook_io  # noqa: E402
    from delete_targets import record_file_manager, trash_command, trash_targets  # noqa: E402
except Exception as exc:  # a missing helper must block, not allow, the delete
    sys.stderr.write(f"trash-rewrite hook cannot load its helpers: {exc}\n")
    sys.exit(2)

PLUGIN_ROOT = os.environ.get("CLAUDE_PLUGIN_ROOT") or str(HERE.parents[1])


def main():
    payload = hook_io.payload()
    if payload.get("hook_event_name") == "SessionStart":
        record_file_manager(payload.get("session_id"), PLUGIN_ROOT)
        return 0
    tool_name = payload.get("tool_name") or ""
    tool_input = payload.get("tool_input") or {}
    command = tool_input.get("command")
    if tool_name not in ("Bash", "PowerShell") or not isinstance(command, str):
        return 0
    cwd = payload.get("cwd") or os.getcwd()
    try:
        paths = trash_targets(tool_name, command, cwd)
    except Exception:
        paths = None  # not rewritten: the lawyer hook judges it, and denies a delete it cannot read
    if paths is None:
        return 0
    return hook_io.pre_tool(
        "allow", "delete moved to TRASH by file-manager",
        updatedInput={**tool_input, "command": trash_command(tool_name, PLUGIN_ROOT, paths)},
    )


def failed(exc):
    sys.stderr.write(f"trash-rewrite hook error (blocking the delete): {type(exc).__name__}: {exc}\n")
    return 2


if __name__ == "__main__":
    hook_io.run(main, "trash-rewrite", closed=failed)
