"""Form 16 substituted-service model: validation, method wording and the compliance table."""
from __future__ import annotations

from fill_blocks import _exhibit_letter


# ---------------------------------------------------------------------------
# Form 16 — substituted-service variant (Rule 4-4 order, Rule 22-3(1))
# ---------------------------------------------------------------------------
#
# The variant keeps the Form 16 skeleton and replaces section 2's four
# check-box branches with a structure that mirrors the order's own
# subparagraph hierarchy: one lettered subparagraph per party served, in the
# order's party order, and under each party the ordered methods in the order's
# sequence.  The practitioner then holds order and affidavit side by side and
# checks compliance term by term.

_AOS_TITLE = 'AFFIDAVIT OF ORDINARY SERVICE'
_AOS_TITLE_SUBSTITUTED = 'AFFIDAVIT OF SUBSTITUTED SERVICE'
_AOS_SECTION1_LEAD = ('On [SERVICE DATE], at [SERVICE TIME], I served '
                      '[PERSON SERVED] with')
_AOS_SECTION2_LEAD = ('I served each document referred to in section 1 of '
                      'this affidavit by')
_AOS_SECTION2_LEAD_SUBSTITUTED = (
    'I served each document referred to in section 1 of this affidavit, in '
    'accordance with the Order, as follows:')

# Indents, in twips, matching the base template's own section 1 sub-items.
_IND_PARTY, _IND_METHOD, _IND_ADDRESS = 1440, 2160, 2880

_ROMAN = ('i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x')

# How each ordered method reads in the affidavit. `leaving`, `ordinary_mail`,
# `fax` and `email` reuse the prescribed form's own wording; `custom` renders
# the order's wording verbatim, for a method outside Form 16's four branches
# (posting, social media). Advertisement is Form 10 under Rule 4-4(3) and is
# not drafted here.
_METHOD_WORDING = {
    'leaving':       'leaving the document at {detail}',
    'ordinary_mail': 'mailing the document by ordinary mail to {detail}',
    'fax':           'faxing the document to {detail} together with a fax cover sheet',
    'email':         'sending the document by e-mail to {detail}',
    'custom':        '{detail}',
}


def is_substituted_service(ctx: dict) -> bool:
    return str(ctx.get('service_mode', 'ordinary')).strip().lower() == 'substituted'


def _join_names(names: list[str]) -> str:
    if len(names) == 1:
        return names[0]
    return ', '.join(names[:-1]) + ' and ' + names[-1]


def _method_addresses(method: dict) -> list[str]:
    return [a for a in (method.get('addresses') or []) if str(a).strip()]


def validate_substituted_service(ctx: dict) -> None:
    """Refuse a variant payload that cannot be checked against the order.

    Every refusal here is a term the practitioner must be able to line up
    against the order; a silently rendered gap is a filed affidavit that does
    not prove what it appears to prove.
    """
    parties = ctx.get('parties_served')
    if not isinstance(parties, list) or not parties:
        raise ValueError(
            'Substituted service requires parties_served: one entry per party '
            'named in the Rule 4-4 order, in the order\'s own party order.')

    served_docs = (ctx.get('filed_documents') or []) + (ctx.get('unfiled_documents') or [])
    if not any('order' in str(doc.get('description', '')).lower()
               for doc in served_docs):
        raise ValueError(
            'Rule 4-4(2) requires the entered order to be served with the '
            'document, so the order must appear among the documents served. '
            'No entry in filed_documents or unfiled_documents mentions it.')

    for party in parties:
        name = str(party.get('name', '')).strip()
        if not name:
            raise ValueError('Every parties_served entry needs a name.')
        methods = party.get('methods')
        if not isinstance(methods, list) or not methods:
            raise ValueError(
                f'{name} has no methods. Every party the order names must '
                f'carry the methods the order ordered for that party.')
        for method in methods:
            kind = str(method.get('kind', '')).strip().lower()
            if kind not in _METHOD_WORDING:
                raise ValueError(
                    f'{name}: method kind {method.get("kind")!r} is not one of '
                    f'{sorted(_METHOD_WORDING)}.')
            if not str(method.get('detail', '')).strip() and not _method_addresses(method):
                raise ValueError(
                    f'{name}: the {kind} method has no detail. Reproduce the '
                    f'address, number or wording exactly as the order spells it.')


def _render_method(method: dict, service_date: str) -> str:
    """The deposed act for one ordered method, without its address list."""
    kind = str(method['kind']).strip().lower()
    detail = str(method.get('detail', '')).strip()
    if kind == 'ordinary_mail' and _method_addresses(method):
        text = 'mailing the document by ordinary mail to:'
    else:
        text = _METHOD_WORDING[kind].format(detail=detail)
    date = str(method.get('date', '')).strip()
    if date and date != service_date:
        text += f', on {date}'
    return text


def _ordered_methods(party: dict) -> list[dict]:
    return [m for m in party['methods'] if m.get('ordered', True)]


def _courtesy_methods(party: dict) -> list[dict]:
    return [m for m in party['methods'] if not m.get('ordered', True)]


def build_compliance_table(context: dict) -> str:
    """The order ↔ affidavit comparison the practitioner checks after fill.

    Chat-only: it is never written into the document.
    """
    service_date = str(context.get('service_date', '')).strip()
    rows = ['| Order term | Deposed at |', '|---|---|']
    uncovered = 0
    section = 2
    p_index = 0
    for party in context['parties_served']:
        performed = [m for m in _ordered_methods(party) if m.get('performed', True)]
        letter = _exhibit_letter(p_index).lower() if performed else None
        if performed:
            p_index += 1
        m_index = 0
        for method in _ordered_methods(party):
            term = f'{party["name"]} — {_render_method(method, service_date)}'
            if method.get('performed', True):
                rows.append(f'| {term} | {section}({letter})({_ROMAN[m_index]}) |')
                m_index += 1
            else:
                uncovered += 1
                rows.append(f'| {term} | **NOT DEPOSED — order term uncovered** |')
    for party in context['parties_served']:
        for method in _courtesy_methods(party):
            rows.append(f'| *(no order term — courtesy)* | {party["name"]}: '
                        f'{_render_method(method, service_date)} |')
    verdict = ('All order terms are covered.' if not uncovered else
               f'{uncovered} order term(s) are NOT covered by a deposed act.')
    return '\n'.join(rows) + f'\n\n{verdict}'
