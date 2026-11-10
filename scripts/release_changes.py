#!/usr/bin/env python3
"""List what changed since each plugin's last version bump, for /release step 2.

Usage:
  python scripts/release_changes.py               compare HEAD with each plugin's last bump
  python scripts/release_changes.py --repo <dir>  read another checkout (for tests)

`build_plugin.py --check` compares source with plugins/ only. It misses a server
source changed without a bundle rebuild, and a built file committed without a bump.
This script compares HEAD with the commit of each plugin's last bump
(the last commit to touch source/<plugin>/plugin.json) and prints:

  rebuild: <folder> (for <plugin>)   a bundle built from <folder> must be rebuilt
  released: <plugin> (...)           plugins/<plugin>/ changed since the bump

Exit codes: 0 nothing listed, 1 something listed, 2 a stop. Standard library only.
"""
import argparse
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import plugin_layout  # noqa: E402

REPO = Path(__file__).resolve().parent.parent

SHARED_SRC = "source/mcp-shared/"
# The data bundle bakes in this script's schema version.
MIGRATE_ENGINE = "source/skills/drafting-data/references/scripts/migrate_engine.py"


stop = plugin_layout.stop


def git(repo, *args):
    result = subprocess.run(["git", "-C", str(repo), *args], capture_output=True, text=True)
    if result.returncode != 0:
        stop(f"git {' '.join(args)} failed: {result.stderr.strip()}")
    return result.stdout


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--repo", type=Path, default=REPO, help="repo to read (for tests)")
    repo = parser.parse_args().repo.resolve()
    listed = False
    for name, spec in plugin_layout.plugins(repo).items():
        base = git(repo, "log", "-1", "--format=%H", "--", f"{spec['source']}/plugin.json").strip()
        if not base:
            stop(f"no commit touches {spec['source']}/plugin.json, so '{name}' has no last bump")
        changed = git(repo, "diff", "--name-only", f"{base}..HEAD").splitlines()
        for folder in sorted({plugin_layout.SERVERS[s]["build"] for s in spec["servers"]}):
            triggers = (f"{folder}/src/", f"{folder}/scripts/", SHARED_SRC)
            hits = [p for p in changed if p.startswith(triggers)
                    or (p == MIGRATE_ENGINE and "data" in spec["servers"])]
            if hits:
                print(f"rebuild: {folder} (for {name}, {len(hits)} source files changed since {base[:8]})")
                listed = True
        built = [p for p in changed if p.startswith(f"plugins/{name}/")]
        if built:
            print(f"released: {name} ({len(built)} files under plugins/{name}/ changed since {base[:8]})")
            listed = True
    if not listed:
        print("nothing changed since each plugin's last bump")
    return 1 if listed else 0


if __name__ == "__main__":
    sys.exit(main())
