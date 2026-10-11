"""paginate_book.py: numbering, Page Labels, bookmarks, TOC back-fill and the
volume split, on PyMuPDF-built fixtures. The TOC renderer is a stand-in that
draws each row's page cell as text, so no Word install is needed; the Word
path is exercised by a manual CLI run (see the ticket's resolution)."""
from __future__ import annotations

import json
import random
import subprocess
import sys
from pathlib import Path

import fitz
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'scripts'))

import paginate_book  # noqa: E402
from paginate_book import BookError, paginate  # noqa: E402

PART_PAGES = [3, 1, 2]
ROWS = [
    {'text': 'Cover Page', 'indent': 0, 'part': 'cover'},
    {'text': 'Table of Contents', 'indent': 0, 'part': 'toc'},
    {'text': 'Part 1: Evidence', 'indent': 0, 'part': None},
    {'text': 'Affidavit #1 of Jane Doe', 'indent': 1, 'part': 0},
    {'text': 'Affidavit #2 of John Roe', 'indent': 1, 'part': 1},
    {'text': 'Exhibit A', 'indent': 2, 'part': 2},
]


def _pdf(path: Path, lines: list[str], rotation: int = 0, noise: int = 0) -> Path:
    doc = fitz.open()
    for text in lines:
        page = doc.new_page(width=612, height=792)
        page.insert_text((72, 400), text, fontsize=14)
        if noise:
            rng = random.Random(text)
            samples = bytearray(rng.getrandbits(8) for _ in range(noise * noise * 3))
            pix = fitz.Pixmap(fitz.csRGB, noise, noise, bytes(samples), False)
            page.insert_image(fitz.Rect(72, 450, 272, 650), pixmap=pix)
        page.set_rotation(rotation)
    doc.save(path)
    return path


def _parts(tmp_path: Path, noise: int = 0) -> list[dict]:
    parts = []
    for k, n in enumerate(PART_PAGES):
        path = _pdf(tmp_path / f'part{k}.pdf', [f'PART{k}-P{j}' for j in range(n)],
                    rotation=90 if k == 1 else 0, noise=noise)
        parts.append({'path': str(path), 'bookmark': f'Tab {k + 1}'})
    return parts


def _renderer(tmp_path: Path, pages_when_blank: int = 2, pages_when_filled: int = 2):
    """Draws row i as 'ROW<i>=<cell>'. Page count can differ between a blank
    and a filled render, to exercise the reflow recompute."""
    calls = []

    def render(cells: list[str]) -> Path:
        calls.append(list(cells))
        n = pages_when_blank if all(c == '' for c in cells) else pages_when_filled
        doc = fitz.open()
        for p in range(n):
            page = doc.new_page(width=612, height=792)
            if p == 0:
                for i, cell in enumerate(cells):
                    page.insert_text((72, 100 + 20 * i), f'ROW{i}={cell}', fontsize=11)
        path = tmp_path / f'toc-{len(calls)}.pdf'
        doc.save(path)
        return path

    render.calls = calls
    return render


def _stamp_text(page: fitz.Page, top: float = 45.0) -> str:
    """Text whose visual position is in the top band and centred."""
    found = []
    for w in page.get_text('words'):
        r = fitz.Rect(w[:4]) * page.rotation_matrix
        if r.y1 <= top and abs((r.x0 + r.x1) / 2 - page.rect.width / 2) < 20:
            found.append(w[4])
    return ' '.join(found)


def _toc_cells(doc: fitz.Document) -> list[str]:
    cells = {}
    for page in doc:
        for line in page.get_text().splitlines():
            if line.startswith('ROW') and '=' in line:
                idx, _, cell = line[3:].partition('=')
                cells[int(idx)] = cell
    return [cells[i] for i in range(len(ROWS))]


def _first_page_of_part(doc: fitz.Document, k: int) -> int | None:
    for page in doc:
        if f'PART{k}-P0' in page.get_text():
            return page.number
    return None


@pytest.fixture
def book(tmp_path):
    cover = _pdf(tmp_path / 'cover.pdf', ['COVER'])
    work = tmp_path / 'work'
    work.mkdir()
    return {'cover': cover, 'parts': _parts(tmp_path), 'work': work, 'tmp': tmp_path}


def _run(book, numbering_starts, render=None, **kw):
    out = book['tmp'] / 'out' / 'Book.pdf'
    return paginate(book['cover'], render or _renderer(book['tmp']), ROWS, book['parts'],
                    numbering_starts, out, book['work'], **kw), out


