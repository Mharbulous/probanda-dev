"""Style-of-cause caption blocks: additional captions and per-name caption paragraphs."""
from __future__ import annotations
import sys

from lxml import etree

from fill_ooxml import WN, _para_text, _make_numbered_para


# Caption placeholders that take one paragraph per party name rather than a
# plain text substitution.  A raw "\n" written into a single <w:t> renders as a
# space in Word; the style guide requires one paragraph per name.
FORM_CAPTION_PLACEHOLDERS: dict[str, tuple[str, ...]] = {
    'noa':       ('[PLAINTIFF / PETITIONER NAME(S)]', '[DEFENDANT / RESPONDENT NAME(S)]'),
    'affidavit': ('[PLAINTIFF / PETITIONER NAME(S)]', '[DEFENDANT / RESPONDENT NAME(S)]'),
    'otsc':      ('[PLAINTIFF / PETITIONER NAME(S)]', '[DEFENDANT / RESPONDENT NAME(S)]'),
    'afs':       ('[PLAINTIFF / PETITIONER NAME(S)]', '[DEFENDANT / RESPONDENT NAME(S)]'),
    'aos':       ('[PLAINTIFF / PETITIONER NAME(S)]', '[DEFENDANT / RESPONDENT NAME(S)]'),
    'rtc':       ('[PLAINTIFF / PETITIONER NAME(S)]', '[DEFENDANT / RESPONDENT NAME(S)]'),
    'nocc':      ('[PLAINTIFF NAME(S)]', '[DEFENDANT NAME(S)]'),
    'petition':  ('[PETITIONER NAME(S)]', '[RESPONDENT NAME(S)]'),
    'form-33':   ('[CAPTION ORIGINATING PARTY]', '[CAPTION RESPONDING PARTY]'),
    'form-17':   ('[PLAINTIFF / PETITIONER NAME(S)]', '[DEFENDANT / RESPONDENT NAME(S)]'),
    'form-8':    ('[PLAINTIFF / PETITIONER NAME(S)]', '[DEFENDANT / RESPONDENT NAME(S)]'),
}

# The caption role paragraph each form's extra style-of-cause parties are
# inserted after.  Phase 1.5 runs before text substitution, so a form whose
# template carries no role placeholder (nocc) anchors on its literal role text.
# Every form registered in _SUBS_BUILDERS needs an entry: a form missing here
# raises rather than dropping its additional captions.
FORM_CAPTION_ROLE_ANCHORS: dict[str, str] = {
    'noa':       '[DEFENDANT]',
    'nocc':      'Defendant(s)',
    'rtc':       '[DEFENDANT]',
    'petition':  '[RESPONDENT]',
    'otsc':      '[DEFENDANT]',
    'affidavit': '[DEFENDANT]',
    'afs':       '[DEFENDANT]',
    'aos':       '[DEFENDANT]',
    'form-33':   '[RESPONDING PARTY]',
    'form-17':   '[DEFENDANT]',
    'form-8':    '[DEFENDANT]',
}


