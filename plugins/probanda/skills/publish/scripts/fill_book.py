"""Validate and fill the BCCA response-book / BOA documents.

Four documents when the file carries the response-book half, two (the Book of
Authorities' cover and table of contents) when it does not -- see
references/bcca-book-contract.md's "Scope".

Grammar, error codes and the invocation contract are owned by
references/bcca-book-contract.md (SSOT) -- do not restate the rules here
beyond what the code needs to enforce them.

Usage:
    python fill_book.py --validate <bcca-book.md path>
    python fill_book.py <bcca-book.md path> <output-dir>

Both modes print one JSON line per the contract's "Validator error codes"
and "CLI acceptance oracle" sections: {"success": true} (plus, on a fill
run, one further JSON line per document written) or
{"success": false, "error": "<code>", "detail": "..."} -- never a Python
traceback. Exit 0 on pass, non-zero on any rejection, mirroring
publish-bcsc-form's harness.py validate32/validate33 precedent.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path

from lxml import etree

from docx_helpers import (
    load_zip,
    make_para,
    para_text,
    rewrite_content_types_to_document,
    save_zip,
    set_run_text,
    substitute_text,
    wn,
)
from ordinal_date import format_ordinal_date

HERE = Path(__file__).resolve().parent
SKILL_ROOT = HERE.parent


def format_name_list(names: list[str]) -> str:
    """"A" / "A and B" / "A, B, and C" -- same join rule as the mockup renderer's
    formatNameList (plugins/litigation/mcp/src/submission/forms/components.ts), so a
    two- or three-party group reads the same way on the filed cover as it does
    on the mockup the practitioner already reviewed."""
    if len(names) == 1:
        return names[0]
    if len(names) == 2:
        return f'{names[0]} and {names[1]}'
    return f'{", ".join(names[:-1])}, and {names[-1]}'
TEMPLATES = SKILL_ROOT / 'templates'
COVER_TEMPLATE = TEMPLATES / 'bcca-book-cover.dotx'
RESPONSE_TOC_TEMPLATE = TEMPLATES / 'bcca-book-toc.docx'
BOA_TOC_TEMPLATE = TEMPLATES / 'bcca-boa-toc.docx'

OUTPUT_NAMES = {
    'response_book_cover': "1. Cover Page Response Book.docx",
    'response_book_toc': "2. Table of Contents Response Book.docx",
    'boa_cover': "1. Cover Page BOA.docx",
    'boa_toc': "2. Table of Contents (BOA).docx",
}


class ValidationError(Exception):
    def __init__(self, code: str, detail: str):
        self.code = code
        self.detail = detail
        super().__init__(f'{code}: {detail}')


# ---------------------------------------------------------------------------
# Grammar (bcca-book-contract.md "Frontmatter" table)
# ---------------------------------------------------------------------------

# Order matters here: on a fill with several required keys missing, the
# first-in-table-order absent key is the one reported, deterministically.
_REQUIRED_KEYS = (
    'file_number', 'registry', 'short_style',
    'boa_record_label', 'boa_title',
    'party_groups', 'contacts',
    'boa_toc', 'boa_parts',
)
# The response-book half is optional and all-or-nothing: a bcca_stay_response
# book carries all four, a bcca_factum book (whose only book is the Book of
# Authorities) carries none, and a partial group rejects.
_RESPONSE_BOOK_KEYS = (
    'response_book_record_label', 'response_book_title',
    'response_book_toc', 'response_book_parts',
)
_OPTIONAL_KEYS = (
    'under_appeal_judge', 'under_appeal_court', 'under_appeal_pronounced',
    'access_restrictions', 'filing_party_phrase',
)
_JSON_KEYS = {
    'access_restrictions', 'party_groups', 'contacts',
    'response_book_toc', 'response_book_parts', 'boa_toc', 'boa_parts',
}
_KNOWN_KEYS = set(_REQUIRED_KEYS) | set(_RESPONSE_BOOK_KEYS) | set(_OPTIONAL_KEYS)


def _validate_toc_rows(rows, field: str, allowed_keys: set[str],
                        required_keys: set[str], check_indent: bool) -> None:
    if not isinstance(rows, list):
        raise ValidationError('bad_toc_row', f'{field} must be a JSON array')
    for row in rows:
        if not isinstance(row, dict):
            raise ValidationError('bad_toc_row', f'{field} entry is not an object: {row!r}')
        keys = set(row.keys())
        if keys - allowed_keys:
            raise ValidationError(
                'bad_toc_row',
                f'{field} entry carries unknown key(s) {sorted(keys - allowed_keys)}: {row!r}')
        if required_keys - keys:
            raise ValidationError(
                'bad_toc_row',
                f'{field} entry missing required key(s) '
                f'{sorted(required_keys - keys)}: {row!r}')
        text_field = 'text' if 'text' in row else 'authority'
        if not isinstance(row.get(text_field), str) or not row[text_field].strip():
            raise ValidationError(
                'bad_toc_row', f'{field} entry {text_field!r} must be a non-empty string: {row!r}')
        if 'citation' in row and row['citation'] is not None and not isinstance(row['citation'], str):
            raise ValidationError(
                'bad_toc_row', f'{field} entry citation must be a string or null: {row!r}')
        if check_indent and row.get('indent') not in (0, 1, 2):
            raise ValidationError(
                'bad_indent', f'{field} entry indent must be 0, 1, or 2: {row!r}')


def _validate_parts(parts, field: str) -> None:
    if not isinstance(parts, list):
        raise ValidationError('bad_parts', f'{field} must be a JSON array')
    for part in parts:
        if (not isinstance(part, dict) or set(part) != {'bookmark'}
                or not isinstance(part['bookmark'], str) or not part['bookmark'].strip()):
            raise ValidationError('bad_parts', f'{field} entry must be {{"bookmark": "<non-empty text>"}}: {part!r}')


def validate_part_refs(rows: list[dict], field: str, part_count: int) -> None:
    """Every row's part is a parts index, "cover", "toc" or null (bcca-book-contract.md)."""
    for row in rows:
        if not isinstance(row, dict) or 'part' not in row:
            raise ValidationError('bad_toc_row', f'{field} entry missing "part": {row!r}')
        ref = row['part']
        is_index = isinstance(ref, int) and not isinstance(ref, bool) and 0 <= ref < part_count
        if not (is_index or ref in ('cover', 'toc') or ref is None):
            raise ValidationError('bad_part_ref',
                                  f'{field} entry part must be a parts index, "cover", "toc" or null: {row!r}')


