#!/usr/bin/env python3
"""Which plugins this repo builds, read from source/assignment.json.

Every plugin under "plugins" is built from source/<plugin>/ into plugins/<plugin>/
with the skills, agents and servers the file gives it. The file's "status" is
"cutover"; the single-plugin layout it replaced is gone.

Imported by build_plugin.py, check_plugin.py and check_public_tree.py, so the
file is read in one place. Standard library only.
"""
import json
import sys
from pathlib import Path

REPO = str(Path(__file__).resolve().parent.parent)
# Server key in .mcp.json -> the server's folder, in its plugin's source and in the
# built plugin. The bundle is at <folder>/dist/.
SERVER_DIRS = {"data": "mcp", "canlii": "canlii-mcp", "commons": "commons-mcp", "files": "files-mcp",
               "timecamp": "timecamp-mcp", "contacts-calendars-email": "contacts-calendars-email-mcp"}
# Private skills, and one skills folder per public plugin (globs from the repo root).
SKILL_ROOTS = (".claude/skills", "public/plugins/*/skills")


def stop(message):
    print(f"STOP: {message}", file=sys.stderr)
    sys.exit(2)


def load(repo):
    path = Path(repo) / "source" / "assignment.json"
    if not path.is_file():
        stop(f"no {path}")
    assignment = json.loads(path.read_text(encoding="utf-8"))
    if assignment.get("status") != "cutover":
        stop(f"{path}: \"status\" is {assignment.get('status')!r}, expected \"cutover\"")
    return assignment


def plugins(repo):
    """{plugin name: spec} for every plugin built. A spec holds `name`, `source` (the
    plugin's source folder, from the repo root), `requires`, `servers` (server keys),
    and `skills` and `agents`: the names the assignment gives the plugin."""
    assignment = load(repo)
    specs = {}
    for name, given in assignment["plugins"].items():
        unknown = sorted(set(given["servers"]) - set(SERVER_DIRS))
        if unknown:
            stop(f"source/assignment.json gives {name} a server with no folder in SERVER_DIRS: " + ", ".join(unknown))
        specs[name] = {"name": name, "source": f"source/{name}", "requires": list(given["requires"]),
                       "servers": list(given["servers"]), "skills": list(given["skills"]),
                       "agents": list(given["agents"])}
    return specs


def server_owner(repo, server):
    """The one built plugin that ships a server."""
    owners = [p for p in plugins(repo).values() if server in p["servers"]]
    if len(owners) != 1:
        raise ValueError(f"{len(owners)} built plugins ship the {server} server, expected 1")
    return owners[0]
