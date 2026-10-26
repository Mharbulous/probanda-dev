#!/usr/bin/env python3
"""
check_fix_commit: a fix commit names the one approved item it builds, and no
commit about to be pushed quotes the submitted text.

  python scripts/check_fix_commit.py --selection <selection.json> --suggestion <record.json> [...]
      --message <msg file>
  python scripts/check_fix_commit.py --selection <selection.json> --suggestion <record.json> [...]
      --range <rev range> [--repo <path>] [--dropped <id>:<n> ...]

`selection.json` is what scripts/select_approved_items.py printed for the
issue; its `build` list is the approved set. Each record is a Suggestion Box
record, as for scripts/check_verbatim.py, whose rule finds a quoted sentence.

Phase 9 marks an item implemented from the commits that name it, so a fix
commit names its item as `Suggestion <id> item <n>`, and fix-maker builds one
approved item per commit (design decisions 17 and 21). Pushed history is never
rewritten, so a commit never quotes the submitted text (decision 16).

The rule, for one message (`--message`, which fix-maker runs before it commits):
- Every `Suggestion <id> item <n>` it holds, taken together, is exactly the
  `refs` of one unit of the selection's `build` list: the item, and for a merged
  issue the matching item of each suggestion merged into it. A unit is one item,
  so a message naming two items, an item not in the build list (declined,
  undecided, or approved in only one of the record and the brief), or only part
  of a merged unit fails. A message naming no item fails.
- A `Suggestion <id>` not followed by `item <n>` fails.
- It holds no sentence of any record's submitted text.

For a range (`--range`, which the implementer runs before every push), over
each commit in it that is not a merge:
- A commit holding any `Suggestion <id> item <n>` or `Suggestion <id>` follows
  the one-message rule above; a commit naming none (a release commit) does not
  need to.
- No commit's message, and no line its diff adds, holds a sentence of the
  submitted text.
- Each unit of the build list is named by exactly one commit, except a unit
  passed as `--dropped <id>:<n>` because its red test already passed on the
  base, which no commit may name.

It prints each failure, never the matched text. Exit 0: pass. Exit 1: at least
one failure. Exit 2: the arguments, the selection, a record or git could not be
read.
"""

import importlib.util
import json
import os
import re
import subprocess
import sys
from pathlib import Path

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location("check_verbatim", os.path.join(HERE, "check_verbatim.py"))
check_verbatim = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(check_verbatim)

UUID = r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
REF = re.compile(rf"\bSuggestion\s+({UUID})\s+item\s+(\d+)\b", re.IGNORECASE)
NAMED = re.compile(rf"\bSuggestion\s+({UUID})\b", re.IGNORECASE)


def refs_in(message):
    """(the set of (id, item) refs, the number of `Suggestion <id>` without an item)."""
    refs = {(m.group(1).lower(), int(m.group(2))) for m in REF.finditer(message)}
    bare = len(NAMED.findall(message)) - len(REF.findall(message))
    return refs, bare


def units(selection):
    """{frozenset of (id, item): unit key (id, item)} for each unit of the build list."""
    out = {}
    for u in selection.get("build") or []:
        key = (u["suggestion_id"].lower(), int(u["item"]))
        members = {key} | {(a["suggestion_id"].lower(), int(a["item"])) for a in u.get("also") or []}
        out[frozenset(members)] = key
    return out


def name_of(key):
    return f"Suggestion {key[0]} item {key[1]}"


def check_message(name, message, fields, by_members, require_ref):
    """(failures, the unit key the message names or None)."""
    failures = []
    refs, bare = refs_in(message)
    if bare:
        failures.append(f"{name}: names a suggestion without its item number; write `Suggestion <id> item <n>`")
    unit = None
    if refs:
        unit = by_members.get(frozenset(refs))
        if unit is None:
            approved = set().union(*by_members) if by_members else set()
            outside = sorted(refs - approved)
            if outside:
                failures.append(f"{name}: names {', '.join(name_of(r) for r in outside)}, "
                                "which is not an approved item this issue builds")
            else:
                failures.append(f"{name}: names {', '.join(name_of(r) for r in sorted(refs))}, which is not "
                                "exactly one approved unit; one fix commit names one item and the items merged "
                                "with it")
    elif require_ref:
        failures.append(f"{name}: names no approved item; end it with `Suggestion <id> item <n>`")
    for target, line, label, n in check_verbatim.check(fields, [(name, message)]):
        failures.append(f"{target}:{line}: holds sentence {n} of {label} verbatim; paraphrase it")
    return failures, unit


