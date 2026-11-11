#!/usr/bin/env python3
"""Pick which screen captures of a stretch to decrypt and read.

    screenshot_pick.py pick --captures F [--per-dispatch N]

--captures is a JSON array of one stretch's captures, in time order, each {"id", "windowTitle" (may be
null), "screenshotId" (optional)}: the fields of a SyncoPaid capture. For the stretch it picks the first
capture, a middle one, the last, and every capture whose window title differs from the one before it. A
capture whose screenshotId is the one before it shows the same screen and is never picked on its own.
It prints one JSON line: {"picked": [{"id", "why": [first|middle|last|title_change]}], "dispatches": [[ids]]}
with the picks in time order and the ids grouped N to a dispatch of the screenshot reader (default 5).
An empty stretch picks nothing. A bad input stops with a message on stderr and exit 2.
"""
import argparse
import json
import sys
from pathlib import Path

PER_DISPATCH = 5


def stop(message):
    sys.stderr.write(f"screenshot_pick: {message}\n")
    sys.exit(2)


def load(path):
    try:
        captures = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError) as err:
        stop(f"{path}: {err}")
    if not isinstance(captures, list) or any(not isinstance(c, dict) or not c.get("id") for c in captures):
        stop(f"{path}: expected a JSON array of captures, each with an id")
    return captures


def pick(captures, per_dispatch=PER_DISPATCH):
    reasons = {}

    def add(index, why):
        reasons.setdefault(index, [])
        if why not in reasons[index]:
            reasons[index].append(why)

    if captures:
        add(0, "first")
        add(len(captures) // 2, "middle")
        add(len(captures) - 1, "last")
    for i in range(1, len(captures)):
        if (captures[i].get("windowTitle") or "") != (captures[i - 1].get("windowTitle") or ""):
            add(i, "title_change")
    # A capture showing the screen of the one before it adds nothing, unless it is the first of its kind.
    for i in sorted(reasons):
        same = i > 0 and captures[i].get("screenshotId") and captures[i].get("screenshotId") == captures[i - 1].get("screenshotId")
        if same and set(reasons[i]) <= {"middle"}:
            del reasons[i]
    picked = [{"id": captures[i]["id"], "why": reasons[i]} for i in sorted(reasons)]
    ids = [p["id"] for p in picked]
    return {"picked": picked, "dispatches": [ids[n:n + per_dispatch] for n in range(0, len(ids), per_dispatch)]}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="stage", required=True)
    one = sub.add_parser("pick")
    one.add_argument("--captures", required=True)
    one.add_argument("--per-dispatch", type=int, default=PER_DISPATCH)
    args = parser.parse_args(argv)
    if args.per_dispatch < 1:
        stop("--per-dispatch must be at least 1")
    print(json.dumps(pick(load(args.captures), args.per_dispatch)))


if __name__ == "__main__":
    main()
