"""Bind a VanIAC package into one PDF.

Usage:
    python bind_package.py --index-json <Package index.json> --package-dir <Package dir>
                           [--output <pdf>] [--bind-unsigned "<witness>=<the practitioner's direction>"]...

Binds, in order: the cover, the index with its page column filled, the
written argument, each signed witness statement, each expert report, and
each exhibit behind a divider page carrying its number and index
description. The files are bound as they sit in the Package folder and are
never re-rendered or changed. The written argument is its PDF when the
practitioner saved one, else its .docx converted through Word. A witness
with no `- signed.pdf` stops the binding and is named, unless the
practitioner directed binding the unsigned statement; that direction is
recorded in their words in `Package index.json`.

Page numbers, Page Labels, bookmarks and the index page column come from
assemble-bcca-book's paginate_book.paginate. The index is rendered through
publish-vaniac-package's fill_vaniac.build_index, so /publish must be
installed beside /assemble. Word (Windows, through PowerShell) converts the
cover, the index and any .docx.

The output defaults to `<Side>'s <Round> Submissions.pdf` beside the Package
folder, and is never overwritten.

Prints one JSON line: {"success": true, "volumes": [{"path", "page_count",
"bytes"}], "parts": [...]} or {"success": false, "error": "<code>", "detail": "..."}.
Exit 0 on success, 1 on a refusal.
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
import tempfile
import textwrap
import traceback
from pathlib import Path
from typing import Callable

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
# paginate_book is the sibling subskill's; fill_vaniac is /publish's.
sys.path.insert(0, str(_SKILLS / 'assemble' / 'subskills' / 'assemble-bcca-book' / 'scripts'))
sys.path.insert(0, str(_SKILLS / 'publish' / 'subskills' / 'publish-vaniac-package' / 'scripts'))
import paginate_book  # noqa: E402
from paginate_book import BookError  # noqa: E402
import fill_vaniac  # noqa: E402

IMAGE_SUFFIXES = {'.png', '.jpg', '.jpeg', '.tif', '.tiff'}


class BindError(Exception):
    def __init__(self, code: str, detail: str):
        self.code = code
        self.detail = detail
        super().__init__(f'{code}: {detail}')


Converter = Callable[[Path, Path], Path]


def _one(package_dir: Path, pattern: str, what: str) -> Path | None:
    found = sorted(package_dir.glob(pattern))
    if len(found) > 1:
        raise BindError('ambiguous_file', f'{what}: more than one file matches, {[p.name for p in found]}')
    return found[0] if found else None


def _as_pdf(path: Path, work_dir: Path, convert: Converter) -> Path:
    suffix = path.suffix.lower()
    if suffix == '.pdf':
        return path
    if suffix == '.docx':
        return convert(path, work_dir / f'{path.stem}.pdf')
    if suffix in IMAGE_SUFFIXES:
        out = work_dir / f'{path.stem}.pdf'
        with fitz.open(path) as img:
            pdf = fitz.open('pdf', img.convert_to_pdf())
        pdf.save(out)
        pdf.close()
        return out
    raise BindError('unsupported_file', f'{path.name}: only PDF, Word and image files can be bound')


def divider(number: int, description: str, out: Path) -> Path:
    doc = fitz.open()
    page = doc.new_page(width=612, height=792)
    # insert_textbox writes nothing and returns a negative number when the text doesn't fit.
    heading = page.insert_textbox(fitz.Rect(72, 260, 540, 340), f'Exhibit {number}', fontname='hebo',
                                  fontsize=24, align=1)
    lines = '\n'.join(textwrap.wrap(description, 60))
    body = page.insert_textbox(fitz.Rect(72, 350, 540, 720), lines, fontname='helv', fontsize=14, align=1)
    if heading < 0 or body < 0:
        raise BindError('divider_overflow', f'Ex. {number}: its description does not fit on a divider page')
    doc.save(out)
    doc.close()
    return out


def _joined(first: Path, second: Path, out: Path) -> Path:
    doc = fitz.open()
    for path in (first, second):
        with fitz.open(path) as src:
            doc.insert_pdf(src)
    doc.save(out, garbage=3, deflate=True)
    doc.close()
    return out


def collect_parts(data: dict, package_dir: Path, work_dir: Path, convert: Converter,
                  bind_unsigned: dict[str, str]) -> list[dict]:
    """The bound parts in index_rows() order: written argument, witnesses,
    experts, exhibits."""
    side = data['side']
    argument = (_one(package_dir, f'Written Argument of the {side}.pdf', 'written argument')
                or _one(package_dir, f'Written Argument of the {side}.docx', 'written argument'))
    if argument is None:
        raise BindError('missing_file', f'no Written Argument of the {side}.pdf or .docx in {package_dir}')
    parts = [{'path': str(_as_pdf(argument, work_dir, convert)), 'bookmark': f'Written Argument of the {side}'}]

    unsigned = []
    for name in data['witnesses']:
        signed = _one(package_dir, f'Witness Statement of {name} - signed.pdf', f'witness {name}')
        if signed is None and name in bind_unsigned:
            signed = _one(package_dir, f'Witness Statement of {name}.docx', f'witness {name}')
        if signed is None:
            unsigned.append(name)
            continue
        parts.append({'path': str(_as_pdf(signed, work_dir, convert)), 'bookmark': f'Witness Statement of {name}'})
    if unsigned:
        raise BindError('unsigned_witness', f'no signed statement for {unsigned}; bind only after the practitioner '
                                            'places the signed PDF, or directs binding the unsigned statement')

    for name in data['experts']:
        report = package_dir / f'Expert Report of {name}.pdf'
        parts.append({'path': str(report), 'bookmark': f'Expert Report of {name}'})

    missing = []
    for x in data['exhibits']:
        n = x['number']
        exhibit = _one(package_dir, f'Exhibit {n} - *', f'Ex. {n}')
        if exhibit is None:
            missing.append(n)
            continue
        body = _as_pdf(exhibit, work_dir, convert)
        cover = divider(n, x['description'], work_dir / f'divider-{n}.pdf')
        parts.append({'path': str(_joined(cover, body, work_dir / f'exhibit-{n}.pdf')),
                      'bookmark': exhibit.stem})
    if missing:
        raise BindError('missing_file', f'no exhibit file in the Package folder for Ex. {missing}; run the gather step')
    return parts


def index_renderer(data: dict, work_dir: Path, convert: Converter) -> Callable[[list[str]], Path]:
    count = 0

    def render(cells: list[str]) -> Path:
        nonlocal count
        count += 1
        docx = fill_vaniac.build_index(data, work_dir / f'index-{count}.docx', pages=cells, cover=False)
        return convert(docx, work_dir / f'index-{count}.pdf')

    return render


def bind(index_json: Path, package_dir: Path, output: Path | None, work_dir: Path,
         convert: Converter = paginate_book.convert_docx_to_pdf,
         bind_unsigned: dict[str, str] | None = None) -> dict:
    data = json.loads(index_json.read_text(encoding='utf-8'))
    bind_unsigned = bind_unsigned or {}
    stray = sorted(set(bind_unsigned) - set(data['witnesses']))
    if stray:
        raise BindError('unknown_witness', f'--bind-unsigned names {stray}, not a witness in this package')
    data['experts'] = fill_vaniac.expert_names(package_dir)
    output = output or package_dir.parent / f'{fill_vaniac.round_title(data)}.pdf'
    if output.exists():
        raise BindError('output_exists', f'output already exists, not overwriting: {output}')

    parts = collect_parts(data, package_dir, work_dir, convert, bind_unsigned)
    cover_docx = fill_vaniac.build_index(data, work_dir / 'cover.docx', index=False)
    cover_pdf = convert(cover_docx, work_dir / 'cover.pdf')
    rows = fill_vaniac.index_rows(data)
    volumes = paginate_book.paginate(cover_pdf, index_renderer(data, work_dir, convert), rows, parts,
                                     'cover', output, work_dir)
    if bind_unsigned:
        data['unsigned_directions'] = {**data.get('unsigned_directions', {}), **bind_unsigned}
        saved = json.loads(index_json.read_text(encoding='utf-8'))
        saved['unsigned_directions'] = data['unsigned_directions']
        index_json.write_text(json.dumps(saved, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    return {'success': True, 'volumes': volumes, 'parts': [p['bookmark'] for p in parts]}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--index-json', type=Path, required=True)
    parser.add_argument('--package-dir', type=Path, required=True)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--bind-unsigned', action='append', default=[])
    args = parser.parse_args()
    work_dir = Path(tempfile.mkdtemp(prefix='vaniac_bind_'))
    try:
        directions = {}
        for item in args.bind_unsigned:
            name, sep, words = item.partition('=')
            if not sep or not name.strip() or not words.strip():
                raise BindError('bad_direction', f'--bind-unsigned takes "<witness>=<direction>", got {item!r}')
            directions[name.strip()] = words.strip()
        result = bind(args.index_json, args.package_dir, args.output, work_dir, bind_unsigned=directions)
    except (BindError, BookError) as e:
        print(json.dumps({'success': False, 'error': e.code, 'detail': e.detail}, ensure_ascii=False))
        return 1
    except Exception as e:  # a defect, reported as one JSON line rather than a traceback
        print(json.dumps({'success': False, 'error': 'internal_error', 'detail': f'{e!r}',
                          'trace': traceback.format_exc()}))
        return 1
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    sys.exit(main())
