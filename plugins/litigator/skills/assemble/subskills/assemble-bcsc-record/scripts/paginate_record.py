"""Bind a BCSC application record: the Form 30.001 cover, an index, and each tab's
PDF, in consecutively numbered pages with a bookmark per tab (Rule 8-1 (15) (b)).
Also writes the index pages alone, for service under Rule 8-1 (17).

Manifest grammar, error codes and output are owned by
references/record-binding-contract.md "Record paginator" (SSOT).

Usage:
    python paginate_record.py <manifest.json path>

Prints one JSON line: {"success": true, "record": ..., "index": ..., "page_count": N,
"tabs": [{"tab", "title", "page"}]} or {"success": false, "error": "<code>", "detail": "..."}.
Exit 0 on success, non-zero otherwise.
"""
from __future__ import annotations

import json
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

FONT = 'helv'
FONTSIZE = 12.0
PAGE_NUMBER_BASELINE = 36.0   # 0.5 inch below the top edge
PAGE_W, PAGE_H = 612.0, 792.0
MARGIN = 72.0
LINE = 18.0
TAB_X, TITLE_X, PAGE_RIGHT = MARGIN, MARGIN + 50, PAGE_W - MARGIN
TITLE_WIDTH = PAGE_RIGHT - 60 - TITLE_X
FIRST_ROW_Y = MARGIN + 3 * LINE

_KEYS = {'cover', 'tabs', 'output', 'index_output'}
_TAB_KEYS = {'tab', 'title', 'kind', 'path'}


class RecordError(Exception):
    def __init__(self, code: str, detail: str):
        self.code = code
        self.detail = detail
        super().__init__(f'{code}: {detail}')


def load_manifest(path: Path) -> dict:
    try:
        data = json.loads(path.read_text(encoding='utf-8'))
    except json.JSONDecodeError as e:
        raise RecordError('bad_manifest', f'manifest is not valid JSON: {e}')
    if not isinstance(data, dict) or set(data) != _KEYS:
        raise RecordError('bad_manifest', f'manifest must hold exactly {sorted(_KEYS)}')
    tabs = data['tabs']
    if not isinstance(tabs, list) or not tabs:
        raise RecordError('bad_manifest', 'tabs must be a non-empty JSON array')
    for i, tab in enumerate(tabs, 1):
        if not isinstance(tab, dict) or set(tab) != _TAB_KEYS or tab['tab'] != i:
            raise RecordError('bad_manifest', f'tab {i} must be {{tab: {i}, title, kind, path}}: {tab!r}')
    for p in [data['cover']] + [t['path'] for t in tabs]:
        if not Path(p).is_file():
            raise RecordError('missing_file', f'file not found: {p}')
    for p in (data['output'], data['index_output']):
        if Path(p).exists():
            raise RecordError('output_exists', f'output already exists, not overwriting: {p}')
    return data


def wrap(text: str, width: float = TITLE_WIDTH) -> list[str]:
    lines, current = [], ''
    for word in text.split():
        trial = f'{current} {word}'.strip()
        if current and fitz.get_text_length(trial, fontname=FONT, fontsize=FONTSIZE) > width:
            lines.append(current)
            current = word
        else:
            current = trial
    return lines + [current]