def _validate_party_groups(party_groups) -> None:
    if not isinstance(party_groups, list) or not party_groups:
        raise ValidationError('bad_party_group', 'party_groups must be a non-empty JSON array')
    allowed = {'role', 'names', 'lower_court_role'}
    required = {'role', 'names'}
    for group in party_groups:
        if not isinstance(group, dict):
            raise ValidationError('bad_party_group', f'party_groups entry is not an object: {group!r}')
        keys = set(group.keys())
        if keys - allowed:
            raise ValidationError(
                'bad_party_group',
                f'party_groups entry carries unknown key(s) {sorted(keys - allowed)}: {group!r}')
        if required - keys:
            raise ValidationError(
                'bad_party_group',
                f'party_groups entry missing required key(s) {sorted(required - keys)}: {group!r}')
        if not isinstance(group['role'], str) or not group['role'].strip():
            raise ValidationError('bad_party_group', f'party_groups entry role must be a non-empty string: {group!r}')
        if not isinstance(group['names'], list) or not group['names']:
            raise ValidationError('bad_party_group', f'party_groups entry names must be a non-empty array: {group!r}')


def _validate_contacts(contacts, party_groups) -> None:
    if not isinstance(contacts, list):
        raise ValidationError('bad_contact', 'contacts must be a JSON array')
    allowed = {'role', 'names', 'counsel_name', 'counsel_firm', 'address', 'phone', 'email'}
    required = {'role', 'names'}
    for contact in contacts:
        if not isinstance(contact, dict):
            raise ValidationError('bad_contact', f'contacts entry is not an object: {contact!r}')
        keys = set(contact.keys())
        if keys - allowed:
            raise ValidationError(
                'bad_contact',
                f'contacts entry carries unknown key(s) {sorted(keys - allowed)}: {contact!r}')
        if required - keys:
            raise ValidationError(
                'bad_contact',
                f'contacts entry missing required key(s) {sorted(required - keys)}: {contact!r}')
    if len(contacts) != len(party_groups):
        raise ValidationError(
            'bad_contact',
            f'contacts has {len(contacts)} entries but party_groups has '
            f'{len(party_groups)}; the contract requires one contacts entry '
            f'per party_groups role, same order')
    for i, (group, contact) in enumerate(zip(party_groups, contacts)):
        if isinstance(group, dict) and isinstance(contact, dict) and group.get('role') != contact.get('role'):
            raise ValidationError(
                'bad_contact',
                f'contacts[{i}].role {contact.get("role")!r} does not match '
                f'party_groups[{i}].role {group.get("role")!r}')


