#!/usr/bin/env python3
"""Build the plugins under plugins/ from the sources in this repo.

Usage:
  python scripts/build_plugin.py              build each plugin into plugins/<plugin>/, replacing it wholesale
  python scripts/build_plugin.py --check      compare a fresh build with plugins/<plugin>/
  python scripts/build_plugin.py --out <dir>  build into <dir> instead (replaced wholesale)

Every plugin in source/assignment.json is built (see plugin_layout.py). Plugin P
is built from source/P/ (plugin.json and roster.json, and .mcp.json, README.md,
VISION.md, agents/ and hooks/ where they exist), the skills the assignment gives
P, the whole shared/ tree, and the bundles of the servers the assignment gives P.
--out <dir> holds one folder per plugin, <dir>/P/. A folder under plugins/ that
no plugin builds is reported stale by --check and removed by a build.

A skill is found at .claude/skills/<name>/ or at public/plugins/*/skills/<name>/,
never both. The skill selection and the SKILL.md stamp are ported from CoClerk's
plugin-packager build_plugin.py (native-tree path).

A file ships executable (mode 755) when it begins with "#!", and otherwise
not (644), so the mode follows the bytes and is the same on every platform.
--check compares each file's mode with the mode git records for it, in plugins/
and in its source, because a Windows checkout cannot record the executable bit
on disk: there `git update-index --chmod=+x <file>` sets it.

Exit codes: 0 built or identical, 1 --check found differences, 2 a gate stopped
the build before anything was written, or another build was running. Standard
library only.
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import plugin_layout  # noqa: E402

REPO = Path(__file__).resolve().parent.parent

# Shipped skill trees beside the roster skills. They are not stamped: shared/ is
# not a skill, and legal-commons shipped unstamped in phase 1. shared/ ships in
# every plugin, legal-commons in the plugin the assignment gives it to.
SHARED_TREE = "shared"
EXTRA_TREES = (SHARED_TREE, "legal-commons")
# Skills already free of Trade Secrets live under public/, the source of the public
# repository, one skills folder per public plugin. They ship as they are, unstamped
# and whole, so the development plugin runs the published bytes. A skill lives here
# or under .claude/skills/, never both.
PUBLIC_SKILLS = "public/plugins/*/skills"
TREE_EXCLUDE_DIRS = ("__pycache__", "sessions", "tests", "determinizing-tests", "evals", ".pytest_cache")
# Text ships by extension; anything else ships only inside a roster-declared
# asset dir. Office lock files (~$*) are never wanted, even there.
TREE_TEXT_EXTS = (".md", ".py", ".sql", ".json")
TRANSIENT_ASSET_PREFIX = "~$"
# Files written with LF line endings and scanned for old plugin identifiers.
TEXT_SUFFIXES = {".md", ".py", ".json", ".js", ".txt", ".html", ".css", ".csv", ".yaml", ".yml", ".sql"}
# The retired single plugin probanda's tool-name and agent or skill prefixes are old too.
OLD_IDENTIFIERS = (rb"plugin_litigation_", rb"plugin_legal-commons_", rb"plugin_legal_",
                   rb"plugin_probanda_", rb"probanda:[A-Za-z]")
REPLACE_RETRY_SECONDS = 30  # a file watcher or sync client locks a folder for seconds
# A path a hook runs from the installed plugin's folder.
HOOK_PATH = re.compile(r"\$\{CLAUDE_PLUGIN_ROOT\}/([^\s\"']+)")
# A file that starts with a shebang is run directly, so it ships executable.
EXECUTABLE, NOT_EXECUTABLE = 0o755, 0o644

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


stop = plugin_layout.stop


def file_mode(data):
    return EXECUTABLE if data.startswith(b"#!") else NOT_EXECUTABLE


def git_modes(repo):
    """{repo-relative posix path: 0o755 or 0o644} as git's index records them, or {}
    when `repo` is not a git work tree."""
    if not (repo / ".git").exists():
        return {}
    out = subprocess.run(["git", "-C", str(repo), "ls-files", "-s", "-z"],
                         capture_output=True, check=True).stdout
    modes = {}
    for entry in out.split(b"\0"):
        if entry:
            meta, path = entry.split(b"\t", 1)
            modes[path.decode("utf-8")] = EXECUTABLE if meta.startswith(b"100755") else NOT_EXECUTABLE
    return modes


def recorded_mode(path, rel, modes):
    """The mode git records for `path` (`rel` from the repo root), else its mode on disk where
    the disk can hold one, else None: Windows has no executable bit to read."""
    if rel in modes:
        return modes[rel]
    if os.name == "nt":
        return None
    return EXECUTABLE if path.stat().st_mode & 0o111 else NOT_EXECUTABLE


def preamble_lines(plugin, version):
    return [
        f"<!-- {plugin} v{version} -->",
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


def stamp_skill_md(text, plugin, version):
    """Insert the preamble after the closing frontmatter fence, behind one blank line."""
    lines = text.split("\n")
    end = frontmatter_end(lines)
    if end is None:
        raise ValueError("no frontmatter fence to stamp after")
    return "\n".join(lines[:end + 1] + [""] + preamble_lines(plugin, version) + lines[end + 1:])


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


def check_skills(skill_dirs):
    """Gate the name and the description of each skill in {name: its folder}."""
    bad, problems = [], []
    for s, folder in skill_dirs.items():
        if RESERVED.search(s):
            bad.append(f"skill '{s}'")
        skill_md = folder / "SKILL.md"
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


def collect_tree(skills_root, top, declared_dirs, stamp, origins):
    """One private skill tree. `stamp` is the (plugin name, version) its SKILL.md is
    stamped with, or None for a tree that ships unstamped. Records each file's source in `origins`."""
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
                data = stamp_skill_md(data.decode("utf-8"), *stamp).encode("utf-8")
            except ValueError:
                stop(f"{path}: no frontmatter fence to stamp after")
        files[f"skills/{arc}"] = data
        origins[f"skills/{arc}"] = path
    return files


