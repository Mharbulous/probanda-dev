"""fuse_safe_io.py — temp-copy staging helpers for matter-data (MODULE).

Importable module. Implements the temp-copy staging flow from the environment
contract in ../../shared/conventions.md §1: copy the SQLite binaries into an
OS-managed temp directory, operate on the copies, close all connections, then
copy the closed binaries back to native storage. Enforces
`PRAGMA journal_mode = DELETE` on every connection (WAL is forbidden — it breaks
cross-database atomicity and leaves unsafe sidecar files on synced storage).

E1-ONLY: the very reason this flow exists is that a mediated/sandboxed (E2)
mount serves stale file-size metadata that corrupts binary reads and writes.
This module MUST NOT be executed, imported, copied, or staged in E2; use the
inline operation code there instead. See ../scripts.md.

Standard library only.
"""

import contextlib
import os
import shutil
import sqlite3
import tempfile

DBS = ('main', 'law', 'privileged')


def _enforce_delete_journal(con):
    """Set DELETE journal mode and verify it took; WAL is forbidden."""
    con.execute("PRAGMA journal_mode = DELETE")
    con.execute("PRAGMA foreign_keys = ON")
    mode = con.execute("PRAGMA journal_mode").fetchone()[0]
    if str(mode).lower() != 'delete':
        raise SystemExit(
            f"Refusing to operate: journal_mode is '{mode}', expected 'delete'.")


def stage_copies(paths, tmpdir=None):
    """Copy the three native binaries into an OS temp dir.

    `paths` is a mapping with keys main/law/privileged -> native paths (as
    returned by resolve_paths.resolve_pointer under those *_sqlite keys, or a
    direct {db: path} mapping). Returns (tmpdir, {db: staged_copy_path}).
    """
    if tmpdir is None:
        tmpdir = tempfile.mkdtemp(prefix='coclerk_stage_')
    resolved = _normalize_paths(paths)
    copies = {}
    for db in DBS:
        native = resolved[db]
        dst = os.path.join(tmpdir, f'{db}.sqlite')
        shutil.copy2(native, dst)
        copies[db] = dst
    return tmpdir, copies


def _normalize_paths(paths):
    """Accept either {db: path} or resolve_pointer's {'<db>_sqlite': path}."""
    out = {}
    for db in DBS:
        if db in paths:
            out[db] = paths[db]
        elif f'{db}_sqlite' in paths:
            out[db] = paths[f'{db}_sqlite']
        else:
            raise SystemExit(f"stage_copies: missing path for '{db}'.")
    return out


def copy_back(copies, native_paths):
    """Copy the closed staged binaries back into native storage.

    Callers MUST have closed every connection before calling this. `copies` and
    `native_paths` are {db: path} (or resolve_pointer form for native_paths).
    """
    resolved = _normalize_paths(native_paths)
    for db in DBS:
        shutil.copy2(copies[db], resolved[db])


def cleanup(tmpdir):
    """Remove a staging temp directory, ignoring errors."""
    if tmpdir:
        shutil.rmtree(tmpdir, ignore_errors=True)


def open_attached(copies, triggers_sql_text=None):
    """Open main as primary, ATTACH law and privileged, enforce DELETE journal.

    Optionally loads the TEMP triggers from `triggers.sql` text. Returns the
    connection; the caller closes it (or use the `attached` context manager).
    """
    con = sqlite3.connect(copies['main'])
    con.execute(f"ATTACH DATABASE '{copies['law']}' AS law")
    con.execute(f"ATTACH DATABASE '{copies['privileged']}' AS privileged")
    if triggers_sql_text:
        con.executescript(triggers_sql_text)
    _enforce_delete_journal(con)
    return con


@contextlib.contextmanager
def staged(native_paths, triggers_sql_text=None):
    """Context manager: stage copies, yield (con, copies, tmpdir), then clean up.

    Read-only and mutate flows both use this. To persist mutations, close the
    connection inside the block and call copy_back() before exiting. This
    manager only stages and cleans up temp — it never copies back automatically
    (a copy-back must follow an explicit, successful commit).
    """
    tmpdir, copies = stage_copies(native_paths)
    con = None
    try:
        con = open_attached(copies, triggers_sql_text)
        yield con, copies, tmpdir
    finally:
        if con is not None:
            with contextlib.suppress(Exception):
                con.close()
        cleanup(tmpdir)
