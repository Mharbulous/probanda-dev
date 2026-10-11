"""Format an ISO date as court-cover ordinal prose.

2026-06-29 -> "the 29th day of June, 2026"

Pure function, no dependencies -- used by fill_book.py to render the cover
page's "ON APPEAL FROM ... pronounced on ..." line from the contract's
under_appeal_pronounced ISO date.
"""
from __future__ import annotations

import datetime

_MONTHS = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
]


def _ordinal_suffix(day: int) -> str:
    if 11 <= day % 100 <= 13:
        return 'th'
    return {1: 'st', 2: 'nd', 3: 'rd'}.get(day % 10, 'th')


def format_ordinal_date(iso_date: str) -> str:
    """Raises ValueError on a non-ISO or invalid date string."""
    d = datetime.date.fromisoformat(iso_date)
    day = d.day
    month = _MONTHS[d.month - 1]
    return f'the {day}{_ordinal_suffix(day)} day of {month}, {d.year}'
