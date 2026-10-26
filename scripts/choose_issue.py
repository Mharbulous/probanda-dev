#!/usr/bin/env python3
"""
choose_issue: which issue an implementer lane takes next, and whether its lock is free.

  python scripts/choose_issue.py queue --lane cloud|local --issues <file> [--issues <file> ...]
      [--handled <n> ...]
  python scripts/choose_issue.py pick --lane cloud|local --issues <file> [--issues <file> ...]
      [--comments <n>=<file> ...] [--handled <n> ...] [--now <ISO time>]
  python scripts/choose_issue.py lock --lane cloud|local --comments <file> [--comments <file> ...]
      [--own <comment id>] [--now <ISO time>]

Both implementers of .claude/commands/implement-suggestions.md work one implement
queue, each in its own lane: the cloud run takes only `cloud` issues, and the
local implementer (Brahm's daily scheduled task, in its own clone) takes only
`local` ones. They use the same per-issue claim comments, and each lane has its
own lock, so a run in one lane never blocks the other.

Files: `--issues` is GitHub's REST issue list (`GET /issues?labels=ready-for-agent&...`),
`--comments` a REST comment list (`GET /issues/<n>/comments`). Each file holds one
JSON array, or several back to back as `gh api --paginate` prints them.

The rule:
- An issue is in a lane's queue when it is open, is not a pull request, carries
  `ready-for-agent`, and has not been handled by this run. The cloud lane takes
  an issue labelled `cloud` and not `local`; the local lane takes an issue
  labelled `local`, with or without `cloud`.
- Queue order: the maintainer lane (no `lane:user` or `lane:ai` label) first,
  then `lane:user`, then `lane:ai`; lowest issue number (oldest) first within each.
- pick walks the queue in order and takes the first issue with no live claim: no
  comment starting `Claim stamp.` under 5 hours old. It needs the comments of each
  issue it walks past or takes; when they were not given, it stops (exit 2), so a
  claim is never assumed absent.
- The lock of each lane is the earliest live comment, by id, on lock issue #189
  that starts with that lane's stamp: `Claim stamp.` for the cloud lane,
  `Local lock stamp.` for the local lane, live for 90 minutes. A comment of one
  lane is never read as the other lane's lock. lock prints `free` (no live
  stamp), `mine` (the earliest is `--own`) or `held`, and the body to post.

Exit 0: decided (pick may choose none). Exit 2: the inputs could not be read or
are missing; nothing is chosen.
"""

import json
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

CLAIM_PREFIX = "Claim stamp."
CLAIM_BODY = "Claim stamp. A session holds this ticket for 5 hours (docs/agents/issue-tracker.md, Claim)."
CLAIM_WINDOW = timedelta(hours=5)
LOCK_ISSUE = 189
LOCK_WINDOW = timedelta(minutes=90)
LANES = {
    "cloud": {"prefix": CLAIM_PREFIX, "body": CLAIM_BODY},
    "local": {"prefix": "Local lock stamp.",
              "body": "Local lock stamp. The local implementer holds the local lane of the implement queue "
                      "for 90 minutes (docs/agents/issue-tracker.md, Implementer lock)."},
}
LANE_RANK = {"lane:user": 1, "lane:ai": 2}


class Unsettled(Exception):
    """The inputs are missing or unreadable."""


def load_arrays(path):
    """Every element of the JSON arrays in a file, which may hold several back to back."""
    text = Path(path).read_text(encoding="utf-8").strip()
    decoder, pos, out = json.JSONDecoder(), 0, []
    while pos < len(text):
        value, end = decoder.raw_decode(text, pos)
        if not isinstance(value, list):
            raise Unsettled(f"{path} does not hold a JSON array")
        out.extend(value)
        pos = end
        while pos < len(text) and text[pos].isspace():
            pos += 1
    return out


def parse_time(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)


def labels(issue):
    return {(lab.get("name") if isinstance(lab, dict) else str(lab)) for lab in issue.get("labels") or []}


def in_lane(issue, lane):
    names = labels(issue)
    if issue.get("pull_request") is not None or issue.get("state", "open") != "open":
        return False
    if "ready-for-agent" not in names:
        return False
    if lane == "cloud":
        return "cloud" in names and "local" not in names
    return "local" in names


