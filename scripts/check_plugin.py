#!/usr/bin/env python3
"""Invariant checks for the Probanda plugin. Standard library only.

Usage:
  python scripts/check_plugin.py                         run every check; exit 1 on any FAIL
  python scripts/check_plugin.py skill-source-baseline   rewrite the shipped-tree-purity ratchet baseline

Ported from CoClerk's plugin-packager `direct_mode.py check litigation`, with
every path and identifier moved to this repo: skill sources under
.claude/skills/ (the keys of a plugin's roster.json, plus shared/ and
legal-commons/), plugin sources under source/<plugin>/, and the built plugin
under plugins/<plugin>/.

The checks run once for each plugin the repo builds (plugin_layout.py: the one
plugin probanda while source/assignment.json is "planned", every plugin in it at
"cutover"), then the checks across plugins run once. Each check prints one
`[PASS]` or `[FAIL]` line, or an `[N/A]` line saying why it does not apply to a
plugin that does not ship the skill, agent or server it guards; there are no
silent skips. The baselines live in check_plugin_baselines/ beside this file.
"""
import ast
import glob
import hashlib
import json
import os
import posixpath
import re
import sys
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import check_file_ops  # noqa: E402
import check_layering  # noqa: E402
import plugin_layout  # noqa: E402

REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), os.pardir))
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
# matter data is reached only through /case-data, never by naming a local DB file.
COMMONS_FORBIDDEN = ["sqlite3", "law.sqlite", "main.sqlite", "privileged.sqlite", "practice.db"]

# Python entry points the data runtime imports live from the skills tree. A rename
# in the file breaks the installed plugin with no failing test, so each entry pins
# the symbols, and `consumers` the runtime files whose `from <module> import ...`
# must stay a subset of them, as paths inside the source folder of `server`. An
# entry is checked in the plugin that ships that server. A symbol may be dotted
# one level ("Cls.meth").
ENTRY_POINT_REGISTRY = (
    {
        "path": ".claude/skills/drafting-data/references/scripts/migrate_engine.py",
        "symbols": ("run", "MigrateError", "MigrateError.as_dict", "TARGET_SCHEMA_VERSION"),
        "server": "data",
        "consumers": ("src/submission/migrate.ts",),
    },
)

# Cowork treats "claude" as a reserved word in installed skill names and silently
# renames on install. Segment match only, so prose is never scanned.
RESERVED_NAME = re.compile(r"(?:^|[-_.])claude(?:[-_.]|$)", re.IGNORECASE)

# Reference shapes for reference-resolution: the strings an agent would turn into a
# file read. The character classes admit no placeholder, glob or space.
TREE_PREFIX = re.compile(
    r"^.*[.](?:agents|claude)[\\/]+skills[\\/]+", re.IGNORECASE
)
REF_EXPLICIT = re.compile(
    r"[.](?:agents|claude)[\\/]+skills[\\/]+[^\s`'\")\]}>,;|]+"
)
REF_MDLINK = re.compile(r"\]\(([^)\s]+)\)")
REF_BACKTICK = re.compile(r"`((?:\.\./)*[A-Za-z0-9_-][A-Za-z0-9_.-]*(?:/[A-Za-z0-9_.-]+)+)`")
# A presence glob: prose telling an agent to find an installed file by searching.
# Checked against the built plugin tree, since it finds shipped files.
REF_PRESENCE_GLOB = re.compile(r"\*/\.remote-plugins/\*/skills/([^\s`'\")]+)")
HAS_EXT = re.compile(r"\.[A-Za-z0-9]{1,6}$")
URL_SCHEME = re.compile(r"^[a-z][a-z0-9+.-]*:")
DRIVE = re.compile(r"^[A-Za-z]:")
# Runtime-artifact vocabularies, not skills-tree paths: matter-workspace output dirs,
# OOXML zip internals, eval-run output dirs and GCP IAM role identifiers.
RUNTIME_DIRS = {"disclosed", "privileged", "word", "docProps",
                "iteration_dir", "evals", "roles"}
RUNTIME_FILES = {"ab-results.md"}
# A reference carrying a placeholder is a shape being described, not a path.
PLACEHOLDER = re.compile(r"[{}<>…]")   # … = the literal ellipsis "…"

# Cowork's plugin validator rejects a SKILL.md whose description contains an XML
# tag, or runs past 1024 characters, failing the whole upload.
XML_TAG = re.compile(r"<[/!a-zA-Z][^>]*>")
DESCRIPTION_MAX_CHARS = 1024
DESCRIPTION_WARN_CHARS = 950

# An absolute host path baked into a bundle or shipped text. Backslash-only for the
# drive form, so "p:/" inside "http://" is not a hit; the drive letter must stand alone.
HOST_PATH = re.compile(r"(?<![A-Za-z0-9_])[A-Za-z]:[\\]{1,2}|/(?:home|Users)/[A-Za-z0-9._-]+/")
# A linked-worktree path, kept only to specialise the bundle-no-host-path message.
WORKTREE_PATH = re.compile(r"\.claude[\\/]+worktrees[\\/]+")

# shipped-tree-purity re-derives the build's selection independently -- its own
# copies of the exclusions and the text-extension allowlist -- so a selection bug on
# either side reads as a disagreement. Change both copies together.
SHIPPED_PREFIX = "skills/"
VISION_FILE = "VISION.md"   # ships at the plugin root from source/<plugin>/
TREE_EXCLUDE_DIRS = ("__pycache__", "sessions", "tests", "determinizing-tests", "evals", ".pytest_cache")
TREE_TEXT_EXTS = (".md", ".py", ".sql", ".json")
TRANSIENT_ASSET_PREFIX = "~$"

# A client matter code. The shipped tree, and the agents beside it, ship to every install.
MATTER_CODE = re.compile(r"\bL\d{3,4}\b")
# UTBMS litigation task codes share the three-digit range with matter codes, so a
# code from this set is skipped only on a line that marks it as UTBMS.
UTBMS_TASK_CODES = frozenset((
    "L110", "L120", "L130", "L140", "L150", "L160", "L170", "L190",
    "L210", "L220", "L230", "L240", "L250",
    "L310", "L320", "L330", "L340", "L350", "L390",
    "L410", "L420", "L430", "L440", "L450", "L460", "L470",
    "L510", "L520", "L530",
))
UTBMS_CONTEXT = re.compile(r"\bL\d{3}/A\d{3}\b|^\s*\|\s*L\d{3}\s*\||utbms|task[ _]code", re.IGNORECASE)

# Ratchet over the host-path and matter-code hits the shipped prose already carries:
# repo-relative path -> allowed hit count, per scan. Paths and counts only, never the
# matched text. A count above its baseline, or any hit in an unlisted file, fails.
SKILL_SOURCE_BASELINE = os.path.join(BASELINES, "skill_source_baseline.json")
# Known `rel -> ref` reference-resolution hits. A listed hit passes; an unlisted one
# fails; a listed entry that no longer hits fails as stale, so the list only shrinks.
# Hand-edited, never regenerated.
REFERENCE_UNSHIPPED_BASELINE = os.path.join(BASELINES, "reference_unshipped_baseline.json")

# The hosts the data server's sources module ships with (mcp/src/sources/hosts.ts).
# A host is added here in the same change that adds it to that constant.
SOURCES_ALLOWED_HOSTS = ["www.bclaws.gov.bc.ca", "bclaws.gov.bc.ca", "vaniac.org", "laws-lois.justice.gc.ca"]
# A module's code in an esbuild bundle runs from its `// src/...` marker line to the
# next module marker; every `src/sources/` stretch is collected.
_BUNDLE_MODULE = re.compile(
    r"^// (\S+\.(?:ts|js|mjs|cjs))\n(.*?)(?=^// \S+\.(?:ts|js|mjs|cjs)\n|\Z)", re.M | re.S)
_SOURCES_NETWORK_CALL = re.compile(r"\b(?:https?\d*|transport)\.(?:request|get)\(|\bfetch\(")
_TOP_LEVEL_FUNCTION = re.compile(r"^(?:async )?function (\w+)\([^)]*\)\s*\{", re.M)

