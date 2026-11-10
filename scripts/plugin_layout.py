#!/usr/bin/env python3
"""Which plugins this repo builds, read from source/assignment.json, and where each
plugin's skills, agents, hooks and servers are.

Every plugin under "plugins" is built from source/<plugin>/ into plugins/<plugin>/
with the skills, agents, hooks and servers the file gives it. The file's "status" is
"cutover"; the single-plugin layout it replaced is gone.

Imported by build_plugin.py, check_plugin.py, check_plugin_agents.py,
check_plugin_bundles.py, check_plugin_sources.py, check_public_tree.py,
check_layering.py, check_file_ops.py, check_internals.py, release_changes.py and
stamp_dependencies.py, so the file is read, and the layout is walked, in one place.
Standard library only.
"""
import json
import sys
from pathlib import Path

REPO = str(Path(__file__).resolve().parent.parent)
# Server key in .mcp.json -> its facts:
#   dir: the server's folder, in its plugin's source and in the built plugin. The
#        bundle is at <dir>/dist/.
#   build: the folder its bundle is built from. source/lawyer/mcp's bundle.mjs writes
#        the data, files, timecamp and contacts-calendars-email bundles.
#   entry: the source file the bundle starts from.
#   purity: whether its bundle is checked for Supabase and the commons tool namespace.
#        commons is exempt: it is the plugins' Supabase surface (check_plugin_bundles.py
#        says what the data bundle may carry).
#   host_path: whether its bundle is checked for an absolute host path.
SERVERS = {
    "data": {"dir": "mcp", "build": "source/lawyer/mcp", "entry": "source/lawyer/mcp/src/index.ts",
             "purity": True, "host_path": True},
    "canlii": {"dir": "canlii-mcp", "build": "source/researcher/canlii-mcp",
               "entry": "source/researcher/canlii-mcp/src/index.ts", "purity": True, "host_path": True},
    "commons": {"dir": "commons-mcp", "build": "source/researcher/commons-mcp",
                "entry": "source/researcher/commons-mcp/src/index.ts", "purity": False, "host_path": True},
    "files": {"dir": "files-mcp", "build": "source/lawyer/mcp", "entry": "source/lawyer/mcp/src/file-manager-index.ts",
              "purity": True, "host_path": True},
    "timecamp": {"dir": "timecamp-mcp", "build": "source/lawyer/mcp", "entry": "source/lawyer/mcp/src/timecamp-index.ts",
                 "purity": True, "host_path": True},
    "contacts-calendars-email": {"dir": "contacts-calendars-email-mcp", "build": "source/lawyer/mcp",
                                 "entry": "source/lawyer/mcp/src/contacts-calendars-email-index.ts",
                                 "purity": True, "host_path": True},
}
SERVER_DIRS = {key: server["dir"] for key, server in SERVERS.items()}
# Skills already free of Trade Secrets live under public/, the source of the public
# repository, one skills folder per public plugin (a glob from the repo root). A skill
# lives there or under source/skills/, never both.
PUBLIC_SKILLS = "public/plugins/*/skills"
# Private skills, and one skills folder per public plugin (globs from the repo root).
SKILL_ROOTS = ("source/skills", PUBLIC_SKILLS)


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
    `skills` and `agents` (the names the assignment gives the plugin), `hooks`
    ({hook name: its script, from the repo root}), `payload` (files and folders of the
    plugin's source copied whole), `executables` (payload files marked executable) and
    `shared` (whether the shared/ tree ships in it; it does unless the assignment says false)."""
    assignment = load(repo)
    specs = {}
    for name, given in assignment["plugins"].items():
        unknown = sorted(set(given["servers"]) - set(SERVERS))
        if unknown:
            stop(f"source/assignment.json gives {name} a server with no entry in SERVERS: " + ", ".join(unknown))
        specs[name] = {"name": name, "source": f"source/{name}", "requires": list(given["requires"]),
                       "servers": list(given["servers"]), "skills": list(given["skills"]),
                       "agents": list(given["agents"]), "hooks": dict(given.get("hooks", {})),
                       "payload": list(given.get("payload", [])),
                       "executables": list(given.get("executables", [])),
                       "shared": given.get("shared", True)}
    return specs


def server_owner(repo, server):
    """The one built plugin that ships a server."""
    owners = [p for p in plugins(repo).values() if server in p["servers"]]
    if len(owners) != 1:
        raise ValueError(f"{len(owners)} built plugins ship the {server} server, expected 1")
    return owners[0]


def public_skill_dirs(repo):
    """{skill name: its folder} for every skill under a public plugin."""
    found = {}
    for path in sorted(Path(repo).glob(PUBLIC_SKILLS + "/*")):
        if path.is_dir():
            if path.name in found:
                stop(f"skill '{path.name}' is under two public plugins: {found[path.name]} and {path}")
            found[path.name] = path
    return found


def skill_dir(repo, skill):
    """A skill's source folder: its public folder if it has one, else under source/skills/."""
    return public_skill_dirs(repo).get(skill) or Path(repo) / "source" / "skills" / skill


def skill_owners(plugins):
    """{skill name: the plugin it is given to}. `plugins` is plugins(repo)."""
    return {s: p for p, spec in plugins.items() for s in spec["skills"]}


def skill_folders(repo, plugins):
    """(skills root, skill folder, owning plugin) for every folder under SKILL_ROOTS.
    shared/ is owned by the plugin "shared". `plugins` is plugins(repo)."""
    repo = Path(repo)
    owner = skill_owners(plugins)
    for root in sorted(r for pattern in SKILL_ROOTS for r in repo.glob(pattern)):
        if not root.is_dir():
            continue
        for top in sorted(p for p in root.iterdir() if p.is_dir()):
            plugin = "shared" if top.name == "shared" else owner.get(top.name)
            if plugin is None:
                raise SystemExit(f"STOP: skill folder {top} has no plugin in source/assignment.json")
            yield root, top, plugin


def agent_files(repo, plugin):
    """The agent files in a plugin's source/<plugin>/agents/."""
    return sorted((Path(repo) / "source" / plugin / "agents").glob("*.md"))


def hook_scripts(repo, spec):
    """The scripts of a plugin's hooks, from its spec in plugins(repo)."""
    return sorted(Path(repo) / path for path in spec["hooks"].values())


def source_files(repo, plugin, sub):
    """Every file directly in source/<plugin>/<sub>/ that the build ships."""
    folder = Path(repo) / "source" / plugin / sub
    return sorted(p for p in folder.iterdir() if p.is_file() and p.suffix != ".pyc") if folder.is_dir() else []
