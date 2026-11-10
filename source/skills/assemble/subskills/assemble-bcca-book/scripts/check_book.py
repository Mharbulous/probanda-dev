"""Check a BCCA response book against the two defects the registry returned on
CA59991 (01-SEP-2026 Courtesy Correction, package 4999901):

    "Please note that your response argument is limited to 5 pages on an
     application for stay of proceedings."
    "Please also note that all PDF pages of your Response Book should be
     numbered subsequentially."

Two independent checks, run separately or together:

  --argument  the written argument's PDF, counted against the page cap. Run
              this BEFORE binding, on the PDF saved from Word -- the registry
              counts the filed face, so the count is taken from the converted
              PDF, never from the .docx.
  --book      the emitted combined book PDF, checked for a number on every
              page running consecutively from 1. Run this AFTER binding.

Check semantics, error codes and output are owned by
references/book-binding-contract.md "Book checker" (SSOT).

Usage:
    python check_book.py [--argument <written argument .pdf> [--argument-cap N]] [--book <book .pdf>]

Prints one JSON line: {"success": true, "all_passed": ..., "checks": [...]} or
{"success": false, "error": "<code>", "detail": "..."}. Exit 0 only when the
script ran and every check passed; 1 when a check failed or the script
refused; 2 on a usage error.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import traceback
from pathlib import Path

try:
    import pymupdf as fitz
except ImportError as exc:  # refuse in this script's JSON contract, not as a traceback
    print(json.dumps({'success': False, 'error': 'missing_dependency', 'detail': (
        f"{exc.name or exc} is not installed. This script runs on the PC, in a Claude Code "
        "session in the desktop app's Code tab, where the Probanda plugin is installed "
        "-- not in a Cowork cloud sandbox, which has no PyMuPDF and blocks pypi. "
        "On the PC, install it: "
        "pip install PyMuPDF")}))
    sys.exit(1)

# e-CI section 2.1: "Response Books: Maximum 5 pages of written argument for response to
# leave or stay application. Maximum 10 pages of written argument for combined leave and
# stay response books." The only book with a written argument in it is a
# bcca_stay_response filing's Response Book (a bcca_factum filing's book is the Book of
# Authorities alone), so the stay-only cap is the default;
# a combined leave-and-stay response passes --argument-cap 10.
# Source: source/skills/draft/references/bcca-response-book-form.md section 6.2.
STAY_ONLY_ARGUMENT_CAP = 5

# The number is read from the top of the page, where both this pipeline's stamp
# (paginate_book.py, 0.5 in from the visual top edge) and a Word running header sit.
NUMBER_BAND_HEIGHT = 72.0  # one inch
_TRIM = re.compile(r'^\W+|\W+$')


class CheckError(Exception):
    def __init__(self, code: str, detail: str):
        self.code = code
        self.detail = detail
        super().__init__(f'{code}: {detail}')


def _require_pdf(path: Path, what: str) -> Path:
    if not path.is_file():
        raise CheckError('missing_file', f'{what} not found: {path}')
    if path.suffix.lower() != '.pdf':
        raise CheckError('bad_arguments', f'{what} must be a .pdf: {path}')
    return path


def check_argument_pages(argument_pdf: Path, cap: int) -> dict:
    """The written argument's page count against the completion instructions' cap."""
    with fitz.open(argument_pdf) as doc:
        pages = doc.page_count
    passed = pages <= cap
    detail = (f'the written argument is {pages} page(s) against a cap of {cap} '
              f'(e-CI section 2.1, recorded at draft/references/bcca-response-book-form.md section 6.2)')
    if not passed:
        detail += ('. The argument\'s own section 2.1 cover page sits outside the count on that '
                   'reference\'s flagged inference, so a count of exactly one over the cap may '
                   'still comply -- every larger count does not')
    return {'check': 'argument_page_cap', 'passed': passed, 'file': argument_pdf.name,
            'pages': pages, 'cap': cap, 'detail': detail}


def _top_numbers(page: "fitz.Page") -> set[str]:
    """Every whitespace-delimited token in the page's top band, stripped of
    surrounding punctuation. A token, not a substring, so a year in a citation
    cannot pass for a page number. `get_text` reports word boxes in unrotated
    coordinates, so the visual top band is derotated to meet them -- a rotated
    page carries its number at its visual top, the way the paginator stamps it."""
    height = min(NUMBER_BAND_HEIGHT, page.rect.height)
    band = (fitz.Rect(0, 0, page.rect.width, height) * page.derotation_matrix).normalize()
    return {_TRIM.sub('', word[4]) for word in page.get_text('words')
            if fitz.Rect(word[:4]).intersects(band)}


def check_sequential_numbering(book_pdf: Path) -> dict:
    """Every page of the combined book carries its own position as a number."""
    unnumbered: list[int] = []
    with fitz.open(book_pdf) as doc:
        for page in doc:
            expected = str(page.number + 1)
            if not page.get_text().strip():
                raise CheckError('no_text_layer', (
                    f'{book_pdf.name} page {page.number + 1} has no text layer, so whether it '
                    'carries a page number cannot be read; this check refuses to guess'))
            if expected not in _top_numbers(page):
                unnumbered.append(page.number + 1)
        page_count = doc.page_count
    passed = not unnumbered
    shown = unnumbered[:20]
    detail = (f'all {page_count} page(s) carry their own number, running consecutively from 1'
              if passed else
              f'{len(unnumbered)} of {page_count} page(s) do not carry their own number at the '
              f'top of the page: {shown}{" ..." if len(unnumbered) > len(shown) else ""}')
    return {'check': 'sequential_numbering', 'passed': passed, 'file': book_pdf.name,
            'page_count': page_count, 'unnumbered_pages': unnumbered, 'detail': detail}


def run(argument: Path | None, book: Path | None, cap: int) -> list[dict]:
    if argument is None and book is None:
        raise CheckError('bad_arguments', 'give --argument, --book, or both; there is nothing to check')
    if cap < 1:
        raise CheckError('bad_arguments', f'--argument-cap must be a positive page count: {cap}')
    checks = []
    if argument is not None:
        checks.append(check_argument_pages(_require_pdf(argument, '--argument'), cap))
    if book is not None:
        checks.append(check_sequential_numbering(_require_pdf(book, '--book')))
    return checks


def main() -> int:
    parser = argparse.ArgumentParser(add_help=True, description=__doc__)
    parser.add_argument('--argument', type=Path)
    parser.add_argument('--argument-cap', type=int, default=STAY_ONLY_ARGUMENT_CAP)
    parser.add_argument('--book', type=Path)
    args = parser.parse_args()
    try:
        checks = run(args.argument, args.book, args.argument_cap)
    except CheckError as e:
        print(json.dumps({'success': False, 'error': e.code, 'detail': e.detail}))
        return 1
    except Exception:
        print(json.dumps({'success': False, 'error': 'unexpected_exception', 'detail': traceback.format_exc()}))
        return 1
    all_passed = all(c['passed'] for c in checks)
    print(json.dumps({'success': True, 'all_passed': all_passed, 'checks': checks}))
    return 0 if all_passed else 1


if __name__ == '__main__':
    sys.exit(main())