# The data server's bundle, inside that server's folder.
DATA_BUNDLE = ("dist", "litigation-mcp.js")
# Servers whose bundles are checked for Supabase and the commons tool namespace. commons
# is exempt: it is the plugins' Supabase surface. canlii and files must carry neither
# 'supabase' nor 'legal_commons__'. data may carry 'supabase', because its practice writes
# go to Probanda's Cloud, but only through the three items functions: every
# 'functions/v1/' path in it must be items-write, items-sync or items-seed, and it must
# carry no other functions path, no '/rest/v1/' and no 'legal_commons__'. So the data
# bundle is not checked for any other Supabase use, such as a Supabase client library.
PURITY_SERVERS = ("data", "canlii", "files")
DATA_FUNCTION_PATHS = ("functions/v1/items-write", "functions/v1/items-sync", "functions/v1/items-seed")
_FUNCTIONS_PATH = re.compile(r"functions/v1/[a-z0-9_-]*")
HOST_PATH_SERVERS = ("data", "canlii", "commons", "files")

FETCH_TOOL = "sources__fetch"
# The only agent files that may grant sources__fetch.
FETCH_GRANT_AGENTS = ("localize-helper.md", "legislation-fetcher.md")

# A Cowork Project session reaches plugin MCP servers through the desktop bridge,
# which renames every tool `mcp__remote-devices__<name>`, and a subagent grant that
# matches no live tool is dropped silently.
PLAIN_PREFIX = "mcp__plugin_"
BRIDGE_PREFIX = "mcp__remote-devices__"

RECITAL_RULE_SOURCE = ".claude/skills/shared/authority-claim-verification.md"
# The copies of the recital rule: files under .claude/skills/, each checked in the
# plugin that ships its skill (shared/ ships in every plugin), and agent files,
# each checked in the plugin that ships the agent.
RECITAL_RULE_SKILL_MIRRORS = (
    "shared/legal-audit-protocol.md",
    "case-brief/agents/brief.md",
    "verify-law/agents/verify-claim.md",
    "case-data/agents/verify-edges.md",
    "case-data/agents/extract-caselaw.md",
    "case-data/agents/verify-caselaw.md",
)
RECITAL_RULE_AGENT_MIRRORS = ("verify-claim", "verify-edges", "extract-caselaw", "verify-caselaw")
RECITAL_RULE_BLOCK = re.compile(r"<!-- recital-rule: begin.*?<!-- recital-rule: end -->", re.S)

# Hook events whose matcher is a pattern over tool names, and over agent names.
TOOL_EVENTS = ("PreToolUse", "PostToolUse")
AGENT_EVENTS = ("SubagentStart", "SubagentStop")
# A plugin tool (`plugin_<plugin>_<server>__`) and a plugin agent (`<plugin>:<agent>`)
# named in a matcher.
MATCHER_TOOL = re.compile(r"plugin_([A-Za-z0-9-]+)_([A-Za-z0-9-]+)__")
MATCHER_AGENT = re.compile(r"([A-Za-z0-9-]+):([A-Za-z0-9-]+)")


class NotApplicable(Exception):
    """Raised by a check that guards something the plugin does not ship. The message
    says what, and the check prints as N/A."""


# --- repo layout -------------------------------------------------------------------
# A `plugin` argument is one spec of built_plugins(): its name, source folder, the
# plugins it requires, its servers, and the skills and agents the assignment gives it
# (None while the one plugin ships everything).

def built_plugins(repo):
    """{name: spec} for every plugin the repo builds (plugin_layout.plugins)."""
    return plugin_layout.plugins(repo)


def skills_root(repo):
    return os.path.join(repo, ".claude", "skills")


def source_path(repo, plugin, *parts):
    return os.path.join(repo, *plugin["source"].split("/"), *parts)


def server_path(repo, plugin, server, *parts):
    """A path inside the source folder of a server the plugin ships."""
    if server not in plugin["servers"]:
        raise NotApplicable(f"{plugin['name']} does not ship the {server} server")
    return source_path(repo, plugin, plugin_layout.SERVER_DIRS[server], *parts)


def server_owner(repo, server):
    """The one built plugin that ships a server."""
    owners = [p for p in built_plugins(repo).values() if server in p["servers"]]
    if len(owners) != 1:
        raise ValueError(f"{len(owners)} built plugins ship the {server} server, expected 1")
    return owners[0]


def ships_skill(plugin, skill):
    return plugin["skills"] is None or skill in plugin["skills"]


def ships_agent(plugin, agent):
    return plugin["agents"] is None or agent in plugin["agents"]


def agents_dir(repo, plugin):
    if plugin["agents"] == []:
        raise NotApplicable(f"{plugin['name']} ships no agent")
    return source_path(repo, plugin, "agents")


def agent_names(repo, plugin):
    """The agents the plugin ships: the assignment's list, or every agent file in its
    source while the one plugin ships everything."""
    if plugin["agents"] is not None:
        return sorted(plugin["agents"])
    return sorted(os.path.basename(p)[:-len(".md")] for p in glob.glob(source_path(repo, plugin, "agents", "*.md")))


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


# --- frontmatter ---------------------------------------------------------------------

def read_frontmatter_lines(skill_md_path):
    """Return the raw lines between the first two `---` fences (exclusive)."""
    with open(skill_md_path, encoding="utf-8") as f:
        lines = f.read().split("\n")
    if not lines or lines[0].strip() != "---":
        raise ValueError(f"{skill_md_path}: no leading '---' frontmatter fence")
    for i in range(1, len(lines)):
        if lines[i].strip() == "---":
            return lines[1:i]
    raise ValueError(f"{skill_md_path}: unterminated frontmatter")


def extract_field(fm_lines, key):
    """A frontmatter field's raw block: the `key:` line plus any indented continuation
    lines. Returns the list of raw lines, or None if absent."""
    out = None
    for idx, line in enumerate(fm_lines):
        if line.startswith(key + ":"):
            out = [line]
            for cont in fm_lines[idx + 1:]:
                if cont.strip() == "":
                    out.append(cont)
                    continue
                if cont[0] in (" ", "\t"):
                    out.append(cont)
                else:
                    break
            while out and out[-1].strip() == "":
                out.pop()
            return out
    return None


def scalar_value(block_lines):
    """Reconstruct a frontmatter field's YAML scalar value from its raw block, so that
    len() of the result is the character count Cowork's validator applies. Handles
    plain scalars, `>` folded and `|` literal blocks, and the `-`/`+`/bare chomping
    indicators; anything rarer errs toward over-counting, never a false pass."""
    first = block_lines[0].split(":", 1)[1].strip()
    cont = block_lines[1:]

    if not first or first[0] not in "|>":
        parts = [first] + [c.strip() for c in cont]
        return " ".join(p for p in parts if p)

    style = first[0]
    chomp = "".join(c for c in first[1:] if c in "-+")
    indent = min((len(c) - len(c.lstrip(" ")) for c in cont if c.strip()), default=0)
    body = [c[indent:] for c in cont]

    if style == "|":
        text = "\n".join(body)
    else:
        out, after_blank = [], False
        for line in body:
            if not line.strip():
                out.append("\n")
                after_blank = True
            else:
                if out and not after_blank:
                    out.append(" ")
                out.append(line)
                after_blank = False
        text = "".join(out)

    text = text.rstrip("\n")
    if chomp != "-":
        text += "\n"
    return text


def description_length(skill_md_path):
    """Folded character count of a SKILL.md's description, or None if it has none."""
    block = extract_field(read_frontmatter_lines(skill_md_path), "description")
    return len(scalar_value(block)) if block else None


