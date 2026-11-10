#!/usr/bin/env python3
"""Refuse Write/Edit to Probanda's own installed plugin copies and nothing else.

A path is refused only when it resolves inside the installed root of a Probanda
plugin, found from CLAUDE_PLUGIN_ROOT. No path-text matching: the config folder,
other vendors' plugins and every other location are untouched.
Never fires with COCLERK_HTML_DEV=1 or in the plugin's source repo. Fails open, loudly.
"""
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve()
# shared/scripts in the built plugin, else in this repo's source tree
sys.path[:0] = [str(p) for p in (HERE.parents[1] / "skills" / "shared" / "scripts",
                                 HERE.parents[3] / ".claude" / "skills" / "shared" / "scripts") if p.is_dir()]
import hook_io  # noqa: E402

PROBANDA = ("lawyer", "researcher", "litigator", "solicitor", "file-manager", "billing", "developer")
REASON = (
    "Refused: that file is part of the installed Probanda plugin, a read-only synced copy, "
    "so an edit there does not persist. Do not look for or edit the plugin's source either. "
    "For a change the practitioner wants, offer /lawyer:suggestion, which files it in "
    "Probanda's Suggestion Box, then carry on with the work at hand."
)


def in_source_repo(cwd):
    if not cwd:
        return False
    here = Path(cwd).resolve()
    return any((p / "source" / "lawyer" / "plugin.json").is_file() for p in (here, *here.parents))


def protected_roots():
    """This plugin's root plus its installed Probanda siblings, both layouts."""
    root = os.environ.get("CLAUDE_PLUGIN_ROOT")
    if not root:
        return []                                  # unknown -> protect nothing
    base = Path(root).resolve()
    roots = {base}
    if base.name in PROBANDA:                      # synced: <dir>/<plugin>
        parent = base.parent
        roots |= {parent / n for n in PROBANDA if (parent / n).is_dir()}
    elif base.parent.name in PROBANDA:             # cache: <mkt>/<plugin>/<version>
        mkt = base.parent.parent
        roots |= {v for n in PROBANDA if (mkt / n).is_dir() for v in (mkt / n).iterdir() if v.is_dir()}
    return [r.resolve() for r in roots]


def is_protected(path, cwd):
    full = Path(cwd or ".", path).resolve()        # follows symlinks; new files OK
    return any(full == r or r in full.parents for r in protected_roots())


def main():
    if os.environ.get("COCLERK_HTML_DEV") == "1":
        return 0
    payload = hook_io.payload()
    cwd = payload.get("cwd")
    if in_source_repo(cwd):
        return 0
    tool_input = payload.get("tool_input") or {}
    path = tool_input.get("file_path") or tool_input.get("notebook_path")
    if isinstance(path, str) and path and is_protected(path, cwd):
        return hook_io.deny(REASON)
    return 0


if __name__ == "__main__":
    hook_io.run(main, "plugin-cache-guard")
