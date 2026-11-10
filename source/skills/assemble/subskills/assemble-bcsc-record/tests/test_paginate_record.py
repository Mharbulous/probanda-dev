"""paginate_record.py: consecutive numbering, the index's page column, bookmarks
and the index-only PDF, on PyMuPDF-built fixtures."""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pymupdf as fitz
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'scripts'))

from paginate_record import RecordError, bind, load_manifest  # noqa: E402

SCRIPT = Path(__file__).resolve().parent.parent / 'scripts' / 'paginate_record.py'


def _pdf(path: Path, pages: int, label: str) -> Path:
    doc = fitz.open()
    for j in range(pages):
        doc.new_page(width=612, height=792).insert_text((72, 400), f'{label}-P{j}', fontsize=14)
    doc.save(path)
    return path


def _manifest(tmp_path: Path, tab_pages=(2, 1, 3), titles=None) -> Path:
    titles = titles or [f'Document {k + 1}' for k in range(len(tab_pages))]
    data = {
        'cover': str(_pdf(tmp_path / 'cover.pdf', 1, 'COVER')),
        'tabs': [{'tab': k + 1, 'title': titles[k], 'kind': 'filed_evidence',
                  'path': str(_pdf(tmp_path / f'tab{k}.pdf', n, f'TAB{k}'))}
                 for k, n in enumerate(tab_pages)],
        'output': str(tmp_path / 'out' / 'Record.pdf'),
        'index_output': str(tmp_path / 'out' / 'Record - Index.pdf'),
    }
    path = tmp_path / 'manifest.json'
    path.write_text(json.dumps(data), encoding='utf-8')
    return path


def test_binds_numbers_and_indexes(tmp_path):
    result = bind(load_manifest(_manifest(tmp_path)))
    # cover 1, index 2, tabs start at 3, 5 and 6
    assert [t['page'] for t in result['tabs']] == [3, 5, 6]
    assert result['page_count'] == 8
    with fitz.open(result['record']) as doc:
        for number, page in enumerate(doc, 1):
            assert str(number) in page.get_text().split()
        index_text = doc[1].get_text()
        assert 'INDEX' in index_text and 'Document 2' in index_text
        assert doc.get_toc() == [[1, 'Cover Page', 1], [1, 'Index', 2], [1, 'Tab 1 – Document 1', 3],
                                 [1, 'Tab 2 – Document 2', 5], [1, 'Tab 3 – Document 3', 6]]
        assert 'TAB1-P0' in doc[4].get_text()
    with fitz.open(result['index']) as index:
        assert index.page_count == 1
        assert 'Document 3' in index[0].get_text()


def test_long_index_runs_to_more_pages_and_shifts_every_start(tmp_path):
    titles = [f'Affidavit #{k} of a deponent whose exhibits are many and whose title wraps onto a second line'
              for k in range(40)]
    result = bind(load_manifest(_manifest(tmp_path, tab_pages=[1] * 40, titles=titles)))
    with fitz.open(result['index']) as index:
        n_index = index.page_count
    assert n_index > 1
    assert result['tabs'][0]['page'] == 1 + n_index + 1
    with fitz.open(result['record']) as doc:
        assert doc.page_count == 1 + n_index + 40


def test_refuses_to_overwrite(tmp_path):
    manifest = _manifest(tmp_path)
    out = tmp_path / 'out'
    out.mkdir()
    (out / 'Record.pdf').write_bytes(b'')
    with pytest.raises(RecordError) as e:
        load_manifest(manifest)
    assert e.value.code == 'output_exists'


def test_missing_tab_file(tmp_path):
    manifest = _manifest(tmp_path)
    (tmp_path / 'tab1.pdf').unlink()
    with pytest.raises(RecordError) as e:
        load_manifest(manifest)
    assert e.value.code == 'missing_file'


def test_cli(tmp_path):
    proc = subprocess.run([sys.executable, str(SCRIPT), str(_manifest(tmp_path))], capture_output=True, text=True)
    assert proc.returncode == 0, proc.stdout + proc.stderr
    out = json.loads(proc.stdout)
    assert out['success'] is True and out['page_count'] == 8