def preamble_lines(plugin_name, version):
    """The lines stamp_skill_md() inserts after a shipped roster SKILL.md's frontmatter.
    The build carries its own copy; shipped-tree-purity is what catches a disagreement."""
    return [
        f"<!-- {plugin_name} v{version} -->",
        "> **Installed copy.** This skill's full source tree ships beside this file, and a relative "
        "path in the text below cites that tree. Resolve one by trying, in order: the directory of "
        "the file you are reading, then `${CLAUDE_SKILL_DIR}/<path>`, then "
        "`${CLAUDE_SKILL_DIR}/../<path>` (so `shared/x.md` is at `${CLAUDE_SKILL_DIR}/../shared/x.md`). "
        "The host substitutes `${CLAUDE_SKILL_DIR}` with the directory holding this SKILL.md when this "
        "file loads; if the literal text `${CLAUDE_SKILL_DIR}` is what you see, that IS the definition: "
        "it means the directory containing this SKILL.md, not a placeholder to search for or guess. "
        "Read references and shared files natively from there, never over the litigation data "
        "server's skill-source tool and never by requesting folder access; scripts and templates the "
        "text declares are executed and read from there too. If `${CLAUDE_SKILL_DIR}` itself no "
        "longer exists, the plugin was re-synced mid-session: list only `${CLAUDE_SKILL_DIR}/../../..` "
        "(the folder that held this plugin's folder), take the folder named as this plugin's folder "
        "with any `~g<N>` suffix removed plus the highest `~g<N>`, and repeat the same three tries "
        "with its `skills/<this skill>` directory in place of `${CLAUDE_SKILL_DIR}`; tell the user "
        "once that the plugin updated mid-session, from the version in this file's version comment "
        "to the version in that folder's copy of this SKILL.md. If a file the text names is missing "
        "at every one of those paths, including the re-synced folder's, STOP and report the exact path and error to the user rather than "
        "substituting an alternative: do not re-derive a script's logic from its source text or the "
        "prose, and do not search elsewhere on the filesystem. Ask the user to reinstall the plugin "
        "and fully restart the app; this may fix it, but STOP means stop regardless: do not diagnose "
        "further yourself.",
        "> **HTML pages.** Every HTML file this plugin writes is a human interface generated from its "
        "databases; an agent never views, reads, greps, parses, scripts over, stages, authors or "
        "requests a screenshot of one, but may present one to a human user to view, and may view a "
        "screenshot the user provides on their own initiative. The rule and the data to use instead: "
        "`shared/html-pages.md`.",
    ]


def stamp_skill_md(text, plugin_name, version):
    """Return a SKILL.md's text with preamble_lines(plugin_name, version) inserted after
    its closing frontmatter fence, behind one blank line. Inserted lines take the fence
    line's ending. Raises ValueError when the text has no frontmatter to stamp after."""
    lines = text.split("\n")
    if not lines or lines[0].strip() != "---":
        raise ValueError("no frontmatter fence to stamp after")
    end = next((i for i in range(1, len(lines)) if lines[i].strip() == "---"), None)
    if end is None:
        raise ValueError("no frontmatter fence to stamp after")
    cr = "\r" if lines[0].endswith("\r") else ""
    inserted = [line + cr for line in [""] + preamble_lines(plugin_name, version)]
    return "\n".join(lines[:end + 1] + inserted + lines[end + 1:])


# --- scanning --------------------------------------------------------------------------

def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(65536), b""):
            h.update(block)
    return h.hexdigest()


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


# --- reference-resolution ----------------------------------------------------------------

def reference_candidates(text):
    """Yield (ref, tree_rooted) for every reference-looking string in one .md file."""
    for m in REF_EXPLICIT.finditer(text):
        ref = m.group(0).rstrip(".")            # shed a sentence-ending period
        if PLACEHOLDER.search(ref):
            continue
        yield ref, True
    for m in REF_MDLINK.finditer(text):
        ref = m.group(1).split("#")[0]
        # A target with neither '/' nor '.' is prose; a bare filename is a format template.
        if not ref or URL_SCHEME.match(ref) or PLACEHOLDER.search(ref):
            continue
        if "/" in ref:
            yield ref, False
    for m in REF_BACKTICK.finditer(text):
        ref = m.group(1)
        if PLACEHOLDER.search(ref):
            continue
        # Extensionless forms are directory mentions or prose, never a read call.
        if ".agents" in ref or ".claude" in ref or "://" in ref or not HAS_EXT.search(ref):
            continue
        if ref.split("/")[0] in RUNTIME_DIRS:
            continue
        if posixpath.basename(ref) in RUNTIME_FILES:
            continue
        yield ref, False


def reference_resolves(repo, ref, reldir, skill, tree_rooted, assets, shipped=None):
    """Strip a skills-root prefix, collapse `..`, and try the bases in order: the
    containing file's dir, the skill root, the skills-tree root, then the repo root
    (skill prose cites repo files outside the tree as design authority). A tree-rooted
    citation resolves only against the tree root.

    `shipped`: the `.claude/skills/`-relative paths the plugin ships. When given, a
    hit inside the skills tree counts only if its path ships (or is a directory holding
    a shipped file), because an install reads that tree and has nothing else.

    In a subskill of a skill that declares packaged assets, a path starting with an
    asset dir name resolves at the front-door root only."""
    n = posixpath.normpath(TREE_PREFIX.sub("", ref).replace("\\", "/"))
    if n.startswith("/") or DRIVE.match(n):
        return False

    root = skills_root(repo)
    skill_dir = os.path.join(root, skill)
    asset_dirs = {posixpath.basename(d) for dirs in assets.values() for d in dirs}
    if tree_rooted:
        bases = [(root, root)]
    elif skill in assets and reldir.startswith(f"{skill}/subskills/") and n.split("/")[0] in asset_dirs:
        bases = [(skill_dir, root)]
    else:
        bases = [
            (os.path.join(root, reldir), root),  # the containing file's dir
            (skill_dir, root),                     # the skill root
            (root, root),                          # the skills-tree root
            (repo, repo),                          # design authority outside the tree
        ]
    for base, contained_in in bases:
        p = os.path.normpath(os.path.join(base, n))
        # Containment is what makes an escaping `..` fail.
        if not (p.startswith(contained_in + os.sep) and os.path.exists(p)):
            continue
        if shipped is not None and contained_in != repo:
            rel = os.path.relpath(p, contained_in).replace(os.sep, "/")
            if rel not in shipped and not any(m.startswith(rel + "/") for m in shipped):
                continue
        return True
    return False


def broken_references(repo, skill, assets, shipped=None):
    """Return (relpath, ref) for every reference in a skill's .md sources that resolves
    nowhere reachable. With `shipped`, a reference that resolves only to a file the
    plugin does not ship is reported as `ref (resolves but does not ship)`. Test dirs
    are pruned: they hold run output and fixture descriptions, not runtime reads."""
    root = os.path.join(skills_root(repo), skill)
    hits = set()
    for dirpath, dirs, files in os.walk(root):
        dirs[:] = [d for d in dirs if d not in ("tests", "determinizing-tests")]
        if "__pycache__" in dirpath:
            continue
        for fn in files:
            if not fn.endswith(".md"):
                continue
            p = os.path.join(dirpath, fn)
            try:
                with open(p, encoding="utf-8") as f:
                    text = f.read()
            except (UnicodeDecodeError, OSError):
                continue
            rel = os.path.relpath(p, skills_root(repo)).replace(os.sep, "/")
            reldir = posixpath.dirname(rel)
            for ref, tree_rooted in reference_candidates(text):
                if not reference_resolves(repo, ref, reldir, skill, tree_rooted, assets, shipped):
                    unshipped = shipped is not None and reference_resolves(
                        repo, ref, reldir, skill, tree_rooted, assets)
                    hits.add((rel, f"{ref} (resolves but does not ship)" if unshipped else ref))
            # The second `*` is the plugin folder at runtime, so any plugin matches.
            for m in REF_PRESENCE_GLOB.finditer(text):
                if not glob.glob(os.path.join(repo, "plugins", "*", "skills", m.group(1))):
                    hits.add((rel, m.group(0)))
    return sorted(hits)


def reference_hit_verdict(hits, known):
    """Split printed hits (`rel -> ref`) against the known list. Returns (failures,
    n_known): an unlisted hit fails, a listed entry that no longer hits fails as stale."""
    hits = set(hits)
    failures = sorted(hits - known) + [f"stale known-unshipped entry: {e}" for e in sorted(known - hits)]
    return failures, len(hits & known)


# --- entry-point-registry ----------------------------------------------------------------

