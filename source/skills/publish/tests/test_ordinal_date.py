"""Round-trip tests for scripts/ordinal_date.py's format_ordinal_date."""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'scripts'))

from ordinal_date import format_ordinal_date  # noqa: E402

CASES = [
    ('2026-06-29', 'the 29th day of June, 2026'),
    ('2026-01-01', 'the 1st day of January, 2026'),
    ('2026-02-02', 'the 2nd day of February, 2026'),
    ('2026-03-03', 'the 3rd day of March, 2026'),
    ('2026-04-04', 'the 4th day of April, 2026'),
    ('2026-11-11', 'the 11th day of November, 2026'),
    ('2026-11-12', 'the 12th day of November, 2026'),
    ('2026-11-13', 'the 13th day of November, 2026'),
    ('2026-01-21', 'the 21st day of January, 2026'),
    ('2026-01-22', 'the 22nd day of January, 2026'),
    ('2026-01-23', 'the 23rd day of January, 2026'),
    ('2026-01-31', 'the 31st day of January, 2026'),
    ('2026-12-25', 'the 25th day of December, 2026'),
]


def test_format_ordinal_date_cases():
    failures = []
    for iso, expected in CASES:
        actual = format_ordinal_date(iso)
        if actual != expected:
            failures.append((iso, expected, actual))
    assert not failures, f'ordinal date mismatches: {failures}'


def test_format_ordinal_date_rejects_non_iso():
    import pytest
    with pytest.raises(ValueError):
        format_ordinal_date('June 29, 2026')


if __name__ == '__main__':
    test_format_ordinal_date_cases()
    print('ordinal date cases: OK')
