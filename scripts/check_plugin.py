#!/usr/bin/env python3
"""Invariant checks for the Probanda plugin. Standard library only.

Usage:
  python scripts/check_plugin.py                         run every check; exit 1 on any FAIL
  python scripts/check_plugin.py skill-source-baseline   rewrite the shipped-tree-purity ratchet baseline

Ported from CoClerk's plugin-packager `direct_mode.py check litigation`, with
every path and identifier moved to this repo: skill sources under
.claude/skills/ (the keys of source/probanda/roster.json, plus shared/ and
legal-commons/), plugin sources under source/probanda/, and the built plugin
under plugins/probanda/. Each check prints one `[PASS]` or `[FAIL]` line; there
are no silent skips. The baselines live in check_plugin_baselines/ beside this file.
"""
import ast
import glob
import hashlib
import json
import os
import posixpath
import re
import sys

REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), os.pardir))
BASELINES = os.path.join(os.path.dirname(os.path.abspath(__file__)), "check_plugin_baselines")

SOURCE_DIR = ("source", "probanda")      # plugin sources: roster, manifest, agents, MCP runtimes
SHIPPED_DIR = ("plugins", "probanda")    # the built plugin
COMMONS_SKILL = "legal-commons"
# Skill trees that ship beside the roster skills, unstamped.
EXTRA_TREES = ("shared", COMMONS_SKILL)
# The agents merged in from legal-commons' read side.
COMMONS_AGENTS = ("law-librarian", "troubleshooter")

# Forbidden database-particular tokens in the legal-commons gatekeeper skill:
# matter data is reached only through /case-data, never by naming a local DB file.
COMMONS_FORBIDDEN = ["sqlite3", "law.sqlite", "main.sqlite", "privileged.sqlite", "practice.db"]

