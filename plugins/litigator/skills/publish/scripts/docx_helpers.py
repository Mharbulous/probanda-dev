"""Self-contained OOXML zip/lxml helpers for filling the BCCA book templates.

Not imported from publish-bcsc-form (different plugin, no cross-plugin import
path at runtime) -- this module reimplements only the small slice of that
skill's fill_plain.py technique this skill needs: open a .dotx/.docx as a
zip, edit word/document.xml with lxml (never stdlib xml.etree -- it silently
drops mc:Ignorable namespace declarations and corrupts a court template's own
structure), and write the result back out as a new zip with the template's
content type corrected to a plain document.
"""
from __future__ import annotations

import copy
import sys
import zipfile
from pathlib import Path

from lxml import etree

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
