#!/usr/bin/env python3
"""
withdrawals: what /intake-suggestions does on GitHub for each withdrawn suggestion.

  python scripts/withdrawals.py --rows <file> [--rows <file> ...] --issues <file> [--issues <file> ...]

A practitioner withdraws a suggestion through suggestion-withdraw (design
decision 16). Before intake records an issue number on it, the row is deleted:
no row and no issue are left, so there is nothing to do. After, the row is a
tombstone holding only its id, its issue number and the status `withdrawn`.
Intake lists the tombstones (suggestion-list, `{"status":"withdrawn"}`) and every
`suggestion` issue, open and closed, and this script says what to write.

Files: `--rows` is a suggestion-list reply (`{"suggestions": [...]}`) or its
array of rows; `--issues` is GitHub's REST issue list
(`GET /issues?labels=suggestion&state=all`). Each file holds one JSON value, or
several arrays back to back as `gh api --paginate` prints them.

The rule:
- Only a row with status `withdrawn` is acted on; any other row is left alone.
- Its issues are the issue numbered by its `issue_number` and every issue whose
  body holds the line `Suggestion <suggestion_id>`. Pull requests are ignored.
- An open issue: post COMMENT unless the issue already carries `withdrawn`, add
  the label `withdrawn` when missing, then close it with state_reason
  `not_planned`. Written in that order, a run cut short is finished by the next
  one without a second comment.
- A closed issue that does not carry `withdrawn`: post COMMENT and add the label,
  and leave it closed as it was.
- A closed issue that carries `withdrawn`: nothing; it is done.
- A tombstone none of whose issues is in the list is reported under `unmatched`,
  with nothing written.

COMMENT says only that the sender withdrew the suggestion. It never quotes the
suggestion: the tombstone holds no text, and derived records paraphrase.

Exit 0: decided (the actions may be empty). Exit 2: the inputs could not be read;
nothing is decided.
"""

import json
import re
import sys
from pathlib import Path

LABEL = "withdrawn"
LABEL_SPEC = {"name": LABEL, "color": "BFD4F2",
              "description": "The sender withdrew the suggestion: closed, and out of every queue"}
COMMENT = ("Withdrawn by its sender. This issue is closed as not planned and leaves every queue; "
           "nothing more will be built for it.")
LINE = re.compile(r"^\s*Suggestion\s+([0-9a-fA-F-]{36})\s*$", re.MULTILINE)


class Unsettled(Exception):
    """The inputs are missing or unreadable."""


def load_values(path):
    """Every JSON value in a file, which may hold several back to back."""
    text = Path(path).read_text(encoding="utf-8").strip()
    decoder, pos, out = json.JSONDecoder(), 0, []
    while pos < len(text):
        value, end = decoder.raw_decode(text, pos)
        out.append(value)
        pos = end
        while pos < len(text) and text[pos].isspace():
            pos += 1
    return out


def rows_of(values):
    out = []
    for value in values:
        if isinstance(value, dict) and isinstance(value.get("suggestions"), list):
            out.extend(value["suggestions"])
        elif isinstance(value, list):
            out.extend(value)
        else:
            raise Unsettled("a --rows file holds neither a suggestion-list reply nor an array of rows")
    return out


def issues_of(values):
    out = []
    for value in values:
        if not isinstance(value, list):
            raise Unsettled("an --issues file does not hold a JSON array")
        out.extend(value)
    return out


def labels(issue):
    return {(lab.get("name") if isinstance(lab, dict) else str(lab)) for lab in issue.get("labels") or []}


def named_ids(issue):
    return {m.lower() for m in LINE.findall(issue.get("body") or "")}


def decide(rows, issues):
    by_number = {}
    for issue in issues:
        if issue.get("pull_request") is None:
            by_number[int(issue["number"])] = issue
    actions, done, unmatched = [], [], []
    for row in rows:
        if row.get("status") != "withdrawn":
            continue
        sid = str(row["suggestion_id"]).lower()
        recorded = row.get("issue_number")
        mine = sorted(n for n, issue in by_number.items()
                      if (recorded is not None and n == int(recorded)) or sid in named_ids(issue))
        if not mine:
            unmatched.append({"suggestion_id": sid, "issue_number": recorded})
            continue
        for n in mine:
            issue = by_number[n]
            labelled = LABEL in labels(issue)
            is_open = issue.get("state", "open") == "open"
            if labelled and not is_open:
                done.append({"issue": n, "suggestion_id": sid})
                continue
            actions.append({"issue": n, "suggestion_id": sid, "comment": not labelled,
                            "add_label": not labelled, "close": is_open})
    return {"label": LABEL_SPEC, "comment": COMMENT, "actions": actions, "done": done, "unmatched": unmatched}


def main(argv):
    try:
        rows, issues, i = [], [], 0
        seen_rows = seen_issues = False
        while i < len(argv):
            flag = argv[i]
            if i + 1 >= len(argv):
                raise Unsettled(f"option {flag} needs a value")
            if flag == "--rows":
                rows.extend(rows_of(load_values(argv[i + 1])))
                seen_rows = True
            elif flag == "--issues":
                issues.extend(issues_of(load_values(argv[i + 1])))
                seen_issues = True
            else:
                raise Unsettled(f"unknown option {flag}")
            i += 2
        if not (seen_rows and seen_issues):
            raise Unsettled("give --rows and --issues")
        result = decide(rows, issues)
    except (OSError, ValueError, KeyError, TypeError, Unsettled) as err:
        print(f"withdrawals: {err}; nothing is decided", file=sys.stderr)
        return 2
    print(json.dumps(result, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
