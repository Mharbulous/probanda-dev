"""Validate bcca-factum.md and fill the court's respondent's factum template.

Grammar, error codes and the invocation contract are owned by
references/bcca-factum-contract.md (SSOT) -- do not restate the rules here
beyond what the code needs to enforce them.

Usage:
    python fill_factum.py --validate <bcca-factum.md path>
    python fill_factum.py <bcca-factum.md path> <draft-dir> --out-name STEM

Both modes print one JSON line: {"success": true} (plus, on a fill run, one
further line naming the document written) or
{"success": false, "error": "<code>", "detail": "..."} -- never a traceback.
"""
from __future__ import annotations

import argparse
import copy
import json
import os
import re
import sys
from pathlib import Path

from lxml import etree

# Shared with publish-bcca-book and the binder: /publish's own scripts/ folder.
sys.path.insert(0, str(Path(__file__).resolve().parents[3] / 'scripts'))
from docx_helpers import (  # noqa: E402
    load_zip,
    para_text,
    rewrite_content_types_to_document,
    save_zip,
    set_run_text,
    wn,
)
from fill_book import _fill_party_groups, format_name_list, move_exclusive, next_version
from ordinal_date import format_ordinal_date

HERE = Path(__file__).resolve().parent
TEMPLATE = HERE.parent / 'templates' / 'bcca-factum-respondent.dotx'

PART_HEADINGS = (
    'PART 1 - STATEMENT OF FACTS',
    'PART 2 - ISSUES ON APPEAL',
    'PART 3 - ARGUMENT',
    'PART 4 - NATURE OF ORDER SOUGHT',
)
BODY_HEADINGS = ('OPENING STATEMENT',) + PART_HEADINGS

_REQUIRED_KEYS = (
    'file_number', 'short_style', 'record_label', 'title', 'party_groups', 'contacts',
    'chronology', 'authorities', 'enactments',
    'signing_place', 'dated_on', 'authorizing_name', 'authorizing_line',
)
_OPTIONAL_KEYS = (
    'under_appeal_judge', 'under_appeal_court', 'under_appeal_pronounced',
    'access_restrictions', 'filing_party_phrase',
)
_JSON_KEYS = {'party_groups', 'contacts', 'chronology', 'authorities', 'enactments', 'access_restrictions'}
_KNOWN_KEYS = set(_REQUIRED_KEYS) | set(_OPTIONAL_KEYS)

_NUMBERED_RE = re.compile(r'^(\d+)\. (\S.*)$')
_ISO_RE = re.compile(r'^\d{4}-\d{2}-\d{2}$')
_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
           'August', 'September', 'October', 'November', 'December']
# What an --out-name stem may not carry: a character Windows forbids in a file name, a file
# extension, or the " v<n>" this fill appends itself.
BAD_STEM = re.compile(r'[\\/:*?"<>|]|\.(docx?|pdf)$| v\d+$', re.I)


class ValidationError(Exception):
    def __init__(self, code: str, detail: str):
        self.code = code
        self.detail = detail
        super().__init__(f'{code}: {detail}')


# ---------------------------------------------------------------------------
# Grammar (bcca-factum-contract.md)
# ---------------------------------------------------------------------------

def _require(condition: bool, code: str, detail: str) -> None:
    if not condition:
        raise ValidationError(code, detail)


def _is_text(value) -> bool:
    return isinstance(value, str) and value.strip() != ''


def _validate_iso(value, field: str) -> None:
    _require(isinstance(value, str) and bool(_ISO_RE.match(value)), 'bad_date', f'{field} must be YYYY-MM-DD: {value!r}')
    try:
        format_ordinal_date(value)
    except ValueError as e:
        raise ValidationError('bad_date', f'{field} is not a real date: {e}')


