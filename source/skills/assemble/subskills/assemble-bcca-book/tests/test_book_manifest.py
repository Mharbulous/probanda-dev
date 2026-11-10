"""Tests for scripts/book_manifest.py: bcca-book.md plus ordered part PDFs -> a
manifest that scripts/paginate_book.py accepts."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import fitz
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'scripts'))

import paginate_book  # noqa: E402
from book_manifest import ManifestError, build_manifest  # noqa: E402

FIXTURE = Path(__file__).resolve().parents[4] / 'publish' / 'tests' / 'fixtures' / 'valid-bcca-book.md'


def _pdfs(tmp_path: Path, names: list[str]) -> list[str]:
    paths = []
    for name in names:
        doc = fitz.open()
        doc.new_page()
        path = tmp_path / name
        doc.save(path)
        doc.close()
        paths.append(str(path))
    return paths


def test_response_manifest_passes_the_paginator_grammar(tmp_path):
    parts = _pdfs(tmp_path, ['affidavit.pdf', 'argument.pdf', 'toa.pdf'])
    cover = _pdfs(tmp_path, ['cover.pdf'])[0]
    manifest = build_manifest(FIXTURE, 'response', Path(cover), tmp_path / 'book.pdf', parts)

    assert manifest['toc']['template'] == 'response'
    assert [p['bookmark'] for p in manifest['parts']] == [
        'Affidavit #1 of Jane Doe, filed 2026-08-01', 'Part 2: Written Argument', 'Part 3: Table of Authorities']
    assert [p['path'] for p in manifest['parts']] == parts
    assert [r['part'] for r in manifest['toc']['rows']] == [None, 0, None, 1, None, None, None, None, 2]

    path = tmp_path / 'manifest.json'
    path.write_text(json.dumps(manifest), encoding='utf-8')
    paginate_book.load_manifest(path)


def test_exhibits_attach_to_the_named_part(tmp_path):
    parts = _pdfs(tmp_path, ['affidavit.pdf', 'argument.pdf', 'toa.pdf'])
    exhibits = {'Affidavit #1 of Jane Doe, filed 2026-08-01': {'text': {'A': 'June 1, 2019 – Letter'}}}
    manifest = build_manifest(FIXTURE, 'response', Path(parts[0]), tmp_path / 'book.pdf', parts, exhibits)
    assert manifest['parts'][0]['exhibits'] == {'text': {'A': 'June 1, 2019 – Letter'}}
    assert 'exhibits' not in manifest['parts'][1]


def test_exhibits_for_an_unknown_part(tmp_path):
    parts = _pdfs(tmp_path, ['affidavit.pdf', 'argument.pdf', 'toa.pdf'])
    with pytest.raises(ManifestError) as e:
        build_manifest(FIXTURE, 'response', Path(parts[0]), tmp_path / 'book.pdf', parts,
                       {'Affidavit #9 of Nobody': {'pages': {'A': 2}}})
    assert e.value.code == 'unknown_exhibit_part'


def test_boa_manifest_one_part_per_authority(tmp_path):
    parts = _pdfs(tmp_path, ['jordan.pdf', 'rjr.pdf'])
    manifest = build_manifest(FIXTURE, 'boa', Path(parts[0]), tmp_path / 'boa.pdf', parts)
    assert manifest['toc']['rows'][1]['part'] == 1
    assert manifest['parts'][1]['bookmark'] == 'RJR-MacDonald Inc. v. Canada (Attorney General), [1994] 1 SCR 311'


def test_boa_binds_statute_regulation_and_doctrine_parts_whole(tmp_path):
    # #848: an enactment part is the whole enactment, a doctrine part the title and publication
    # pages plus the cited chapter. Both are the practitioner's PDFs, bound page for page.
    lines = FIXTURE.read_text(encoding='utf-8').splitlines()
    lines = [
        'boa_toc: [{"authority": "Limitation Act", "citation": "SBC 2012, c 13", "part": 0}, '
        '{"authority": "Limitation Regulation", "citation": "BC Reg 5/2013", "part": 1}, '
        '{"authority": "Smith, Company Law Manual", "citation": null, "part": 2}]' if l.startswith('boa_toc:') else
        'boa_parts: [{"bookmark": "Limitation Act, SBC 2012, c 13"}, {"bookmark": "Limitation Regulation, BC Reg 5/2013"}, '
        '{"bookmark": "Smith, Company Law Manual"}]' if l.startswith('boa_parts:') else l
        for l in lines]
    book_md = tmp_path / 'bcca-book.md'
    book_md.write_text('\n'.join(lines), encoding='utf-8')
    part_text = [['ACT-s1', 'ACT-s6', 'ACT-s30'], ['REG-s1', 'REG-s2'], ['TITLE', 'PUBLICATION', 'CH15-p1', 'CH15-p2']]
    parts = []
    for k, pages in enumerate(part_text):
        doc = fitz.open()
        for text in pages:
            doc.new_page().insert_text((72, 400), text)
        doc.save(tmp_path / f'part{k}.pdf')
        doc.close()
        parts.append(str(tmp_path / f'part{k}.pdf'))
    cover = _pdfs(tmp_path, ['cover.pdf'])[0]
    manifest = build_manifest(book_md, 'boa', Path(cover), tmp_path / 'boa.pdf', parts)

    def render(cells):
        path = tmp_path / 'toc.pdf'
        doc = fitz.open()
        doc.new_page()
        doc.save(path)
        doc.close()
        return path

    work = tmp_path / 'work'
    work.mkdir()
    paginate_book.paginate(Path(cover), render, manifest['toc']['rows'], manifest['parts'],
                           manifest['numbering_starts'], Path(manifest['output']), work)
    with fitz.open(manifest['output']) as out:
        body = [text for pages in part_text for text in pages]
        assert out.page_count == 2 + len(body)
        assert all(text in out[2 + i].get_text() for i, text in enumerate(body))
        assert [(title, page) for _, title, page in out.get_toc()][2:] == [
            ('Limitation Act, SBC 2012, c 13', 3), ('Limitation Regulation, BC Reg 5/2013', 6),
            ('Smith, Company Law Manual', 8)]


def test_part_count_mismatch(tmp_path):
    with pytest.raises(ManifestError) as e:
        build_manifest(FIXTURE, 'response', tmp_path / 'c.pdf', tmp_path / 'b.pdf', ['only-one.pdf'])
    assert e.value.code == 'part_count_mismatch'


def test_empty_boa_has_no_book(tmp_path):
    lines = FIXTURE.read_text(encoding='utf-8').splitlines()
    lines = ['boa_toc: []' if l.startswith('boa_toc:') else 'boa_parts: []' if l.startswith('boa_parts:') else l
             for l in lines]
    book_md = tmp_path / 'bcca-book.md'
    book_md.write_text('\n'.join(lines), encoding='utf-8')
    with pytest.raises(ManifestError) as e:
        build_manifest(book_md, 'boa', tmp_path / 'c.pdf', tmp_path / 'b.pdf', [])
    assert e.value.code == 'no_parts'


def test_invalid_book_md_relays_the_validator_code(tmp_path):
    book_md = tmp_path / 'bcca-book.md'
    book_md.write_text('not frontmatter', encoding='utf-8')
    with pytest.raises(ManifestError) as e:
        build_manifest(book_md, 'response', tmp_path / 'c.pdf', tmp_path / 'b.pdf', [])
    assert e.value.code == 'missing_frontmatter'
