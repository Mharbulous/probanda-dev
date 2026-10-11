"""Fill smoke test: run the full pipeline against a valid fixture and confirm
four well-formed .docx files come out with the expected text substituted in.

Uses the unzip+strip-tags text-extraction technique (same one used to read
the exemplar and court-template documents while building this skill) to
assert on content, not byte-exact matching against the exemplar -- the
exemplar is a different matter's filed data.
"""
from __future__ import annotations

import json
import re
import sys
import zipfile
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'scripts'))

from fill_book import OUTPUT_NAMES, parse_bcca_book  # noqa: E402
import fill_book  # noqa: E402

FIXTURES = Path(__file__).resolve().parent / 'fixtures'
VALID_PATH = FIXTURES / 'valid-bcca-book.md'

RESPONSE_BOOK_KEYS = ('response_book_record_label', 'response_book_title',
                      'response_book_toc', 'response_book_parts')


def _without_response_book(base: str) -> str:
    keep = [l for l in base.splitlines()
            if not any(l.startswith(f'{k}:') for k in RESPONSE_BOOK_KEYS)]
    return '\n'.join(keep) + '\n'


def _extract_text(docx_path: Path) -> str:
    with zipfile.ZipFile(docx_path) as z:
        xml = z.read('word/document.xml').decode('utf-8')
    xml = re.sub(r'<w:p[ >]', '\n\\g<0>', xml)
    xml = re.sub(r'<[^>]*>', '', xml)
    return '\n'.join(line for line in xml.splitlines() if line.strip())


@pytest.fixture
def output_dir(tmp_path):
    return tmp_path / 'out'


def test_fill_produces_four_well_formed_docx(output_dir):
    data = parse_bcca_book(VALID_PATH.read_text(encoding='utf-8'))

    fill_book.build_cover(data, 'response_book', output_dir / OUTPUT_NAMES['response_book_cover'])
    fill_book.build_response_toc(data['response_book_toc'], output_dir / OUTPUT_NAMES['response_book_toc'])
    fill_book.build_cover(data, 'boa', output_dir / OUTPUT_NAMES['boa_cover'])
    fill_book.build_boa_toc(data['boa_toc'], output_dir / OUTPUT_NAMES['boa_toc'])

    for name in OUTPUT_NAMES.values():
        path = output_dir / name
        assert path.exists(), f'{name} was not written'
        with zipfile.ZipFile(path) as z:
            assert z.testzip() is None, f'{name} is not a well-formed zip'
            assert 'word/document.xml' in z.namelist()

    cover_text = _extract_text(output_dir / OUTPUT_NAMES['response_book_cover'])
    assert 'CA52140' in cover_text
    assert data['short_style'] in cover_text
    assert "Response Book" in cover_text
    assert "Respondents' Response Book" in cover_text
    assert 'the 29th day of June, 2026' in cover_text
    # BETWEEN/AND block: uppercased, joined "and" not comma -- matches the court
    # template's own convention (tpl_ca_book_cover_page.dotx) and the mockup
    # renderer's formatNameList, confirmed against the practitioner's exemplar.
    assert 'TIDEWATER OUTFITTERS INC. AND KESTREL COLLECTIVE INC.' in cover_text
    assert '(Plaintiffs)' in cover_text
    assert '(Defendants)' in cover_text
    assert 'Counsel for the Appellants' in cover_text
    assert 'Counsel for the Respondents' in cover_text
    # No leftover bracket placeholders anywhere in the filled cover.
    assert '[' not in cover_text and ']' not in cover_text

    boa_cover_text = _extract_text(output_dir / OUTPUT_NAMES['boa_cover'])
    assert "Respondents' Book of Authorities" in boa_cover_text
    assert 'Book of Authorities' in boa_cover_text

    response_toc_text = _extract_text(output_dir / OUTPUT_NAMES['response_book_toc'])
    assert 'Part 1: Evidence, Exhibits or Affidavits' in response_toc_text
    assert 'Affidavit #1 of Jane Doe, filed 2026-08-01' in response_toc_text
    assert 'Part 3: Table of Authorities' in response_toc_text
    assert '[' not in response_toc_text

    boa_toc_text = _extract_text(output_dir / OUTPUT_NAMES['boa_toc'])
    assert 'R. v. Jordan, 2016 SCC 27' in boa_toc_text
    assert 'AUTHORITY TEXT' not in boa_toc_text


