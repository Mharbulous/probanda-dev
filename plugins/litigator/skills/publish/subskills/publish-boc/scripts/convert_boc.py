"""Convert a filled BOC .docx (assessment format) to a bracket-placeholder 062-boc.dotx template.

Source document format: BC Supreme Court Bill of Costs (registrar assessment form), with
Claimed/Allowed columns throughout.  Reference document: April 15 BOC (BOC Jir S.docx).

Usage:
    python scripts/convert_boc.py <raw_boc.docx> templates/062-boc.dotx

Structure handled:
  - Header paragraphs: court file, registry, parties, costs details
  - TARIFF ITEMS table (item rows + summary rows)
  - Notes paragraphs (collapsed to [NOTES])
  - Disbursement tables by category (FILING FEES, TRANSCRIPTS, EXPERT FEES,
    PHOTOCOPYING / PRINTING, SEARCH FEES, TRAVEL, OTHER DISBURSEMENTS)
  - SUMMARY OF DISBURSEMENTS table
  - TOTAL BILL OF COSTS table
  - Footer (date line + Signature of Assessing Officer)

Programmatic scalars (filled by generate script from /case-data + lawyer input):
    [COURT FILE NUMBER], [REGISTRY], [ORIGINATING PARTY], [ORIGINATING PARTY ROLE],
    [RESPONDING PARTY], [RESPONDING PARTY ROLE], [PARTY CLAIMING COSTS],
    [COSTS SCALE], [UNIT VALUE], [COSTS ORDER], [COSTS TERMS]

Leave-blank (lawyer fills table content in Word before the assessment hearing):
    All table content -- see verify.py LEAVE_BLANK for complete list.
"""
from __future__ import annotations

import sys
import zipfile
from pathlib import Path

from lxml import etree

NS = {
    'w':  'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
    'mc': 'http://schemas.openxmlformats.org/markup-compatibility/2006',
}

def W(t: str) -> str:
    return f"{{{NS['w']}}}{t}"

XMLSPACE = '{http://www.w3.org/XML/1998/namespace}space'

