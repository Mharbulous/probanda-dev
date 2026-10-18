"""resolve_paths.py — path-resolution helpers for matter-data (MODULE).

Importable module. Mirrors the pointer-resolution helpers documented in
../../shared/conventions.md §2.3. It ports the inline resolution logic to a
standalone, reusable form so the E1 convenience CLIs can share one
implementation.

E1-ONLY: these helpers stage temp copies of the SQLite binaries and operate on
native storage. They MUST NOT be executed, imported, copied, or staged in a
mediated/sandboxed filesystem (E2) — the mount may serve stale or truncated
bytes. In E2 use the inline operation code instead. See ../scripts.md and
../../shared/conventions.md §1.

Standard library only.
"""

import json
import os
import re
import shutil
import sqlite3
import tempfile

# ---------------------------------------------------------------------------
# DESIGN NOTE — staging discipline is load-bearing, NOT the folder location.
# The SQLite binaries live in the '0. CASE DATA' sibling root, which is itself
# INSIDE the SharePoint-synced library — no folder choice escapes cloud sync. A
# synced/FUSE-style mount serves stale file-size metadata that corrupts binary
# SQLite reads and writes. What makes them safe is never leaving a live handle
# on synced storage: temp-copy staging, DELETE journal, copy-back. A future
# "simplifier" MUST NOT operate on the native binaries in place. The plain-text
# pointer and dump are written atomically and are safe in the synced tree.
# ---------------------------------------------------------------------------
CASE_DATA_FOLDER = '0. CASE DATA'                       # sibling root for binaries (synced library)
LEGACY_ARTIFACTS_DIR = '9. AI'                          # legacy pointer/binary location
ENV_ROOT_OVERRIDE = 'COCLERK_CASE_DATA_ROOT'            # replaces computed root when set
EXPECTED_USER_VERSION = 90                              # v9.0
EXPECTED_SCHEMA_VERSION = 5                             # pointer (probanda.json) form
POINTER_NAMES = ('probanda.json', 'coclerk.json')       # current name first; the legacy name is kept updated
LEGACY_USER_VERSION = 62                                # PRAGMA 0 is treated as this


def staging_prefix(kind):
    """Temp-folder prefix `coclerk_<kind>_<tag>_`, tagged with the data runtime's per-call
    COCLERK_STAGING_TAG so a call killed on timeout has its folders removed by tag (#1060).
    Run by hand there is no tag, and the prefix is the untagged `coclerk_<kind>_`."""
    tag = os.environ.get('COCLERK_STAGING_TAG')
    return 'coclerk_%s_%s_' % (kind, tag) if tag else 'coclerk_%s_' % kind


def is_absolute(p):
    """True for a Windows drive letter (C:\\...), UNC (\\\\server\\...), or POSIX absolute."""
    if not p:
        return False
    if re.match(r'^[A-Za-z]:[\\/]', p):
        return True
    if p.startswith('\\\\') or p.startswith('//'):
        return True
    return p.startswith('/')


def norm_join(base, *parts):
    """Path join tolerant of both separators; normalized to native form."""
    joined = os.path.join(base, *parts)
    return os.path.normpath(joined.replace('\\', os.sep).replace('/', os.sep))


def pointer_paths(folder):
    """Every file a write to folder's pointer goes to: probanda.json, and coclerk.json with the
    same content so an older copy of the plugin still finds the matter."""
    return [norm_join(folder, name) for name in POINTER_NAMES]


def find_pointer(folder):
    """folder's pointer file: probanda.json when present, else coclerk.json, else None."""
    return next((p for p in pointer_paths(folder) if os.path.exists(p)), None)


def sanitize_short_name(name):
    """Strip illegal filename characters and trim to 60 chars."""
    cleaned = re.sub(r'[<>:"/\\|?*\x00-\x1f]', '', name or '').strip()
    return cleaned[:60].strip()


def parse_folder_name(matter_folder):
    """Fallback identity from the matter folder name.

    Patterns like "8165.L8153 Example Matter" or "L8153 Example Matter": the
    leading token (client.matter or matter-only) is the matter reference,
    stored under the `matter_id` metadata key; the remainder is the short
    name. Returns (matter_id, short_name).
    """
    base = os.path.basename(os.path.normpath(matter_folder))
    m = re.match(r'^\s*((?:\d+\.)?[A-Za-z]?\d+[A-Za-z0-9.\-]*)\s+(.*)$', base)
    if m:
        return m.group(1).strip(), sanitize_short_name(m.group(2))
    return sanitize_short_name(base), ''


def case_data_root(matter_root):
    """The native matter-data root: env override, else sibling '0. CASE DATA'."""
    override = os.environ.get(ENV_ROOT_OVERRIDE)
    if override:
        return override
    return norm_join(os.path.dirname(os.path.normpath(matter_root)), CASE_DATA_FOLDER)


