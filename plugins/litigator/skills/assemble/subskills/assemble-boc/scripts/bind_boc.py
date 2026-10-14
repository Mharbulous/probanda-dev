"""Bind a Form 62 bill of costs with one voucher per claimed disbursement.

Usage:
    python bind_boc.py --vouchers "<working folder>/vouchers.json" [--output <pdf>]

Binds, in order: the bill itself, then one invoice or receipt per claimed
disbursement in the bill's order, each bookmarked to its bill line. The bill is
the practitioner's saved PDF when there is one, else its .docx converted through
Word (LibreOffice fallback). A disbursement line with no voucher stops the
binding and is named -- every unresolved line is reported at once, before
anything is bound.

vouchers.json:

    {
      "bill_docx": "<matter>/0. DRAFT/<stem>.docx",
      "bill_pdf": null,
      "output": null,
      "lines": [
        {"description": "Court filing fee -- NOCC", "claimed": "200.00",
         "voucher": "<matter>/9. DISBURSEMENTs/filing-fee.pdf"}
      ]
    }

`output` is optional; it defaults to the bill's stem plus " - bound.pdf" beside
the bill (`bill_pdf` when set, else `bill_docx`), so a bill at the draft
folder's root is bound beside it there. Its folder must exist (else
no_out_dir); it is never created.

An existing output is never overwritten. The output's name counts as v1 and
`<name> vN.pdf` as vN: with none present the output's own name is written, else
v(highest + 1), and the result reports the highest existing copy as
`versioned_from`. The bound PDF is saved to a `~`-prefixed temporary file in the
same folder and then renamed.

Prints one JSON line: {"success": true, "output": ..., "versioned_from"?: ...,
"page_count": ..., "bookmarks": ...} or {"success": false, "error": "<code>",
"detail": ...}. Exit 0 on success, 1 on a refusal.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import sys
import tempfile
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

_SKILLS = Path(__file__).resolve().parents[4]
# convert_docx_to_pdf and BookError belong to the sibling subskill's binder.
sys.path.insert(0, str(_SKILLS / 'assemble' / 'subskills' / 'assemble-bcca-book' / 'scripts'))
from paginate_book import BookError, convert_docx_to_pdf  # noqa: E402

IMAGE_SUFFIXES = {'.png', '.jpg', '.jpeg', '.tif', '.tiff'}


class BindError(Exception):
    def __init__(self, code: str, detail):
        self.code = code
        self.detail = detail
        super().__init__(f'{code}: {detail}')


def _as_pdf(path: Path, work_dir: Path, tag: str) -> Path:
    """Return a PDF for path, converting a .docx or an image as needed."""
    suffix = path.suffix.lower()
    if suffix == '.pdf':
        return path
    if suffix == '.docx':
        return convert_docx_to_pdf(path, work_dir / f'{tag}.pdf')
    if suffix in IMAGE_SUFFIXES:
        out = work_dir / f'{tag}.pdf'
        with fitz.open(path) as image:
            out.write_bytes(image.convert_to_pdf())
        return out
    raise BindError('unsupported_voucher', f'{path} is not a PDF, .docx or image')


def _resolve_bill(manifest: dict, work_dir: Path) -> Path:
    saved = manifest.get('bill_pdf')
    if saved:
        path = Path(saved)
        if not path.is_file():
            raise BindError('bill_missing', f'bill_pdf does not exist: {path}')
        return path
    docx = manifest.get('bill_docx')
    if not docx:
        raise BindError('bill_missing', 'neither bill_pdf nor bill_docx is set')
    path = Path(docx)
    if not path.is_file():
        raise BindError('bill_missing', f'bill_docx does not exist: {path}')
    return convert_docx_to_pdf(path, work_dir / 'bill.pdf')


def _check_lines(lines: list[dict]) -> list[Path]:
    """Return one voucher path per line, or raise naming every unresolved line."""
    if not lines:
        raise BindError('no_lines', 'the bill has no disbursement lines to bind')
    unresolved = []
    resolved = []
    for index, line in enumerate(lines):
        label = line.get('description') or f'line {index + 1}'
        voucher = line.get('voucher')
        if not voucher:
            unresolved.append({'line': label, 'reason': 'no voucher recorded'})
            continue
        path = Path(voucher)
        if not path.is_file():
            unresolved.append({'line': label, 'reason': f'file not found: {path}'})
            continue
        resolved.append(path)
    if unresolved:
        raise BindError('voucher_unresolved', unresolved)
    return resolved


def _next_version(out_path: Path) -> tuple[Path, Path | None]:
    """The path the next copy of out_path's series takes, and the highest existing
    copy (None if none). out_path's own name counts as v1 and `<stem> vN<ext>` as vN."""
    series = re.compile(r'^%s(?: v(\d+))?%s$' % (
        re.escape(out_path.stem), re.escape(out_path.suffix)), re.I)
    taken = {}
    for entry in os.listdir(out_path.parent):
        match = series.match(entry)
        if match:
            taken[int(match.group(1) or 1)] = out_path.parent / entry
    if not taken:
        return out_path, None
    top = max(taken)
    return out_path.with_name(f'{out_path.stem} v{top + 1}{out_path.suffix}'), taken[top]