def _validate_frontmatter(data: dict) -> None:
    groups = data['party_groups']
    _require(isinstance(groups, list) and len(groups) >= 2, 'bad_party_group', 'party_groups must list at least two role groups')
    for g in groups:
        _require(isinstance(g, dict) and _is_text(g.get('role')) and isinstance(g.get('names'), list) and g['names']
                 and set(g) <= {'role', 'names', 'lower_court_role'},
                 'bad_party_group', f'bad party_groups entry: {g!r}')
    contacts = data['contacts']
    _require(isinstance(contacts, list) and len(contacts) == 2, 'bad_contact',
             'contacts must hold exactly two entries (the appellant side, then the respondent side)')
    for c in contacts:
        _require(isinstance(c, dict) and _is_text(c.get('role')) and isinstance(c.get('names'), list) and c['names']
                 and set(c) <= {'role', 'names', 'counsel_name', 'counsel_firm', 'address', 'phone', 'email'},
                 'bad_contact', f'bad contacts entry: {c!r}')
    chronology = data['chronology']
    _require(isinstance(chronology, list) and chronology, 'bad_chronology', 'chronology must be a non-empty array')
    for row in chronology:
        _require(isinstance(row, dict) and set(row) == {'date', 'event'} and _is_text(row['event']),
                 'bad_chronology', f'bad chronology entry: {row!r}')
        _validate_iso(row['date'], 'chronology date')
    _require(isinstance(data['authorities'], list), 'bad_authority', 'authorities must be an array')
    for a in data['authorities']:
        _require(isinstance(a, dict) and set(a) == {'authority', 'citation', 'paras'} and _is_text(a['authority'])
                 and _is_text(a['citation']) and isinstance(a['paras'], list) and a['paras']
                 and all(isinstance(n, int) and not isinstance(n, bool) and n > 0 for n in a['paras']),
                 'bad_authority', f'bad authorities entry: {a!r}')
    _require(isinstance(data['enactments'], list), 'bad_enactment', 'enactments must be an array')
    for e in data['enactments']:
        _require(isinstance(e, dict) and set(e) == {'title', 'citation', 'excerpts'} and _is_text(e['title'])
                 and (e['citation'] is None or _is_text(e['citation'])) and isinstance(e['excerpts'], list) and e['excerpts'],
                 'bad_enactment', f'bad enactments entry: {e!r}')
        for x in e['excerpts']:
            _require(isinstance(x, dict) and set(x) == {'pinpoint', 'text'} and _is_text(x['text'])
                     and (x['pinpoint'] is None or _is_text(x['pinpoint'])),
                     'bad_enactment', f'bad excerpt in {e["title"]!r}: {x!r}')
    if 'access_restrictions' in data:
        r = data['access_restrictions']
        _require(isinstance(r, list) and r and all(_is_text(v) for v in r), 'bad_access_restrictions',
                 'access_restrictions must be a non-empty array of strings when present')
    appeal = [data.get(k) for k in ('under_appeal_judge', 'under_appeal_court', 'under_appeal_pronounced')]
    _require(all(appeal) or not any(appeal), 'bad_on_appeal_from',
             'under_appeal_judge, under_appeal_court and under_appeal_pronounced are given together or not at all')
    if data.get('under_appeal_pronounced'):
        _validate_iso(data['under_appeal_pronounced'], 'under_appeal_pronounced')
    _validate_iso(data['dated_on'], 'dated_on')


def _parse_body(lines: list[str]) -> dict[str, list[tuple]]:
    """Returns heading -> list of ('para', n, text) | ('plain', text) | ('quote', text) | ('cite', text)."""
    sections: dict[str, list[tuple]] = {}
    current = None
    for raw in lines:
        line = raw.rstrip()
        if not line.strip():
            continue
        _require('<!--' not in line and '**' not in line, 'disallowed_markup', f'markup not allowed in the filed face: {line!r}')
        if line.startswith('## '):
            heading = line[3:]
            _require(heading in BODY_HEADINGS, 'unknown_heading', f'unknown heading: {heading!r}')
            _require(heading not in sections, 'duplicate_heading', f'duplicate heading: {heading!r}')
            expected = BODY_HEADINGS[len(sections)]
            _require(heading == expected, 'heading_order', f'expected {expected!r}, found {heading!r}')
            sections[heading] = []
            current = heading
            continue
        _require(current is not None, 'content_before_heading', f'content before the first heading: {line!r}')
        m = _NUMBERED_RE.match(line)
        if line.startswith('> '):
            sections[current].append(('quote', line[2:]))
        elif line.startswith('cite: '):
            sections[current].append(('cite', line[6:]))
        elif m:
            sections[current].append(('para', int(m.group(1)), m.group(2)))
        else:
            sections[current].append(('plain', line))
    missing = [h for h in BODY_HEADINGS if h not in sections]
    _require(not missing, 'missing_heading', f'missing heading(s): {missing}')

    opening = sections['OPENING STATEMENT']
    _require(opening and all(item[0] == 'plain' for item in opening), 'bad_opening_statement',
             'the opening statement holds unnumbered paragraphs only, at least one')
    expected_n = 1
    for heading in PART_HEADINGS:
        items = sections[heading]
        _require(any(item[0] == 'para' for item in items), 'empty_part', f'{heading} has no numbered paragraph')
        for item in items:
            if item[0] == 'para':
                _require(item[1] == expected_n, 'numbering', f'{heading}: expected paragraph {expected_n}, found {item[1]}')
                expected_n += 1
        if heading != PART_HEADINGS[-1]:
            _require(items[0][0] == 'para', 'numbering', f'{heading} must open with a numbered paragraph')
            _require(all(item[0] != 'plain' for item in items), 'unnumbered_paragraph',
                     f'{heading}: every paragraph is numbered (only quote and cite lines may follow one)')
    part4 = sections[PART_HEADINGS[-1]]
    _require(part4[0][0] == 'para' and part4[-1][0] == 'para' and any(i[0] == 'plain' for i in part4)
             and all(i[0] in ('para', 'plain') for i in part4),
             'bad_part4', 'Part 4 is a numbered lead-in, the unnumbered order paragraphs, then the numbered closing line')
    sections['_last_para'] = [('count', expected_n - 1)]
    return sections


