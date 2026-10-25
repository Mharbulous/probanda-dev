#!/usr/bin/env python3
"""List every upward reference between the plugins of source/assignment.json.

Usage:
  python scripts/check_layering.py            strict: fail on any upward reference not allowed
  python scripts/check_layering.py --report   list every upward reference with its ruling; fail only
                                              on one with no ruling, or on a ruling nothing matches
  python scripts/check_layering.py --shared   also list what the files under shared/ name

A plugin may name only itself and the plugins it requires. An upward reference is
a shipped file of one plugin naming a skill, an agent or a server tool of a plugin
it does not require. The unit of a ruling is (file, target): every line of that
file naming that target shares it.

Rulings live in source/layering.json:
  "allowed"  upward references that stay: a signpost worded as conditional on the
             other plugin, or an exception a person decided
  "todo"     real upward calls still to be reworded or moved (empty once the split
             is ready)

shared/ ships in every plugin and is read only when a skill points at it, so its
files are listed by --shared and never fail the check.

Skills are read from .claude/skills/ and from every public/plugins/*/skills/.
Agents are read from source/probanda/agents/ until the assignment's status is
"cutover", then from each plugin's source/<plugin>/agents/. check_plugin.py runs
this check too, through judge(): as --report until cutover, strict from then.

Exit codes: 0 clean, 1 a reference with no ruling (in strict mode, also any
"todo"), or a stale ruling. Standard library only.
"""
import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import plugin_layout  # noqa: E402

REPO = Path(__file__).resolve().parent.parent

SCAN_EXTS = (".md", ".py", ".json", ".sql")
EXCLUDE_DIRS = ("__pycache__", "sessions", "tests", "determinizing-tests", "evals", ".pytest_cache")
SKILL_ROOTS = plugin_layout.SKILL_ROOTS
# The data server ships in lawyer, but these tool families belong to litigator's
# skills: a file outside litigator that names one leans on litigator's data.
LITIGATOR_TOOL_FAMILIES = ("drafting_data__", "drafting_forms__", "rules__")
# Tool families of a server, for a name written without its plugin prefix: the
# researcher plugin's commons server, and the file-manager plugin's files server, whose
# tools rename, move or delete a user's file.
SERVER_TOOL_FAMILIES = {"commons": ("legal_commons__", "troubleshoot__", "suggestion_box__"),
                        "files": ("file_ops__", "housekeeping__")}
# A family name starts a tool name or follows the server key (data__rules__at), so
# rules__ is not found inside skill_rules__.
FAMILY_START = r"(?:(?<![a-z_])|(?<=__))"


def agent_files(repo):
    """Every agent file: under source/probanda/agents/ until the assignment's status
    is "cutover", then under each plugin's source/<plugin>/agents/."""
    assignment = plugin_layout.load(repo)
    owners = assignment["plugins"] if assignment["status"] == "cutover" else ("probanda",)
    return sorted(path for owner in owners for path in (repo / "source" / owner / "agents").glob("*.md"))


def load(repo):
    assignment = plugin_layout.load(repo)
    rulings_path = repo / "source" / "layering.json"
    rulings = json.loads(rulings_path.read_text(encoding="utf-8")) if rulings_path.is_file() \
        else {"allowed": [], "todo": []}
    placed = {a for spec in assignment["plugins"].values() for a in spec["agents"]}
    placed |= set(assignment.get("unplaced", {}).get("agents", []))
    missing = sorted(p.stem for p in agent_files(repo) if p.stem not in placed)
    if missing:
        raise SystemExit("STOP: agent with no plugin in source/assignment.json: " + ", ".join(missing))
    return assignment["plugins"], rulings


def reachable(plugins, name):
    """The plugin itself plus everything it requires, directly or not."""
    seen, stack = set(), [name]
    while stack:
        p = stack.pop()
        if p not in seen:
            seen.add(p)
            stack.extend(plugins[p]["requires"])
    return seen


def name_pattern(name):
    """A hyphenated name is distinctive enough to match as a bare word. A one-word
    name (draft, publish) is also an ordinary word, so it counts only as a slash
    command, in backticks, behind a plugin prefix or as a folder in a path."""
    n = re.escape(name)
    marked = (rf"(?<![\w./-])/{n}(?![\w-])"          # /draft
              rf"|`/?{n}(?![\w:-])"                   # `draft` or `draft op`, not the key `draft:...`
              rf"|\w+:{n}(?![\w-])"                   # litigator:draft
              rf"|(?:skills|\.\.)/{n}/")              # skills/draft/ or ../draft/
    if "-" not in name:
        return re.compile(marked)
    # "the matter-data folder" is a folder on disk, not the skill.
    return re.compile(rf"{marked}|(?<![\w/-]){n}(?![\w-]|\.md|[ -]folder)")


def targets(plugins):
    """[(kind, target name, owning plugin, compiled pattern)]"""
    out = []
    for plugin, spec in plugins.items():
        for kind in ("skills", "agents"):
            for name in spec[kind]:
                out.append((kind[:-1], name, plugin, name_pattern(name)))
        for server in spec["servers"]:
            families = "|".join(re.escape(f) for f in SERVER_TOOL_FAMILIES.get(server, ()))
            pattern = rf"plugin_[\w-]+?_{re.escape(server)}__" + (rf"|{FAMILY_START}(?:{families})" if families else "")
            out.append(("tool", f"{server} server", plugin, re.compile(pattern)))
    for family in LITIGATOR_TOOL_FAMILIES:
        out.append(("tool", f"{family}*", "litigator", re.compile(FAMILY_START + re.escape(family))))
    return out