def _validate_access_restrictions(value) -> None:
    if not isinstance(value, list) or not value:
        raise ValidationError(
            'bad_access_restrictions',
            'access_restrictions must be a non-empty JSON array of strings when present')
    if not all(isinstance(v, str) and v.strip() for v in value):
        raise ValidationError(
            'bad_access_restrictions',
            f'access_restrictions entries must all be non-empty strings: {value!r}')


def parse_bcca_book(text: str) -> dict:
    lines = text.splitlines()
    if not lines or lines[0].strip() != '---':
        raise ValidationError('missing_frontmatter', 'file does not start with a --- frontmatter fence')

    close_idx = None
    for i in range(1, len(lines)):
        if lines[i].strip() == '---':
            close_idx = i
            break
    if close_idx is None:
        raise ValidationError('missing_frontmatter', 'no closing --- fence found')

    raw: dict[str, str] = {}
    for line in lines[1:close_idx]:
        if not line.strip():
            continue
        if ':' not in line:
            raise ValidationError('missing_frontmatter', f'malformed frontmatter line: {line!r}')
        key, _, value = line.partition(':')
        key = key.strip()
        value = value.strip()
        if key not in _KNOWN_KEYS:
            raise ValidationError('unknown_key', f'unknown frontmatter key: {key!r}')
        if key in raw:
            raise ValidationError('duplicate_key', f'duplicate frontmatter key: {key!r}')
        raw[key] = value

    for key in _REQUIRED_KEYS:
        if key not in raw:
            raise ValidationError('missing_required_key', f'missing required key: {key!r}')

    response_present = [k for k in _RESPONSE_BOOK_KEYS if k in raw]
    if response_present and len(response_present) != len(_RESPONSE_BOOK_KEYS):
        missing = [k for k in _RESPONSE_BOOK_KEYS if k not in raw]
        raise ValidationError(
            'partial_response_book',
            f'the response-book keys are all-or-nothing: {response_present} present, '
            f'{missing} missing. Carry all four or none.')
    has_response_book = bool(response_present)

    data: dict = {}
    for key, value in raw.items():
        if key in _JSON_KEYS:
            try:
                data[key] = json.loads(value)
            except json.JSONDecodeError as e:
                raise ValidationError('invalid_json', f'{key}: {e}')
        else:
            data[key] = value

    if has_response_book:
        _validate_toc_rows(data['response_book_toc'], 'response_book_toc',
                            allowed_keys={'text', 'indent', 'part'}, required_keys={'text', 'indent', 'part'},
                            check_indent=True)
    _validate_toc_rows(data['boa_toc'], 'boa_toc',
                        allowed_keys={'authority', 'citation', 'part'},
                        required_keys={'authority', 'citation', 'part'},
                        check_indent=False)
    toc_parts_pairs = ([('response_book_toc', 'response_book_parts')] if has_response_book else []) \
        + [('boa_toc', 'boa_parts')]
    for toc_key, parts_key in toc_parts_pairs:
        _validate_parts(data[parts_key], parts_key)
        validate_part_refs(data[toc_key], toc_key, len(data[parts_key]))
    _validate_party_groups(data['party_groups'])
    _validate_contacts(data['contacts'], data['party_groups'])
    if 'access_restrictions' in data:
        _validate_access_restrictions(data['access_restrictions'])

    if 'under_appeal_pronounced' in data:
        try:
            format_ordinal_date(data['under_appeal_pronounced'])
        except ValueError as e:
            raise ValidationError('invalid_json', f'under_appeal_pronounced is not an ISO date: {e}')

    body_after = '\n'.join(lines[close_idx + 1:])
    if body_after.strip():
        raise ValidationError('nonblank_body', 'non-blank content after closing frontmatter fence')

    return data


