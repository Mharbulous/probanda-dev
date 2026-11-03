#!/usr/bin/env python3
"""
select_approved_items: which items of a suggestion issue the implementer builds.

  python scripts/select_approved_items.py --issue <issue.json> [--comments <comments.json> ...]
      --record <record.json> [--record <record.json> ...]

Only the maintainer approves an item (design decisions 17 and 20), and
`fix-maker` carries out only approved items (decision 21). The approval is
recorded twice: on the item in the Suggestion Box (the cloud record's
`item_list`, as `node cloud/suggestions/tools/triage.mjs show <id>` prints it or
one row of suggestion-list's reply), and in the `### Decisions` list of the
latest `## Agent Brief` that /hitl-triage posted.
An item is built only when both say approved; an item approved in one and not
the other is not built and is reported. Both implementers run this before they
dispatch fix-maker (.claude/commands/implement-suggestions.md,
.claude/skills/hitl-triage/references/suggestion-route.md step 6).

Inputs:
- `--issue`: the issue as JSON, either `gh issue view <n> --json body,comments`
  (its `comments` list is read) or GitHub's REST issue object.
- `--comments`: a page of GitHub's REST comment list (`GET /issues/<n>/comments`),
  in order; repeat it for each page.
- `--record`: the cloud record of each suggestion the issue covers.

The rule:
- The brief is the last comment holding a line `## Agent Brief`. When no comment
  holds one, the issue body is the brief if it holds a `### Decisions` heading
  (an issue the removed debate triage filed itself).
- The suggestion is the brief's `Suggestion <id>` line, else the body's last
  one. When both name one and they differ, nothing is built (exit 2).
- The brief's decisions are the lines of its `### Decisions` section of the form
  `- Item <n>: approved|declined|undecided ...`. Any other line there is ignored,
  so it approves nothing. One item given two different decisions: exit 2.
- Item n is built when the record's item n has status `approved`, the brief's
  decision for item n is `approved`, and the brief has an `### Item n` section
  (its Item, Check and Plan, which fix-maker follows). Every other item is
  reported under `not_built` with why: approved in only one of the two, already
  implemented, declined, undecided, missing from the record, or no section.
- A withdrawn suggestion builds nothing.
- Merged by fingerprint: each `### Also covers` comment's lines
  `Suggestion <other id>, issue #<x>` and `item <j> = item <k> of Suggestion <id>`
  map item j of the other suggestion onto item k of this one. When item k is
  built and the other record's item j is approved, item j travels with it, and
  the fix commit names both; otherwise item j is reported under `not_built`.

Output (stdout), as JSON:
  {"suggestion_id": "<id>", "brief": "comment" | "body",
   "build": [{"suggestion_id", "item", "also": [{"suggestion_id", "item"}],
              "refs": ["Suggestion <id> item <n>", ...]}],
   "not_built": [{"suggestion_id", "item", "why"}]}

Exit 0: decided (the build list may be empty). Exit 2: the inputs could not be
read, or they disagree in a way no rule settles; nothing is built.
"""

import json
import re
import sys
from pathlib import Path

UUID = r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
BRIEF_HEADING = re.compile(r"^\s*##\s+Agent Brief\s*$", re.MULTILINE)
SUGGESTION_LINE = re.compile(rf"^\s*Suggestion\s+({UUID})\s*$", re.MULTILINE)
HEADING = re.compile(r"^\s*(#{1,6})\s+(.*?)\s*$")
DECISION = re.compile(
    r"^\s*[-*]\s*\**\s*Item\s+(\d+)\s*\**\s*[:.\-–—]\s*\**\s*(approved|declined|undecided)\b",
    re.IGNORECASE)
ITEM_SECTION = re.compile(r"^\s*###\s+Item\s+(\d+)\s*$", re.MULTILINE)
COVERS_SUGGESTION = re.compile(rf"^\s*Suggestion\s+({UUID})\s*,\s*issue\s+#?(\d+)\s*$", re.IGNORECASE)
COVERS_ITEM = re.compile(rf"^\s*[-*]?\s*item\s+(\d+)\s*=\s*item\s+(\d+)\s+of\s+Suggestion\s+({UUID})\s*\.?\s*$",
                         re.IGNORECASE)


class Unsettled(Exception):
    """The inputs disagree, or are missing, in a way no rule settles."""


def ref(suggestion_id, item):
    return f"Suggestion {suggestion_id} item {item}"


def section(text, title):
    """The lines under a `### <title>` heading, up to the next heading of the same or a higher level."""
    lines, out, level = text.splitlines(), None, None
    for line in lines:
        m = HEADING.match(line)
        if out is None:
            if m and m.group(2).strip().lower() == title.lower():
                out, level = [], len(m.group(1))
        elif m and len(m.group(1)) <= level:
            break
        else:
            out.append(line)
    return out


def decisions(brief):
    """{item: decision} from the brief's `### Decisions` section."""
    lines = section(brief, "Decisions")
    if lines is None:
        raise Unsettled("the latest Agent Brief has no ### Decisions list, so no item is approved by it")
    out = {}
    for line in lines:
        m = DECISION.match(line)
        if not m:
            continue
        item, decision = int(m.group(1)), m.group(2).lower()
        if out.get(item, decision) != decision:
            raise Unsettled(f"the Decisions list gives item {item} two different decisions")
        out[item] = decision
    return out


def also_covers(texts):
    """[(other suggestion id, other item, this suggestion's id, this item)] from `### Also covers` comments."""
    out = []
    for text in texts:
        lines = section(text, "Also covers")
        if lines is None:
            continue
        other = None
        for line in lines:
            m = COVERS_SUGGESTION.match(line)
            if m:
                other = m.group(1).lower()
                continue
            m = COVERS_ITEM.match(line)
            if m and other:
                out.append((other, int(m.group(1)), m.group(3).lower(), int(m.group(2))))
    return out


