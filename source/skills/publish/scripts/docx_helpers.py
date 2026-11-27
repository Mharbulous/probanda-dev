"""OOXML zip/lxml helpers shared by /publish's fill scripts, and the run builder over the one
markdown inline-emphasis parser (emphasis.py) every one of them uses.

Open a .dotx/.docx as a zip, edit word/document.xml with lxml (never stdlib
xml.etree -- it silently drops mc:Ignorable namespace declarations and corrupts
a court template's own structure), and write the result back out as a new zip
with the template's content type corrected to a plain document.
"""
from __future__ import annotations

import copy
import sys
import zipfile
from pathlib import Path

from lxml import etree

from emphasis import emphasis_runs

W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
XMLSPACE = '{http://www.w3.org/XML/1998/namespace}space'


def wn(tag: str) -> str:
    return f'{{{W}}}{tag}'


def load_zip(path: Path) -> dict[str, bytes]:
    with zipfile.ZipFile(path) as zin:
        return {n: zin.read(n) for n in zin.namelist()}


def save_zip(members: dict[str, bytes], out_path: Path) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    if out_path.exists():
        out_path.unlink()
    with zipfile.ZipFile(out_path, 'w', zipfile.ZIP_DEFLATED) as zout:
        for name, data in members.items():
            zout.writestr(name, data)


def rewrite_content_types_to_document(members: dict[str, bytes]) -> None:
    """Fix [Content_Types].xml when the source template is a .dotx.

    Same technique as publish-bcsc-form/scripts/fill_plain.py's
    rewrite_content_types -- a .dotx's main part is declared as a
    "template.main+xml"; a filled, non-editable-template output is a plain
    "document.main+xml". A no-op when the source was already a .docx.
    """
    ct = members['[Content_Types].xml'].decode('utf-8')
    ct = ct.replace(
        'ContentType="application/vnd.openxmlformats-officedocument'
        '.wordprocessingml.template.main+xml"',
        'ContentType="application/vnd.openxmlformats-officedocument'
        '.wordprocessingml.document.main+xml"',
    )
    members['[Content_Types].xml'] = ct.encode('utf-8')


def para_text(p: etree._Element) -> str:
    return ''.join(t.text or '' for t in p.iter(wn('t')))


def set_run_text(run: etree._Element, text: str) -> None:
    t = run.find(wn('t'))
    if t is None:
        t = etree.SubElement(run, wn('t'))
    t.text = text
    if text != text.strip():
        t.set(XMLSPACE, 'preserve')
    else:
        if XMLSPACE in t.attrib:
            del t.attrib[XMLSPACE]


def append_emphasis_runs(parent: etree._Element, text: str,
                         rpr: etree._Element | None = None) -> None:
    """Append text to parent as one <w:r> per emphasis_runs run. Each run's <w:rPr> is a copy
    of rpr, or empty, plus <w:b/><w:bCs/> and <w:i/><w:iCs/> where the run needs them,
    placed after any rStyle and rFonts as the schema orders them."""
    for piece, bold, italic in emphasis_runs(text):
        run = etree.SubElement(parent, wn('r'))
        props = copy.deepcopy(rpr) if rpr is not None else etree.Element(wn('rPr'))
        at = sum(1 for child in props if child.tag in (wn('rStyle'), wn('rFonts')))
        wanted = ['b', 'bCs'] * bold + ['i', 'iCs'] * italic
        for tag in reversed([t for t in wanted if props.find(wn(t)) is None]):
            props.insert(at, etree.Element(wn(tag)))
        if len(props):
            run.append(props)
        set_run_text(run, piece)


def styled_para(style: str | None, text: str = '', jc: str | None = None, bold: bool = False) -> etree._Element:
    """A new <w:p> of emphasis runs, with an optional paragraph style and alignment."""
    p = etree.Element(wn('p'))
    if style or jc:
        ppr = etree.SubElement(p, wn('pPr'))
        if style:
            etree.SubElement(ppr, wn('pStyle')).set(wn('val'), style)
        if jc:
            etree.SubElement(ppr, wn('jc')).set(wn('val'), jc)
    rpr = None
    if bold:
        rpr = etree.Element(wn('rPr'))
        etree.SubElement(rpr, wn('b'))
    append_emphasis_runs(p, text, rpr)
    return p


def table(rows: list[list[str]], widths: list[int], jcs: list[str], borders: bool,
          style: str | None, bold_rows: set[int] = frozenset()) -> etree._Element:
    """A <w:tbl> of one styled_para per cell, columns `widths` twips wide and aligned by `jcs`."""
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
            tc.append(styled_para(style, text, jc, bold=k in bold_rows))
    return tbl


def caption_table(rows: list[list[str]], style: str | None = None) -> etree._Element:
    """The style of proceeding in Word: the renderers' three-column caption rows (separator row
    dropped) as a borderless table, left, centred and right."""
    return table(rows, [2340, 4680, 2340], ['left', 'center', 'right'], False, style)


def make_para(text: str, ppr_template: etree._Element | None = None,
              bold: bool = False, size: int | None = None) -> etree._Element:
    """A new <w:p> with one run, optionally cloning a template's <w:pPr>."""
    p = etree.Element(wn('p'))
    if ppr_template is not None:
        p.append(copy.deepcopy(ppr_template))
    run = etree.SubElement(p, wn('r'))
    if bold or size:
        rpr = etree.SubElement(run, wn('rPr'))
        if bold:
            etree.SubElement(rpr, wn('b'))
        if size:
            sz = etree.SubElement(rpr, wn('sz'))
            sz.set(wn('val'), str(size))
    set_run_text(run, text)
    return p


def find_para_by_exact_text(body: etree._Element, text: str) -> etree._Element | None:
    for p in body.iter(wn('p')):
        if para_text(p).strip() == text:
            return p
    return None


def substitute_text(body: etree._Element, subs: dict[str, str]) -> None:
    """Substitute bracket placeholders in <w:t> runs (whole-run or substring).

    Keys that never matched anywhere in the document are reported on stderr
    instead of silently dropped -- same failure signal as
    publish-bcsc-form/scripts/fill_plain.py's substitute_text. An unmatched
    key means the placeholder text is still sitting in a court-bound
    document.
    """
    applied: set[str] = set()
    keys_longest_first = sorted(subs, key=len, reverse=True)
    for t_el in body.iter(wn('t')):
        if not t_el.text:
            continue
        if t_el.text in subs:
            applied.add(t_el.text)
            t_el.text = subs[t_el.text]
        else:
            for key in keys_longest_first:
                if key in t_el.text:
                    t_el.text = t_el.text.replace(key, subs[key])
                    applied.add(key)
        if t_el.text != t_el.text.strip():
            t_el.set(XMLSPACE, 'preserve')

    for key in subs:
        if key not in applied:
            print(f"WARNING: substitution key never matched: {key}",
                  file=sys.stderr)
