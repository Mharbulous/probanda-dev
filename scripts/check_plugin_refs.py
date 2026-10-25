"""Reference resolution over skill prose, for check_plugin.py."""
import glob
import os
import posixpath
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from check_plugin_sources import skills_root, skill_names, skill_md, grep_tree  # noqa: E402

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


def check_no_absolute_repo_paths(repo, plugin):
    needle = os.path.join(repo, ".claude")
    abs_hits = []
    for s in skill_names(repo, plugin):
        if not os.path.isfile(skill_md(repo, s)):
            continue
        abs_hits.extend(rel for _n, rel in grep_tree(repo, s, needles_cs=(needle,))
                        if posixpath.basename(rel) not in RUNTIME_FILES)
    return not abs_hits, ("absolute repo path in: " + ", ".join(sorted(set(abs_hits)))) if abs_hits else ""
