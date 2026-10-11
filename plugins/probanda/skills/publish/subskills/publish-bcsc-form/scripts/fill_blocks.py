"""Marked blocks: optional and repeatable template sections, and exhibit lettering."""
from __future__ import annotations
import copy
import re
import sys

from lxml import etree

from fill_jurat import _find_jurat_index
from fill_ooxml import XMLSPACE, WN, _para_text


# ---------------------------------------------------------------------------
# Marked blocks — optional and repeatable template sections
# ---------------------------------------------------------------------------
#
# A block is delimited by two sentinel paragraphs whose whole text is
# "[[BLOCK:<id>]]" and "[[END-BLOCK]]".  A block is either dropped (the branch
# does not apply) or repeated once per row (a variable-length list).  Markers
# never survive into the output.

BLOCK_END = '[[END-BLOCK]]'


def _find_marked_block(body: etree._Element, block_id: str) -> tuple[int, int] | None:
    """Indices of the opening and closing markers of *block_id*, or None."""
    start = None
    for i, child in enumerate(body):
        if child.tag != WN('p'):
            continue
        text = _para_text(child).strip()
        if text == f'[[BLOCK:{block_id}]]':
            start = i
        elif text == BLOCK_END and start is not None:
            return start, i
    if start is not None:
        print(f"WARNING: block {block_id!r} has no {BLOCK_END} marker; left as is.",
              file=sys.stderr)
    return None


def _remove_marked_block(body: etree._Element, block_id: str) -> None:
    """Delete a block and its markers — the branch does not apply."""
    found = _find_marked_block(body, block_id)
    if found is None:
        return
    start, end = found
    for el in list(body)[start:end + 1]:
        body.remove(el)


def _unwrap_marked_block(body: etree._Element, block_id: str) -> None:
    """Keep a block's content, drop its two markers — the branch applies."""
    found = _find_marked_block(body, block_id)
    if found is None:
        return
    start, end = found
    children = list(body)
    body.remove(children[end])
    body.remove(children[start])


def _repeat_marked_block(body: etree._Element, block_id: str,
                         rows: list[dict[str, str]]) -> None:
    """Emit one copy of a block per row, substituting that row's placeholders.

    An empty *rows* drops the block entirely, so the caller does not have to
    special-case the zero-row list.
    """
    found = _find_marked_block(body, block_id)
    if found is None:
        return
    start, end = found
    template_els = list(body)[start + 1:end]

    new_els = []
    for row in rows:
        for el in template_els:
            clone = copy.deepcopy(el)
            for t_el in clone.iter(WN('t')):
                if not t_el.text:
                    continue
                for placeholder, value in row.items():
                    if placeholder in t_el.text:
                        t_el.text = t_el.text.replace(placeholder, str(value))
                if t_el.text != t_el.text.strip():
                    t_el.set(XMLSPACE, 'preserve')
            new_els.append(clone)

    for el in list(body)[start:end + 1]:
        body.remove(el)
    for offset, el in enumerate(new_els):
        body.insert(start + offset, el)


def _strip_block_markers(body: etree._Element) -> None:
    """Remove any marker paragraph left behind, warning about each one."""
    for para in list(body.iter(WN('p'))):
        text = _para_text(para).strip()
        if text.startswith('[[BLOCK:') or text == BLOCK_END:
            print(f"WARNING: dangling block marker removed: {text}", file=sys.stderr)
            parent = para.getparent()
            if parent is not None:
                parent.remove(para)


def _exhibit_letter(index: int) -> str:
    """A, B, C ... for a zero-based index."""
    if index >= 26:
        raise ValueError(
            f"exhibit {index + 1} exceeds the single-letter range A-Z; "
            "/assemble's assemble-affidavit matches exhibits on a single letter.")
    return chr(ord('A') + index)


def _fill_exhibit_block(body: etree._Element, context: dict) -> None:
    """Emit one exhibit paragraph per unfiled document, lettered in list order."""
    documents = context.get('unfiled_documents') or []
    _repeat_marked_block(body, 'exhibit', [
        {'[EXHIBIT LETTER]': _exhibit_letter(i),
         '[EXHIBIT DESCRIPTION]': doc.get('description', '') if isinstance(doc, dict) else str(doc)}
        for i, doc in enumerate(documents)
    ])


def _fill_affidavit_paragraphs(body: etree._Element, paragraphs: list[str]) -> None:
    """Replace the template's body paragraphs with the emitted affidavit's (#1488).

    Everything from the first LEAPBCParaNumL1 paragraph to the last one before
    the jurat goes: the template's own preamble, the [[BLOCK:exhibit]] block
    and its empty trailing paragraph. The emitted paragraphs already carry the
    preamble and every exhibit reference, so keeping either would double them.
    Each paragraph is numbered by its style; `**...**` becomes a bold run.
    """
    children = list(body)
    jurat = _find_jurat_index(body)
    if jurat is None:
        raise ValueError('affidavit template has no jurat table; cannot place the paragraphs')
    numbered = [i for i, c in enumerate(children[:jurat]) if c.tag == WN('p')
                and c.find(f"{WN('pPr')}/{WN('pStyle')}") is not None
                and c.find(f"{WN('pPr')}/{WN('pStyle')}").get(WN('val')) == 'LEAPBCParaNumL1']
    if not numbered:
        raise ValueError('affidavit template has no LEAPBCParaNumL1 paragraph before the jurat')
    first, last = numbered[0], numbered[-1]
    number_ppr = children[first].find(WN('pPr'))
    spacer = children[first + 1]
    for el in children[first:last + 1]:
        body.remove(el)

    new_els = []
    for text in paragraphs:
        p = etree.Element(WN('p'))
        p.append(copy.deepcopy(number_ppr))
        for i, piece in enumerate(re.split(r'\*\*(.+?)\*\*', text)):
            if not piece:
                continue
            run = etree.SubElement(p, WN('r'))
            if i % 2:
                etree.SubElement(etree.SubElement(run, WN('rPr')), WN('b'))
            t = etree.SubElement(run, WN('t'))
            t.text = piece
            t.set(XMLSPACE, 'preserve')
        new_els += [p, copy.deepcopy(spacer)]
    for offset, el in enumerate(new_els[:-1]):
        body.insert(first + offset, el)


def _elect_block(body: etree._Element, choices: dict[str, str], selected: str) -> None:
    """Keep the block for *selected* and drop the rest.

    An unrecognised selection drops every branch and says so — better a visibly
    missing section than a silently wrong election in a filed affidavit.
    """
    if selected not in choices:
        print(f"WARNING: no branch matches election {selected!r}; expected one of "
              f"{sorted(choices)}. All branches removed.", file=sys.stderr)
    for key, block_id in choices.items():
        if key == selected:
            _unwrap_marked_block(body, block_id)
        else:
            _remove_marked_block(body, block_id)