# Python entry points the data runtime imports live from the skills tree. A rename
# in the file breaks the installed plugin with no failing test, so each entry pins
# the symbols, and `consumers` the runtime files whose `from <module> import ...`
# must stay a subset of them. A symbol may be dotted one level ("Cls.meth").
ENTRY_POINT_REGISTRY = (
    {
        "path": ".claude/skills/drafting-data/references/scripts/migrate_engine.py",
        "symbols": ("run", "MigrateError", "MigrateError.as_dict", "TARGET_SCHEMA_VERSION"),
        "consumers": ("source/probanda/mcp/src/submission/migrate.ts",),
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
VISION_FILE = "VISION.md"   # ships at the plugin root from source/probanda/
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

DATA_BUNDLE = ("mcp", "dist", "litigation-mcp.js")
# Bundles that must carry no Supabase or commons tool namespace. commons-mcp is
# exempt: it is the plugin's one Supabase surface.
PURITY_DISTS = ("mcp", "canlii-mcp")
HOST_PATH_DISTS = ("mcp", "canlii-mcp", "commons-mcp")

FETCH_TOOL = "sources__fetch"
FETCH_GRANTS = ("mcp__plugin_probanda_data__" + FETCH_TOOL,
                "mcp__remote-devices__plugin_probanda_data__" + FETCH_TOOL)
# The only agent files that may grant sources__fetch.
FETCH_GRANT_AGENTS = ("localize-helper.md", "legislation-fetcher.md")

# A Cowork Project session reaches plugin MCP servers through the desktop bridge,
# which renames every tool `mcp__remote-devices__<name>`, and a subagent grant that
# matches no live tool is dropped silently.
PLAIN_PREFIX = "mcp__plugin_"
BRIDGE_PREFIX = "mcp__remote-devices__"

RECITAL_RULE_SOURCE = ".claude/skills/shared/authority-claim-verification.md"
RECITAL_RULE_MIRRORS = (
    ".claude/skills/shared/legal-audit-protocol.md",
    ".claude/skills/case-brief/agents/brief.md",
    ".claude/skills/verify-law/agents/verify-claim.md",
    ".claude/skills/case-data/agents/verify-edges.md",
    ".claude/skills/case-data/agents/extract-caselaw.md",
    ".claude/skills/case-data/agents/verify-caselaw.md",
    "source/probanda/agents/verify-claim.md",
    "source/probanda/agents/verify-edges.md",
    "source/probanda/agents/extract-caselaw.md",
    "source/probanda/agents/verify-caselaw.md",
)
RECITAL_RULE_BLOCK = re.compile(r"<!-- recital-rule: begin.*?<!-- recital-rule: end -->", re.S)


# --- repo layout -------------------------------------------------------------------

def skills_root(repo):
    return os.path.join(repo, ".claude", "skills")


def source_path(repo, *parts):
    return os.path.join(repo, *SOURCE_DIR, *parts)


def roster(repo):
    """Skill -> declared asset dirs, read from source/probanda/roster.json."""
    with open(source_path(repo, "roster.json"), encoding="utf-8") as f:
        return json.load(f)


def packaged_assets(repo):
    return {s: tuple(d) for s, d in roster(repo).items() if d}


def skill_names(repo):
    """Every skill whose SKILL.md ships: the roster keys plus legal-commons."""
    return sorted(roster(repo)) + [COMMONS_SKILL]


def skill_md(repo, skill):
    return os.path.join(skills_root(repo), skill, "SKILL.md")


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


def preamble_lines(version):
    """The lines stamp_skill_md() inserts after a shipped roster SKILL.md's frontmatter.
    The build carries its own copy; shipped-tree-purity is what catches a disagreement."""
    return [
        f"<!-- probanda v{version} -->",
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


def stamp_skill_md(text, version):
    """Return a SKILL.md's text with preamble_lines(version) inserted after its closing
    frontmatter fence, behind one blank line. Inserted lines take the fence line's
    ending. Raises ValueError when the text has no frontmatter to stamp after."""
    lines = text.split("\n")
    if not lines or lines[0].strip() != "---":
        raise ValueError("no frontmatter fence to stamp after")
    end = next((i for i in range(1, len(lines)) if lines[i].strip() == "---"), None)
    if end is None:
        raise ValueError("no frontmatter fence to stamp after")
    cr = "\r" if lines[0].endswith("\r") else ""
    inserted = [line + cr for line in [""] + preamble_lines(version)]
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


def fetch_grant_allowlist_violations(agents_dir):
    """`sources__fetch` is granted only by the agent files in FETCH_GRANT_AGENTS, by at
    least one agent, and by each listed agent that is present under both its plain and
    its bridged name. A listed agent that is absent passes."""
    present = sorted(os.listdir(agents_dir)) if os.path.isdir(agents_dir) else []
    granting = {}
    for fn in present:
        if fn.endswith(".md"):
            tools = [t for t in agent_tools(os.path.join(agents_dir, fn)) if t == FETCH_TOOL or t.endswith("__" + FETCH_TOOL)]
            if tools:
                granting[fn] = tools
    if not granting:
        return [f"no agent grants {FETCH_TOOL}"]
    hits = [f"{fn} grants {FETCH_TOOL} but is not in FETCH_GRANT_AGENTS ({', '.join(FETCH_GRANT_AGENTS)})"
            for fn in granting if fn not in FETCH_GRANT_AGENTS]
    for fn in FETCH_GRANT_AGENTS:
        if fn in present:
            hits += [f"{fn} does not grant {name}" for name in FETCH_GRANTS if name not in granting.get(fn, [])]
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


def recital_rule_mirror_violations(repo, source=RECITAL_RULE_SOURCE, mirrors=RECITAL_RULE_MIRRORS):
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


# --- shipped-tree-purity --------------------------------------------------------------------------

def shipped_manifest(repo):
    """(sha256, relpath) for every file in the built plugin, paths relative to it."""
    root = os.path.join(repo, *SHIPPED_DIR)
    manifest = []
    for dirpath, dirs, files in os.walk(root):
        dirs.sort()
        for fn in sorted(files):
            p = os.path.join(dirpath, fn)
            manifest.append((sha256_file(p), os.path.relpath(p, root).replace(os.sep, "/")))
    return manifest


def skill_source_expected(root, roster_names, assets):
    """The `.claude/skills/`-relative paths the plugin should ship under `skills/`:
    every allowlisted text file under each roster skill and each extra tree, plus every
    file in one of that skill's declared asset dirs (an Office lock file excepted)."""
    expected = set()
    for top in list(roster_names) + list(EXTRA_TREES):
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


def skill_source_hit_counts(repo, shipped_rels):
    """Per-file hit counts, keyed by repo-relative path: HOST_PATH over every shipped
    text file, matter_codes over those plus the plugin agents and the firm rule
    overlay's test fixtures. Counts only -- the matched text never leaves here."""
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
    overlay_fixtures = source_path(repo, "mcp", "test", "fixtures", "rule-overlay", "*.json")
    for path in sorted(glob.glob(source_path(repo, "agents", "*.md")) + glob.glob(overlay_fixtures)):
        with open(path, encoding="utf-8", errors="replace") as f:
            n = len(matter_codes(f.read()))
        if n:
            counts["matter_code"][os.path.relpath(path, repo).replace(os.sep, "/")] = n
    return counts


def shipped_tree_purity(repo, manifest, roster_names, assets, baseline, version):
    """Return (hits, summary) for the `skills/` entries of a manifest ((sha256, relpath)
    pairs). Every entry must be its source file byte for byte, except a roster SKILL.md,
    which must be its source plus the preamble stamp_skill_md(text, version) inserts."""
    root = skills_root(repo)
    tops = set(roster_names) | set(EXTRA_TREES)
    hits = []
    shipped = set()
    for sha, arcname in manifest:
        if not arcname.startswith(SHIPPED_PREFIX):
            continue
        rel = arcname[len(SHIPPED_PREFIX):]
        parts = rel.split("/")
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
            hits.append(f"not a roster skill or an extra tree ({', '.join(EXTRA_TREES)}): {arcname}")
        source = os.path.join(root, *parts)
        if not os.path.isfile(source):
            hits.append(f"no source file: {arcname}")
        elif parts[0] in roster_names and rel == f"{parts[0]}/SKILL.md":
            with open(source, encoding="utf-8", newline="") as f:
                text = f.read()
            try:
                want = hashlib.sha256(stamp_skill_md(text, version).encode("utf-8")).hexdigest()
            except ValueError:
                want = None
            if want != sha:
                hits.append(f"SKILL.md not source + preamble: {arcname}")
        elif sha256_file(source) != sha:
            hits.append(f"differs from source: {arcname}")
    for rel in sorted(skill_source_expected(root, roster_names, assets) - shipped):
        hits.append(f"missing from payload: {SHIPPED_PREFIX}{rel}")

    # VISION.md ships at the plugin root, byte for byte.
    vision_shas = [sha for sha, arcname in manifest if arcname == VISION_FILE]
    vision_src = source_path(repo, VISION_FILE)
    if not vision_shas:
        hits.append(f"missing from payload: {VISION_FILE}")
    elif not os.path.isfile(vision_src) or sha256_file(vision_src) != vision_shas[0]:
        hits.append(f"differs from source: {VISION_FILE}")

    present = sorted(rel for rel in shipped if os.path.isfile(os.path.join(root, *rel.split("/"))))
    counts = skill_source_hit_counts(repo, present)
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
    """Rewrite the ratchet baseline from what the sources say should ship."""
    rels = sorted(skill_source_expected(skills_root(repo), sorted(roster(repo)), packaged_assets(repo)))
    counts = skill_source_hit_counts(repo, rels)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(counts, f, indent=2, sort_keys=True)
        f.write("\n")
    return counts


# --- the checks ----------------------------------------------------------------------------------
# Each returns (ok, detail).

def check_roster_sanity(repo):
    missing = [s for s in skill_names(repo) if not os.path.isfile(skill_md(repo, s))]
    return not missing, ("missing source for: " + ", ".join(missing)) if missing else ""


def check_reserved_name(repo):
    reserved = [s for s in skill_names(repo) if RESERVED_NAME.search(s)]
    return not reserved, ("rename: " + ", ".join(reserved)) if reserved else ""


def check_description_no_xml_tags(repo):
    xml_hits = []
    for s in skill_names(repo):
        if not os.path.isfile(skill_md(repo, s)):
            continue
        desc = extract_field(read_frontmatter_lines(skill_md(repo, s)), "description") or []
        found = XML_TAG.findall("\n".join(desc))
        if found:
            xml_hits.append(f"{s}: {', '.join(sorted(set(found)))}")
    return not xml_hits, "; ".join(xml_hits)


def check_description_length(repo):
    long_hits, near_hits = [], []
    for s in skill_names(repo):
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


def check_no_absolute_repo_paths(repo):
    needle = os.path.join(repo, ".claude")
    abs_hits = []
    for s in skill_names(repo):
        if not os.path.isfile(skill_md(repo, s)):
            continue
        abs_hits.extend(rel for _n, rel in grep_tree(repo, s, needles_cs=(needle,))
                        if posixpath.basename(rel) not in RUNTIME_FILES)
    return not abs_hits, ("absolute repo path in: " + ", ".join(sorted(set(abs_hits)))) if abs_hits else ""


def check_reference_resolution(repo):
    assets = packaged_assets(repo)
    shipped = skill_source_expected(skills_root(repo), sorted(roster(repo)), assets)
    ref_hits = []
    for s in skill_names(repo):
        if os.path.isdir(os.path.join(skills_root(repo), s)):
            ref_hits.extend(broken_references(repo, s, assets, shipped))
    with open(REFERENCE_UNSHIPPED_BASELINE, encoding="utf-8") as f:
        known = set(json.load(f)["known_unshipped"])
    ref_fail, n_known = reference_hit_verdict([f"{rel} -> {ref}" for rel, ref in ref_hits], known)
    if ref_fail:
        return False, "; ".join(ref_fail)
    return True, f"{n_known} known unshipped" if n_known else ""


def check_entry_point_registry(repo):
    ep_hits = []
    for entry in ENTRY_POINT_REGISTRY:
        ep_hits.extend(entry_point_violations(os.path.join(repo, *entry["path"].split("/")), entry["symbols"]))
        module_name = os.path.splitext(os.path.basename(entry["path"]))[0]
        for consumer in entry["consumers"]:
            ep_hits.extend(consumer_import_violations(
                os.path.join(repo, *consumer.split("/")), module_name, entry["symbols"]))
    return not ep_hits, "; ".join(ep_hits)


def check_bundle_purity(repo):
    purity_hits = []
    found_any_bundle = False
    for dist_rel in PURITY_DISTS:
        dist = source_path(repo, dist_rel, "dist")
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
        lowered = blob.lower()
        for token in ("supabase", "legal_commons__"):
            if token in lowered:
                purity_hits.append(f"{dist_rel}/dist: {token}")
    if not found_any_bundle:
        return False, "no bundle found"
    return not purity_hits, ("found: " + ", ".join(purity_hits)) if purity_hits else ""


def check_sources_host_guard(repo):
    data_js = source_path(repo, *DATA_BUNDLE)
    if not os.path.isfile(data_js):
        return False, "/".join(DATA_BUNDLE) + " not found"
    with open(data_js, encoding="utf-8") as f:
        guard_hits = sources_host_guard_violations(f.read())
    return not guard_hits, "; ".join(guard_hits)


def check_fetch_grant_allowlist(repo):
    fetch_hits = fetch_grant_allowlist_violations(source_path(repo, "agents"))
    return not fetch_hits, "; ".join(fetch_hits)


def check_recital_rule_mirror(repo):
    recital_hits = recital_rule_mirror_violations(repo)
    return not recital_hits, "; ".join(recital_hits)


def check_bundle_no_host_path(repo):
    host_hits = []
    for dist_rel in HOST_PATH_DISTS:
        dist = source_path(repo, dist_rel, "dist")
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


def check_inverse_reference(repo):
    needles = COMMONS_AGENTS
    inv_hits = []
    for s in sorted(roster(repo)):
        inv_hits.extend(grep_tree(repo, s, needles_ci=needles))
    inv_hits.extend(grep_dir(repo, source_path(repo, "agents"), needles,
                             skip={f"{a}.md" for a in COMMONS_AGENTS}))
    if inv_hits:
        return False, "; ".join(f"'{n}' in {rel}" for n, rel in sorted(set(inv_hits)))
    return True, "commons agents checked: " + ", ".join(COMMONS_AGENTS)


def check_shipped_tree_purity(repo):
    with open(SKILL_SOURCE_BASELINE, encoding="utf-8") as f:
        baseline = json.load(f)
    with open(source_path(repo, "plugin.json"), encoding="utf-8") as f:
        version = json.load(f)["version"]
    hits, summary = shipped_tree_purity(
        repo, shipped_manifest(repo), sorted(roster(repo)), packaged_assets(repo), baseline, version)
    return not hits, "; ".join(hits) if hits else summary


def check_agent_bridged_grants(repo):
    bridge_hits = agent_bridged_grant_violations(source_path(repo, "agents"))
    return not bridge_hits, "; ".join(bridge_hits)


def check_commons_encapsulation(repo):
    enc_hits = grep_tree(repo, COMMONS_SKILL, needles_ci=COMMONS_FORBIDDEN)
    return not enc_hits, "; ".join(f"{rel} has '{n}'" for n, rel in enc_hits)


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
    ("bundle-purity: no data or canlii dist bundle carries 'supabase' or 'legal_commons__'",
     check_bundle_purity),
    ("sources-host-guard: the data server's sources module fetches only over https from allowed "
     "hosts, SOURCES_ALLOWED_HOSTS as expected, guarded before every request", check_sources_host_guard),
    ("fetch-grant-allowlist: only allowlisted agents grant sources__fetch, each present one under "
     "both its plain and bridged names", check_fetch_grant_allowlist),
    ("recital-rule-mirror: every inline copy of the recital rule matches "
     "authority-claim-verification.md §3", check_recital_rule_mirror),
    ("bundle-no-host-path: no dist bundle contains an absolute host path", check_bundle_no_host_path),
    ("inverse-reference: no roster skill or non-commons agent names a commons agent", check_inverse_reference),
    ("shipped-tree-purity: plugins/probanda/skills is exactly the roster + extra-tree source "
     "(roster SKILL.md + preamble), VISION.md ships from source, with no host path or matter code "
     "over baseline", check_shipped_tree_purity),
    ("agent-bridged-grants: every plugin MCP grant in an agent has its bridged twin and nothing more",
     check_agent_bridged_grants),
    ("commons-encapsulation: the legal-commons gatekeeper skill names no local DB file",
     check_commons_encapsulation),
)


def run_checks(repo):
    """[(label, ok, detail)] for every check. A check that raises is a FAIL."""
    results = []
    for label, fn in CHECKS:
        try:
            ok, detail = fn(repo)
        except Exception as exc:  # reported as a FAIL, never skipped
            ok, detail = False, f"could not run: {type(exc).__name__}: {exc}"
        results.append((label, ok, detail))
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
    results = run_checks(REPO)
    print(f"Invariant checks for 'probanda' ({len(skill_names(REPO))} skills):")
    for label, ok, detail in results:
        print(f"  [{'PASS' if ok else 'FAIL'}] {label}" + (f" — {detail}" if detail else ""))
    failures = [label for label, ok, _ in results if not ok]
    if failures:
        print(f"\nCHECK FAILED — {len(failures)} invariant(s) violated.")
        return 1
    print("\nALL CHECKS PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
