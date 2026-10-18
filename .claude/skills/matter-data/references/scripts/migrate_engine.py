"""migrate_engine.py — host-side schema migration engine for matter-data (MODULE).

Backs the `matter_data__migrate` MCP tool. Four modes:

  plan    — dry-run the whole chain to v9.0 on temp copies; return a plan_token
  apply   — re-verify the token, back up, re-run the chain, replace the natives
  restore — put a backup set back
  backups — list the backup sets for a matter

HOST-SIDE ONLY: like every module in this directory it stages temp copies of the
SQLite binaries and operates on native storage. It MUST NOT be executed,
imported, copied, or staged in a mediated/sandboxed filesystem (E2) — the mount
may serve stale or truncated bytes. The MCP server that drives it runs on the
host, which is what makes `matter_data__migrate` callable from any environment.
See ../scripts.md and ../../shared/conventions.md §1.

Two properties are load-bearing and must survive any refactor:

  1. `migrate_only=True` appears exactly once, as a hardcoded literal, and is
     never derived from tool input. It is the schema-guard escape hatch. The
     `matter_data__query`/`matter_data__execute` backend is a SEPARATE process with
     its own pointer resolver that has no such parameter — do not "simplify"
     that backend into importing resolve_paths, or the bypass lands one keyword
     argument away from the read path.

  2. The natives are replaced only by same-volume rename, only after every
     check has passed, with rollback copies already staged beside them. On any
     exception before that point the native files are untouched.

The carve-outs (v6.9→v7.0 and v7.4→v7.6) run by importing rebuild.py and calling
its in-temp upgrade functions directly on THIS module's staging area — never by shelling
out to `rebuild.py --migrate`, which resolves its own pointer, requires
evidence.sql to be overwritten with a v7.4 dump first, and replaces the natives
mid-chain.

Standard library only.
"""

import datetime
import hashlib
import hmac
import json
import os
import re
import shutil
import sqlite3
import tempfile

import rebuild
import resolve_paths

MIGRATE_ENGINE_VERSION = "1"
TARGET = 90                                     # v9.0
LEGACY_USER_VERSION = 62                        # PRAGMA 0 is treated as this
DBS = ('main', 'law', 'privileged')
DUMP_HEADER = "-- Case Data evidence dump -- schema v9.0"
REF_FILES = ('migrations.sql', 'triggers.sql', 'queries.sql')
BACKUP_FORMAT = 1
ENV_BACKUP_ROOT = 'COCLERK_CASE_BACKUP_ROOT'    # test/override hook

MARKER_RE = re.compile(
    r'^-- MIGRATE\s+(\d+)\s*->\s*(\d+)\s*-- DB:\s*(main|law|privileged)\s*$')

# Hops that migrations.sql deliberately omits because they cannot ride an ALTER
# TABLE: each is owned by a named in-temp function in rebuild.py. A hop served
# by neither a marker nor a carve-out is a hard fail.
CARVEOUTS = {
    (69, 70): ("upgrade_69_to_70", ("law", "main")),
    (74, 75): ("upgrade_74_to_75", ("main",)),
    (75, 76): ("upgrade_75_to_76", ("main",)),
}


class MigrateError(Exception):
    """Structured refusal. Everything the driver returns as {"ok": false}."""

    def __init__(self, code, message, details=None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.details = details or {}

    def as_dict(self):
        return {"code": self.code, "message": self.message, "details": self.details}


# --------------------------------------------------------------------------
# small helpers
# --------------------------------------------------------------------------

def _utc_now():
    return datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def _stamp_id():
    return datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')


def canonical(obj):
    return json.dumps(obj, sort_keys=True, separators=(',', ':'), ensure_ascii=True)


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, 'rb') as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def sha256_text(text):
    return hashlib.sha256(text.encode('utf-8')).hexdigest()


def _quote(ident):
    return '"%s"' % ident.replace('"', '""')


def _copy_fsync(src, dst):
    """copy2 then flush to disk, so a later rename cannot expose a torn file."""
    shutil.copy2(src, dst)
    with open(dst, 'rb+') as fh:
        os.fsync(fh.fileno())
    return dst


def read_user_version(path):
    """PRAGMA user_version on an already-staged copy; 0 is treated as legacy 62."""
    con = sqlite3.connect(path)
    try:
        uv = con.execute("PRAGMA user_version").fetchone()[0]
    finally:
        con.close()
    return LEGACY_USER_VERSION if uv == 0 else uv