def parse_bcca_factum(text: str) -> tuple[dict, dict]:
    lines = text.splitlines()
    _require(bool(lines) and lines[0].strip() == '---', 'missing_frontmatter', 'file does not start with a --- fence')
    close_idx = next((i for i in range(1, len(lines)) if lines[i].strip() == '---'), None)
    _require(close_idx is not None, 'missing_frontmatter', 'no closing --- fence found')

    raw: dict[str, str] = {}
    for line in lines[1:close_idx]:
        if not line.strip():
            continue
        _require(':' in line, 'missing_frontmatter', f'malformed frontmatter line: {line!r}')
        key, _, value = line.partition(':')
        key, value = key.strip(), value.strip()
        _require(key in _KNOWN_KEYS, 'unknown_key', f'unknown frontmatter key: {key!r}')
        _require(key not in raw, 'duplicate_key', f'duplicate frontmatter key: {key!r}')
        raw[key] = value
    for key in _REQUIRED_KEYS:
        _require(key in raw, 'missing_required_key', f'missing required key: {key!r}')

    data: dict = {}
    for key, value in raw.items():
        if key in _JSON_KEYS:
            try:
                data[key] = json.loads(value)
            except json.JSONDecodeError as e:
                raise ValidationError('invalid_json', f'{key}: {e}')
        else:
            _require(value != '', 'missing_required_key', f'empty value for key: {key!r}')
            data[key] = value
    _validate_frontmatter(data)

    sections = _parse_body(lines[close_idx + 1:])
    last = sections.pop('_last_para')[0][1]
    for a in data['authorities']:
        _require(max(a['paras']) <= last, 'bad_authority', f'{a["authority"]!r} cites paragraph {max(a["paras"])}, past the last ({last})')
    return data, sections


# ---------------------------------------------------------------------------
# Fill
# ---------------------------------------------------------------------------

_BODY_RPR = ('<w:rPr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
             '<w:rFonts w:cs="Arial"/><w:szCs w:val="24"/></w:rPr>')


def _run(text: str, bold: bool = False, italic: bool = False) -> etree._Element:
    r = etree.Element(wn('r'))
    rpr = etree.fromstring(_BODY_RPR)
    if bold:
        rpr.append(etree.Element(wn('b')))
    if italic:
        rpr.append(etree.Element(wn('i')))
    r.append(rpr)
    set_run_text(r, text)
    return r


def _para(ppr: etree._Element | None, *runs: etree._Element) -> etree._Element:
    p = etree.Element(wn('p'))
    if ppr is not None:
        p.append(copy.deepcopy(ppr))
    for r in runs:
        p.append(r)
    return p


def _replace_text(p: etree._Element, text: str) -> None:
    """Replace a paragraph's content (runs, form fields, bookmarks) with one run, keeping its pPr and the
    formatting of its last text run."""
    text_runs = [r for r in p.iter(wn('r')) if r.find(wn('t')) is not None]
    rpr = text_runs[-1].find(wn('rPr')) if text_runs else None
    for child in list(p):
        if child.tag != wn('pPr'):
            p.remove(child)
    r = etree.SubElement(p, wn('r'))
    if rpr is not None:
        r.append(copy.deepcopy(rpr))
    set_run_text(r, text)


