"""fill_factum.py: the validator rejects malformed bcca-factum.md files with the contract's error
codes, and a valid file fills the court's respondent's factum template with no instruction table,
example text or grey placeholder left behind. The fill writes <--out-name>.docx at the top of the
folder it is given, and a taken name gets the next " vN": nothing is ever overwritten."""
from __future__ import annotations

import errno
import json
import os
import re
import subprocess
import sys
import zipfile
from pathlib import Path

import pytest

SCRIPTS = Path(__file__).resolve().parent.parent / 'scripts'
sys.path.insert(0, str(SCRIPTS))

import fill_factum  # noqa: E402

VALID = (Path(__file__).resolve().parent / 'fixtures' / 'valid-bcca-factum.md').read_text(encoding='utf-8')


def _xml(docx: Path, part: str = 'word/document.xml') -> str:
    with zipfile.ZipFile(docx) as z:
        assert z.testzip() is None
        return z.read(part).decode('utf-8')


def _paragraph_texts(xml: str) -> list[str]:
    return [re.sub(r'<[^>]+>', '', p) for p in re.findall(r'<w:p[ >].*?</w:p>', xml, flags=re.S)]


@pytest.fixture
def filled(tmp_path):
    data, sections = fill_factum.parse_bcca_factum(VALID)
    out = tmp_path / 'factum.docx'
    fill_factum.build_factum(data, sections, out)
    return out


def test_fill_leaves_no_template_scaffolding(filled):
    xml = _xml(filled)
    text = '\n'.join(_paragraph_texts(xml))
    assert 'INSTRUCTIONS (please remove table' not in text
    for leftover in ('Enter ', '[Enter', 'Example', 'Kelowna', 'Loyola', 'LIMITATION ACT', 'FORMTEXT'):
        assert leftover not in xml, leftover


def test_fill_writes_every_part(filled):
    texts = _paragraph_texts(_xml(filled))
    joined = '\n'.join(texts)
    for expected in (
        'COURT OF APPEAL FILE NO. CA52140',
        'ON APPEAL FROM the order of Madam Justice Trelawney of the Supreme Court of British Columbia pronounced on the 29th day of June, 2026',
        'RESPONDENTS\' FACTUM',
        'June 29, 2026',
        'This appeal concerns an arbitration stay.',
        'The respondents agree with the appellants\' statement of facts, except as set out below.',
        'the standard of review for questions of law is correctness',
        'that the appeal be dismissed, with costs to the respondents.',
        'Dated at the City of Vancouver, Province of British Columbia, this September 16 of 2026.',
        'Elena Marsh',
        'Counsel for the Respondents',
        '7 (1) If a party to an arbitration agreement commences legal proceedings, the court must stay them.',
        'Caldwell, Fenn & Roe LLP'.replace('&', '&amp;'),
    ):
        assert expected in joined, expected


def test_numbered_paragraphs_use_the_templates_single_list(filled):
    xml = _xml(filled)
    numbered = [p for p in re.findall(r'<w:p[ >].*?</w:p>', xml, flags=re.S) if '<w:numId w:val="10"/>' in p]
    assert len(numbered) == 9, 'Parts 1-4 hold nine numbered paragraphs, all on the template list'
    opening = xml[xml.index('This appeal concerns'):xml.index('The chambers judge made no error.')]
    assert 'numId' not in opening, 'opening statement is not numbered'


def test_authorities_page_refs_and_update_fields(filled):
    xml = _xml(filled)
    assert 'PAGEREF factum_para_5 \\h' in xml and 'PAGEREF factum_para_7 \\h' in xml
    assert '<w:bookmarkStart w:id="9005" w:name="factum_para_5"/>' in xml
    assert '<w:updateFields w:val="true"/>' in _xml(filled, 'word/settings.xml')
    with zipfile.ZipFile(filled) as z:
        assert 'document.main+xml' in z.read('[Content_Types].xml').decode('utf-8')


def _invalid(mutate) -> tuple[str, str]:
    with pytest.raises(fill_factum.ValidationError) as e:
        fill_factum.parse_bcca_factum(mutate(VALID))
    return e.value.code, e.value.detail


@pytest.mark.parametrize('mutate, code', [
    (lambda t: t.replace('dated_on: 2026-09-16\n', ''), 'missing_required_key'),
    (lambda t: t.replace('## PART 2 - ISSUES ON APPEAL', '## PART 3 - ARGUMENT', 1), 'heading_order'),
    (lambda t: t.replace('## OPENING STATEMENT', '## OPENING'), 'unknown_heading'),
    (lambda t: t.replace('3. The chambers judge applied', '4. The chambers judge applied', 1), 'numbering'),
    (lambda t: t.replace('This appeal concerns', '1. This appeal concerns'), 'bad_opening_statement'),
    (lambda t: t.replace('2. The arbitration was commenced', '<!-- x --> The arbitration'), 'disallowed_markup'),
    (lambda t: t.replace('"paras": [7]', '"paras": [12]'), 'bad_authority'),
    (lambda t: t.replace('dated_on: 2026-09-16', 'dated_on: 16 September 2026'), 'bad_date'),
    (lambda t: t.replace('that the appeal be dismissed, with costs to the respondents.\n', ''), 'bad_part4'),
])
def test_validator_rejects(mutate, code):
    assert _invalid(mutate)[0] == code