def test_response_less_file_fills_exactly_two_documents(tmp_path, output_dir, capsys):
    """A bcca_factum book has no Response Book half, so the fill writes the two BOA
    documents and prints one JSON line for each (bcca-book-contract.md "Scope")."""
    book_md = tmp_path / 'bcca-book.md'
    book_md.write_text(_without_response_book(VALID_PATH.read_text(encoding='utf-8')), encoding='utf-8')

    assert fill_book._fill(book_md, output_dir) == 0

    assert sorted(p.name for p in output_dir.iterdir()) == sorted(
        [OUTPUT_NAMES['boa_cover'], OUTPUT_NAMES['boa_toc']])
    printed = [json.loads(line) for line in capsys.readouterr().out.splitlines()]
    assert [entry['document'] for entry in printed] == ['boa_cover', 'boa_toc']
    assert all(entry['success'] for entry in printed)

    boa_cover_text = _extract_text(output_dir / OUTPUT_NAMES['boa_cover'])
    assert "Respondents' Book of Authorities" in boa_cover_text
    assert '[' not in boa_cover_text and ']' not in boa_cover_text


def test_partial_response_book_group_is_rejected_as_json(tmp_path, output_dir, capsys):
    text = VALID_PATH.read_text(encoding='utf-8')
    keep = [l for l in text.splitlines() if not l.startswith('response_book_parts:')]
    book_md = tmp_path / 'bcca-book.md'
    book_md.write_text('\n'.join(keep) + '\n', encoding='utf-8')

    assert fill_book._fill(book_md, output_dir) == 1
    envelope = json.loads(capsys.readouterr().out.strip())
    assert envelope['success'] is False
    assert envelope['error'] == 'partial_response_book'
    assert 'response_book_parts' in envelope['detail']


def test_boa_toc_renders_header_only_when_empty(output_dir):
    data = parse_bcca_book(VALID_PATH.read_text(encoding='utf-8'))
    out_path = output_dir / OUTPUT_NAMES['boa_toc']
    fill_book.build_boa_toc([], out_path)
    text = _extract_text(out_path)
    assert 'TABLE OF CONTENTS' in text
    assert 'Authority' in text
    assert '[' not in text


def test_toc_page_cells_filled_when_pages_given(output_dir):
    data = parse_bcca_book(VALID_PATH.read_text(encoding='utf-8'))
    rows = data['response_book_toc']
    pages = [str(100 + i) for i in range(len(rows))]
    out_path = output_dir / OUTPUT_NAMES['response_book_toc']
    fill_book.build_response_toc(rows, out_path, pages=pages)
    text = _extract_text(out_path)
    for row, page in zip(rows, pages):
        assert f"{row['text']}\n{page}" in text

    boa_rows = data['boa_toc']
    boa_path = output_dir / OUTPUT_NAMES['boa_toc']
    fill_book.build_boa_toc(boa_rows, boa_path, pages=['7'] * len(boa_rows))
    assert _extract_text(boa_path).count('\n7') == len(boa_rows)


def test_on_appeal_from_omitted_when_any_part_missing(output_dir):
    data = parse_bcca_book(VALID_PATH.read_text(encoding='utf-8'))
    del data['under_appeal_court']
    out_path = output_dir / OUTPUT_NAMES['response_book_cover']
    fill_book.build_cover(data, 'response_book', out_path)
    text = _extract_text(out_path)
    assert 'ON APPEAL FROM' not in text


def test_cover_is_a_single_section(output_dir):
    # A second section after the cover renders as a blank second page in Word (#653).
    data = parse_bcca_book(VALID_PATH.read_text(encoding='utf-8'))
    for kind in ('response_book', 'boa'):
        out_path = output_dir / OUTPUT_NAMES[f'{kind}_cover']
        fill_book.build_cover(data, kind, out_path)
        with zipfile.ZipFile(out_path) as z:
            xml = z.read('word/document.xml').decode('utf-8')
        assert xml.count('<w:sectPr') == 1, kind
        assert re.search(r'</w:sectPr>\s*</w:body>', xml), kind


if __name__ == '__main__':
    raise SystemExit(pytest.main([__file__, '-q']))
