"""Phase 3: replace Part instruction paragraphs with pasted body content."""
from __future__ import annotations
import sys

from lxml import etree

from fill_ooxml import (
    _para_text, _make_numbered_para, _make_form33_para, _make_excerpt_para,
    _make_styled_para,
)


# Per-form markers that identify Part body instruction paragraphs (matched by startswith).
FORM_PART_MARKERS: dict[str, dict[str, str]] = {
    'noa': {
        'part1': '[Using numbered paragraphs, set out the order(s)',
        'part2': '[Using numbered paragraphs, set out a brief summary',
        'part3': '[Using paragraphs numbered sequentially from Part 2',
        'part4': '[Using numbered paragraphs, list the affidavits',
    },
    'nocc': {
        'part1': '[Set out the material facts giving rise to the claim',
        'part2': '[Set out the specific relief claimed',
        'part3': '[Set out the legal basis for the relief claimed',
    },
    'petition': {
        'part1': '[Using numbered paragraphs, set out the order(s)',
        'part2': '[Using numbered paragraphs, set out the material facts',
        'part3': '[Using paragraphs numbered sequentially from Part 2',
    },
    'rtc': {
        'part1': '[Using paragraphs numbered sequentially from Division 1',
        'part2': '[Using paragraphs numbered sequentially from Division 2',
        'part3': '[Using paragraphs numbered sequentially from Part 1',
    },
    'form-33': {
        'part1': '[set out paragraph numbers and any proposed terms]',
        'part4': '[Using numbered paragraphs, set out a brief summary of the material facts',
        'part5': '[Using paragraphs numbered sequentially from Part 4 above',
        'part6': '[Using numbered paragraphs, list the affidavits served with this application response',
    },
}


# Marker for the Part 2 citation instruction paragraph (NOA-only, separate,
# unnumbered, pStyle="Citation").  Removed when Part 2 content is inserted.
PART2_CITATION_MARKER = '[Include pinpoint citation'

# NOA blockquote lines (assembly-input-contract.md): `> ` is a quoted excerpt,
# `>> ` its citation, or in Part 2 an evidence reference.
NOA_EXCERPT_STYLE = 'Excerpt'
NOA_CITATION_STYLES = {'part2': 'EvidenceRef'}   # any other Part: 'Citation'


# ---------------------------------------------------------------------------
# Phase 3: Part body replacement
# ---------------------------------------------------------------------------


def replace_part_bodies(body: etree._Element, parts: dict[str, list[str]],
                        form: str = 'noa') -> None:
    """Replace Part instruction paragraphs with user-supplied content paragraphs.

    For each Part:
    - Locate the instruction paragraph by startswith marker
    - Clone its <w:pPr> (which carries numPr) as the template for new paragraphs
    - Remove instruction paragraph (and for Part 4, also the affidavit template line)
    - Insert one new <w:p> per user-supplied line at the same position

    Parts 2 and 3 share one numId in the template (Part 3's paragraphs reuse
    Part 2's num instance), so Word numbers them sequentially across both
    parts (BC court requirement).

    Blockquote and italics handling (NOA only):
    - The template has a separate citation instruction paragraph (pStyle="Citation")
      after the Part 2 instruction.  It is removed when Part 2 content is inserted.
    - A ``> `` line becomes an ``Excerpt`` paragraph; a ``>> `` line becomes an
      ``EvidenceRef`` paragraph in Part 2 and a ``Citation`` paragraph elsewhere.
    - Every ``*…*`` span becomes an italic run.
    """
    part_markers = FORM_PART_MARKERS.get(form, {})
    if not part_markers:
        return

    # Pre-scan: find the Part 2 citation instruction paragraph (NOA only)
    citation_instruction_para = None
    if form == 'noa':
        for para in body:
            if _para_text(para).startswith(PART2_CITATION_MARKER):
                citation_instruction_para = para
                break

    for part_key, marker in part_markers.items():
        content_lines = parts.get(part_key, [])
        # Scan current body children each time (indices shift after mutations)
        body_children = list(body)
        instruction_para = None
        instruction_idx = None
        for i, para in enumerate(body_children):
            if _para_text(para).startswith(marker):
                instruction_para = para
                instruction_idx = i
                break
        if instruction_para is None:
            if content_lines:
                print(
                    f"WARNING: no instruction paragraph found for {part_key} "
                    f"(marker: {marker!r}). User content for this part was NOT inserted.",
                    file=sys.stderr,
                )
            continue

        # For Part 4, the next sibling is the affidavit template line (numId=3).
        # Use that as the numPr template and remove it too.
        affidavit_template = None
        uses_affidavit_template = (
            (form == 'noa' and part_key == 'part4') or
            (form == 'form-33' and part_key == 'part6')
        )
        if uses_affidavit_template:
            next_siblings = list(body)[instruction_idx + 1:]
            for sib in next_siblings:
                sib_text = _para_text(sib)
                if 'Affidavit #' in sib_text:
                    affidavit_template = sib
                    break

        num_template = affidavit_template if affidavit_template is not None else instruction_para

        # Remove instruction and (for Part 4) affidavit template
        insert_idx = list(body).index(instruction_para)
        body.remove(instruction_para)
        if affidavit_template is not None:
            body.remove(affidavit_template)

        # For Part 2: also remove the citation instruction paragraph
        if part_key == 'part2' and citation_instruction_para is not None and content_lines:
            try:
                body.remove(citation_instruction_para)
            except ValueError:
                pass  # already removed or not found

        # Insert user paragraphs
        for j, line in enumerate(content_lines):
            if form == 'form-33' and line.startswith('> '):
                new_p = _make_excerpt_para(line[2:])
            elif form == 'noa' and line.startswith('>> '):
                new_p = _make_styled_para(
                    NOA_CITATION_STYLES.get(part_key, 'Citation'), line[3:], italics=True)
            elif form == 'noa' and line.startswith('> '):
                new_p = _make_styled_para(NOA_EXCERPT_STYLE, line[2:], italics=True)
            elif form == 'form-33':
                new_p = _make_form33_para(num_template, line)
            else:
                new_p = _make_numbered_para(num_template, line, italics=form == 'noa')
            body.insert(insert_idx + j, new_p)