def rank(issue):
    names = labels(issue)
    return min([LANE_RANK[n] for n in names if n in LANE_RANK] or [0])


def queue(issues, lane, handled=()):
    """The lane's queue, in the order it is worked."""
    seen, out = set(), []
    for issue in issues:
        n = int(issue["number"])
        if n in seen or n in handled or not in_lane(issue, lane):
            continue
        seen.add(n)
        out.append(issue)
    return [int(i["number"]) for i in sorted(out, key=lambda i: (rank(i), int(i["number"])))]


def live(comments, prefix, window, now):
    """The live stamps starting with prefix, earliest id first."""
    out = [c for c in comments
           if (c.get("body") or "").startswith(prefix) and now - parse_time(c["created_at"]) < window]
    return sorted(out, key=lambda c: int(c["id"]))


def pick(issues, lane, comments, handled=(), now=None):
    now = now or datetime.now(timezone.utc)
    order, skipped = queue(issues, lane, handled), []
    for n in order:
        if n not in comments:
            raise Unsettled(f"the claim comments of #{n} were not given (--comments {n}=<file>)")
        if live(comments[n], CLAIM_PREFIX, CLAIM_WINDOW, now):
            skipped.append({"issue": n, "why": "claimed"})
            continue
        return {"lane": lane, "issue": n, "queue": order, "skipped": skipped}
    return {"lane": lane, "issue": None, "queue": order, "skipped": skipped}


def lock(comments, lane, own=None, now=None):
    now = now or datetime.now(timezone.utc)
    spec = LANES[lane]
    stamps = live(comments, spec["prefix"], LOCK_WINDOW, now)
    if not stamps:
        state, holder = "free", None
    else:
        first = stamps[0]
        holder = {"id": int(first["id"]), "created_at": first["created_at"]}
        state = "mine" if own is not None and int(first["id"]) == int(own) else "held"
    return {"lane": lane, "lock_issue": LOCK_ISSUE, "prefix": spec["prefix"],
            "window_minutes": int(LOCK_WINDOW.total_seconds() // 60), "body": spec["body"],
            "state": state, "holder": holder}


def main(argv):
    try:
        if not argv or argv[0] not in ("queue", "pick", "lock"):
            raise Unsettled("give queue, pick or lock first")
        command, lane, issues, comments, lock_comments, handled, own, now = argv[0], None, [], {}, [], set(), None, None
        i = 1
        while i < len(argv):
            flag = argv[i]
            if i + 1 >= len(argv):
                raise Unsettled(f"option {flag} needs a value")
            value = argv[i + 1]
            if flag == "--lane":
                if value not in LANES:
                    raise Unsettled("--lane is cloud or local")
                lane = value
            elif flag == "--issues" and command != "lock":
                issues.extend(load_arrays(value))
            elif flag == "--comments" and command == "pick":
                m = re.fullmatch(r"#?(\d+)=(.+)", value)
                if not m:
                    raise Unsettled("pick takes --comments <issue number>=<file>")
                comments.setdefault(int(m.group(1)), []).extend(load_arrays(m.group(2)))
            elif flag == "--comments" and command == "lock":
                lock_comments.extend(load_arrays(value))
            elif flag == "--handled" and command != "lock":
                handled.add(int(value.lstrip("#")))
            elif flag == "--own" and command == "lock":
                own = int(value)
            elif flag == "--now" and command != "queue":
                now = parse_time(value)
            else:
                raise Unsettled(f"unknown option {flag} for {command}")
            i += 2
        if lane is None:
            raise Unsettled("give --lane cloud or --lane local")
        if command == "queue":
            result = {"lane": lane, "queue": queue(issues, lane, handled)}
        elif command == "pick":
            result = pick(issues, lane, comments, handled, now)
        else:
            result = lock(lock_comments, lane, own, now)
    except (OSError, ValueError, KeyError, TypeError, Unsettled) as err:
        print(f"choose_issue: {err}; nothing is chosen", file=sys.stderr)
        return 2
    print(json.dumps(result, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
