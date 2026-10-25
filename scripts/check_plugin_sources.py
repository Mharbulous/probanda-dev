"""Repo layout, roster and skill lookup, and whole-tree text scans, for check_plugin.py."""
import glob
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import plugin_layout  # noqa: E402

BASELINES = os.path.join(os.path.dirname(os.path.abspath(__file__)), "check_plugin_baselines")

COMMONS_SKILL = "legal-commons"
# Skill trees that ship beside the roster skills, unstamped: shared/ in every
# plugin, legal-commons in the plugin the assignment gives it to.
SHARED_TREE = "shared"
EXTRA_TREES = (SHARED_TREE, COMMONS_SKILL)
# Skills already free of Trade Secrets live here, the source of the public repository,
# one skills folder per public plugin, and ship whole and unstamped. A skill lives
# here or under .claude/skills/, never both.
PUBLIC_SKILLS = ("public", "plugins", "*", "skills")
# The agent merged in from legal-commons' read side.
COMMONS_AGENTS = ("troubleshooter",)

# Forbidden database-particular tokens in the legal-commons gatekeeper skill:
# matter data is reached only through /matter-data, never by naming a local DB file.
COMMONS_FORBIDDEN = ["sqlite3", "law.sqlite", "main.sqlite", "privileged.sqlite", "practice.db"]

# Cowork treats "claude" as a reserved word in installed skill names and silently
# renames on install. Segment match only, so prose is never scanned.
RESERVED_NAME = re.compile(r"(?:^|[-_.])claude(?:[-_.]|$)", re.IGNORECASE)

# An absolute host path baked into a bundle or shipped text. Backslash-only for the
# drive form, so "p:/" inside "http://" is not a hit; the drive letter must stand alone.
HOST_PATH = re.compile(r"(?<![A-Za-z0-9_])[A-Za-z]:[\\]{1,2}|/(?:home|Users)/[A-Za-z0-9._-]+/")
# A linked-worktree path, kept only to specialise the bundle-no-host-path message.
WORKTREE_PATH = re.compile(r"\.claude[\\/]+worktrees[\\/]+")


class NotApplicable(Exception):
    """Raised by a check that guards something the plugin does not ship. The message
    says what, and the check prints as N/A."""


def skills_root(repo):
    return os.path.join(repo, ".claude", "skills")


def source_path(repo, plugin, *parts):
    return os.path.join(repo, *plugin["source"].split("/"), *parts)


def server_path(repo, plugin, server, *parts):
    """A path inside the source folder of a server the plugin ships."""
    if server not in plugin["servers"]:
        raise NotApplicable(f"{plugin['name']} does not ship the {server} server")
    return source_path(repo, plugin, plugin_layout.SERVER_DIRS[server], *parts)


def ships_skill(plugin, skill):
    return skill in plugin["skills"]


def ships_agent(plugin, agent):
    return agent in plugin["agents"]


def agents_dir(repo, plugin):
    if plugin["agents"] == []:
        raise NotApplicable(f"{plugin['name']} ships no agent")
    return source_path(repo, plugin, "agents")


def agent_names(repo, plugin):
    """The agents the plugin ships: the assignment's list."""
    return sorted(plugin["agents"])


def roster(repo, plugin):
    """Skill -> declared asset dirs, read from the plugin's roster.json."""
    with open(source_path(repo, plugin, "roster.json"), encoding="utf-8") as f:
        return json.load(f)


def packaged_assets(repo, plugin):
    return {s: tuple(d) for s, d in roster(repo, plugin).items() if d}


def extra_trees(plugin):
    return tuple(t for t in EXTRA_TREES if t == SHARED_TREE or ships_skill(plugin, t))


def public_skill_dirs(repo):
    """{skill name: its folder} for every skill under a public plugin."""
    return {os.path.basename(d): d for d in sorted(glob.glob(os.path.join(repo, *PUBLIC_SKILLS, "*")))
            if os.path.isdir(d)}


def public_skills(repo, plugin):
    """The public skills the plugin ships."""
    return sorted(s for s in public_skill_dirs(repo) if ships_skill(plugin, s))


def skill_names(repo, plugin):
    """Every skill whose SKILL.md ships: the roster keys, legal-commons and the public skills."""
    return (sorted(roster(repo, plugin)) + [s for s in (COMMONS_SKILL,) if ships_skill(plugin, s)]
            + public_skills(repo, plugin))


