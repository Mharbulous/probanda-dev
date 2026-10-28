"""What Cowork refuses or silently changes in a skill, shared by build_plugin.py and
check_plugin.py's helpers check_plugin_skill_md.py and check_plugin_sources.py.
Standard library only."""
import re

# Cowork silently renames an installed skill whose name has the segment "claude".
# Segment match only, so prose is never scanned.
RESERVED = re.compile(r"(?:^|[-_.])claude(?:[-_.]|$)", re.IGNORECASE)
# Cowork rejects the whole upload when one description runs past 1024 characters
# or contains an XML tag.
DESCRIPTION_MAX_CHARS = 1024
XML_TAG = re.compile(r"<[/!a-zA-Z][^>]*>")


def field(fm_lines, key):
    """A frontmatter field's raw block: the `key:` line plus any indented continuation
    lines, from the lines between the fences. Returns the list of raw lines, or None if absent."""
    for idx, line in enumerate(fm_lines):
        if line.startswith(key + ":"):
            out = [line]
            for cont in fm_lines[idx + 1:]:
                if cont.strip() == "" or cont[0] in (" ", "\t"):
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