def _insert_additional_captions(body: etree._Element, form: str,
                                additional_captions: list[dict]) -> None:
    """Insert extra style-of-cause blocks (e.g. a counterclaim defendant)
    after the form's own responding-party caption, before scalar
    substitution runs.

    Locates the template's own "AND / names / role" trio ending at the
    paragraph carrying this form's FORM_CAPTION_ROLE_ANCHORS entry and
    clones its formatting for each additional party, so a third (or
    fourth) party is captioned correctly.

    Raises ValueError when captions are supplied that cannot be placed —
    the form has no anchor registered, or its template does not carry the
    anchor where the trio sits. A party missing from a filed style of
    cause is too expensive to drop silently.
    """
    if not additional_captions:
        return
    if form not in FORM_CAPTION_ROLE_ANCHORS:
        raise ValueError(
            f'Form {form!r} has no caption role anchor registered, so its '
            f'{len(additional_captions)} additional caption(s) cannot be '
            f'placed. Add an entry to FORM_CAPTION_ROLE_ANCHORS.'
        )
    anchor = FORM_CAPTION_ROLE_ANCHORS[form]
    children = list(body)
    anchor_idx = None
    for i, para in enumerate(children):
        if _para_text(para) == anchor:
            anchor_idx = i
            break
    if anchor_idx is None or anchor_idx < 2:
        raise ValueError(
            f'Form {form!r}: caption role paragraph {anchor!r} was not found '
            f'in the template above a complete and/names/role trio, so its '
            f'{len(additional_captions)} additional caption(s) cannot be '
            f'placed.'
        )
    and_template = children[anchor_idx - 2]
    names_template = children[anchor_idx - 1]
    role_template = children[anchor_idx]

    insert_idx = anchor_idx + 1
    for entry in additional_captions:
        and_p = _make_numbered_para(and_template, "and")
        names_p = _make_numbered_para(
            names_template,
            _join_party_names(
                [n.strip() for n in entry["caption"].split('\n') if n.strip()]
            ),
        )
        _indent_caption_names(names_p)
        role_p = _make_numbered_para(role_template, entry["role_label"])
        body.insert(insert_idx, and_p)
        body.insert(insert_idx + 1, names_p)
        body.insert(insert_idx + 2, role_p)
        insert_idx += 3


# ---------------------------------------------------------------------------
# Form-33 caption block insertion
# ---------------------------------------------------------------------------

CAPTION_NAME_INDENT_TWIPS = 1134  # 2 cm each side, symmetric so centring holds

# w:ind must precede w:jc and w:rPr inside w:pPr under the WordprocessingML
# schema.  Word has already rejected one malformed package in this skill, so
# insert in schema order rather than appending.
_PPR_AFTER_IND = ('jc', 'rPr', 'sectPr')


def _join_party_names(names: list[str]) -> str:
    """Join a role group's parties into one prose list.

    Comma separated, with a serial comma before the final ``and`` at every
    count including two.  The separator is a lower-case literal and is never
    derived from a name, so a party whose own name contains ``AND`` keeps it
    upper case: ``SMITH AND SONS LTD., and BETA LTD.``  Names arrive already
    upper-cased per name from the proceedings profile, so nothing here may
    change their case.
    """
    if not names:
        return ''
    if len(names) == 1:
        return names[0]
    return ', '.join(names[:-1]) + ', and ' + names[-1]


def _indent_caption_names(paragraph: etree._Element) -> None:
    """Narrow the measure of a caption names paragraph so a long list wraps.

    Applied at every party count.  Symmetric indents centre at the same point
    as none, so a single short name is unaffected.
    """
    ppr = paragraph.find(WN('pPr'))
    if ppr is None:
        ppr = etree.Element(WN('pPr'))
        paragraph.insert(0, ppr)
    ind = ppr.find(WN('ind'))
    if ind is None:
        ind = etree.Element(WN('ind'))
        follower = next(
            (child for child in ppr
             if etree.QName(child).localname in _PPR_AFTER_IND),
            None,
        )
        if follower is None:
            ppr.append(ind)
        else:
            ppr.insert(list(ppr).index(follower), ind)
    ind.set(WN('left'), str(CAPTION_NAME_INDENT_TWIPS))
    ind.set(WN('right'), str(CAPTION_NAME_INDENT_TWIPS))


def _insert_caption_names(body: etree._Element, placeholder: str,
                          names_text: str) -> None:
    """Replace a caption placeholder with the role group's parties run together.

    Names arrive one per line and render as a single indented paragraph, not
    one paragraph per name.
    """
    target_para = None
    target_t = None
    for para in body.iter(WN('p')):
        for t in para.iter(WN('t')):
            if t.text and placeholder in t.text:
                target_para = para
                target_t = t
                break
        if target_para is not None:
            break

    if target_para is None:
        print(f"WARNING: caption placeholder never matched: {placeholder}",
              file=sys.stderr)
        return

    names = [n.strip() for n in names_text.split('\n') if n.strip()]
    target_t.text = target_t.text.replace(placeholder, _join_party_names(names))
    _indent_caption_names(target_para)
