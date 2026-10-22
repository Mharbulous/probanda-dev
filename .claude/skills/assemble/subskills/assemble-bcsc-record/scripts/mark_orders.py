"""Make the separate copy of a filed notice of application that Rule 8-1 (15.1)
requires: every line of Part 1 (the orders sought) highlighted, from the line after
the "Part 1" heading to the line before the "Part 2" heading.

Grammar and error codes: references/record-binding-contract.md "Marked copy".

Usage:
    python mark_orders.py <filed notice .pdf> <output .pdf>

Prints one JSON line: {"success": true, "output": ..., "lines_marked": N, "pages": [...]}
or {"success": false, "error": "<code>", "detail": "..."}. Exit 0 on success,
non-zero otherwise.
"""
from __future__ import annotations

import json
import re
import sys
import traceback
from pathlib import Path

try:
    import pymupdf as fitz
except ImportError as exc:  # refuse in this script's JSON contract, not as a traceback
    print(json.dumps({'success': False, 'error': 'missing_dependency', 'detail': (
        f"{exc.name or exc} is not installed for the Python running this script "
        f"({sys.executable}). Install it into that interpreter: "
        f'"{sys.executable}" -m pip install PyMuPDF. '
        "If this is a Cowork cloud sandbox, which blocks pypi, run the script on the PC instead.")}))
    sys.exit(1)

_PART = re.compile(r'^\s*part\s+([12])\b', re.IGNORECASE)


class MarkError(Exception):
    def __init__(self, code: str, detail: str):
        self.code = code
        self.detail = detail
        super().__init__(f'{code}: {detail}')


def _lines(doc: fitz.Document) -> list[tuple[int, fitz.Rect, str]]:
    """(page index, bbox, text) of each text line, in reading order."""
    out = []
    for page in doc:
        for block in page.get_text('dict', sort=True)['blocks']:
            for line in block.get('lines', []):
                text = ''.join(span['text'] for span in line['spans'])
                if text.strip():
                    out.append((page.number, fitz.Rect(line['bbox']), text))
    return out


def mark(source: Path, output: Path) -> dict:
    if not source.is_file():
        raise MarkError('missing_file', f'file not found: {source}')
    if output.exists():
        raise MarkError('output_exists', f'output already exists, not overwriting: {output}')
    doc = fitz.open(source)
    lines = _lines(doc)
    if not lines:
        raise MarkError('no_text_layer', f'{source.name} has no text layer, so Part 1 cannot be found; '
                                         'mark the orders sought by hand')
    headings = {'1': [], '2': []}
    for i, (_, _, text) in enumerate(lines):
        match = _PART.match(text)
        if match:
            headings[match.group(1)].append(i)
    for n, found in headings.items():
        if len(found) != 1:
            raise MarkError('heading_not_found',
                            f'expected one "Part {n}" heading line in {source.name}, found {len(found)}')
    first, stop = headings['1'][0] + 1, headings['2'][0]
    if first >= stop:
        raise MarkError('heading_not_found', f'Part 1 of {source.name} holds no lines before the Part 2 heading')
    pages = set()
    for page_no, rect, _ in lines[first:stop]:
        doc[page_no].add_highlight_annot(rect)
        pages.add(page_no + 1)
    output.parent.mkdir(parents=True, exist_ok=True)
    doc.save(output, garbage=3, deflate=True)
    doc.close()
    return {'output': str(output), 'lines_marked': stop - first, 'pages': sorted(pages)}


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__, file=sys.stderr)
        return 2
    try:
        result = mark(Path(sys.argv[1]), Path(sys.argv[2]))
    except MarkError as e:
        print(json.dumps({'success': False, 'error': e.code, 'detail': e.detail}))
        return 1
    except Exception:
        print(json.dumps({'success': False, 'error': 'unexpected_exception', 'detail': traceback.format_exc()}))
        return 1
    print(json.dumps({'success': True, **result}))
    return 0


if __name__ == '__main__':
    sys.exit(main())
