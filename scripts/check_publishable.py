#!/usr/bin/env python3
"""Fail if the files git tracks are unsafe to publish in a public repository.

Usage: python scripts/check_publishable.py
Exits 0 when every check passes, 1 when any problem is found.

The patterns below are written so that this file does not match them itself
(for example `\\s+` where a real match would need a space, and `[D]` in a
literal). Keep it that way: this script is scanned like any other tracked file.
"""
import json
import re
import subprocess
import sys
from pathlib import Path, PurePosixPath

# Names that are permanent once published. Adding a name here is a deliberate act.
ALLOWED_NAMES = {"probanda"}

FORBIDDEN_SUFFIXES = (".sql", ".db", ".sqlite", ".sqlite3", ".plugin", ".env", ".pem", ".key")

# Uppercase only: lowercase matches ordinary prose such as "create table of authorities".
DDL = re.compile(
    r"\b(?:CREATE\s+(?:(?:UNIQUE|VIRTUAL|TEMP|TEMPORARY)\s+)*(?:TABLE|INDEX|TRIGGER)|ALTER\s+TABLE)\b"
)
MACHINE_PATH = re.compile(
    r"[A-Za-z]:[\\/]+Users[\\/]|[\\/]Users[\\/]Brahm|One[D]rive", re.IGNORECASE
)

# An absolute path in a config file: POSIX or home path after a quote, space or "=",
# a Windows drive path, or a UNC path (JSON-escaped or not).
ABSOLUTE_PATH = re.compile(
    r"""(?<=["'\s=])(?:/|~/)(?=[\w.~-])"""
    r"""|(?<!\w)[A-Za-z]:[\\/]"""
    r"""|(?<=["'\s=])\\{2,}\w"""
)


def tracked_files(root):
    out = subprocess.run(
        ["git", "-C", str(root), "ls-files", "-z"],
        check=True, capture_output=True,
    ).stdout.decode("utf-8")
    return [PurePosixPath(p) for p in out.split("\0") if p]


def is_config(path):
    """plugin.json, marketplace.json, and any MCP or hooks JSON file."""
    name = path.name.lower()
    if name in ("plugin.json", "marketplace.json"):
        return True
    return name.endswith(".json") and (
        "mcp" in name or "hooks" in name or "hooks" in path.parent.parts
    )


def line_of(text, needle):
    index = text.find(needle)
    return text.count("\n", 0, index) + 1 if index >= 0 else 1


def check_names(path, text, problems):
    try:
        data = json.loads(text)
    except json.JSONDecodeError as e:
        problems.append((path, e.lineno, f"invalid JSON: {e.msg}"))
        return
    if not isinstance(data, dict):
        problems.append((path, 1, "expected a JSON object"))
        return
    names = [data.get("name")]
    if path.name.lower() == "marketplace.json":
        entries = data.get("plugins")
        for entry in entries if isinstance(entries, list) else []:
            names.append(entry.get("name") if isinstance(entry, dict) else None)
    for name in names:
        if name not in ALLOWED_NAMES:
            problems.append((path, line_of(text, f'"{name}"'), f"name {name!r} is not on the pinned list"))


def main():
    root = Path(__file__).resolve().parent.parent
    files = tracked_files(root)
    problems = []

    for path in files:
        if path.name.lower().endswith(FORBIDDEN_SUFFIXES):
            problems.append((path, 1, "forbidden file type"))
        try:
            text = (root / path).read_bytes().decode("utf-8", errors="replace")
        except OSError as e:
            problems.append((path, 1, f"cannot read tracked file: {e.strerror}"))
            continue

        config = is_config(path)
        for lineno, line in enumerate(text.split("\n"), 1):
            if DDL.search(line):
                problems.append((path, lineno, "contains schema DDL"))
            if MACHINE_PATH.search(line):
                problems.append((path, lineno, "contains a path from a maintainer's machine"))
            if config and ABSOLUTE_PATH.search(line):
                problems.append((path, lineno, "contains an absolute path in a config file"))
        if path.name.lower() in ("plugin.json", "marketplace.json"):
            check_names(path, text, problems)

    for path, lineno, message in problems:
        print(f"{path}:{lineno}: {message}")
    if problems:
        print(f"\n{len(problems)} problem(s) in {len(files)} tracked files. Do not make this repository public.")
        return 1
    print(f"OK: {len(files)} tracked files passed every publish-readiness check.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
