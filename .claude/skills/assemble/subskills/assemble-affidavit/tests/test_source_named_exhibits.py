"""An exhibit kept under its source name (named in inspect_exhibits.py's `exhibit_files`) is
inspected with letter null and matched in place: CONFIRMED with no rename, so the read-only
source is never renamed or copied ad hoc (#1383). Lettered files behave as before."""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import fitz

SCRIPTS = Path(__file__).resolve().parent.parent / 'scripts'

NOTE = ['PROMISSORY NOTE AMENDING AGREEMENT', 'April 30, 2021',
        'The parties amend the note to extend the maturity date.']
DESC_A = {'letter': 'A', 'paragraph': 3, 'identity_date': 'April 30, 2021',
          'identity_terms': ['April 30, 2021', 'amending agreement'], 'context_terms': [],
          'key_terms': ['April 30, 2021', 'amending agreement']}


def run(script: str, tmp_path: Path, data: dict) -> dict:
    payload = tmp_path / f'{script}.json'
    payload.write_text(json.dumps(data), encoding='utf-8')
    result = subprocess.run([sys.executable, '-B', str(SCRIPTS / script), str(payload)],
                            capture_output=True, text=True)
    return json.loads(result.stdout)


def pdf(path: Path, lines: list[str]) -> None:
    doc = fitz.open()
    page = doc.new_page(width=612, height=792)
    for i, text in enumerate(lines):
        page.insert_text((72, 100 + 20 * i), text, fontsize=12)
    doc.save(path)
    doc.close()


def match(tmp_path: Path, files: list[dict], descriptions=(DESC_A,)) -> dict:
    return run('match_exhibits.py', tmp_path, {'descriptions': list(descriptions), 'files': files})


def test_source_named_exhibit_confirms_in_place(tmp_path):
    source = tmp_path / 'LOD Defendant'
    source.mkdir()
    pdf(source / '1.03 Amending Agreement.pdf', NOTE)
    inspected = run('inspect_exhibits.py', tmp_path, {
        'exhibit_dirs': [], 'exhibit_files': [str(source / '1.03 Amending Agreement.pdf')],
        'png_out_dir': str(tmp_path / 'png')})
    [entry] = inspected['files']
    assert (entry['letter'], entry['classification']) == (None, 'TEXT')

    matched = match(tmp_path, inspected['files'])
    [a] = matched['assignments']
    assert a['status'] == 'CONFIRMED' and a['score'] >= 2.0 and a['file_letter'] is None
    assert a['file_path'] == str(source / '1.03 Amending Agreement.pdf')
    assert matched['rename_mapping'] == []
    assert sorted(p.name for p in source.iterdir()) == ['1.03 Amending Agreement.pdf']


def test_wrong_letter_still_mislabeled(tmp_path):
    exhibits = tmp_path / 'exhibits'
    exhibits.mkdir()
    pdf(exhibits / 'Exhibit B.pdf', NOTE)
    inspected = run('inspect_exhibits.py', tmp_path,
                    {'exhibit_dirs': [str(exhibits)], 'png_out_dir': str(tmp_path / 'png')})
    matched = match(tmp_path, inspected['files'])
    assert matched['assignments'][0]['status'] == 'MISLABELED'
    assert matched['rename_mapping'] == [{'from': 'Exhibit B.pdf', 'to': 'Exhibit A.pdf'}]


def test_letterless_scanned_file_never_fills_a_missing_slot(tmp_path):
    scanned = {'letter': None, 'path': '/src/9.99 unrelated.pdf', 'classification': 'SCANNED',
               'page1_text': '', 'file_own_date': None}
    assert match(tmp_path, [scanned])['assignments'][0]['status'] == 'MISSING'


def test_lettered_scanned_leftover_still_unverified(tmp_path):
    scanned = {'letter': 'A', 'path': '/x/Exhibit A.pdf', 'classification': 'SCANNED',
               'page1_text': '', 'file_own_date': None}
    assert match(tmp_path, [scanned])['assignments'][0]['status'] == 'UNVERIFIED'


def test_exhibit_dirs_scan_unchanged(tmp_path):
    exhibits = tmp_path / 'exhibits'
    exhibits.mkdir()
    pdf(exhibits / '1.03 Amending Agreement.pdf', NOTE)
    pdf(exhibits / 'Exhibit A.pdf', NOTE)
    inspected = run('inspect_exhibits.py', tmp_path,
                    {'exhibit_dirs': [str(exhibits)], 'png_out_dir': str(tmp_path / 'png')})
    assert [f['letter'] for f in inspected['files']] == ['A']
    assert inspected['unmatched_files'] == [str(exhibits / '1.03 Amending Agreement.pdf')]
