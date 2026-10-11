"""Strip LEAP vendor parts from a template converted before convert.py began
stripping them, repair the relationships and content types left behind, and
remove the document variables and document ids from its settings part.

`convert.py` has removed `customXml/` and `word/webextensions/` from every
template it converted since 6ae43bf (2026-06-24 16:01).  `form-33.dotx` was
committed an hour earlier and never re-converted, so it still carries those
parts — along with four relationships pointing at `customXml/` members that
are missing from the package, which is what Word rejects.

The settings scrub is the flat-template builder's own `_sanitize_settings`.
A package with no settings part is left as it is; a malformed one raises.

Usage:
    python sanitize_template.py templates/form-33.dotx [more.dotx ...]
"""
from __future__ import annotations

import argparse
import zipfile
from pathlib import Path

from build_flat_templates import (
    _is_removed_part,
    _sanitize_settings,
    _strip_content_type_overrides,
    _strip_removed_relationships,
)


def sanitize(path: Path) -> tuple[int, int]:
    """Rewrite *path* in place without its vendor parts. Returns (removed, kept)."""
    with zipfile.ZipFile(path) as package:
        infos = package.infolist()
        members = {info.filename: package.read(info.filename) for info in infos}

    removed = [name for name in members if _is_removed_part(name)]
    for name in removed:
        del members[name]
    _strip_content_type_overrides(members)
    _strip_removed_relationships(members)
    if "word/settings.xml" in members:
        _sanitize_settings(members)

    path.unlink()
    with zipfile.ZipFile(path, "w") as package:
        for info in infos:
            if info.filename in members:
                package.writestr(info, members[info.filename])
    return len(removed), len(members)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("templates", nargs="+", type=Path)
    args = parser.parse_args()
    for template in args.templates:
        removed, kept = sanitize(template)
        print(f"{template}: removed {removed} member(s), kept {kept}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