def entry_point_violations(py_path, symbols):
    """The file must exist, parse, and define every name in `symbols` at module top
    level. A dotted symbol ("Cls.meth") requires a top-level `class Cls` defining `meth`."""
    if not os.path.isfile(py_path):
        return [f"{py_path}: file not found"]
    try:
        with open(py_path, encoding="utf-8") as f:
            source = f.read()
        tree = ast.parse(source, filename=py_path)
    except (OSError, SyntaxError, ValueError) as exc:
        return [f"{py_path}: could not parse ({exc})"]

    top_names = set()
    class_methods = {}
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            top_names.add(node.name)
            if isinstance(node, ast.ClassDef):
                class_methods[node.name] = {
                    n.name for n in node.body
                    if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))
                }
        elif isinstance(node, (ast.Import, ast.ImportFrom)):
            top_names.update(alias.asname or alias.name.split(".")[0] for alias in node.names)
        elif isinstance(node, (ast.Assign, ast.AnnAssign)):
            targets = node.targets if isinstance(node, ast.Assign) else [node.target]
            top_names.update(t.id for t in targets if isinstance(t, ast.Name))

    violations = []
    for symbol in symbols:
        if "." in symbol:
            cls_name, meth_name = symbol.split(".", 1)
            if meth_name not in class_methods.get(cls_name, ()):
                violations.append(f"{py_path}: '{symbol}' not found at top level")
        elif symbol not in top_names:
            violations.append(f"{py_path}: '{symbol}' not found at top level")
    return violations


def consumer_import_violations(consumer_path, module_name, symbols):
    """Violations when a consumer imports a name from `module_name` that `symbols`
    does not pin -- the registry rotting out of sync with its own consumer."""
    if not os.path.isfile(consumer_path):
        return [f"{consumer_path}: consumer file not found"]
    with open(consumer_path, encoding="utf-8") as f:
        text = f.read()
    pinned = {s.split(".", 1)[0] for s in symbols}
    violations = []
    # `.+` (no DOTALL) stops at end-of-line, so the next statement is never swallowed.
    for m in re.finditer(rf"from\s+{re.escape(module_name)}\s+import\s+(.+)", text):
        for raw_name in m.group(1).split(","):
            name = raw_name.strip().split(" as ")[0].strip()
            if name and name not in pinned:
                violations.append(
                    f"{consumer_path}: imports '{name}' from {module_name} "
                    "but ENTRY_POINT_REGISTRY does not pin it")
    return violations


# --- sources-host-guard --------------------------------------------------------------------

def sources_host_guard_violations(bundle):
    """Every broken outbound-fetch invariant of the built data server, asserted on the
    bundle TEXT, name-exact: the shipped host constant, the guard with both refusal
    conditions, and the guard as the first statement of every function in the
    sources module that makes a request."""
    hits = []
    region = "\n".join(body for path, body in _BUNDLE_MODULE.findall(bundle)
                       if path.startswith("src/sources/"))
    if not region:
        return ["the sources module (src/sources/) is not in the bundle"]

    m = re.search(r"\bSOURCES_ALLOWED_HOSTS\s*=\s*\[([^\]]*)\]", region)
    if not m:
        hits.append("SOURCES_ALLOWED_HOSTS literal not found in the sources module")
    else:
        hosts = [h.strip().strip('"\'') for h in m.group(1).split(",") if h.strip()]
        if hosts != SOURCES_ALLOWED_HOSTS:
            hits.append(f"SOURCES_ALLOWED_HOSTS is {hosts}, expected {SOURCES_ALLOWED_HOSTS}")

    # The production fetcher is built from the constant unmodified, and it is the only
    # fetcher built: a second createSourceFetcher( call could pass any host list.
    if not re.search(r"\bsourcesFetcher = createSourceFetcher\(\(\) => SOURCES_ALLOWED_HOSTS, ", region):
        hits.append("sourcesFetcher is not created from SOURCES_ALLOWED_HOSTS unmodified")
    calls = len(re.findall(r"(?<!function )\bcreateSourceFetcher\(", region))
    if calls != 1:
        hits.append(f"createSourceFetcher( is called {calls} times in the sources module, expected once (sourcesFetcher)")

    # Name-exact, so `function assertSourcesHostDisabled` cannot satisfy it, and both
    # refusals must survive.
    if not re.search(r"\bfunction assertSourcesHost\s*\(", region):
        hits.append("assertSourcesHost guard is missing from the sources module")
    if 'url.protocol !== "https:"' not in region:
        hits.append("assertSourcesHost no longer refuses a non-https URL")
    if "!allowed.includes(url.hostname)" not in region:
        hits.append("assertSourcesHost no longer refuses a host outside the allowed list")

    # Every request site must sit in a function whose first statement is the guard. A
    # module with no request site at all fails too, so a rename cannot pass vacuously.
    functions = [(fm.start(), fm.group(1), fm.end()) for fm in _TOP_LEVEL_FUNCTION.finditer(region)]
    sites = list(_SOURCES_NETWORK_CALL.finditer(region))
    if not sites:
        hits.append("no request site found in the sources module")
    for site in sites:
        name, guarded = None, False
        enclosing = [f for f in functions if f[0] < site.start()]
        # esbuild closes a top-level function with `}` in column 0.
        if enclosing and "\n}\n" not in region[enclosing[-1][2]:site.start()]:
            name = enclosing[-1][1]
            guarded = bool(re.match(r"\s*assertSourcesHost\(", region[enclosing[-1][2]:]))
        if not guarded:
            hits.append(f"{site.group(0)!r} in {name or 'module scope'} is not preceded by assertSourcesHost")

    # https only, down to the transport: plain node:http must never carry a request.
    if 'from "node:http"' in region or re.search(r"\bhttp\d*\.(?:request|get)\b", region):
        hits.append("the sources module can make a request over plain node:http")

    return hits


# --- agent grants ------------------------------------------------------------------------------

def agent_tools(agent_md_path):
    """The entries of an agent file's frontmatter `tools:` list."""
    tools, in_tools = [], False
    for line in read_frontmatter_lines(agent_md_path):
        line = line.rstrip("\r")
        if line.startswith("tools:"):
            in_tools = True
        elif in_tools and line.lstrip().startswith("- "):
            tools.append(line.lstrip()[2:].strip())
        elif in_tools and line.strip():
            in_tools = False
    return tools


def fetch_grants(plugin_name):
    """The plain and the bridged name of sources__fetch, for the plugin that ships the
    data server."""
    return (f"mcp__plugin_{plugin_name}_data__{FETCH_TOOL}",
            f"mcp__remote-devices__plugin_{plugin_name}_data__{FETCH_TOOL}")


def fetch_grant_allowlist_violations(agents_dir, grants, expect_grant=True):
    """`sources__fetch` is granted only by the agent files in FETCH_GRANT_AGENTS, by at
    least one agent, and by each listed agent that is present under both names in
    `grants`. A listed agent that is absent passes. `expect_grant` is False for a
    plugin that ships none of the listed agents, where no grant at all is right."""
    present = sorted(os.listdir(agents_dir)) if os.path.isdir(agents_dir) else []
    granting = {}
    for fn in present:
        if fn.endswith(".md"):
            tools = [t for t in agent_tools(os.path.join(agents_dir, fn)) if t == FETCH_TOOL or t.endswith("__" + FETCH_TOOL)]
            if tools:
                granting[fn] = tools
    if not granting:
        return [f"no agent grants {FETCH_TOOL}"] if expect_grant else []
    hits = [f"{fn} grants {FETCH_TOOL} but is not in FETCH_GRANT_AGENTS ({', '.join(FETCH_GRANT_AGENTS)})"
            for fn in granting if fn not in FETCH_GRANT_AGENTS]
    for fn in FETCH_GRANT_AGENTS:
        if fn in present:
            hits += [f"{fn} does not grant {name}" for name in grants if name not in granting.get(fn, [])]
    return hits