def _find_para(root: etree._Element, predicate) -> etree._Element:
    for p in root.iter(wn('p')):
        if predicate(para_text(p)):
            return p
    raise ValueError('template paragraph not found')


def _remove(el: etree._Element) -> None:
    el.getparent().remove(el)


def _remove_instruction_tables(body: etree._Element) -> None:
    for tbl in [t for t in body if t.tag == wn('tbl')]:
        if 'INSTRUCTIONS (please remove table' in ''.join(tbl.itertext()):
            body.remove(tbl)


def _heading(body: etree._Element, text: str) -> etree._Element:
    for el in body:
        if el.tag == wn('p') and para_text(el).strip() == text:
            return el
    raise ValueError(f'template heading not found: {text}')


def _section_elements(body: etree._Element, heading_text: str) -> list[etree._Element]:
    """Top-level elements after a Heading1 paragraph, up to the next Heading1 or the section properties."""
    out = []
    el = _heading(body, heading_text).getnext()
    while el is not None and el.tag != wn('sectPr'):
        style = el.find(f'{wn("pPr")}/{wn("pStyle")}') if el.tag == wn('p') else None
        if style is not None and style.get(wn('val')) == 'Heading1':
            break
        out.append(el)
        el = el.getnext()
    return out


def _fill_cover(body: etree._Element, data: dict) -> None:
    cover = next(el for el in body if el.tag == wn('sdt'))
    file_p = _find_para(cover, lambda t: t.startswith('COURT OF APPEAL FILE NO.'))
    _replace_text(file_p, f"COURT OF APPEAL FILE NO. {data['file_number']}")
    _replace_text(_find_para(cover, lambda t: t.startswith('Enter Name of First Appellant')), data['short_style'])
    _replace_text(_find_para(cover, lambda t: t.strip() == 'Respondent’s Factum'), data['record_label'])

    appeal_p = _find_para(cover, lambda t: t.startswith('ON APPEAL FROM'))
    if data.get('under_appeal_judge'):
        _replace_text(appeal_p, f"ON APPEAL FROM the order of {data['under_appeal_judge']} of the "
                                f"{data['under_appeal_court']} pronounced on {format_ordinal_date(data['under_appeal_pronounced'])}")
    else:
        _remove(appeal_p)

    _fill_party_groups(cover, data['party_groups'])

    ban_p = _find_para(cover, lambda t: t.startswith('Publication Ban or Anonymity Order'))
    _remove(_find_para(cover, lambda t: t.startswith('Sealing Order (if any)')))
    for line in data.get('access_restrictions') or []:
        new_p = copy.deepcopy(ban_p)
        _replace_text(new_p, line)
        ban_p.addprevious(new_p)
    _remove(ban_p)

    _replace_text(_find_para(cover, lambda t: t.strip() == 'RESPONDENT’S FACTUM'), data['title'])
    phrase_p = _find_para(cover, lambda t: t.strip() == '[Enter Name of Filing Respondent]')
    if data.get('filing_party_phrase'):
        _replace_text(phrase_p, data['filing_party_phrase'])
    else:
        _remove(phrase_p)

    names_row, counsel_row, address_row = cover.find(f'.//{wn("tbl")}').findall(wn('tr'))
    for col, contact in enumerate(data['contacts']):
        _replace_text(names_row.findall(wn('tc'))[col].find(wn('p')), format_name_list(contact['names']))
        counsel_cell = counsel_row.findall(wn('tc'))[col]
        counsel_p = counsel_cell.findall(wn('p'))[-1]
        _replace_text(counsel_p, contact.get('counsel_name') or '')
        cell = address_row.findall(wn('tc'))[col]
        ppr = cell.findall(wn('p'))[1].find(wn('pPr'))
        for p in cell.findall(wn('p')):
            cell.remove(p)
        lines = [contact.get('counsel_firm')] + str(contact.get('address') or '').splitlines()
        lines += ['', f"Telephone: {contact['phone']}" if contact.get('phone') else None,
                  f"E-mail: {contact['email']}" if contact.get('email') else None,
                  '', f"Counsel for the {contact['role']}" if contact.get('counsel_name') else contact['role']]
        for line in lines:
            if line is not None:
                cell.append(_para(ppr, _run(line.strip())))