def public_skill_dirs(repo):
    """{skill name: its folder} for every skill under a public plugin."""
    found = {}
    for path in sorted(repo.glob(PUBLIC_SKILLS + "/*")):
        if path.is_dir():
            if path.name in found:
                stop(f"skill '{path.name}' is under two public plugins: {found[path.name]} and {path}")
            found[path.name] = path
    return found


def collect(repo, spec):
    """Every output file of one plugin as {relative path: bytes}, and {relative path: source
    file} for each one copied from a source file. Stops on a gate failure."""
    name = spec["name"]
    src = repo / spec["source"]
    skills_root = repo / ".claude" / "skills"
    for required in ("plugin.json", "roster.json"):
        if not (src / required).is_file():
            stop(f"no {src / required}")
    manifest = json.loads((src / "plugin.json").read_text(encoding="utf-8"))
    roster = json.loads((src / "roster.json").read_text(encoding="utf-8"))
    version = manifest["version"]
    if manifest["name"] != name:
        stop(f"{src / 'plugin.json'} names the plugin '{manifest['name']}', expected '{name}'")
    if RESERVED.search(name):
        stop(f"reserved word 'claude' in plugin name '{name}'")

    public = public_skill_dirs(repo)
    both = [t for t in public if t in roster or t in EXTRA_TREES or (skills_root / t).exists()]
    if both:
        stop("skill in both public/ and .claude/skills/ (a skill lives in one): " + ", ".join(both))
    # The assignment says which skills and agents the plugin ships, and the
    # plugin's source says which folders of a private skill are assets and
    # holds the agent files, so the two must agree.
    public = {t: public[t] for t in sorted(spec["skills"]) if t in public}
    extra = [t for t in EXTRA_TREES if t == SHARED_TREE or t in spec["skills"]]
    private = {t for t in spec["skills"] if t not in public and t not in EXTRA_TREES}
    if private != set(roster):
        stop(f"{src / 'roster.json'} and source/assignment.json disagree on the private skills of '{name}': "
             + ", ".join(sorted(private ^ set(roster))))
    agents = {p.stem for p in (src / "agents").glob("*.md")}
    if agents != set(spec["agents"]):
        stop(f"{src / 'agents'} and source/assignment.json disagree on the agents of '{name}': "
             + ", ".join(sorted(agents ^ set(spec["agents"]))))
    declared = sorted(json.loads((src / ".mcp.json").read_text(encoding="utf-8"))) \
        if (src / ".mcp.json").is_file() else []
    if declared != sorted(spec["servers"]):
        stop(f"{src / '.mcp.json'} declares the servers {declared}, but '{name}' ships {sorted(spec['servers'])}")
    check_skills({t: skills_root / t for t in sorted(roster) + [t for t in extra if t != SHARED_TREE]})
    check_skills(public)

    files = {".claude-plugin/plugin.json": (json.dumps(manifest, indent=2) + "\n").encode("utf-8")}
    origins = {}
    for fname in (".mcp.json", "README.md", "VISION.md"):
        if (src / fname).is_file():
            origins[fname] = src / fname
    for sub in ("agents", "hooks"):
        if (src / sub).is_dir():
            for path in sorted((src / sub).iterdir()):
                if path.is_file() and path.suffix != ".pyc":
                    origins[f"{sub}/{path.name}"] = path
    for top, folder in public.items():
        for path in sorted(folder.rglob("*")):
            if path.is_file():
                origins[f"skills/{top}/{path.relative_to(folder).as_posix()}"] = path
    files.update({rel: path.read_bytes() for rel, path in origins.items()})
    for top in sorted(roster):
        files.update(collect_tree(skills_root, top, roster[top], stamp=(name, version), origins=origins))
    for top in extra:
        files.update(collect_tree(skills_root, top, (), stamp=None, origins=origins))
    for text_path in [p for p in files if Path(p).suffix.lower() in TEXT_SUFFIXES]:
        files[text_path] = files[text_path].replace(b"\r\n", b"\n")
    # The bundles are built elsewhere and ship byte-for-byte.
    for server in spec["servers"]:
        folder = plugin_layout.SERVER_DIRS[server]
        dist = src / folder / "dist"
        if not dist.is_dir():
            stop(f"no MCP bundle folder {dist}")
        for path in sorted(dist.rglob("*")):
            if path.is_file():
                files[f"{folder}/dist/{path.relative_to(dist).as_posix()}"] = path.read_bytes()
                origins[f"{folder}/dist/{path.relative_to(dist).as_posix()}"] = path

    private = [p for p in files if PRIVATE_TEMPLATE_ASSET.match(p) and not PUBLIC_TEMPLATE_ASSET.match(p)]
    if private:
        stop("private letterhead asset would ship: " + ", ".join(private))
    bad_paths = [p for p in files if not ARCHIVE_PATH.match(p)]
    if bad_paths:
        stop("path with a character the Cowork upload validator rejects: " + ", ".join(bad_paths))
    # A hook whose script is not in the plugin fails at run time, on every call it guards.
    for word in [w for groups in manifest.get("hooks", {}).values() for group in groups
                 for hook in group.get("hooks", []) for w in [hook.get("command", ""), *hook.get("args", [])]]:
        for rel in HOOK_PATH.findall(word):
            if rel not in files:
                stop(f"hook path ${{CLAUDE_PLUGIN_ROOT}}/{rel} names no file in the built plugin '{name}'")
    leftovers = [f"{p}: {needle.decode()}" for p, data in files.items() if Path(p).suffix.lower() in TEXT_SUFFIXES
                 for needle in OLD_IDENTIFIERS if re.search(needle, data)]
    if leftovers:
        stop(f"old plugin identifiers in the output of '{name}':\n  " + "\n  ".join(leftovers))
    return files, origins


