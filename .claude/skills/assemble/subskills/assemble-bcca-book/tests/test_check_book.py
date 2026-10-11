"""check_book.py: the written-argument page cap and sequential numbering across
every page of the emitted book, on PyMuPDF-built fixtures. The numbered fixtures
are stamped by paginate_book's own `_stamp`, so a pass here means the checker
reads what this pipeline writes."""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import fitz
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'scripts'))

import paginate_book  # noqa: E402
from check_book import (  # noqa: E402
    STAY_ONLY_ARGUMENT_CAP, CheckError, check_argument_pages, check_sequential_numbering, run)

SCRIPT = Path(__file__).resolve().parent.parent / 'scripts' / 'check_book.py'


def _book(path: Path, numbers: list[str | None], rotation: int = 0, blank_pages: tuple[int, ...] = ()) -> Path:
    """One page per entry, carrying that entry as its top-centre stamp (None =
    unstamped). A page in blank_pages gets no text at all."""
    doc = fitz.open()
    for i, number in enumerate(numbers):
        page = doc.new_page(width=612, height=792)
        page.set_rotation(rotation)
        if i not in blank_pages:
            page.insert_text((72, 400), f'body text of page {i + 1}', fontsize=11)
        if number is not None:
            paginate_book._stamp(page, number, paginate_book.PAGE_NUMBER_BASELINE)
    doc.save(path)
    doc.close()
    return path


def _argument(path: Path, pages: int) -> Path:
    return _book(path, [None] * pages)


# --------------------------------------------------------------------------
# Check A -- written-argument page cap
# --------------------------------------------------------------------------

def test_argument_over_the_cap_is_flagged_and_names_the_cap(tmp_path):
    result = check_argument_pages(_argument(tmp_path / 'argument.pdf', 13), STAY_ONLY_ARGUMENT_CAP)

    assert result['passed'] is False
    assert result['pages'] == 13
    assert result['cap'] == 5
    assert '13 page(s) against a cap of 5' in result['detail']


def test_argument_at_the_cap_passes(tmp_path):
    result = check_argument_pages(_argument(tmp_path / 'argument.pdf', 5), STAY_ONLY_ARGUMENT_CAP)

    assert result['passed'] is True
    assert result['pages'] == 5


def test_the_combined_leave_and_stay_cap_is_the_callers_to_give(tmp_path):
    argument = _argument(tmp_path / 'argument.pdf', 9)

    assert check_argument_pages(argument, 5)['passed'] is False
    assert check_argument_pages(argument, 10)['passed'] is True


def test_a_cap_breach_names_the_cover_page_inference(tmp_path):
    result = check_argument_pages(_argument(tmp_path / 'argument.pdf', 6), STAY_ONLY_ARGUMENT_CAP)

    assert 'cover page sits outside the count' in result['detail']


# --------------------------------------------------------------------------
# Check B -- sequential numbering across every page
# --------------------------------------------------------------------------

def test_a_fully_numbered_book_passes(tmp_path):
    book = _book(tmp_path / 'book.pdf', [str(n) for n in range(1, 8)])

    result = check_sequential_numbering(book)

    assert result['passed'] is True
    assert result['page_count'] == 7
    assert result['unnumbered_pages'] == []


def test_a_gap_in_the_numbering_names_the_pages(tmp_path):
    numbers: list[str | None] = [str(n) for n in range(1, 8)]
    numbers[2] = None
    numbers[5] = None

    result = check_sequential_numbering(_book(tmp_path / 'book.pdf', numbers))

    assert result['passed'] is False
    assert result['unnumbered_pages'] == [3, 6]
    assert '2 of 7 page(s)' in result['detail']


def test_numbering_that_restarts_is_flagged_from_the_restart(tmp_path):
    # front matter numbered 1-2, then the parts restarting at 1
    result = check_sequential_numbering(_book(tmp_path / 'book.pdf', ['1', '2', '1', '2', '3']))

    assert result['passed'] is False
    assert result['unnumbered_pages'] == [3, 4, 5]


