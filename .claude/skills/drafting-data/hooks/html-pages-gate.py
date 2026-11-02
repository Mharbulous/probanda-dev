#!/usr/bin/env python3
"""Refuse an agent's access to a Probanda plugin HTML page (#1365).

Hook event: PreToolUse. The plugin's Work Board, Litigation Strategy and view pages (and
the older page names a render may still find) are human interfaces generated
from the plugin's databases (`shared/html-pages.md`). A Writing's Work Board page is
`Work Board.html` in the Writing's own folder, and its view pages `<page name>.html`
beside it (spec 2026-10-22). A board with no Writing has its view pages at the draft
folder's top as `<page name> - Work Board <id>.html`, or `<page name> - Work Board -
proceeding <id>.html` on a merged pre-filing board (docs/ADRs/0010) (ADR 0033,
2026-10-07 amendment; every view page's name until 2026-10-22, and before
2026-10-09 `<page name> - filing <id>.html`, still recognised until the next
page write trashes it), and only a page name listed in VIEW_NAMES counts, so
each new view page adds its name there. An agent never views, reads,
greps, parses, scripts over, authors or requests a screenshot; however,
an agent may present the html to a human user for them to view, staging it
first where presenting needs that, and an agent
may view screenshots provided by a human user on the user's own initiative.
So this gate refuses:

- Read, Write, Edit, MultiEdit, NotebookRead, NotebookEdit on a page path;
- Grep whose path is a page, whose glob names a page, or whose glob (or type
  html) would take in a page that sits in the searched folder or one level
  below it;
- Bash, PowerShell, device_bash and workspace__bash whose command text names a
  page (best effort: a page reached through a variable or a wildcard passes);
- every other device_* tool with any string input naming a page (for
  device_request_folder_access, its path only, never its reason), except
  device_stage_files given exactly `Litigation Strategy.html` (or the legacy
  `To Do List.html`), `Work Board.html` (the practice-wide page beside
  practice.db), `Work Board.html`, `Work Board <id>.html`,
  `Work Board - proceeding <id>.html` or a listed view page's `<page name>.html` or
  `<page name> - Work Board <id>.html`, case aside, or the same pages under their
  names before 2026-10-09 (`Work Board - filing <id>.html`,
  `<page name> - filing <id>.html`) (a remote-device-only host stages
  them to show a card; ADR 0033, 2026-10-05 amendments: one Work Board page per
  live Writing and per pre-filing proceeding, named by its id; 2026-10-07: the
  view pages), or a preview of one of the current names, `<page name> preview
  <n>.html` (#139: a re-rendered copy of a board shown as a card, and a page
  like any other, so every other access to it is refused).

Glob is never refused, and no other HTML file is. Exempt when COCLERK_HTML_DEV=1
is in the environment: developing or debugging the generator in Claude Code
(this repo's .claude/settings.json sets it). The refusal names neither it nor any
tool or skill file: a refusal is quoted to the practitioner verbatim
(shared/internals-confidentiality.md).

Refuses by a JSON permissionDecision on stdout, exit 0; allows by exiting 0
silently. Fails OPEN on its own error, loudly on stderr, because its matcher
spans Read and a bug here must not block every read.
"""
import fnmatch
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "shared" / "scripts"))
import hook_io  # noqa: E402

