"""bind_general.py: a general Writing's .docx binds first, then each enclosure
in the order given, a page range appends only those pages, every unresolved
enclosure is named before anything is bound, and nothing is overwritten."""
from __future__ import annotations

import json
import os
import shutil
import sys
from pathlib import Path

import fitz
import pytest
from docx import Document

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'scripts'))

import bind_general  # noqa: E402
from bind_general import BindError, bind  # noqa: E402
from paginate_book import BookError  # noqa: E402


def unsigned(docx: Path) -> Path:
    return docx.with_name(f'{docx.stem} UNSIGNED.pdf')


def pdf(path: Path, labels: list[str]) -> Path:
    doc = fitz.open()
    for text in labels:
        doc.new_page(width=612, height=792).insert_text((72, 400), text, fontsize=14)
    doc.save(path)
    doc.close()
    return path


def fake_convert(pages: int):
    """A stand-in for Word: any .docx becomes a PDF of `pages` LETTER pages."""
    def convert(docx_path: Path, pdf_path: Path) -> Path:
        return pdf(pdf_path, [f'LETTER-{n}' for n in range(1, pages + 1)])
    return convert


def texts(path: Path) -> list[str]:
    with fitz.open(path) as doc:
        return [page.get_text().strip() for page in doc]


@pytest.fixture
def writing(tmp_path):
    folder = tmp_path / '0. DRAFT' / 'L1 Letter'
    folder.mkdir(parents=True)
    docx = folder / 'Letter to opposing counsel.docx'
    docx.write_bytes(b'stand-in')
    prior = pdf(tmp_path / 'prior letter.pdf', ['PRIOR-1', 'PRIOR-2', 'PRIOR-3', 'EMAIL-4', 'PRIOR-5'])
    statement = pdf(tmp_path / 'statement.pdf', ['STATEMENT-1', 'STATEMENT-2'])
    return {'docx': docx, 'prior': prior, 'statement': statement}


def test_letter_then_enclosures_in_order_with_page_range(writing):
    manifest = {'docx': str(writing['docx']), 'enclosures': [
        {'label': 'Email of September 14', 'path': str(writing['prior']), 'pages': '4'},
        {'label': 'Statement', 'path': str(writing['statement'])},
    ]}
    result = bind(manifest, convert=fake_convert(2))

    out = unsigned(writing['docx'])
    assert result['output'] == str(out)
    assert result['page_count'] == 2 + 1 + 2
    assert texts(out) == ['LETTER-1', 'LETTER-2', 'EMAIL-4', 'STATEMENT-1', 'STATEMENT-2']
    with fitz.open(out) as doc:
        assert doc.get_toc() == [[1, 'Letter to opposing counsel', 1],
                                 [1, 'Email of September 14', 3], [1, 'Statement', 4]]


def test_range_of_pages(writing):
    manifest = {'docx': str(writing['docx']), 'enclosures': [
        {'label': 'Pages 2 to 3', 'path': str(writing['prior']), 'pages': '2-3'}]}
    bind(manifest, convert=fake_convert(1))
    assert texts(unsigned(writing['docx'])) == ['LETTER-1', 'PRIOR-2', 'PRIOR-3']


def test_no_enclosures_is_the_writing_alone(writing):
    result = bind({'docx': str(writing['docx']), 'enclosures': []}, convert=fake_convert(3))
    assert result['page_count'] == 3


def test_every_unresolved_enclosure_is_named_before_binding(writing, tmp_path):
    email = tmp_path / 'email.msg'
    email.write_bytes(b'x')
    corrupt = tmp_path / 'corrupt.pdf'
    corrupt.write_bytes(b'not a pdf')
    manifest = {'docx': str(writing['docx']), 'enclosures': [
        {'label': 'Missing', 'path': str(tmp_path / 'nope.pdf')},
        {'label': 'Email', 'path': str(email)},
        {'label': 'Past the end', 'path': str(writing['statement']), 'pages': '3'},
        {'label': 'Backwards', 'path': str(writing['prior']), 'pages': '4-2'},
        {'label': 'Corrupt', 'path': str(corrupt)},
    ]}
    with pytest.raises(BindError) as err:
        bind(manifest, convert=fake_convert(1))
    assert err.value.code == 'enclosure_unresolved'
    assert [item['enclosure'] for item in err.value.detail] == ['Missing', 'Email', 'Past the end', 'Backwards', 'Corrupt']
    assert 'print it to PDF' in err.value.detail[1]['reason']
    assert not unsigned(writing['docx']).exists()


def test_existing_output_is_never_overwritten(writing):
    out = pdf(unsigned(writing['docx']), ['KEEP'])
    with pytest.raises(BindError) as err:
        bind({'docx': str(writing['docx']), 'enclosures': []}, convert=fake_convert(1))
    assert err.value.code == 'output_exists'
    assert texts(out) == ['KEEP']


def test_failed_conversion_writes_nothing(writing):
    def no_converter(docx_path, pdf_path):
        raise BookError('docx_conversion_failed', 'word_com: absent; soffice: absent')
    with pytest.raises(BookError):
        bind({'docx': str(writing['docx']), 'enclosures': []}, convert=no_converter)
    assert not unsigned(writing['docx']).exists()


def test_output_is_written_through_a_temporary_file(writing, monkeypatch):
    moves = []
    real_replace = os.replace
    monkeypatch.setattr(bind_general.os, 'replace', lambda src, dst: (moves.append((Path(src), Path(dst))), real_replace(src, dst)))
    bind({'docx': str(writing['docx']), 'enclosures': []}, convert=fake_convert(1))
    [(src, dst)] = moves
    assert dst == unsigned(writing['docx'])
    assert src.parent == dst.parent and src.name.startswith('~') and not src.exists()