def load_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def load_records(paths):
    records = {}
    for path in paths:
        data = load_json(path)
        if isinstance(data, dict) and isinstance(data.get("suggestions"), list):
            data = data["suggestions"]
        for row in data if isinstance(data, list) else [data]:
            if not isinstance(row, dict) or not isinstance(row.get("suggestion_id"), str):
                raise Unsettled(f"{path} is not a Suggestion Box record")
            records[row["suggestion_id"].lower()] = row
    return records


def item_statuses(record):
    """{item: status} of a record, empty for a withdrawn suggestion."""
    if record.get("status") == "withdrawn":
        return None
    out = {}
    for n, item in enumerate(record.get("item_list") or [], 1):
        if isinstance(item, dict):
            out[int(item.get("item", n))] = item
    return out


def comment_bodies(issue, comment_pages):
    bodies = []
    if isinstance(issue.get("comments"), list):
        bodies += [c.get("body") or "" for c in issue["comments"] if isinstance(c, dict)]
    for page in comment_pages:
        if not isinstance(page, list):
            raise Unsettled("a --comments file is not a list of comments")
        bodies += [c.get("body") or "" for c in page if isinstance(c, dict)]
    return bodies


def select(issue, comment_pages, records):
    body = issue.get("body") or ""
    comments = comment_bodies(issue, comment_pages)
    briefs = [c for c in comments if BRIEF_HEADING.search(c)]
    if briefs:
        brief, where = briefs[-1], "comment"
    elif section(body, "Decisions") is not None:
        brief, where = body, "body"
    else:
        raise Unsettled("the issue has no Agent Brief with a Decisions list")

    in_brief = SUGGESTION_LINE.findall(brief)
    in_body = SUGGESTION_LINE.findall(body)
    sid = (in_brief[0] if in_brief else in_body[-1] if in_body else "").lower()
    if not sid:
        raise Unsettled("neither the brief nor the issue body has a Suggestion <id> line")
    if in_brief and in_body and in_body[-1].lower() != sid:
        raise Unsettled("the brief and the issue body name different suggestions")
    if sid not in records:
        raise Unsettled(f"no cloud record was given for suggestion {sid}")

    decided = decisions(brief)
    sections = {int(n) for n in ITEM_SECTION.findall(brief)}
    statuses = item_statuses(records[sid])
    build, not_built = [], []

    def skip(s, n, why):
        not_built.append({"suggestion_id": s, "item": n, "why": why})

    if statuses is None:
        for n in sorted(decided):
            skip(sid, n, "the suggestion was withdrawn")
    else:
        for n in sorted(set(statuses) | set(decided)):
            status = statuses[n].get("status") if n in statuses else None
            decision = decided.get(n)
            if status is None:
                skip(sid, n, "the cloud record has no such item")
            elif status == "approved" and decision == "approved":
                if n in sections:
                    build.append({"suggestion_id": sid, "item": n, "also": []})
                else:
                    skip(sid, n, f"approved in both, but the brief has no ### Item {n} section to build from")
            elif status == "approved":
                skip(sid, n, f"approved in the cloud record, but the latest Agent Brief says {decision or 'nothing'}")
            elif decision == "approved":
                if status == "implemented":
                    skip(sid, n, f"already implemented in {statuses[n].get('implemented_in')}")
                else:
                    skip(sid, n, f"approved in the latest Agent Brief, but the cloud record says {status}")
            elif status == "implemented":
                skip(sid, n, f"already implemented in {statuses[n].get('implemented_in')}")
            else:
                skip(sid, n, f"{status} in the cloud record and {decision or 'absent'} in the brief")

    units = {u["item"]: u for u in build}
    for other, j, target, k in also_covers(comments):
        if target != sid:
            skip(other, j, f"mapped onto suggestion {target}, which this issue's brief does not name")
        elif k not in units:
            skip(other, j, f"item {k}, which it is merged with, is not built")
        elif other not in records:
            skip(other, j, f"no cloud record was given for suggestion {other}")
        else:
            st = item_statuses(records[other])
            status = None if st is None else (st[j].get("status") if j in st else "missing")
            if status == "approved":
                units[k]["also"].append({"suggestion_id": other, "item": j})
            else:
                skip(other, j, "the suggestion was withdrawn" if st is None
                     else f"merged with item {k}, but its own cloud record says {status}")

    for u in build:
        u["refs"] = [ref(u["suggestion_id"], u["item"])] + [ref(a["suggestion_id"], a["item"]) for a in u["also"]]
    return {"suggestion_id": sid, "brief": where, "build": build, "not_built": not_built}


def main(argv):
    issue, pages, records = None, [], []
    try:
        i = 0
        while i < len(argv):
            flag = argv[i]
            if flag in ("--issue", "--comments", "--record") and i + 1 < len(argv):
                if flag == "--issue":
                    if issue is not None:
                        raise Unsettled("give --issue once")
                    issue = load_json(argv[i + 1])
                elif flag == "--comments":
                    pages.append(load_json(argv[i + 1]))
                else:
                    records.append(argv[i + 1])
                i += 2
            else:
                raise Unsettled(f"unknown or incomplete option {flag}")
        if not isinstance(issue, dict) or not records:
            raise Unsettled("give --issue and at least one --record")
        result = select(issue, pages, load_records(records))
    except (OSError, ValueError, Unsettled) as err:
        print(f"select_approved_items: {err}; nothing is built", file=sys.stderr)
        return 2
    print(json.dumps(result, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