# ---------------------------------------------------------------------------
# Cover fill (shared by the Response Book cover and the BOA cover)
# ---------------------------------------------------------------------------

def _fill_on_appeal_from(body: etree._Element, data: dict) -> None:
    judge = data.get('under_appeal_judge')
    court = data.get('under_appeal_court')
    pronounced = data.get('under_appeal_pronounced')
    para = None
    for p in body.iter(wn('p')):
        if para_text(p).startswith('ON APPEAL FROM'):
            para = p
            break
    if para is None:
        return
    if not (judge and court and pronounced):
        para.getparent().remove(para)
        return
    substitute_text(body, {
        '[UNDER APPEAL JUDGE]': judge,
        '[UNDER APPEAL COURT]': court,
        '[UNDER APPEAL PRONOUNCED]': format_ordinal_date(pronounced),
    })


def _fill_party_groups(body: etree._Element, party_groups: list[dict]) -> None:
    all_paras = [p for p in body.iter(wn('p'))]
    between_idx = next(i for i, p in enumerate(all_paras) if para_text(p).strip() == 'BETWEEN:')
    and_idx = next(i for i, p in enumerate(all_paras) if para_text(p).strip() == 'AND:')
    between_block = all_paras[between_idx:between_idx + 4]
    and_block = all_paras[and_idx:and_idx + 4]

    label_ppr = between_block[0].find(wn('pPr'))
    names_ppr = between_block[1].find(wn('pPr'))
    role_ppr = between_block[2].find(wn('pPr'))
    subrole_ppr = between_block[3].find(wn('pPr'))

    anchor = between_block[0].getparent()
    insert_idx = list(anchor).index(between_block[0])
    for p in between_block + and_block:
        anchor.remove(p)

    new_paras: list[etree._Element] = []
    for i, group in enumerate(party_groups):
        label = 'BETWEEN:' if i == 0 else 'AND:'
        # Uppercased -- matches tpl_ca_book_cover_page.dotx's own BETWEEN/AND block
        # convention (confirmed against the practitioner's exemplar cover pages);
        # every other name-list spot on the cover (contacts table, filing-party
        # phrase) stays normal case.
        names_text = format_name_list(group['names']).upper()
        new_paras.append(make_para(label, label_ppr))
        new_paras.append(make_para(names_text, names_ppr, bold=True))
        new_paras.append(make_para(group['role'], role_ppr, bold=True))
        lower_court_role = group.get('lower_court_role')
        if lower_court_role:
            new_paras.append(make_para(f'({lower_court_role})', subrole_ppr))

    for offset, p in enumerate(new_paras):
        anchor.insert(insert_idx + offset, p)


def _fill_access_restrictions(body: etree._Element, restrictions: list[str] | None) -> None:
    para = None
    for p in body.iter(wn('p')):
        if para_text(p).strip() == '[ACCESS RESTRICTION LINE]':
            para = p
            break
    if para is None:
        return
    parent = para.getparent()
    insert_idx = list(parent).index(para)
    ppr = para.find(wn('pPr'))
    parent.remove(para)
    if not restrictions:
        return
    for offset, line in enumerate(restrictions):
        parent.insert(insert_idx + offset, make_para(line, ppr))


def _fill_record_title(body: etree._Element, title: str, filing_party_phrase: str | None) -> None:
    substitute_text(body, {'[RECORD TITLE]': title})
    para = None
    for p in body.iter(wn('p')):
        if para_text(p).strip() == '[FILING PARTY PHRASE]':
            para = p
            break
    if para is None:
        return
    if not filing_party_phrase:
        para.getparent().remove(para)
        return
    substitute_text(body, {'[FILING PARTY PHRASE]': filing_party_phrase})