def agent_bridged_grant_violations(agents_dir):
    """Every `mcp__plugin_` grant in an agent file is also declared under its bridged
    name, and the bridged grants mirror the plain ones exactly: no server-level
    `mcp__remote-devices` entry and no wildcard."""
    paths = sorted(glob.glob(os.path.join(agents_dir, "*.md")))
    if not paths:
        return ["no plugin agent files found"]
    hits, checked = [], 0
    for path in paths:
        fn = os.path.basename(path)
        tools = agent_tools(path)
        plain = {t for t in tools if t.startswith(PLAIN_PREFIX)}
        bridged = {t for t in tools if t.startswith(BRIDGE_PREFIX)}
        if "mcp__remote-devices" in tools:
            hits.append(f"{fn} grants the whole bridge server")
        if any("*" in t for t in tools):
            hits.append(f"{fn} grants a wildcard tool")
        want = {BRIDGE_PREFIX + t[len("mcp__"):] for t in plain}
        hits += [f"{fn} lacks the bridged twin {t}" for t in sorted(want - bridged)]
        hits += [f"{fn} grants {t} with no plain twin" for t in sorted(bridged - want)]
        checked += bool(plain)
    if not checked:
        hits.append("no agent declares a plugin MCP tool; the parser is likely broken")
    return hits


# --- recital-rule-mirror -------------------------------------------------------------------------

def recital_rule_blocks(path):
    """Every marked recital-rule block in a file, line endings normalised to LF."""
    with open(path, encoding="utf-8") as f:
        return RECITAL_RULE_BLOCK.findall(f.read().replace("\r\n", "\n"))


def recital_rule_mirrors(plugin):
    """The copies of the recital rule the plugin ships, as repo-relative paths."""
    skills = [f".claude/skills/{rel}" for rel in RECITAL_RULE_SKILL_MIRRORS
              if rel.split("/")[0] == SHARED_TREE or ships_skill(plugin, rel.split("/")[0])]
    agents = [f"{plugin['source']}/agents/{a}.md" for a in RECITAL_RULE_AGENT_MIRRORS if ships_agent(plugin, a)]
    return tuple(skills + agents)


def recital_rule_mirror_violations(repo, source, mirrors):
    """Every copy of the recital rule (authority-claim-verification.md §3) that is
    missing, duplicated, or not identical to the source's block. Subagents read no
    repo files, so each prompt carries the rule inline."""
    found = recital_rule_blocks(os.path.join(repo, source))
    if len(found) != 1:
        return [f"{source}: expected 1 recital-rule block, found {len(found)}"]
    hits = []
    for rel in mirrors:
        path = os.path.join(repo, rel)
        if not os.path.isfile(path):
            hits.append(f"{rel}: file missing")
            continue
        blocks = recital_rule_blocks(path)
        if len(blocks) != 1:
            hits.append(f"{rel}: expected 1 recital-rule block, found {len(blocks)}")
        elif blocks[0] != found[0]:
            hits.append(f"{rel}: block differs from {source}")
    return hits


# --- hook-matchers --------------------------------------------------------------------------------

def hook_matcher_violations(manifest, plugin, servers, agents, strict):
    """(hits, matchers read) for the hook matchers of one plugin.json. A matcher that
    names a plugin tool must name a server that plugin ships, and one that names a
    plugin agent must name an agent that plugin ships: a matcher that names anything
    else matches nothing, so its hook never runs. `servers` and `agents` are {plugin
    name: what it ships} for every built plugin. With `strict`, the named plugin must
    also be this one or one it requires. A matcher that names a host tool, or a
    pattern tied to no plugin, passes."""
    reachable = {plugin["name"], *plugin["requires"]} if strict else set(servers)
    hits, count = [], 0
    for event in TOOL_EVENTS + AGENT_EVENTS:
        pattern, ships, kind = (MATCHER_TOOL, servers, "server") if event in TOOL_EVENTS \
            else (MATCHER_AGENT, agents, "agent")
        for group in manifest.get("hooks", {}).get(event, []):
            matcher = group.get("matcher")
            if not matcher:
                continue
            count += 1
            named = pattern.findall(matcher)
            if kind == "server" and "plugin_" in matcher and not named:
                hits.append(f"{event} matcher {matcher!r} names a plugin tool this check cannot read")
            for owner, unit in named:
                if owner not in ships:
                    hits.append(f"{event} matcher names {kind} '{unit}' of '{owner}', which is not a built plugin")
                elif unit not in ships[owner]:
                    hits.append(f"{event} matcher names {kind} '{unit}', which '{owner}' does not ship")
                elif owner not in reachable:
                    hits.append(f"{event} matcher names {kind} '{unit}' of '{owner}', which "
                                f"'{plugin['name']}' does not require")
    return hits, count


# --- shipped-tree-purity --------------------------------------------------------------------------

def shipped_manifest(repo, plugin):
    """(sha256, relpath) for every file in the built plugin, paths relative to it."""
    root = os.path.join(repo, "plugins", plugin["name"])
    manifest = []
    for dirpath, dirs, files in os.walk(root):
        dirs.sort()
        for fn in sorted(files):
            p = os.path.join(dirpath, fn)
            manifest.append((sha256_file(p), os.path.relpath(p, root).replace(os.sep, "/")))
    return manifest


def skill_source_expected(root, roster_names, assets, extra=EXTRA_TREES):
    """The `.claude/skills/`-relative paths the plugin should ship under `skills/`:
    every allowlisted text file under each roster skill and each extra tree, plus every
    file in one of that skill's declared asset dirs (an Office lock file excepted)."""
    expected = set()
    for top in list(roster_names) + list(extra):
        declared = tuple(f"{top}/{d}/" for d in assets.get(top, ()))
        for dirpath, dirs, files in os.walk(os.path.join(root, top)):
            dirs[:] = [d for d in dirs if d not in TREE_EXCLUDE_DIRS]
            for fn in files:
                if fn.endswith(".pyc"):
                    continue
                rel = os.path.relpath(os.path.join(dirpath, fn), root).replace(os.sep, "/")
                if os.path.splitext(fn)[1].lower() in TREE_TEXT_EXTS:
                    expected.add(rel)
                elif declared and rel.startswith(declared) and not fn.startswith(TRANSIENT_ASSET_PREFIX):
                    expected.add(rel)
    return expected


def matter_codes(text):
    """MATTER_CODE hits in text, less UTBMS task codes on UTBMS-context lines."""
    return [code for line in text.splitlines() for code in MATTER_CODE.findall(line)
            if not (code in UTBMS_TASK_CODES and UTBMS_CONTEXT.search(line))]


def _text_of(path):
    """A file's text if it is text -- an allowlisted extension, or UTF-8 bytes with no
    NUL -- else None, so a binary asset is never scanned as prose."""
    with open(path, "rb") as f:
        data = f.read()
    if os.path.splitext(path)[1].lower() in TREE_TEXT_EXTS:
        return data.decode("utf-8", errors="replace")
    if b"\x00" in data:
        return None
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError:
        return None


def skill_source_hit_counts(repo, plugin, shipped_rels):
    """Per-file hit counts, keyed by repo-relative path: HOST_PATH over every shipped
    text file, matter_codes over those plus the plugin's agents and, where it ships the
    data server, the firm rule overlay's test fixtures. Counts only -- the matched text
    never leaves here."""
    counts = {"host_path": {}, "matter_code": {}}
    for rel in shipped_rels:
        text = _text_of(os.path.join(skills_root(repo), *rel.split("/")))
        if text is None:
            continue
        key = f".claude/skills/{rel}"
        for scan, find in (("host_path", HOST_PATH.findall), ("matter_code", matter_codes)):
            n = len(find(text))
            if n:
                counts[scan][key] = n
    overlay_fixtures = glob.glob(server_path(repo, plugin, "data", "test", "fixtures", "rule-overlay", "*.json")) \
        if "data" in plugin["servers"] else []
    for path in sorted(glob.glob(source_path(repo, plugin, "agents", "*.md")) + overlay_fixtures):
        with open(path, encoding="utf-8", errors="replace") as f:
            n = len(matter_codes(f.read()))
        if n:
            counts["matter_code"][os.path.relpath(path, repo).replace(os.sep, "/")] = n
    return counts


