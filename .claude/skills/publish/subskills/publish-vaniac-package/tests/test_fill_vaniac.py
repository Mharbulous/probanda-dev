"""fill_vaniac.py on the filed-render fixtures (copies of the MCP test
fixtures written-argument-filed.md, witness-statement-filed.md and
evidence-index-filed.md): the documents come out well-formed with the
expected names and text, the index page column is blank, a line outside
the filed grammar is refused by name, a re-publish is refused while the
previous set sits in the package folder and rewrites the index once it is
cleared, and only the named witnesses are filled."""
from __future__ import annotations

import json
import re
import shutil
import sys
import zipfile
from pathlib import Path

import pytest
from lxml import etree

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'scripts'))

from fill_vaniac import FillError, build_index, fill, index_rows  # noqa: E402

FIXTURES = Path(__file__).resolve().parent / 'fixtures'
WITNESSES = ['A. Renwick']


def _text(docx: Path) -> str:
    with zipfile.ZipFile(docx) as z:
        xml = z.read('word/document.xml')
        etree.fromstring(xml)
        assert 'document.main+xml' in z.read('[Content_Types].xml').decode()
    return re.sub(r'<[^>]+>', ' ', xml.decode('utf-8'))


def _source(tmp_path: Path) -> Path:
    src = tmp_path / 'vaniac-submissions' / 'Claimant Opening Submissions'
    shutil.copytree(FIXTURES, src)
    return src


def _index(tmp_path: Path) -> Path:
    return tmp_path / 'vaniac-submissions' / 'Claimant Opening Submissions' / 'Package index.json'


def test_fill_writes_every_document(tmp_path):
    package = tmp_path / 'Package'
    result = fill(_source(tmp_path), package, 'opening', _index(tmp_path), WITNESSES)
    names = sorted(Path(p).name for p in result['documents'])
    assert names == ['Index.docx', 'Witness Statement of A. Renwick.docx',
                     'Written Argument of the Claimant.docx']

    argument = _text(package / 'Written Argument of the Claimant.docx')
    assert 'WRITTEN ARGUMENT OF THE CLAIMANT' in argument
    assert 'The obligation is not confined to documents the party intends to rely on.' in argument
    assert 'Tekk Enterprises v. Acme Co.' in argument
    assert 'The Claimant asks the Arbitral Tribunal to award the following relief.' in argument

    statement = _text(package / 'Witness Statement of A. Renwick.docx')
    assert 'I was the project manager on the contract at issue.' in statement
    assert 'Signed at:' in statement

    assert result['index_json'] == str(_index(tmp_path))
    assert not (tmp_path / 'Package index.json').exists()
    data = json.loads(_index(tmp_path).read_text(encoding='utf-8'))
    assert data['side'] == 'Claimant'
    assert data['witnesses'] == ['A. Renwick']
    assert [x['number'] for x in data['exhibits']] == [1, 2, 3, 4]
    assert data['exhibits'][0]['description'] == 'The signed agreement, s. 2.3 at issue'


def test_index_page_column_is_blank_then_fillable(tmp_path):
    package = tmp_path / 'Package'
    fill(_source(tmp_path), package, 'opening', _index(tmp_path), WITNESSES)
    index = _text(package / 'Index.docx')
    assert "CLAIMANT'S OPENING SUBMISSIONS" in index
    assert 'WRITTEN ARGUMENT OF THE CLAIMANT' not in index
    assert 'Written Argument of the Claimant' in index
    assert 'Ex. 4' in index

    data = json.loads(_index(tmp_path).read_text(encoding='utf-8'))
    rows = index_rows(data)
    assert [r['part'] for r in rows] == [0, None, 1, None, 2, 3, 4, 5]
    cells = [str(900 + k) if r['part'] is not None else '' for k, r in enumerate(rows)]
    filled = _text(build_index(data, tmp_path / 'filled.docx', pages=cells, cover=False))
    assert all(c in filled for c in cells if c)
    assert 'OPENING SUBMISSIONS' not in filled


def test_expert_reports_found_in_package_are_indexed(tmp_path):
    package = tmp_path / 'Package'
    package.mkdir()
    (package / 'Expert Report of Dr. Z. Quill.pdf').write_bytes(b'%PDF-1.4')
    fill(_source(tmp_path), package, 'reply', _index(tmp_path), WITNESSES)
    assert 'Expert Report of Dr. Z. Quill' in _text(package / 'Index.docx')