def _fill_chronology(body: etree._Element, rows: list[dict]) -> None:
    tbl = next(el for el in _section_elements(body, 'CHRONOLOGY') if el.tag == wn('tbl'))
    header, template_row, *rest = tbl.findall(wn('tr'))
    for tr in [template_row] + rest:
        tbl.remove(tr)
    for row in rows:
        tr = copy.deepcopy(template_row)
        date_cell, event_cell = tr.findall(wn('tc'))
        y, m, d = (int(x) for x in row['date'].split('-'))
        _replace_text(date_cell.find(wn('p')), f'{_MONTHS[m - 1]} {d}, {y}')
        _replace_text(event_cell.find(wn('p')), row['event'])
        tbl.append(tr)


def _clear_section(body: etree._Element, heading_text: str) -> etree._Element:
    """Remove a section's content and return the heading, the anchor new content is inserted after."""
    for el in _section_elements(body, heading_text):
        body.remove(el)
    return _heading(body, heading_text)


def _insert_after(anchor: etree._Element, elements: list[etree._Element]) -> None:
    for el in reversed(elements):
        anchor.addnext(el)


def _quote_ppr(cite_ppr: etree._Element) -> etree._Element:
    ppr = copy.deepcopy(cite_ppr)
    for tag in ('jc', 'ind', 'spacing'):
        for el in ppr.findall(wn(tag)):
            ppr.remove(el)
    spacing = etree.Element(wn('spacing'))
    spacing.set(wn('line'), '240')
    spacing.set(wn('lineRule'), 'auto')
    ind = etree.Element(wn('ind'))
    ind.set(wn('left'), '1440')
    ind.set(wn('right'), '720')
    ppr.insert(0, ind)
    ppr.insert(0, spacing)
    return ppr


def _fill_parts(body: etree._Element, data: dict, sections: dict) -> dict[int, etree._Element]:
    els = {h: _section_elements(body, h) for h in ('OPENING STATEMENT',) + PART_HEADINGS}
    opening_ppr = _find_para(body, lambda t: t.strip() == '[Enter text here]').find(wn('pPr'))
    numbered_ppr = next(p for p in els[PART_HEADINGS[0]] if p.tag == wn('p') and p.find(f'.//{wn("numPr")}') is not None
                        and not para_text(p).strip()).find(wn('pPr'))
    cite_ppr = next(p for p in els[PART_HEADINGS[2]] if p.tag == wn('p') and para_text(p).startswith('Housen')).find(wn('pPr'))
    order_ppr = next(p for p in els[PART_HEADINGS[3]] if p.tag == wn('p') and para_text(p).strip() == '[Enter text here]').find(wn('pPr'))
    signing = [el for el in els[PART_HEADINGS[3]] if el.tag == wn('p')]
    dated_p = next(p for p in signing if para_text(p).startswith('Dated at the City of'))
    name_p = next(p for p in signing if 'Name of lawyer or party authorizing' in para_text(p))
    role_p = name_p.getnext()
    quote_ppr = _quote_ppr(cite_ppr)
    numbered: dict[int, etree._Element] = {}

    anchor = _clear_section(body, 'OPENING STATEMENT')
    _insert_after(anchor, [_para(opening_ppr, _run(item[1])) for item in sections['OPENING STATEMENT']] + [_para(None)])

    for heading in PART_HEADINGS:
        new: list[etree._Element] = []
        for item in sections[heading]:
            if item[0] == 'para':
                p = _para(numbered_ppr, _run(item[2]))
                numbered[item[1]] = p
            elif item[0] == 'plain':
                p = _para(order_ppr, _run(item[1]))
            elif item[0] == 'quote':
                p = _para(quote_ppr, _run(item[1]))
            else:
                p = _para(cite_ppr, _run(item[1]))
            new.append(p)
        if heading == PART_HEADINGS[-1]:
            _replace_text(dated_p, f"Dated at the City of {data['signing_place']}, Province of British Columbia, this "
                                   f"{_long_date_words(data['dated_on'])}.")
            _replace_text(name_p, data['authorizing_name'])
            _replace_text(role_p, data['authorizing_line'])
            new += [_para(None), dated_p, _para(None), name_p, role_p]
        anchor = _clear_section(body, heading)
        _insert_after(anchor, new + [_para(None)])
    return numbered