STEM = '2026-09-16 FACTUM re respondents'


def _cli(*args) -> tuple[int, dict]:
    proc = subprocess.run([sys.executable, '-B', str(SCRIPTS / 'fill_factum.py'), *map(str, args)],
                          capture_output=True, text=True)
    return proc.returncode, json.loads(proc.stdout)


@pytest.fixture
def cli(tmp_path):
    src = tmp_path / 'bcca-factum.md'
    src.write_text(VALID, encoding='utf-8')
    draft = tmp_path / '0. DRAFT'
    draft.mkdir()
    return src, draft


def test_cli_validate(cli):
    src, _ = cli
    assert _cli('--validate', src) == (0, {'success': True})


def test_fill_writes_the_stem_at_the_folder_root(cli):
    src, draft = cli
    code, result = _cli(src, draft, '--out-name', STEM)
    assert code == 0, result
    assert result == {'success': True, 'document': 'factum', 'path': str(draft / f'{STEM}.docx')}
    assert [p.name for p in draft.iterdir()] == [f'{STEM}.docx']


def test_a_second_fill_versions_to_v2_and_reports_versioned_from(cli):
    src, draft = cli
    _, first = _cli(src, draft, '--out-name', STEM)
    original = Path(first['path']).read_bytes()
    code, second = _cli(src, draft, '--out-name', STEM)
    assert code == 0, second
    assert second['path'] == str(draft / f'{STEM} v2.docx')
    assert second['versioned_from'] == first['path']
    assert Path(first['path']).read_bytes() == original
    assert sorted(p.name for p in draft.iterdir()) == [f'{STEM} v2.docx', f'{STEM}.docx']


def test_a_name_taken_at_the_move_is_refused_not_replaced(cli, capsys, monkeypatch):
    """A file that appears after the name is chosen, just before the move, is refused (#1434)."""
    src, draft = cli
    competing = draft / f'{STEM}.docx'
    real = fill_factum.move_exclusive

    def racing(tmp, dst):
        competing.write_bytes(b'another session')
        os.utime(competing, (1_000_000_000, 1_000_000_000))
        real(tmp, dst)

    monkeypatch.setattr(fill_factum, 'move_exclusive', racing)
    monkeypatch.setattr(sys, 'argv', ['fill_factum.py', str(src), str(draft), '--out-name', STEM])
    assert fill_factum.main() == 1
    assert json.loads(capsys.readouterr().out.splitlines()[-1]) == {
        'success': False, 'error': 'output_exists', 'detail': f'{competing} already exists; never overwritten'}
    assert competing.read_bytes() == b'another session'
    assert competing.stat().st_mtime == 1_000_000_000
    assert [p.name for p in draft.iterdir()] == [competing.name]


def test_a_failed_exclusive_move_fails_loudly_and_writes_nothing(cli, monkeypatch):
    """No fallback to a replacing move when the exclusive move fails for another reason (#1434)."""
    src, draft = cli

    def refuse(tmp, dst):
        raise PermissionError(errno.EACCES, 'link refused', dst)

    monkeypatch.setattr(os, 'link', refuse)
    monkeypatch.setattr(sys, 'argv', ['fill_factum.py', str(src), str(draft), '--out-name', STEM])
    with pytest.raises(PermissionError):
        fill_factum.main()
    assert list(draft.iterdir()) == []


def test_the_next_version_is_one_past_the_highest(cli):
    src, draft = cli
    (draft / f'{STEM} v2.docx').write_bytes(b'version two')
    code, result = _cli(src, draft, '--out-name', STEM)
    assert code == 0, result
    assert result['path'] == str(draft / f'{STEM} v3.docx')
    assert result['versioned_from'] == str(draft / f'{STEM} v2.docx')
    assert (draft / f'{STEM} v2.docx').read_bytes() == b'version two'


@pytest.mark.parametrize('stem', ['', '   ', 'FACTUM re a/b', 'FACTUM re a\\b', 'FACTUM re "x"',
                                  'FACTUM re x.docx', 'FACTUM re x.pdf', 'FACTUM re x v2'])
def test_a_bad_stem_is_refused(cli, stem):
    src, draft = cli
    code, result = _cli(src, draft, '--out-name', stem)
    assert code == 1 and result['error'] == 'bad_input', result
    assert list(draft.iterdir()) == []


def test_a_missing_folder_is_refused_and_not_created(cli):
    src, draft = cli
    missing = draft / 'FACTUM Respondents'
    code, result = _cli(src, missing, '--out-name', STEM)
    assert code == 1 and result['error'] == 'no_out_dir', result
    assert not missing.exists()