def test_numbering_from_cover(book):
    volumes, out = _run(book, 'cover')
    assert len(volumes) == 1
    doc = fitz.open(out)
    assert doc.page_count == 1 + 2 + sum(PART_PAGES)
    for page in doc:
        assert _stamp_text(page) == str(page.number + 1)
        assert page.get_label() == str(page.number + 1)
    bookmarks = doc.get_toc()
    assert bookmarks[:2] == [[1, 'Cover Page', 1], [1, 'Table of Contents', 2]]
    assert bookmarks[2:] == [[1, 'Tab 1', 4], [1, 'Tab 2', 7], [1, 'Tab 3', 8]]
    assert _toc_cells(doc) == ['1', '2', '', '4', '7', '8']
    for row, cell in zip(ROWS, _toc_cells(doc)):
        if isinstance(row['part'], int):
            assert _stamp_text(doc[_first_page_of_part(doc, row['part'])]) == cell


def test_numbering_after_toc(book):
    volumes, out = _run(book, 'after_toc')
    doc = fitz.open(out)
    for page in doc[:3]:
        assert _stamp_text(page) == ''
    assert [doc[i].get_label() for i in range(3)] == ['i', 'ii', 'iii']
    for page in doc[3:]:
        assert _stamp_text(page) == str(page.number - 2)
        assert page.get_label() == _stamp_text(page)
    assert doc.get_toc()[:2] == [[1, 'Cover Page', 1], [1, 'Table of Contents', 2]]
    cells = _toc_cells(doc)
    assert cells == ['', '', '', '1', '4', '5']
    for row, cell in zip(ROWS, cells):
        if isinstance(row['part'], int):
            assert _stamp_text(doc[_first_page_of_part(doc, row['part'])]) == cell


def test_rotated_part_stamped_at_visual_top(book):
    _, out = _run(book, 'cover')
    doc = fitz.open(out)
    rotated = doc[_first_page_of_part(doc, 1)]
    assert rotated.rotation == 90
    assert _stamp_text(rotated) == '7'


def test_toc_reflow_recomputes_numbers(book):
    render = _renderer(book['tmp'], pages_when_blank=1, pages_when_filled=2)
    _, out = _run(book, 'cover', render=render)
    doc = fitz.open(out)
    assert doc.get_toc()[2][2] == 4
    assert _toc_cells(doc) == ['1', '2', '', '4', '7', '8']
    assert len(render.calls) == 3


def test_toc_that_keeps_reflowing_is_a_hard_error(book):
    counts = iter([1, 2, 3, 4])

    def render(cells):
        doc = fitz.open()
        for _ in range(next(counts)):
            doc.new_page()
        path = book['tmp'] / f'unstable-{len(doc)}.pdf'
        doc.save(path)
        return path

    with pytest.raises(BookError) as e:
        _run(book, 'cover', render=render)
    assert e.value.code == 'toc_page_count_unstable'


def test_existing_output_is_not_overwritten(book):
    out = book['tmp'] / 'out' / 'Book.pdf'
    out.parent.mkdir()
    out.write_bytes(b'keep me')
    with pytest.raises(BookError) as e:
        _run(book, 'cover')
    assert e.value.code == 'output_exists'
    assert out.read_bytes() == b'keep me'


@pytest.fixture
def heavy_book(tmp_path):
    cover = _pdf(tmp_path / 'cover.pdf', ['COVER'])
    work = tmp_path / 'work'
    work.mkdir()
    parts = _parts(tmp_path, noise=120)
    sizes = [Path(p['path']).stat().st_size for p in parts]
    # Too small for the whole book, big enough for the largest part plus front matter.
    max_bytes = max(sizes) + max(sizes) // 2 + 20_000
    assert sum(sizes) > max_bytes
    return {'cover': cover, 'parts': parts, 'work': work, 'tmp': tmp_path, 'max_bytes': max_bytes}


def test_split_requires_the_repeated_front_matter_setting(heavy_book):
    with pytest.raises(BookError) as e:
        _run(heavy_book, 'cover', max_bytes=heavy_book['max_bytes'])
    assert e.value.code == 'split_setting_required'


@pytest.mark.parametrize('numbering_starts,repeated', [
    ('cover', False), ('cover', True), ('after_toc', False), ('after_toc', True)])