def test_an_unnumbered_book_flags_every_page(tmp_path):
    result = check_sequential_numbering(_book(tmp_path / 'book.pdf', [None] * 4))

    assert result['passed'] is False
    assert result['unnumbered_pages'] == [1, 2, 3, 4]


@pytest.mark.parametrize('rotation', [0, 90, 180, 270])
def test_a_rotated_page_is_read_at_its_visual_top(tmp_path, rotation):
    result = check_sequential_numbering(_book(tmp_path / 'book.pdf', ['1', '2', '3'], rotation=rotation))

    assert result['passed'] is True


def test_a_number_inside_a_longer_token_is_not_a_page_number(tmp_path):
    """Page 2026 would pass if the check matched substrings; a citation year
    sitting in a running header must not."""
    doc = fitz.open()
    for i in range(3):
        page = doc.new_page(width=612, height=792)
        page.insert_text((72, 30), '2026 BCCA 123', fontsize=11)
        page.insert_text((72, 400), 'body', fontsize=11)
    path = tmp_path / 'book.pdf'
    doc.save(path)
    doc.close()

    result = check_sequential_numbering(path)

    assert result['passed'] is False
    assert result['unnumbered_pages'] == [1, 2, 3]


def test_a_page_with_no_text_layer_refuses_rather_than_passing(tmp_path):
    book = _book(tmp_path / 'book.pdf', ['1', None, '3'], blank_pages=(1,))

    with pytest.raises(CheckError) as excinfo:
        check_sequential_numbering(book)

    assert excinfo.value.code == 'no_text_layer'
    assert 'page 2' in excinfo.value.detail


# --------------------------------------------------------------------------
# Arguments and CLI
# --------------------------------------------------------------------------

def test_nothing_to_check_is_a_refusal():
    with pytest.raises(CheckError) as excinfo:
        run(None, None, STAY_ONLY_ARGUMENT_CAP)

    assert excinfo.value.code == 'bad_arguments'


def test_a_missing_file_is_a_refusal(tmp_path):
    with pytest.raises(CheckError) as excinfo:
        run(tmp_path / 'absent.pdf', None, STAY_ONLY_ARGUMENT_CAP)

    assert excinfo.value.code == 'missing_file'


def test_a_non_pdf_is_a_refusal(tmp_path):
    docx = tmp_path / 'argument.docx'
    docx.write_bytes(b'not a pdf')

    with pytest.raises(CheckError) as excinfo:
        run(docx, None, STAY_ONLY_ARGUMENT_CAP)

    assert excinfo.value.code == 'bad_arguments'


def test_both_checks_run_in_one_call(tmp_path):
    checks = run(_argument(tmp_path / 'argument.pdf', 4),
                 _book(tmp_path / 'book.pdf', ['1', '2']), STAY_ONLY_ARGUMENT_CAP)

    assert [c['check'] for c in checks] == ['argument_page_cap', 'sequential_numbering']


def _cli(*args: str) -> tuple[int, dict]:
    proc = subprocess.run([sys.executable, str(SCRIPT), *args], capture_output=True, text=True)
    return proc.returncode, json.loads(proc.stdout)


def test_cli_exits_zero_only_when_every_check_passes(tmp_path):
    compliant = _book(tmp_path / 'good.pdf', ['1', '2', '3'])
    defective = _book(tmp_path / 'bad.pdf', ['1', None, '3'])

    code, payload = _cli('--book', str(compliant))
    assert code == 0
    assert payload == {'success': True, 'all_passed': True, 'checks': payload['checks']}

    code, payload = _cli('--book', str(defective))
    assert code == 1
    assert payload['all_passed'] is False


def test_cli_refusal_is_a_json_envelope_not_a_traceback(tmp_path):
    code, payload = _cli('--book', str(tmp_path / 'absent.pdf'))

    assert code == 1
    assert payload['success'] is False
    assert payload['error'] == 'missing_file'
