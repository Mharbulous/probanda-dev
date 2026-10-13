#!/usr/bin/env python3
"""Fail if public/ holds anything that may not reach a user's machine.

Usage:
  python scripts/check_public_tree.py          check every file under public/
  python scripts/check_public_tree.py --hook   check the one file a pending Edit or Write
                                               would leave in public/ (hook JSON on stdin)

public/ is the only source of the public repository, so it holds no Trade
Secret and no User Data (COMMANDMENTS.md). Each file is checked two ways:

  - check_publishable.file_problems: schema DDL, forbidden file types, paths
    from a maintainer's machine, and the pinned names.
  - fingerprints read from the private side on every run and never stored:
    schema identifiers taken from the private SQL and DDL, a rules-map marker,
    a file that is a copy of a private source file, a long line repeated from
    one, a matter code, a file type off the short allowlist, and CRLF endings.

Exit codes: 0 clean, 1 a problem was found or public/ is missing. Standard
library only.
"""
import argparse
import hashlib
import importlib.util
import json
import os
import re
import sys
from pathlib import Path, PurePosixPath

REPO = Path(__file__).resolve().parent.parent
SCRIPTS = Path(__file__).resolve().parent

PUBLIC = "public"
# The human-approved list of public files: {path under public/: sha256}. Written
# only by approve_public.py, run by a person.
APPROVED = "public-approved.json"
# Where the fingerprints are read from.
PRIVATE_ROOTS = (".claude/skills", "source/probanda")
# Third-party code and build output: a public bundle may rightly share their lines.
SKIP_DIRS = ("node_modules", "__pycache__", ".pytest_cache", "build", "dist")
# Private files whose content is not secret, so public/ may repeat it.
SHARED_FILES = ("source/probanda/plugin.json", "source/probanda/.mcp.json")
# Text only: a binary cannot be scanned, so each new type is added on purpose.
ALLOWED_SUFFIXES = (".md", ".json", ".py", ".js", ".txt")
ALLOWED_NAMES = ("LICENSE",)
# Schema identifiers that are also ordinary names outside the schema (a hook's
# input has a `file_path` key). Adding one here is a deliberate act.
GENERIC_IDENTIFIERS = frozenset(("file_path",))
LONG_LINE = 60

SNAKE = re.compile(r"[A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)+")
DOTTED = re.compile(r"\b([A-Za-z]\w*)\.([A-Za-z]\w*)\b")
# The object a DDL statement creates, with its database qualifier if it has one.
CREATED = re.compile(
    r"\bCREATE\s+(?:(?:UNIQUE|VIRTUAL|TEMP|TEMPORARY)\s+)*(?:TABLE|VIEW|INDEX|TRIGGER)\s+"
    r"(?:IF\s+NOT\s+EXISTS\s+)?(?:\w+\.)?(\w+)", re.IGNORECASE)
RULES_MARKER = re.compile(r"<!--\s*(?:node|edge)\b")


def load_script(name):
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def walk(root):
    """(POSIX path relative to root, bytes) for every file under root, sorted."""
    for dirpath, dirs, names in os.walk(root):
        dirs[:] = sorted(d for d in dirs if d not in SKIP_DIRS)
        for name in sorted(names):
            path = Path(dirpath) / name
            yield path.relative_to(root).as_posix(), path.read_bytes()


def public_files(repo):
    """{path under public/: bytes}."""
    root = repo / PUBLIC
    return dict(walk(root)) if root.is_dir() else {}


def text_of(data):
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError:
        return None


def fingerprints(repo):
    """What the private side holds that public/ may not repeat."""
    identifiers, tables, hashes, lines, sql = set(), set(), set(), set(), []
    for top in PRIVATE_ROOTS:
        root = repo / top
        if not root.is_dir():
            continue
        for rel, data in walk(root):
            if f"{top}/{rel}" in SHARED_FILES:
                continue
            if data:
                hashes.add(hashlib.sha256(data).hexdigest())
            text = text_of(data)
            if text is None:
                continue
            is_sql = rel.lower().endswith(".sql")
            if is_sql:
                sql.append(text)
            for line in text.splitlines():
                stripped = line.strip()
                if len(stripped) >= LONG_LINE:
                    lines.add(stripped)
                created = CREATED.search(line)
                if created:
                    tables.add(created.group(1).lower())
                if created or (is_sql and not stripped.startswith("--")):
                    identifiers.update(t.lower() for t in SNAKE.findall(line))
    identifiers |= {t for t in tables if "_" in t}
    # A one-word table name is an ordinary word, so it counts only behind a
    # database qualifier the private SQL itself uses (`main.facts`).
    qualified = {(q.lower(), t.lower()) for text in sql for q, t in DOTTED.findall(text) if t.lower() in tables}
    return {"identifiers": identifiers - GENERIC_IDENTIFIERS, "qualified": qualified,
            "hashes": hashes, "lines": lines}