def _fill_contacts(body: etree._Element, contacts: list[dict]) -> None:
    """Populate the cover's two-column contact table.

    The court template's contact table is fixed at two columns (appellant
    side | respondent side); the contract allows more than two contacts
    entries (one per party_groups role, for a side split across several
    lower-court-role blocks). v1 renders the *first* and *last* contacts
    entries into the two columns -- the two ends of the party list, which
    covers every case observed so far (exactly two sides, each a single
    contacts entry) and degrades sensibly rather than silently dropping a
    side when there are more than two.
    """
    tbl = next(body.iter(wn('tbl')))
    row = tbl.find(wn('tr'))
    cells = row.findall(wn('tc'))
    left_contact = contacts[0]
    right_contact = contacts[-1]

    for cell, contact in zip(cells, (left_contact, right_contact)):
        template_p = cell.find(wn('p'))
        ppr = template_p.find(wn('pPr'))
        for child in list(cell):
            if child.tag != wn('tcPr'):
                cell.remove(child)

        lines: list[tuple[str, bool]] = []
        lines.append((format_name_list(contact['names']), False))
        if contact.get('counsel_name'):
            lines.append((contact['counsel_name'], False))
        if contact.get('counsel_firm'):
            lines.append((contact['counsel_firm'], False))
        if contact.get('address'):
            for line in str(contact['address']).splitlines():
                if line.strip():
                    lines.append((line.strip(), False))
        if contact.get('phone'):
            lines.append((f"Telephone: {contact['phone']}", False))
        if contact.get('email'):
            lines.append((f"E-mail: {contact['email']}", False))
        lines.append((f"Counsel for the {contact['role']}", False))

        for text, bold in lines:
            cell.append(make_para(text, ppr, bold=bold))


def build_cover(data: dict, kind: str, out_path: Path) -> None:
    """kind is 'response_book' or 'boa'."""
    members = load_zip(COVER_TEMPLATE)
    root = etree.fromstring(members['word/document.xml'])
    body = root.find(wn('body'))

    substitute_text(body, {
        '[COURT FILE NUMBER]': data['file_number'],
        '[SHORT STYLE]': data['short_style'],
        '[RECORD LABEL]': data[f'{kind}_record_label'],
    })

    _fill_on_appeal_from(body, data)
    _fill_party_groups(body, data['party_groups'])
    _fill_access_restrictions(body, data.get('access_restrictions'))
    _fill_record_title(body, data[f'{kind}_title'], data.get('filing_party_phrase'))
    _fill_contacts(body, data['contacts'])

    members['word/document.xml'] = etree.tostring(
        root, xml_declaration=True, encoding='UTF-8', standalone=True)
    rewrite_content_types_to_document(members)
    save_zip(members, out_path)


# ---------------------------------------------------------------------------
# TOC fill (Response Book and BOA share the row-cloning mechanism)
# ---------------------------------------------------------------------------

_INDENT_TWIPS = {0: 720, 1: 1440, 2: 2160}


def build_response_toc(rows: list[dict], out_path: Path, pages: list[str] | None = None) -> None:
    """pages, when given, holds one page-cell string per row (scripts/paginate_book.py
    back-fills them); None leaves every page cell blank."""
    members = load_zip(RESPONSE_TOC_TEMPLATE)
    root = etree.fromstring(members['word/document.xml'])
    body = root.find(wn('body'))
    tbl = next(body.iter(wn('tbl')))
    header_row, template_row = tbl.findall(wn('tr'))
    tbl.remove(template_row)

    for i, entry in enumerate(rows):
        clone = _clone_element(template_row)
        item_cell, page_cell = clone.findall(wn('tc'))
        item_p = item_cell.find(wn('p'))
        ppr = item_p.find(wn('pPr'))
        ind = ppr.find(wn('ind'))
        ind.set(wn('left'), str(_INDENT_TWIPS[entry['indent']]))
        set_run_text(item_p.find(wn('r')), entry['text'])
        if pages is not None:
            set_run_text(page_cell.find(wn('p')).find(wn('r')), pages[i])
        tbl.append(clone)

    members['word/document.xml'] = etree.tostring(
        root, xml_declaration=True, encoding='UTF-8', standalone=True)
    save_zip(members, out_path)


