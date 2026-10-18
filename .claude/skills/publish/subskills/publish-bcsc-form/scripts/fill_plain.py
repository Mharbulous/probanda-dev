"""Fill a bracket-placeholder template with matter profile and body content.

Usage:
    python fill_plain.py --context context.json --body body.txt --out output.docx

Default template:
    skills/publish/subskills/publish-bcsc-form/templates/032-noa.dotx
"""
from __future__ import annotations
import argparse
import json
import sys
import zipfile
from pathlib import Path

from lxml import etree

# Re-exported: callers and tests import these from fill_plain.
from fill_ooxml import (
    W, XMLSPACE, WN, _para_text, _make_numbered_para, _make_form33_para,
    _make_styled_para, _make_excerpt_para, rewrite_content_types,
)
from fill_text import (
    LEAVE_BLANK, merge_split_run_placeholders, substitute_text,
    substitute_form33_position_sentences, parse_body,
)
from fill_parts import (
    FORM_PART_MARKERS, PART2_CITATION_MARKER, replace_part_bodies,
)
from fill_captions import (
    FORM_CAPTION_PLACEHOLDERS, FORM_CAPTION_ROLE_ANCHORS,
    _insert_additional_captions, CAPTION_NAME_INDENT_TWIPS, _PPR_AFTER_IND,
    _join_party_names, _indent_caption_names, _insert_caption_names,
)
from fill_subs import (
    _subs_if_present, _COMMON, _STANDARD_PARTIES, _COURT_ADDRESS, _FIRM,
    _firm_subs, _ASSOCIATE_JUDGE_SENTENCE, _NOT_ASSOCIATE_JUDGE_SENTENCE,
    build_subs, build_subs_nocc, build_subs_rtc, build_subs_petition,
    build_subs_otsc, _FORM17_AFFIDAVIT_LINE, _FORM8_DAMAGES_SENTENCE,
    _FORM8_COSTS_SENTENCE, build_subs_form17, build_subs_form8,
)
from fill_subs_form33 import _format_party_list, build_subs_form33
from fill_subs_affidavits import (
    build_subs_affidavit, _subs_service_affidavit_common, _subs_service_facts,
    build_subs_afs, build_subs_aos,
)
from fill_appendix import mark_appendix_boxes
from fill_jurat import (
    _clear_footers, _find_jurat_index, _inject_keep_next_before_jurat,
    _remove_interpreter_endorsement,
)
from fill_blocks import (
    BLOCK_END, _find_marked_block, _remove_marked_block, _unwrap_marked_block,
    _repeat_marked_block, _strip_block_markers, _exhibit_letter,
    _fill_exhibit_block, _fill_affidavit_paragraphs, _elect_block,
)
from fill_subserv import (
    _AOS_TITLE, _AOS_TITLE_SUBSTITUTED, _AOS_SECTION1_LEAD, _AOS_SECTION2_LEAD,
    _AOS_SECTION2_LEAD_SUBSTITUTED, _IND_PARTY, _IND_METHOD, _IND_ADDRESS,
    _ROMAN, _METHOD_WORDING, is_substituted_service, _join_names,
    _method_addresses, validate_substituted_service, _render_method,
    _ordered_methods, _courtesy_methods, build_compliance_table,
)
from fill_service_blocks import (
    _IDENTIFICATION_BLOCKS, _SERVICE_METHOD_BLOCKS, _make_indented_para,
    _make_service_numbered_para, _build_mirrored_section2,
    _build_trailing_paragraphs, _renumber_service_paragraphs,
    _fill_substituted_service_section, _fill_service_affidavit_blocks,
)

HERE = Path(__file__).resolve().parent            # scripts/
SKILL_ROOT = HERE.parent                           # publish-bcsc-form/
TEMPLATE = SKILL_ROOT / 'templates' / '032-noa.dotx'


def _require_renderable_party_profile(context: dict, require_contract: bool) -> None:
    if require_contract and 'correction_required' not in context:
        raise RuntimeError(
            'Validated party-role profile is unavailable; run /matter-data '
            'proceedings-profile before rendering.'
        )
    if context.get('correction_required'):
        raise RuntimeError(
            'Party-role correction required; run /matter-data '
            'proceedings-profile before rendering.'
        )


# ---------------------------------------------------------------------------
# Main fill routine
# ---------------------------------------------------------------------------