def shipped_tree_purity(repo, plugin, manifest, roster_names, assets, baseline, version):
    """Return (hits, summary) for the `skills/` entries of one built plugin's manifest
    ((sha256, relpath) pairs). Every entry must be its source file byte for byte, except
    a roster SKILL.md, which must be its source plus the preamble
    stamp_skill_md(text, plugin name, version) inserts."""
    root = skills_root(repo)
    extra = extra_trees(plugin)
    tops = set(roster_names) | set(extra)
    hits = []
    shipped = set()
    public_dirs, public = public_skill_dirs(repo), set(public_skills(repo, plugin))
    for top in sorted(set(public_dirs) & (tops | set(os.listdir(root) if os.path.isdir(root) else ()))):
        hits.append(f"skill in both public/ and .claude/skills/: {top}")
    public_shipped = set()
    for sha, arcname in manifest:
        if not arcname.startswith(SHIPPED_PREFIX):
            continue
        rel = arcname[len(SHIPPED_PREFIX):]
        parts = rel.split("/")
        if parts[0] in public:
            # A public skill ships whole and byte for byte, with no preamble.
            public_shipped.add(rel)
            source = os.path.join(public_dirs[parts[0]], *parts[1:])
            if not os.path.isfile(source):
                hits.append(f"no public source file: {arcname}")
            elif sha256_file(source) != sha:
                hits.append(f"differs from its public source: {arcname}")
            continue
        shipped.add(rel)
        if any(p in TREE_EXCLUDE_DIRS for p in parts[:-1]) or parts[-1].endswith(".pyc"):
            hits.append(f"excluded path shipped: {arcname}")
        # A firm's confirmations live only in its overlay and are never promoted.
        if parts[-1].endswith(".confirmations.local.json"):
            hits.append(f"confirmation sidecar shipped: {arcname}")
        declared = tuple(f"{parts[0]}/{d}/" for d in assets.get(parts[0], ()))
        if (os.path.splitext(parts[-1])[1].lower() not in TREE_TEXT_EXTS
                and not (declared and rel.startswith(declared))):
            hits.append(f"neither allowlisted text nor a declared asset: {arcname}")
        if parts[0] not in tops:
            hits.append(f"not a roster skill or an extra tree ({', '.join(extra)}): {arcname}")
        source = os.path.join(root, *parts)
        if not os.path.isfile(source):
            hits.append(f"no source file: {arcname}")
        elif parts[0] in roster_names and rel == f"{parts[0]}/SKILL.md":
            with open(source, encoding="utf-8", newline="") as f:
                text = f.read()
            try:
                want = hashlib.sha256(stamp_skill_md(text, plugin["name"], version).encode("utf-8")).hexdigest()
            except ValueError:
                want = None
            if want != sha:
                hits.append(f"SKILL.md not source + preamble: {arcname}")
        elif sha256_file(source) != sha:
            hits.append(f"differs from source: {arcname}")
    for rel in sorted(skill_source_expected(root, roster_names, assets, extra) - shipped):
        hits.append(f"missing from payload: {SHIPPED_PREFIX}{rel}")
    for top in sorted(public):
        for dirpath, _dirs, files in os.walk(public_dirs[top]):
            for fn in files:
                rel = top + "/" + os.path.relpath(os.path.join(dirpath, fn), public_dirs[top]).replace(os.sep, "/")
                if rel not in public_shipped:
                    hits.append(f"missing from payload: {SHIPPED_PREFIX}{rel}")

    # VISION.md ships at the plugin root, byte for byte.
    vision_shas = [sha for sha, arcname in manifest if arcname == VISION_FILE]
    vision_src = source_path(repo, plugin, VISION_FILE)
    if not vision_shas:
        hits.append(f"missing from payload: {VISION_FILE}")
    elif not os.path.isfile(vision_src) or sha256_file(vision_src) != vision_shas[0]:
        hits.append(f"differs from source: {VISION_FILE}")

    present = sorted(rel for rel in shipped if os.path.isfile(os.path.join(root, *rel.split("/"))))
    counts = skill_source_hit_counts(repo, plugin, present)
    for scan in ("host_path", "matter_code"):
        allowed = baseline.get(scan, {})
        for path, n in sorted(counts[scan].items()):
            if n > allowed.get(path, 0):
                hits.append(f"{scan} hits over baseline in {path}: {n} (baseline {allowed.get(path, 0)})")

    def total(scan):
        return f"{sum(counts[scan].values())} hits in {len(counts[scan])} files"
    summary = (f"{len(shipped)} shipped-tree entries; baselined host-path {total('host_path')}, "
               f"matter-code {total('matter_code')}")
    return hits, summary


def write_skill_source_baseline(repo, path=SKILL_SOURCE_BASELINE):
    """Rewrite the ratchet baseline from what the sources say should ship, in every
    built plugin."""
    counts = {"host_path": {}, "matter_code": {}}
    for plugin in built_plugins(repo).values():
        rels = sorted(skill_source_expected(skills_root(repo), sorted(roster(repo, plugin)),
                                            packaged_assets(repo, plugin), extra_trees(plugin)))
        for scan, found in skill_source_hit_counts(repo, plugin, rels).items():
            counts[scan].update(found)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(counts, f, indent=2, sort_keys=True)
        f.write("\n")
    return counts


# --- the checks ----------------------------------------------------------------------------------
# Each returns (ok, detail). A check of one plugin takes (repo, plugin) and raises
# NotApplicable when the plugin does not ship what it guards.

def check_roster_sanity(repo, plugin):
    names = skill_names(repo, plugin)
    missing = [s for s in names if not os.path.isfile(skill_md(repo, s))]
    if missing:
        return False, "missing source for: " + ", ".join(missing)
    if plugin["skills"] is not None and set(plugin["skills"]) != set(names):
        return False, ("roster.json and source/assignment.json disagree on: "
                       + ", ".join(sorted(set(plugin["skills"]) ^ set(names))))
    return True, ""


def check_reserved_name(repo, plugin):
    reserved = [s for s in skill_names(repo, plugin) if RESERVED_NAME.search(s)]
    return not reserved, ("rename: " + ", ".join(reserved)) if reserved else ""


def check_description_no_xml_tags(repo, plugin):
    xml_hits = []
    for s in skill_names(repo, plugin):
        if not os.path.isfile(skill_md(repo, s)):
            continue
        desc = extract_field(read_frontmatter_lines(skill_md(repo, s)), "description") or []
        found = XML_TAG.findall("\n".join(desc))
        if found:
            xml_hits.append(f"{s}: {', '.join(sorted(set(found)))}")
    return not xml_hits, "; ".join(xml_hits)


def check_description_length(repo, plugin):
    long_hits, near_hits = [], []
    for s in skill_names(repo, plugin):
        if not os.path.isfile(skill_md(repo, s)):
            continue
        n = description_length(skill_md(repo, s))
        if n is None:
            continue
        if n > DESCRIPTION_MAX_CHARS:
            long_hits.append(f"{s}: {n} chars, {n - DESCRIPTION_MAX_CHARS} over")
        elif n >= DESCRIPTION_WARN_CHARS:
            near_hits.append(f"{s}: {n} chars, {DESCRIPTION_MAX_CHARS - n} left")
    if long_hits:
        return False, "shorten the source description: " + "; ".join(long_hits)
    if near_hits:
        return True, f"NEAR LIMIT (>= {DESCRIPTION_WARN_CHARS}, still passing): " + "; ".join(near_hits)
    return True, ""


def check_no_absolute_repo_paths(repo, plugin):
    needle = os.path.join(repo, ".claude")
    abs_hits = []
    for s in skill_names(repo, plugin):
        if not os.path.isfile(skill_md(repo, s)):
            continue
        abs_hits.extend(rel for _n, rel in grep_tree(repo, s, needles_cs=(needle,))
                        if posixpath.basename(rel) not in RUNTIME_FILES)
    return not abs_hits, ("absolute repo path in: " + ", ".join(sorted(set(abs_hits)))) if abs_hits else ""