def default_evidence_sql(matter_root, case_data_dir):
    """The text dump beside the databases, stored relative to the matter root so the
    pointer survives a change of user profile; absolute when the two are on different drives."""
    path = norm_join(case_data_dir, 'evidence.sql')
    try:
        return os.path.relpath(path, matter_root)
    except ValueError:
        return path


def identity_from_metadata(main_sqlite_path):
    """Return (matter_id, short_name) from main.matter_metadata, or (None, None).

    Probes a temp copy so the native binary is never opened in place.
    """
    if not os.path.exists(main_sqlite_path):
        return None, None
    tmp = tempfile.mkdtemp(prefix=staging_prefix('probe'))
    dst = os.path.join(tmp, 'main.sqlite')
    try:
        shutil.copy2(main_sqlite_path, dst)
        con = sqlite3.connect(dst)
        try:
            rows = dict(con.execute(
                "SELECT key, value FROM matter_metadata "
                "WHERE key IN ('matter_id', 'short_name')").fetchall())
        finally:
            con.close()
        mid = rows.get('matter_id')
        sn = sanitize_short_name(rows.get('short_name', '') or '')
        return (mid, sn) if mid else (None, None)
    except Exception:
        return None, None
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def _is_stale_sandbox(p):
    """A stored absolute sandbox-session path (/sessions/...) that no longer exists."""
    return bool(p) and p.replace('\\', '/').startswith('/sessions/') \
        and not os.path.exists(p)


def _is_legacy_value(p, matter_root, legacy_dir):
    """True when the stored case_data_dir points at the legacy '9. AI' folder."""
    if not p:
        return False
    resolved = os.path.normpath(p) if is_absolute(p) else norm_join(matter_root, p)
    return resolved == legacy_dir


def _read_user_version(sqlite_path):
    """PRAGMA user_version on a temp copy; 0 is treated as legacy 62."""
    tmp = tempfile.mkdtemp(prefix=staging_prefix('guard'))
    probe = os.path.join(tmp, os.path.basename(sqlite_path))
    try:
        shutil.copy2(sqlite_path, probe)
        con = sqlite3.connect(probe)
        try:
            uv = con.execute("PRAGMA user_version").fetchone()[0]
        finally:
            con.close()
        return LEGACY_USER_VERSION if uv == 0 else uv
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def resolve_case_data_dir(matter_root, stored, root, legacy_dir):
    """Select a usable stored nominee or derive the location from the live root.

    Returns ``(case_data_dir, rejected_nominee)``. A stored path is only a
    nomination: absolute and relative custom locations remain supported when
    they contain ``main.sqlite``.
    """
    if stored:
        nominee = os.path.normpath(stored) if is_absolute(stored) \
            else norm_join(matter_root, stored)
    else:
        nominee = None

    if nominee != legacy_dir and nominee \
            and os.path.exists(norm_join(nominee, 'main.sqlite')):
        return nominee, False

    # A matter folder can be renamed independently of its database folder.
    # Search only direct live-root children with the same matter reference,
    # then prove identity from main.sqlite before selecting one.
    matter_id, _ = parse_folder_name(matter_root)
    if matter_id and os.path.isdir(root):
        try:
            names = sorted(os.listdir(root))
        except OSError:
            names = []
        for name in names:
            candidate = norm_join(root, name)
            candidate_id, _ = parse_folder_name(candidate)
            if candidate_id.casefold() != matter_id.casefold():
                continue
            main_sqlite = norm_join(candidate, 'main.sqlite')
            if not os.path.isfile(main_sqlite):
                continue
            metadata_id, _ = identity_from_metadata(main_sqlite)
            if metadata_id and metadata_id.casefold() == matter_id.casefold():
                return candidate, bool(stored)

    mid, sn = None, None
    for cand in (nominee, legacy_dir):
        if cand:
            mid, sn = identity_from_metadata(norm_join(cand, 'main.sqlite'))
            if mid:
                break
    if not mid:
        mid, sn = parse_folder_name(matter_root)
    folder = f"{mid} {sn}".strip()
    derived = norm_join(root, folder)
    rejected = bool(stored and nominee != legacy_dir
                    and os.path.normcase(nominee) != os.path.normcase(derived))
    return derived, rejected