def fill(template_path: Path, context: dict, body_text: str, out_path: Path,
         form: str = 'noa') -> None:
    _require_renderable_party_profile(context, require_contract=form == 'noa')
    with zipfile.ZipFile(template_path) as zin:
        members = {n: zin.read(n) for n in zin.namelist()}

    root = etree.fromstring(members['word/document.xml'])
    body = root.find(WN('body'))

    _SUBS_BUILDERS = {
        'noa':       build_subs,
        'nocc':      build_subs_nocc,
        'rtc':       build_subs_rtc,
        'petition':  build_subs_petition,
        'otsc':      build_subs_otsc,
        'affidavit': build_subs_affidavit,
        'afs':       build_subs_afs,
        'aos':       build_subs_aos,
        'form-33':   build_subs_form33,
        'form-17':   build_subs_form17,
        'form-8':    build_subs_form8,
    }
    subs = _SUBS_BUILDERS[form](context)
    subs = {k: str(v) for k, v in subs.items()}

    # Phase 1: merge split-run placeholders before text substitution
    for para in body.iter(WN('p')):
        merge_split_run_placeholders(para)

    # Phase 1.5: insert extra style-of-cause parties (e.g. a counterclaim
    # defendant) into this form's caption block, at its own role anchor
    _insert_additional_captions(body, form,
                                context.get('additional_captions') or [])

    # Phase 2: substitute scalars
    # Pop caption placeholders — they need multi-paragraph insertion, not text substitution
    captions = [(ph, subs.pop(ph)) for ph in FORM_CAPTION_PLACEHOLDERS.get(form, ())
                if ph in subs]
    if form == 'form-33':
        substitute_form33_position_sentences(body, subs)
    substitute_text(body, subs)

    # Phase 2a: caption block — one paragraph per party name
    for placeholder, names_text in captions:
        _insert_caption_names(body, placeholder, names_text)

    # Phase 3: replace Part instruction paragraphs with user content
    # When no body text is provided (Generate form mode), instruction text is preserved.
    if body_text:
        parts = parse_body(body_text)
        replace_part_bodies(body, parts, form=form)

    # Phase 3a: Form 32's Appendix boxes, when asm32's form-32.md names them.
    # A context without the key (a Generate fill) leaves every box blank.
    if form == 'noa' and 'appendix_types' in context:
        mark_appendix_boxes(body, context['appendix_types'])

    # Phase 4: affidavit post-processing (Forms 109, 15 and 16)
    if form in ('affidavit', 'afs', 'aos'):
        _clear_footers(members)
        if form in ('afs', 'aos'):
            _fill_service_affidavit_blocks(body, context, form)
        # asmaff's emitted paragraphs replace the exhibit block outright, so
        # the exhibit fill below then finds no block and does nothing.
        # Both run first: keepNext must land on the last generated paragraph.
        if context.get('affidavit_paragraphs'):
            _fill_affidavit_paragraphs(body, context['affidavit_paragraphs'])
        _fill_exhibit_block(body, context)
        _inject_keep_next_before_jurat(body)
        # Forms 15 and 16 carry no Rule 22-2(7) interpreter endorsement.
        if form == 'affidavit':
            interpreter = context.get('interpreter_required', 'no')
            if str(interpreter).strip().lower() not in ('yes', 'true', '1'):
                _remove_interpreter_endorsement(body)

    _strip_block_markers(body)

    members['word/document.xml'] = etree.tostring(
        root, xml_declaration=True, encoding='UTF-8', standalone=True)

    rewrite_content_types(members)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    if out_path.exists():
        out_path.unlink()
    with zipfile.ZipFile(out_path, 'w', zipfile.ZIP_DEFLATED) as zout:
        for name, data in members.items():
            zout.writestr(name, data)

    print(f"Written: {out_path}")


def main() -> int:
    p = argparse.ArgumentParser(description='Fill a bracket-placeholder .dotx with matter data.')
    p.add_argument('--context',  required=True, help='Path to JSON matter context file')
    p.add_argument('--body',     default=None, help='Path to body paste text file (omit to keep instruction text)')
    p.add_argument('--out',      required=True, help='Output .docx path')
    p.add_argument('--template', default=None,
                   help='Path to template (default: templates/032-noa.docx)')
    p.add_argument('--form', default='noa',
                   help=('Form type: noa, affidavit, petition, nocc, otsc, rtc, '
                         'form-17, form-8 (default: noa)'))
    args = p.parse_args()

    template_path = Path(args.template) if args.template else TEMPLATE

    context = json.loads(
        Path(args.context).read_bytes().rstrip(b"\x00").decode("utf-8"))
    body_text = ''
    if args.body:
        with open(args.body, encoding='utf-8') as f:
            body_text = f.read()

    fill(template_path, context, body_text, Path(args.out), form=args.form)
    if args.form == 'aos' and is_substituted_service(context):
        print('\n' + build_compliance_table(context))
    return 0


if __name__ == '__main__':
    sys.exit(main())