def test_out_of_grammar_line_is_refused_by_name(tmp_path):
    src = _source(tmp_path)
    path = src / 'Written Arguments.md'
    path.write_text(path.read_text(encoding='utf-8') + '\n<!-- leaked comment -->\n', encoding='utf-8')
    with pytest.raises(FillError) as err:
        fill(src, tmp_path / 'Package', 'opening', _index(tmp_path), WITNESSES)
    assert err.value.code == 'out_of_grammar'
    assert 'Written Arguments.md line' in err.value.detail


def test_never_overwrites(tmp_path):
    src = _source(tmp_path)
    fill(src, tmp_path / 'Package', 'opening', _index(tmp_path), WITNESSES)
    before = {p: p.read_bytes() for p in list((tmp_path / 'Package').iterdir()) + [_index(tmp_path)]}
    with pytest.raises(FillError) as err:
        fill(src, tmp_path / 'Package', 'reply', _index(tmp_path), WITNESSES)
    assert err.value.code == 'output_exists'
    assert 'Package index.json' not in err.value.detail
    after = {p: p.read_bytes() for p in list((tmp_path / 'Package').iterdir()) + [_index(tmp_path)]}
    assert after == before


@pytest.mark.parametrize('placed', ['Written Argument of the Claimant.pdf',
                                    'Witness Statement of A. Renwick - signed.pdf'])
def test_refuses_a_pdf_bind_would_take_by_name(tmp_path, placed):
    package = tmp_path / 'Package'
    package.mkdir()
    (package / placed).write_bytes(b'%PDF-1.4')
    with pytest.raises(FillError) as err:
        fill(_source(tmp_path), package, 'opening', _index(tmp_path), WITNESSES)
    assert err.value.code == 'output_exists'
    assert placed in err.value.detail
    assert not _index(tmp_path).exists()


def test_republish_rewrites_the_index_once_the_package_is_cleared(tmp_path):
    src = _source(tmp_path)
    fill(src, tmp_path / 'Package', 'opening', _index(tmp_path), WITNESSES)
    data = json.loads(_index(tmp_path).read_text(encoding='utf-8'))
    data['unsigned_directions'] = {'A. Renwick': 'Witness abroad; signed copy to follow'}
    _index(tmp_path).write_text(json.dumps(data), encoding='utf-8')
    (tmp_path / 'Package').rename(tmp_path / 'old')

    fill(src, tmp_path / 'Package', 'reply', _index(tmp_path), WITNESSES)
    data = json.loads(_index(tmp_path).read_text(encoding='utf-8'))
    assert data['round'] == 'reply'
    assert data['unsigned_directions'] == {}
    assert data['previous_unsigned_directions'] == [{'A. Renwick': 'Witness abroad; signed copy to follow'}]

    (tmp_path / 'Package').rename(tmp_path / 'older')
    fill(src, tmp_path / 'Package', 'reply', _index(tmp_path), WITNESSES)
    data = json.loads(_index(tmp_path).read_text(encoding='utf-8'))
    assert data['previous_unsigned_directions'] == [{'A. Renwick': 'Witness abroad; signed copy to follow'}]


def test_only_the_named_witnesses_are_filled(tmp_path):
    src = _source(tmp_path)
    shutil.copy(src / 'Witness Statement - A. Renwick.md', src / 'Witness Statement - B. Dropped.md')
    result = fill(src, tmp_path / 'Package', 'opening', _index(tmp_path), WITNESSES)
    assert result['ignored_sources'] == ['Witness Statement - B. Dropped.md']
    assert json.loads(_index(tmp_path).read_text(encoding='utf-8'))['witnesses'] == ['A. Renwick']
    assert not (tmp_path / 'Package' / 'Witness Statement of B. Dropped.docx').exists()


def test_a_named_witness_without_a_source_is_refused(tmp_path):
    with pytest.raises(FillError) as err:
        fill(_source(tmp_path), tmp_path / 'Package', 'opening', _index(tmp_path), ['B. Nobody'])
    assert err.value.code == 'missing_source'


def test_an_unreadable_old_index_is_refused_by_name(tmp_path):
    src = _source(tmp_path)
    _index(tmp_path).write_text('{not json', encoding='utf-8')
    with pytest.raises(FillError) as err:
        fill(src, tmp_path / 'Package', 'opening', _index(tmp_path), WITNESSES)
    assert err.value.code == 'index_unreadable'
    assert not (tmp_path / 'Package').exists()


def test_bad_round_is_refused(tmp_path):
    with pytest.raises(FillError) as err:
        fill(_source(tmp_path), tmp_path / 'Package', 'rebuttal', _index(tmp_path), WITNESSES)
    assert err.value.code == 'bad_round'


if __name__ == '__main__':
    raise SystemExit(pytest.main([__file__, '-q']))
