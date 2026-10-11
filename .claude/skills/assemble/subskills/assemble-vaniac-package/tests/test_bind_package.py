"""bind_package.py: the whole package binds in order with divider pages, every
index page cell equals the page its part starts on, an unsigned witness
stops binding unless the practitioner directs otherwise, and nothing in the
Package folder changes."""
from __future__ import annotations

import json

import fitz
import pytest

import bind_package
import fill_vaniac
from bind_package import BindError, bind
from conftest import fake_convert, pdf
from gather_exhibits import gather


def _ready(p, sign=True):
    gather(p['index_json'], p['trace'], p['matter'], p['package'])
    if sign:
        pdf(p['package'] / 'Witness Statement of A. Renwick - signed.pdf', ['SIGNED-P1', 'SIGNED-P2'])


def _bind(p, tmp_path, monkeypatch, **kw):
    calls = []
    real = bind_package.index_renderer

    def spy(data, work_dir, convert):
        render = real(data, work_dir, convert)

        def wrapped(cells):
            calls.append(list(cells))
            return render(cells)
        return wrapped

    monkeypatch.setattr(bind_package, 'index_renderer', spy)
    work = tmp_path / 'work'
    work.mkdir(exist_ok=True)
    result = bind(p['index_json'], p['package'], None, work, convert=fake_convert, **kw)
    return result, calls[-1]


def test_binds_the_whole_package_with_correct_index_pages(published, tmp_path, monkeypatch):
    _ready(published)
    pdf(published['package'] / 'Expert Report of Dr. Z. Quill.pdf', ['EXPERT-P1'])
    before = {f.name: f.read_bytes() for f in published['package'].iterdir()}

    result, cells = _bind(published, tmp_path, monkeypatch)

    out = published['sub'] / "Claimant's Opening Submissions.pdf"
    assert result['volumes'][0]['path'] == str(out)
    assert result['parts'] == ['Written Argument of the Claimant', 'Witness Statement of A. Renwick',
                               'Expert Report of Dr. Z. Quill',
                               'Exhibit 1 - The signed agreement, s. 2.3 at issue',
                               'Exhibit 2 - (not recorded)',
                               'Exhibit 3 - Daily entries for the final week of the project',
                               'Exhibit 4 - Delivery log for the final week of the project']
    with fitz.open(out) as doc:
        toc = {title: page for _, title, page in doc.get_toc()}
        data = json.loads(published['index_json'].read_text(encoding='utf-8'))
        data['experts'] = ['Dr. Z. Quill']
        rows = fill_vaniac.index_rows(data)
        parts = result['parts']
        for row, cell in zip(rows, cells):
            if row['part'] is None:
                assert cell == ''
            else:
                start = toc[parts[row['part']]]
                assert cell == str(start)
                assert doc[start - 1].get_label() == cell
        ex1 = toc[parts[3]]
        assert 'Exhibit 1' in doc[ex1 - 1].get_text()
        assert 'The signed agreement, s. 2.3 at issue' in doc[ex1 - 1].get_text()
        assert 'AGREEMENT-P3' in doc[ex1].get_text()
        assert 'SIGNED-P1' in doc[toc[parts[1]] - 1].get_text()
        assert "CLAIMANT'S OPENING SUBMISSIONS" in doc[0].get_text()
    assert {f.name: f.read_bytes() for f in published['package'].iterdir()} == before


def test_unsigned_witness_stops_binding(published, tmp_path, monkeypatch):
    _ready(published, sign=False)
    with pytest.raises(BindError) as err:
        _bind(published, tmp_path, monkeypatch)
    assert err.value.code == 'unsigned_witness'
    assert 'A. Renwick' in err.value.detail


def test_directed_unsigned_witness_binds_and_is_recorded(published, tmp_path, monkeypatch):
    _ready(published, sign=False)
    words = 'Bind the unsigned statement; he signs on Monday.'
    result, _ = _bind(published, tmp_path, monkeypatch, bind_unsigned={'A. Renwick': words})
    assert 'Witness Statement of A. Renwick' in result['parts']
    saved = json.loads(published['index_json'].read_text(encoding='utf-8'))
    assert saved['unsigned_directions'] == {'A. Renwick': words}


def test_missing_exhibit_file_stops(published, tmp_path, monkeypatch):
    pdf(published['package'] / 'Witness Statement of A. Renwick - signed.pdf', ['SIGNED-P1'])
    with pytest.raises(BindError) as err:
        _bind(published, tmp_path, monkeypatch)
    assert err.value.code == 'missing_file'
    assert '[1, 2, 3, 4]' in err.value.detail


def test_never_overwrites(published, tmp_path, monkeypatch):
    _ready(published)
    (published['sub'] / "Claimant's Opening Submissions.pdf").write_bytes(b'%PDF-1.4')
    with pytest.raises(BindError) as err:
        _bind(published, tmp_path, monkeypatch)
    assert err.value.code == 'output_exists'