def git(repo, *args):
    out = subprocess.run(["git", "-C", repo, *args], capture_output=True, text=True, encoding="utf-8")
    if out.returncode != 0:
        raise ValueError(f"git {' '.join(args)} failed: {out.stderr.strip()}")
    return out.stdout


def added_lines(repo, sha):
    diff = git(repo, "show", "--format=", "--unified=0", "--no-color", sha)
    return "\n".join(line[1:] for line in diff.splitlines() if line.startswith("+") and not line.startswith("+++"))


def check_range(repo, rev_range, fields, by_members, dropped):
    failures, named = [], {}
    keys = set(by_members.values())
    for d in dropped:
        if d not in keys:
            failures.append(f"--dropped {name_of(d)} is not a unit of the build list")
    shas = git(repo, "rev-list", "--no-merges", "--reverse", rev_range).split()
    for sha in shas:
        message = git(repo, "log", "-1", "--format=%B", sha)
        short = sha[:12]
        refs, bare = refs_in(message)
        f, unit = check_message(f"commit {short} message", message, fields, by_members, require_ref=bool(refs or bare))
        failures += f
        for target, line, label, n in check_verbatim.check(fields, [(f"commit {short} diff", added_lines(repo, sha))]):
            failures.append(f"{target}: an added line holds sentence {n} of {label} verbatim; paraphrase it")
        if unit is not None:
            named.setdefault(unit, []).append(short)
    for key in sorted(keys):
        commits = named.get(key, [])
        if key in dropped:
            if commits:
                failures.append(f"{name_of(key)} was dropped, but commit {', '.join(commits)} names it")
        elif not commits:
            failures.append(f"{name_of(key)} is approved and built, but no commit in {rev_range} names it")
        elif len(commits) > 1:
            failures.append(f"{name_of(key)} is named by {len(commits)} commits ({', '.join(commits)}); "
                            "one fix commit per item")
    return failures, len(shas)


def parse_dropped(text):
    m = re.fullmatch(rf"({UUID}):(\d+)", text)
    if not m:
        raise ValueError(f"--dropped takes <id>:<n>, not {text}")
    return (m.group(1).lower(), int(m.group(2)))


def main(argv):
    selection, fields, message, rev_range, repo, dropped = None, [], None, None, ".", set()
    try:
        i = 0
        while i < len(argv):
            flag = argv[i]
            if i + 1 >= len(argv):
                raise ValueError(f"{flag} needs a value")
            value = argv[i + 1]
            if flag == "--selection":
                selection = json.loads(Path(value).read_text(encoding="utf-8"))
            elif flag == "--suggestion":
                for record in check_verbatim.load_records(value):
                    fields += check_verbatim.record_fields(record)
            elif flag == "--message":
                message = (value, Path(value).read_text(encoding="utf-8"))
            elif flag == "--range":
                rev_range = value
            elif flag == "--repo":
                repo = value
            elif flag == "--dropped":
                dropped.add(parse_dropped(value))
            else:
                raise ValueError(f"unknown option {flag}")
            i += 2
        if not isinstance(selection, dict) or not fields or (message is None) == (rev_range is None):
            raise ValueError("give --selection, at least one --suggestion, and one of --message or --range")
        if dropped and message is not None:
            raise ValueError("--dropped goes with --range only")
        by_members = units(selection)
        if message is not None:
            failures, _ = check_message(message[0], message[1], fields, by_members, require_ref=True)
            checked = "1 message"
        else:
            failures, count = check_range(repo, rev_range, fields, by_members, dropped)
            checked = f"{count} commit(s) in {rev_range}"
    except (OSError, ValueError, KeyError, TypeError) as err:
        print(f"check_fix_commit: {err}", file=sys.stderr)
        return 2
    for failure in failures:
        print(failure)
    if not failures:
        print(f"check_fix_commit: {checked} pass")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
