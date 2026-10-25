#!/usr/bin/env python3
"""List every file-changing operation shipped outside the file-manager plugin.

Usage:
  python scripts/check_file_ops.py            fail on any operation with no ruling, or a stale ruling
  python scripts/check_file_ops.py --report   also list every operation found with its ruling

Commandment 7: file-manager is the only plugin that renames, moves, changes or
deletes a file Probanda did not create. Every other plugin (lawyer, researcher,
litigator, solicitor) may do that only to a file Probanda created: its own
rendered outputs, temp files, databases, knowledge overlay, run folders. Any
other file goes through file-manager, conditionally: without it the step stops
and tells the practitioner.

What is scanned: every file the other plugins ship from source. Their skill
folders per source/assignment.json (under .claude/skills/, including shared/,
and public/plugins/*/skills/), their agents and hooks under source/<plugin>/,
and the source of each MCP server they ship, read by following relative imports
from the server's entry point (so the file-manager entry point's own modules are
not read). Tests, dist/ bundles and node_modules are skipped.

What is flagged:
  Python      os.rename/replace/remove/unlink/rmdir, shutil.move/rmtree, and
              .unlink( .rename( .rmdir( on a path (str .replace( is not flagged)
  JavaScript  fs rename/unlink/rm/rmdir and their Sync forms, called through an
              fs object or imported by name from fs or fs/promises
  Shell       mv and rm in command position, Move-Item, Rename-Item, Remove-Item
  Prose (.md) a short fixed list of phrases that tell the model to rename,
              move, cut or delete a file. A tripwire, not language analysis.

Not detected: overwriting a file with a plain write. A write changes a file just
as a rename does, but telling a write to a user's file from a write to
Probanda's own output needs the path at run time, so it is out of reach here.

Rulings live in source/file-ops.json, one per (file, operation). Each has a
"count": the number of lines of that file with that operation it covers, each
one read and found to be the case its "note" describes. A "why" from WHYS and
the "note" say which Probanda-created file it touches. A ruling is only for a
file Probanda created, or for a step that routes through file-manager. More
occurrences than the count fail (a new one, unread); fewer fail as stale.

Exit codes: 0 clean, 1 an operation with no ruling, a count above or below its
ruling, or a ruling with an unknown "why" or no count. Standard library only.
"""
import argparse
import json
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import plugin_layout  # noqa: E402

REPO = Path(__file__).resolve().parent.parent
RULINGS = Path("source") / "file-ops.json"
WHYS = ("own-output", "temp", "own-database", "own-overlay", "own-run", "conditional", "mention")
EXEMPT_PLUGIN = "file-manager"

SKILL_ROOTS = plugin_layout.SKILL_ROOTS
SKIP_DIRS = {"__pycache__", "tests", "test", "determinizing-tests", "evals", ".pytest_cache",
             "node_modules", "dist", "sessions"}
SKILL_EXTS = {".md", ".py", ".sh", ".ps1", ".bat", ".cmd", ".js", ".mjs", ".ts"}
# The entry point of each MCP server, by its key in a plugin's .mcp.json.
SERVER_ENTRIES = {
    "data": "source/lawyer/mcp/src/index.ts",
    "canlii": "source/researcher/canlii-mcp/src/index.ts",
    "commons": "source/researcher/commons-mcp/src/index.ts",
    "timecamp": "source/lawyer/mcp/src/timecamp-index.ts",
    "contacts-calendars-email": "source/lawyer/mcp/src/contacts-calendars-email-index.ts",
}

PY_OPS = [(f"os.{op}", re.compile(rf"\bos\.{op}\s*\(")) for op in ("rename", "replace", "remove", "unlink", "rmdir")]
PY_OPS += [(f"shutil.{op}", re.compile(rf"\bshutil\.{op}\s*\(")) for op in ("move", "rmtree")]
PY_PATH_OP = re.compile(r"\.(unlink|rename|rmdir)\s*\(")

FS_NAMES = ("rename", "unlink", "rm", "rmdir")
FS_OBJECT_CALL = re.compile(r"(?<![\w$])(?:fs|fsp|fsPromises|promises)\.(rename|unlink|rm|rmdir)(?:Sync)?\s*\(")
FS_IMPORT = re.compile(r"import\s*\{([^}]*)\}\s*from\s*[\"'](?:node:)?fs(?:/promises)?[\"']")

SHELL_OPS = [("shell mv", re.compile(r"(?:^|[;&|(]|\$\()\s*mv\s+[^\s=]")),
             ("shell rm", re.compile(r"(?:^|[;&|(]|\$\()\s*rm\s+[^\s=]"))]
SHELL_OPS += [(op, re.compile(rf"\b{op}\b", re.I)) for op in ("Move-Item", "Rename-Item", "Remove-Item")]

