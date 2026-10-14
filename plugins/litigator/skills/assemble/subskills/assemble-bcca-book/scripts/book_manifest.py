"""Write scripts/paginate_book.py's manifest for one book described by bcca-book.md.

The TOC rows, their part references and the bookmark text come from bcca-book.md
unchanged; the caller supplies the part PDFs, in the book's parts order, and
optionally a JSON file of affidavit exhibit bookmark text or pages.
Grammar and error codes: references/book-binding-contract.md "Book manifest builder".

Usage:
    python book_manifest.py [--exhibits <exhibits .json>] <bcca-book.md> <response|boa> <cover .docx|.pdf> <output .pdf> <manifest .json> <part .pdf>...

Prints one JSON line: {"success": true, "manifest": ..., "parts": [{"bookmark", "path"}]}
or {"success": false, "error": "<code>", "detail": "..."}. Exit 0 on success,
non-zero otherwise.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

# fill_book (bcca-book.md parser) is /publish's: skills/publish/scripts.
sys.path.insert(0, str(Path(__file__).resolve().parents[4] / 'publish' / 'scripts'))
import fill_book  # noqa: E402

_BOOK_KEYS = {
    'response': ('response_book_toc', 'response_book_parts'),
    'boa': ('boa_toc', 'boa_parts'),
}


class ManifestError(Exception):
    def __init__(self, code: str, detail: str):
        self.code = code
        self.detail = detail
        super().__init__(f'{code}: {detail}')


def build_manifest(book_md: Path, book: str, cover: Path, output: Path, part_paths: list[str],
                   exhibits: dict | None = None) -> dict:
    if book not in _BOOK_KEYS:
        raise ManifestError('bad_book', f'book must be "response" or "boa": {book!r}')
    try:
        data = fill_book.parse_bcca_book(book_md.read_text(encoding='utf-8'))
    except fill_book.ValidationError as e:
        raise ManifestError(e.code, e.detail)
    toc_key, parts_key = _BOOK_KEYS[book]
    # The response-book half is optional (a factum's book is the BOA alone), so asking for the
    # response book of a file that has none is a rejection, not a KeyError traceback.
    if parts_key not in data:
        raise ManifestError('no_parts', f'{book_md.name} carries no {parts_key}, so there is no {book} book to combine')
    parts = data[parts_key]
    if not parts:
        raise ManifestError('no_parts', f'{parts_key} is empty, so there is no {book} book to combine')
    if len(part_paths) != len(parts):
        raise ManifestError('part_count_mismatch',
                            f'{parts_key} lists {len(parts)} part(s) but {len(part_paths)} PDF path(s) were given: '
                            f'{[p["bookmark"] for p in parts]}')
    exhibits = exhibits or {}
    unknown = sorted(set(exhibits) - {part['bookmark'] for part in parts})
    if unknown:
        raise ManifestError('unknown_exhibit_part', f'exhibits name part(s) not in {parts_key}: {unknown}')
    manifest_parts = []
    for part, path in zip(parts, part_paths):
        entry = {'path': path, 'bookmark': part['bookmark']}
        if part['bookmark'] in exhibits:
            entry['exhibits'] = exhibits[part['bookmark']]
        manifest_parts.append(entry)
    return {
        'cover': str(cover),
        'toc': {'template': book, 'rows': data[toc_key]},
        'parts': manifest_parts,
        'numbering_starts': 'cover',
        'output': str(output),
    }


def main() -> int:
    args = sys.argv[1:]
    exhibits = None
    if args[:1] == ['--exhibits'] and len(args) > 1:
        exhibits = json.loads(Path(args[1]).read_text(encoding='utf-8'))
        args = args[2:]
    if len(args) < 5:
        print(__doc__, file=sys.stderr)
        return 2
    book_md, book, cover, output, manifest_path, *part_paths = args
    try:
        manifest = build_manifest(Path(book_md), book, Path(cover), Path(output), part_paths, exhibits)
    except ManifestError as e:
        print(json.dumps({'success': False, 'error': e.code, 'detail': e.detail}))
        return 1
    Path(manifest_path).write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    print(json.dumps({'success': True, 'manifest': manifest_path, 'parts': manifest['parts']}))
    return 0


if __name__ == '__main__':
    sys.exit(main())
