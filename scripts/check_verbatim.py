#!/usr/bin/env python3
"""
check_verbatim: a derived record never quotes a suggestion's submitted text.

  python scripts/check_verbatim.py --suggestion <record.json> [--suggestion ...] <file> [<file> ...]
  python scripts/check_verbatim.py --text <submitted.txt> <file> [<file> ...]

Pushed history is never rewritten, so a plan, red test, issue body, issue
comment or decision reason that quotes a suggestion would keep the
practitioner's words after they withdraw it (design decision 16, lifecycle
plan Risks: git history). Triage runs this before it files or edits an issue
and before a red test is posted or committed (.claude/commands/triage-issue.md,
.claude/commands/intake-suggestions.md, .claude/skills/suggestion-triage/).

The submitted text is read from a Suggestion Box record, as
`node cloud/suggestions/tools/triage.mjs show <id>` prints it or one row of
suggestion-list's reply (a JSON object, a list of them, or {"suggestions": [...]}):
its title, its pain point (body or pain_point), the text of each item
(item_list), its comment, its context lines, and the strings of the structured
items older rows carry. `--text` reads plain submitted text instead.

The rule:
- A sentence is a run of the submitted text ended by `.`, `!`, `?` or `;`
  followed by a space, or by a line break, or by the end of a field. Bullets and
  numbering at a line's start are not part of it.
- Normalisation, for the submitted text and the checked file alike: Unicode
  NFKC, typographic quotes and dashes as plain ones, case folded, and every run
  of characters that is not a letter or a digit (spaces, line breaks,
  punctuation, Markdown marks, quote marks) is one word break. A word is a run
  of letters and digits, with an apostrophe allowed inside it.
- Only a sentence of at least MIN_WORDS words counts, so short common phrases
  ("Already works as asked", "the Work Board") never trip it.
- A file fails when the words of any counted sentence appear in it in order,
  one after another, whatever the line breaks, case or punctuation between them.

It prints where each match is (file, line, which field and which sentence of
it) and never the matched text. Exit 0: no sentence found. Exit 1: at least one.
Exit 2: the arguments or a record could not be read.
"""

import bisect
import json
import re
import sys
import unicodedata
from pathlib import Path

MIN_WORDS = 6

_TYPOGRAPHIC = str.maketrans({
    "‘": "'", "’": "'", "‛": "'", "′": "'",
    "“": '"', "”": '"', "‟": '"', "″": '"',
    "‐": "-", "‑": "-", "‒": "-", "–": "-", "—": "-", "―": "-",
})
WORD = re.compile(r"[^\W_]+(?:'[^\W_]+)*")
SENTENCE_END = re.compile(r"(?<=[.!?;])\s+|\r?\n+")
BULLET = re.compile(r"^\s*(?:[-*+•]|\(?[0-9]{1,3}[.)]|\(?[a-z][.)])\s+", re.IGNORECASE)


def normalise(text):
    return unicodedata.normalize("NFKC", text).translate(_TYPOGRAPHIC).casefold()


def words(text):
    return WORD.findall(normalise(text))


def sentences(text):
    """The counted sentences of one field, each as its list of words."""
    out = []
    for part in SENTENCE_END.split(text):
        tokens = words(BULLET.sub("", part))
        if len(tokens) >= MIN_WORDS:
            out.append(tokens)
    return out


def _strings(value):
    if isinstance(value, str):
        yield value
    elif isinstance(value, list):
        for v in value:
            yield from _strings(v)
    elif isinstance(value, dict):
        for v in value.values():
            yield from _strings(v)


def record_fields(record):
    """(label, text) for each piece of a record's submitted text."""
    if not isinstance(record, dict):
        raise ValueError("a suggestion record is a JSON object")
    sid = str(record.get("suggestion_id") or "")[:8] or "?"
    fields = []
    for key, label in (("title", "title"), ("body", "pain point"), ("pain_point", "pain point"), ("comment", "comment")):
        if isinstance(record.get(key), str):
            fields.append((f"suggestion {sid} {label}", record[key]))
    for n, item in enumerate(record.get("item_list") or [], 1):
        if isinstance(item, dict) and isinstance(item.get("text"), str):
            fields.append((f"suggestion {sid} item {item.get('item', n)}", item["text"]))
    for n, line in enumerate(record.get("context_lines") or [], 1):
        text = line.get("text") if isinstance(line, dict) else line
        if isinstance(text, str):
            fields.append((f"suggestion {sid} context line {n}", text))
    for n, text in enumerate(_strings(record.get("items")), 1):
        fields.append((f"suggestion {sid} structured items, string {n}", text))
    return fields


def load_records(path):
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    if isinstance(data, dict) and isinstance(data.get("suggestions"), list):
        data = data["suggestions"]
    return data if isinstance(data, list) else [data]


class Target:
    """A checked file's words, joined so a sentence's words can be found in order."""

    def __init__(self, text):
        self.joined = " "
        self.starts, self.lines = [], []
        for lineno, line in enumerate(text.splitlines() or [""], 1):
            for token in words(line):
                self.starts.append(len(self.joined))
                self.lines.append(lineno)
                self.joined += token + " "

    def find(self, tokens):
        """The line where the words first appear in order, or None."""
        at = self.joined.find(" " + " ".join(tokens) + " ")
        if at < 0:
            return None
        return self.lines[bisect.bisect_left(self.starts, at + 1)]


def check(fields, targets):
    """Each (target name, line, field label, sentence number) found."""
    found = []
    counted = [(label, n, tokens) for label, text in fields for n, tokens in enumerate(sentences(text), 1)]
    for name, text in targets:
        target = Target(text)
        for label, n, tokens in counted:
            line = target.find(tokens)
            if line is not None:
                found.append((name, line, label, n))
    return found


def main(argv):
    fields, files, i = [], [], 0
    try:
        while i < len(argv):
            if argv[i] in ("--suggestion", "--text") and i + 1 < len(argv):
                if argv[i] == "--suggestion":
                    for record in load_records(argv[i + 1]):
                        fields += record_fields(record)
                else:
                    fields.append((f"text {argv[i + 1]}", Path(argv[i + 1]).read_text(encoding="utf-8")))
                i += 2
            elif argv[i].startswith("--"):
                raise ValueError(f"unknown option {argv[i]}")
            else:
                files.append(argv[i])
                i += 1
        if not fields or not files:
            raise ValueError("give at least one --suggestion or --text, and at least one file to check")
        targets = [(f, Path(f).read_text(encoding="utf-8")) for f in files]
    except (OSError, ValueError) as err:
        print(f"check_verbatim: {err}", file=sys.stderr)
        print(__doc__.strip().splitlines()[2], file=sys.stderr)
        return 2
    found = check(fields, targets)
    for name, line, label, n in found:
        print(f"{name}:{line}: holds sentence {n} of {label} verbatim; paraphrase it")
    if not found:
        print(f"check_verbatim: no sentence of the submitted text in {len(targets)} file(s)")
    return 1 if found else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
