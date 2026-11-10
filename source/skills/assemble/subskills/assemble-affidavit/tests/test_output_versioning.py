"""assemble.py and paginate.py write to the output_path the caller names, at the draft folder's
root or in a package folder, never overwrite: a taken name gets v(highest + 1) and the result
names the copy passed over as versioned_from. Neither creates a folder (#1324)."""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import fitz
import pytest

SCRIPTS = Path(__file__).resolve().parent.parent / 'scripts'
DRAFT = '2026-10-01 AFF#1 AshbyG - DRAFT for Review.pdf'
COMPLETE = '2026-10-01 AFF#1 AshbyG - Complete with Exhibits.pdf'


def pdf(path: Path, lines: list[tuple[int, str]]) -> Path:
    doc = fitz.open()
    page = doc.new_page(width=612, height=792)
    for y, text in lines:
        page.insert_text((72, y), text, fontsize=12)
    doc.save(path)
    doc.close()
    return path


def run(script: str, tmp_path: Path, data: dict) -> dict:
    payload = tmp_path / 'input.json'
    payload.write_text(json.dumps(data), encoding='utf-8')
    result = subprocess.run([sys.executable, '-B', str(SCRIPTS / script), str(payload)],
                            capture_output=True, text=True)
    return json.loads(result.stdout)


@pytest.fixture
def draft(tmp_path):
    folder = tmp_path / '0. DRAFT'
    folder.mkdir()
    return folder


@pytest.fixture
def affidavit(tmp_path, draft):
    """A one-page affidavit of service shape (no identifier block) and one exhibit."""
    aff = pdf(tmp_path / 'affidavit.pdf', [
        (300, 'AFFIRMED BEFORE ME at'),
        (320, 'Vancouver, Province of British Columbia,'),
        (340, 'this 1st day of June, 2026.'),
    ])
    exhibit = pdf(tmp_path / 'exhibit.pdf', [(100, 'EXHIBIT CONTENT')])
    return {'affiant_name': 'Glen Ashby', 'affidavit_number': 1,
            'jurat_verb': 'AFFIRMED', 'signing_date': '2026-10-01',
            'affidavit_pdf': str(aff), 'header_bbox': None, 'jurat_bbox': [72, 325, 340, 370],
            'exhibits': [{'letter': 'A', 'path': str(exhibit)}],
            'name_affiant_on_stamps': False, 'output_path': str(draft / DRAFT)}


def assert_series(script, tmp_path, draft, data, name):
    stem = name[:-len('.pdf')]
    first, v2, v3 = draft / name, draft / f'{stem} v2.pdf', draft / f'{stem} v3.pdf'
    result = run(script, tmp_path, data)
    assert result['success'], result
    assert result['output_path'] == str(first)
    assert 'versioned_from' not in result
    original = first.read_bytes()
    for path, prior in ((v2, first), (v3, v2)):
        result = run(script, tmp_path, data)
        assert result['output_path'] == str(path)
        assert result['versioned_from'] == str(prior)
    assert first.read_bytes() == original
    return [first.name, v2.name, v3.name]


def test_assemble_versions_the_draft_at_the_root(tmp_path, draft, affidavit):
    names = assert_series('assemble.py', tmp_path, draft, affidavit, DRAFT)
    assert sorted(p.name for p in draft.iterdir()) == sorted(names)


def test_paginate_versions_the_complete_copy_at_the_root(tmp_path, draft):
    source = pdf(draft / DRAFT, [(100, 'PAGE ONE')])
    data = {'input_pdf': str(source), 'output_path': str(draft / COMPLETE)}
    names = assert_series('paginate.py', tmp_path, draft, data, COMPLETE)
    assert sorted(p.name for p in draft.iterdir()) == sorted([DRAFT, *names])


@pytest.mark.parametrize('script', ['assemble.py', 'paginate.py'])
def test_a_missing_output_folder_is_refused_and_not_created(tmp_path, draft, affidavit, script):
    package = draft / 'NOA Stay'
    data = {**affidavit, 'output_path': str(package / DRAFT)}
    if script == 'paginate.py':
        data = {'input_pdf': affidavit['affidavit_pdf'], 'output_path': str(package / COMPLETE)}
    result = run(script, tmp_path, data)
    assert result['error'] == 'no_output_dir'
    assert not package.exists()