def _long_date_words(iso: str) -> str:
    """Template Part 4 step 5: "this [month] [day] of [year]"."""
    y, m, d = (int(x) for x in iso.split('-'))
    return f'{_MONTHS[m - 1]} {d} of {y}'


def _pageref_runs(bookmark: str) -> list[etree._Element]:
    def fld(kind: str) -> etree._Element:
        r = etree.Element(wn('r'))
        c = etree.SubElement(r, wn('fldChar'))
        c.set(wn('fldCharType'), kind)
        return r
    instr = etree.Element(wn('r'))
    t = etree.SubElement(instr, wn('instrText'))
    t.text = f' PAGEREF {bookmark} \\h '
    t.set('{http://www.w3.org/XML/1998/namespace}space', 'preserve')
    return [fld('begin'), instr, fld('separate'), _run('?'), fld('end')]


def _bookmark(p: etree._Element, name: str, bid: int) -> None:
    start = etree.Element(wn('bookmarkStart'))
    start.set(wn('id'), str(bid))
    start.set(wn('name'), name)
    end = etree.Element(wn('bookmarkEnd'))
    end.set(wn('id'), str(bid))
    ppr = p.find(wn('pPr'))
    p.insert(1 if ppr is not None else 0, start)
    p.append(end)


def _fill_authorities(body: etree._Element, authorities: list[dict], numbered: dict[int, etree._Element]) -> None:
    section = _section_elements(body, 'APPENDICES: LIST OF AUTHORITIES')
    tbl = next(el for el in section if el.tag == wn('tbl'))
    header, template_row, *rest = tbl.findall(wn('tr'))
    for tr in [template_row] + rest:
        tbl.remove(tr)
    if not authorities:
        tbl.addprevious(_para(None, _run('None.')))
        body.remove(tbl)
        return
    bookmarked: dict[int, str] = {}
    for a in authorities:
        first = a['paras'][0]
        if first not in bookmarked:
            bookmarked[first] = f'factum_para_{first}'
            _bookmark(numbered[first], bookmarked[first], 9000 + first)
        tr = copy.deepcopy(template_row)
        name_cell, page_cell, para_cell = tr.findall(wn('tc'))
        name_p = name_cell.find(wn('p'))
        for child in list(name_p):
            if child.tag != wn('pPr'):
                name_p.remove(child)
        name_p.append(_run(a['authority'], italic=True))
        name_p.append(_run(f", {a['citation']}"))
        page_p = page_cell.find(wn('p'))
        for child in list(page_p):
            if child.tag != wn('pPr'):
                page_p.remove(child)
        for r in _pageref_runs(bookmarked[first]):
            page_p.append(r)
        _replace_text(para_cell.find(wn('p')), ', '.join(str(n) for n in a['paras']))
        tbl.append(tr)


def _fill_enactments(body: etree._Element, enactments: list[dict]) -> None:
    section = _section_elements(body, 'APPENDICES: ENACTMENTS')
    paras = [el for el in section if el.tag == wn('p')]
    title_ppr = next(p for p in paras if para_text(p).strip() == 'LIMITATION ACT').find(wn('pPr'))
    citation_ppr = next(p for p in paras if para_text(p).startswith('[SBC 2012]')).find(wn('pPr'))
    text_ppr = next(p for p in paras if para_text(p).startswith('27 (1)')).find(wn('pPr'))
    new: list[etree._Element] = []
    if not enactments:
        new.append(_para(None, _run('None.')))
    for e in enactments:
        new.append(_para(title_ppr, _run(e['title'], bold=True)))
        if e['citation']:
            new.append(_para(citation_ppr, _run(e['citation'])))
        for x in e['excerpts']:
            for line in x['text'].splitlines():
                if line.strip():
                    new.append(_para(text_ppr, _run(line)))
            if x['pinpoint']:
                new.append(_para(text_ppr, _run(f"({x['pinpoint']})")))
        new.append(_para(None))
    anchor = _clear_section(body, 'APPENDICES: ENACTMENTS')
    _insert_after(anchor, new)


