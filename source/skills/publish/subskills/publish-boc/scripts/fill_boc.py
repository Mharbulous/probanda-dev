"""Fill templates/062-boc.dotx with Bill of Costs data.

Usage:
    python fill_boc.py --context /tmp/boc_context.json --out-dir "matter/0. DRAFT" --out-name STEM

--out-dir is the matter's draft folder, an existing folder the bill is written
to at its root; it is never created. --out-name is the bill's file name stem,
composed by the caller under the firm's file naming convention. A stem that is
empty, carries \\ / : * ? " < > |, ends in a file extension or ends in " v<n>"
is refused, as is an --out-dir that is not a folder: `error: <code>: ...` on
stderr, exit 1, nothing written.

An existing bill is never overwritten. `<stem>.docx` counts as v1 and
`<stem> vN.docx` as vN: with none present the unsuffixed name is written, else
v(highest + 1), and a `Versioned from:` line names the highest existing copy.
The `Written:` line names the path used. The bill is filled into a `~`-prefixed
temporary file in the same folder and then renamed, so a killed fill leaves no
partial bill.

Context JSON schema: see publish-boc/references/boc-context.md.

Key behaviours:
  - Scalar placeholders are replaced by substring match (they are embedded in
    longer run text, e.g. "No. [COURT FILE NUMBER]").
  - The single tariff item template row is duplicated for each item in
    ctx["tariff_items"]. Allowed column left blank throughout.
  - Empty disbursement categories are collapsed: the header + column-label +
    data + subtotal rows are replaced with the title row + one "N/A" row.
  - No styling changes — cell shading, borders, fonts are untouched.
  - Output is a .docx (Content-Type rewritten from .dotx).

Requires: lxml  (pip install lxml)
"""
from __future__ import annotations
import argparse
import copy
import json
import sys
import zipfile
from pathlib import Path

from lxml import etree

from free_path import check_target, write_new

HERE      = Path(__file__).resolve().parent          # scripts/
SKILL_DIR = HERE.parent                               # publish-boc/
TEMPLATE  = SKILL_DIR / 'templates' / '062-boc.dotx'

W        = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
XML_SPC  = '{http://www.w3.org/XML/1998/namespace}space'

def WN(tag: str) -> str:
    return f'{{{W}}}{tag}'


# ---------------------------------------------------------------------------
# Low-level helpers
# ---------------------------------------------------------------------------

def para_text(el: etree._Element) -> str:
    return ''.join(t.text or '' for t in el.iter(WN('t')))


def set_cell_text(tc: etree._Element, text: str) -> None:
    """Replace text content of first paragraph in a table cell."""
    for para in tc.findall(WN('p')):
        for r in para.findall(WN('r')):
            para.remove(r)
        r = etree.SubElement(para, WN('r'))
        t = etree.SubElement(r, WN('t'))
        t.text = text
        if text and text != text.strip():
            t.set(XML_SPC, 'preserve')
        break


def clear_cell(tc: etree._Element) -> None:
    set_cell_text(tc, '')


def substitute_scalars(body: etree._Element, subs: dict[str, str]) -> int:
    """Substring-replace scalar placeholders in all <w:t> elements."""
    hits = 0
    for t_el in body.iter(WN('t')):
        txt = t_el.text or ''
        new = txt
        for ph, val in subs.items():
            if ph in new:
                new = new.replace(ph, val)
        if new != txt:
            t_el.text = new
            if new and new != new.strip():
                t_el.set(XML_SPC, 'preserve')
            hits += 1
    return hits


# ---------------------------------------------------------------------------
# Tariff table (Table 0)
# ---------------------------------------------------------------------------