PROSE_OPS = [(f"os.{op}", re.compile(rf"\bos\.{op}\b")) for op in ("rename", "replace", "remove", "unlink", "rmdir")]
PROSE_OPS += [(f"shutil.{op}", re.compile(rf"\bshutil\.{op}\b")) for op in ("move", "rmtree")]
PROSE_OPS += [(op, re.compile(rf"\b{op}\b", re.I)) for op in ("Move-Item", "Rename-Item", "Remove-Item")]
PROSE_OPS += [
    ("shell mv", re.compile(r"(?:^\s*|`)mv\s+\S")),
    ("shell rm", re.compile(r"(?:^\s*|`)rm\s+\S")),
    ("prose rename", re.compile(r"\brename (?:it|them|the file|the files|each file|the document|the pdf)\b"
                                r"|\(F2\)", re.I)),
    ("prose move", re.compile(r"\bmove (?:the file|the files|each file|the document|the pdf)\b"
                              r"|\bmove (?:it|them) (?:to|into|with)\b", re.I)),
    ("prose cut", re.compile(r"\bcut (?:it|them|the file|the files)\b", re.I)),
    ("prose delete", re.compile(r"\bdelete (?:it|them|the file|the files|the original|each file)\b", re.I)),
]


def skipped(rel_parts):
    return any(part in SKIP_DIRS for part in rel_parts)


def import_closure(repo, entry):
    """Every source file reachable from entry by relative imports."""
    pattern = re.compile(r"(?:\bfrom|\bimport)\s*\(?\s*[\"'](\.{1,2}/[^\"']+)[\"']")
    seen, stack = set(), [repo / entry]
    while stack:
        path = stack.pop()
        if path in seen or not path.is_file():
            continue
        seen.add(path)
        for spec in pattern.findall(path.read_text(encoding="utf-8", errors="replace")):
            target = Path(os.path.normpath(path.parent / spec))
            candidates = [target.with_suffix(".ts"), target] if target.suffix == ".js" \
                else [target, Path(f"{target}.ts"), target / "index.ts"]
            stack.extend(c for c in candidates if c.is_file() and not c.name.endswith(".d.ts"))
    return sorted(seen)


def shipped_files(repo):
    """[(plugin, path)] for every file shipped by a plugin other than file-manager.
    shared/ is listed under the plugin "shared"."""
    assignment = plugin_layout.load(repo)
    plugins = assignment["plugins"]
    owner = {s: p for p, spec in plugins.items() for s in spec["skills"]}
    files = []
    for root in sorted(r for pattern in SKILL_ROOTS for r in repo.glob(pattern)):
        if not root.is_dir():
            continue
        for top in sorted(p for p in root.iterdir() if p.is_dir()):
            plugin = "shared" if top.name == "shared" else owner.get(top.name)
            if plugin is None:
                raise SystemExit(f"STOP: skill folder {top} has no plugin in source/assignment.json")
            if plugin == EXEMPT_PLUGIN:
                continue
            for path in sorted(top.rglob("*")):
                if path.is_file() and path.suffix.lower() in SKILL_EXTS \
                        and not skipped(path.relative_to(root).parts[:-1]):
                    files.append((plugin, path))
    for plugin, spec in plugins.items():
        if plugin == EXEMPT_PLUGIN:
            continue
        for sub in ("agents", "hooks"):
            for path in sorted((repo / "source" / plugin / sub).glob("*")):
                if path.is_file() and path.suffix.lower() in SKILL_EXTS:
                    files.append((plugin, path))
        for server in spec["servers"]:
            if server not in SERVER_ENTRIES:
                raise SystemExit(f"STOP: server {server} of {plugin} has no entry point in check_file_ops.py")
            for path in import_closure(repo, SERVER_ENTRIES[server]):
                files.append((plugin, path))
    seen, out = set(), []
    for plugin, path in files:
        if path not in seen:
            seen.add(path)
            out.append((plugin, path))
    return out


def line_ops(path, text):
    """[(line number, operation, line)] for every flagged operation in a file."""
    suffix = path.suffix.lower()
    hits = []
    lines = text.splitlines()
    if suffix in (".js", ".mjs", ".ts"):
        local = {}
        for group in FS_IMPORT.findall(text):
            for item in group.split(","):
                parts = item.split(" as ")
                name = parts[0].strip()
                base = name[:-4] if name.endswith("Sync") else name
                if base in FS_NAMES:
                    local[(parts[1] if len(parts) > 1 else parts[0]).strip()] = base
        bare = re.compile(r"(?<![\w$.])(" + "|".join(map(re.escape, local)) + r")\s*\(") if local else None
    for number, line in enumerate(lines, 1):
        found = []
        if suffix == ".py":
            found += [label for label, rx in PY_OPS if rx.search(line)]
            found += [label for label, rx in SHELL_OPS if rx.search(line)]
            for m in PY_PATH_OP.finditer(line):
                if not re.search(r"\b(?:os|shutil)$", line[:m.start()]):
                    found.append(f"path.{m.group(1)}")
        elif suffix in (".js", ".mjs", ".ts"):
            found += [f"fs.{m.group(1)}" for m in FS_OBJECT_CALL.finditer(line)]
            if bare and not FS_IMPORT.search(line) and not line.lstrip().startswith(("import", "}")):
                found += [f"fs.{local[m.group(1)]}" for m in bare.finditer(line)]
        elif suffix in (".sh", ".ps1", ".bat", ".cmd"):
            found += [label for label, rx in SHELL_OPS if rx.search(line)]
        elif suffix == ".md":
            found += [label for label, rx in PROSE_OPS if rx.search(line)]
        for label in dict.fromkeys(found):
            hits.append((number, label, line.strip()[:160]))
    return hits