def test_split_into_volumes_with_continuous_numbering(heavy_book, numbering_starts, repeated):
    volumes, out = _run(heavy_book, numbering_starts, max_bytes=heavy_book['max_bytes'],
                        number_repeated_front_matter=repeated)
    assert len(volumes) >= 2
    assert not out.exists()

    body_numbers = []
    first_pages = {}
    for v, vol in enumerate(volumes):
        path = Path(vol['path'])
        assert path.name == f'Book (Volume {v + 1} of {len(volumes)}).pdf'
        assert path.stat().st_size <= heavy_book['max_bytes']
        doc = fitz.open(path)
        assert f'Volume {v + 1} of {len(volumes)}' in doc[0].get_text()
        bookmarks = doc.get_toc()
        assert bookmarks[:2] == [[1, 'Cover Page', 1], [1, 'Table of Contents', 2]]
        assert _toc_cells(doc) == _toc_cells(fitz.open(volumes[0]['path']))
        front_numbered = (numbering_starts == 'cover') if v == 0 else repeated
        for page in doc:
            stamp = _stamp_text(page).replace(f'Volume {v + 1} of {len(volumes)}', '').strip()
            if page.number < 3:
                assert bool(stamp) == front_numbered
            if stamp:
                assert page.get_label() == stamp
                body_numbers.append(int(stamp))
            else:
                assert page.get_label() in ('i', 'ii', 'iii')
        for k in range(len(PART_PAGES)):
            idx = _first_page_of_part(doc, k)
            if idx is not None:
                first_pages[k] = _stamp_text(doc[idx])
                assert [1, f'Tab {k + 1}', idx + 1] in bookmarks

    assert body_numbers == list(range(body_numbers[0], body_numbers[0] + len(body_numbers)))
    assert body_numbers[0] == 1
    cells = _toc_cells(fitz.open(volumes[0]['path']))
    for row, cell in zip(ROWS, cells):
        if isinstance(row['part'], int):
            assert first_pages[row['part']] == cell


def test_part_too_big_for_any_volume(heavy_book):
    with pytest.raises(BookError) as e:
        _run(heavy_book, 'cover', max_bytes=30_000, number_repeated_front_matter=False)
    assert e.value.code == 'part_over_limit'


def test_manifest_rejects_bad_part_reference(book, tmp_path):
    manifest = tmp_path / 'manifest.json'
    rows = [dict(ROWS[0]), {'text': 'Tab 9', 'indent': 1, 'part': 9}]
    manifest.write_text(json.dumps({
        'cover': str(book['cover']), 'parts': book['parts'],
        'toc': {'template': 'response', 'rows': rows},
        'numbering_starts': 'cover', 'output': str(tmp_path / 'x.pdf')}), encoding='utf-8')
    with pytest.raises(BookError) as e:
        paginate_book.load_manifest(manifest)
    assert e.value.code == 'bad_part_ref'


def test_manifest_reuses_fill_book_row_validation(book, tmp_path):
    manifest = tmp_path / 'manifest.json'
    manifest.write_text(json.dumps({
        'cover': str(book['cover']), 'parts': book['parts'],
        'toc': {'template': 'response', 'rows': [{'text': 'x', 'indent': 5, 'part': None}]},
        'numbering_starts': 'cover', 'output': str(tmp_path / 'x.pdf')}), encoding='utf-8')
    with pytest.raises(BookError) as e:
        paginate_book.load_manifest(manifest)
    assert e.value.code == 'bad_indent'


def _stamp_page(label: str, quote: str = '"') -> str:
    return f'This is Exhibit {quote}{label}{quote} referred to in the affidavit of Jane Doe'


def _affidavit(tmp_path: Path, pages: list[str], exhibits: dict | None = None, scanned: set[int] = frozenset()) -> dict:
    doc = fitz.open()
    for i, text in enumerate(pages):
        page = doc.new_page(width=612, height=792)
        if i not in scanned:
            page.insert_text((72, 400), text, fontsize=14)
    path = tmp_path / 'affidavit.pdf'
    doc.save(path)
    part = {'path': str(path), 'bookmark': 'Affidavit #1 of Jane Doe, filed 2026-08-01'}
    if exhibits is not None:
        part['exhibits'] = exhibits
    return part


def _affidavit_book(book, part):
    rows = ROWS[:3] + [{'text': part['bookmark'], 'indent': 1, 'part': 0}]
    out = book['tmp'] / 'out' / 'Book.pdf'
    paginate(book['cover'], _renderer(book['tmp']), rows, [part], 'cover', out, book['work'])
    return fitz.open(out)


AFFIDAVIT_PAGES = ['PART0-P0 body', 'body', _stamp_page('A'), 'letter', _stamp_page('B', '“'), 'email', 'email']