def version_label(v):
    return "%d.%d" % (v // 10, v % 10)


# --------------------------------------------------------------------------
# staging
# --------------------------------------------------------------------------

def stage(sources, dstdir):
    """Copy the three binaries into dstdir and verify each copy byte-for-byte."""
    copies = {}
    for db in DBS:
        dst = os.path.join(dstdir, db + '.sqlite')
        shutil.copy2(sources[db], dst)
        if sha256_file(dst) != sha256_file(sources[db]):
            raise MigrateError(
                "migrate_refused",
                "Staged copy of %s.sqlite does not match its source; refusing to "
                "migrate a possibly truncated read." % db,
                {"db": db, "source": sources[db]})
        copies[db] = dst
    return copies


def read_versions(copies):
    versions = {db: read_user_version(copies[db]) for db in DBS}
    distinct = set(versions.values())
    if len(distinct) != 1:
        raise MigrateError(
            "version_stamps_disagree",
            "The three databases carry different schema stamps (%s). This is an "
            "interrupted or hand-edited state; migrate will not guess. Recover "
            "with matter_data__migrate mode 'restore', or repair in a local "
            "session with references/scripts/." % ", ".join(
                "%s=v%s" % (db, version_label(versions[db])) for db in DBS),
            {"versions": versions})
    return versions


def drop_all_views(copies):
    """Drop every view on all three databases before the chain runs.

    rebuild.py drops three views by name immediately before its carve-out; this
    drops all of them up front. SQLite re-parses every view during an
    ALTER TABLE ... RENAME, and marker 71 -> 72 does exactly that, so a view
    added later would otherwise break the chain silently.
    """
    dropped = []
    for db in DBS:
        con = sqlite3.connect(copies[db])
        try:
            names = [r[0] for r in con.execute(
                "SELECT name FROM sqlite_master WHERE type='view'")]
            for name in names:
                con.execute("DROP VIEW IF EXISTS %s" % _quote(name))
                dropped.append("%s.%s" % (db, name))
            con.commit()
        finally:
            con.close()
    return dropped


def stamp(copies, version):
    for db in DBS:
        con = sqlite3.connect(copies[db])
        try:
            con.execute("PRAGMA user_version = %d" % version)
        finally:
            con.close()


# --------------------------------------------------------------------------
# the chain
# --------------------------------------------------------------------------

def parse_migrations(text):
    """Return {(from, to): [(db, sql), ...]} in file order.

    Grouped by hop rather than assuming one marker per hop, so a future hop that
    touches two databases does not break the walk.
    """
    hops = {}
    current = None
    buf = []

    def flush():
        if current is not None:
            hops.setdefault((current[0], current[1]), []).append(
                (current[2], "\n".join(buf).strip()))

    for line in text.splitlines():
        m = MARKER_RE.match(line.strip())
        if m:
            flush()
            current = (int(m.group(1)), int(m.group(2)), m.group(3))
            buf = []
        elif current is not None:
            buf.append(line)
    flush()
    return hops


def build_chain(from_version, hops, target=TARGET):
    """One entry per one-version hop, each served by a marker or a carve-out."""
    chain = []
    v = from_version
    while v < target:
        nxt = v + 1
        key = (v, nxt)
        if key in CARVEOUTS:
            fn, dbs = CARVEOUTS[key]
            chain.append({"from": v, "to": nxt, "kind": "carveout",
                          "name": fn, "dbs": list(dbs)})
        elif key in hops:
            steps = hops[key]
            chain.append({"from": v, "to": nxt, "kind": "marker",
                          "dbs": [db for db, _ in steps],
                          "sql": [sql for _, sql in steps],
                          "sql_sha256": sha256_text(
                              "\n".join(sql for _, sql in steps))})
        else:
            raise MigrateError(
                "no_migration_path",
                "No migration step for v%s -> v%s: migrations.sql has no marker "
                "and rebuild.py owns no carve-out for that hop. Migrate fails "
                "closed rather than skipping it." % (version_label(v), version_label(nxt)),
                {"missing_hop": [v, nxt], "from_version": from_version,
                 "target": target})
        v = nxt
    return chain


def public_steps(chain):
    """The chain without SQL bodies — safe for the response and the token."""
    out = []
    for step in chain:
        entry = {"from": step["from"], "to": step["to"],
                 "kind": step["kind"], "dbs": step["dbs"]}
        if step["kind"] == "marker":
            entry["sql_sha256"] = step["sql_sha256"]
        else:
            entry["name"] = step["name"]
        out.append(entry)
    return out


def _apply_marker(path, sql):
    con = sqlite3.connect(path)
    try:
        con.execute("PRAGMA journal_mode = DELETE")
        con.execute("PRAGMA foreign_keys = ON")
        con.executescript(sql)
        con.commit()
    finally:
        con.close()


def run_chain(copies, chain):
    """Apply every hop ascending on temp copies, stamping after each."""
    applied = []
    for step in chain:
        if step["kind"] == "marker":
            for db, sql in zip(step["dbs"], step["sql"]):
                _apply_marker(copies[db], sql)
            fired = True
        else:
            # rebuild.upgrade_*(paths) are pure in-temp transforms over the
            # {main, law, privileged} path dict and return False when the shape
            # they target is already current.
            fired = bool(getattr(rebuild, step["name"])(copies))
        stamp(copies, step["to"])
        applied.append({"from": step["from"], "to": step["to"],
                        "kind": step["kind"], "dbs": step["dbs"],
                        "name": step.get("name"), "fired": fired})
    return applied


def finalize(copies, triggers_text, views_text):
    """Load the cross-database trigger layer and rebuild the views."""
    drop_all_views(copies)
    con = sqlite3.connect(copies['main'])
    try:
        con.execute("ATTACH DATABASE '%s' AS law" % copies['law'].replace("'", "''"))
        con.execute("ATTACH DATABASE '%s' AS privileged"
                    % copies['privileged'].replace("'", "''"))
        con.execute("PRAGMA journal_mode = DELETE")
        con.execute("PRAGMA foreign_keys = ON")
        con.executescript(triggers_text)
        trigger_count = con.execute(
            "SELECT count(*) FROM sqlite_temp_master WHERE type='trigger'").fetchone()[0]
        if trigger_count == 0:
            raise MigrateError(
                "migrate_refused",
                "The cross-database trigger layer failed to load; native files "
                "left untouched. Proceeding would allow orphaned cross-database "
                "references (matter-data CLAUDE.md #12).")
        con.executescript(views_text)
        view_count = con.execute(
            "SELECT count(*) FROM sqlite_master WHERE type='view'").fetchone()[0]
    finally:
        con.close()
    return trigger_count, view_count


def verify(copies):
    """Table-count floor and integrity are hard gates; FK violations only warn."""
    table_counts, integrity, fk_violations = {}, {}, {}
    for db in DBS:
        con = sqlite3.connect(copies[db])
        try:
            table_counts[db] = con.execute(
                "SELECT count(*) FROM sqlite_master WHERE type='table'").fetchone()[0]
            integrity[db] = con.execute("PRAGMA integrity_check").fetchone()[0]
            fk_violations[db] = len(con.execute("PRAGMA foreign_key_check").fetchall())
        finally:
            con.close()
        if table_counts[db] < rebuild.MIN_TABLES[db]:
            raise MigrateError(
                "migrate_refused",
                "%s has %d tables (< %d); native files left untouched."
                % (db, table_counts[db], rebuild.MIN_TABLES[db]),
                {"table_counts": table_counts})
        if integrity[db] != 'ok':
            raise MigrateError(
                "migrate_refused",
                "PRAGMA integrity_check on %s reported '%s'; native files left "
                "untouched." % (db, integrity[db]),
                {"db": db, "integrity_check": integrity[db]})
    return table_counts, integrity, fk_violations


def row_counts(copies):
    out = {}
    for db in DBS:
        con = sqlite3.connect(copies[db])
        try:
            names = [r[0] for r in con.execute(
                "SELECT name FROM sqlite_master WHERE type='table' "
                "AND name NOT LIKE 'sqlite_%' ORDER BY name")]
            out[db] = {n: con.execute(
                "SELECT count(*) FROM %s" % _quote(n)).fetchone()[0] for n in names}
        finally:
            con.close()
    return out


def build_dump_text(copies):
    """Same shape the matter-data backend writes after every execute."""
    lines = [DUMP_HEADER]
    for db in DBS:
        con = sqlite3.connect(copies[db])
        try:
            body = "\n".join(con.iterdump())
        finally:
            con.close()
        lines.append("-- ===== v6 BEGIN %s =====" % db)
        lines.append(body)
        lines.append("-- ===== v6 END %s =====" % db)
    return "\n".join(lines) + "\n"


def write_text_atomic(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8', newline='\n') as fh:
        fh.write(text)
        fh.flush()
        os.fsync(fh.fileno())
    os.replace(tmp, path)


# --------------------------------------------------------------------------
# plan token — content-addressed, stateless, no expiry
# --------------------------------------------------------------------------

def token_components(matter_root, case_data_dir, native_hashes, start_versions,
                     chain, ref_hashes):
    return {
        "fmt": "cdm1",
        "engine_version": MIGRATE_ENGINE_VERSION,
        "matter_root": os.path.normcase(matter_root),
        "case_data_dir": os.path.normcase(case_data_dir),
        "native_sha256": native_hashes,
        "start_versions": start_versions,
        "target": TARGET,
        "steps": public_steps(chain),
        "refs_sha256": ref_hashes,
    }


def compute_plan_token(components):
    digest = hashlib.sha256(canonical(components).encode('utf-8')).hexdigest()
    return "cdm1." + digest[:32]


def diff_components(expected, actual):
    """Name the first component that changed, so a mismatch is diagnosable."""
    for key in sorted(set(expected) | set(actual)):
        if expected.get(key) == actual.get(key):
            continue
        if key in ("native_sha256", "start_versions", "refs_sha256"):
            sub_expected, sub_actual = expected.get(key) or {}, actual.get(key) or {}
            for sub in sorted(set(sub_expected) | set(sub_actual)):
                if sub_expected.get(sub) != sub_actual.get(sub):
                    return "%s.%s" % (key, sub)
        return key
    return None


# --------------------------------------------------------------------------
# reference material and pointer resolution
# --------------------------------------------------------------------------

def read_refs():
    """The three reference files, via rebuild.read_ref (resolves ../ from its
    own __file__, so cwd is irrelevant)."""
    texts = {name: rebuild.read_ref(name) for name in REF_FILES}
    return texts, {name: sha256_text(texts[name]) for name in REF_FILES}


def rebuild_source_hash():
    """rebuild.py's own bytes: its upgrade_* functions are part of a plan's
    semantics, so an edit to one must invalidate an outstanding plan_token."""
    return sha256_file(os.path.abspath(rebuild.__file__))


def read_pointer_bytes(matter_root):
    """Raw pointer bytes BEFORE resolution rewrites them, for the backup."""
    candidate = resolve_paths.find_pointer(matter_root) or resolve_paths.find_pointer(
        os.path.join(matter_root, resolve_paths.LEGACY_ARTIFACTS_DIR))
    if candidate is None:
        return None
    with open(candidate, 'rb') as fh:
        return fh.read()


def resolve(matter_root):
    """Resolve the pointer WITHOUT the schema-version guard.

    THE ONE bypass call site in the repo. `migrate_only=True` is a literal here
    and is never derived from tool input — see the module docstring.

    Note this deliberately does not inherit the backend's `schema_version != 5`
    hard-fail: an out-of-date database plausibly has an out-of-date pointer, and
    refusing it would be the same catch-22 as the user_version guard. Step 5 of
    resolve_pointer normalizes the pointer to 5 as a side effect; that is
    reported back to the caller rather than hidden.
    """
    warnings = []
    try:
        resolved = resolve_paths.resolve_pointer(
            matter_root, migrate_only=True, warn=warnings.append)
    except SystemExit as exc:
        # SystemExit is a BaseException: `except Exception` would miss it and
        # the driver would see an opaque non-zero exit instead of a refusal.
        raise MigrateError("migrate_refused", str(exc), {"matter_root": matter_root})
    return resolved, warnings


def canonical_matter_root(resolved, matter_root):
    """resolve_pointer abspath()s the matter root; use its answer, not ours."""
    pointer_path = resolved.get('pointer_path')
    return os.path.dirname(pointer_path) if pointer_path else os.path.abspath(matter_root)


def natives_of(resolved):
    return {db: resolved['%s_sqlite' % db] for db in DBS}


def require_natives(natives):
    missing = [db for db in DBS if not os.path.exists(natives[db])]
    if missing:
        raise MigrateError(
            "migrate_refused",
            "Missing database file(s): %s. Migrate upgrades an existing set; a "
            "missing binary is what maintain's rebuild mode recovers from."
            % ", ".join("%s.sqlite" % db for db in missing),
            {"missing": missing})


# --------------------------------------------------------------------------
# backups
# --------------------------------------------------------------------------

def backups_root():
    override = os.environ.get(ENV_BACKUP_ROOT)
    if override:
        return override
    base = os.environ.get('LOCALAPPDATA') or os.path.expanduser('~')
    return os.path.join(base, 'Coclerk', 'case-backups')


def matter_identity(matter_root, resolved):
    mid, sn = resolve_paths.identity_from_metadata(resolved['main_sqlite'])
    if mid:
        return mid, resolve_paths.sanitize_short_name("%s %s" % (mid, sn)).strip()
    base = os.path.basename(os.path.normpath(matter_root))
    return None, resolve_paths.sanitize_short_name(base) or 'unknown-matter'


def matter_backup_dir(slug):
    return os.path.join(backups_root(), slug)


def inflight_path(slug, matter_root):
    """The in-flight marker is scoped to the canonical matter root, because two
    roots with the same stored identity (a scratch copy) share one backup
    folder (#1345)."""
    key = hashlib.sha256(os.path.normcase(matter_root).encode('utf-8')).hexdigest()
    return os.path.join(matter_backup_dir(slug), '.inflight-' + key[:16])


def _read_marker(marker):
    try:
        with open(marker, 'r', encoding='utf-8') as fh:
            return fh.read().strip() or None
    except OSError:
        return None


def inflight_marker(slug, matter_root):
    """The marker holding this root, as (path, backup_id, attributed), or None.

    A legacy unscoped '.inflight' is attributed through the matter_root in its
    named backup's manifest. One that cannot be attributed holds every root
    sharing the folder, and is never cleared automatically."""
    scoped = inflight_path(slug, matter_root)
    if os.path.exists(scoped):
        return scoped, _read_marker(scoped), True
    legacy = os.path.join(matter_backup_dir(slug), '.inflight')
    if not os.path.exists(legacy):
        return None
    backup_id = _read_marker(legacy)
    manifest = (read_manifest(os.path.join(matter_backup_dir(slug), backup_id))
                if backup_id else None)
    owner = (manifest or {}).get('matter_root')
    if not owner:
        return legacy, backup_id, False
    if os.path.normcase(owner) != os.path.normcase(matter_root):
        return None
    return legacy, backup_id, True


def guard_inflight(slug, matter_root):
    found = inflight_marker(slug, matter_root)
    if not found:
        return
    marker, backup_id, attributed = found
    details = {"backup_id": backup_id, "marker": marker, "attributed": attributed}
    if not attributed:
        raise MigrateError(
            "apply_interrupted",
            "An in-flight marker from an older engine (backup %s) cannot be traced "
            "to a matter root, so it may belong to this matter or to another copy "
            "sharing its backup folder. Find which root's apply was interrupted and "
            "recover it with mode 'restore' if its backup still exists, then delete "
            "%s by hand; restore never clears this marker."
            % (backup_id or "unknown", marker), details)
    raise MigrateError(
        "apply_interrupted",
        "A previous apply did not finish (backup %s). The databases may be in a "
        "mixed state. Recover with mode 'restore' before migrating again."
        % (backup_id or "unknown"), details)


def make_backup(slug, natives, resolved, pointer_bytes, meta):
    backup_id = "%s-%s" % (_stamp_id(), os.urandom(3).hex())
    target = os.path.join(matter_backup_dir(slug), backup_id)
    os.makedirs(target, exist_ok=False)

    files = {}
    for db in DBS:
        dst = _copy_fsync(natives[db], os.path.join(target, db + '.sqlite'))
        files[db + '.sqlite'] = {
            "sha256": sha256_file(dst),
            "bytes": os.path.getsize(dst),
            "user_version": read_user_version(dst),
        }
    if pointer_bytes is not None:
        with open(os.path.join(target, resolve_paths.POINTER_NAMES[0]), 'wb') as fh:
            fh.write(pointer_bytes)
    evidence_sql = resolved.get('evidence_sql')
    has_dump = bool(evidence_sql) and os.path.exists(evidence_sql)
    if has_dump:
        _copy_fsync(evidence_sql, os.path.join(target, 'evidence.sql'))

    manifest = dict(meta)
    manifest.update({
        "backup_format": BACKUP_FORMAT,
        "backup_id": backup_id,
        "created_at_utc": _utc_now(),
        "engine_version": MIGRATE_ENGINE_VERSION,
        "case_data_dir": resolved['case_data_dir'],
        "evidence_sql_path": evidence_sql,
        "has_evidence_sql": has_dump,
        "has_pointer": pointer_bytes is not None,
        "files": files,
        "outcome": "in_progress",
        "completed_at_utc": None,
        "post_files": None,
    })
    write_manifest(target, manifest)
    return backup_id, target, manifest


def manifest_path(backup_dir):
    return os.path.join(backup_dir, 'manifest.json')


def write_manifest(backup_dir, manifest):
    write_text_atomic(manifest_path(backup_dir), json.dumps(manifest, indent=2) + "\n")


def read_manifest(backup_dir):
    try:
        with open(manifest_path(backup_dir), 'r', encoding='utf-8') as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return None


def iter_backups(slug):
    root = matter_backup_dir(slug)
    if not os.path.isdir(root):
        return []
    out = []
    for name in sorted(os.listdir(root), reverse=True):
        path = os.path.join(root, name)
        if not os.path.isdir(path):
            continue
        manifest = read_manifest(path)
        if manifest:
            out.append((name, path, manifest))
    return out


def backup_files_of(backup_dir):
    return {db: os.path.join(backup_dir, db + '.sqlite') for db in DBS}


# --------------------------------------------------------------------------
# native replacement
# --------------------------------------------------------------------------

def atomic_replace_set(case_data_dir, incoming, rollback_sources, natives):
    """Stage finished binaries and rollback copies in a same-volume sidecar,
    flush both to disk, then replace the three natives by rename.

    os.replace is atomic only within a volume, and COCLERK_CASE_DATA_ROOT can
    point at another drive or a UNC path, so the sidecar is created INSIDE
    case_data_dir to guarantee same-volume renames by construction. The staging
    discipline is not violated: every connection is closed long before anything
    reaches the sidecar, so no live handle is ever held on synced storage.
    """
    sidecar = tempfile.mkdtemp(prefix='.coclerk_migrate_', dir=case_data_dir)
    try:
        rollback_dir = os.path.join(sidecar, 'rollback')
        os.makedirs(rollback_dir)
        staged, rollback = {}, {}
        for db in DBS:
            staged[db] = _copy_fsync(incoming[db], os.path.join(sidecar, db + '.sqlite'))
            rollback[db] = _copy_fsync(rollback_sources[db],
                                       os.path.join(rollback_dir, db + '.sqlite'))

        replaced = []
        try:
            for db in DBS:
                os.replace(staged[db], natives[db])
                replaced.append(db)
        except Exception as exc:
            for db in replaced:
                try:
                    os.replace(rollback[db], natives[db])
                except Exception as rollback_exc:
                    raise MigrateError(
                        "apply_interrupted",
                        "Replacing %s.sqlite failed (%s) AND the rollback of %s "
                        "failed (%s). The database set is mixed. Recover with "
                        "mode 'restore'." % (db, exc, db, rollback_exc),
                        {"failed_db": db, "replaced": replaced})
            raise MigrateError(
                "migrate_refused",
                "Replacing the native databases failed (%s); the previous set was "
                "rolled back and is intact." % exc,
                {"replaced": replaced})
    finally:
        shutil.rmtree(sidecar, ignore_errors=True)


# --------------------------------------------------------------------------
# modes
# --------------------------------------------------------------------------

def _dry_run(copies, chain, texts):
    before = row_counts(copies)
    drop_all_views(copies)
    applied = run_chain(copies, chain)
    stamp(copies, TARGET)
    trigger_count, view_count = finalize(
        copies, texts['triggers.sql'],
        rebuild.views_from_queries(texts['queries.sql']))
    table_counts, integrity, fk_violations = verify(copies)
    dump_text = build_dump_text(copies)
    return applied, {
        "ok": True,
        "triggers_loaded": trigger_count,
        "views_created": view_count,
        "table_counts": table_counts,
        "integrity_check": integrity,
        "foreign_key_violations": fk_violations,
        "row_counts_before": before,
        "row_counts_after": row_counts(copies),
        "dump_bytes": len(dump_text.encode('utf-8')),
        "dump_header": DUMP_HEADER,
    }, dump_text


def _prepare(matter_root):
    """Everything plan and apply both need, in the same order, from scratch."""
    pointer_bytes = read_pointer_bytes(matter_root)
    resolved, warnings = resolve(matter_root)
    natives = natives_of(resolved)
    require_natives(natives)
    matter_id, slug = matter_identity(matter_root, resolved)
    guard_inflight(slug, canonical_matter_root(resolved, matter_root))

    native_hashes = {db: sha256_file(natives[db]) for db in DBS}
    texts, ref_hashes = read_refs()
    ref_hashes = dict(ref_hashes)
    ref_hashes['rebuild.py'] = rebuild_source_hash()
    return {
        "pointer_bytes": pointer_bytes,
        "resolved": resolved,
        "warnings": warnings,
        "natives": natives,
        "matter_id": matter_id,
        "slug": slug,
        "native_hashes": native_hashes,
        "texts": texts,
        "ref_hashes": ref_hashes,
    }


def _chain_for(ctx, copies):
    versions = read_versions(copies)
    from_version = versions['main']
    if from_version > TARGET:
        raise MigrateError(
            "migrate_refused",
            "The databases are at v%s, newer than this engine's target v%s. "
            "Migrate never downgrades." % (version_label(from_version),
                                           version_label(TARGET)),
            {"versions": versions})
    chain = build_chain(from_version, parse_migrations(ctx['texts']['migrations.sql']))
    return versions, from_version, chain


def _confirmation_for(matter_id, from_version):
    return "MIGRATE %s v%s -> v%s" % (matter_id or "matter",
                                      version_label(from_version),
                                      version_label(TARGET))


def plan(matter_root):
    ctx = _prepare(matter_root)
    tmpdir = tempfile.mkdtemp(prefix=resolve_paths.staging_prefix('migrate_plan'))
    try:
        copies = stage(ctx['natives'], tmpdir)
        versions = read_versions(copies)
        from_version = versions['main']
        canonical_root = canonical_matter_root(ctx['resolved'], matter_root)
        base = {
            "mode": "plan",
            "matter_root": canonical_root,
            "case_data_dir": ctx['resolved']['case_data_dir'],
            "matter_id": ctx['matter_id'],
            "from_user_version": from_version,
            "from_version": version_label(from_version),
            "target_user_version": TARGET,
            "target_version": version_label(TARGET),
            "backups_root": matter_backup_dir(ctx['slug']),
            "warnings": list(ctx['warnings']),
            "generated_at_utc": _utc_now(),
        }
        if from_version == TARGET:
            base.update({"ok": True, "already_current": True, "steps": [],
                         "plan_token": None})
            return base

        versions, from_version, chain = _chain_for(ctx, copies)
        applied, dry_run, _ = _dry_run(copies, chain, ctx['texts'])
        components = token_components(
            matter_root=canonical_root,
            case_data_dir=ctx['resolved']['case_data_dir'],
            native_hashes=ctx['native_hashes'], start_versions=versions,
            chain=chain, ref_hashes=ctx['ref_hashes'])
        base.update({
            "ok": True,
            "already_current": False,
            "steps": applied,
            "dry_run": dry_run,
            "native_sha256": ctx['native_hashes'],
            "plan_token": compute_plan_token(components),
            "user_confirmation_required": _confirmation_for(ctx['matter_id'], from_version),
        })
        return base
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


def apply(matter_root, plan_token, user_confirmation):
    if not plan_token:
        raise MigrateError(
            "plan_token_mismatch",
            "apply requires a plan_token. Run mode 'plan' first, show the plan to "
            "the practitioner, and pass back the token it returned.")
    if not user_confirmation:
        raise MigrateError(
            "confirmation_mismatch",
            "apply requires user_confirmation — the exact string the plan returned "
            "as user_confirmation_required, echoed after the practitioner approves.")

    started = datetime.datetime.now(datetime.timezone.utc)
    ctx = _prepare(matter_root)
    resolved = ctx['resolved']
    natives = ctx['natives']
    canonical_root = canonical_matter_root(resolved, matter_root)

    tmpdir = tempfile.mkdtemp(prefix=resolve_paths.staging_prefix('migrate_apply'))
    backup_dir = None
    manifest = None
    marker = inflight_path(ctx['slug'], canonical_root)
    try:
        probe = tempfile.mkdtemp(prefix='coclerk_migrate_probe_', dir=tmpdir)
        versions, from_version, chain = _chain_for(ctx, stage(natives, probe))
        shutil.rmtree(probe, ignore_errors=True)

        if from_version == TARGET:
            raise MigrateError(
                "migrate_refused",
                "The databases are already at v%s; nothing to migrate."
                % version_label(TARGET), {"versions": versions})

        components = token_components(
            matter_root=canonical_root, case_data_dir=resolved['case_data_dir'],
            native_hashes=ctx['native_hashes'], start_versions=versions,
            chain=chain, ref_hashes=ctx['ref_hashes'])
        recomputed = compute_plan_token(components)
        if not hmac.compare_digest(recomputed, plan_token):
            raise MigrateError(
                "plan_token_mismatch",
                "The plan is stale — something changed since it was produced. "
                "Re-run mode 'plan' and get fresh approval.",
                {"volatile_inputs": _explain_token_mismatch(components),
                 "supplied": plan_token, "expected": recomputed})

        expected_confirmation = _confirmation_for(ctx['matter_id'], from_version)
        if (user_confirmation or "").strip() != expected_confirmation:
            raise MigrateError(
                "confirmation_mismatch",
                "user_confirmation does not match. Expected exactly: %s"
                % expected_confirmation,
                {"expected": expected_confirmation})

        # Backup first, then work from the backup copies so the staged set is
        # provably identical to what a restore would put back.
        backup_id, backup_dir, manifest = make_backup(
            ctx['slug'], natives, resolved, ctx['pointer_bytes'],
            {"tool": "matter_data__migrate", "matter_root": canonical_root,
             "matter_id": ctx['matter_id'], "from_version": from_version,
             "target_version": TARGET, "steps": public_steps(chain),
             "plan_token": plan_token})

        backups = backup_files_of(backup_dir)
        copies = stage(backups, tmpdir)
        applied, dry_run, dump_text = _dry_run(copies, chain, ctx['texts'])

        with open(marker, 'w', encoding='utf-8') as fh:
            fh.write(backup_id)
        try:
            atomic_replace_set(resolved['case_data_dir'], copies, backups, natives)
        except MigrateError as exc:
            manifest['outcome'] = ("failed" if exc.code == "migrate_refused"
                                   else "in_progress")
            write_manifest(backup_dir, manifest)
            if exc.code == "migrate_refused":
                os.remove(marker)
            raise

        dump_written = True
        dump_error = None
        try:
            write_text_atomic(resolved['evidence_sql'], dump_text)
        except OSError as exc:
            # The binaries are correctly at the target. Rolling a successful
            # migration back because a text file would not write would be worse
            # than a stale dump, which maintain's dump mode regenerates.
            dump_written = False
            dump_error = str(exc)

        post_files = {db + '.sqlite': {"sha256": sha256_file(natives[db]),
                                       "bytes": os.path.getsize(natives[db]),
                                       "user_version": read_user_version(natives[db])}
                      for db in DBS}
        manifest.update({"outcome": "applied", "completed_at_utc": _utc_now(),
                         "post_files": post_files})
        write_manifest(backup_dir, manifest)
        os.remove(marker)

        elapsed = datetime.datetime.now(datetime.timezone.utc) - started
        result = {
            "mode": "apply", "ok": True, "applied": True,
            "matter_root": canonical_root,
            "case_data_dir": resolved['case_data_dir'],
            "matter_id": ctx['matter_id'],
            "from_version": version_label(from_version),
            "target_version": version_label(TARGET),
            "steps": applied, "dry_run": dry_run,
            "backup_id": backup_id, "backup_dir": backup_dir,
            "post_user_version": {db: post_files[db + '.sqlite']["user_version"]
                                  for db in DBS},
            "post_sha256": {db: post_files[db + '.sqlite']["sha256"] for db in DBS},
            "evidence_sql": resolved['evidence_sql'],
            "evidence_sql_written": dump_written,
            "duration_ms": int(elapsed.total_seconds() * 1000),
            "warnings": list(ctx['warnings']),
        }
        if not dump_written:
            result["warnings"].append(
                "binaries_at_79_dump_stale: the databases are at v%s but "
                "evidence.sql could not be rewritten (%s). Run maintain in dump "
                "mode." % (version_label(TARGET), dump_error))
        return result
    except MigrateError:
        if backup_dir and manifest and manifest.get('outcome') == 'in_progress' \
                and not os.path.exists(marker):
            manifest['outcome'] = 'failed'
            write_manifest(backup_dir, manifest)
        raise
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


def _explain_token_mismatch(components):
    """Best-effort: name the component most likely to have moved.

    The supplied token is a digest, so the changed field cannot be recovered
    from it directly. Report which inputs are volatile so the caller knows where
    to look, with the databases named first — that is the common case.
    """
    return {
        "candidates": ["native_sha256 (another session wrote to this matter)",
                       "refs_sha256 (migrations.sql/triggers.sql/queries.sql/"
                       "rebuild.py changed)",
                       "start_versions", "engine_version"],
        "current": {"native_sha256": components["native_sha256"],
                    "start_versions": components["start_versions"],
                    "refs_sha256": components["refs_sha256"],
                    "engine_version": components["engine_version"]},
    }


def restore(matter_root, backup_id, user_confirmation):
    pointer_bytes = read_pointer_bytes(matter_root)
    resolved, warnings = resolve(matter_root)
    natives = natives_of(resolved)
    matter_id, slug = matter_identity(matter_root, resolved)
    canonical_root = canonical_matter_root(resolved, matter_root)

    candidates = [(bid, path, m) for bid, path, m in iter_backups(slug)
                  if os.path.normcase(m.get('matter_root', '')) ==
                  os.path.normcase(canonical_root)]
    if backup_id:
        chosen = [c for c in candidates if c[0] == backup_id]
    else:
        chosen = [c for c in candidates if c[2].get('outcome') != 'pre_restore']
    if not chosen:
        raise MigrateError(
            "backup_not_found",
            "No backup set %s for this matter. Call mode 'backups' to list them."
            % (backup_id or "(most recent)"),
            {"available": [c[0] for c in candidates]})
    backup_id, backup_dir, manifest = chosen[0]

    expected_confirmation = "RESTORE %s" % backup_id
    if (user_confirmation or "").strip() != expected_confirmation:
        raise MigrateError(
            "confirmation_mismatch",
            "user_confirmation does not match. Expected exactly: %s"
            % expected_confirmation, {"expected": expected_confirmation})

    # Verify the whole set before writing anything: a corrupted backup must
    # never be laid over a live matter.
    sources = backup_files_of(backup_dir)
    for db in DBS:
        path = sources[db]
        recorded = (manifest.get('files') or {}).get(db + '.sqlite') or {}
        if not os.path.exists(path):
            raise MigrateError("backup_corrupt",
                               "Backup %s is missing %s.sqlite." % (backup_id, db),
                               {"backup_id": backup_id})
        actual = sha256_file(path)
        if recorded.get('sha256') and actual != recorded['sha256']:
            raise MigrateError(
                "backup_corrupt",
                "Backup %s: %s.sqlite does not match its recorded hash; refusing "
                "to restore it." % (backup_id, db),
                {"backup_id": backup_id, "db": db,
                 "recorded": recorded.get('sha256'), "actual": actual})

    require_natives(natives)
    safety_id, safety_dir, safety_manifest = make_backup(
        slug, natives, resolved, pointer_bytes,
        {"tool": "matter_data__migrate", "matter_root": canonical_root,
         "matter_id": matter_id, "from_version": None, "target_version": None,
         "steps": [], "plan_token": None, "restoring": backup_id})
    safety_manifest['outcome'] = 'pre_restore'
    safety_manifest['completed_at_utc'] = _utc_now()
    write_manifest(safety_dir, safety_manifest)

    atomic_replace_set(resolved['case_data_dir'], sources,
                       backup_files_of(safety_dir), natives)

    pointer_restored = False
    saved_pointer = resolve_paths.find_pointer(backup_dir)
    if saved_pointer and resolved.get('pointer_path'):
        with open(saved_pointer, 'rb') as fh:
            raw = fh.read()
        for path in resolve_paths.pointer_paths(os.path.dirname(resolved['pointer_path'])):
            write_text_atomic(path, raw.decode('utf-8'))
        pointer_restored = True

    dump_restored = False
    saved_dump = os.path.join(backup_dir, 'evidence.sql')
    if os.path.exists(saved_dump) and resolved.get('evidence_sql'):
        with open(saved_dump, 'r', encoding='utf-8') as fh:
            write_text_atomic(resolved['evidence_sql'], fh.read())
        dump_restored = True

    manifest['outcome'] = 'rolled_back'
    write_manifest(backup_dir, manifest)
    found = inflight_marker(slug, canonical_root)
    if found and found[2]:
        os.remove(found[0])

    return {
        "mode": "restore", "ok": True,
        "matter_root": canonical_root,
        "restored_from": backup_id,
        "files_restored": ["%s.sqlite" % db for db in DBS],
        "pointer_restored": pointer_restored,
        "evidence_sql_restored": dump_restored,
        "safety_backup_id": safety_id,
        "post_user_version": {db: read_user_version(natives[db]) for db in DBS},
        "warnings": warnings,
    }


def list_backups(matter_root):
    resolved, _ = resolve(matter_root)
    matter_id, slug = matter_identity(matter_root, resolved)
    canonical_root = canonical_matter_root(resolved, matter_root)
    rows = []
    for backup_id, path, manifest in iter_backups(slug):
        if os.path.normcase(manifest.get('matter_root', '')) != \
                os.path.normcase(canonical_root):
            continue
        files = manifest.get('files') or {}
        rows.append({
            "backup_id": backup_id,
            "created_at_utc": manifest.get('created_at_utc'),
            "from_version": (version_label(manifest['from_version'])
                             if manifest.get('from_version') else None),
            "target_version": (version_label(manifest['target_version'])
                               if manifest.get('target_version') else None),
            "outcome": manifest.get('outcome'),
            "total_bytes": sum(f.get('bytes', 0) for f in files.values()),
            "path": path,
        })
    return {"mode": "backups", "ok": True, "matter_root": canonical_root,
            "matter_id": matter_id,
            "backups_root": matter_backup_dir(slug),
            "inflight": inflight_marker(slug, canonical_root) is not None,
            "backups": rows}


# --------------------------------------------------------------------------
# entry point
# --------------------------------------------------------------------------

MODES = {
    "plan": lambda a: plan(a["matter_root"]),
    "apply": lambda a: apply(a["matter_root"], a.get("plan_token"),
                             a.get("user_confirmation")),
    "restore": lambda a: restore(a["matter_root"], a.get("backup_id"),
                                 a.get("user_confirmation")),
    "backups": lambda a: list_backups(a["matter_root"]),
}


def run(request):
    mode = request.get("mode")
    if mode not in MODES:
        raise MigrateError("migrate_refused",
                           "unknown mode %r; expected one of %s"
                           % (mode, ", ".join(sorted(MODES))))
    if not request.get("matter_root"):
        raise MigrateError("migrate_refused", "matter_root is required")
    try:
        return MODES[mode](request)
    except SystemExit as exc:
        raise MigrateError("migrate_refused", str(exc))