# CT_Settings children that must follow w:updateFields (ECMA-376 schema order).
_AFTER_UPDATE_FIELDS = (
    'hdrShapeDefaults', 'footnotePr', 'endnotePr', 'compat', 'docVars', 'rsids', 'mathPr', 'attachedSchema',
    'themeFontLang', 'clrSchemeMapping', 'doNotIncludeSubdocsInStats', 'doNotAutoCompressPictures', 'forceUpgrade',
    'captions', 'readModeInkLockDown', 'smartTagType', 'schemaLibrary', 'shapeDefaults', 'doNotEmbedSmartTags',
    'decimalSymbol', 'listSeparator',
)


def _set_update_fields(members: dict[str, bytes]) -> None:
    """Word refreshes the table of contents and the authorities' page references when the document opens."""
    root = etree.fromstring(members['word/settings.xml'])
    for el in root.findall(wn('updateFields')):
        root.remove(el)
    flag = etree.Element(wn('updateFields'))
    flag.set(wn('val'), 'true')
    after = next((el for el in root if etree.QName(el).localname in _AFTER_UPDATE_FIELDS), None)
    if after is not None:
        after.addprevious(flag)
    else:
        root.append(flag)
    members['word/settings.xml'] = etree.tostring(root, xml_declaration=True, encoding='UTF-8', standalone=True)


def _drop_orphan_bookmark_ends(root: etree._Element) -> None:
    starts = {el.get(wn('id')) for el in root.iter(wn('bookmarkStart'))}
    for end in list(root.iter(wn('bookmarkEnd'))):
        if end.get(wn('id')) not in starts:
            end.getparent().remove(end)


def build_factum(data: dict, sections: dict, out_path: Path) -> None:
    members = load_zip(TEMPLATE)
    root = etree.fromstring(members['word/document.xml'])
    body = root.find(wn('body'))
    _remove_instruction_tables(body)
    _fill_cover(body, data)
    _fill_chronology(body, data['chronology'])
    numbered = _fill_parts(body, data, sections)
    _fill_authorities(body, data['authorities'], numbered)
    _fill_enactments(body, data['enactments'])
    _drop_orphan_bookmark_ends(root)
    members['word/document.xml'] = etree.tostring(root, xml_declaration=True, encoding='UTF-8', standalone=True)
    _set_update_fields(members)
    rewrite_content_types_to_document(members)
    save_zip(members, out_path)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def _print_json(obj: dict) -> None:
    print(json.dumps(obj))


def main() -> int:
    p = argparse.ArgumentParser(description="Validate and fill the BCCA respondent's factum.")
    p.add_argument('--validate', action='store_true', help='Validate only; no output written.')
    p.add_argument('path', help='Path to bcca-factum.md')
    p.add_argument('output_dir', nargs='?', default=None, help="The matter's draft folder, the .docx goes at its root")
    p.add_argument('--out-name', help="The factum's file name stem, no extension")
    args = p.parse_args()
    if not args.validate and (args.output_dir is None or args.out_name is None):
        p.error('output_dir and --out-name are required unless --validate is passed')

    try:
        data, sections = parse_bcca_factum(Path(args.path).read_text(encoding='utf-8'))
    except ValidationError as e:
        _print_json({'success': False, 'error': e.code, 'detail': e.detail})
        return 1
    if args.validate:
        _print_json({'success': True})
        return 0

    stem = args.out_name
    if not stem.strip() or BAD_STEM.search(stem):
        _print_json({'success': False, 'error': 'bad_input',
                     'detail': f'--out-name {stem!r} must be a bare file name stem: not empty, without '
                               '\\ / : * ? " < > |, a file extension or a trailing " v<n>"'})
        return 1
    if not os.path.isdir(args.output_dir):
        _print_json({'success': False, 'error': 'no_out_dir', 'detail': f'{args.output_dir} is not a folder'})
        return 1

    tmp = os.path.join(args.output_dir, '~%s.tmp-%d.docx' % (stem, os.getpid()))
    try:
        build_factum(data, sections, Path(tmp))
        out_path, prior = next_version(args.output_dir, stem)
        try:
            move_exclusive(tmp, out_path)
        except FileExistsError:
            _print_json({'success': False, 'error': 'output_exists', 'detail': f'{out_path} already exists; never overwritten'})
            return 1
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)
    result = {'success': True, 'document': 'factum', 'path': out_path}
    if prior:
        result['versioned_from'] = prior
    _print_json(result)
    return 0


if __name__ == '__main__':
    sys.exit(main())
