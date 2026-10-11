#!/usr/bin/env python3
"""Build plugins/probanda from the sources in this repo.

Usage:
  python scripts/build_plugin.py              build into plugins/probanda/, replacing it wholesale
  python scripts/build_plugin.py --check      compare a fresh build with plugins/probanda/
  python scripts/build_plugin.py --out <dir>  build into <dir> instead (replaced wholesale)

Sources: the skill trees under .claude/skills/ (every key of
source/probanda/roster.json, plus shared/ and legal-commons/) and the plugin
files under source/probanda/. The skill selection and the SKILL.md stamp are
ported from CoClerk's plugin-packager build_plugin.py (native-tree path).

Exit codes: 0 built or identical, 1 --check found differences, 2 a gate stopped
the build before anything was written. Standard library only.
"""
import argparse
import json
import re
import shutil
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent

# Shipped skill trees beside the roster skills. They are not stamped: shared/ is
# not a skill, and legal-commons shipped unstamped in phase 1.
EXTRA_TREES = ("shared", "legal-commons")
TREE_EXCLUDE_DIRS = ("__pycache__", "sessions", "tests", "determinizing-tests", "evals", ".pytest_cache")
# Text ships by extension; anything else ships only inside a roster-declared
# asset dir. Office lock files (~$*) are never wanted, even there.
TREE_TEXT_EXTS = (".md", ".py", ".sql", ".json")
TRANSIENT_ASSET_PREFIX = "~$"
MCP_DIST_DIRS = ("mcp", "canlii-mcp", "commons-mcp")
# Files written with LF line endings and scanned for old plugin identifiers.
TEXT_SUFFIXES = {".md", ".py", ".json", ".js", ".txt", ".html", ".css", ".csv", ".yaml", ".yml", ".sql"}
OLD_IDENTIFIERS = ("plugin_litigation_", "plugin_legal-commons_")

# Cowork silently renames an installed skill whose name has the segment "claude".
RESERVED = re.compile(r"(?:^|[-_.])claude(?:[-_.]|$)", re.IGNORECASE)
# Cowork rejects the whole upload when one description runs past 1024 characters
# or contains an XML tag.
DESCRIPTION_MAX_CHARS = 1024
XML_TAG = re.compile(r"<[/!a-zA-Z][^>]*>")
# No Word template or image may ship beside the letterhead renderer (CoClerk #1003:
# a firm letterhead and a scanned signature once shipped to every install), except
# the public court templates.
PRIVATE_TEMPLATE_ASSET = re.compile(
    r"^skills/(?:publish/scripts"
    r"|publish/templates|publish/subskills/publish-general/scripts)"
    r"/.+\.(?:docx|dotx|png|jpe?g|gif|bmp|tiff?|emf|wmf|svg|webp)$",
    re.IGNORECASE)
PUBLIC_TEMPLATE_ASSET = re.compile(
    r"^skills/publish/templates/"
    r"(?:bcca-boa-toc\.docx|bcca-book-cover\.dotx|bcca-book-toc\.docx)$")
# The Cowork upload validator refuses an archive path with "invalid characters",
# which it does not define, so every path keeps to this conservative set.
ARCHIVE_PATH = re.compile(r"^[A-Za-z0-9._/-]+$")


def stop(message):
    print(f"STOP: {message}", file=sys.stderr)
    sys.exit(2)


def preamble_lines(version):
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


def frontmatter_end(lines):
    if not lines or lines[0].strip() != "---":
        return None
    return next((i for i in range(1, len(lines)) if lines[i].strip() == "---"), None)


def stamp_skill_md(text, version):
    """Insert the preamble after the closing frontmatter fence, behind one blank line."""
    lines = text.split("\n")
    end = frontmatter_end(lines)
    if end is None:
        raise ValueError("no frontmatter fence to stamp after")
    return "\n".join(lines[:end + 1] + [""] + preamble_lines(version) + lines[end + 1:])


def frontmatter_field(text, key):
    """The `key:` line plus its indented continuation lines, or None."""
    lines = text.split("\n")
    end = frontmatter_end(lines)
    if end is None:
        return None
    fm = lines[1:end]
    for idx, line in enumerate(fm):
        if line.startswith(key + ":"):
            out = [line]
            for cont in fm[idx + 1:]:
                if cont.strip() == "" or cont[0] in (" ", "\t"):
                    out.append(cont)
                else:
                    break
            while out and out[-1].strip() == "":
                out.pop()
            return out
    return None


def scalar_value(block_lines):
    """The YAML scalar value of a frontmatter field, so len() is the count Cowork
    applies. Handles plain scalars and `>`/`|` blocks with chomping indicators;
    anything rarer errs toward over-counting."""
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


def check_skills(skills_root, names):
    bad, problems = [], []
    for s in names:
        if RESERVED.search(s):
            bad.append(f"skill '{s}'")
        skill_md = skills_root / s / "SKILL.md"
        if not skill_md.is_file():
            problems.append(f"no SKILL.md for skill '{s}' at {skill_md}")
            continue
        text = skill_md.read_text(encoding="utf-8")
        m = re.search(r"^name:\s*(.+?)\s*$", text, re.MULTILINE)
        if m and RESERVED.search(m.group(1)):
            bad.append(f"frontmatter name '{m.group(1)}' in {s}/SKILL.md")
        block = frontmatter_field(text, "description")
        if block:
            value = scalar_value(block)
            if len(value) > DESCRIPTION_MAX_CHARS:
                problems.append(f"description of '{s}' is {len(value)} characters, over the "
                                f"{DESCRIPTION_MAX_CHARS}-character Cowork limit")
            hits = XML_TAG.findall(value)
            if hits:
                problems.append(f"XML tag in the description of '{s}': {', '.join(hits)}")
    if bad:
        problems.append("reserved word 'claude' in: " + "; ".join(bad))
    if problems:
        stop("\n  ".join(problems))