def tree_problems(files, prints, file_problems, matter_codes):
    """[(path, line, message)] for {path under public/: bytes}."""
    found = []
    for rel, data in files.items():
        found += [(rel, n, msg) for _, n, msg, _ in file_problems(PurePosixPath(rel), data)]
        name = rel.rsplit("/", 1)[-1]
        if name not in ALLOWED_NAMES and not name.lower().endswith(ALLOWED_SUFFIXES):
            found.append((rel, 1, "file type is not on the public allowlist"))
        if data and hashlib.sha256(data).hexdigest() in prints["hashes"]:
            found.append((rel, 1, "is a copy of a private source file"))
        if b"\r\n" in data:
            found.append((rel, 1, "has CRLF line endings"))
        text = text_of(data)
        if text is None:
            found.append((rel, 1, "is not UTF-8 text"))
            continue
        for n, line in enumerate(text.split("\n"), 1):
            stripped = line.strip()
            if len(stripped) >= LONG_LINE and stripped in prints["lines"]:
                found.append((rel, n, "repeats a line of a private source file"))
            names = {t.lower() for t in SNAKE.findall(line)} & prints["identifiers"]
            names |= {f"{q}.{t}" for q, t in DOTTED.findall(line) if (q.lower(), t.lower()) in prints["qualified"]}
            if names:
                found.append((rel, n, "names a private schema identifier: " + ", ".join(sorted(names))))
            if RULES_MARKER.search(line):
                found.append((rel, n, "holds a rules-map marker"))
            if matter_codes(line):
                found.append((rel, n, "holds a matter code"))
    return found


def problems_in(repo, files):
    return tree_problems(files, fingerprints(repo), load_script("check_publishable").file_problems,
                         load_script("check_plugin").matter_codes)


def digests(files):
    return {rel: hashlib.sha256(data).hexdigest() for rel, data in files.items()}


def load_approved(repo):
    path = repo / APPROVED
    return json.loads(path.read_text(encoding="utf-8")) if path.is_file() else {}


def approval_diff(current, approved):
    """How the public files differ from the approved list, as printable lines."""
    return ([f"added: {p}" for p in sorted(set(current) - set(approved))]
            + [f"changed: {p}" for p in sorted(p for p in set(current) & set(approved) if current[p] != approved[p])]
            + [f"removed: {p}" for p in sorted(set(approved) - set(current))])


def pending_file(repo, event):
    """(path under public/, bytes) a pending Edit or Write would leave, or None when
    it does not touch public/. Raises ValueError for a change it cannot work out."""
    tool_input = event.get("tool_input") or {}
    raw = tool_input.get("file_path") or tool_input.get("notebook_path") or ""
    if not raw:
        return None
    path = Path(raw)
    path = (path if path.is_absolute() else Path(event.get("cwd") or repo) / path).resolve()
    root = (repo / PUBLIC).resolve()
    if root not in path.parents:
        return None
    rel = path.relative_to(root).as_posix()
    if "content" in tool_input:
        return rel, tool_input["content"].encode("utf-8")
    edits = tool_input.get("edits") or ([tool_input] if "old_string" in tool_input else None)
    if edits is None:
        raise ValueError(f"cannot work out what {event.get('tool_name')} would write to public/{rel}")
    text = path.read_bytes().decode("utf-8") if path.is_file() else ""
    for edit in edits:
        count = -1 if edit.get("replace_all") else 1
        text = text.replace(edit["old_string"], edit["new_string"], count)
    return rel, text.encode("utf-8")


def report(problems):
    for rel, lineno, message in problems:
        print(f"{PUBLIC}/{rel}:{lineno}: {message}")


def main():
    sys.stdout.reconfigure(errors="backslashreplace")
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--hook", action="store_true", help="check one pending Edit or Write (hook JSON on stdin)")
    parser.add_argument("--repo", type=Path, default=REPO, help="repo to check (for tests)")
    args = parser.parse_args()
    repo = args.repo.resolve()
    if args.hook:
        try:
            pending = pending_file(repo, json.loads(sys.stdin.buffer.read().decode("utf-8")))
        except ValueError as e:
            print(e)
            return 1
        if pending is None:
            return 0
        problems = problems_in(repo, dict([pending]))
        report(problems)
        return 1 if problems else 0
    files = public_files(repo)
    if not files:
        print(f"no files under {PUBLIC}/")
        return 1
    problems = problems_in(repo, files)
    report(problems)
    if problems:
        print(f"\n{len(problems)} problem(s) in {PUBLIC}/. Nothing here may be published.")
        return 1
    print(f"OK: {len(files)} files under {PUBLIC}/ passed every check.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
