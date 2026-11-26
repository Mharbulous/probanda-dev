"""WordprocessingML namespace helpers and shared paragraph builders."""
from __future__ import annotations
import copy
import sys
from pathlib import Path

from lxml import etree

# The inline-emphasis parser is /publish's: skills/publish/scripts.
sys.path.append(str(Path(__file__).resolve().parents[3] / 'scripts'))
from docx_helpers import append_emphasis_runs  # noqa: E402


W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
XMLSPACE = '{http://www.w3.org/XML/1998/namespace}space'


def WN(tag: str) -> str:
    return f'{{{W}}}{tag}'


def _para_text(para: etree._Element) -> str:
    return ''.join(t.text or '' for t in para.iter(WN('t')))


def _make_numbered_para(template_para: etree._Element, text: str) -> etree._Element:
    """Clone template_para's <w:pPr> (keeping numPr) and set new text content, its markdown
    emphasis as bold and italic runs."""
    new_p = etree.Element(WN('p'))
    ppr = template_para.find(WN('pPr'))
    if ppr is not None:
        new_p.append(copy.deepcopy(ppr))
    append_emphasis_runs(new_p, text)
    return new_p


def _make_form33_para(template_para: etree._Element, text: str) -> etree._Element:
    """A Form 33 numbered paragraph, except that `Nil.` stands unnumbered."""
    new_p = _make_numbered_para(template_para, text)
    numpr = new_p.find(f"{WN('pPr')}/{WN('numPr')}")
    if text == 'Nil.' and numpr is not None:
        numpr.getparent().remove(numpr)
    return new_p


def _make_styled_para(style: str, text: str) -> etree._Element:
    """Create an unnumbered paragraph in the template's paragraph style *style*.

    Form 32 (032-noa.dotx): `Excerpt` for a quoted excerpt (left-aligned,
    indented), `Citation` for its citation line (right-aligned), and
    `EvidenceRef` for a Part 2 evidence reference.
    """
    new_p = etree.Element(WN('p'))
    ppr = etree.SubElement(new_p, WN('pPr'))
    etree.SubElement(ppr, WN('pStyle')).set(WN('val'), style)
    append_emphasis_runs(new_p, text)
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
