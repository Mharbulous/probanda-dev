"""Line 2 of every exhibit stamp names the affiant only when name_affiant_on_stamps is true,
drawn by assemble.py so a rerun reproduces it; the commissioner's signature line stays
underscores, and a name too wide for the stamp is shrunk to fit, never drawn past it (#1379)."""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import fitz
import pytest

SCRIPTS = Path(__file__).resolve().parent.parent / 'scripts'
BLANK = 'affidavit of ____________________'
SIGNATURE = '_____________________________'
STAMP_WIDTH = 211.09 * 1.25


def pdf(path: Path, lines: list[tuple[int, str]], size=(612, 792)) -> Path:
    doc = fitz.open()
    page = doc.new_page(width=size[0], height=size[1])
    for y, text in lines:
        page.insert_text((20, y), text, fontsize=12)
    doc.save(path)
    doc.close()
    return path


@pytest.fixture
def data(tmp_path):
    """An affidavit with two exhibits: A takes the stamp in its own whitespace, B is too
    small for one and gets a blank page inserted."""
    aff = pdf(tmp_path / 'affidavit.pdf', [
        (300, 'AFFIRMED BEFORE ME at'),
        (320, 'Vancouver, Province of British Columbia,'),
        (340, 'this 1st day of June, 2026.'),
    ])
    a = pdf(tmp_path / 'a.pdf', [(100, 'EXHIBIT A CONTENT')])
    b = pdf(tmp_path / 'b.pdf', [(50, 'EXHIBIT B')], size=(200, 200))
    return {'affiant_name': 'Morgan Chen', 'affidavit_number': 1,
            'jurat_verb': 'AFFIRMED', 'signing_date': '2026-10-01',
            'affidavit_pdf': str(aff), 'header_bbox': None, 'jurat_bbox': [72, 325, 340, 370],
            'exhibits': [{'letter': 'A', 'path': str(a)}, {'letter': 'B', 'path': str(b)}],
            'name_affiant_on_stamps': False, 'output_path': str(tmp_path / 'out.pdf')}


def run(tmp_path: Path, data: dict) -> dict:
    payload = tmp_path / 'input.json'
    payload.write_text(json.dumps(data), encoding='utf-8')
    result = subprocess.run([sys.executable, '-B', str(SCRIPTS / 'assemble.py'), str(payload)],
                            capture_output=True, text=True)
    return json.loads(result.stdout)


def stamp_spans(result: dict) -> list[list[dict]]:
    """Each exhibit's stamp spans, from the first page of that exhibit in the output."""
    assert result['success'], result
    assert [e['stamp_placement'] for e in result['exhibits']] == ['whitespace', 'blank_page_inserted']
    doc = fitz.open(result['output_path'])
    stamps = []
    for ex in result['exhibits']:
        page = doc[int(ex['pages'].split('-')[0]) - 1]
        spans = [s for b in page.get_text('dict')['blocks'] for l in b.get('lines', [])
                 for s in l['spans'] if s['font'].startswith('aa2stamp') or 'Carlito' in s['font']]
        stamps.append(spans)
    doc.close()
    return stamps


def line2(spans: list[dict]) -> dict:
    return next(s for s in spans if s['text'].startswith('affidavit of'))


def test_without_the_flag_line_2_stays_blank(tmp_path, data):
    for spans in stamp_spans(run(tmp_path, data)):
        assert line2(spans)['text'].strip() == BLANK
        assert {round(s['size'], 1) for s in spans} == {13.8}
        assert any(s['text'].strip() == SIGNATURE for s in spans)


def test_with_the_flag_line_2_names_the_affiant(tmp_path, data):
    for spans in stamp_spans(run(tmp_path, {**data, 'name_affiant_on_stamps': True})):
        assert line2(spans)['text'].strip() == 'affidavit of Morgan Chen'
        assert round(line2(spans)['size'], 1) == 13.8
        assert any(s['text'].strip() == SIGNATURE for s in spans)


def test_a_name_too_wide_for_the_stamp_is_shrunk_inside_it(tmp_path, data):
    name = 'Maximiliana Alexandrina Montgomery-Fitzwilliam'
    result = run(tmp_path, {**data, 'affiant_name': name, 'name_affiant_on_stamps': True})
    for spans in stamp_spans(result):
        first, second = spans[0], line2(spans)
        assert second['text'].strip() == f'affidavit of {name}'
        assert second['size'] < 13.8
        assert second['bbox'][2] <= first['bbox'][0] + STAMP_WIDTH


def test_a_missing_flag_fails_rather_than_defaulting(tmp_path, data):
    del data['name_affiant_on_stamps']
    assert not run(tmp_path, data)['success']
    assert not Path(data['output_path']).exists()