def check_reference_resolution(repo, plugin):
    assets = packaged_assets(repo, plugin)
    shipped = skill_source_expected(skills_root(repo), sorted(roster(repo, plugin)), assets, extra_trees(plugin))
    ref_hits = []
    for s in skill_names(repo, plugin):
        if os.path.isdir(os.path.join(skills_root(repo), s)):
            ref_hits.extend(broken_references(repo, s, assets, shipped))
    with open(REFERENCE_UNSHIPPED_BASELINE, encoding="utf-8") as f:
        known = set(json.load(f)["known_unshipped"])
    # The list is one for the repo. An entry of a skill another plugin ships is that
    # plugin's to hit, so it is not stale here.
    elsewhere = {s for other in built_plugins(repo).values() if other["name"] != plugin["name"]
                 for s in skill_names(repo, other)}
    known = {entry for entry in known if entry.split("/", 1)[0] not in elsewhere}
    ref_fail, n_known = reference_hit_verdict([f"{rel} -> {ref}" for rel, ref in ref_hits], known)
    if ref_fail:
        return False, "; ".join(ref_fail)
    return True, f"{n_known} known unshipped" if n_known else ""


def check_entry_point_registry(repo, plugin):
    entries = [e for e in ENTRY_POINT_REGISTRY if e["server"] in plugin["servers"]]
    if not entries:
        raise NotApplicable(f"{plugin['name']} ships no server that imports a pinned entry point")
    ep_hits = []
    for entry in entries:
        ep_hits.extend(entry_point_violations(os.path.join(repo, *entry["path"].split("/")), entry["symbols"]))
        module_name = os.path.splitext(os.path.basename(entry["path"]))[0]
        for consumer in entry["consumers"]:
            ep_hits.extend(consumer_import_violations(
                server_path(repo, plugin, entry["server"], *consumer.split("/")), module_name, entry["symbols"]))
    return not ep_hits, "; ".join(ep_hits)


def bundle_purity_hits(server, text):
    """The purity tokens one server's bundle text carries (see PURITY_SERVERS)."""
    lowered = text.lower()
    if server != "data":
        return [token for token in ("supabase", "legal_commons__") if token in lowered]
    hits = [token for token in ("/rest/v1/", "legal_commons__") if token in lowered]
    hits += sorted({path for path in _FUNCTIONS_PATH.findall(lowered) if path not in DATA_FUNCTION_PATHS})
    return hits


def check_bundle_purity(repo, plugin):
    servers = [s for s in PURITY_SERVERS if s in plugin["servers"]]
    if not servers:
        raise NotApplicable(f"{plugin['name']} ships neither the data nor the canlii server")
    purity_hits = []
    found_any_bundle = False
    for server in servers:
        dist_rel = plugin_layout.SERVER_DIRS[server]
        dist = server_path(repo, plugin, server, "dist")
        if not os.path.isdir(dist):
            continue
        blob = ""
        for fn in sorted(os.listdir(dist)):
            if fn.endswith(".js"):
                with open(os.path.join(dist, fn), encoding="utf-8") as f:
                    blob += f.read()
        if not blob:
            continue
        found_any_bundle = True
        purity_hits.extend(f"{dist_rel}/dist: {hit}" for hit in bundle_purity_hits(server, blob))
    if not found_any_bundle:
        return False, "no bundle found"
    return not purity_hits, ("found: " + ", ".join(purity_hits)) if purity_hits else ""


def check_sources_host_guard(repo, plugin):
    data_js = server_path(repo, plugin, "data", *DATA_BUNDLE)
    if not os.path.isfile(data_js):
        return False, "/".join((plugin_layout.SERVER_DIRS["data"],) + DATA_BUNDLE) + " not found"
    with open(data_js, encoding="utf-8") as f:
        guard_hits = sources_host_guard_violations(f.read())
    return not guard_hits, "; ".join(guard_hits)


def check_fetch_grant_allowlist(repo, plugin):
    listed_here = any(ships_agent(plugin, fn[:-len(".md")]) for fn in FETCH_GRANT_AGENTS)
    fetch_hits = fetch_grant_allowlist_violations(
        agents_dir(repo, plugin), fetch_grants(server_owner(repo, "data")["name"]), expect_grant=listed_here)
    return not fetch_hits, "; ".join(fetch_hits)


def check_recital_rule_mirror(repo, plugin):
    recital_hits = recital_rule_mirror_violations(repo, RECITAL_RULE_SOURCE, recital_rule_mirrors(plugin))
    return not recital_hits, "; ".join(recital_hits)


def check_bundle_no_host_path(repo, plugin):
    servers = [s for s in HOST_PATH_SERVERS if s in plugin["servers"]]
    if not servers:
        raise NotApplicable(f"{plugin['name']} ships no server")
    host_hits = []
    for server in servers:
        dist_rel = plugin_layout.SERVER_DIRS[server]
        dist = server_path(repo, plugin, server, "dist")
        if not os.path.isdir(dist):
            continue
        for fn in sorted(os.listdir(dist)):
            if not fn.endswith(".js"):
                continue
            with open(os.path.join(dist, fn), encoding="utf-8") as f:
                text = f.read()
            m = HOST_PATH.search(text)
            if not m:
                continue
            note = " (linked worktree -- rebuild from the main worktree)" if WORKTREE_PATH.search(text) else ""
            host_hits.append(f"{dist_rel}/dist/{fn}: {m.group(0)!r}{note}")
    return not host_hits, "; ".join(host_hits)


BAKED_SCHEMA = re.compile(r"BAKED_SCHEMA_VERSION = (?:false|true|[^?\n]+)\s*\?\s*null\s*:\s*(\d+)")
ENGINE_TARGET = re.compile(r"^TARGET_SCHEMA_VERSION\s*=\s*(\d+)\s*$", re.M)


def check_bundle_schema_ceiling(repo, plugin):
    """The data bundle's baked drafting-data schema version equals the migration source's target.

    scripts/bundle.mjs bakes TARGET_SCHEMA_VERSION into the bundle at build time
    (src/submission/schema-ceiling.ts). A migrate_engine.py hop committed without a
    rebuilt bundle ships an install whose migration source is ahead of its renderers:
    open_session then withholds every migration and renders nothing. 3935943 (74 over
    a 73 bundle), 78ffce8 (75 over 74) and 7d09fd6 (76 over 74) each reached main so."""
    data_js = server_path(repo, plugin, "data", *DATA_BUNDLE)
    engine = os.path.join(skills_root(repo), "drafting-data", "references", "scripts", "migrate_engine.py")
    if not os.path.isfile(data_js):
        return False, "/".join((plugin_layout.SERVER_DIRS["data"],) + DATA_BUNDLE) + " not found"
    with open(data_js, encoding="utf-8") as f:
        baked = BAKED_SCHEMA.search(f.read())
    with open(engine, encoding="utf-8") as f:
        target = ENGINE_TARGET.search(f.read())
    if not baked or not target:
        return False, ("no baked schema version in the data bundle" if not baked
                       else "no TARGET_SCHEMA_VERSION in drafting-data's migrate_engine.py")
    if baked.group(1) != target.group(1):
        return False, (f"the migration source targets schema {target.group(1)} but the data bundle was built "
                       f"against {baked.group(1)}: rebuild the bundle (/repackage) before this ships")
    return True, f"both at schema {target.group(1)}"


def check_inverse_reference(repo, plugin):
    if plugin["agents"] is not None and set(COMMONS_AGENTS) <= set(plugin["agents"]):
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


def check_shipped_tree_purity(repo, plugin):
    with open(SKILL_SOURCE_BASELINE, encoding="utf-8") as f:
        baseline = json.load(f)
    with open(source_path(repo, plugin, "plugin.json"), encoding="utf-8") as f:
        version = json.load(f)["version"]
    hits, summary = shipped_tree_purity(
        repo, plugin, shipped_manifest(repo, plugin), sorted(roster(repo, plugin)), packaged_assets(repo, plugin),
        baseline, version)
    return not hits, "; ".join(hits) if hits else summary


def check_agent_bridged_grants(repo, plugin):
    bridge_hits = agent_bridged_grant_violations(agents_dir(repo, plugin))
    return not bridge_hits, "; ".join(bridge_hits)


def check_commons_encapsulation(repo, plugin):
    if not ships_skill(plugin, COMMONS_SKILL):
        raise NotApplicable(f"{plugin['name']} does not ship the {COMMONS_SKILL} skill")
    enc_hits = grep_tree(repo, COMMONS_SKILL, needles_ci=COMMONS_FORBIDDEN)
    return not enc_hits, "; ".join(f"{rel} has '{n}'" for n, rel in enc_hits)