def fill_tariff_table(tbl: etree._Element, ctx: dict) -> None:
    rows = tbl.findall(WN('tr'))
    template_row = rows[2]   # "[ITEM NO.] | [ITEM DESCRIPTION] | [UNITS CLAIMED] | [UNITS ALLOWED]"
    insert_idx   = list(tbl).index(template_row)
    tbl.remove(template_row)

    for i, item in enumerate(ctx['tariff_items']):
        new_row = copy.deepcopy(template_row)
        cells   = new_row.findall(WN('tc'))
        set_cell_text(cells[0], item['no'])
        set_cell_text(cells[1], item['description'])
        set_cell_text(cells[2], item['units_claimed'])
        clear_cell(cells[3])   # Allowed — registrar fills
        tbl.insert(insert_idx + i, new_row)

    # Summary rows — fill Claimed, clear Allowed
    summary_map = {
        '[TOTAL UNITS CLAIMED]':        ctx.get('total_units', ''),
        '[FEES UNITS SUBTOTAL CLAIMED]': ctx.get('fees_subtotal', ''),
        '[SCHED1 NO.]':                 '',
        '[SCHED1 DESCRIPTION]':         '',
        '[SCHED1 CLAIMED]':             '',
        '[FEES SUBTOTAL CLAIMED]':       ctx.get('fees_subtotal', ''),
        '[FEES TAXES CLAIMED]':          ctx.get('fees_taxes', ''),
        '[FEES TOTAL CLAIMED]':          ctx.get('fees_total', ''),
    }
    clear_set = {
        '[TOTAL UNITS ALLOWED]', '[FEES UNITS SUBTOTAL ALLOWED]',
        '[SCHED1 ALLOWED]', '[FEES SUBTOTAL ALLOWED]',
        '[FEES TAXES ALLOWED]', '[FEES TOTAL ALLOWED]',
    }
    for row in tbl.findall(WN('tr')):
        for tc in row.findall(WN('tc')):
            txt = para_text(tc).strip()
            if txt in summary_map:
                set_cell_text(tc, summary_map[txt])
            elif txt in clear_set:
                clear_cell(tc)


# ---------------------------------------------------------------------------
# Disbursement tables (Tables 1–7) with N/A collapse
# ---------------------------------------------------------------------------

DISB_CATEGORY_ORDER = [
    'filing_fees', 'transcripts', 'expert_fees',
    'photocopying', 'search_fees', 'travel', 'other',
]

DISB_PLACEHOLDER_CELLS = {
    '[DISB DATE]', '[DISB DESCRIPTION]', '[DISB AMOUNT]',
    '[DISB GST]', '[DISB CLAIMED]', '[DISB ALLOWED]',
    '[DISB SUBTOTAL CLAIMED]', '[DISB SUBTOTAL ALLOWED]',
}


def _make_na_row(template_row: etree._Element) -> etree._Element:
    """Return a single-cell spanning row containing 'N/A', styled like template_row."""
    # Clone first cell from the header row as a base for formatting
    new_row = copy.deepcopy(template_row)
    cells   = new_row.findall(WN('tc'))
    # Keep first cell, set text to N/A right-aligned; wipe rest
    if cells:
        set_cell_text(cells[0], '')   # date column — blank
        # put N/A in the Claimed column (index 4 for disb tables)
        if len(cells) > 4:
            set_cell_text(cells[4], 'N/A')
        for tc in cells[1:4]:
            clear_cell(tc)
        if len(cells) > 5:
            clear_cell(cells[5])
    return new_row


