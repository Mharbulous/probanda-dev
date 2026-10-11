"""Affidavit-only post-processing around the jurat, footers and interpreter endorsement."""
from __future__ import annotations
import re
import sys

from lxml import etree

from fill_ooxml import WN


# ---------------------------------------------------------------------------
# Affidavit-only post-processing
# ---------------------------------------------------------------------------

def _clear_footers(members: dict[str, bytes]) -> None:
    """Remove all runs (text + field codes) from every footer in the document.

    Strips LEAP "Last updated [date]" text and page-number fldChar/instrText
    fields from footer1.xml, footer2.xml, footer3.xml (whichever are present).
    """
    footer_names = [n for n in members if re.match(r'word/footer\d+\.xml$', n)]
    for fname in footer_names:
        try:
            root = etree.fromstring(members[fname])
        except etree.XMLSyntaxError:
            continue
        for para in root.iter(WN('p')):
            for run in list(para.findall(WN('r'))):
                para.remove(run)
        members[fname] = etree.tostring(
            root, xml_declaration=True, encoding='UTF-8', standalone=True)


def _find_jurat_index(body: etree._Element) -> int | None:
    """Index of the jurat <w:tbl> in *body*, identified by its text.

    The interpreter endorsement ends with its own signature table, so "last
    table" is not the jurat.  The jurat is the table carrying "BEFORE ME" --
    present both before substitution ("[SWORN OR AFFIRMED] BEFORE ME") and
    after it ("SWORN BEFORE ME"), so this works at any pipeline stage.
    """
    for i, child in enumerate(body):
        if child.tag != WN('tbl'):
            continue
        if 'BEFORE ME' in ''.join(t.text or '' for t in child.iter(WN('t'))):
            return i
    print("WARNING: no jurat table found (no table contains 'BEFORE ME'); "
          "affidavit post-processing skipped.", file=sys.stderr)
    return None


def _inject_keep_next_before_jurat(body: etree._Element) -> None:
    """Add <w:keepNext/> to the last LEAPBCParaNumL* paragraph before the jurat table.

    Ensures at least one numbered paragraph appears on the signature page when
    the jurat falls near a page break.
    """
    children = list(body)

    jurat_idx = _find_jurat_index(body)
    if jurat_idx is None:
        return

    # Walk backwards from the jurat to find the last numbered paragraph
    target_para = None
    for i in range(jurat_idx - 1, -1, -1):
        child = children[i]
        if child.tag != WN('p'):
            continue
        ppr = child.find(WN('pPr'))
        if ppr is None:
            continue
        pstyle = ppr.find(WN('pStyle'))
        if pstyle is None:
            continue
        if pstyle.get(WN('val'), '').startswith('LEAPBCParaNumL'):
            target_para = child
            break

    if target_para is None:
        return

    ppr = target_para.find(WN('pPr'))
    if ppr is None:
        ppr = etree.Element(WN('pPr'))
        target_para.insert(0, ppr)

    if ppr.find(WN('keepNext')) is None:
        kn = etree.Element(WN('keepNext'))
        pstyle = ppr.find(WN('pStyle'))
        if pstyle is not None:
            pstyle.addnext(kn)
        else:
            ppr.insert(0, kn)


def _remove_interpreter_endorsement(body: etree._Element) -> None:
    """Remove the interpreter endorsement section after the jurat table.

    Deletes all elements between the jurat <w:tbl> and <w:sectPr>, leaving
    only the jurat and the section properties.  The interpreter endorsement
    carries its own signature table, which is why the jurat is located by
    content rather than by position.
    """
    children = list(body)

    jurat_idx = _find_jurat_index(body)
    if jurat_idx is None:
        return

    # Remove everything after the jurat that isn't sectPr
    for child in children[jurat_idx + 1:]:
        if child.tag == WN('sectPr'):
            break
        body.remove(child)