def scan(repo):
    """Findings as dicts: file, line, op, text, plugin."""
    findings = []
    for plugin, path in shipped_files(repo):
        rel = path.relative_to(repo).as_posix()
        for number, op, text in line_ops(path, path.read_text(encoding="utf-8", errors="replace")):
            findings.append({"file": rel, "line": number, "op": op, "text": text, "plugin": plugin})
    return findings


def judge(repo):
    """Returns (findings, {pair: why}, {pair: occurrences found}, pairs with no ruling,
    [(pair, ruled, actual)] found more often than ruled, [(pair, ruled, actual)] found
    less often than ruled (stale), rulings with an unknown why or no count)."""
    path = repo / RULINGS
    rulings = json.loads(path.read_text(encoding="utf-8"))["allowed"] if path.is_file() else []
    findings = scan(repo)
    ruling = {(r["file"], r["op"]): r.get("why") for r in rulings}
    ruled = {(r["file"], r["op"]): r.get("count") for r in rulings}
    bad = sorted(pair for pair in ruling
                 if ruling[pair] not in WHYS or not isinstance(ruled[pair], int) or ruled[pair] < 1)
    found = {}
    for f in findings:
        found[(f["file"], f["op"])] = found.get((f["file"], f["op"]), 0) + 1
    counted = [p for p in ruling if p not in bad]
    over = sorted((p, ruled[p], found[p]) for p in counted if found.get(p, 0) > ruled[p])
    stale = sorted((p, ruled[p], found.get(p, 0)) for p in counted if found.get(p, 0) < ruled[p])
    return findings, ruling, found, sorted(set(found) - set(ruling)), over, stale, bad


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--report", action="store_true", help="list every operation found with its ruling")
    parser.add_argument("--repo", type=Path, default=REPO, help="repo to read (for tests)")
    args = parser.parse_args()
    sys.stdout.reconfigure(errors="backslashreplace")
    findings, ruling, found, unruled, over, stale, bad = judge(args.repo.resolve())
    if args.report:
        for f in sorted(findings, key=lambda f: (f["file"], f["op"], f["line"])):
            print(f"{ruling.get((f['file'], f['op']), 'NO RULING')}\t{f['plugin']}\t{f['file']}:{f['line']}\t"
                  f"{f['op']}\t{f['text']}")
    for line in problems(findings, ruling, unruled, over, stale, bad):
        print(line, file=sys.stderr)
    by_why = {}
    for pair in set(found) & set(ruling):
        by_why[ruling[pair]] = by_why.get(ruling[pair], 0) + 1
    print(f"{len(found)} (file, operation) pairs outside file-manager: "
          + ", ".join(f"{n} {w}" for w, n in sorted(by_why.items()))
          + ("; " if by_why else "") + f"{len(unruled)} with no ruling, {len(over)} over their ruled count, "
          f"{len(stale)} stale rulings.")
    return 1 if unruled or over or stale or bad else 0


def problems(findings, ruling, unruled, over, stale, bad):
    """One line per failure, naming the file, the operation and, for a count, the ruled and actual numbers."""
    lines = {}
    for f in findings:
        lines.setdefault((f["file"], f["op"]), []).append(str(f["line"]))
    out = [f"no ruling: {f}:{','.join(lines[(f, op)])} {op}" for f, op in unruled]
    out += [f"more than ruled: {f}:{','.join(lines[(f, op)])} {op}, ruled count {n}, actual count {actual}: "
            f"a new occurrence needs its own reading, never a raised count by default"
            for (f, op), n, actual in over]
    out += [f"stale ruling: {f} {op}, ruled count {n}, actual count {actual}: lower the count"
            + (" or remove the ruling" if actual == 0 else "") for (f, op), n, actual in stale]
    out += [f"bad ruling (why '{ruling[pair]}' must be one of {', '.join(WHYS)}, count a whole number from 1): "
            f"{pair[0]} {pair[1]}" for pair in bad]
    return out


if __name__ == "__main__":
    sys.exit(main())
