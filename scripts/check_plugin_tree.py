"""Shipped-tree purity, for check_plugin.py: the built skills folder against its source,
and the host-path and matter-code ratchet."""
import glob
import hashlib
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from check_plugin_sources import (  # noqa: E402
    BASELINES, EXTRA_TREES, HOST_PATH, skills_root, source_path, server_path, roster, packaged_assets,
    extra_trees, public_skill_dirs, public_skills)
from check_plugin_skill_md import stamp_skill_md  # noqa: E402

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


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(65536), b""):
            h.update(block)
    return h.hexdigest()


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


def check_shipped_tree_purity(repo, plugin):
    with open(SKILL_SOURCE_BASELINE, encoding="utf-8") as f:
        baseline = json.load(f)
    with open(source_path(repo, plugin, "plugin.json"), encoding="utf-8") as f:
        version = json.load(f)["version"]
    hits, summary = shipped_tree_purity(
        repo, plugin, shipped_manifest(repo, plugin), sorted(roster(repo, plugin)), packaged_assets(repo, plugin),
        baseline, version)
    return not hits, "; ".join(hits) if hits else summary