# "to do list" is the Litigation Strategy page's name before 2026-10-08, kept so an old copy not
# yet moved to TRASH is still refused. "job board" is the Work Board's name before 2026-10-28, kept
# for the same reason.
STEM = r"(?:Work Board|job board|litigation strategy|to do list|work board|matter board|work_board @rev)"
# The view pages' names, lowercased (plugins/litigation/mcp/src/submission/view-pages.ts VIEW_PAGES).
# Each new view page adds its lowercased name here. "loose ideas" is the Loose Threads page's name
# before 2026-10-08, "provable facts" the Material Facts page's before 2026-10-20 (docs/ADRs/0011), and
# "raw research" and "legal memos" the Legal Research page's before 2026-10-31 and 2026-11-01, each kept so an old copy not yet moved to TRASH is still refused.
VIEW_NAMES = ("procedural history", "material facts", "legal research", "arguments", "loose threads", "loose ideas", "provable facts", "raw research", "legal memos")
# A view page: a listed name, then ".html" in a Writing's own folder, or " - Work Board <id>.html",
# or " - Job Board <id>.html", its name before 2026-10-28,
# or " - filing <id>.html", its name before 2026-10-09, each kept so an old copy not yet moved to TRASH is
# still recognised. A preview of a page (#139) is the page's stem, then " preview <n>.html"; a board
# stem already matches STEM, so only a view page's preview needs its own pattern here. The bare name
# is not matched inside a longer word.
VIEW_NAME = r"(?:" + "|".join(re.escape(name) for name in VIEW_NAMES) + r")"
VIEW = r"(?<![\w-])" + VIEW_NAME + r"(?: - (?:(?:Work Board|job board)(?: - proceeding)?|filing) \d+)?(?: preview \d+)?\.html"
PAGE_ANYWHERE = re.compile(STEM + r"[^\\/\n\"'`]*\.html|" + VIEW + r"|workboard-status\.js", re.I)
PAGE_NAME = re.compile(STEM + r"[^\\/]*\.html|" + VIEW + r"|workboard-status\.js", re.I)
# Canonical names a Grep glob is tried against.
SAMPLE_PAGES = ("Work Board.html", "Work Board 1.html", "Work Board - filing 1.html", "Work Board - proceeding 3.html", "Litigation Strategy.html", "To Do List.html",
                "Work Board.html", "Matter Board.html", "Work_board @rev1 2026-01-01-00-00.html", "workboard-status.js",
                "Procedural History - Work Board 1.html", "Material Facts - Work Board 1.html", "Provable Facts - Work Board 1.html",
                "Raw Research - Work Board 1.html", "Arguments - Work Board 1.html",
                "Loose Threads - Work Board 1.html", "Provable Facts - filing 1.html", "Raw Research - filing 1.html",
                "Arguments - filing 1.html", "Loose Threads - filing 1.html", "Loose Ideas - filing 1.html",
                "Job Board 1.html", "Provable Facts - Job Board 1.html",
                "Work Board preview 1.html", "Litigation Strategy preview 1.html", "Work Board 1 preview 1.html",
                "Work Board - proceeding 3 preview 1.html", "Procedural History - Work Board 1 preview 1.html",
                "Material Facts - Work Board 1 preview 1.html", "Provable Facts - Work Board 1 preview 1.html",
                "Raw Research - Work Board 1 preview 1.html", "Arguments - Work Board 1 preview 1.html",
                "Loose Threads - Work Board 1 preview 1.html", "Provable Facts - Work Board - proceeding 3.html",
                "Procedural History - Work Board - proceeding 3.html", "Material Facts - Work Board - proceeding 3.html",
                "Procedural History.html", "Material Facts.html", "Raw Research.html", "Arguments.html", "Loose Threads.html",
                "Legal Research.html", "Legal Research - Work Board 1.html", "Legal Research - Work Board 1 preview 1.html",
                "Legal Memos.html", "Legal Memos - Work Board 1.html", "Legal Memos - Work Board 1 preview 1.html",
                "Work Board preview 1.html", "Arguments preview 1.html")

FILE_TOOLS = {"Read": "file_path", "Write": "file_path", "Edit": "file_path", "MultiEdit": "file_path",
              "NotebookRead": "notebook_path", "NotebookEdit": "notebook_path"}
SHELL_TOOL = re.compile(r"Bash|PowerShell|mcp__(.+__)?device_bash|mcp__(.+__)?workspace__bash")
DEVICE_TOOL = re.compile(r"mcp__(.+__)?device_.*")
STAGE_TOOL = re.compile(r"mcp__(.+__)?device_stage_files")
# A folder grant reads no page, so only its path is judged: a reason naming a page passes.
FOLDER_TOOL = re.compile(r"mcp__(.+__)?device_request_folder_access")
# Fullmatched on the lowercased basename: the Litigation Strategy page (and its legacy name), the
# practice-wide Work Board beside practice.db, a Writing's Work Board page, the
# id-named Work Board pages (and a Writing's before 2026-10-09, "Work Board - filing <id>"), the
# listed view pages, and a preview of each current page (#139).
STAGEABLE = re.compile(r"litigation strategy\.html|to do list\.html|work board\.html|milestone\.html|milestone \d+\.html|milestone - (?:filing|proceeding) \d+\.html|"
                       + VIEW_NAME + r"(?: - (?:milestone(?: - proceeding)?|filing) \d+)?\.html|"
                       r"(?:litigation strategy|work board|milestone|milestone \d+|milestone - proceeding \d+|" + VIEW_NAME + r"(?: - milestone(?: - proceeding)? \d+)?) preview \d+\.html")


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


def first_hit(texts):
    for text in texts:
        match = PAGE_ANYWHERE.search(text)
        if match:
            return match.group(0)
    return None


def message(name, shell):
    text = (
        f'Refused: "{name}" is a Probanda page, made for a person to view. An agent never views, '
        "reads, greps, parses, scripts over, authors or requests a screenshot of it; however, an agent "
        "may present the html to a human user for them to view, staging it first where presenting needs "
        "that, and an agent may view screenshots provided by a human user on the user's own initiative. "
        "Use the data instead, as the shared HTML-pages rule says: the board's summary from a render that "
        "names the Work Board, what a card holds from the board-card tool, and the page paths and the list "
        "of Writings from session entry. The drafting records and the markdown mockups hold everything "
        "else. A change the practitioner wants to a page goes to /lawyer:suggestion: never look for or "
        "edit what makes the page."
    )
    if shell:
        text += " Matched in the command text; a page reached another way is still off limits."
    return text


def main():
    if os.environ.get("COCLERK_HTML_DEV") == "1":
        return 0
    payload = hook_io.payload()
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
        texts = hook_io.strings(tool_input.get("path")) if FOLDER_TOOL.fullmatch(tool) else hook_io.strings(tool_input)
        if STAGE_TOOL.fullmatch(tool):
            texts = (t for t in texts if not STAGEABLE.fullmatch(basename(t).lower()))
        hit = first_hit(texts)
    else:
        hit = None
    if hit:
        return hook_io.deny(message(hit, shell))
    return 0


if __name__ == "__main__":
    hook_io.run(main, "html-pages-gate")
