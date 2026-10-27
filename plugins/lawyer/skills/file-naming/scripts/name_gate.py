#!/usr/bin/env python3
"""Mechanical name-gate check: /file-naming's gate intent.

Usage:
    python name_gate.py --registry <path> --files <path> [<path> ...] \
        [--flag-tokens A,B,...]

Prints one JSON object to stdout:
    {"results": [{"name": "<basename>", "verdict": "conforms" | "fails",
                  "reason": "...", "flags": ["Ltd", ...],
                  "code": "<CODE token as written>" | null}, ...]}

This checks only the standard `YYYY-MM-DD CODE ...` grammar
(general-conventions.md): a leading date token, then a CODE token matched
against the registry. It does not know a folder's alternate whole-name
formats (citation-form case law, AI-memo source-name form, Discovery's
`[Party][Part].[No]` listed documents) -- the caller runs a second,
prose-only pass over this script's failures for those. It also never judges
typicality (the soft check, prose-only) or any component past the leading
date/code pair, bar a " (vN)" suffix.

`--registry` is a file holding the text of `code-registry.md` (materialize it
to a temp file first if it isn't reachable on disk). `--flag-tokens` is a
generic mechanism: any comma-separated token reported as a standalone word in
the name, regardless of verdict -- the caller decides what a hit means (e.g.
law-notes.md's corporate-designator list).
"""
import argparse
import json
import re
import sys

DATE_RE = re.compile(r'^\d{4}-\d{2}-\d{2}(?=\s|$)')
CODE_CELL_RE = re.compile(r'^\s*\|\s*`([^`]+)`\s*\|')
TRAILING_HASH_DIGITS_RE = re.compile(r'^(.*)#\d+$')
TRAILING_DIGITS_RE = re.compile(r'^(.*[A-Za-z])\d+$')
PAREN_V_RE = re.compile(r' \((v|version )\d+\)( UNSIGNED)?$')


def code_stem(token):
    """Normalize a code token for comparison: strip a trailing '#<digits>',
    else bare trailing digits, else a bare trailing '#' -- whichever applies
    first. 'INV#7413' and the registry's 'INV#' both stem to 'INV'; 'AFF2'
    and 'AFF#' both stem to 'AFF'; 'LOD#1' and 'LOD' both stem to 'LOD'."""
    m = TRAILING_HASH_DIGITS_RE.match(token)
    if m:
        return m.group(1)
    m = TRAILING_DIGITS_RE.match(token)
    if m:
        return m.group(1)
    if token.endswith('#'):
        return token[:-1]
    return token


def parse_registry_codes(text):
    """Every backticked first-cell token of a markdown table row. Generic on
    purpose -- picks up deprecated/synonym codes too, since a deprecated code
    is still a defined one; canonicalizing it is a proposal-mode concern."""
    codes = set()
    for line in text.splitlines():
        m = CODE_CELL_RE.match(line)
        if m:
            codes.add(code_stem(m.group(1)))
    return codes


def check_name(stem, registry_codes, flag_tokens):
    """(verdict, reason, flags, code): code is the CODE token as written, only when the name conforms."""
    flags = [t for t in flag_tokens if re.search(r'\b' + re.escape(t) + r'\b', stem)]

    date_match = DATE_RE.match(stem)
    if not date_match:
        return "fails", "no leading YYYY-MM-DD date token", flags, None

    rest = stem[date_match.end():].strip()
    if not rest:
        return "fails", "no CODE token after the date", flags, None

    code_token = rest.split(' ', 1)[0]
    if code_stem(code_token) not in registry_codes:
        return "fails", f"'{code_token}' is not a registered code", flags, None

    if PAREN_V_RE.search(stem):
        return "fails", "revision suffix must be ' vN'", flags, None

    return "conforms", f"date + code '{code_token}' parse against the registry", flags, code_token


def main(argv=None):
    ap = argparse.ArgumentParser(description="Mechanical grammar+registry check for housekeeping filenames.")
    ap.add_argument('--registry', required=True, metavar='PATH',
                     help="Path to a file holding code-registry.md text.")
    ap.add_argument('--files', nargs='+', required=True, metavar='PATH',
                     help="File paths (or bare names) to check.")
    ap.add_argument('--flag-tokens', default='',
                     help="Comma-separated tokens to report as standalone-word hits, e.g. Ltd,Inc,Corp.")
    args = ap.parse_args(argv)

    with open(args.registry, encoding='utf-8') as fh:
        registry_codes = parse_registry_codes(fh.read())

    flag_tokens = [t for t in (tok.strip() for tok in args.flag_tokens.split(',')) if t]

    results = []
    for path in args.files:
        name = path.replace('\\', '/').rsplit('/', 1)[-1]
        stem = name.rsplit('.', 1)[0] if '.' in name else name
        verdict, reason, flags, code = check_name(stem, registry_codes, flag_tokens)
        results.append({"name": name, "verdict": verdict, "reason": reason, "flags": flags, "code": code})

    json.dump({"results": results}, sys.stdout, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