def fill_disbursement_table(tbl: etree._Element, entries: list[dict],
                            subtotal: str) -> None:
    rows         = tbl.findall(WN('tr'))
    # rows[0] = category title, rows[1] = column headers,
    # rows[2] = template data row, rows[3] = subtotal row
    title_row    = rows[0]
    header_row   = rows[1]
    template_row = rows[2]
    subtotal_row = rows[3]

    if not entries:
        # Collapse: keep title row only, add N/A row
        for row in [header_row, template_row, subtotal_row]:
            tbl.remove(row)
        na_row = _make_na_row(template_row)
        tbl.append(na_row)
        return

    # Expand rows for entries
    insert_idx = list(tbl).index(template_row)
    tbl.remove(template_row)
    for i, fee in enumerate(entries):
        new_row = copy.deepcopy(template_row)
        cells   = new_row.findall(WN('tc'))
        set_cell_text(cells[0], fee.get('date', ''))
        set_cell_text(cells[1], fee.get('description', ''))
        set_cell_text(cells[2], fee.get('amount', ''))
        set_cell_text(cells[3], fee.get('gst', ''))
        set_cell_text(cells[4], fee.get('claimed', ''))
        clear_cell(cells[5])   # Allowed
        tbl.insert(insert_idx + i, new_row)

    # Subtotal row
    for tc in subtotal_row.findall(WN('tc')):
        txt = para_text(tc).strip()
        if txt == '[DISB SUBTOTAL CLAIMED]':
            set_cell_text(tc, subtotal)
        elif txt == '[DISB SUBTOTAL ALLOWED]':
            clear_cell(tc)


# ---------------------------------------------------------------------------
# Summary of Disbursements (Table 8)
# ---------------------------------------------------------------------------

SUMMARY_ROW_LABELS = {
    'Filing Fees':            'filing_fees',
    'Transcripts':            'transcripts',
    'Expert Fees':            'expert_fees',
    'Search Fees':            'search_fees',
    'Photocopying / Printing': 'photocopying',
    'Travel':                 'travel',
    'Other Disbursements':    'other',
}


def fill_summary_table(tbl: etree._Element, ctx: dict) -> None:
    subtotals = ctx.get('disb_subtotals', {})
    for row in tbl.findall(WN('tr')):
        cells = row.findall(WN('tc'))
        if len(cells) < 2:
            continue
        label   = para_text(cells[0]).strip()
        claimed = para_text(cells[1]).strip()
        if label in SUMMARY_ROW_LABELS:
            key = SUMMARY_ROW_LABELS[label]
            val = subtotals.get(key, '')
            if claimed == '[SUMMARY CLAIMED]':
                set_cell_text(cells[1], val)
        elif claimed in ('[SUMMARY SUBTOTAL CLAIMED]', '[SUMMARY TOTAL CLAIMED]'):
            set_cell_text(cells[1], ctx.get('disb_total', ''))
        elif claimed == '[SUMMARY TAXES CLAIMED]':
            set_cell_text(cells[1], 'N/A')
        # Clear all Allowed cells
        if len(cells) > 2:
            allowed = para_text(cells[2]).strip()
            if allowed.startswith('[SUMMARY') and allowed.endswith('ALLOWED]'):
                clear_cell(cells[2])


# ---------------------------------------------------------------------------
# Total Bill of Costs (Table 9)
# ---------------------------------------------------------------------------

BOC_TOTAL_KEYS = {
    'Part 1': 'fees_total',
    'Part 2': 'disb_total',
    'TOTAL':  'grand_total',
}


def fill_boc_total_table(tbl: etree._Element, ctx: dict) -> None:
    for row in tbl.findall(WN('tr')):
        cells = row.findall(WN('tc'))
        if len(cells) < 2:
            continue
        label = para_text(cells[0]).strip()
        for prefix, key in BOC_TOTAL_KEYS.items():
            if label.startswith(prefix):
                if para_text(cells[1]).strip() == '[BOC TOTAL CLAIMED]':
                    set_cell_text(cells[1], ctx.get(key, ''))
                if len(cells) > 2 and para_text(cells[2]).strip() == '[BOC TOTAL ALLOWED]':
                    clear_cell(cells[2])
                break


# ---------------------------------------------------------------------------
# Content-type rewrite (.dotx → .docx)
# ---------------------------------------------------------------------------