def test_a_bind_killed_before_the_rename_leaves_no_pdf_at_the_output_name(writing, monkeypatch):
    def killed(src, dst):
        raise KeyboardInterrupt
    monkeypatch.setattr(bind_general.os, 'replace', killed)
    with pytest.raises(KeyboardInterrupt):
        bind({'docx': str(writing['docx']), 'enclosures': []}, convert=fake_convert(1))
    assert not unsigned(writing['docx']).exists()


def test_an_output_that_appears_during_the_bind_is_not_overwritten(writing):
    out = unsigned(writing['docx'])
    def convert_then_collide(docx_path, pdf_path):
        pdf(out, ['KEEP'])
        return fake_convert(1)(docx_path, pdf_path)
    with pytest.raises(BindError) as err:
        bind({'docx': str(writing['docx']), 'enclosures': []}, convert=convert_then_collide)
    assert err.value.code == 'output_exists'
    assert texts(out) == ['KEEP']
    assert [p.name for p in out.parent.iterdir() if p.name.startswith('~')] == []


def test_working_folder_carries_the_data_runtime_staging_tag(writing, monkeypatch):
    monkeypatch.setenv('COCLERK_STAGING_TAG', 'tag1321')
    seen = []
    def convert(docx_path, pdf_path):
        seen.append(pdf_path.parent.name)
        return fake_convert(1)(docx_path, pdf_path)
    bind({'docx': str(writing['docx']), 'enclosures': []}, convert=convert)
    assert seen[0].startswith('coclerk_bindgeneral_tag1321_')


def test_missing_docx_is_refused(tmp_path):
    with pytest.raises(BindError) as err:
        bind({'docx': str(tmp_path / 'gone.docx'), 'enclosures': []}, convert=fake_convert(1))
    assert err.value.code == 'docx_missing'


def test_explicit_output_and_docx_unchanged(writing, tmp_path):
    before = writing['docx'].read_bytes()
    out = writing['docx'].parent / 'Letter v2.pdf'
    result = bind({'docx': str(writing['docx']), 'output': str(out), 'enclosures': []},
                  convert=fake_convert(1))
    assert result['output'] == str(out)
    assert writing['docx'].read_bytes() == before


def run_main(monkeypatch, capsys, manifest_path: Path) -> tuple[int, list[str]]:
    monkeypatch.setattr(sys, 'argv', ['bind_general.py', '--manifest', str(manifest_path)])
    code = bind_general.main()
    return code, capsys.readouterr().out.splitlines()


@pytest.mark.parametrize('content', [None, '{not json', b'\xff\xfe\x9c'])
def test_a_missing_or_invalid_manifest_is_manifest_unreadable(tmp_path, monkeypatch, capsys, content):
    path = tmp_path / 'enclosures.json'
    if isinstance(content, bytes):
        path.write_bytes(content)
    elif content is not None:
        path.write_text(content, encoding='utf-8')
    code, lines = run_main(monkeypatch, capsys, path)
    assert code == 1 and len(lines) == 1
    assert json.loads(lines[0])['error'] == 'manifest_unreadable'


@pytest.mark.parametrize('exc', [PermissionError(13, 'Permission denied'), RuntimeError('defect')])
def test_an_unexpected_bind_failure_is_one_internal_error_line(tmp_path, monkeypatch, capsys, exc):
    path = tmp_path / 'enclosures.json'
    path.write_text('{}', encoding='utf-8')

    def fail(*args):
        raise exc

    monkeypatch.setattr(bind_general, 'bind', fail)
    code, lines = run_main(monkeypatch, capsys, path)
    assert code == 1 and len(lines) == 1
    out = json.loads(lines[0])
    assert out['error'] == 'internal_error'
    assert out['detail'] == repr(exc) and out['trace']


@pytest.mark.parametrize('exc', [BindError('docx_missing', 'gone'), BookError('conversion_failed', 'Word refused')])
def test_a_bind_refusal_keeps_its_own_code(tmp_path, monkeypatch, capsys, exc):
    path = tmp_path / 'enclosures.json'
    path.write_text('{}', encoding='utf-8')

    def fail(*args):
        raise exc

    monkeypatch.setattr(bind_general, 'bind', fail)
    code, lines = run_main(monkeypatch, capsys, path)
    assert code == 1
    assert json.loads(lines[0]) == {'success': False, 'error': exc.code, 'detail': exc.detail}


def _converter_available() -> bool:
    word = Path(os.environ.get('ProgramFiles', r'C:\Program Files')) / 'Microsoft Office' / 'root' / 'Office16' / 'WINWORD.EXE'
    return word.is_file() or shutil.which('soffice') is not None


@pytest.mark.skipif(not _converter_available(), reason='neither Word nor LibreOffice is installed')
def test_real_conversion_plus_page_range(tmp_path, writing):
    docx = tmp_path / 'Real letter.docx'
    document = Document()
    document.add_paragraph('Dear Counsel,')
    document.add_page_break()
    document.add_paragraph('Yours truly,')
    document.save(docx)

    result = bind({'docx': str(docx), 'enclosures': [
        {'label': 'Email', 'path': str(writing['prior']), 'pages': '4'}]})

    out = unsigned(docx)
    pages = texts(out)
    assert result['page_count'] == 3 == len(pages)
    assert 'Dear Counsel' in pages[0] and 'Yours truly' in pages[1]
    assert pages[2] == 'EMAIL-4'
