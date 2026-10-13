#!/usr/bin/env python3
"""Export the publishable subset of this repo into a directory, for the public repo.

Usage:
  python scripts/export_public.py <target>   check, then write the export into <target>
  python scripts/export_public.py --plan     check and report what would be exported; write nothing

The export is one-way: this repo is developed in, and the public repo is only
ever written by this script. What ships is the explicit allowlist below and
nothing else. Before anything is written, every file to ship is read through
check_publishable.file_problems (the same rules the publish-readiness check
applies), and the built plugin is compared with a fresh build of its sources.
Any problem stops the export with nothing written.

<target> must be empty or absent, or an existing git checkout, in which case
everything in it except `.git` is replaced. It may not be inside this repo, and
this repo may not be inside it. The script never runs git.

Exit codes: 0 exported (or --plan found nothing wrong), 1 a check refused the
export, 2 a bad target or arguments. Standard library only.
"""
import argparse
import importlib.util
import shutil
import sys
from collections import Counter
from pathlib import Path, PurePosixPath

REPO = Path(__file__).resolve().parent.parent
SCRIPTS = Path(__file__).resolve().parent

# The allowlist, as repo-relative POSIX paths. A tree ships every file under it.
# Nothing outside these entries ships, whatever else the repo holds.
REQUIRED_FILES = (".claude-plugin/marketplace.json", "README.md")
OPTIONAL_FILES = ("LICENSE",)
TREES = ("plugins/probanda",)
# Never shipped from inside a tree.
SKIP_DIRS = ("__pycache__",)
SKIP_SUFFIXES = (".pyc",)

BUILT_PREFIX = "plugins/probanda/"


def load_script(name):
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def collect(repo):
    """({repo-relative path: bytes} for every file the allowlist selects, [missing required paths])."""
    files, missing = {}, []
    for rel in REQUIRED_FILES + OPTIONAL_FILES:
        path = repo / rel
        if path.is_file():
            files[rel] = path.read_bytes()
        elif rel in REQUIRED_FILES:
            missing.append(rel)
    for tree in TREES:
        root = repo / tree
        if not root.is_dir():
            missing.append(tree + "/")
            continue
        for path in sorted(root.rglob("*")):
            parts = path.relative_to(root).parts
            if not path.is_file() or any(p in SKIP_DIRS for p in parts[:-1]) or path.suffix in SKIP_SUFFIXES:
                continue
            files[path.relative_to(repo).as_posix()] = path.read_bytes()
    return files, missing


def publishable_problems(files, file_problems):
    """[(path, line, message)] for every file, by check_publishable's own rules."""
    found = []
    for rel, data in files.items():
        found += [(str(p), n, msg) for p, n, msg, _ in file_problems(PurePosixPath(rel), data)]
    return found


def stale_paths(files, built):
    """Plugin files that differ from `built`, a fresh build as {path inside the plugin: bytes}."""
    shipped = {rel[len(BUILT_PREFIX):]: data for rel, data in files.items() if rel.startswith(BUILT_PREFIX)}
    return ([f"added: {p}" for p in sorted(set(built) - set(shipped))]
            + [f"removed: {p}" for p in sorted(set(shipped) - set(built))]
            + [f"changed: {p}" for p in sorted(p for p in set(built) & set(shipped) if built[p] != shipped[p])])


def tree_summary(files):
    """[(file count, bytes, path)] one row per top-level entry, plugin entries two levels deeper."""
    count, size = Counter(), Counter()
    for rel, data in files.items():
        parts = rel.split("/")
        depth = 3 if rel.startswith(BUILT_PREFIX) else 1
        key = "/".join(parts[:depth]) + ("/" if len(parts) > depth else "")
        count[key] += 1
        size[key] += len(data)
    return [(count[k], size[k], k) for k in sorted(count)]


def check_target(repo, target):
    """An error message, or None when `target` is safe to write."""
    repo, target = repo.resolve(), target.resolve()
    if target == repo or repo in target.parents or target in repo.parents:
        return f"{target} is this repo, inside it, or holds it"
    if target.exists():
        if not target.is_dir():
            return f"{target} is not a directory"
        if any(target.iterdir()) and not (target / ".git").exists():
            return f"{target} is not empty and is not a git checkout (no .git)"
    return None


def write(files, target):
    target.mkdir(parents=True, exist_ok=True)
    for entry in target.iterdir():
        if entry.name == ".git":
            continue
        if entry.is_dir():
            shutil.rmtree(entry)
        else:
            entry.unlink()
    for rel, data in files.items():
        path = target / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)


def export(repo, target, plan, built=None, file_problems=None):
    """Run every check, then write unless `plan`. `built` is a callable returning a
    fresh build of the plugin as {path inside the plugin: bytes}. Returns the exit code."""
    if file_problems is None:
        file_problems = load_script("check_publishable").file_problems
    if target is not None:
        error = check_target(repo, target)
        if error:
            print(f"STOP: {error}", file=sys.stderr)
            return 2
    files, missing = collect(repo)
    print(f"{len(files)} files, {sum(len(d) for d in files.values()):,} bytes would be exported:")
    for n, size, path in tree_summary(files):
        print(f"  {n:5d} files {size:12,d} bytes  {path}")

    refused = []
    refused += [f"missing: {p}" for p in missing]
    problems = publishable_problems(files, file_problems)
    kinds = Counter(msg for _, _, msg in problems)
    for kind, n in sorted(kinds.items()):
        refused.append(f"{n} x {kind}")
    if built is not None and not missing:
        refused += [f"plugin is stale against its sources, {line}" for line in stale_paths(files, built())]
    if refused:
        print("\nREFUSED, nothing written:")
        for line in refused:
            print(f"  {line}")
        if problems:
            per_file = Counter(path for path, _, _ in problems)
            print(f"\n{len(problems)} problem(s) in {len(per_file)} exported files:")
            for path, n in per_file.most_common():
                print(f"  {n:5d}  {path}")
        return 1
    if plan:
        print("\nPLAN OK: every check passed. Nothing written.")
        return 0
    write(files, target)
    print(f"\nExported {len(files)} files to {target}")
    return 0


def main():
    sys.stdout.reconfigure(errors="backslashreplace")
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("target", nargs="?", type=Path, help="directory to write the export into")
    parser.add_argument("--plan", action="store_true", help="check and report; write nothing")
    parser.add_argument("--repo", type=Path, default=REPO, help="repo to export from (for tests)")
    args = parser.parse_args()
    if (args.target is None) == (not args.plan):
        parser.error("give a target directory, or --plan, not both and not neither")
    repo = args.repo.resolve()
    build_plugin = load_script("build_plugin")
    return export(repo, args.target, args.plan, built=lambda: build_plugin.collect(repo))


if __name__ == "__main__":
    sys.exit(main())