def rename(src, dst):
    """Rename `src` to `dst`, waiting out a file watcher, virus scanner or sync client
    that holds either folder open for a moment: Windows refuses the rename until it lets go."""
    deadline = time.monotonic() + REPLACE_RETRY_SECONDS
    while True:
        try:
            src.rename(dst)
            return
        except PermissionError:
            if time.monotonic() >= deadline:
                raise
            time.sleep(0.5)


def write(files, out):
    """Build beside `out`, then swap the finished folder into place, so a reader
    never sees a half-written `out`. Windows cannot rename a folder over an
    existing one, so the swap is two renames and `out` is absent between them.
    The building folder doubles as the lock against a second build."""
    building = out.with_name(f".{out.name}.building")
    replaced = out.with_name(f".{out.name}.replaced")
    out.parent.mkdir(parents=True, exist_ok=True)
    try:
        building.mkdir()
    except FileExistsError:
        stop(f"{building} exists: another build is running, or one was killed. "
             "If no build is running, delete that folder and build again.")
    try:
        for rel, data in files.items():
            path = building / rel
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
            path.chmod(file_mode(data))
        if replaced.exists():
            shutil.rmtree(replaced)
        if out.exists():
            rename(out, replaced)
        try:
            rename(building, out)
        except BaseException:
            if replaced.exists():
                rename(replaced, out)
            raise
    finally:
        if building.exists():
            shutil.rmtree(building)
    if replaced.exists():
        shutil.rmtree(replaced)


