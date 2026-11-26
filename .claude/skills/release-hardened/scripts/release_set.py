#!/usr/bin/env python3
"""
Print the release set for /release steps 2-3: each plugin to release, why, its change set
since its last bump, and the commands that rebuild each bundle that needs it.

Usage: python release_set.py [--repo <dir>]

Runs the repo's own scripts/build_plugin.py --check and scripts/release_changes.py, and
merges what they list. A plugin is released when --check calls it stale, when a
`released:` line names it, or when a `rebuild:` line names it. Its change set is
`git diff --name-status <last bump>..HEAD` over its inputs: its skills' folders,
source/skills/shared/, source/<plugin>/, and the build folder of each server it ships.
Read-only. Exit codes: 0 nothing to release, 1 something listed, 2 a stop.
"""

import argparse
import re
import subprocess
import sys
from pathlib import Path

# The commands that rebuild the bundles built from each folder, run from the repo root.
BUNDLE_COMMANDS = {
    "source/lawyer/mcp": [
        "node source/lawyer/mcp/node_modules/typescript/bin/tsc -p source/lawyer/mcp/tsconfig.json",
        "node source/lawyer/mcp/scripts/bundle.mjs",
    ],
    "source/researcher/commons-mcp": [
        "node source/researcher/commons-mcp/node_modules/typescript/bin/tsc -p source/researcher/commons-mcp/tsconfig.json",
        "node source/researcher/commons-mcp/scripts/bundle.mjs",
    ],
    "source/researcher/canlii-mcp": [
        "node source/researcher/canlii-mcp/scripts/bundle.mjs",
    ],
}

STALE = re.compile(r"[\\/]plugins[\\/]([^\\/]+) is stale: \d+ added")
CHECK_DETAIL = re.compile(r"^(added|removed|changed|mode): |[\\/]plugins[\\/][^\\/]+ is current$")
REBUILD = re.compile(r"^rebuild: (\S+) \(for ([^,]+), \d+ source files changed since [0-9a-f]+\)$")
RELEASED = re.compile(r"^released: (\S+) \(\d+ files under plugins/\S+/ changed since [0-9a-f]+\)$")
NOTHING = "nothing changed since each plugin's last bump"


def unhandled(value, where):
    """Stop on an input no scenario covers, instead of guessing."""
    sys.exit(f"error: unhandled input {value!r} in {where} (no scenario covers it)")


def run(repo, script, *args):
    """Run one of the repo's scripts. On its exit 2, pass its output on and stop."""
    result = subprocess.run([sys.executable, str(repo / "scripts" / script), *args, "--repo", str(repo)],
                            capture_output=True, text=True)
    if result.returncode == 2:
        sys.stdout.write(result.stdout)
        sys.stderr.write(result.stderr)
        print(f"stop: {script} exited 2")
        sys.exit(2)
    if result.returncode not in (0, 1):
        unhandled(result.returncode, f"{script} exit code")
    return result.returncode, result.stdout.splitlines()


def git(repo, *args):
    result = subprocess.run(["git", "-C", str(repo), *args], capture_output=True, text=True)
    if result.returncode != 0:
        print(f"STOP: git {' '.join(args)} failed: {result.stderr.strip()}", file=sys.stderr)
        sys.exit(2)
    return result.stdout


def process(repo):
    """Return the report lines and the exit code."""
    sources = {}  # plugin -> set of where it came from
    rebuilds = {}  # build folder -> set of plugins
    _, lines = run(repo, "build_plugin.py", "--check")
    for line in lines:
        if m := STALE.search(line):
            sources.setdefault(m.group(1), set()).add("check")
        elif not CHECK_DETAIL.search(line):
            unhandled(line, "build_plugin.py --check output")
    _, lines = run(repo, "release_changes.py")
    for line in lines:
        if m := REBUILD.match(line):
            folder, plugin = m.groups()
            if folder not in BUNDLE_COMMANDS:
                unhandled(folder, "rebuild folder")
            rebuilds.setdefault(folder, set()).add(plugin)
            sources.setdefault(plugin, set()).add("rebuild")
        elif m := RELEASED.match(line):
            sources.setdefault(m.group(1), set()).add("released")
        elif line != NOTHING:
            unhandled(line, "release_changes.py output")
    if not sources:
        return ["nothing to release"], 0

    sys.path.insert(0, str(repo / "scripts"))
    import plugin_layout
    specs = plugin_layout.plugins(repo)
    order = ("check", "released", "rebuild")
    out = []
    for folder in sorted(rebuilds):
        out.append(f"rebuild: {folder} (for {', '.join(sorted(rebuilds[folder]))})")
        out += [f"  run: {command}" for command in BUNDLE_COMMANDS[folder]]
    for name in sorted(sources):
        if name not in specs:
            unhandled(name, "released plugin")
        spec = specs[name]
        base = git(repo, "log", "-1", "--format=%H", "--", f"{spec['source']}/plugin.json").strip()
        if not base:
            print(f"STOP: no commit touches {spec['source']}/plugin.json, so '{name}' has no last bump",
                  file=sys.stderr)
            sys.exit(2)
        inputs = sorted({Path(plugin_layout.skill_dir(repo, s)).relative_to(repo).as_posix() for s in spec["skills"]}
                        | {"source/skills/shared", spec["source"]}
                        | {plugin_layout.SERVERS[s]["build"] for s in spec["servers"]})
        changes = git(repo, "diff", "--name-status", f"{base}..HEAD", "--", *inputs).splitlines()
        how = ", ".join(s for s in order if s in sources[name])
        out.append(f"released: {name} (last bump {base[:8]}; from {how})")
        out += [f"  {line}" for line in changes] or ["  (no change to its inputs since the bump)"]
    return out, 1


def main():
    parser = argparse.ArgumentParser(description="Print the release set for /release steps 2-3.")
    parser.add_argument("--repo", type=Path, help="repo root (default: the git toplevel of the current directory)")
    args = parser.parse_args()
    repo = args.repo or Path(git(Path.cwd(), "rev-parse", "--show-toplevel").strip())
    lines, code = process(repo.resolve())
    print("\n".join(lines))
    sys.exit(code)


if __name__ == "__main__":
    main()
