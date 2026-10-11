"""Fill a VanIAC exchange package's Word documents from the filed render.

Usage:
    python fill_vaniac.py <source-dir> <package-dir> --round opening|response|reply|non-participation --index-json <Package index.json> [--witness <name>]...

<source-dir> holds the filed render's markdown documents, written unchanged:
`Written Arguments.md`, `Evidence Index.md`, and one
`Witness Statement - <name>.md` per witness. Only the witnesses named by
--witness are filled, in name order; any other witness source in the folder
is left alone and listed as `ignored_sources`. Writes into <package-dir>:
`Written Argument of the <Side>.docx`, one `Witness Statement of <name>.docx`
per witness, and `Index.docx` (a cover page, then the package index with its
page column blank). Rewrites the package index at --index-json in place,
which /assemble's assemble-vaniac-package reads to gather exhibits and to
render the index again with its page numbers (build_index below). The
previous index's unsigned-binding directions move to
`previous_unsigned_directions`, oldest set first.

Prints one JSON line: {"success": true, "documents": [...], "index_json": ...,
"ignored_sources": [...]} or {"success": false, "error": "<code>", "detail": "..."}.
Exit 0 on success, 1 on a refusal. Never overwrites a document, and refuses
while a PDF the binder would take by name for this render sits in the
package folder: the practitioner moves the old set aside first.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import traceback
from pathlib import Path

from lxml import etree

# docx_helpers is /publish's: skills/publish/scripts.
sys.path.insert(0, str(Path(__file__).resolve().parents[3] / 'scripts'))
from docx_helpers import load_zip, rewrite_content_types_to_document, save_zip, set_run_text, wn  # noqa: E402

TEMPLATE = Path(__file__).resolve().parent.parent / 'templates' / 'vaniac-package.dotx'
ROUNDS = {'opening': 'Opening', 'response': 'Response', 'reply': 'Reply',
          'non-participation': 'Non-Participation'}
WITNESS_SOURCE = re.compile(r'^Witness Statement - (.+)\.md$')
SIDE = re.compile(r'WRITTEN ARGUMENT OF THE (CLAIMANT|RESPONDENT)')
NUMBERED = re.compile(r'^(\d+)\.\s+(.*)$')
EXHIBIT_NO = re.compile(r'^Ex\.\s*(\d+)$')
SEPARATOR_CELL = re.compile(r'^:?-{3,}:?$')
INLINE = re.compile(r'(\*\*[^*]+\*\*|\*[^*\s][^*]*\*)')
# Lines the filed face never carries. Meeting one means the render changed
# shape, so the fill stops rather than print it into an exchanged document.
REFUSED_PREFIXES = ('<', '---', '~~', '# ', '####', '![', '* ', '+ ')


class FillError(Exception):
    def __init__(self, code: str, detail: str):
        self.code = code
        self.detail = detail
        super().__init__(f'{code}: {detail}')


# ---------------------------------------------------------------------------
# The filed-face grammar
# ---------------------------------------------------------------------------

def _cells(line: str) -> list[str]:
    return [c.strip() for c in line.strip().strip('|').split('|')]


def parse(text: str, name: str) -> list[tuple]:
    """Blocks: ('table', header, rows), ('heading', text), ('para', [lines]),
    ('quote', [lines]), ('cite', text), ('bullet', text), ('line', text)."""
    blocks: list[tuple] = []
    para: list[str] | None = None
    fence: list[str] | None = None
    table: list[list[str]] | None = None

    def close():
        nonlocal para, table
        if para is not None:
            blocks.append(('para', para))
            para = None
        if table is not None:
            header, *rest = table
            blocks.append(('table', header, [r for r in rest if not all(SEPARATOR_CELL.match(c) for c in r)]))
            table = None

    for n, raw in enumerate(text.splitlines(), 1):
        line = raw.rstrip()
        stripped = line.strip()
        if fence is not None:
            if stripped.startswith('```'):
                blocks.append(('quote', fence))
                fence = None
            else:
                fence.append(stripped)
            continue
        if not stripped:
            close()
            continue
        if stripped.startswith('|'):
            if para is not None:
                close()
            table = (table or []) + [_cells(line)]
            continue
        if table is not None:
            close()
        if stripped.startswith('```'):
            close()
            fence = []
        elif stripped.startswith('> '):
            close()
            blocks.append(('cite', stripped[2:]))
        elif line.startswith(('## ', '### ')):
            close()
            blocks.append(('heading', line.lstrip('#').strip()))
        elif stripped.startswith(REFUSED_PREFIXES):
            raise FillError('out_of_grammar', f'{name} line {n}: {line!r}')
        elif NUMBERED.match(line):
            close()
            para = [line]
        elif line[0].isspace():
            if para is None:
                raise FillError('out_of_grammar', f'{name} line {n}: indented text outside a paragraph: {line!r}')
            para.append(stripped)
        elif line.startswith('- '):
            close()
            blocks.append(('bullet', line[2:]))
        else:
            close()
            blocks.append(('line', line))
    if fence is not None:
        raise FillError('out_of_grammar', f'{name}: a quotation fence is never closed')
    close()
    return blocks


def split_caption(blocks: list[tuple], name: str) -> tuple[list[list[str]], list[tuple]]:
    """The caption is a leading three-column table with an empty header row."""
    if not blocks or blocks[0][0] != 'table' or len(blocks[0][1]) != 3 or any(blocks[0][1]):
        raise FillError('caption_missing', f'{name} does not open with its caption table')
    rows = blocks[0][2]
    for row in rows:
        if len(row) != 3:
            raise FillError('out_of_grammar', f'{name}: caption row {row!r} is not three cells')
    for block in blocks[1:]:
        if block[0] == 'table':
            raise FillError('out_of_grammar', f'{name}: a table after the caption')
    return rows, blocks[1:]


def parse_exhibits(text: str) -> list[dict]:
    blocks = parse(text, 'Evidence Index.md')
    tables = [b for b in blocks if b[0] == 'table']
    others = [b for b in blocks if b[0] != 'table']
    if others or len(tables) > 1:
        raise FillError('out_of_grammar', 'Evidence Index.md holds more than its one table')
    if not tables:
        return []
    header, rows = tables[0][1], tables[0][2]
    if header[:3] != ['Ex.', 'Date', 'Description']:
        raise FillError('out_of_grammar', f'Evidence Index.md header is {header!r}')
    exhibits = []
    for row in rows:
        match = EXHIBIT_NO.match(row[0])
        if not match:
            raise FillError('out_of_grammar', f'Evidence Index.md row {row!r} has no exhibit number')
        exhibits.append({'number': int(match.group(1)), 'date': row[1], 'description': row[2]})
    return exhibits


# ---------------------------------------------------------------------------
# Word output
# ---------------------------------------------------------------------------

def _runs(parent: etree._Element, text: str, bold: bool = False) -> None:
    for piece in INLINE.split(text):
        if not piece:
            continue
        run = etree.SubElement(parent, wn('r'))
        b, i = bold, False
        if piece.startswith('**') and piece.endswith('**') and len(piece) > 4:
            piece, b = piece[2:-2], True
        elif piece.startswith('*') and piece.endswith('*') and len(piece) > 2:
            piece, i = piece[1:-1], True
        if b or i:
            rpr = etree.SubElement(run, wn('rPr'))
            if b:
                etree.SubElement(rpr, wn('b'))
            if i:
                etree.SubElement(rpr, wn('i'))
        set_run_text(run, piece)


def _para(style: str | None, text: str = '', jc: str | None = None, bold: bool = False) -> etree._Element:
    p = etree.Element(wn('p'))
    if style or jc:
        ppr = etree.SubElement(p, wn('pPr'))
        if style:
            etree.SubElement(ppr, wn('pStyle')).set(wn('val'), style)
        if jc:
            etree.SubElement(ppr, wn('jc')).set(wn('val'), jc)
    _runs(p, text, bold)
    return p


def _break_line(p: etree._Element) -> None:
    etree.SubElement(etree.SubElement(p, wn('r')), wn('br'))


def _page_break() -> etree._Element:
    p = etree.Element(wn('p'))
    etree.SubElement(etree.SubElement(p, wn('r')), wn('br')).set(wn('type'), 'page')
    return p


def _table(rows: list[list[str]], widths: list[int], jcs: list[str], borders: bool,
           style: str | None, bold_rows: set[int] = frozenset()) -> etree._Element:
    tbl = etree.Element(wn('tbl'))
    tblpr = etree.SubElement(tbl, wn('tblPr'))
    etree.SubElement(tblpr, wn('tblW')).attrib.update({wn('w'): str(sum(widths)), wn('type'): 'dxa'})
    edges = etree.SubElement(tblpr, wn('tblBorders'))
    for edge in ('top', 'left', 'bottom', 'right', 'insideH', 'insideV'):
        etree.SubElement(edges, wn(edge)).attrib.update(
            {wn('val'): 'single' if borders else 'nil', wn('sz'): '4', wn('space'): '0', wn('color'): 'auto'})
    grid = etree.SubElement(tbl, wn('tblGrid'))
    for w in widths:
        etree.SubElement(grid, wn('gridCol')).set(wn('w'), str(w))
    for k, row in enumerate(rows):
        tr = etree.SubElement(tbl, wn('tr'))
        for text, w, jc in zip(row, widths, jcs):
            tc = etree.SubElement(tr, wn('tc'))
            etree.SubElement(etree.SubElement(tc, wn('tcPr')), wn('tcW')).attrib.update({wn('w'): str(w), wn('type'): 'dxa'})
            tc.append(_para(style, text, jc, bold=k in bold_rows))
    return tbl


def _caption(rows: list[list[str]]) -> etree._Element:
    return _table(rows, [2340, 4680, 2340], ['left', 'center', 'right'], False, 'VCaption')


def _body_elements(blocks: list[tuple]) -> list[etree._Element]:
    out = []
    for kind, *rest in blocks:
        if kind == 'heading':
            out.append(_para('VHeading', rest[0]))
        elif kind == 'para':
            first, *more = rest[0]
            number, text = NUMBERED.match(first).groups()
            p = _para('VPara', f'{number}.')
            etree.SubElement(etree.SubElement(p, wn('r')), wn('tab'))
            _runs(p, text)
            for line in more:
                _break_line(p)
                _runs(p, line)
            out.append(p)
        elif kind == 'quote':
            for line in rest[0]:
                p = _para('VQuote')
                run = etree.SubElement(p, wn('r'))
                set_run_text(run, line)
                out.append(p)
        elif kind == 'cite':
            out.append(_para('VCite', rest[0]))
        elif kind == 'bullet':
            p = _para('VBullet', '•')
            etree.SubElement(etree.SubElement(p, wn('r')), wn('tab'))
            _runs(p, rest[0])
            out.append(p)
        else:
            out.append(_para(None, rest[0]))
    return out


def _write(elements: list[etree._Element], out_path: Path) -> None:
    members = load_zip(TEMPLATE)
    root = etree.fromstring(members['word/document.xml'])
    body = root.find(wn('body'))
    sect = body.find(wn('sectPr'))
    for el in elements:
        sect.addprevious(el)
    members['word/document.xml'] = etree.tostring(root, xml_declaration=True, encoding='UTF-8', standalone=True)
    rewrite_content_types_to_document(members)
    save_zip(members, out_path)


# ---------------------------------------------------------------------------
# The package index
# ---------------------------------------------------------------------------

def expert_names(package_dir: Path) -> list[str]:
    return sorted(p.name[len('Expert Report of '):-len('.pdf')]
                  for p in package_dir.glob('Expert Report of *.pdf'))


def index_rows(data: dict) -> list[dict]:
    """The index rows in binding order. `part` is the row's part number in the
    bound PDF (written argument, witnesses, experts, exhibits), or None for a
    section heading."""
    rows = [{'no': '', 'document': f'Written Argument of the {data["side"]}', 'date': '', 'part': 0}]
    part = 1
    sections = [('Witness Statements', [('', f'Witness Statement of {w}', '') for w in data['witnesses']]),
                ('Expert Reports', [('', f'Expert Report of {e}', '') for e in data.get('experts', [])]),
                ('Exhibits', [(f'Ex. {x["number"]}', x['description'], x['date']) for x in data['exhibits']])]
    for heading, entries in sections:
        if not entries:
            continue
        rows.append({'no': '', 'document': heading, 'date': '', 'part': None})
        for no, document, date in entries:
            rows.append({'no': no, 'document': document, 'date': date, 'part': part})
            part += 1
    return rows


def round_title(data: dict) -> str:
    return f"{data['side']}'s {ROUNDS[data['round']]} Submissions"


def build_index(data: dict, out_path: Path, pages: list[str] | None = None,
                cover: bool = True, index: bool = True) -> Path:
    """Index.docx: the cover page, then the index. `pages` fills the page
    column, one cell per index_rows() row; None leaves it blank. The binder
    renders the cover and the index as separate documents (cover or index
    False) so it can count each one's pages."""
    rows = index_rows(data)
    pages = pages or [''] * len(rows)
    elements: list[etree._Element] = []
    if cover:
        caption = [r for r in data['caption'] if not SIDE.search(''.join(r))]
        elements.append(_caption(caption))
        elements.append(_para('VTitle', round_title(data).upper()))
    if cover and index:
        elements.append(_page_break())
    if index:
        elements.append(_para('VTitle', 'INDEX'))
        table = [['No.', 'Document', 'Date', 'Page']]
        bold = {0}
        for k, (row, page) in enumerate(zip(rows, pages), 1):
            table.append([row['no'], row['document'], row['date'], page])
            if row['part'] is None:
                bold.add(k)
        elements.append(_table(table, [1000, 5360, 1900, 1100], ['left', 'left', 'left', 'right'],
                               True, 'VIndexCell', bold))
    _write(elements, out_path)
    return out_path


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def _read(path: Path) -> str:
    if not path.is_file():
        raise FillError('missing_source', f'{path.name} is not in {path.parent}')
    return path.read_text(encoding='utf-8')