def unit_files(repo, plugins):
    """[(plugin, unit label, path)] for every shipped text file of every unit."""
    owner = {s: p for p, spec in plugins.items() for s in spec["skills"]}
    files = []
    for root in sorted(root for pattern in SKILL_ROOTS for root in repo.glob(pattern)):
        if not root.is_dir():
            continue
        for top in sorted(p for p in root.iterdir() if p.is_dir()):
            plugin = "shared" if top.name == "shared" else owner.get(top.name)
            if plugin is None:
                raise SystemExit(f"STOP: skill folder {top} has no plugin in source/assignment.json")
            for path in sorted(top.rglob("*")):
                rel = path.relative_to(root)
                if path.is_file() and path.suffix.lower() in SCAN_EXTS \
                        and not any(part in EXCLUDE_DIRS for part in rel.parts[:-1]):
                    files.append((plugin, f"skill {top.name}", path))
    agent_owner = {a: p for p, spec in plugins.items() for a in spec["agents"]}
    for path in agent_files(repo):
        if path.stem in agent_owner:
            files.append((agent_owner[path.stem], f"agent {path.stem}", path))
    return files


def scan(repo, plugins):
    """Findings as dicts: file, line, text, kind, target, target_plugin, plugin, unit."""
    allowed_for = {p: reachable(plugins, p) for p in plugins}
    all_targets = targets(plugins)
    findings = []
    for plugin, unit, path in unit_files(repo, plugins):
        rel = path.relative_to(repo).as_posix()
        own_name = unit.split(" ", 1)[1]
        for number, line in enumerate(path.read_text(encoding="utf-8", errors="replace").splitlines(), 1):
            for kind, name, owner, pattern in all_targets:
                if name == own_name or (plugin != "shared" and owner in allowed_for[plugin]):
                    continue
                if pattern.search(line):
                    findings.append({"file": rel, "line": number, "text": line.strip()[:160], "kind": kind,
                                     "target": name, "target_plugin": owner, "plugin": plugin, "unit": unit})
    # A hook's script must sit in a folder its own plugin ships.
    skill_owner = {s: p for p, spec in plugins.items() for s in spec["skills"]}
    for plugin, spec in plugins.items():
        for hook, script in spec["hooks"].items():
            parts = Path(script).parts
            if parts[0] == "source":
                continue
            folder = parts[parts.index("skills") + 1] if "skills" in parts else None
            if folder and folder != "shared" and skill_owner.get(folder) != plugin:
                findings.append({"file": script, "line": 0, "kind": "hook",
                                 "text": f"hook {hook} of {plugin} has its script in a {skill_owner.get(folder)} skill folder",
                                 "target": f"folder {folder}", "target_plugin": skill_owner.get(folder),
                                 "plugin": plugin, "unit": f"hook {hook}"})
    return findings


def judge(repo):
    """Scan the repo and set each upward (file, target) pair against its ruling.
    Returns (shared findings, upward findings, {pair: ruling label}, pairs found,
    pairs with no ruling, rulings nothing matches, pairs still to fix)."""
    plugins, rulings = load(repo)
    findings = scan(repo, plugins)

    shared = [f for f in findings if f["plugin"] == "shared"]
    upward = [f for f in findings if f["plugin"] != "shared"]
    ruling = {}
    for label in ("allowed", "todo"):
        for entry in rulings[label]:
            ruling[(entry["file"], entry["target"])] = label
    found_pairs = {(f["file"], f["target"]) for f in upward}
    unruled = sorted(found_pairs - set(ruling))
    stale = sorted(set(ruling) - found_pairs)
    todo = sorted(pair for pair in found_pairs if ruling.get(pair) == "todo")
    return shared, upward, ruling, found_pairs, unruled, stale, todo


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--report", action="store_true", help="list every upward reference with its ruling")
    parser.add_argument("--shared", action="store_true", help="also list what the files under shared/ name")
    parser.add_argument("--repo", type=Path, default=REPO, help="repo to read (for tests)")
    args = parser.parse_args()
    sys.stdout.reconfigure(errors="backslashreplace")
    shared, upward, ruling, found_pairs, unruled, stale, todo = judge(args.repo.resolve())

    if args.report:
        for f in sorted(upward, key=lambda f: (f["plugin"], f["file"], f["target"], f["line"])):
            label = ruling.get((f["file"], f["target"]), "NO RULING")
            print(f"{label}\t{f['plugin']} -> {f['target_plugin']}\t{f['file']}:{f['line']}\t"
                  f"{f['kind']} {f['target']}\t{f['text']}")
    if args.shared:
        for f in sorted(shared, key=lambda f: (f["file"], f["target"], f["line"])):
            print(f"shared\t-> {f['target_plugin']}\t{f['file']}:{f['line']}\t{f['kind']} {f['target']}\t{f['text']}")

    for pair in unruled:
        print(f"no ruling: {pair[0]} names {pair[1]}", file=sys.stderr)
    for pair in stale:
        print(f"stale ruling (nothing matches it): {pair[0]} names {pair[1]}", file=sys.stderr)
    if not args.report:
        for pair in todo:
            print(f"still to fix: {pair[0]} names {pair[1]}", file=sys.stderr)
    counts = (f"{len(found_pairs)} upward (file, target) pairs: "
              f"{sum(1 for p in found_pairs if ruling.get(p) == 'allowed')} allowed, "
              f"{len(todo)} to fix, {len(unruled)} with no ruling, {len(stale)} stale rulings. "
              f"shared/ names {len({(f['file'], f['target']) for f in shared})} pairs (not checked).")
    print(counts)
    failed = bool(unruled or stale or (todo and not args.report))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