def check_hook_matchers(repo, plugin):
    with open(source_path(repo, plugin, "plugin.json"), encoding="utf-8") as f:
        manifest = json.load(f)
    plugins = built_plugins(repo)
    hits, count = hook_matcher_violations(
        manifest, plugin, {name: p["servers"] for name, p in plugins.items()},
        {name: agent_names(repo, p) for name, p in plugins.items()}, strict=plugin_layout.is_cutover(repo))
    if not count:
        raise NotApplicable(f"{plugin['name']} declares no hook matcher")
    return not hits, "; ".join(hits) if hits else f"{count} matchers read"


def check_dependencies(repo, plugin):
    """The host installs and enforces what plugin.json declares, and the build, the
    hook-matchers check and the layering check trust what the assignment says."""
    with open(source_path(repo, plugin, "plugin.json"), encoding="utf-8") as f:
        declared = json.load(f).get("dependencies", [])
    if sorted(declared) != sorted(plugin["requires"]):
        return False, (f"plugin.json declares {sorted(declared)}, but source/assignment.json "
                       f"requires {sorted(plugin['requires'])}")
    return True, ""


def check_unique_names(repo):
    hits = []
    for kind, names_of in (("skill", skill_names), ("agent", agent_names)):
        owners = {}
        for plugin in built_plugins(repo).values():
            for name in names_of(repo, plugin):
                owners.setdefault(name, []).append(plugin["name"])
        hits += [f"{kind} '{name}' ships in {' and '.join(found)}"
                 for name, found in sorted(owners.items()) if len(found) > 1]
    return not hits, "; ".join(hits)


def check_layering_rule(repo):
    """check_layering.py's verdict: its --report run until cutover, its strict run from then."""
    try:
        _shared, _upward, _ruling, found, unruled, stale, todo = check_layering.judge(Path(repo))
    except SystemExit as exc:
        return False, str(exc)
    strict = plugin_layout.is_cutover(repo)
    hits = [f"no ruling: {f} names {t}" for f, t in unruled]
    hits += [f"stale ruling (nothing matches it): {f} names {t}" for f, t in stale]
    if strict:
        hits += [f"still to fix: {f} names {t}" for f, t in todo]
    if hits:
        return False, "; ".join(hits)
    return True, f"{len(found)} upward pairs" + (f", {len(todo)} still to fix before cutover" if todo else "")


def check_file_ops_rule(repo):
    """check_file_ops.py's verdict."""
    try:
        _findings, ruling, found, unruled, stale, bad_why = check_file_ops.judge(Path(repo))
    except SystemExit as exc:
        return False, str(exc)
    hits = [f"no ruling: {f} {op}" for f, op in unruled]
    hits += [f"stale ruling (nothing matches it): {f} {op}" for f, op in stale]
    hits += [f"unknown why '{ruling[pair]}': {pair[0]} {pair[1]}" for pair in bad_why]
    if hits:
        return False, "; ".join(hits)
    return True, f"{len(found)} (file, operation) pairs"


CHECKS = (
    ("roster-sanity: every shipped skill maps to a source SKILL.md", check_roster_sanity),
    ("reserved-name: no shipped skill name contains the reserved word 'claude'", check_reserved_name),
    ("description-no-xml-tags: no source description contains an XML tag", check_description_no_xml_tags),
    (f"description-length: no source description exceeds {DESCRIPTION_MAX_CHARS} characters",
     check_description_length),
    ("no-absolute-repo-paths: skill sources use relative references", check_no_absolute_repo_paths),
    ("reference-resolution: every file reference in a skill source resolves and ships",
     check_reference_resolution),
    ("entry-point-registry: pinned Python entry-point symbols exist and match their consumers' imports",
     check_entry_point_registry),
    ("bundle-purity: no canlii or files dist bundle carries 'supabase' or 'legal_commons__'; the data "
     "bundle carries no 'legal_commons__', no '/rest/v1/' and no 'functions/v1/' path but items-write, "
     "items-sync and items-seed", check_bundle_purity),
    ("sources-host-guard: the data server's sources module fetches only over https from allowed "
     "hosts, SOURCES_ALLOWED_HOSTS as expected, guarded before every request", check_sources_host_guard),
    ("fetch-grant-allowlist: only allowlisted agents grant sources__fetch, each present one under "
     "both its plain and bridged names", check_fetch_grant_allowlist),
    ("recital-rule-mirror: every inline copy of the recital rule matches "
     "authority-claim-verification.md §3", check_recital_rule_mirror),
    ("bundle-no-host-path: no dist bundle contains an absolute host path", check_bundle_no_host_path),
    ("bundle-schema-ceiling: the data bundle is built against the drafting-data migration source's "
     "target schema version", check_bundle_schema_ceiling),
    ("inverse-reference: no roster skill or non-commons agent names a commons agent outside the plugin "
     "that ships it", check_inverse_reference),
    ("shipped-tree-purity: the built plugin's skills folder is exactly the roster + extra-tree source "
     "(roster SKILL.md + preamble), VISION.md ships from source, with no host path or matter code "
     "over baseline", check_shipped_tree_purity),
    ("agent-bridged-grants: every plugin MCP grant in an agent has its bridged twin and nothing more",
     check_agent_bridged_grants),
    ("commons-encapsulation: the legal-commons gatekeeper skill names no local DB file",
     check_commons_encapsulation),
    ("hook-matchers: every hook matcher that names a plugin tool or a plugin agent names one that "
     "plugin ships", check_hook_matchers),
    ("dependencies: plugin.json's dependencies are the plugins source/assignment.json says it requires",
     check_dependencies),
)
# Checks across the plugins built. Each takes (repo).
REPO_CHECKS = (
    ("unique-names: no skill name and no agent name ships in two plugins", check_unique_names),
    ("layering: every upward reference between the plugins of source/assignment.json has a ruling "
     "(scripts/check_layering.py)", check_layering_rule),
    ("file-ops: every file-changing operation outside file-manager has a ruling (scripts/check_file_ops.py)",
     check_file_ops_rule),
)


def run_checks(repo):
    """[(plugin name, label, ok, detail)] for every check of every built plugin, then
    the checks across plugins, under the plugin name None. `ok` is None for a check
    that does not apply to the plugin. A check that raises is a FAIL."""
    runs = [(plugin["name"], label, fn, (repo, plugin))
            for plugin in built_plugins(repo).values() for label, fn in CHECKS]
    runs += [(None, label, fn, (repo,)) for label, fn in REPO_CHECKS]
    results = []
    for name, label, fn, args in runs:
        try:
            ok, detail = fn(*args)
        except NotApplicable as exc:
            ok, detail = None, f"does not apply: {exc}"
        except Exception as exc:  # reported as a FAIL, never skipped
            ok, detail = False, f"could not run: {type(exc).__name__}: {exc}"
        results.append((name, label, ok, detail))
    return results


def main(argv):
    # A detail can quote a reference with a character the console cannot encode.
    sys.stdout.reconfigure(errors="backslashreplace")
    if argv[1:] == ["skill-source-baseline"]:
        counts = write_skill_source_baseline(REPO)
        for scan in ("host_path", "matter_code"):
            print(f"{scan}: {sum(counts[scan].values())} hits in {len(counts[scan])} files")
        print("wrote", SKILL_SOURCE_BASELINE)
        return 0
    if argv[1:]:
        print(__doc__)
        return 2
    plugins = built_plugins(REPO)
    results = run_checks(REPO)
    marks = {True: "PASS", False: "FAIL", None: "N/A"}
    for name in [*plugins, None]:
        if name is None:
            print("Checks across the plugins built:")
        else:
            print(f"Invariant checks for '{name}' ({len(skill_names(REPO, plugins[name]))} skills):")
        for owner, label, ok, detail in results:
            if owner == name:
                print(f"  [{marks[ok]}] {label}" + (f" — {detail}" if detail else ""))
    failures = [label for _owner, label, ok, _ in results if ok is False]
    if failures:
        print(f"\nCHECK FAILED — {len(failures)} invariant(s) violated.")
        return 1
    print("\nALL CHECKS PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