def index_pages(tabs: list[dict]) -> list[list[tuple[int, list[str]]]]:
    """Tabs grouped onto index pages; a tab's wrapped title never splits across pages."""
    per_page = int((PAGE_H - MARGIN - FIRST_ROW_Y) // LINE)
    pages, current, used = [], [], 0
    for i, tab in enumerate(tabs):
        lines = wrap(tab['title'])
        if current and used + len(lines) > per_page:
            pages.append(current)
            current, used = [], 0
        current.append((i, lines))
        used += len(lines)
    return pages + [current]


def render_index(doc: fitz.Document, layout: list[list[tuple[int, list[str]]]], tabs: list[dict],
                 starts: list[int]) -> None:
    for rows in layout:
        page = doc.new_page(width=PAGE_W, height=PAGE_H)
        heading = 'INDEX'
        page.insert_text(((PAGE_W - fitz.get_text_length(heading, fontname=FONT, fontsize=FONTSIZE)) / 2, MARGIN + LINE),
                         heading, fontname=FONT, fontsize=FONTSIZE)
        y = MARGIN + 2.5 * LINE
        page.insert_text((TAB_X, y), 'Tab', fontname=FONT, fontsize=FONTSIZE)
        page.insert_text((TITLE_X, y), 'Document', fontname=FONT, fontsize=FONTSIZE)
        _right(page, 'Page', y)
        y = FIRST_ROW_Y + LINE
        for i, lines in rows:
            page.insert_text((TAB_X, y), str(tabs[i]['tab']), fontname=FONT, fontsize=FONTSIZE)
            _right(page, str(starts[i]), y)
            for line in lines:
                page.insert_text((TITLE_X, y), line, fontname=FONT, fontsize=FONTSIZE)
                y += LINE


def _right(page: fitz.Page, text: str, y: float) -> None:
    page.insert_text((PAGE_RIGHT - fitz.get_text_length(text, fontname=FONT, fontsize=FONTSIZE), y),
                     text, fontname=FONT, fontsize=FONTSIZE)


def _stamp(page: fitz.Page, text: str) -> None:
    """Centre text at the visual top of the page, whatever its /Rotate."""
    width = fitz.get_text_length(text, fontname=FONT, fontsize=FONTSIZE)
    point = fitz.Point(page.rect.width / 2 - width / 2, PAGE_NUMBER_BASELINE) * page.derotation_matrix
    page.insert_text(point, text, fontname=FONT, fontsize=FONTSIZE, rotate=page.rotation)


def bind(data: dict) -> dict:
    tabs = data['tabs']
    with fitz.open(data['cover']) as src:
        n_cover = src.page_count
    tab_pages = []
    for tab in tabs:
        with fitz.open(tab['path']) as src:
            tab_pages.append(src.page_count)
    layout = index_pages(tabs)
    n_index = len(layout)
    starts, counter = [], n_cover + n_index + 1
    for n in tab_pages:
        starts.append(counter)
        counter += n

    doc = fitz.open()
    with fitz.open(data['cover']) as src:
        doc.insert_pdf(src)
    render_index(doc, layout, tabs, starts)
    for tab in tabs:
        with fitz.open(tab['path']) as src:
            doc.insert_pdf(src)
    for number, page in enumerate(doc, 1):
        _stamp(page, str(number))
    doc.set_toc([[1, 'Cover Page', 1], [1, 'Index', n_cover + 1]]
                + [[1, f'Tab {t["tab"]} – {t["title"]}', s] for t, s in zip(tabs, starts)])
    output, index_output = Path(data['output']), Path(data['index_output'])
    output.parent.mkdir(parents=True, exist_ok=True)
    doc.save(output, garbage=3, deflate=True)
    index_doc = fitz.open()
    index_doc.insert_pdf(doc, from_page=n_cover, to_page=n_cover + n_index - 1)
    index_doc.save(index_output, garbage=3, deflate=True)
    index_doc.close()
    page_count = doc.page_count
    doc.close()
    return {'record': str(output), 'index': str(index_output), 'page_count': page_count,
            'tabs': [{'tab': t['tab'], 'title': t['title'], 'page': s} for t, s in zip(tabs, starts)]}


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__, file=sys.stderr)
        return 2
    try:
        result = bind(load_manifest(Path(sys.argv[1])))
    except RecordError as e:
        print(json.dumps({'success': False, 'error': e.code, 'detail': e.detail}))
        return 1
    except Exception:
        print(json.dumps({'success': False, 'error': 'unexpected_exception', 'detail': traceback.format_exc()}))
        return 1
    print(json.dumps({'success': True, **result}))
    return 0


if __name__ == '__main__':
    sys.exit(main())
