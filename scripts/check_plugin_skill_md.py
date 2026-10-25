"""SKILL.md frontmatter, description limits and the installed-copy preamble, for check_plugin.py."""
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from check_plugin_sources import skill_names, skill_md  # noqa: E402

# Cowork's plugin validator rejects a SKILL.md whose description contains an XML
# tag, or runs past 1024 characters, failing the whole upload.
XML_TAG = re.compile(r"<[/!a-zA-Z][^>]*>")
DESCRIPTION_MAX_CHARS = 1024
DESCRIPTION_WARN_CHARS = 950


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
