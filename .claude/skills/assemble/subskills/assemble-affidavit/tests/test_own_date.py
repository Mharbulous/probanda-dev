"""inspect_exhibits.py's file_own_date is the exhibit's own date or null, never a date the text
recites as another document's (WHEREAS clauses, "the note dated ..."), so match_exhibits.py does
not score a correct exhibit MISSING or MISLABELED (#1380)."""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import fitz
import pytest

SCRIPTS = Path(__file__).resolve().parent.parent / 'scripts'
sys.path.insert(0, str(SCRIPTS))
from inspect_exhibits import extract_file_own_date  # noqa: E402

NOTE = ['PROMISSORY NOTE', 'April 30, 2021', 'FOR VALUE RECEIVED the Borrower promises to pay',
        'the Lender the sum of $250,000.']
SECOND = ['2nd AMENDING AGREEMENT', 'THIS AGREEMENT is made as of September 29, 2022.',
          'WHEREAS the parties entered into the agreement dated April 30, 2021;',
          'NOW THEREFORE the parties agree to extend the maturity date.']
FOURTH = ['4th AMENDING AGREEMENT', 'This agreement amends the promissory note dated April 30, 2021.',
          'The parties agree to extend the maturity date.', 'DATED September 1, 2023']


@pytest.mark.parametrize('lines, expected', [
    (SECOND, {'September 29, 2022'}),
    (FOURTH, {'September 1, 2023'}),
    (NOTE, {'April 30, 2021'}),
    (['AMENDING AGREEMENT', 'This amends the note to ABC Ltd. dated April 30, 2021.',
      'DATED September 1, 2023'], {'September 1, 2023', None}),
    (['Dear Mr. Smith:', 'Dated: June 1, 2024', 'Please find enclosed the demand.'], {'June 1, 2024'}),
])
def test_own_date(lines, expected):
    assert extract_file_own_date('\n'.join(lines)) in expected


def test_only_recited_dates_give_null():
    assert extract_file_own_date('AMENDING AGREEMENT\nWHEREAS the parties made a note dated '
                                 'April 30, 2021;\nNOW THEREFORE the parties agree.') is None


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


def test_note_and_amendments_all_confirm(tmp_path):
    exhibits = tmp_path / 'exhibits'
    exhibits.mkdir()
    for letter, lines in (('A', NOTE), ('B', SECOND), ('C', FOURTH)):
        pdf(exhibits / f'Exhibit {letter}.pdf', lines)
    inspected = run('inspect_exhibits.py', tmp_path,
                    {'exhibit_dirs': [str(exhibits)], 'png_out_dir': str(tmp_path / 'png')})

    def desc(letter, own, terms):
        return {'letter': letter, 'paragraph': 1, 'identity_date': own,
                'identity_terms': [own, terms[0]], 'context_terms': terms[1:],
                'key_terms': [own, *terms]}

    descriptions = [
        desc('A', 'April 30, 2021', ['promissory note', '$250,000']),
        desc('B', 'September 29, 2022', ['2nd amending agreement', 'April 30, 2021']),
        desc('C', 'September 1, 2023', ['4th amending agreement', 'April 30, 2021']),
    ]
    matched = run('match_exhibits.py', tmp_path,
                  {'descriptions': descriptions, 'files': inspected['files']})
    assert [a['status'] for a in matched['assignments']] == ['CONFIRMED'] * 3
    assert matched['rename_mapping'] == []
