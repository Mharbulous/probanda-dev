#!/usr/bin/env python3
"""timecamping.db schema migration runner.

Applies the versioned schema hops in ../migrations.sql to the (single, fixed,
per-practitioner) timecamping database, using only the Python stdlib sqlite3
module -- no dependencies, no build step. Same runner contract and same
db_meta.schema_version convention (not PRAGMA user_version) already used by
this codebase's other generic-connection-primitive gatekeeper skills.

TARGET_SCHEMA_VERSION is the single place this version is stated for the
Python side. A future schema bump adds a new "-- MIGRATE <n> -> <n+1>"
section to migrations.sql (self-contained: it must end by stamping
db_meta.schema_version to its own target) and raises this constant by one.
"""

import re
import shutil
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

TARGET_SCHEMA_VERSION = 6

_MARKER_RE = re.compile(r'^-- MIGRATE\s+(\d+)\s*->\s*(\d+)\s*$', re.MULTILINE)

_MIGRATIONS_SQL_PATH = Path(__file__).resolve().parent.parent / "migrations.sql"


class MigrateError(RuntimeError):
    """Raised for a named migrate refusal. `code`/`details` let the MCP
    driver (plugins/litigation/mcp/src/timecamping/migrate.ts) relay a
    structured error instead of an opaque internal_error -- see as_dict()."""

    def __init__(self, message, code=None, details=None):
        super().__init__(message)
        self.message = message
        self.code = code or "migrate_error"
        self.details = details or {}

    def as_dict(self):
        return {"code": self.code, "message": self.message, "details": self.details}


def _load_migrations(migrations_sql_path=_MIGRATIONS_SQL_PATH):
    """Parse migrations.sql into {(from_version, to_version): sql_text}."""
    text = migrations_sql_path.read_text(encoding="utf-8")
    markers = list(_MARKER_RE.finditer(text))
    if not markers:
        raise MigrateError(f"no MIGRATE markers found in {migrations_sql_path}")
    migrations = {}
    for i, marker in enumerate(markers):
        from_version, to_version = int(marker.group(1)), int(marker.group(2))
        start = marker.end()
        end = markers[i + 1].start() if i + 1 < len(markers) else len(text)
        migrations[(from_version, to_version)] = text[start:end].strip()
    return migrations


def _table_exists(con, name):
    return con.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", (name,)
    ).fetchone() is not None


def _current_version(con):
    if not _table_exists(con, "db_meta"):
        return 0
    row = con.execute(
        "SELECT value FROM db_meta WHERE key = 'schema_version'"
    ).fetchone()
    return int(row[0]) if row else 0


def _backup_db(db_path):
    """Copy db_path aside (timestamped, UTC) before the first hop touches a
    pre-existing database. Deliberately minimal, mirroring drafting-data's
    engine: not case-data's plan/apply/restore ceremony, just the copy-aside.
    The bare-file copy is complete because this database is contractually
    journal_mode=DELETE (enforced by timecamping/backend.ts's guard), so no
    -wal/-shm sidecars exist, and at call time this process holds only a
    read-idle connection. Never overwrites: a same-second rerun after a
    failed hop must not clobber the pristine copy with a half-migrated one."""
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup_path = Path(f"{db_path}.bak-{stamp}")
    n = 1
    while backup_path.exists():
        backup_path = Path(f"{db_path}.bak-{stamp}-{n}")
        n += 1
    try:
        shutil.copy2(db_path, backup_path)
    except OSError as exc:
        raise MigrateError(
            f"could not write pre-migration backup {backup_path}: {exc}",
            code="backup_failed",
            details={"db_path": str(db_path)},
        )
    return backup_path


def migrate(db_path, target_version=TARGET_SCHEMA_VERSION, migrations_sql_path=_MIGRATIONS_SQL_PATH):
    """Apply every pending migration hop to db_path, in order. Each hop
    runs via executescript, which is autocommit -- a failure partway
    through a hop leaves that hop's statements applied up to the failure
    point, not rolled back; recovery for a fresh database is delete-and-rerun,
    and for a pre-existing database is copying back the timestamped .bak-*
    file this function writes beside it before applying any hop (a fresh
    create backs up nothing -- there is nothing to protect). Returns the
    list of (from, to) hops applied -- an empty list means the database was
    already at target_version."""
    migrations = _load_migrations(migrations_sql_path)
    db_existed = Path(db_path).exists()  # before connect -- connect creates the file
    con = sqlite3.connect(db_path)
    applied = []
    try:
        con.execute("PRAGMA foreign_keys = ON")
        current = _current_version(con)
        if db_existed and current < target_version:
            _backup_db(db_path)
        while current < target_version:
            hop = next(
                ((f, t) for (f, t) in migrations if f == current), None
            )
            if hop is None:
                raise MigrateError(
                    f"no migration hop from version {current} "
                    f"(target {target_version}) -- a hop served by neither "
                    f"a marker nor a carve-out is a hard fail"
                )
            con.executescript(migrations[hop])
            con.commit()
            applied.append(hop)
            current = hop[1]
    finally:
        con.close()
    return applied


def run(request):
    """Entry point for the timecamping_data__migrate MCP tool
    (plugins/litigation/mcp/src/timecamping/migrate.ts): one JSON request in,
    one JSON-serializable result dict out, MigrateError on refusal. The
    driver holds no schema knowledge -- this is the whole contract.

    request = {"db_path": str}
    """
    db_path = request.get("db_path")
    if not db_path:
        raise MigrateError("request missing required 'db_path'", code="invalid_request")

    hops = migrate(db_path)

    con = sqlite3.connect(db_path)
    try:
        row = con.execute(
            "SELECT value FROM db_meta WHERE key = 'schema_version'"
        ).fetchone()
    finally:
        con.close()

    return {
        "applied": [{"from": f, "to": t} for (f, t) in hops],
        "schema_version": int(row[0]) if row else None,
    }


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("usage: migrate_engine.py <db_path>", file=sys.stderr)
        sys.exit(1)
    print(run({"db_path": sys.argv[1]}))
