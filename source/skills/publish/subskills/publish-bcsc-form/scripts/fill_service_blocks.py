"""Form 15 / Form 16 section elections and the mirrored substituted-service section 2."""
from __future__ import annotations
import sys

from lxml import etree

from fill_blocks import (
    _find_marked_block, _remove_marked_block, _unwrap_marked_block,
    _repeat_marked_block, _exhibit_letter, _elect_block,
)
from fill_jurat import _find_jurat_index
from fill_ooxml import XMLSPACE, WN
from fill_subserv import (
    _IND_PARTY, _IND_METHOD, _IND_ADDRESS, _ROMAN, is_substituted_service,
    _method_addresses, _render_method, _ordered_methods, _courtesy_methods,
)


_IDENTIFICATION_BLOCKS = {
    'known': 'id-known', 'photo_id': 'id-photo', 'other': 'id-other',
}
_SERVICE_METHOD_BLOCKS = {
    'leaving': 'method-leaving', 'ordinary_mail': 'method-mail',
    'fax': 'method-fax', 'email': 'method-email',
}


def _make_indented_para(text: str, left: int, label: str | None = None,
                        hanging: int = 720) -> etree._Element:
    """A paragraph indented to *left*, optionally opened by a tabbed label."""
    p = etree.Element(WN('p'))
    ppr = etree.SubElement(p, WN('pPr'))
    ind = etree.SubElement(ppr, WN('ind'))
    ind.set(WN('left'), str(left))
    if label is not None:
        ind.set(WN('hanging'), str(hanging))
    spacing = etree.SubElement(ppr, WN('spacing'))
    spacing.set(WN('after'), '200')
    spacing.set(WN('line'), '240')
    spacing.set(WN('lineRule'), 'auto')
    if label is not None:
        label_run = etree.SubElement(p, WN('r'))
        etree.SubElement(label_run, WN('t')).text = label
        etree.SubElement(etree.SubElement(p, WN('r')), WN('tab'))
    run = etree.SubElement(p, WN('r'))
    t = etree.SubElement(run, WN('t'))
    t.text = text
    if text != text.strip():
        t.set(XMLSPACE, 'preserve')
    return p


def _make_service_numbered_para(text: str) -> etree._Element:
    """A top-level numbered paragraph in the service forms' own style.

    The number is literal text in these templates, so it is emitted as a
    placeholder and set by _renumber_service_paragraphs once every paragraph
    is in place.
    """
    p = etree.Element(WN('p'))
    ppr = etree.SubElement(p, WN('pPr'))
    etree.SubElement(ppr, WN('pStyle')).set(WN('val'), 'LEAPBCParaNumL1')
    ind = etree.SubElement(ppr, WN('ind'))
    ind.set(WN('left'), '720')
    ind.set(WN('hanging'), '720')
    spacing = etree.SubElement(ppr, WN('spacing'))
    spacing.set(WN('after'), '200')
    spacing.set(WN('line'), '240')
    spacing.set(WN('lineRule'), 'auto')
    etree.SubElement(etree.SubElement(p, WN('r')), WN('t')).text = '0'
    etree.SubElement(etree.SubElement(p, WN('r')), WN('tab'))
    etree.SubElement(etree.SubElement(p, WN('r')), WN('t')).text = text
    return p


def _build_mirrored_section2(context: dict) -> list[etree._Element]:
    """The per-party mirrored structure that replaces section 2's check-boxes."""
    service_date = str(context.get('service_date', '')).strip()
    paras: list[etree._Element] = []
    for p_index, party in enumerate(context['parties_served']):
        methods = [m for m in _ordered_methods(party) if m.get('performed', True)]
        if not methods:
            continue
        paras.append(_make_indented_para(
            f'In respect of {party["name"]}, by:',
            _IND_PARTY, label=f'({_exhibit_letter(p_index).lower()})'))
        for m_index, method in enumerate(methods):
            paras.append(_make_indented_para(
                _render_method(method, service_date),
                _IND_METHOD, label=f'({_ROMAN[m_index]})'))
            for address in _method_addresses(method):
                for line in str(address).splitlines():
                    paras.append(_make_indented_para(line.strip(), _IND_ADDRESS))
    return paras