def fill(source_dir: Path, package_dir: Path, round_key: str, index_json: Path, witness_names: list[str]) -> dict:
    if round_key not in ROUNDS:
        raise FillError('bad_round', f'--round must be one of {sorted(ROUNDS)}')
    wa_caption, wa_body = split_caption(parse(_read(source_dir / 'Written Arguments.md'), 'Written Arguments.md'),
                                        'Written Arguments.md')
    side_match = SIDE.search(' '.join(''.join(r) for r in wa_caption))
    if not side_match:
        raise FillError('side_not_found', 'the written argument caption has no "WRITTEN ARGUMENT OF THE '
                                          'CLAIMANT|RESPONDENT" line')
    side = side_match.group(1).title()
    exhibits = parse_exhibits(_read(source_dir / 'Evidence Index.md'))

    witnesses = {}
    for name in sorted(set(witness_names)):
        path = source_dir / f'Witness Statement - {name}.md'
        witnesses[name] = split_caption(parse(_read(path), path.name), path.name)
    ignored = sorted(p.name for p in source_dir.glob('Witness Statement - *.md')
                     if WITNESS_SOURCE.match(p.name).group(1) not in witnesses)

    previous = []
    if index_json.exists():
        try:
            old = json.loads(index_json.read_text(encoding='utf-8'))
        except ValueError:
            raise FillError('index_unreadable', f'{index_json.name} is not valid JSON') from None
        previous = old.get('previous_unsigned_directions', [])
        if old.get('unsigned_directions'):
            previous = previous + [old['unsigned_directions']]
    data = {'side': side, 'round': round_key, 'caption': wa_caption, 'witnesses': list(witnesses),
            'exhibits': exhibits, 'experts': expert_names(package_dir) if package_dir.is_dir() else [],
            'unsigned_directions': {}, 'previous_unsigned_directions': previous}
    outputs = [(package_dir / f'Written Argument of the {side}.docx', wa_caption, wa_body)]
    outputs += [(package_dir / f'Witness Statement of {name}.docx', cap, body)
                for name, (cap, body) in witnesses.items()]
    index_docx = package_dir / 'Index.docx'
    # The binder takes these by exact name in place of the rendered .docx files.
    bound_pdfs = [package_dir / f'Written Argument of the {side}.pdf']
    bound_pdfs += [package_dir / f'Witness Statement of {name} - signed.pdf' for name in witnesses]
    existing = [p.name for p in [o[0] for o in outputs] + [index_docx] + bound_pdfs if p.exists()]
    if existing:
        raise FillError('output_exists', f'not overwriting: {existing}')

    for out_path, caption, body in outputs:
        _write([_caption(caption)] + _body_elements(body), out_path)
    build_index(data, index_docx)
    index_json.write_text(json.dumps(data, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    return {'success': True, 'documents': [str(o[0]) for o in outputs] + [str(index_docx)],
            'index_json': str(index_json), 'ignored_sources': ignored}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('source_dir', type=Path)
    parser.add_argument('package_dir', type=Path)
    parser.add_argument('--round', required=True)
    parser.add_argument('--index-json', type=Path, required=True)
    parser.add_argument('--witness', action='append', default=[])
    args = parser.parse_args()
    try:
        result = fill(args.source_dir, args.package_dir, args.round, args.index_json, args.witness)
    except FillError as e:
        print(json.dumps({'success': False, 'error': e.code, 'detail': e.detail}))
        return 1
    except Exception as e:  # a defect, reported as one JSON line rather than a traceback
        print(json.dumps({'success': False, 'error': 'internal_error', 'detail': f'{e!r}',
                          'trace': traceback.format_exc()}))
        return 1
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    sys.exit(main())
