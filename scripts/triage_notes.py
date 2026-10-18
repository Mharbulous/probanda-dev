#!/usr/bin/env python3
"""
A hat's notes file for /suggestion-triage (.claude/commands/suggestion-triage.md).

  python scripts/triage_notes.py show <file> <step>
      Prints the advice available at that step: the untagged text plus the
      contents of every <stepN>...</stepN> block with N <= step.
  python scripts/triage_notes.py cap <file>
      Rewrites the file within 3000 characters. If the text without PHRASE is
      3000 characters or less, it is kept and PHRASE is removed. Otherwise it is
      cut to 3000 characters and PHRASE appended. Tags count toward the 3000.

The cap is the only truncation a notes file ever gets
(docs/Specs/2026-10-18_suggestion-triage-spec.md, section 4.3).
"""

import re
import sys
from pathlib import Path

LIMIT = 3000
PHRASE = "[characters in excess of 3000 have been truncated in accordance with the skill rules]"
STEP_BLOCK = re.compile(r"<step(\d+)>(.*?)</step\1>", re.DOTALL)


def show(text: str, step: int) -> str:
    return STEP_BLOCK.sub(lambda m: m.group(2) if int(m.group(1)) <= step else "", text)


def cap(text: str) -> str:
    text = text.replace(PHRASE, "")
    return text if len(text) <= LIMIT else text[:LIMIT] + PHRASE


def main(argv: list[str]) -> int:
    if len(argv) == 3 and argv[0] == "show" and argv[2].isdigit():
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stdout.write(show(Path(argv[1]).read_text(encoding="utf-8"), int(argv[2])))
        return 0
    if len(argv) == 2 and argv[0] == "cap":
        path = Path(argv[1])
        path.write_text(cap(path.read_text(encoding="utf-8")), encoding="utf-8", newline="\n")
        return 0
    sys.stderr.write("usage: triage_notes.py show <file> <step> | cap <file>\n")
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