def skill_md(repo, skill):
    return os.path.join(public_skill_dirs(repo).get(skill) or os.path.join(skills_root(repo), skill), "SKILL.md")


# --- scanning --------------------------------------------------------------------------


def grep_tree(repo, skill, needles_ci=(), needles_cs=()):
    """Return (needle, relpath) hits across a skill's whole source tree."""
    root = os.path.join(skills_root(repo), skill)
    hits = []
    for dirpath, _dirs, files in os.walk(root):
        if "__pycache__" in dirpath:
            continue
        for fn in files:
            if fn.endswith(".pyc"):
                continue
            p = os.path.join(dirpath, fn)
            try:
                with open(p, encoding="utf-8") as f:
                    text = f.read()
            except (UnicodeDecodeError, OSError):
                continue
            low = text.lower()
            rel = os.path.relpath(p, skills_root(repo)).replace(os.sep, "/")
            for n in needles_ci:
                if n.lower() in low:
                    hits.append((n, rel))
            for n in needles_cs:
                if n in text:
                    hits.append((n, rel))
    return hits


def grep_dir(repo, root, needles_ci, skip=()):
    """Return (needle, repo-relpath) hits across every readable text file under a
    directory tree, file names in `skip` excepted."""
    hits = []
    if not os.path.isdir(root):
        return hits
    for dirpath, _dirs, files in os.walk(root):
        if "__pycache__" in dirpath:
            continue
        for fn in files:
            if fn.endswith(".pyc") or fn in skip:
                continue
            p = os.path.join(dirpath, fn)
            try:
                with open(p, encoding="utf-8") as f:
                    low = f.read().lower()
            except (UnicodeDecodeError, OSError):
                continue
            rel = os.path.relpath(p, repo).replace(os.sep, "/")
            for n in needles_ci:
                if n.lower() in low:
                    hits.append((n, rel))
    return hits


def check_roster_sanity(repo, plugin):
    names = skill_names(repo, plugin)
    missing = [s for s in names if not os.path.isfile(skill_md(repo, s))]
    if missing:
        return False, "missing source for: " + ", ".join(missing)
    if set(plugin["skills"]) != set(names):
        return False, ("roster.json and source/assignment.json disagree on: "
                       + ", ".join(sorted(set(plugin["skills"]) ^ set(names))))
    return True, ""


def check_reserved_name(repo, plugin):
    reserved = [s for s in skill_names(repo, plugin) if RESERVED_NAME.search(s)]
    return not reserved, ("rename: " + ", ".join(reserved)) if reserved else ""


def check_inverse_reference(repo, plugin):
    if set(COMMONS_AGENTS) <= set(plugin["agents"]):
        return True, f"{plugin['name']} ships the commons agents: " + ", ".join(COMMONS_AGENTS)
    needles = COMMONS_AGENTS
    inv_hits = []
    for s in sorted(roster(repo, plugin)):
        inv_hits.extend(grep_tree(repo, s, needles_ci=needles))
    inv_hits.extend(grep_dir(repo, source_path(repo, plugin, "agents"), needles,
                             skip={f"{a}.md" for a in COMMONS_AGENTS}))
    if inv_hits:
        return False, "; ".join(f"'{n}' in {rel}" for n, rel in sorted(set(inv_hits)))
    return True, "commons agents checked: " + ", ".join(COMMONS_AGENTS)


def check_commons_encapsulation(repo, plugin):
    if not ships_skill(plugin, COMMONS_SKILL):
        raise NotApplicable(f"{plugin['name']} does not ship the {COMMONS_SKILL} skill")
    enc_hits = grep_tree(repo, COMMONS_SKILL, needles_ci=COMMONS_FORBIDDEN)
    return not enc_hits, "; ".join(f"{rel} has '{n}'" for n, rel in enc_hits)


def check_dependencies(repo, plugin):
    """The host installs and enforces what plugin.json declares, and the build, the
    hook-matchers check and the layering check trust what the assignment says."""
    with open(source_path(repo, plugin, "plugin.json"), encoding="utf-8") as f:
        declared = json.load(f).get("dependencies", [])
    if sorted(declared) != sorted(plugin["requires"]):
        return False, (f"plugin.json declares {sorted(declared)}, but source/assignment.json "
                       f"requires {sorted(plugin['requires'])}")
    return True, ""
