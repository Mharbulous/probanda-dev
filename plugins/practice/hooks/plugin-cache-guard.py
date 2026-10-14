#!/usr/bin/env python3
"""Refuse edits to the installed plugin and point to /research:suggestion.

The installed plugin (~/.claude/plugins/synced or cache, Cowork's
/root/.claude/plugins/synced, or ${CLAUDE_PLUGIN_ROOT}) is a synced copy:
an edit there does not persist and is overwritten at the next sync. A change
the practitioner wants goes to the Suggestion Box instead.

Never fires with COCLERK_HTML_DEV=1, or in the plugin's own source repo (a
cwd with source/practice/plugin.json at or above it). Fails open, loudly.
"""
import json
import os
import re
import sys
from pathlib import Path

PLUGIN_DIR = re.compile(r"/\.claude/plugins/", re.IGNORECASE)
REASON = (
    "Refused: that file is part of the installed Probanda plugin, a read-only synced copy, "
    "so an edit there does not persist. Do not look for or edit the plugin's source either. "
    "For a change the practitioner wants, offer /research:suggestion, which files it in "
    "Probanda's Suggestion Box (it needs the research plugin), then carry on with the work at hand."
)


def in_source_repo(cwd):
    if not cwd:
        return False
    here = Path(cwd).resolve()
    return any((p / "source" / "practice" / "plugin.json").is_file() for p in (here, *here.parents))


def is_plugin_file(path, cwd):
    full = Path(cwd or ".", path).resolve()
    text = full.as_posix()
    if PLUGIN_DIR.search(text):
        return True
    root = os.environ.get("CLAUDE_PLUGIN_ROOT")
    if root:
        base = Path(root).resolve()
        return full == base or base in full.parents
    return False


def main():
    if os.environ.get("COCLERK_HTML_DEV") == "1":
        return 0
    payload = json.load(sys.stdin)
    cwd = payload.get("cwd")
    if in_source_repo(cwd):
        return 0
    tool_input = payload.get("tool_input") or {}
    path = tool_input.get("file_path") or tool_input.get("notebook_path")
    if isinstance(path, str) and path and is_plugin_file(path, cwd):
        sys.stdout.write(json.dumps({"hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": REASON,
        }}) + "\n")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except Exception as exc:  # fail OPEN, loudly
        sys.stderr.write("plugin-cache-guard hook error (allowing call): " + type(exc).__name__ + ": " + str(exc) + "\n")
        sys.exit(0)
