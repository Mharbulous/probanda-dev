"""Grammar/format round-trip tests for scripts/fill_book.py's parse_bcca_book.

A valid fixture must pass; each error code in references/bcca-book-contract.md
(and its fill_book.py extensions -- bad_party_group, bad_contact,
bad_access_restrictions, all narrower instances of the same "the validator
owns format" rule) must be reachable with a deliberately broken fixture.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'scripts'))

from fill_book import ValidationError, parse_bcca_book  # noqa: E402

FIXTURES = Path(__file__).resolve().parent / 'fixtures'
VALID_TEXT = (FIXTURES / 'valid-bcca-book.md').read_text(encoding='utf-8')

RESPONSE_BOOK_KEYS = ('response_book_record_label', 'response_book_title',
                      'response_book_toc', 'response_book_parts')


def drop_keys(base: str, keys) -> str:
    """The fixture with the named frontmatter keys removed."""
    keep = [l for l in base.splitlines()
            if not any(l.startswith(f'{k}:') for k in keys)]
    return '\n'.join(keep) + '\n'


def test_valid_fixture_passes():
    data = parse_bcca_book(VALID_TEXT)
    assert data['file_number'] == 'CA52140'
    assert len(data['party_groups']) == 2
    assert len(data['contacts']) == 2
    assert len(data['response_book_toc']) == 9
    assert len(data['boa_toc']) == 2


def _replace_frontmatter_block(base: str, **overrides: str) -> str:
    """Rebuild the fixture's frontmatter, overriding or adding given keys."""
    lines = base.splitlines()
    close_idx = next(i for i in range(1, len(lines)) if lines[i].strip() == '---')
    fm_lines = lines[1:close_idx]
    kv = {}
    order = []
    for line in fm_lines:
        key, _, value = line.partition(':')
        key = key.strip()
        kv[key] = value.strip()
        order.append(key)
    for key, value in overrides.items():
        if key not in kv:
            order.append(key)
        kv[key] = value
    new_fm = [f'{k}: {kv[k]}' for k in order]
    return '\n'.join(['---', *new_fm, '---', *lines[close_idx + 1:]])


def _expect(text: str, code: str):
    with pytest.raises(ValidationError) as exc_info:
        parse_bcca_book(text)
    assert exc_info.value.code == code, (
        f'expected {code!r}, got {exc_info.value.code!r}: {exc_info.value.detail}')


def test_missing_frontmatter_no_fence():
    _expect('file_number: CA52140\n', 'missing_frontmatter')


def test_missing_frontmatter_no_closing_fence():
    _expect('---\nfile_number: CA52140\n', 'missing_frontmatter')


def test_unknown_key():
    text = _replace_frontmatter_block(VALID_TEXT, bogus_field='hello')
    _expect(text, 'unknown_key')


def test_duplicate_key():
    lines = VALID_TEXT.splitlines()
    close_idx = next(i for i in range(1, len(lines)) if lines[i].strip() == '---')
    dup = ['---'] + lines[1:close_idx] + ['registry: Vancouver'] + ['---'] + lines[close_idx + 1:]
    _expect('\n'.join(dup), 'duplicate_key')


def test_missing_required_key():
    lines = VALID_TEXT.splitlines()
    close_idx = next(i for i in range(1, len(lines)) if lines[i].strip() == '---')
    fm_lines = [l for l in lines[1:close_idx] if not l.startswith('registry:')]
    text = '\n'.join(['---', *fm_lines, '---', *lines[close_idx + 1:]])
    _expect(text, 'missing_required_key')


def test_invalid_json():
    text = _replace_frontmatter_block(VALID_TEXT, party_groups='{not valid json')
    _expect(text, 'invalid_json')


def test_bad_toc_row_unknown_key():
    text = _replace_frontmatter_block(
        VALID_TEXT, response_book_toc='[{"text": "Part 1", "indent": 0, "bogus": "x"}]')
    _expect(text, 'bad_toc_row')


def test_bad_toc_row_missing_key():
    text = _replace_frontmatter_block(
        VALID_TEXT, response_book_toc='[{"indent": 0}]')
    _expect(text, 'bad_toc_row')


def test_bad_indent():
    text = _replace_frontmatter_block(
        VALID_TEXT, response_book_toc='[{"text": "Part 1", "indent": 5, "part": null}]')
    _expect(text, 'bad_indent')


def test_bad_toc_row_missing_part():
    text = _replace_frontmatter_block(
        VALID_TEXT, response_book_toc='[{"text": "Part 1", "indent": 0}]')
    _expect(text, 'bad_toc_row')


def test_bad_part_ref_out_of_range():
    text = _replace_frontmatter_block(
        VALID_TEXT, boa_toc='[{"authority": "R. v. Jordan", "citation": null, "part": 2}]')
    _expect(text, 'bad_part_ref')


def test_bad_parts_entry():
    text = _replace_frontmatter_block(VALID_TEXT, response_book_parts='[{"bookmark": ""}]')
    _expect(text, 'bad_parts')


def test_missing_parts_key():
    lines = [l for l in VALID_TEXT.splitlines() if not l.startswith('boa_parts:')]
    _expect('\n'.join(lines), 'missing_required_key')


def test_bad_party_group_empty():
    text = _replace_frontmatter_block(VALID_TEXT, party_groups='[]')
    _expect(text, 'bad_party_group')


def test_bad_party_group_missing_names():
    text = _replace_frontmatter_block(
        VALID_TEXT, party_groups='[{"role": "Appellants"}, {"role": "Respondents", "names": ["X"]}]')
    _expect(text, 'bad_party_group')


def test_bad_contact_length_mismatch():
    text = _replace_frontmatter_block(
        VALID_TEXT,
        contacts='[{"role": "Appellants", "names": ["Tidewater Outfitters Inc."]}]')
    _expect(text, 'bad_contact')


def test_bad_access_restrictions_empty_array():
    text = _replace_frontmatter_block(VALID_TEXT, access_restrictions='[]')
    _expect(text, 'bad_access_restrictions')


def test_response_book_group_absent_passes():
    """A bcca_factum book carries the BOA half alone (bcca-book-contract.md "Scope")."""
    data = parse_bcca_book(drop_keys(VALID_TEXT, RESPONSE_BOOK_KEYS))
    for key in RESPONSE_BOOK_KEYS:
        assert key not in data
    assert len(data['boa_toc']) == 2
    assert len(data['boa_parts']) == 2


@pytest.mark.parametrize('dropped', RESPONSE_BOOK_KEYS)
def test_partial_response_book_group_rejects(dropped):
    _expect(drop_keys(VALID_TEXT, [dropped]), 'partial_response_book')


def test_partial_response_book_detail_names_the_missing_key():
    with pytest.raises(ValidationError) as exc_info:
        parse_bcca_book(drop_keys(VALID_TEXT, ['response_book_parts']))
    assert 'response_book_parts' in exc_info.value.detail


def test_nonblank_body():
    text = VALID_TEXT + '\nSome trailing prose that must not appear.\n'
    _expect(text, 'nonblank_body')


if __name__ == '__main__':
    raise SystemExit(pytest.main([__file__, '-q']))
