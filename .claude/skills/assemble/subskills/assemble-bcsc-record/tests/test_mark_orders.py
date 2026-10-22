"""mark_orders.py: the Rule 8-1 (15.1) copy highlights Part 1 and nothing else."""
from __future__ import annotations

import sys
from pathlib import Path

import pymupdf as fitz
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'scripts'))

from mark_orders import MarkError, mark  # noqa: E402


def _notice(path: Path, pages: list[list[str]]) -> Path:
    doc = fitz.open()
    for lines in pages:
        page = doc.new_page(width=612, height=792)
        for k, text in enumerate(lines):
            page.insert_text((72, 100 + 20 * k), text, fontsize=11)
    doc.save(path)
    return path


def _highlighted(path: Path) -> list[tuple[int, str]]:
    out = []
    with fitz.open(path) as doc:
        for page in doc:
            for annot in page.annots():
                assert annot.type[1] == 'Highlight'
                out.append((page.number + 1, page.get_textbox(annot.rect).strip()))
    return out


def test_highlights_part_1_across_a_page_break(tmp_path):
    src = _notice(tmp_path / 'notice.pdf', [
        ['NOTICE OF APPLICATION', 'PART 1: ORDER(S) SOUGHT', '1. An order that the defendant produce documents.'],
        ['2. Costs.', 'PART 2: FACTUAL BASIS', '1. The plaintiff sued.'],
    ])
    result = mark(src, tmp_path / 'marked.pdf')
    assert result['lines_marked'] == 2 and result['pages'] == [1, 2]
    assert _highlighted(tmp_path / 'marked.pdf') == [
        (1, '1. An order that the defendant produce documents.'), (2, '2. Costs.')]


@pytest.mark.parametrize('pages', [
    [['NOTICE', '1. Costs.', 'PART 2: FACTUAL BASIS']],
    [['PART 1: ORDER(S) SOUGHT', '1. Costs.']],
    [['PART 1: ORDER(S) SOUGHT', 'PART 1: ORDER(S) SOUGHT', 'PART 2: FACTUAL BASIS']],
    [['PART 1: ORDER(S) SOUGHT', 'PART 2: FACTUAL BASIS']],
])
def test_heading_not_found(tmp_path, pages):
    with pytest.raises(MarkError) as e:
        mark(_notice(tmp_path / 'notice.pdf', pages), tmp_path / 'marked.pdf')
    assert e.value.code == 'heading_not_found'
    assert not (tmp_path / 'marked.pdf').exists()


def test_no_text_layer(tmp_path):
    doc = fitz.open()
    doc.new_page()
    doc.save(tmp_path / 'scan.pdf')
    with pytest.raises(MarkError) as e:
        mark(tmp_path / 'scan.pdf', tmp_path / 'marked.pdf')
    assert e.value.code == 'no_text_layer'


def test_refuses_to_overwrite(tmp_path):
    src = _notice(tmp_path / 'notice.pdf', [['PART 1: ORDER(S) SOUGHT', '1. Costs.', 'PART 2: FACTUAL BASIS']])
    (tmp_path / 'marked.pdf').write_bytes(b'')
    with pytest.raises(MarkError) as e:
        mark(src, tmp_path / 'marked.pdf')
    assert e.value.code == 'output_exists'