def collect_tree(skills_root, top, declared_dirs, version, stamp):
    top_dir = skills_root / top
    if not top_dir.is_dir():
        stop(f"no source directory {top_dir} to ship")
    declared = tuple(f"{top}/{d}/" for d in declared_dirs)
    files = {}
    for path in sorted(top_dir.rglob("*")):
        rel = path.relative_to(skills_root)
        if not path.is_file() or any(p in TREE_EXCLUDE_DIRS for p in rel.parts[:-1]):
            continue
        name, arc = path.name, rel.as_posix()
        if name.endswith(".pyc"):
            continue
        if path.suffix.lower() not in TREE_TEXT_EXTS and (
                not (declared and arc.startswith(declared)) or name.startswith(TRANSIENT_ASSET_PREFIX)):
            continue
        data = path.read_bytes()
        if stamp and arc == f"{top}/SKILL.md":
            try:
                data = stamp_skill_md(data.decode("utf-8"), version).encode("utf-8")
            except ValueError:
                stop(f"{path}: no frontmatter fence to stamp after")
        files[f"skills/{arc}"] = data
    return files


def collect(repo):
    """Every output file as {relative path: bytes}. Stops on a gate failure."""
    src = repo / "source" / "probanda"
    skills_root = repo / ".claude" / "skills"
    manifest = json.loads((src / "plugin.json").read_text(encoding="utf-8"))
    roster = json.loads((src / "roster.json").read_text(encoding="utf-8"))
    version = manifest["version"]
    if RESERVED.search(manifest["name"]):
        stop(f"reserved word 'claude' in plugin name '{manifest['name']}'")
    check_skills(skills_root, sorted(roster) + ["legal-commons"])

    files = {".claude-plugin/plugin.json": (json.dumps(manifest, indent=2) + "\n").encode("utf-8")}
    for name in (".mcp.json", "README.md", "VISION.md"):
        files[name] = (src / name).read_bytes()
    for sub in ("agents", "hooks"):
        for path in sorted((src / sub).iterdir()):
            if path.is_file() and path.suffix != ".pyc":
                files[f"{sub}/{path.name}"] = path.read_bytes()
    for top in sorted(roster):
        files.update(collect_tree(skills_root, top, roster[top], version, stamp=True))
    for top in EXTRA_TREES:
        files.update(collect_tree(skills_root, top, (), version, stamp=False))
    for text_path in [p for p in files if Path(p).suffix.lower() in TEXT_SUFFIXES]:
        files[text_path] = files[text_path].replace(b"\r\n", b"\n")
    # The bundles are built elsewhere and ship byte-for-byte.
    for name in MCP_DIST_DIRS:
        dist = src / name / "dist"
        if not dist.is_dir():
            stop(f"no MCP bundle folder {dist}")
        for path in sorted(dist.rglob("*")):
            if path.is_file():
                files[f"{name}/dist/{path.relative_to(dist).as_posix()}"] = path.read_bytes()

    private = [p for p in files if PRIVATE_TEMPLATE_ASSET.match(p) and not PUBLIC_TEMPLATE_ASSET.match(p)]
    if private:
        stop("private letterhead asset would ship: " + ", ".join(private))
    bad_paths = [p for p in files if not ARCHIVE_PATH.match(p)]
    if bad_paths:
        stop("path with a character the Cowork upload validator rejects: " + ", ".join(bad_paths))
    leftovers = [f"{p}: {needle}" for p, data in files.items() if Path(p).suffix.lower() in TEXT_SUFFIXES
                 for needle in OLD_IDENTIFIERS if needle.encode() in data]
    if leftovers:
        stop("old plugin identifiers in the output:\n  " + "\n  ".join(leftovers))
    return files


def write(files, out):
    if out.exists():
        shutil.rmtree(out)
    for rel, data in files.items():
        path = out / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        if path.suffix == ".py":
            path.chmod(0o755)


def check(files, target):
    on_disk = {p.relative_to(target).as_posix(): p for p in target.rglob("*") if p.is_file()} \
        if target.is_dir() else {}
    added = sorted(set(files) - set(on_disk))
    removed = sorted(set(on_disk) - set(files))
    changed = sorted(p for p in set(files) & set(on_disk) if on_disk[p].read_bytes() != files[p])
    for label, paths in (("added", added), ("removed", removed), ("changed", changed)):
        for p in paths:
            print(f"{label}: {p}")
    if added or removed or changed:
        print(f"{target} is stale: {len(added)} added, {len(removed)} removed, {len(changed)} changed")
        return 1
    print(f"{target} is current")
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--check", action="store_true", help="compare a fresh build with plugins/probanda/")
    parser.add_argument("--out", type=Path, help="build into this folder instead of plugins/probanda/")
    parser.add_argument("--repo", type=Path, default=REPO, help="repo to read sources from (for tests)")
    args = parser.parse_args()
    repo = args.repo.resolve()
    files = collect(repo)
    target = repo / "plugins" / "probanda"
    if args.check:
        return check(files, target)
    out = args.out.resolve() if args.out else target
    write(files, out)
    print(f"{out}: {len(files)} files")
    return 0


if __name__ == "__main__":
    sys.exit(main())
