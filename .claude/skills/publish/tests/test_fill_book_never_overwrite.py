"""The book fill never replaces an existing file: a taken name gets the next free
" vN", reported as versioned_from (#1413), the same way fill_factum.py versions."""
from __future__ import annotations

import errno
import json
import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'scripts'))

import fill_book  # noqa: E402
from fill_book import OUTPUT_NAMES  # noqa: E402

VALID_PATH = Path(__file__).resolve().parent / 'fixtures' / 'valid-bcca-book.md'


def _fill(out_dir: Path, capsys) -> list[dict]:
    assert fill_book._fill(VALID_PATH, out_dir) == 0
    return [json.loads(line) for line in capsys.readouterr().out.splitlines()]


def _versioned(name: str, n: int) -> str:
    return name[:-len('.docx')] + f' v{n}.docx'


def test_second_fill_versions_every_document_and_keeps_the_first(tmp_path, capsys):
    first = _fill(tmp_path, capsys)
    for p in tmp_path.iterdir():
        os.utime(p, (1_000_000_000, 1_000_000_000))
    before = {p.name: p.read_bytes() for p in tmp_path.iterdir()}

    second = _fill(tmp_path, capsys)

    assert {p.name: p.read_bytes() for p in tmp_path.iterdir() if p.name in before} == before
    assert all((tmp_path / name).stat().st_mtime == 1_000_000_000 for name in before)
    for one, two in zip(first, second):
        assert 'versioned_from' not in one
        assert Path(two['path']).name == _versioned(OUTPUT_NAMES[two['document']], 2)
        assert two['versioned_from'] == one['path']
    assert sorted(p.name for p in tmp_path.iterdir()) == sorted(
        list(OUTPUT_NAMES.values()) + [_versioned(n, 2) for n in OUTPUT_NAMES.values()])


def test_only_taken_names_are_versioned(tmp_path, capsys):
    taken = tmp_path / OUTPUT_NAMES['boa_cover']
    taken.write_bytes(b'reviewed')
    (tmp_path / _versioned(OUTPUT_NAMES['boa_cover'], 3)).write_bytes(b'reviewed v3')

    lines = {e['document']: e for e in _fill(tmp_path, capsys)}

    assert lines['boa_cover']['path'] == str(tmp_path / _versioned(OUTPUT_NAMES['boa_cover'], 4))
    assert lines['boa_cover']['versioned_from'] == str(tmp_path / _versioned(OUTPUT_NAMES['boa_cover'], 3))
    for key in ('response_book_cover', 'response_book_toc', 'boa_toc'):
        assert lines[key]['path'] == str(tmp_path / OUTPUT_NAMES[key])
        assert 'versioned_from' not in lines[key]


def test_existing_file_is_never_touched(tmp_path, capsys):
    existing = tmp_path / OUTPUT_NAMES['response_book_toc']
    existing.write_bytes(b'bound copy')
    os.utime(existing, (1_000_000_000, 1_000_000_000))

    _fill(tmp_path, capsys)

    assert existing.read_bytes() == b'bound copy'
    assert existing.stat().st_mtime == 1_000_000_000
    assert not [p for p in tmp_path.iterdir() if p.name.startswith('~')]


def test_name_taken_mid_run_is_refused_not_replaced(tmp_path, capsys, monkeypatch):
    """A file that appears between choosing the name and writing it is refused."""
    real = fill_book.next_version

    def racing(out_dir, stem):
        path, prior = real(out_dir, stem)
        Path(path).write_bytes(b'another session')
        return path, prior

    monkeypatch.setattr(fill_book, 'next_version', racing)
    assert fill_book._fill(VALID_PATH, tmp_path) == 1
    envelope = json.loads(capsys.readouterr().out.splitlines()[-1])
    assert envelope['success'] is False and envelope['error'] == 'output_exists'
    assert (tmp_path / OUTPUT_NAMES['response_book_cover']).read_bytes() == b'another session'
    assert not [p for p in tmp_path.iterdir() if p.name.startswith('~')]


def test_name_taken_at_the_move_is_refused_not_replaced(tmp_path, capsys, monkeypatch):
    """A file that appears after the name is chosen, just before the move, is refused (#1434)."""
    real = fill_book.move_exclusive
    competing = tmp_path / OUTPUT_NAMES['response_book_cover']

    def racing(src, dst):
        competing.write_bytes(b'another session')
        os.utime(competing, (1_000_000_000, 1_000_000_000))
        real(src, dst)

    monkeypatch.setattr(fill_book, 'move_exclusive', racing)
    assert fill_book._fill(VALID_PATH, tmp_path) == 1
    envelope = json.loads(capsys.readouterr().out.splitlines()[-1])
    assert envelope == {'success': False, 'error': 'output_exists',
                        'detail': f'{competing} already exists; never overwritten'}
    assert competing.read_bytes() == b'another session'
    assert competing.stat().st_mtime == 1_000_000_000
    assert [p.name for p in tmp_path.iterdir()] == [competing.name]


def test_a_failed_exclusive_move_fails_loudly_and_writes_nothing(tmp_path, monkeypatch):
    """No fallback to a replacing move when the exclusive move fails for another reason (#1434)."""
    def refuse(src, dst):
        raise PermissionError(errno.EACCES, 'link refused', dst)

    monkeypatch.setattr(os, 'link', refuse)
    with pytest.raises(PermissionError):
        fill_book._fill(VALID_PATH, tmp_path)
    assert list(tmp_path.iterdir()) == []
