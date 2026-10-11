"""WordprocessingML namespace helpers and shared paragraph builders."""
from __future__ import annotations
import copy
import re

from lxml import etree


W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
XMLSPACE = '{http://www.w3.org/XML/1998/namespace}space'


def WN(tag: str) -> str:
    return f'{{{W}}}{tag}'


def _para_text(para: etree._Element) -> str:
    return ''.join(t.text or '' for t in para.iter(WN('t')))


# A matched `*…*` span (assembly-input-contract.md); the same pattern asm32's parser validates.
ITALIC_SPAN = re.compile(r'(?<!\*)\*([^*\n]+)\*(?!\*)')


def _append_runs(para: etree._Element, text: str, italics: bool = False) -> None:
    """Append text as runs. With italics, each `*…*` span becomes an italic run, asterisks dropped."""
    pieces = ITALIC_SPAN.split(text) if italics else [text]
    for i, piece in enumerate(pieces):
        if not piece and len(pieces) > 1:
            continue
        run = etree.SubElement(para, WN('r'))
        if i % 2:
            rpr = etree.SubElement(run, WN('rPr'))
            etree.SubElement(rpr, WN('i'))
            etree.SubElement(rpr, WN('iCs'))
        t = etree.SubElement(run, WN('t'))
        t.text = piece
        if piece != piece.strip():
            t.set(XMLSPACE, 'preserve')


def _make_numbered_para(template_para: etree._Element, text: str,
                        italics: bool = False) -> etree._Element:
    """Clone template_para's <w:pPr> (keeping numPr) and set new text content."""
    new_p = etree.Element(WN('p'))
    ppr = template_para.find(WN('pPr'))
    if ppr is not None:
        new_p.append(copy.deepcopy(ppr))
    _append_runs(new_p, text, italics)
    return new_p


def _make_form33_para(template_para: etree._Element, text: str) -> etree._Element:
    """Clone numbering and synthesize inline italic runs for Form 33 markdown."""
    new_p = etree.Element(WN('p'))
    ppr = template_para.find(WN('pPr'))
    if ppr is not None:
        cloned = copy.deepcopy(ppr)
        if text == 'Nil.':
            numpr = cloned.find(WN('numPr'))
            if numpr is not None:
                cloned.remove(numpr)
        new_p.append(cloned)
    pieces = re.split(r'(\*[^*\n]+\*)', text)
    for piece in pieces:
        if not piece:
            continue
        italic = piece.startswith('*') and piece.endswith('*')
        value = piece[1:-1] if italic else piece
        run = etree.SubElement(new_p, WN('r'))
        if italic:
            rpr = etree.SubElement(run, WN('rPr'))
            etree.SubElement(rpr, WN('i'))
        t = etree.SubElement(run, WN('t'))
        t.text = value
        if value != value.strip():
            t.set(XMLSPACE, 'preserve')
    return new_p


def _make_styled_para(style: str, text: str, italics: bool = False) -> etree._Element:
    """Create an unnumbered paragraph in the template's paragraph style *style*.

    Form 32 (032-noa.dotx): `Excerpt` for a quoted excerpt (left-aligned,
    indented), `Citation` for its citation line (right-aligned), and
    `EvidenceRef` for a Part 2 evidence reference.
    """
    new_p = etree.Element(WN('p'))
    ppr = etree.SubElement(new_p, WN('pPr'))
    etree.SubElement(ppr, WN('pStyle')).set(WN('val'), style)
    _append_runs(new_p, text, italics)
    return new_p


def _make_excerpt_para(text: str) -> etree._Element:
    """Create an unnumbered block-quote paragraph with pStyle="Excerpt".

    For multi-sentence quoted excerpts of pleadings, statutes, or case law.
    The Excerpt style (styles.xml) supplies a normal single-tab left indent and
    numId="0" (no number); built from scratch so it works in any Part, not only
    where the Part 2 citation template paragraph exists.
    """
    return _make_styled_para('Excerpt', text)


# ---------------------------------------------------------------------------
# Content-type rewrite
# ---------------------------------------------------------------------------

def rewrite_content_types(members: dict[str, bytes]) -> None:
    ct = members['[Content_Types].xml'].decode('utf-8')
    ct = ct.replace(
        'ContentType="application/vnd.openxmlformats-officedocument'
        '.wordprocessingml.template.main+xml"',
        'ContentType="application/vnd.openxmlformats-officedocument'
        '.wordprocessingml.document.main+xml"',
    )
    members['[Content_Types].xml'] = ct.encode('utf-8')
