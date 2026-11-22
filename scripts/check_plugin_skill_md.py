"""SKILL.md frontmatter, description limits and the installed-copy preamble, for check_plugin.py."""
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from check_plugin_sources import skill_names, skill_md  # noqa: E402
from cowork_rules import DESCRIPTION_MAX_CHARS, XML_TAG, field, scalar_value  # noqa: E402

DESCRIPTION_WARN_CHARS = 950
PLUGIN_DESCRIPTION_BUDGET_CHARS = 8000
PLUGIN_DESCRIPTION_WARN_CHARS = 7500

_HTML_PAGES_EXCLUDED_DIRS = frozenset(("__pycache__", "sessions", "tests", "determinizing-tests", "evals", ".pytest_cache"))
_HTML_PAGES_SIGNAL = re.compile(
    r"html-pages|\.html\b|board_summary|milestone_path|view_page_paths|loose_threads_path"
    r"|practice_board_path|cast_of_characters_path|Litigation Strategy|Work Board"
    r"|Practice Board|Loose Threads|Cast of Characters|approval page|local-page",
    re.IGNORECASE,
)


def skill_uses_html_pages(skill_dir):
    """True when any non-test markdown file in `skill_dir` touches HTML pages or boards."""
    if not skill_dir or not os.path.isdir(skill_dir):
        return False
    for dirpath, dirs, files in os.walk(skill_dir):
        dirs[:] = [d for d in dirs if d not in _HTML_PAGES_EXCLUDED_DIRS]
        for fn in files:
            if not fn.endswith(".md"):
                continue
            try:
                with open(os.path.join(dirpath, fn), encoding="utf-8") as f:
                    if _HTML_PAGES_SIGNAL.search(f.read()):
                        return True
            except (OSError, UnicodeDecodeError):
                continue
    return False


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


def description_length(skill_md_path):
    """Folded character count of a SKILL.md's description, or None if it has none."""
    block = field(read_frontmatter_lines(skill_md_path), "description")
    return len(scalar_value(block)) if block else None


def preamble_lines(plugin_name, version, *, include_html_pages=True):
    """The lines stamp_skill_md() inserts after a shipped roster SKILL.md's frontmatter.
    The one source: build_plugin.py stamps with stamp_skill_md() from here."""
    lines = [
        f"<!-- {plugin_name} v{version} -->",
        "> **Installed copy.** Relative paths below cite this skill's shipped tree.",
        "> Resolve in order: current file's dir, `${CLAUDE_SKILL_DIR}/<path>`, then `${CLAUDE_SKILL_DIR}/../<path>` "
        "(so `shared/x.md` is `${CLAUDE_SKILL_DIR}/../shared/x.md`).",
        "> `${CLAUDE_SKILL_DIR}` is this SKILL.md's directory even if unsubstituted: never search or guess.",
        "> Read references and shared files with Read (whole or offset/limit), never via shell, the litigation data "
        "server's skill-source tool, or a folder-access request; run declared scripts and templates from there too.",
        "> Before each fresh read (not already in context), list only `${CLAUDE_SKILL_DIR}/../../..`. "
        "If it holds this plugin's folder name (sans `~g<N>`)",
        "> plus a `~g<N>` higher than this plugin's folder's own (none counts as 0), or if `${CLAUDE_SKILL_DIR}` "
        "no longer exists, the plugin was re-synced mid-session:",
        "> retry the three paths with the highest `~g<N>` copy's `skills/<this skill>` dir and tell the user once "
        "that the plugin updated mid-session (old version comment to new SKILL.md comment).",
        "> If still missing at every path, STOP and report the exact path and error: do not substitute, re-derive "
        "script logic, search elsewhere, or diagnose further; ask the user to reinstall the plugin and fully restart the app.",
    ]
    if include_html_pages:
        lines.extend([
            "> **HTML pages.** Every HTML file this plugin writes is a human interface generated from its databases;",
            "> never view, read, grep, parse, script over, author, or request a screenshot of one (you may present it "
            "to a human user, staging first where needed, and view screenshots the user provides).",
            "> Rule and data to use instead: `shared/html-pages.md`.",
        ])
    return lines


def stamp_skill_md(text, plugin_name, version, *, include_html_pages=True):
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
    inserted = [line + cr for line in [""] + preamble_lines(plugin_name, version, include_html_pages=include_html_pages)]
    return "\n".join(lines[:end + 1] + inserted + lines[end + 1:])


def check_description_no_xml_tags(repo, plugin):
    xml_hits = []
    for s in skill_names(repo, plugin):
        if not os.path.isfile(skill_md(repo, s)):
            continue
        desc = field(read_frontmatter_lines(skill_md(repo, s)), "description") or []
        found = XML_TAG.findall("\n".join(desc))
        if found:
            xml_hits.append(f"{s}: {', '.join(sorted(set(found)))}")
    return not xml_hits, "; ".join(xml_hits)


def check_description_length(repo, plugin):
    long_hits, near_hits = [], []
    total_chars, counted = 0, 0
    for s in skill_names(repo, plugin):
        if not os.path.isfile(skill_md(repo, s)):
            continue
        n = description_length(skill_md(repo, s))
        if n is None:
            continue
        total_chars += n
        counted += 1
        if n > DESCRIPTION_MAX_CHARS:
            long_hits.append(f"{s}: {n} chars, {n - DESCRIPTION_MAX_CHARS} over")
        elif n >= DESCRIPTION_WARN_CHARS:
            near_hits.append(f"{s}: {n} chars, {DESCRIPTION_MAX_CHARS - n} left")
    if long_hits:
        return False, "shorten the source description: " + "; ".join(long_hits)
    advisories = []
    if near_hits:
        advisories.append(f"NEAR LIMIT (>= {DESCRIPTION_WARN_CHARS}, still passing): " + "; ".join(near_hits))
    if total_chars > PLUGIN_DESCRIPTION_BUDGET_CHARS:
        advisories.append(
            f"PLUGIN LIST BUDGET: {total_chars}/{PLUGIN_DESCRIPTION_BUDGET_CHARS} chars across {counted} skills "
            f"({total_chars - PLUGIN_DESCRIPTION_BUDGET_CHARS} over Claude's ~{PLUGIN_DESCRIPTION_BUDGET_CHARS}-char list budget)"
        )
    elif total_chars >= PLUGIN_DESCRIPTION_WARN_CHARS:
        advisories.append(
            f"PLUGIN LIST BUDGET NEAR LIMIT: {total_chars}/{PLUGIN_DESCRIPTION_BUDGET_CHARS} chars across {counted} skills"
        )
    return True, "; ".join(advisories)
