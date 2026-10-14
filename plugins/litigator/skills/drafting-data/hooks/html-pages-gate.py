#!/usr/bin/env python3
"""Refuse an agent's access to a Probanda plugin HTML page (#1365).

Hook event: PreToolUse. The plugin's Job Board, Litigation Strategy and view pages (and
the older page names a render may still find) are human interfaces generated
from the plugin's databases (`shared/html-pages.md`). A view page is named
`<page name> - Job Board <id>.html` (ADR 0033, 2026-10-07 amendment; before
2026-10-09 `<page name> - filing <id>.html`, still recognised until the next
page write trashes it), and only a page name listed in VIEW_NAMES counts, so
each new view page adds its name there. An agent never views, reads,
greps, parses, scripts over, stages, authors or requests a screenshot; however,
an agent may present the html to a human user for them to view, and an agent
may view screenshots provided by a human user on the user's own initiative.
So this gate refuses:

- Read, Write, Edit, MultiEdit, NotebookRead, NotebookEdit on a page path;
- Grep whose path is a page, whose glob names a page, or whose glob (or type
  html) would take in a page that sits in the searched folder or one level
  below it;
- Bash, PowerShell, device_bash and workspace__bash whose command text names a
  page (best effort: a page reached through a variable or a wildcard passes);
- every other device_* tool with any string input naming a page, except
  device_stage_files given exactly `Litigation Strategy.html` (or the legacy
  `To Do List.html`), `Work Board.html` (the practice-wide page beside
  practice.db), `Job Board <id>.html`,
  `Job Board - proceeding <id>.html` or a listed view page's
  `<page name> - Job Board <id>.html`, case aside, or the same pages under their
  names before 2026-10-09 (`Job Board - filing <id>.html`,
  `<page name> - filing <id>.html`) (a remote-device-only host stages
  them to show a card; ADR 0033, 2026-10-05 amendments: one Job Board page per
  live Writing and per pre-filing proceeding, named by its id; 2026-10-07: the
  view pages).

Glob is never refused, and no other HTML file is. Exempt when COCLERK_HTML_DEV=1
is in the environment: developing or debugging the generator in Claude Code
(this repo's .claude/settings.json sets it).

Refuses by a JSON permissionDecision on stdout, exit 0; allows by exiting 0
silently. Fails OPEN on its own error, loudly on stderr, because its matcher
spans Read and a bug here must not block every read.
"""
import fnmatch
import json
import os
import re
import sys

# "to do list" is the Litigation Strategy page's name before 2026-10-08, kept so an old copy not
# yet moved to TRASH is still refused.
STEM = r"(?:job board|litigation strategy|to do list|work board|matter board|work_board @rev)"
# The view pages' names, lowercased (plugins/litigation/mcp/src/submission/view-pages.ts VIEW_PAGES).
# Each new view page adds its lowercased name here. "loose ideas" is the Loose Threads page's name
# before 2026-10-08, kept so an old copy not yet moved to TRASH is still refused.
VIEW_NAMES = ("provable facts", "raw research", "arguments", "loose threads", "loose ideas")
# A view page: a listed name, then " - job board <id>.html", or " - filing <id>.html", its name
# before 2026-10-09, kept so an old copy not yet moved to TRASH is still recognised.
VIEW = r"(?:" + "|".join(re.escape(name) for name in VIEW_NAMES) + r") - (?:job board|filing) \d+\.html"
PAGE_ANYWHERE = re.compile(STEM + r"[^\\/\n\"'`]*\.html|" + VIEW + r"|workboard-status\.js", re.I)
PAGE_NAME = re.compile(STEM + r"[^\\/]*\.html|" + VIEW + r"|workboard-status\.js", re.I)
# Canonical names a Grep glob is tried against.
SAMPLE_PAGES = ("Job Board.html", "Job Board 1.html", "Job Board - filing 1.html", "Job Board - proceeding 3.html", "Litigation Strategy.html", "To Do List.html",
                "Work Board.html", "Matter Board.html", "Work_board @rev1 2026-01-01-00-00.html", "workboard-status.js",
                "Provable Facts - Job Board 1.html", "Raw Research - Job Board 1.html", "Arguments - Job Board 1.html",
                "Loose Threads - Job Board 1.html", "Provable Facts - filing 1.html", "Raw Research - filing 1.html",
                "Arguments - filing 1.html", "Loose Threads - filing 1.html", "Loose Ideas - filing 1.html")

FILE_TOOLS = {"Read": "file_path", "Write": "file_path", "Edit": "file_path", "MultiEdit": "file_path",
              "NotebookRead": "notebook_path", "NotebookEdit": "notebook_path"}
