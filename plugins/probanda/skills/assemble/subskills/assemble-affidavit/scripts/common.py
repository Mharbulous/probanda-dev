"""Shared helpers for assemble-affidavit scripts.

Import via:
    import sys
    from pathlib import Path
    sys.path.insert(0, str(Path(__file__).parent))
    import common
"""
import json
import os
import re
import sys
from datetime import date
from pathlib import Path

SCRIPTS_DIR = Path(__file__).parent
ASSETS_FONTS_DIR = SCRIPTS_DIR.parent / "assets" / "fonts"

# Fixed system font fallbacks (confirmed present on Windows).
_SYSTEM_FONT_FALLBACK = {
    "stamp": Path(r"C:\Windows\Fonts\calibri.ttf"),
    "body": Path(r"C:\Windows\Fonts\arial.ttf"),
}

_BUNDLED_FONT = {
    "stamp": ASSETS_FONTS_DIR / "Carlito-Regular.ttf",
    "body": ASSETS_FONTS_DIR / "LiberationSans-Regular.ttf",
}

# Stamp-only-page detector, shared by inspect_exhibits.py and assemble.py.
STAMP_ONLY_PATTERN = re.compile(
    r'This is Exhibit\s+"?[A-Z]"?\s+referred to in the', re.IGNORECASE
)

_MONTH_NAMES = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
]


def resolve_font(role):
    """Resolve a font file path for the given role ("stamp" or "body").

    Preference order: bundled font under assets/fonts/, then the Windows
    system font fallback. Returns a dict {"success": False, "error":
    "font_not_found", "role": role} if neither exists — the caller is
    responsible for emitting this as its own failure.
    """
    if role not in _BUNDLED_FONT:
        raise ValueError(f"unknown font role: {role!r}")

    bundled = _BUNDLED_FONT[role]
    if bundled.is_file():
        return str(bundled)

    fallback = _SYSTEM_FONT_FALLBACK[role]
    if fallback.is_file():
        return str(fallback)

    return {"success": False, "error": "font_not_found", "role": role}


def ordinal(n):
    """Convert an integer to its ordinal string form: 1 -> '1st', 11 -> '11th'."""
    n = int(n)
    if 11 <= (n % 100) <= 13:
        suffix = "th"
    else:
        suffix = {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    return f"{n}{suffix}"


def parse_date(s):
    """Parse a YYYY-MM-DD string into a date object."""
    y, m, d = s.split("-")
    return date(int(y), int(m), int(d))


def month_name(d):
    """Return the full month name for a date object."""
    return _MONTH_NAMES[d.month - 1]


def format_month_day_year(d):
    """Format a date object as 'June 10, 2026'."""
    return f"{month_name(d)} {d.day}, {d.year}"


def next_version(path):
    """The path the next copy of path's series takes, and the highest existing
    copy (None if none). path's own name counts as v1 and `<stem> vN<ext>` as vN."""
    path = Path(path)
    series = re.compile(r"^%s(?: v(\d+))?%s$" % (re.escape(path.stem), re.escape(path.suffix)), re.I)
    taken = {}
    for entry in path.parent.iterdir():
        match = series.match(entry.name)
        if match:
            taken[int(match.group(1) or 1)] = entry
    if not taken:
        return path, None
    top = max(taken)
    return path.with_name(f"{path.stem} v{top + 1}{path.suffix}"), taken[top]


def save_new(path, save):
    """Save a PDF without overwriting: `save(tmp)` writes a `~` temporary file
    beside path, which is then renamed to next_version(path). Returns the path
    written and the copy it was versioned from (None for the first)."""
    path = Path(path)
    tmp = path.with_name(f"~{path.stem}.tmp-{os.getpid()}{path.suffix}")
    try:
        save(tmp)
        written, prior = next_version(path)
        if written.exists():
            raise FileExistsError(f"not overwriting {written}")
        os.replace(tmp, written)
    finally:
        if tmp.exists():
            tmp.unlink()
    return written, prior


def emit(obj, success):
    """Print obj as JSON to stdout and exit with the appropriate code."""
    json.dump(obj, sys.stdout, indent=2)
    sys.stdout.write("\n")
    sys.exit(0 if success else 1)


def read_input_json():
    """Read the input JSON either from argv[1] (a file path) or stdin.

    Callers that support a separate "--probe" CLI mode must branch on
    sys.argv[1] == "--probe" themselves before calling this function.

    Returns the parsed dict. Does not catch errors — callers wrap their
    main() body in try/except to produce the structured error envelope.
    """
    if len(sys.argv) > 1:
        with open(sys.argv[1], "r", encoding="utf-8") as f:
            return json.load(f)
    data = sys.stdin.read()
    return json.loads(data)
