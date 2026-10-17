#!/usr/bin/env python3
"""Fail if the files git tracks are unsafe to publish in a public repository.

Usage: python scripts/check_publishable.py
       python scripts/check_publishable.py --new-since <commit>
Exits 0 when every check passes, 1 when any problem is found.

With --new-since, exits 1 only when the tracked files hold a problem that
<commit> does not. A problem is matched by its type and the text of its line,
not by where it sits, so a line that moved or a file that was renamed adds
nothing. A problem line whose text was edited counts as new.

The patterns below are written so that this file does not match them itself
(for example `\\s+` where a real match would need a space, and `[D]` in a
literal). Keep it that way: this script is scanned like any other tracked file.
"""
import argparse
import hashlib
import json
import re
import subprocess
import sys
from collections import Counter
from pathlib import Path, PurePosixPath

# Names that are permanent once published. Adding a name here is a deliberate act.
ALLOWED_NAMES = {"Probanda_Legal", "Probanda_Legal_experimental", "probanda","practice", "legal", "research", "researcher", "litigator", "solicitor", "file-manager", "timekeeper", "lawyer"}

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


def git(root, *args, **kwargs):
    return subprocess.run(["git", "-C", str(root), *args], check=True, capture_output=True, **kwargs).stdout


def tracked_files(root):
    out = git(root, "ls-files", "-z").decode("utf-8")
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
        problems.append((path, e.lineno, f"invalid JSON: {e.msg}", ""))
        return
    if not isinstance(data, dict):
        problems.append((path, 1, "expected a JSON object", ""))
        return
    names = [data.get("name")]
    if path.name.lower() == "marketplace.json":
        entries = data.get("plugins")
        for entry in entries if isinstance(entries, list) else []:
            names.append(entry.get("name") if isinstance(entry, dict) else None)
    for name in names:
        if name not in ALLOWED_NAMES:
            problems.append((path, line_of(text, f'"{name}"'), f"name {name!r} is not on the pinned list", ""))


def file_problems(path, data):
    """One file's problems as (path, line number, message, content).

    `content` is what --new-since matches on besides the message: the line's
    text, or for a forbidden file a hash of its bytes.
    """
    problems = []
    if path.name.lower().endswith(FORBIDDEN_SUFFIXES):
        problems.append((path, 1, "forbidden file type", hashlib.sha256(data).hexdigest()))
    text = data.decode("utf-8", errors="replace")
    config = is_config(path)
    for lineno, line in enumerate(text.split("\n"), 1):
        content = line.strip()
        if DDL.search(line):
            problems.append((path, lineno, "contains schema DDL", content))
        if MACHINE_PATH.search(line):
            problems.append((path, lineno, "contains a path from a maintainer's machine", content))
        if config and ABSOLUTE_PATH.search(line):
            problems.append((path, lineno, "contains an absolute path in a config file", content))
    if path.name.lower() in ("plugin.json", "marketplace.json"):
        check_names(path, text, problems)
    return problems


# The pool's cloud side. Its schema files are kept in this private repo by design
# and are never published, so a scan of the repo does not report them. file_problems
# makes no such exception: the public tree and the export are scanned in full.
CLOUD_ROOT = "cloud"


def repo_file_problems(path, data):
    """file_problems for a repo-relative path, less the schema files under cloud/."""
    found = file_problems(path, data)
    if path.parts[:1] != (CLOUD_ROOT,):
        return found
    is_sql = path.name.lower().endswith(".sql")
    return [p for p in found
            if p[2] != "contains schema DDL" and not (is_sql and p[2] == "forbidden file type")]


def worktree_problems(root):
    files = tracked_files(root)
    problems = []
    for path in files:
        try:
            data = (root / path).read_bytes()
        except OSError as e:
            if path.name.lower().endswith(FORBIDDEN_SUFFIXES):
                problems.append((path, 1, "forbidden file type", ""))
            problems.append((path, 1, f"cannot read tracked file: {e.strerror}", ""))
            continue
        problems += repo_file_problems(path, data)
    return files, problems


def commit_problems(root, commit):
    """The problems in every file of `commit`, read from git without a checkout."""
    blobs = []
    for entry in git(root, "ls-tree", "-r", "-z", commit).decode("utf-8").split("\0"):
        if entry:
            meta, path = entry.split("\t", 1)
            kind, sha = meta.split()[1:3]
            if kind == "blob":
                blobs.append((sha, PurePosixPath(path)))
    out = git(root, "cat-file", "--batch", input="".join(f"{sha}\n" for sha, _ in blobs).encode())
    problems = []
    pos = 0
    for _, path in blobs:
        end = out.index(b"\n", pos)
        size = int(out[pos:end].split()[2])
        problems += repo_file_problems(path, out[end + 1:end + 1 + size])
        pos = end + 1 + size + 1
    return problems


def unmatched(problems, others, key):
    """`problems`, less one for each of `others` that has the same key."""
    left = Counter(key(p) for p in others)
    kept = []
    for p in problems:
        if left[key(p)] > 0:
            left[key(p)] -= 1
        else:
            kept.append(p)
    return kept


def new_problems(base, head):
    """The problems in `head` that `base` has no counterpart for.

    Each base problem cancels one head problem with the same message and
    content: first one in the same file, then one anywhere.
    """
    for key in (lambda p: (p[0], p[2], p[3]), lambda p: (p[2], p[3])):
        base, head = unmatched(base, head, key), unmatched(head, base, key)
    return head


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--new-since", metavar="COMMIT")
    args = parser.parse_args()

    root = Path(__file__).resolve().parent.parent
    files, problems = worktree_problems(root)
    found = problems
    if args.new_since:
        found = new_problems(commit_problems(root, args.new_since), problems)

    for path, lineno, message, _ in found:
        print(f"{path}:{lineno}: {message}")
    if args.new_since:
        total = f"{len(problems)} problem(s) in all" + (". Do not make this repository public." if problems else ".")
        if found:
            print(f"\n{len(found)} new problem(s) since {args.new_since}, {total}")
            return 1
        print(f"OK: no new problems since {args.new_since}, {total}")
        return 0
    if problems:
        print(f"\n{len(problems)} problem(s) in {len(files)} tracked files. Do not make this repository public.")
        return 1
    print(f"OK: {len(files)} tracked files passed every publish-readiness check.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
