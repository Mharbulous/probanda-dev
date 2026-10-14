#!/usr/bin/env python3
"""Export public/ into a directory, for the public repo.

Usage:
  python scripts/export_public.py <target>   check, then write the export into <target>
  python scripts/export_public.py --plan     check and report what would be exported; write nothing

The export is one-way: this repo is developed in, and the public repo is only
ever written from here. What ships is public/, file for file, and nothing
else in this repo. Before anything is written:

  - every file passes check_public_tree (no Trade Secret, no User Data), and
  - every file matches public-approved.json, the list a person approved with
    approve_public.py. A file that is new, changed or removed since stops it.

Any failure stops the export with nothing written.

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
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SCRIPTS = Path(__file__).resolve().parent

# The plugins of the public repository, each under public/plugins/<name>/.
PUBLIC_PLUGINS = ("practice", "research", "litigator", "solicitor")
# What a marketplace install needs. The export refuses without them.
REQUIRED_FILES = (".claude-plugin/marketplace.json", "README.md",
                  *(f"plugins/{name}/.claude-plugin/plugin.json" for name in PUBLIC_PLUGINS))


def load_script(name):
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


public_tree = load_script("check_public_tree")


def tree_summary(files):
    """[(file count, bytes, path)] one row per top-level entry, plugin entries two levels deeper."""
    count, size = Counter(), Counter()
    for rel, data in files.items():
        parts = rel.split("/")
        depth = 3 if rel.startswith(tuple(f"plugins/{name}/" for name in PUBLIC_PLUGINS)) else 1
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


def export(repo, target, plan):
    """Run every check, then write unless `plan`. Returns the exit code."""
    if target is not None:
        error = check_target(repo, target)
        if error:
            print(f"STOP: {error}", file=sys.stderr)
            return 2
    files = public_tree.public_files(repo)
    print(f"{len(files)} files, {sum(len(d) for d in files.values()):,} bytes would be exported:")
    for n, size, path in tree_summary(files):
        print(f"  {n:5d} files {size:12,d} bytes  {path}")

    refused = [f"missing: {public_tree.PUBLIC}/{p}" for p in REQUIRED_FILES if p not in files]
    problems = public_tree.problems_in(repo, files)
    refused += [f"{public_tree.PUBLIC}/{rel}:{lineno}: {message}" for rel, lineno, message in problems]
    refused += [f"not approved, {line}" for line in
                public_tree.approval_diff(public_tree.digests(files), public_tree.load_approved(repo))]
    if refused:
        print("\nREFUSED, nothing written:")
        for line in refused:
            print(f"  {line}")
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
    return export(args.repo.resolve(), args.target, args.plan)


if __name__ == "__main__":
    sys.exit(main())