DISB_HEADERS = {
    'FILING FEES', 'TRANSCRIPTS', 'EXPERT FEES',
    'PHOTOCOPYING / PRINTING', 'SEARCH FEES', 'TRAVEL', 'OTHER DISBURSEMENTS',
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def para_text(el: etree._Element) -> str:
    return ''.join(t.text or '' for t in el.iter(W('t')))


def set_para_text(para: etree._Element, new_text: str) -> None:
    """Replace all runs in a paragraph with a single run, preserving pPr."""
    for r in list(para.findall(W('r'))):
        para.remove(r)
    r = etree.SubElement(para, W('r'))
    t_el = etree.SubElement(r, W('t'))
    t_el.text = new_text
    if new_text != new_text.strip():
        t_el.set(XMLSPACE, 'preserve')


def set_cell_text(cell: etree._Element, new_text: str) -> None:
    """Replace first paragraph of a table cell; remove extra paragraphs."""
    paras = list(cell.findall(W('p')))
    if not paras:
        return
    para = paras[0]
    for r in list(para.findall(W('r'))):
        para.remove(r)
    r = etree.SubElement(para, W('r'))
    t_el = etree.SubElement(r, W('t'))
    t_el.text = new_text
    if new_text != new_text.strip():
        t_el.set(XMLSPACE, 'preserve')
    for extra in paras[1:]:
        cell.remove(extra)


def delete_rows(table: etree._Element, indices: list[int]) -> None:
    rows = list(table.findall(W('tr')))
    for i in sorted(indices, reverse=True):
        table.remove(rows[i])


def tbl_type(tbl: etree._Element) -> str:
    """Classify a table by its first-row content."""
    rows = list(tbl.findall(W('tr')))
    if not rows:
        return 'unknown'
    first_cells = rows[0].findall(W('tc'))
    c0 = para_text(first_cells[0]).strip() if first_cells else ''
    c1 = para_text(first_cells[1]).strip() if len(first_cells) > 1 else ''
    if c0 == 'TARIFF ITEMS':
        return 'tariff'
    if c0 in DISB_HEADERS:
        return 'disbursement'
    if c0 == 'Category':
        return 'summary'
    if c0 == '' and c1 == 'Claimed':
        return 'total'
    return 'unknown'


def sanitize_mc_ignorable(root: etree._Element) -> None:
    """Drop prefixes from mc:Ignorable that are not declared in scope (T13)."""
    mc_ignorable = f"{{{NS['mc']}}}Ignorable"
    for el in root.iter():
        val = el.get(mc_ignorable)
        if not val:
            continue
        declared: set[str] = set()
        for p in el.nsmap:
            if p:
                declared.add(p)
        anc = el.getparent()
        while anc is not None:
            for p in anc.nsmap:
                if p:
                    declared.add(p)
            anc = anc.getparent()
        kept = [p for p in val.split() if p in declared]
        el.set(mc_ignorable, ' '.join(kept))


def ensure_template_content_type(members: dict[str, bytes]) -> bool:
    ct_key = '[Content_Types].xml'
    ct = members[ct_key].decode('utf-8')
    doc_ct = ('application/vnd.openxmlformats-officedocument'
              '.wordprocessingml.document.main+xml')
    tmpl_ct = ('application/vnd.openxmlformats-officedocument'
               '.wordprocessingml.template.main+xml')
    if doc_ct in ct:
        members[ct_key] = ct.replace(doc_ct, tmpl_ct).encode('utf-8')
        return True
    return False


# ---------------------------------------------------------------------------
# Section processors
# ---------------------------------------------------------------------------

def process_header(body: etree._Element) -> None:
    """Replace case-specific values in header paragraphs (before first table)."""
    # State machine: initial → after_between → after_originating → before_and
    #                → after_and → after_responding → costs
    state = 'initial'

    for child in body:
        if child.tag == W('tbl'):
            break
        if child.tag != W('p'):
            continue

        txt = para_text(child).strip()

        if state == 'initial':
            if txt.startswith('No. '):
                set_para_text(child, 'No. [COURT FILE NUMBER]')
            elif txt.endswith('Registry') and txt != 'Registry':
                set_para_text(child, '[REGISTRY] Registry')
            elif txt == 'BETWEEN':
                state = 'after_between'

        elif state == 'after_between':
            if txt:
                set_para_text(child, '[ORIGINATING PARTY]')
                state = 'after_originating'

        elif state == 'after_originating':
            if txt == 'AND':
                state = 'after_and'
            elif txt:
                set_para_text(child, '[ORIGINATING PARTY ROLE]')
                state = 'before_and'

        elif state == 'before_and':
            if txt == 'AND':
                state = 'after_and'

        elif state == 'after_and':
            if txt:
                set_para_text(child, '[RESPONDING PARTY]')
                state = 'after_responding'

        elif state == 'after_responding':
            if txt and txt != 'BILL OF COSTS':
                set_para_text(child, '[RESPONDING PARTY ROLE]')
                state = 'costs'
            elif txt == 'BILL OF COSTS':
                state = 'costs'

        elif state == 'costs':
            if txt.startswith('This is the bill of costs of:'):
                set_para_text(child, 'This is the bill of costs of: [PARTY CLAIMING COSTS]')
            elif txt.startswith('Tariff scale:'):
                set_para_text(child, 'Tariff scale: [COSTS SCALE]')
            elif txt.startswith('Unit value:'):
                set_para_text(child, 'Unit value: [UNIT VALUE]')
            elif txt.startswith('Costs awarded by:'):
                set_para_text(child, 'Costs awarded by: [COSTS ORDER]')
            elif txt and txt[0] in ('\u201c', '"', '\u2018', '\u201e'):
                set_para_text(child, '[COSTS TERMS]')


def process_tariff(tbl: etree._Element) -> None:
    """Collapse data rows to one example row; template summary rows."""
    rows = list(tbl.findall(W('tr')))
    # rows[0]: merged 'TARIFF ITEMS' header
    # rows[1]: column headers (Item #, Description, # Units Claimed, # Units Allowed)
    # rows[2..summary_start-1]: item data rows  → collapse to 1 example
    # rows[summary_start..]: summary rows (Total units, Multiply, Sched.1, Subtotal, Taxes, Total)

    # Find where summary rows start: first row where cell[0] is empty and cell[1] starts with 'Total'
    summary_start = len(rows)  # default: no summary rows found
    for i in range(2, len(rows)):
        cells = rows[i].findall(W('tc'))
        if not cells:
            continue
        c0 = para_text(cells[0]).strip()
        c1 = para_text(cells[1]).strip() if len(cells) > 1 else ''
        if c0 == '' and c1.startswith('Total'):
            summary_start = i
            break

    # Collapse data rows to 1: keep rows[2], delete rows[3..summary_start-1]
    if summary_start > 3:
        delete_rows(tbl, list(range(3, summary_start)))

    # Template the example data row (now at index 2)
    rows = list(tbl.findall(W('tr')))
    example_cells = rows[2].findall(W('tc'))
    set_cell_text(example_cells[0], '[ITEM NO.]')
    set_cell_text(example_cells[1], '[ITEM DESCRIPTION]')
    set_cell_text(example_cells[2], '[UNITS CLAIMED]')
    set_cell_text(example_cells[3], '[UNITS ALLOWED]')

    # Template summary rows (now starting at index 3)
    for row in rows[3:]:
        cells = row.findall(W('tc'))
        if not cells:
            continue
        c0 = para_text(cells[0]).strip()
        c1 = para_text(cells[1]).strip() if len(cells) > 1 else ''

        if c1.startswith('Total number of units:'):
            set_cell_text(cells[2], '[TOTAL UNITS CLAIMED]')
            set_cell_text(cells[3], '[TOTAL UNITS ALLOWED]')
        elif c1.startswith('Multiply by unit value:'):
            set_cell_text(cells[2], '[FEES UNITS SUBTOTAL CLAIMED]')
            set_cell_text(cells[3], '[FEES UNITS SUBTOTAL ALLOWED]')
        elif c0.startswith('Sched') or (c0 and not c1.startswith(('Sub total', 'Applicable', 'Total:'))):
            # Schedule 1 / additional item row
            set_cell_text(cells[0], '[SCHED1 NO.]')
            set_cell_text(cells[1], '[SCHED1 DESCRIPTION]')
            set_cell_text(cells[2], '[SCHED1 CLAIMED]')
            set_cell_text(cells[3], '[SCHED1 ALLOWED]')
        elif c1.startswith('Sub total:'):
            set_cell_text(cells[2], '[FEES SUBTOTAL CLAIMED]')
            set_cell_text(cells[3], '[FEES SUBTOTAL ALLOWED]')
        elif c1.startswith('Applicable taxes:'):
            set_cell_text(cells[2], '[FEES TAXES CLAIMED]')
            set_cell_text(cells[3], '[FEES TAXES ALLOWED]')
        elif c1.startswith('Total:'):
            set_cell_text(cells[2], '[FEES TOTAL CLAIMED]')
            set_cell_text(cells[3], '[FEES TOTAL ALLOWED]')

    n_deleted = summary_start - 3 if summary_start > 3 else 0
    print(f'  TARIFF: collapsed {n_deleted} extra data rows; templated summary rows')


def process_disbursement(tbl: etree._Element) -> None:
    """Collapse data rows to one example row; template subtotal row."""
    rows = list(tbl.findall(W('tr')))
    hdr = para_text(rows[0]).strip()

    # rows[0]: category header (merged)
    # rows[1]: column headers (Date, Description, Amount, GST, Claimed, Allowed)
    # rows[2..N-2]: data rows → collapse to 1 example
    # rows[N-1]: subtotal row

    if len(rows) < 4:
        print(f'  WARN: {hdr} table has only {len(rows)} rows — skipping', file=sys.stderr)
        return

    # Collapse data rows: keep rows[2], delete rows[3..N-2]
    if len(rows) > 4:
        delete_rows(tbl, list(range(3, len(rows) - 1)))

    rows = list(tbl.findall(W('tr')))
    example_cells = rows[2].findall(W('tc'))
    set_cell_text(example_cells[0], '[DISB DATE]')
    set_cell_text(example_cells[1], '[DISB DESCRIPTION]')
    set_cell_text(example_cells[2], '[DISB AMOUNT]')
    set_cell_text(example_cells[3], '[DISB GST]')
    set_cell_text(example_cells[4], '[DISB CLAIMED]')
    set_cell_text(example_cells[5], '[DISB ALLOWED]')

    # Template subtotal row: keep label cells (0-3), replace value cells (4-5)
    subtotal_cells = rows[-1].findall(W('tc'))
    set_cell_text(subtotal_cells[4], '[DISB SUBTOTAL CLAIMED]')
    set_cell_text(subtotal_cells[5], '[DISB SUBTOTAL ALLOWED]')

    print(f'  {hdr}: templated')


def process_summary(tbl: etree._Element) -> None:
    """Template value cells in SUMMARY OF DISBURSEMENTS table."""
    rows = list(tbl.findall(W('tr')))
    # rows[0]: column headers (Category, Claimed, Allowed) — keep
    # rows[1..N-4]: category rows — keep category name, replace value cells
    # rows[N-3]: Sub total row
    # rows[N-2]: Applicable taxes row
    # rows[N-1]: Total row

    for row in rows[1:]:
        cells = row.findall(W('tc'))
        if len(cells) < 3:
            continue
        c0 = para_text(cells[0]).strip()
        if c0.startswith('Sub total:'):
            set_cell_text(cells[1], '[SUMMARY SUBTOTAL CLAIMED]')
            set_cell_text(cells[2], '[SUMMARY SUBTOTAL ALLOWED]')
        elif c0.startswith('Applicable taxes:'):
            set_cell_text(cells[1], '[SUMMARY TAXES CLAIMED]')
            set_cell_text(cells[2], '[SUMMARY TAXES ALLOWED]')
        elif c0.startswith('Total:'):
            set_cell_text(cells[1], '[SUMMARY TOTAL CLAIMED]')
            set_cell_text(cells[2], '[SUMMARY TOTAL ALLOWED]')
        else:
            set_cell_text(cells[1], '[SUMMARY CLAIMED]')
            set_cell_text(cells[2], '[SUMMARY ALLOWED]')

    print('  SUMMARY: templated')


def process_total(tbl: etree._Element) -> None:
    """Template value cells in TOTAL BILL OF COSTS table."""
    rows = list(tbl.findall(W('tr')))
    # rows[0]: column headers ('', Claimed, Allowed) — keep
    # rows[1..]: value rows — keep label (col 0), replace cols 1-2

    for row in rows[1:]:
        cells = row.findall(W('tc'))
        if len(cells) >= 3:
            set_cell_text(cells[1], '[BOC TOTAL CLAIMED]')
            set_cell_text(cells[2], '[BOC TOTAL ALLOWED]')

    print('  TOTAL BILL OF COSTS: templated')


def strip_table_shading(body: etree._Element) -> None:
    """Remove all background shading from tables (direct w:shd + banded-row style formatting)."""
    n = 0
    for tbl in body.iter(W('tbl')):
        for tblPr in tbl.findall(W('tblPr')):
            for shd in tblPr.findall(W('shd')):
                tblPr.remove(shd)
                n += 1
            tblLook = tblPr.find(W('tblLook'))
            if tblLook is None:
                tblLook = etree.SubElement(tblPr, W('tblLook'))
            tblLook.set(W('noHBand'), '1')
            tblLook.set(W('noVBand'), '1')
        for tr in tbl.findall(W('tr')):
            for trPr in tr.findall(W('trPr')):
                for shd in trPr.findall(W('shd')):
                    trPr.remove(shd)
                    n += 1
            for tc in tr.findall(W('tc')):
                for tcPr in tc.findall(W('tcPr')):
                    for shd in tcPr.findall(W('shd')):
                        tcPr.remove(shd)
                        n += 1
    print(f'  Shading: removed {n} w:shd element(s); disabled banded-row formatting')


def process_notes(body: etree._Element) -> None:
    """Collapse note body paragraphs after 'Notes:' to [NOTES]; replace KRLB note."""
    children = list(body)

    # Find 'Notes:' heading
    notes_idx = None
    for i, child in enumerate(children):
        if child.tag == W('p') and para_text(child).strip() == 'Notes:':
            notes_idx = i
            break

    if notes_idx is not None:
        # Collect non-empty note body paragraphs (up to the next table)
        note_body: list[etree._Element] = []
        for child in children[notes_idx + 1:]:
            if child.tag == W('tbl'):
                break
            if child.tag == W('p') and para_text(child).strip():
                note_body.append(child)

        if note_body:
            set_para_text(note_body[0], '[NOTES]')
            for p in note_body[1:]:
                body.remove(p)
            print(f'  Notes: collapsed {len(note_body)} paragraph(s) to [NOTES]')

    # Replace KRLB footer note
    for child in children:
        if child.tag == W('p') and para_text(child).strip().startswith('Items marked'):
            set_para_text(child, '[NOTES FOOTER]')
            print('  NOTES FOOTER: replaced KRLB note')
            break


# ---------------------------------------------------------------------------
# Main conversion
# ---------------------------------------------------------------------------

def convert(src: Path, dst: Path) -> None:
    with zipfile.ZipFile(src) as zin:
        members = {n: zin.read(n) for n in zin.namelist()}

    root = etree.fromstring(members['word/document.xml'])
    body = root.find(W('body'))
    tables = list(body.findall(W('tbl')))

    if len(tables) < 10:
        print(
            f'WARNING: expected 10 tables (1 tariff + 7 disbursement + 1 summary + 1 total), '
            f'found {len(tables)}',
            file=sys.stderr,
        )

    # Step 1: Header paragraphs
    process_header(body)
    print('  Header: programmatic scalars inserted')

    # Step 2: Tables
    for tbl in tables:
        tt = tbl_type(tbl)
        if tt == 'tariff':
            process_tariff(tbl)
        elif tt == 'disbursement':
            process_disbursement(tbl)
        elif tt == 'summary':
            process_summary(tbl)
        elif tt == 'total':
            process_total(tbl)
        else:
            rows = list(tbl.findall(W('tr')))
            hdr = para_text(rows[0]).strip()[:40] if rows else '(empty)'
            print(f'  WARN: unrecognised table header {hdr!r} — left unchanged', file=sys.stderr)

    # Step 3: Notes and KRLB
    process_notes(body)

    # Step 4: Strip all table shading
    strip_table_shading(body)

    # Step 5: Sanitize and write
    sanitize_mc_ignorable(root)
    members['word/document.xml'] = etree.tostring(
        root, xml_declaration=True, encoding='UTF-8', standalone=True)

    ct_changed = ensure_template_content_type(members)

    dst.parent.mkdir(parents=True, exist_ok=True)
    if dst.exists():
        dst.unlink()
    with zipfile.ZipFile(dst, 'w', zipfile.ZIP_DEFLATED) as zout:
        for name, data in members.items():
            zout.writestr(name, data)

    print(f'Wrote {dst}')
    if ct_changed:
        print('  content type set to template (.dotx)')
    print(f'  source size: {src.stat().st_size:,} bytes')
    print(f'  output size: {dst.stat().st_size:,} bytes')


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__)
        return 2
    convert(Path(sys.argv[1]), Path(sys.argv[2]))
    return 0


if __name__ == '__main__':
    sys.exit(main())