def resolve_pointer(matter_root, running_in_sandbox=False, migrate_only=False,
                    warn=None):
    """Resolve the matter pointer (probanda.json, else coclerk.json) to concrete database paths.

    Implements the eight-step behavioral contract from
    ../../shared/conventions.md §2.3. Returns a dict of resolved paths. The
    migrate operation is the only caller that passes migrate_only=True to
    bypass the schema-version guard (step 6).

    `warn` is an optional callable for the non-fatal stale-dump warning
    (step 7); defaults to no-op.
    """
    if warn is None:
        warn = lambda _msg: None
    # abspath, not normpath: matter_root is written into the pointer as the
    # durable host path (conventions §2.2), so a relative CLI argument must not
    # be stored verbatim.
    matter_root = os.path.abspath(matter_root)

    # --- Step 1: locate the pointer (root, then legacy 9. AI) ---------------
    root_ptrs = pointer_paths(matter_root)
    pointer_path = find_pointer(matter_root) \
        or find_pointer(norm_join(matter_root, LEGACY_ARTIFACTS_DIR))
    if pointer_path is None:
        raise SystemExit("probanda.json not found; initialize the matter first.")

    # --- Step 2: raw bytes, strip NUL, parse JSON (sync-mangle defense) -----
    with open(pointer_path, 'rb') as fh:
        raw = fh.read()
    pointer = json.loads(raw.replace(b'\x00', b'').decode('utf-8'))

    # --- Step 3: resolve case_data_dir -------------------------------------
    root = case_data_root(matter_root)
    legacy_dir = norm_join(matter_root, LEGACY_ARTIFACTS_DIR)
    stored = pointer.get('case_data_dir')

    case_data_dir, rejected_nominee = resolve_case_data_dir(
        matter_root, stored, root, legacy_dir)

    # --- Step 4: legacy migration (9. AI -> native folder) -----------------
    if _is_legacy_value(pointer.get('case_data_dir'), matter_root, legacy_dir) \
            or pointer_path not in root_ptrs:
        os.makedirs(case_data_dir, exist_ok=True)
        if os.path.isdir(legacy_dir):
            for fn in ('main.sqlite', 'law.sqlite', 'privileged.sqlite'):
                src = norm_join(legacy_dir, fn)
                dst = norm_join(case_data_dir, fn)
                if os.path.exists(src) and not os.path.exists(dst):
                    shutil.move(src, dst)
        mid, sn = identity_from_metadata(norm_join(case_data_dir, 'main.sqlite'))
        if mid:
            preferred = norm_join(root, f"{mid} {sn}".strip())
            if preferred != case_data_dir:
                os.makedirs(os.path.dirname(preferred), exist_ok=True)
                if not os.path.exists(preferred):
                    shutil.move(case_data_dir, preferred)
                    case_data_dir = preferred

    # --- Step 5: normalized write-back -------------------------------------
    stored_ptr = pointer.get('case_data_dir')
    durable_dir = stored_ptr if running_in_sandbox and stored_ptr \
        and is_absolute(stored_ptr) and not _is_stale_sandbox(stored_ptr) \
        and not _is_legacy_value(stored_ptr, matter_root, legacy_dir) \
        else case_data_dir
    normalized = {
        'schema_version': EXPECTED_SCHEMA_VERSION,
        'matter_root': matter_root,
        'case_data_dir': durable_dir,
        'evidence_sql_path': pointer.get(
            'evidence_sql_path', default_evidence_sql(matter_root, case_data_dir)),
    }
    for root_ptr in root_ptrs:
        with open(root_ptr, 'w', encoding='utf-8') as fh:
            json.dump(normalized, fh, indent=2)

    main_sqlite = norm_join(case_data_dir, 'main.sqlite')

    # --- Step 6: schema version guard --------------------------------------
    # A missing main.sqlite is not a version violation -- it is the state
    # `maintain` rebuild mode exists to recover from (binaries deleted or
    # corrupted, evidence.sql is the durable source). Skip the guard rather
    # than crash; the calling operation surfaces its own missing-database error.
    if not migrate_only and os.path.exists(main_sqlite):
        version = _read_user_version(main_sqlite)
        if version < EXPECTED_USER_VERSION:
            major, minor = version // 10, version % 10
            raise SystemExit(
                f"Database schema is at v{major}.{minor} but this skill "
                f"requires v9.0. Run matter_data__migrate in plan mode.")

    # --- Step 7: stale-dump warning (non-fatal) ----------------------------
    evidence_sql = norm_join(matter_root, normalized['evidence_sql_path'])
    warnings = []
    if rejected_nominee:
        warnings.append(
            "Stored case_data_dir nominee did not contain main.sqlite; "
            f"selected live-derived location {case_data_dir} and healed probanda.json.")
    if not migrate_only and os.path.exists(evidence_sql):
        try:
            with open(evidence_sql, 'r', encoding='utf-8', errors='replace') as fh:
                first = fh.readline()
            m = re.search(r'schema v(\d+)\.(\d+)', first)
            if not m or (int(m.group(1)) * 10 + int(m.group(2))) < EXPECTED_USER_VERSION:
                warnings.append(
                    "evidence.sql is missing a v9.0 schema header or predates "
                    "v9.0. Regenerate it via maintain; the rebuild-only "
                    "transition through v7.6 is the sole exception.")
        except Exception:
            pass
    if warnings:
        warn(" ".join(warnings))

    return {
        'pointer_path': root_ptrs[0],
        'case_data_dir': case_data_dir,
        'main_sqlite': main_sqlite,
        'law_sqlite': norm_join(case_data_dir, 'law.sqlite'),
        'privileged_sqlite': norm_join(case_data_dir, 'privileged.sqlite'),
        'evidence_sql': evidence_sql,
    }
