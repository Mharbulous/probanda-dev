#!/usr/bin/env python3
"""
check_brief: a brief holds only checks its run can perform, and sends an issue to
a person only for a reason on the closed list.

  python scripts/check_brief.py <brief file> [<brief file> ...]

Triage and /hitl-triage run this over a brief before posting it
(.claude/commands/triage-issue.md, source/skills/hitl-triage/references/issue-route.md).

A brief fails when:
- `### Done when` holds a whole-suite or folder run, which the repo's hook refuses
  outside CI (.claude/hooks/no-regression-suite.py), or waits on a scheduled run.
  Those checks go under `### After landing`.
- `### Done when` names a test file that no `### Plan`, `### Scope` or `### Item <n>`
  section names: the hook refuses a test file nothing changes.
- `### Open decisions` holds a decision with no `Needs a person: <reason>` line after
  it, or a brief whose State is ready-for-human has no such line at all. The reason is
  on the closed list (choose_issue.NEEDS_PERSON; docs/agents/issue-tracker.md,
  What needs a person).

Exit 0: no problem. Exit 1: at least one, printed by file. Exit 2: a file could not
be read or holds no `## Agent Brief`.
"""

import re
import sys
from pathlib import Path

from choose_issue import NEEDS_PERSON

BRIEF = re.compile(r"(?m)^## Agent Brief")
STATE_HUMAN = re.compile(r"\*\*State:\*\*\s*`?ready-for-human")
TEST_FILE = re.compile(r"(?:test_[\w.-]*\.py|[\w.-]+_test\.py|[\w.-]+\.test\.[cm]?[jt]s)\b")
WHOLE_SUITE = re.compile(r"\b(?:whole|full|entire)\b[^.\n]*\bsuite\b|\bscripts/test\.mjs\b|\bnpm\s+(?:run\s+)?test\b", re.I)
RUNNER = re.compile(r"(?:\bpytest\b|\bnode\s+--test\b)[^`\n]*")
SCHEDULED = re.compile(r"\b(?:nightly|scheduled)\b|\bnext\s+daily\b|\bdaily\s+run\b", re.I)
DECISION = re.compile(r"^(?:\d+[.)]\s|[-*]\s|Item\s+\d+:)")
NEEDS = re.compile(r"^\s*(?:[-*]\s+)?\**Needs a person:\**\s*`?([\w-]+)`?\s*\.?\s*$", re.M)


def sections(text):
    """{heading: body} for each `### ` section, ignoring headings inside code fences."""
    out, name, fenced = {}, None, False
    for line in text.splitlines():
        if line.lstrip().startswith("```"):
            fenced = not fenced
        elif not fenced and line.startswith("### "):
            name = line[4:].strip()
            out.setdefault(name, [])
            continue
        if name is not None:
            out[name].append(line)
    return {k: "\n".join(v) for k, v in out.items()}


def done_when_problems(parts):
    problems = []
    named = "\n".join(body for name, body in parts.items() if name in ("Plan", "Scope") or name.startswith("Item "))
    named_files = set(TEST_FILE.findall(named))
    for line in parts.get("Done when", "").splitlines():
        runners = RUNNER.findall(line)
        if WHOLE_SUITE.search(line) or any(not TEST_FILE.search(r) for r in runners):
            problems.append(f"Done when runs a whole suite or folder; move it to After landing: {line.strip()}")
        elif SCHEDULED.search(line):
            problems.append(f"Done when waits on a scheduled run; move it to After landing: {line.strip()}")
        for name in TEST_FILE.findall(line):
            if name not in named_files:
                problems.append(f"Done when names {name}, which neither Plan nor Scope changes")
    return problems


def person_problems(text, parts):
    reasons = NEEDS.findall(text)
    problems = [f"Needs a person: {r} is not on the closed list" for r in reasons if r not in NEEDS_PERSON]
    if "Open decisions" in parts:
        lines = parts["Open decisions"].splitlines()
        decisions = [ln for ln in lines if DECISION.match(ln) and not NEEDS.match(ln)]
        given = NEEDS.findall(parts["Open decisions"])
        if len(given) < len(decisions):
            problems.append(f"Open decisions holds {len(decisions)} decision(s) and {len(given)} Needs a person line(s)")
    elif STATE_HUMAN.search(text) and not reasons:
        problems.append("the State is ready-for-human with no Needs a person line")
    return problems


def problems(text):
    parts = sections(text)
    return done_when_problems(parts) + person_problems(text, parts)


def main(argv):
    if not argv:
        print(__doc__.strip().splitlines()[3].strip(), file=sys.stderr)
        return 2
    failed = False
    for name in argv:
        try:
            text = Path(name).read_text(encoding="utf-8")
        except OSError as err:
            print(f"check_brief: {err}", file=sys.stderr)
            return 2
        if not BRIEF.search(text):
            print(f"check_brief: {name} holds no ## Agent Brief", file=sys.stderr)
            return 2
        found = problems(text)
        for problem in found:
            print(f"{name}: {problem}")
        failed = failed or bool(found)
    if not failed:
        print(f"check_brief: {len(argv)} brief(s) pass")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
