#!/usr/bin/env python3
"""Write each released plugin's dependency ranges into source/<plugin>/plugin.json.

Usage:
  python scripts/stamp_dependencies.py <released plugin> ...
  python scripts/stamp_dependencies.py --first-ranges <released plugin> ...

Run by /release step 5, after the version bumps and before the build. Names come from
`requires` in source/assignment.json, the marketplace from .claude-plugin/marketplace.json,
and each range is ^<the dependency's current version>.

A plugin listed in check_plugin_baselines/dependency_ranges_pending.json keeps its bare
names until the first release with ranges, which needs Brahm's go-ahead. --first-ranges
is that release: it stamps pending plugins, takes each off the list, and deletes the
list once it is empty. Without it, a pending plugin is left as it is.

A plugin not named here is left behind when its entries no longer hold, as when a
dependency went up a minor version. It must be released too: bump it and run this again
with it added. Each line printed starts with `stamped:`, `pending:` or `left behind:`.

Exit codes: 0 no plugin left behind, 1 a plugin left behind, 2 bad arguments.
Standard library only.
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import plugin_layout  # noqa: E402
from check_plugin_sources import (  # noqa: E402
    marketplace_name, range_problems, ranges_pending, ranges_pending_path, read_manifest, source_path)


def write_json(path, data):
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(json.dumps(data, indent=2, ensure_ascii=False) + "\n")


def stamp(repo, spec, specs):
    """Write one plugin's ranges and return them as text."""
    entries = [{"name": name, "marketplace": marketplace_name(repo),
                "version": "^" + read_manifest(repo, specs[name])["version"]} for name in spec["requires"]]
    manifest = read_manifest(repo, spec)
    manifest["dependencies"] = entries
    write_json(source_path(repo, spec, "plugin.json"), manifest)
    return ", ".join(f"{entry['name']} {entry['version']}" for entry in entries)


def save_pending(repo, pending):
    path = ranges_pending_path(repo)
    if pending:
        write_json(path, {"pending": sorted(pending)})
    elif os.path.exists(path):
        os.remove(path)


def run(repo, released, first_ranges=False):
    """Stamp the released plugins. Returns (lines to print, whether a plugin is left behind)."""
    specs = plugin_layout.plugins(repo)
    pending = ranges_pending(repo)
    lines = []
    for name in released:
        if not specs[name]["requires"]:
            continue
        if name in pending and not first_ranges:
            lines.append(f"pending: {name} keeps its bare names until the first release with ranges")
            continue
        lines.append(f"stamped: {name}: {stamp(repo, specs[name], specs)}")
        pending.discard(name)
    if first_ranges:
        save_pending(repo, pending)
    behind = [f"left behind: {name}: " + "; ".join(problems) for name, spec in specs.items()
              if (first_ranges or name not in pending) and (problems := range_problems(repo, spec))]
    return lines + behind, bool(behind)


def main(argv=None, repo=plugin_layout.REPO):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--first-ranges", action="store_true",
                        help="stamp pending plugins too: the first release with ranges")
    parser.add_argument("released", nargs="+", help="the plugins this release bumped")
    args = parser.parse_args(argv)
    unknown = sorted(set(args.released) - set(plugin_layout.plugins(repo)))
    if unknown:
        print("STOP: not a plugin in source/assignment.json: " + ", ".join(unknown), file=sys.stderr)
        return 2
    lines, left_behind = run(repo, args.released, args.first_ranges)
    for line in lines:
        print(line)
    return 1 if left_behind else 0


if __name__ == "__main__":
    sys.exit(main())