def bind(manifest: dict, output: Path | None = None) -> dict:
    lines = manifest.get('lines') or []
    voucher_paths = _check_lines(lines)

    work_dir = Path(tempfile.mkdtemp(prefix='bindboc_'))
    try:
        bill_pdf = _resolve_bill(manifest, work_dir)

        # Named from the bill's own file, never from the PDF converted into work_dir.
        named_from = Path(manifest.get('bill_pdf') or manifest['bill_docx'])
        out_path = output or (
            Path(manifest['output']) if manifest.get('output')
            else named_from.with_name(f'{named_from.stem} - bound.pdf')
        )
        if not out_path.parent.is_dir():
            raise BindError('no_out_dir', f'{out_path.parent} is not a folder')

        bound = fitz.open()
        toc = []
        with fitz.open(bill_pdf) as bill:
            bound.insert_pdf(bill)
        toc.append([1, 'Bill of Costs', 1])

        for index, (line, voucher) in enumerate(zip(lines, voucher_paths)):
            start = bound.page_count + 1
            pdf = _as_pdf(voucher, work_dir, f'voucher-{index + 1}')
            with fitz.open(pdf) as source:
                bound.insert_pdf(source)
            label = line.get('description') or f'Disbursement {index + 1}'
            claimed = line.get('claimed')
            toc.append([1, f'{label} — ${claimed}' if claimed else label, start])

        bound.set_toc(toc)
        tmp = out_path.with_name(f'~{out_path.stem}.tmp-{os.getpid()}{out_path.suffix}')
        try:
            bound.save(str(tmp))
            out_path, prior = _next_version(out_path)
            if out_path.exists():
                raise BindError('output_exists', f'not overwriting {out_path}')
            os.replace(tmp, out_path)
        finally:
            if tmp.exists():
                tmp.unlink()
        page_count = bound.page_count
        bound.close()
    finally:
        # The work folder holds converted client PDFs; remove it however the bind ends.
        shutil.rmtree(work_dir, ignore_errors=True)

    result = {
        'success': True,
        'output': str(out_path),
        'page_count': page_count,
        'bookmarks': len(toc),
    }
    if prior:
        result['versioned_from'] = str(prior)
    return result


def main() -> int:
    parser = argparse.ArgumentParser(
        description='Bind a Form 62 bill of costs with one voucher per disbursement.'
    )
    parser.add_argument('--vouchers', required=True, help='Path to vouchers.json')
    parser.add_argument('--output', help='Output PDF path (overrides the manifest)')
    args = parser.parse_args()

    try:
        manifest = json.loads(Path(args.vouchers).read_text(encoding='utf-8'))
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
