#!/usr/bin/env python3
"""dump.py — write evidence.sql, the durable plain-text SQL dump.

Stages temp copies of the three binaries, asserts DELETE journal mode, and
writes evidence.sql with a header line carrying `schema v9.0`, then each
database's rows fenced by its section marker pair, content produced by the
connection's iterdump(). This is the durable text boundary that survives
cloud-sync corruption and is the rebuild/migration source. Run after every
mutation.

E1-ONLY. Do not run/import/copy/stage in a mediated/sandboxed (E2) filesystem —
the mount may serve stale/truncated bytes. See ../scripts.md.

Usage:
    python3 dump.py <matter_root>
"""

import argparse
import os
import sqlite3
import sys

import fuse_safe_io
import resolve_paths

HEADER = "-- Case Data evidence dump — schema v9.0"


def dump_db(path):
    """iterdump a single database opened alone (main-schema statements only)."""
    c = sqlite3.connect(path)
    try:
        return "\n".join(c.iterdump())
    finally:
        c.close()


def build_dump_text(copies):
    """Assemble the full dump text with header and section markers."""
    lines = [HEADER]
    section_counts = {}
    for db in ('main', 'law', 'privileged'):
        body = dump_db(copies[db])
        section_counts[db] = (body.count("\n") + 1) if body else 0
        lines.append(f"-- ===== v6 BEGIN {db} =====")
        lines.append(body)
        lines.append(f"-- ===== v6 END {db} =====")
    return "\n".join(lines) + "\n", section_counts


def write_atomic(path, text):
    """Write text to path atomically (temp file + replace), no sidecars."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8', newline='\n') as fh:
        fh.write(text)
    os.replace(tmp, path)


def main(argv=None):
    ap = argparse.ArgumentParser(description="Write evidence.sql (schema v9.0 dump).")
    ap.add_argument('matter_root', help="Path to the matter root folder.")
    args = ap.parse_args(argv)

    resolved = resolve_paths.resolve_pointer(
        args.matter_root, warn=lambda m: sys.stderr.write(f"WARNING: {m}\n"))
    tmpdir, copies = fuse_safe_io.stage_copies(resolved)
    try:
        # Assert DELETE journal mode on the attached connection before dumping.
        con = fuse_safe_io.open_attached(copies)
        con.close()
        text, section_counts = build_dump_text(copies)
    finally:
        fuse_safe_io.cleanup(tmpdir)

    write_atomic(resolved['evidence_sql'], text)
    line_count = text.count("\n")
    print(f"Wrote {resolved['evidence_sql']}")
    print(f"header: {HEADER}")
    print(f"lines: {line_count}")
    for db in ('main', 'law', 'privileged'):
        print(f"section {db}: {section_counts[db]} lines")
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
