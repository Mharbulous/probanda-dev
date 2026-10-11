"""Bind a general Writing's .docx with its enclosures into one PDF.

Usage:
    python bind_general.py --manifest "<working folder>/enclosures.json" [--output <pdf>]

Binds, in order: the Writing's .docx converted through Word (LibreOffice
fallback), then each enclosure in the order given, each bookmarked by its
label. An enclosure is a PDF (whole, or the pages named), a .docx or an image.
Every enclosure that cannot be bound is reported at once, before anything is
bound.

enclosures.json:

    {
      "docx": "<matter>/0. DRAFT/2026-10-01 LT LiL re smoke reports.docx",
      "output": null,
      "enclosures": [
        {"label": "Email of September 14", "path": "<matter>/.../prior letter.pdf",
         "pages": "4"}
      ]
    }

`pages` is optional: one page ("4") or a range ("2-5"), counted from 1.
`output` is optional; it defaults to the .docx's stem plus " UNSIGNED.pdf"
beside it.
An existing output is never overwritten. The PDF is saved to a `~`-prefixed
temporary file beside the output and renamed at the end, so a bind killed
mid-save leaves nothing at the output name.

Prints one JSON line: {"success": true, "output": ..., "page_count": ...,
"bookmarks": ...} or {"success": false, "error": "<code>", "detail": ...}.
Exit 0 on success, 1 on a refusal.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
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

_SKILLS = Path(__file__).resolve().parents[4]
# convert_docx_to_pdf and BookError belong to the sibling subskill's binder.
sys.path.insert(0, str(_SKILLS / 'assemble' / 'subskills' / 'assemble-bcca-book' / 'scripts'))
from paginate_book import BookError, convert_docx_to_pdf  # noqa: E402

IMAGE_SUFFIXES = {'.png', '.jpg', '.jpeg', '.tif', '.tiff'}
EMAIL_SUFFIXES = {'.eml', '.msg'}


class BindError(Exception):
    def __init__(self, code: str, detail):
        self.code = code
        self.detail = detail
        super().__init__(f'{code}: {detail}')


def _page_range(pages: str | None, count: int) -> tuple[int, int] | None:
    """Return the 0-based (first, last) pages named, None for the whole file."""
    if not pages:
        return None
    first, _, last = str(pages).partition('-')
    try:
        start, end = int(first), int(last or first)
    except ValueError:
        raise ValueError(f'pages "{pages}" is not a page or a range like 2-5') from None
    if not 1 <= start <= end <= count:
        raise ValueError(f'pages "{pages}" is outside the file\'s {count} pages')
    return start - 1, end - 1


def _check_enclosures(enclosures: list[dict]) -> list[tuple[str, Path, tuple[int, int] | None]]:
    """Return (label, path, page range) per enclosure, or raise naming every unresolved one."""
    unresolved = []
    resolved = []
    for index, enclosure in enumerate(enclosures):
        label = enclosure.get('label') or f'Enclosure {index + 1}'
        path = Path(enclosure.get('path') or '')
        suffix = path.suffix.lower()
        pages = enclosure.get('pages')
        if not enclosure.get('path') or not path.is_file():
            reason = f'file not found: {path}' if enclosure.get('path') else 'no file recorded'
        elif suffix in EMAIL_SUFFIXES:
            reason = (f'{path.name} is an email file: print it to PDF, or name the page '
                      'of a PDF that already holds it')
        elif suffix not in {'.pdf', '.docx'} | IMAGE_SUFFIXES:
            reason = f'{path.name} is not a PDF, .docx or image'
        elif pages and suffix != '.pdf':
            reason = f'{path.name}: pages can be named only for a PDF'
        elif suffix == '.docx':
            resolved.append((label, path, None))
            continue
        else:
            try:
                with fitz.open(path) as doc:
                    count = doc.page_count
            except Exception as exc:  # a corrupt file is named, never a traceback
                reason = f'{path.name} cannot be opened: {exc}'
            else:
                try:
                    resolved.append((label, path, _page_range(pages, count)))
                    continue
                except ValueError as exc:
                    reason = f'{path.name}: {exc}'
        unresolved.append({'enclosure': label, 'reason': reason})
    if unresolved:
        raise BindError('enclosure_unresolved', unresolved)
    return resolved


def _as_pdf(path: Path, work_dir: Path, tag: str, convert) -> Path:
    suffix = path.suffix.lower()
    if suffix == '.pdf':
        return path
    if suffix == '.docx':
        return convert(path, work_dir / f'{tag}.pdf')
    out = work_dir / f'{tag}.pdf'
    with fitz.open(path) as image:
        out.write_bytes(image.convert_to_pdf())
    return out


def _staging_prefix() -> str:
    """`coclerk_bindgeneral_<tag>_`, tagged with the data runtime's per-call
    COCLERK_STAGING_TAG so a call killed on timeout has its folder removed by tag."""
    tag = os.environ.get('COCLERK_STAGING_TAG')
    return f'coclerk_bindgeneral_{tag}_' if tag else 'coclerk_bindgeneral_'


def bind(manifest: dict, output: Path | None = None, convert=convert_docx_to_pdf) -> dict:
    docx = Path(manifest.get('docx') or '')
    if not manifest.get('docx') or not docx.is_file():
        raise BindError('docx_missing', f'the Writing\'s .docx does not exist: {docx}')
    checked = _check_enclosures(manifest.get('enclosures') or [])

    out_path = output or (Path(manifest['output']) if manifest.get('output')
                          else docx.with_name(f'{docx.stem} UNSIGNED.pdf'))
    if out_path.exists():
        raise BindError('output_exists', f'{out_path} already exists')

    with tempfile.TemporaryDirectory(prefix=_staging_prefix()) as tmp, fitz.open() as bound:
        work_dir = Path(tmp)
        with fitz.open(convert(docx, work_dir / 'writing.pdf')) as writing:
            bound.insert_pdf(writing)
        toc = [[1, docx.stem, 1]]
        for index, (label, path, pages) in enumerate(checked):
            start = bound.page_count + 1
            with fitz.open(_as_pdf(path, work_dir, f'enclosure-{index + 1}', convert)) as source:
                if pages:
                    bound.insert_pdf(source, from_page=pages[0], to_page=pages[1])
                else:
                    bound.insert_pdf(source)
            toc.append([1, label, start])
        bound.set_toc(toc)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        partial = out_path.with_name(f'~{out_path.stem}.tmp-{os.getpid()}.pdf')
        try:
            bound.save(str(partial))
            if out_path.exists():
                raise BindError('output_exists', f'{out_path} already exists')
            os.replace(partial, out_path)
        finally:
            if partial.exists():
                partial.unlink()
        page_count = bound.page_count

    return {'success': True, 'output': str(out_path), 'page_count': page_count,
            'bookmarks': len(toc)}


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Bind a general Writing's .docx with its enclosures into one PDF."
    )
    parser.add_argument('--manifest', required=True, help='Path to enclosures.json')
    parser.add_argument('--output', help='Output PDF path (overrides the manifest)')
    args = parser.parse_args()

    try:
        manifest = json.loads(Path(args.manifest).read_text(encoding='utf-8'))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        print(json.dumps({'success': False, 'error': 'manifest_unreadable',
                          'detail': str(exc)}))
        return 1
    try:
        result = bind(manifest, Path(args.output) if args.output else None)
    except (BindError, BookError) as exc:
        code = getattr(exc, 'code', 'bind_failed')
        detail = getattr(exc, 'detail', str(exc))
        print(json.dumps({'success': False, 'error': code, 'detail': detail}))
        return 1
    except Exception as exc:  # a defect, reported as one JSON line rather than a traceback
        print(json.dumps({'success': False, 'error': 'internal_error', 'detail': f'{exc!r}',
                          'trace': traceback.format_exc()}))
        return 1

    print(json.dumps(result))
    return 0


if __name__ == '__main__':
    sys.exit(main())