def rewrite_content_type(members: dict[str, bytes]) -> None:
    ct = members['[Content_Types].xml'].decode('utf-8')
    ct = ct.replace(
        'wordprocessingml.template.main+xml',
        'wordprocessingml.document.main+xml',
    )
    members['[Content_Types].xml'] = ct.encode('utf-8')


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def build_scalars(ctx: dict) -> dict[str, str]:
    return {
        '[COURT FILE NUMBER]':     ctx.get('court_file_number', ''),
        '[REGISTRY]':              ctx.get('registry', ''),
        '[ORIGINATING PARTY]':     ctx.get('originating_party', ''),
        '[ORIGINATING PARTY ROLE]': ctx.get('originating_party_role', ''),
        '[RESPONDING PARTY]':      ctx.get('responding_party', ''),
        '[RESPONDING PARTY ROLE]': ctx.get('responding_party_role', ''),
        '[PARTY CLAIMING COSTS]':  ctx.get('party_claiming_costs', ''),
        '[COSTS SCALE]':           ctx.get('costs_scale', ''),
        '[UNIT VALUE]':            ctx.get('unit_value', ''),
        '[COSTS ORDER]':           ctx.get('costs_order', ''),
        '[COSTS TERMS]':           ctx.get('costs_terms', ''),
        '[NOTES]':                 ctx.get('notes', ''),
        '[NOTES FOOTER]':          ctx.get('notes_footer', ''),
    }


def fill(ctx: dict, out_path: Path, template_path: Path = TEMPLATE) -> None:
    with zipfile.ZipFile(template_path) as zin:
        members = {n: zin.read(n) for n in zin.namelist()}

    root = etree.fromstring(members['word/document.xml'])
    body = root.find(WN('body'))

    # 1. Scalar substitution
    substitute_scalars(body, build_scalars(ctx))

    # 2. Locate all tables
    tables = list(body.iter(WN('tbl')))
    # Expected order: [0] Tariff, [1] Filing Fees, [2] Transcripts,
    # [3] Expert Fees, [4] Photocopying, [5] Search Fees, [6] Travel,
    # [7] Other, [8] Summary of Disbursements, [9] Total BOC

    # 3. Tariff table
    fill_tariff_table(tables[0], ctx)

    # 4. Disbursement tables (indices 1–7)
    disb_data     = ctx.get('disbursements', {})
    disb_subtotals = ctx.get('disb_subtotals', {})
    for i, key in enumerate(DISB_CATEGORY_ORDER):
        entries  = disb_data.get(key, [])
        subtotal = disb_subtotals.get(key, '')
        fill_disbursement_table(tables[1 + i], entries, subtotal)

    # 5. Summary of Disbursements
    fill_summary_table(tables[8], ctx)

    # 6. Total Bill of Costs
    fill_boc_total_table(tables[9], ctx)

    # 7. Serialise
    rewrite_content_type(members)
    members['word/document.xml'] = etree.tostring(
        root, xml_declaration=True, encoding='UTF-8', standalone=True)

    with zipfile.ZipFile(out_path, 'w', zipfile.ZIP_DEFLATED) as zout:
        for name, data in members.items():
            zout.writestr(name, data)


def main() -> int:
    p = argparse.ArgumentParser(description='Fill 062-boc.dotx with Bill of Costs data.')
    p.add_argument('--context',  required=True, help='Path to JSON context file')
    p.add_argument('--out-dir',  required=True, help="The matter's draft folder, written at its root")
    p.add_argument('--out-name', required=True, help="The bill's file name stem, no extension")
    p.add_argument('--template', default=None,  help='Override template path')
    args = p.parse_args()

    refusal = check_target(args.out_dir, args.out_name)
    if refusal:
        print(f'error: {refusal}', file=sys.stderr)
        return 1
    template = Path(args.template) if args.template else TEMPLATE
    ctx = json.loads(
        Path(args.context).read_bytes().rstrip(b"\x00").decode("utf-8"))

    try:
        out_path, prior = write_new(args.out_dir, args.out_name, '.docx',
                                    lambda tmp: fill(ctx, tmp, template))
    except FileExistsError as exc:
        print(f'error: {exc}', file=sys.stderr)
        return 1
    print(f'Written: {out_path}  ({out_path.stat().st_size:,} bytes)')
    if prior:
        print(f'Versioned from: {prior}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
