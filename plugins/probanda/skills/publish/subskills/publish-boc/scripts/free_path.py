"""Never-overwrite naming for publish-boc's Word deliverables.

A Word or PDF deliverable is never overwritten (workspace output rule): the
practitioner may already have reviewed, signed or served the earlier one. Each
is written at the root of the matter's draft folder under a stem the caller
composes by the firm's file naming convention. A local copy of
publish-general's `fill_general.next_version`: these scripts ship standalone,
so they do not import from another subskill.
"""

from __future__ import annotations

import os
import re
from collections.abc import Callable
from pathlib import Path

# What an --out-name stem may not carry: a character Windows forbids in a file
# name, a file extension, or the " v<n>" next_version appends itself.
BAD_STEM = re.compile(r'[\\/:*?"<>|]|\.(docx?|pdf)$| v\d+$', re.I)


def check_target(out_dir: str | Path, stem: str) -> str | None:
    """The refusal for an unusable folder or stem, or None when both will do."""
    if not stem.strip() or BAD_STEM.search(stem):
        return ('bad_input: --out-name %r must be a bare file name stem: not empty, '
                'without \\ / : * ? " < > |, a file extension or a trailing " v<n>"' % stem)
    if not os.path.isdir(out_dir):
        return f"no_out_dir: {out_dir} is not a folder"
    return None


def next_version(out_dir: str | Path, stem: str, ext: str) -> tuple[Path, Path | None]:
    """The path the next copy of a series takes, and the highest existing copy
    (None if none). `<stem><ext>` counts as v1 and `<stem> vN<ext>` as vN."""
    series = re.compile(r"^%s(?: v(\d+))?%s$" % (re.escape(stem), re.escape(ext)), re.I)
    taken = {}
    for entry in os.listdir(out_dir):
        match = series.match(entry)
        if match:
            taken[int(match.group(1) or 1)] = Path(out_dir) / entry
    if not taken:
        return Path(out_dir) / f"{stem}{ext}", None
    top = max(taken)
    return Path(out_dir) / f"{stem} v{top + 1}{ext}", taken[top]


def write_new(out_dir: str | Path, stem: str, ext: str,
              write: Callable[[Path], None]) -> tuple[Path, Path | None]:
    """Writes the next copy of a series: `write` fills a `~` temporary file in
    out_dir, which is then renamed, so a killed fill leaves no partial
    deliverable. Returns the path written and the copy it was versioned from."""
    tmp = Path(out_dir) / f"~{stem}.tmp-{os.getpid()}{ext}"
    try:
        write(tmp)
        path, prior = next_version(out_dir, stem, ext)
        if path.exists():
            raise FileExistsError(f"output_exists: not overwriting {path}")
        os.replace(tmp, path)
    finally:
        if tmp.exists():
            tmp.unlink()
    return path, prior
