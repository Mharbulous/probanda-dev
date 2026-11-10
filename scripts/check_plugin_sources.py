"""Repo layout, roster and skill lookup, and whole-tree text scans, for check_plugin.py."""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import plugin_layout  # noqa: E402
from cowork_rules import RESERVED  # noqa: E402

BASELINES = os.path.join(os.path.dirname(os.path.abspath(__file__)), "check_plugin_baselines")

COMMONS_SKILL = "legal-commons"
# Skill trees that ship beside the roster skills, unstamped: shared/ in every
# plugin whose assignment does not say "shared": false, legal-commons in the plugin
# the assignment gives it to.
SHARED_TREE = "shared"
EXTRA_TREES = (SHARED_TREE, COMMONS_SKILL)
# The agent merged in from legal-commons' read side.
COMMONS_AGENTS = ("tech-support",)

# Forbidden database-particular tokens in the legal-commons gatekeeper skill:
# matter data is reached only through /matter-data, never by naming a local DB file.
COMMONS_FORBIDDEN = ["sqlite3", "law.sqlite", "main.sqlite", "privileged.sqlite", "practice.db"]

# An absolute host path baked into a bundle or shipped text. Backslash-only for the
# drive form, so "p:/" inside "http://" is not a hit; the drive letter must stand alone.
HOST_PATH = re.compile(r"(?<![A-Za-z0-9_])[A-Za-z]:[\\]{1,2}|/(?:home|Users)/[A-Za-z0-9._-]+/")
# A linked-worktree path, kept only to specialise the bundle-no-host-path message.
WORKTREE_PATH = re.compile(r"\.claude[\\/]+worktrees[\\/]+")

# The range form stamp_dependencies.py writes, the only one a dependency entry may hold.
CARET_RANGE = re.compile(r"\^(\d+\.\d+\.\d+)")
# Lists the plugins that keep bare-name dependencies until the first release with ranges.
# That release empties the list and deletes the file (stamp_dependencies.py --first-ranges).
RANGES_PENDING = ("scripts", "check_plugin_baselines", "dependency_ranges_pending.json")


class NotApplicable(Exception):
    """Raised by a check that guards something the plugin does not ship. The message
    says what, and the check prints as N/A."""


def skills_root(repo):
    return os.path.join(repo, "source", "skills")


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
    return tuple(t for t in EXTRA_TREES if (t == SHARED_TREE and plugin["shared"]) or ships_skill(plugin, t))


def public_skill_dirs(repo):
    """{skill name: its folder} for every skill under a public plugin."""
    return {s: str(d) for s, d in plugin_layout.public_skill_dirs(repo).items()}


def public_skills(repo, plugin):
    """The public skills the plugin ships."""
    return sorted(s for s in public_skill_dirs(repo) if ships_skill(plugin, s))


def skill_names(repo, plugin):
    """Every skill whose SKILL.md ships: the roster keys, legal-commons and the public skills."""
    return (sorted(roster(repo, plugin)) + [s for s in (COMMONS_SKILL,) if ships_skill(plugin, s)]
            + public_skills(repo, plugin))


def skill_md(repo, skill):
    return os.path.join(str(plugin_layout.skill_dir(repo, skill)), "SKILL.md")


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
    reserved = [s for s in skill_names(repo, plugin) if RESERVED.search(s)]
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


def read_manifest(repo, plugin):
    with open(source_path(repo, plugin, "plugin.json"), encoding="utf-8") as f:
        return json.load(f)


def marketplace_name(repo):
    """This repo's marketplace name: what every dependency entry here must name."""
    with open(os.path.join(repo, ".claude-plugin", "marketplace.json"), encoding="utf-8") as f:
        return json.load(f)["name"]


def ranges_pending_path(repo):
    return os.path.join(repo, *RANGES_PENDING)


def ranges_pending(repo):
    """The plugins whose bare-name dependencies wait for the first release with ranges."""
    try:
        with open(ranges_pending_path(repo), encoding="utf-8") as f:
            return set(json.load(f)["pending"])
    except FileNotFoundError:
        return set()


def caret_accepts(floor, version):
    """Whether ^floor accepts version, by the caret rule: the first non-zero number of
    the floor stays fixed. Below 1.0 that keeps a range within one minor version."""
    low = tuple(int(n) for n in floor.split("."))
    fixed = next((i for i, n in enumerate(low) if n), len(low) - 1)
    high = low[:fixed] + (low[fixed] + 1,) + (0,) * (len(low) - fixed - 1)
    return low <= tuple(int(n) for n in version.split(".")) < high


def range_problems(repo, plugin):
    """Why this plugin's dependency entries would not hold it to a working copy of each
    dependency. An entry needs its marketplace, because synced plugins ignore the range
    of an entry that names none (Step 0 of docs/Plans/2026-11-02_plugin-version-requirements.md)."""
    specs = plugin_layout.plugins(repo)
    problems = []
    for entry in read_manifest(repo, plugin).get("dependencies", []):
        if not isinstance(entry, dict):
            problems.append(f"'{entry}' has no version range and names no marketplace")
            continue
        name, market, wanted = entry.get("name"), entry.get("marketplace"), entry.get("version")
        if market is None:
            problems.append(f"'{name}' names no marketplace")
        elif market != marketplace_name(repo):
            problems.append(f"'{name}' names the marketplace '{market}', expected '{marketplace_name(repo)}'")
        if wanted is None:
            problems.append(f"'{name}' has no version range")
            continue
        caret = CARET_RANGE.fullmatch(wanted)
        if not caret:
            problems.append(f"'{name}' has the range '{wanted}', expected ^X.Y.Z")
            continue
        current = read_manifest(repo, specs[name])["version"]
        if not caret_accepts(caret.group(1), current):
            problems.append(f"'{name}' has the range '{wanted}', which leaves out its current version {current}: "
                            f"{plugin['name']} would be disabled with no working version to update to, "
                            "so release it in the same commit")
    return problems


def check_dependencies(repo, plugin):
    """The host installs and enforces what plugin.json declares, and the build, the
    hook-matchers check and the layering check trust what the assignment says."""
    declared = read_manifest(repo, plugin).get("dependencies", [])
    names = sorted(entry.get("name", "") if isinstance(entry, dict) else entry for entry in declared)
    if names != sorted(plugin["requires"]):
        return False, (f"plugin.json declares {names}, but source/assignment.json "
                       f"requires {sorted(plugin['requires'])}")
    if plugin["name"] in ranges_pending(repo):
        if declared and all(isinstance(entry, str) for entry in declared):
            return True, "bare names until the first release with ranges"
        return False, f"{'/'.join(RANGES_PENDING)} lists {plugin['name']}, which has no bare-name dependencies"
    problems = range_problems(repo, plugin)
    return not problems, "; ".join(problems)