def build_boa_toc(rows: list[dict], out_path: Path, pages: list[str] | None = None) -> None:
    """pages: same meaning as in build_response_toc."""
    members = load_zip(BOA_TOC_TEMPLATE)
    root = etree.fromstring(members['word/document.xml'])
    body = root.find(wn('body'))
    tbl = next(body.iter(wn('tbl')))
    header_row, template_row = tbl.findall(wn('tr'))
    tbl.remove(template_row)

    for i, entry in enumerate(rows):
        clone = _clone_element(template_row)
        authority_cell, page_cell = clone.findall(wn('tc'))
        text = entry['authority']
        if entry.get('citation'):
            text = f"{text}, {entry['citation']}"
        set_run_text(authority_cell.find(wn('p')).find(wn('r')), text)
        if pages is not None:
            set_run_text(page_cell.find(wn('p')).find(wn('r')), pages[i])
        tbl.append(clone)

    members['word/document.xml'] = etree.tostring(
        root, xml_declaration=True, encoding='UTF-8', standalone=True)
    save_zip(members, out_path)


def _clone_element(el: etree._Element) -> etree._Element:
    import copy
    return copy.deepcopy(el)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def _print_json(obj: dict) -> None:
    print(json.dumps(obj))


def _validate_only(path: Path) -> int:
    text = path.read_text(encoding='utf-8')
    try:
        parse_bcca_book(text)
    except ValidationError as e:
        _print_json({'success': False, 'error': e.code, 'detail': e.detail})
        return 1
    _print_json({'success': True})
    return 0


def next_version(out_dir: str, stem: str) -> tuple[str, str | None]:
    """The path the next copy takes, and the highest existing copy (None if none).
    `<stem>.docx` counts as v1 and `<stem> vN.docx` as vN. Shared with fill_factum.py."""
    series = re.compile(r'^%s(?: v(\d+))?\.docx$' % re.escape(stem), re.I)
    taken = {}
    for entry in os.listdir(out_dir):
        match = series.match(entry)
        if match:
            taken[int(match.group(1) or 1)] = os.path.join(out_dir, entry)
    if not taken:
        return os.path.join(out_dir, stem + '.docx'), None
    top = max(taken)
    return os.path.join(out_dir, '%s v%d.docx' % (stem, top + 1)), taken[top]


def move_exclusive(src: str, dst: str) -> None:
    """Move the finished file `src` onto `dst`, raising FileExistsError if anything is there.
    A hard link claims the name atomically on every platform, where os.replace replaces and
    os.rename refuses only on Windows (#1434). Shared with fill_factum.py."""
    os.link(src, dst)
    os.remove(src)


def _fill(path: Path, output_dir: Path) -> int:
    text = path.read_text(encoding='utf-8')
    try:
        data = parse_bcca_book(text)
    except ValidationError as e:
        _print_json({'success': False, 'error': e.code, 'detail': e.detail})
        return 1

    output_dir.mkdir(parents=True, exist_ok=True)

    jobs = []
    if 'response_book_toc' in data:
        jobs.append(('response_book_cover', lambda p: build_cover(data, 'response_book', p)))
        jobs.append(('response_book_toc', lambda p: build_response_toc(data['response_book_toc'], p)))
    jobs.append(('boa_cover', lambda p: build_cover(data, 'boa', p)))
    jobs.append(('boa_toc', lambda p: build_boa_toc(data['boa_toc'], p)))
    for key, builder in jobs:
        stem = OUTPUT_NAMES[key][:-len('.docx')]
        tmp = os.path.join(output_dir, '~%s.tmp-%d.docx' % (stem, os.getpid()))
        try:
            builder(Path(tmp))
            out_path, prior = next_version(str(output_dir), stem)
            try:
                move_exclusive(tmp, out_path)
            except FileExistsError:
                _print_json({'success': False, 'error': 'output_exists',
                             'detail': f'{out_path} already exists; never overwritten'})
                return 1
        finally:
            if os.path.exists(tmp):
                os.remove(tmp)
        result = {'success': True, 'document': key, 'path': out_path}
        if prior:
            result['versioned_from'] = prior
        _print_json(result)
    return 0


def main() -> int:
    p = argparse.ArgumentParser(description='Validate and fill the BCCA response/BOA book documents.')
    p.add_argument('--validate', action='store_true', help='Validate only; no output written.')
    p.add_argument('path', help='Path to bcca-book.md')
    p.add_argument('output_dir', nargs='?', default=None, help='Directory to write the four .docx files into')
    args = p.parse_args()

    path = Path(args.path)
    if args.validate:
        return _validate_only(path)

    if args.output_dir is None:
        p.error('output_dir is required unless --validate is passed')
    return _fill(path, Path(args.output_dir))


if __name__ == '__main__':
    sys.exit(main())