def check(files, origins, target, repo, modes):
    """Compare a fresh build of one plugin with `target`, bytes and modes. A mode is compared
    with the one git records in plugins/ and in the source, so Windows, whose disk has no
    executable bit, gets the same answer as Linux."""
    try:
        on_disk = {p.relative_to(target).as_posix(): p for p in target.rglob("*") if p.is_file()} \
            if target.is_dir() else {}
        changed = sorted(p for p in set(files) & set(on_disk) if on_disk[p].read_bytes() != files[p])
        mode_changed = []
        for p in sorted(set(files) & set(on_disk)):
            want = file_mode(files[p])
            for label, path in (("built", on_disk[p]), ("source", origins.get(p))):
                if path is None:
                    continue
                rel = path.relative_to(repo).as_posix() if path.is_relative_to(repo) else None
                have = recorded_mode(path, rel, modes)
                if have is not None and have != want:
                    mode_changed.append(f"{p}: {label} file {rel or path} is {have:o}, the build gives {want:o}")
    except FileNotFoundError as e:
        stop(f"{e.filename} disappeared while {target} was being read: a build appears to be "
             "running. Run --check again once it has finished.")
    added = sorted(set(files) - set(on_disk))
    removed = sorted(set(on_disk) - set(files))
    for label, paths in (("added", added), ("removed", removed), ("changed", changed), ("mode", mode_changed)):
        for p in paths:
            print(f"{label}: {p}")
    if added or removed or changed or mode_changed:
        print(f"{target} is stale: {len(added)} added, {len(removed)} removed, {len(changed)} changed, "
              f"{len(mode_changed)} with the wrong mode (a file that starts with #! is 755, any other 644; "
              "set a source mode with git update-index --chmod=+x or -x, then build)")
        return 1
    print(f"{target} is current")
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--check", action="store_true", help="compare a fresh build with plugins/<plugin>/")
    parser.add_argument("--out", type=Path, help="build into this folder instead of plugins/")
    parser.add_argument("--repo", type=Path, default=REPO, help="repo to read sources from (for tests)")
    args = parser.parse_args()
    repo = args.repo.resolve()
    # Every gate of every plugin runs before anything is written.
    built = {name: collect(repo, spec) for name, spec in plugin_layout.plugins(repo).items()}
    plugins_dir = repo / "plugins"
    stale = sorted(p for p in plugins_dir.iterdir() if p.is_dir() and p.name not in built
                   and not p.name.startswith(".")) if plugins_dir.is_dir() else []
    if args.check:
        modes = git_modes(repo)
        code = max([check(files, origins, plugins_dir / name, repo, modes)
                    for name, (files, origins) in built.items()], default=0)
        for folder in stale:
            print(f"{folder} is stale: no plugin in source/assignment.json builds it")
        return 1 if stale else code
    for name, (files, _) in built.items():
        out = (args.out.resolve() if args.out else plugins_dir) / name
        write(files, out)
        print(f"{out}: {len(files)} files")
    if not args.out:
        for folder in stale:
            shutil.rmtree(folder)
            print(f"{folder}: removed, no plugin in source/assignment.json builds it")
    return 0


if __name__ == "__main__":
    sys.exit(main())