def _build_trailing_paragraphs(context: dict) -> list[etree._Element]:
    """Courtesy acts and transmission exhibits, as their own numbered paragraphs.

    A courtesy act has no counterpart in the order, so it is kept out of the
    mirrored structure and labelled as a courtesy — otherwise a term-by-term
    comparison shows a deposed act the order never required.
    """
    service_date = str(context.get('service_date', '')).strip()
    paras: list[etree._Element] = []
    for party in context['parties_served']:
        for method in _courtesy_methods(party):
            paras.append(_make_service_numbered_para(
                f'As a courtesy, and not as a step required by the Order, I '
                f'also served {party["name"]} by '
                f'{_render_method(method, service_date)}.'))
    start = len(context.get('unfiled_documents') or [])
    for i, exhibit in enumerate(context.get('service_exhibits') or []):
        paras.append(_make_service_numbered_para(
            f'Attached to this affidavit and marked as Exhibit '
            f'{_exhibit_letter(start + i)} is a true copy of '
            f'{exhibit["description"]}.'))
    return paras


def _renumber_service_paragraphs(body: etree._Element) -> None:
    """Renumber the top-level numbered paragraphs 1, 2, 3 … in document order.

    The variant inserts and drops numbered paragraphs, and the template's
    numbers are literal text, so the sequence is restated once at the end.
    """
    jurat_idx = _find_jurat_index(body)
    stop = jurat_idx if jurat_idx is not None else len(list(body))
    number = 0
    for child in list(body)[:stop]:
        if child.tag != WN('p'):
            continue
        ppr = child.find(WN('pPr'))
        pstyle = ppr.find(WN('pStyle')) if ppr is not None else None
        if pstyle is None or pstyle.get(WN('val')) != 'LEAPBCParaNumL1':
            continue
        number += 1
        first_t = child.find(WN('r'))
        first_t = first_t.find(WN('t')) if first_t is not None else None
        if first_t is None:
            print("WARNING: numbered paragraph has no leading run to number.",
                  file=sys.stderr)
            continue
        first_t.text = str(number)


def _fill_substituted_service_section(body: etree._Element,
                                      context: dict) -> None:
    """Replace section 2's four check-box branches with the mirrored structure."""
    found = _find_marked_block(body, 'method-leaving')
    if found is None:
        raise RuntimeError(
            'Form 16 template has no method-leaving block; the substituted-'
            'service variant cannot locate where section 2 begins.')
    insert_idx = found[0]
    for block_id in _SERVICE_METHOD_BLOCKS.values():
        _remove_marked_block(body, block_id)
    for offset, para in enumerate(_build_mirrored_section2(context)
                                  + _build_trailing_paragraphs(context)):
        body.insert(insert_idx + offset, para)


def _fill_service_affidavit_blocks(body: etree._Element, context: dict,
                                   form: str) -> None:
    """Elect the Form 15 / Form 16 branches and expand the document lists."""
    filed = context.get('filed_documents') or []
    if filed:
        _unwrap_marked_block(body, 'filed-intro')
        _repeat_marked_block(body, 'filed-doc', [
            {'[FILED DOCUMENT DESCRIPTION]': doc.get('description', ''),
             '[FILED DOCUMENT STAMP DATE]': doc.get('stamp_date', '')}
            for doc in filed
        ])
    else:
        _remove_marked_block(body, 'filed-intro')
        _remove_marked_block(body, 'filed-doc')

    if context.get('unfiled_documents') or []:
        _unwrap_marked_block(body, 'unfiled-intro')
    else:
        _remove_marked_block(body, 'unfiled-intro')

    if form == 'afs':
        _elect_block(body, _IDENTIFICATION_BLOCKS,
                     str(context.get('identification_method', '')).strip().lower())
    elif is_substituted_service(context):
        _fill_substituted_service_section(body, context)
    else:
        _elect_block(body, _SERVICE_METHOD_BLOCKS,
                     str(context.get('service_method', '')).strip().lower())

    if str(context.get('sworn_by_video', 'no')).strip().lower() in ('yes', 'true', '1'):
        _unwrap_marked_block(body, 'videoconf')
    else:
        _remove_marked_block(body, 'videoconf')

    if is_substituted_service(context):
        _renumber_service_paragraphs(body)
