"""Combine a BCCA book's cover, table of contents and parts into court-ready PDF(s):
top-centre page numbers, Page Labels, bookmarks, back-filled TOC page cells,
and a volume split above the size limit.

Manifest grammar, error codes and output are owned by
references/book-binding-contract.md "Book paginator manifest" (SSOT).

Usage:
    python paginate_book.py <manifest.json path>

Prints one JSON line: {"success": true, "volumes": [...]} or
{"success": false, "error": "<code>", "detail": "..."}. Exit 0 on success,
non-zero otherwise.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import traceback
from pathlib import Path
from typing import Callable

try:
    import pymupdf as fitz
except ImportError as exc:  # refuse in this script's JSON contract, not as a traceback
    print(json.dumps({'success': False, 'error': 'missing_dependency', 'detail': (
        f"{exc.name or exc} is not installed for the Python running this script "
        f"({sys.executable}). Install it into that interpreter: "
        f'"{sys.executable}" -m pip install PyMuPDF. '
        "If this is a Cowork cloud sandbox, which blocks pypi, run the script on the PC instead.")}))
    sys.exit(1)

# fill_book (TOC re-render, row validation) is /publish's: skills/publish/scripts.
sys.path.insert(0, str(Path(__file__).resolve().parents[4] / 'publish' / 'scripts'))
import fill_book  # noqa: E402

DEFAULT_MAX_BYTES = 200_000_000
FONT = 'helv'
FONTSIZE = 12.0
PAGE_NUMBER_BASELINE = 36.0   # 0.5 inch below the top edge
VOLUME_LABEL_BASELINE = 54.0  # one line below the page number

_REQUIRED_KEYS = ('cover', 'toc', 'parts', 'numbering_starts', 'output')
_KNOWN_KEYS = set(_REQUIRED_KEYS) | {'number_repeated_front_matter'}
_PART_KEYS = {'path', 'bookmark'}
# The commissioner's stamp on an exhibit's first page, e.g. 'This is Exhibit "A" referred to in the affidavit of'.
# Any one punctuation mark counts as the quote: fonts without a curly-quote glyph extract it as something else.
_EXHIBIT_STAMP = re.compile(
    r'This\s+is\s+Exhibit\s+[^\w\s]?\s*([A-Z]{1,3}|\d{1,3})\s*[^\w\s]?\s+referred\s+to\s+in',
    re.IGNORECASE)
_TOC_ROW_KEYS = {
    'response': ({'text', 'indent'}, True),
    'boa': ({'authority', 'citation'}, False),
}


class BookError(Exception):
    def __init__(self, code: str, detail: str):
        self.code = code
        self.detail = detail
        super().__init__(f'{code}: {detail}')


# ---------------------------------------------------------------------------
# Manifest
# ---------------------------------------------------------------------------

def load_manifest(path: Path) -> dict:
    try:
        data = json.loads(path.read_text(encoding='utf-8'))
    except json.JSONDecodeError as e:
        raise BookError('bad_manifest', f'manifest is not valid JSON: {e}')
    if not isinstance(data, dict):
        raise BookError('bad_manifest', 'manifest must be a JSON object')
    unknown = set(data) - _KNOWN_KEYS
    if unknown:
        raise BookError('bad_manifest', f'unknown key(s): {sorted(unknown)}')
    for key in _REQUIRED_KEYS:
        if key not in data:
            raise BookError('bad_manifest', f'missing required key: {key!r}')

    cover = Path(data['cover'])
    if cover.suffix.lower() not in ('.pdf', '.docx'):
        raise BookError('bad_manifest', f'cover must be a .pdf or .docx: {cover}')
    _require_file(cover)

    parts = data['parts']
    if not isinstance(parts, list) or not parts:
        raise BookError('bad_manifest', 'parts must be a non-empty JSON array')
    for part in parts:
        if not isinstance(part, dict) or not _PART_KEYS <= set(part) <= _PART_KEYS | {'exhibits'}:
            raise BookError('bad_manifest', f'parts entry must have path and bookmark, and optionally exhibits: {part!r}')
        if not isinstance(part['bookmark'], str) or not part['bookmark'].strip():
            raise BookError('bad_manifest', f'parts entry bookmark must be a non-empty string: {part!r}')
        if 'exhibits' in part:
            _validate_exhibits(part)
        if Path(part['path']).suffix.lower() != '.pdf':
            raise BookError('bad_manifest', f'parts entry path must be a .pdf: {part!r}')
        _require_file(Path(part['path']))

    toc = data['toc']
    if not isinstance(toc, dict) or set(toc) != {'template', 'rows'} or toc['template'] not in _TOC_ROW_KEYS:
        raise BookError('bad_manifest', 'toc must be {"template": "response" | "boa", "rows": [...]}')
    validate_rows(toc['template'], toc['rows'], len(parts))

    if data['numbering_starts'] not in ('cover', 'after_toc'):
        raise BookError('bad_manifest', 'numbering_starts must be "cover" or "after_toc"')
    repeated = data.get('number_repeated_front_matter')
    if repeated is not None and not isinstance(repeated, bool):
        raise BookError('bad_manifest', 'number_repeated_front_matter must be true or false')
    return data


def _validate_exhibits(part: dict) -> None:
    exhibits = part['exhibits']
    if not _is_affidavit(part):
        raise BookError('bad_manifest', f'exhibits are only allowed on an affidavit part: {part["bookmark"]!r}')
    if not isinstance(exhibits, dict) or not set(exhibits) <= {'text', 'pages'}:
        raise BookError('bad_manifest', f'exhibits must be an object with optional text and pages: {part!r}')
    for key, kind in (('text', str), ('pages', int)):
        values = exhibits.get(key, {})
        if not isinstance(values, dict) or not all(
                isinstance(k, str) and isinstance(v, kind) and not isinstance(v, bool) and v
                for k, v in values.items()):
            raise BookError('bad_manifest', f'exhibits.{key} must map exhibit labels to {kind.__name__} values: {part!r}')


def _is_affidavit(part: dict) -> bool:
    return part['bookmark'].startswith('Affidavit')


def validate_rows(template: str, rows, part_count: int) -> None:
    if not isinstance(rows, list):
        raise BookError('bad_toc_row', 'toc rows must be a JSON array')
    keys, check_indent = _TOC_ROW_KEYS[template]
    try:
        fill_book.validate_part_refs(rows, 'toc.rows', part_count)
        fill_book._validate_toc_rows(_strip_part(rows), 'toc.rows', allowed_keys=keys,
                                     required_keys=keys, check_indent=check_indent)
    except fill_book.ValidationError as e:
        raise BookError(e.code, e.detail)


def _strip_part(rows: list[dict]) -> list[dict]:
    return [{k: v for k, v in row.items() if k != 'part'} for row in rows]


def _require_file(path: Path) -> None:
    if not path.is_file():
        raise BookError('missing_file', f'file not found: {path}')


# ---------------------------------------------------------------------------
# Layout: which printed number each page carries
# ---------------------------------------------------------------------------

def layout(n_cover: int, n_toc: int, part_pages: list[int], volumes: list[list[int]],
           numbering_starts: str, number_repeated_front_matter: bool | None) -> dict:
    """Volume 1's cover and TOC are numbered only when numbering starts on the
    cover. A later volume's repeated cover and TOC are numbered only when the
    caller says so. Parts are always numbered, continuing across volumes."""
    counter = 1
    numbers: list[list[int | None]] = []
    part_start: dict[int, int] = {}
    cover_number = toc_number = None
    front = n_cover + n_toc
    for v, idxs in enumerate(volumes):
        numbered_front = numbering_starts == 'cover' if v == 0 else bool(number_repeated_front_matter)
        if numbered_front:
            if v == 0:
                cover_number, toc_number = counter, counter + n_cover
            nums: list[int | None] = list(range(counter, counter + front))
            counter += front
        else:
            nums = [None] * front
        for i in idxs:
            part_start[i] = counter
            nums.extend(range(counter, counter + part_pages[i]))
            counter += part_pages[i]
        numbers.append(nums)
    return {'numbers': numbers, 'part_start': part_start,
            'cover': cover_number, 'toc': toc_number}


def page_cells(rows: list[dict], lay: dict) -> list[str]:
    cells = []
    for row in rows:
        ref = row['part']
        if ref is None:
            number = None
        elif ref in ('cover', 'toc'):
            number = lay[ref]
        else:
            number = lay['part_start'][ref]
        cells.append('' if number is None else str(number))
    return cells


def label_ranges(nums: list[int | None]) -> list[dict]:
    """Page Label ranges matching the stamps: arabic runs start at their stamped
    number; unstamped runs get lowercase roman so they never collide with a
    stamped number in page search."""
    ranges = []
    for i, n in enumerate(nums):
        if i == 0 or (n is None) != (nums[i - 1] is None) or (n is not None and n != nums[i - 1] + 1):
            ranges.append({'startpage': i, 'prefix': '',
                           'style': 'r' if n is None else 'D',
                           'firstpagenum': 1 if n is None else n})
    return ranges


# ---------------------------------------------------------------------------
# Assembly
# ---------------------------------------------------------------------------

def _page_count(pdf: Path) -> int:
    with fitz.open(pdf) as doc:
        return doc.page_count


def exhibit_bookmarks(part: dict) -> list[tuple[str, int]]:
    """(bookmark text, 0-based page in the part) for each exhibit of an affidavit part.
    Pages come from exhibits.pages when given, otherwise from the stamp pages'
    text layer; a page with no text layer is a hard error, never a guess."""
    if not _is_affidavit(part):
        return []
    exhibits = part.get('exhibits', {})
    with fitz.open(part['path']) as doc:
        if 'pages' in exhibits:
            found = {}
            for label, page in exhibits['pages'].items():
                if not 1 <= page <= doc.page_count:
                    raise BookError('bad_exhibit_page', f'{part["bookmark"]!r} has {doc.page_count} page(s); '
                                                        f'exhibit {label} cannot start on page {page}')
                found[label] = page - 1
        else:
            found = {}
            for page in doc:
                text = page.get_text()
                if not text.strip():
                    raise BookError('no_text_layer', f'{part["bookmark"]!r} page {page.number + 1} has no text layer, '
                                                     'so its exhibit stamps cannot be read; supply exhibits.pages')
                match = _EXHIBIT_STAMP.search(text)
                if not match:
                    continue
                label = match.group(1).upper()
                if label in found:
                    raise BookError('exhibit_stamp_repeated',
                                    f'{part["bookmark"]!r} has an Exhibit {label} stamp on pages {found[label] + 1} and '
                                    f'{page.number + 1} (an exhibit that is itself an affidavit?); supply exhibits.pages')
                found[label] = page.number
    texts = exhibits.get('text', {})
    unmatched = sorted(set(texts) - set(found))
    if unmatched:
        raise BookError('exhibit_text_unmatched', f'{part["bookmark"]!r} has no exhibit {unmatched}; '
                                                  f'its exhibits are {list(found)}')
    return [(f'Exhibit {label} – {texts[label]}' if label in texts else f'Exhibit {label}', page)
            for label, page in sorted(found.items(), key=lambda item: item[1])]


def _stamp(page: fitz.Page, text: str, baseline: float) -> None:
    """Centre text at the visual top of the page, whatever its /Rotate."""
    width = fitz.get_text_length(text, fontname=FONT, fontsize=FONTSIZE)
    point = fitz.Point(page.rect.width / 2 - width / 2, baseline) * page.derotation_matrix
    page.insert_text(point, text, fontname=FONT, fontsize=FONTSIZE, rotate=page.rotation)


def _settle_toc(render_toc: Callable[[list[str]], Path], rows, n_cover, part_pages, volumes,
                numbering_starts, number_repeated_front_matter):
    """Render the TOC with blank cells to learn its length, then with real
    numbers. Filling cells can reflow the TOC onto another page, which moves
    every later number, so recompute once; a second change is a hard error."""
    n_toc = _page_count(render_toc([''] * len(rows)))
    for _ in range(2):
        lay = layout(n_cover, n_toc, part_pages, volumes, numbering_starts, number_repeated_front_matter)
        toc_pdf = render_toc(page_cells(rows, lay))
        rendered = _page_count(toc_pdf)
        if rendered == n_toc:
            return toc_pdf, lay
        n_toc = rendered
    raise BookError('toc_page_count_unstable',
                    'the table of contents changed page count twice while its page numbers were filled in')


def _build_volume(cover_pdf: Path, toc_pdf: Path, parts: list[dict], exhibits: list[list[tuple[str, int]]],
                  idxs: list[int], nums: list[int | None], volume_label: str | None, out_path: Path) -> int:
    doc = fitz.open()
    with fitz.open(cover_pdf) as src:
        doc.insert_pdf(src)
        n_cover = src.page_count
    with fitz.open(toc_pdf) as src:
        doc.insert_pdf(src)
    bookmarks = [[1, 'Cover Page', 1], [1, 'Table of Contents', n_cover + 1]]
    for i in idxs:
        start = doc.page_count + 1
        bookmarks.append([1, parts[i]['bookmark'], start])
        bookmarks.extend([2, title, start + offset] for title, offset in exhibits[i])
        with fitz.open(parts[i]['path']) as src:
            doc.insert_pdf(src)
    for page, n in zip(doc, nums):
        if n is not None:
            _stamp(page, str(n), PAGE_NUMBER_BASELINE)
    if volume_label:
        _stamp(doc[0], volume_label, VOLUME_LABEL_BASELINE)
    doc.set_page_labels(label_ranges(nums))
    doc.set_toc(bookmarks)
    doc.save(out_path, garbage=3, deflate=True)
    doc.close()
    return out_path.stat().st_size


def _plan_volumes(parts: list[dict], budget: int) -> list[list[int]]:
    """Fill each volume with whole parts, in order, up to the byte budget."""
    volumes: list[list[int]] = []
    current: list[int] = []
    size = 0
    for i, part in enumerate(parts):
        part_size = Path(part['path']).stat().st_size
        if part_size > budget:
            raise BookError('part_over_limit',
                            f'part {i} ({part["bookmark"]!r}) is {part_size} bytes; with the cover and '
                            f'table of contents it cannot fit in one volume under the limit')
        if current and size + part_size > budget:
            volumes.append(current)
            current, size = [], 0
        current.append(i)
        size += part_size
    volumes.append(current)
    return volumes


def paginate(cover_pdf: Path, render_toc: Callable[[list[str]], Path], rows: list[dict],
             parts: list[dict], numbering_starts: str, output: Path, work_dir: Path,
             number_repeated_front_matter: bool | None = None,
             max_bytes: int = DEFAULT_MAX_BYTES) -> list[dict]:
    if output.exists():
        raise BookError('output_exists', f'output already exists, not overwriting: {output}')
    n_cover = _page_count(cover_pdf)
    part_pages = [_page_count(Path(p['path'])) for p in parts]
    exhibits = [exhibit_bookmarks(p) for p in parts]

    whole = [list(range(len(parts)))]
    toc_pdf, lay = _settle_toc(render_toc, rows, n_cover, part_pages, whole,
                               numbering_starts, number_repeated_front_matter)
    trial = work_dir / 'whole-book.pdf'
    size = _build_volume(cover_pdf, toc_pdf, parts, exhibits, whole[0], lay['numbers'][0], None, trial)
    if size <= max_bytes:
        output.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(trial), str(output))
        return [{'path': str(output), 'page_count': len(lay['numbers'][0]), 'bytes': size}]

    if number_repeated_front_matter is None:
        raise BookError('split_setting_required',
                        f'the book is {size} bytes, over the {max_bytes}-byte limit, so it must be split; '
                        'set number_repeated_front_matter to say whether later volumes\' cover and '
                        'table of contents take page numbers')
    budget = max_bytes - cover_pdf.stat().st_size - toc_pdf.stat().st_size
    volumes = _plan_volumes(parts, budget)
    toc_pdf, lay = _settle_toc(render_toc, rows, n_cover, part_pages, volumes,
                               numbering_starts, number_repeated_front_matter)
    paths = [output.with_name(f'{output.stem} (Volume {v + 1} of {len(volumes)}){output.suffix}')
             for v in range(len(volumes))]
    for path in paths:
        if path.exists():
            raise BookError('output_exists', f'output already exists, not overwriting: {path}')
    output.parent.mkdir(parents=True, exist_ok=True)
    results = []
    for v, (idxs, path) in enumerate(zip(volumes, paths)):
        size = _build_volume(cover_pdf, toc_pdf, parts, exhibits, idxs, lay['numbers'][v],
                             f'Volume {v + 1} of {len(volumes)}', path)
        if size > max_bytes:
            raise BookError('volume_over_limit', f'{path} is {size} bytes, over the {max_bytes}-byte limit')
        results.append({'path': str(path), 'page_count': len(lay['numbers'][v]), 'bytes': size})
    return results


# ---------------------------------------------------------------------------
# Word conversion (the cover and TOC arrive as .docx from fill_book.py)
# ---------------------------------------------------------------------------

def _word_com_convert(docx_path: Path, pdf_path: Path) -> None:
    # Paths travel in environment variables, never interpolated into the
    # script, so a quote or backtick in a path cannot break out.
    # No $doc.Close(): on fill_book's cover .docx Word drops the COM connection
    # at Close (RPC_E_DISCONNECTED) after a good export. Quit(0), don't-save,
    # closes the document without that call.
    ps_script = (
        '$ErrorActionPreference = "Stop"\n'
        '$word = New-Object -ComObject Word.Application\n'
        '$word.Visible = $false\n'
        'try {\n'
        '    $doc = $word.Documents.Open($env:BOOKPAG_DOCX)\n'
        '    $doc.ExportAsFixedFormat($env:BOOKPAG_PDF, 17)\n'
        '} finally {\n'
        '    $word.Quit([ref]0)\n'
        '}\n'
    )
    env = {**os.environ, 'BOOKPAG_DOCX': str(docx_path.resolve()), 'BOOKPAG_PDF': str(pdf_path.resolve())}
    proc = subprocess.run(
        ['powershell', '-NoProfile', '-NonInteractive', '-Command', ps_script],
        capture_output=True, text=True, timeout=120, env=env,
    )
    if proc.returncode != 0 or not pdf_path.is_file():
        raise RuntimeError(f'Word could not convert {docx_path}: rc={proc.returncode} '
                           f'stdout={proc.stdout.strip()!r} stderr={proc.stderr.strip()!r}')


def _soffice_convert(docx_path: Path, pdf_path: Path) -> None:
    # soffice names its output after the .docx, so convert into a scratch
    # directory and move the result to the caller's exact pdf_path.
    with tempfile.TemporaryDirectory(prefix='bookpag_soffice_') as out_dir:
        proc = subprocess.run(
            ['soffice', '--headless', '--convert-to', 'pdf', '--outdir', out_dir, str(docx_path)],
            capture_output=True, text=True, timeout=120,
        )
        produced = Path(out_dir) / (docx_path.stem + '.pdf')
        if proc.returncode != 0 or not produced.is_file():
            raise RuntimeError(f'soffice could not convert {docx_path}: rc={proc.returncode} '
                               f'stderr={proc.stderr.strip()!r}')
        pdf_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(produced), str(pdf_path))


def convert_docx_to_pdf(docx_path: Path, pdf_path: Path) -> Path:
    """Word COM (via PowerShell) first, soffice fallback; both attempts'
    failures are reported if neither works."""
    errors = []
    for name, convert in (('word_com', _word_com_convert), ('soffice', _soffice_convert)):
        try:
            convert(docx_path, pdf_path)
            return pdf_path
        except Exception as exc:
            errors.append(f'{name}: {exc}')
    raise BookError('docx_conversion_failed', '; '.join(errors))


def word_toc_renderer(template: str, rows: list[dict], work_dir: Path) -> Callable[[list[str]], Path]:
    build = fill_book.build_response_toc if template == 'response' else fill_book.build_boa_toc
    fill_rows = _strip_part(rows)
    count = 0

    def render(cells: list[str]) -> Path:
        nonlocal count
        count += 1
        docx = work_dir / f'toc-{count}.docx'
        build(fill_rows, docx, pages=cells)
        return convert_docx_to_pdf(docx, work_dir / f'toc-{count}.pdf')

    return render


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def run(manifest_path: Path) -> list[dict]:
    data = load_manifest(manifest_path)
    work_dir = Path(tempfile.mkdtemp(prefix='bookpag_'))
    try:
        cover = Path(data['cover'])
        if cover.suffix.lower() == '.docx':
            cover = convert_docx_to_pdf(cover, work_dir / 'cover.pdf')
        rows = data['toc']['rows']
        return paginate(
            cover_pdf=cover,
            render_toc=word_toc_renderer(data['toc']['template'], rows, work_dir),
            rows=rows,
            parts=data['parts'],
            numbering_starts=data['numbering_starts'],
            output=Path(data['output']),
            work_dir=work_dir,
            number_repeated_front_matter=data.get('number_repeated_front_matter'),
        )
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__, file=sys.stderr)
        return 2
    try:
        volumes = run(Path(sys.argv[1]))
    except BookError as e:
        print(json.dumps({'success': False, 'error': e.code, 'detail': e.detail}))
        return 1
    except Exception:
        print(json.dumps({'success': False, 'error': 'unexpected_exception', 'detail': traceback.format_exc()}))
        return 1
    print(json.dumps({'success': True, 'volumes': volumes}))
    return 0


if __name__ == '__main__':
    sys.exit(main())