SHELL_TOOL = re.compile(r"Bash|PowerShell|mcp__(.+__)?device_bash|mcp__(.+__)?workspace__bash")
DEVICE_TOOL = re.compile(r"mcp__(.+__)?device_.*")
STAGE_TOOL = re.compile(r"mcp__(.+__)?device_stage_files")
# Fullmatched on the lowercased basename: the Litigation Strategy page (and its legacy name), the
# practice-wide Work Board beside practice.db, the
# id-named Job Board pages (and a Writing's before 2026-10-09, "job board - filing <id>") and the
# listed view pages.
STAGEABLE = re.compile(r"litigation strategy\.html|to do list\.html|work board\.html|job board \d+\.html|job board - (?:filing|proceeding) \d+\.html|" + VIEW)


def basename(path):
    return re.split(r"[\\/]", path.rstrip("\\/"))[-1]


def is_page(path):
    return isinstance(path, str) and bool(PAGE_NAME.fullmatch(basename(path)))


def pages_near(folder):
    """A page in the folder or one level below it (where the matter pages sit)."""
    try:
        entries = list(os.scandir(folder))
    except OSError:
        return None
    for entry in entries:
        if is_page(entry.name):
            return entry.name
    for entry in entries:
        if entry.is_dir(follow_symlinks=False):
            try:
                for child in os.scandir(entry.path):
                    if is_page(child.name):
                        return child.name
            except OSError:
                continue
    return None


def grep_hit(tool_input, cwd):
    path = tool_input.get("path")
    if is_page(path):
        return basename(path)
    glob = tool_input.get("glob")
    named = PAGE_ANYWHERE.search(glob) if isinstance(glob, str) else None
    if named:
        return named.group(0)
    wide = tool_input.get("type") == "html" or (
        isinstance(glob, str) and any(fnmatch.fnmatch(name.lower(), glob.lower()) for name in SAMPLE_PAGES))
    if not wide:
        return None
    folder = path if isinstance(path, str) and path else cwd
    if not folder or not os.path.isdir(folder):
        return None
    return pages_near(folder)


def strings(value):
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for item in value.values():
            yield from strings(item)
    elif isinstance(value, list):
        for item in value:
            yield from strings(item)


def first_hit(texts):
    for text in texts:
        match = PAGE_ANYWHERE.search(text)
        if match:
            return match.group(0)
    return None


def message(name, shell):
    text = (
        f'Refused (HTML pages principle, shared/html-pages.md): "{name}" is a Probanda plugin page, '
        "a human interface generated from the plugin's databases. An agent never views, reads, greps, "
        "parses, scripts over, stages, authors or requests a screenshot; however, an agent may present "
        "the html to a human user for them to view, and an agent may view screenshots provided by a "
        "human user on the user's own initiative. Use the data instead: "
        "drafting_forms__render naming Work_board returns board_summary; "
        "drafting_forms__board_card returns what a card holds when opened; "
        "drafting_forms__open_session returns the page paths and the filing list; /drafting-data's "
        "query tools and the markdown mockups hold everything else. A change the practitioner wants "
        "to a page goes to /research:suggestion: never look for or edit the generator. Developing the generator in Claude "
        "Code: set COCLERK_HTML_DEV=1 (this repo's .claude/settings.json sets it)."
    )
    if shell:
        text += " Matched in the command text; a page reached another way is still off limits."
    return text


def deny(reason):
    sys.stdout.write(json.dumps({"hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": "deny",
        "permissionDecisionReason": reason,
    }}) + "\n")


def main():
    if os.environ.get("COCLERK_HTML_DEV") == "1":
        return 0
    payload = json.load(sys.stdin)
    tool = payload.get("tool_name") or ""
    tool_input = payload.get("tool_input") or {}
    shell = False
    if tool in FILE_TOOLS:
        path = tool_input.get(FILE_TOOLS[tool])
        hit = basename(path) if is_page(path) else None
    elif tool == "Grep":
        hit = grep_hit(tool_input, payload.get("cwd"))
    elif SHELL_TOOL.fullmatch(tool):
        command = tool_input.get("command")
        hit = first_hit([command]) if isinstance(command, str) else None
        shell = True
    elif DEVICE_TOOL.fullmatch(tool):
        texts = strings(tool_input)
        if STAGE_TOOL.fullmatch(tool):
            texts = (t for t in texts if not STAGEABLE.fullmatch(basename(t).lower()))
        hit = first_hit(texts)
    else:
        hit = None
    if hit:
        deny(message(hit, shell))
    return 0


if __name__ == "__main__":
    try:
        try:
            sys.stderr.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass
        sys.exit(main())
    except SystemExit:
        raise
    except Exception as exc:  # fail OPEN, loudly
        sys.stderr.write("html-pages-gate hook error (allowing call): " + type(exc).__name__ + ": " + str(exc) + "\n")
        sys.exit(0)