def test_exhibit_bookmarks_nest_under_their_affidavit(book):
    part = _affidavit(book['tmp'], AFFIDAVIT_PAGES,
                      {'text': {'A': 'June 1, 2019 – Letter from John to Jane Doe'}})
    doc = _affidavit_book(book, part)
    # Cover 1, TOC 2-3, affidavit starts on page 4: stamps at part pages 3 and 5.
    assert doc.get_toc()[2:] == [
        [1, 'Affidavit #1 of Jane Doe, filed 2026-08-01', 4],
        [2, 'Exhibit A – June 1, 2019 – Letter from John to Jane Doe', 6],
        [2, 'Exhibit B', 8],
    ]
    assert 'This is Exhibit "A"' in doc[5].get_text()


def test_supplied_pages_replace_detection(book):
    part = _affidavit(book['tmp'], ['PART0-P0', 'x', 'y', 'z'], {'pages': {'A': 2, 'B': 4}}, scanned={1, 2, 3})
    doc = _affidavit_book(book, part)
    assert doc.get_toc()[3:] == [[2, 'Exhibit A', 5], [2, 'Exhibit B', 7]]


@pytest.mark.parametrize('pages,exhibits,scanned,code', [
    (['body', _stamp_page('A'), 'Exhibit A is itself an affidavit', _stamp_page('A')], None, set(), 'exhibit_stamp_repeated'),
    (['body', 'scan'], None, {1}, 'no_text_layer'),
    (['body', _stamp_page('A')], {'text': {'B': 'Letter'}}, set(), 'exhibit_text_unmatched'),
    (['body', 'x'], {'pages': {'A': 3}}, set(), 'bad_exhibit_page'),
])
def test_exhibit_errors(book, pages, exhibits, scanned, code):
    part = _affidavit(book['tmp'], pages, exhibits, scanned)
    with pytest.raises(BookError) as e:
        _affidavit_book(book, part)
    assert e.value.code == code


def test_manifest_rejects_exhibits_on_a_non_affidavit_part(book, tmp_path):
    parts = [dict(book['parts'][0], exhibits={'pages': {'A': 1}})] + book['parts'][1:]
    manifest = tmp_path / 'manifest.json'
    manifest.write_text(json.dumps({
        'cover': str(book['cover']), 'parts': parts,
        'toc': {'template': 'response', 'rows': ROWS},
        'numbering_starts': 'cover', 'output': str(tmp_path / 'x.pdf')}), encoding='utf-8')
    with pytest.raises(BookError) as e:
        paginate_book.load_manifest(manifest)
    assert e.value.code == 'bad_manifest'


def _docx_and_target(tmp_path: Path) -> tuple[Path, Path]:
    """A .docx and a PDF target whose names differ, as run() does for the cover."""
    docx = tmp_path / 'toc-1.docx'
    docx.write_bytes(b'stand-in docx')
    return docx, tmp_path / 'out' / 'cover.pdf'


def test_soffice_fallback_when_word_unavailable(tmp_path, monkeypatch):
    docx, pdf = _docx_and_target(tmp_path)
    calls = []

    def fake_run(cmd, **kwargs):
        calls.append(cmd[0])
        if cmd[0] == 'powershell':
            return subprocess.CompletedProcess(cmd, 1, '', 'Word.Application not registered')
        out_dir = Path(cmd[cmd.index('--outdir') + 1])
        (out_dir / f'{docx.stem}.pdf').write_bytes(b'%PDF-1.4 stand-in\n%%EOF\n')
        return subprocess.CompletedProcess(cmd, 0, '', '')

    monkeypatch.setattr(paginate_book.subprocess, 'run', fake_run)
    assert paginate_book.convert_docx_to_pdf(docx, pdf) == pdf
    assert pdf.is_file()
    assert calls == ['powershell', 'soffice']


def test_docx_conversion_hard_failure_names_both_tools(tmp_path, monkeypatch):
    docx, pdf = _docx_and_target(tmp_path)

    def fake_run(cmd, **kwargs):
        return subprocess.CompletedProcess(cmd, 1, '', f'{cmd[0]}: not available')

    monkeypatch.setattr(paginate_book.subprocess, 'run', fake_run)
    with pytest.raises(BookError) as e:
        paginate_book.convert_docx_to_pdf(docx, pdf)
    assert e.value.code == 'docx_conversion_failed'
    assert 'word_com' in e.value.detail
    assert 'soffice' in e.value.detail
    assert not pdf.exists()


if __name__ == '__main__':
    raise SystemExit(pytest.main([__file__, '-q']))
