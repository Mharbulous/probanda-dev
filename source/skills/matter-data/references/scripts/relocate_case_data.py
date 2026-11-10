"""relocate_case_data.py — move a matter's case data into the matter folder (MODULE).

Backs the `matter_data__relocate` MCP tool (ADR 0013). A matter not yet
relocated keeps its databases, evidence.sql and subfolders under the firm-level
'0. CASE DATA\\<matter_id> <short_name>\\'. This copies that whole folder to
MATTER_ROOT\\0. CASE DATA\\ and re-points the matter's pointer at it.

Two modes:

  plan  — list the files, their sizes and the target; write nothing
  apply — copy aside both pointer files, copy the folder into a staging folder
          inside the matter, verify every copy, then rename the staging folder
          to '0. CASE DATA' and rewrite both pointer files atomically

It deletes nothing. The old folder is left in place for the practitioner to
delete. On any failure no pointer changes, and the staging folder stays and is
named in the error. The one exception is a pointer write that still fails after
write_text_atomic's retry, once the copy is in place: that raises
relocate_incomplete, naming which pointer files were rewritten. Only Probanda's own pointer is written, so this is not a
file-manager operation (Commandment 7).

HOST-SIDE ONLY, like every module in this directory: the SQLite checks run on
temp copies, never on the binaries in place. See ../scripts.md.

Standard library only.
"""

import json
import os
import shutil
import sqlite3
import tempfile

import migrate_engine
import resolve_paths
from migrate_engine import MigrateError

STAGING_PREFIX = '.probanda_relocate_'
TRIPLE = ('main', 'law', 'privileged')


def _refuse(message, details=None):
    raise MigrateError("relocate_refused", message, details or {})


def _locate(matter_root):
    """(matter_root, pointer, old_folder, target) without writing anything."""
    matter_root = os.path.abspath(matter_root)
    pointer_path = resolve_paths.find_pointer(matter_root)
    if pointer_path is None:
        _refuse("No probanda.json at the matter root. Run any /matter-data operation on this "
                "matter first, so its pointer is initialized or moved out of '9. AI'.",
                {"matter_root": matter_root})
    with open(pointer_path, 'rb') as fh:
        pointer = json.loads(fh.read().replace(b'\x00', b'').decode('utf-8'))
    if pointer.get('schema_version') != resolve_paths.EXPECTED_SCHEMA_VERSION:
        _refuse("The pointer is schema_version %r, expected %d. Run any /matter-data operation "
                "on this matter first." % (pointer.get('schema_version'),
                                           resolve_paths.EXPECTED_SCHEMA_VERSION))
    old, _ = resolve_paths.resolve_case_data_dir(
        matter_root, pointer.get('case_data_dir'), resolve_paths.case_data_root(matter_root),
        resolve_paths.norm_join(matter_root, resolve_paths.LEGACY_ARTIFACTS_DIR))
    target = resolve_paths.matter_case_data_dir(matter_root)
    if os.path.normcase(old) == os.path.normcase(target):
        _refuse("This matter's case data is already in the matter folder: %s" % target,
                {"case_data_dir": target})
    if not os.path.isfile(os.path.join(old, 'main.sqlite')):
        _refuse("The current matter-data folder has no main.sqlite: %s" % old,
                {"case_data_dir": old})
    if os.path.isdir(target) and os.listdir(target):
        _refuse("%s already exists and is not empty. Nothing was copied." % target,
                {"target": target})
    if os.path.exists(target) and not os.path.isdir(target):
        _refuse("%s exists and is not a folder. Nothing was copied." % target,
                {"target": target})
    return matter_root, pointer, old, target


def _inventory(folder):
    """Every file under folder (relative path, size) and every subfolder, sorted."""
    files, dirs = [], []
    for here, subdirs, names in os.walk(folder):
        subdirs.sort()
        rel_here = os.path.relpath(here, folder)
        for d in subdirs:
            dirs.append(os.path.normpath(os.path.join(rel_here, d)))
        for name in sorted(names):
            rel = os.path.normpath(os.path.join(rel_here, name))
            files.append((rel, os.path.getsize(os.path.join(folder, rel))))
    return files, dirs


def _sqlite_facts(path):
    """integrity_check, per-table row counts and user_version, read on a temp copy."""
    tmp = tempfile.mkdtemp(prefix=resolve_paths.staging_prefix('relocate'))
    try:
        probe = os.path.join(tmp, 'probe.sqlite')
        shutil.copy2(path, probe)
        con = sqlite3.connect(probe)
        try:
            integrity = con.execute("PRAGMA integrity_check").fetchone()[0]
            user_version = con.execute("PRAGMA user_version").fetchone()[0]
            names = [r[0] for r in con.execute(
                "SELECT name FROM sqlite_master WHERE type='table' "
                "AND name NOT LIKE 'sqlite_%' ORDER BY name")]
            counts = {n: con.execute('SELECT count(*) FROM "%s"' % n.replace('"', '""'))
                      .fetchone()[0] for n in names}
        finally:
            con.close()
        return {"integrity_check": integrity, "user_version": user_version, "row_counts": counts}
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def _verify(old, staging, files):
    """Raise MigrateError naming the first check that fails."""
    for rel, _ in files:
        if migrate_engine.sha256_file(os.path.join(old, rel)) != \
                migrate_engine.sha256_file(os.path.join(staging, rel)):
            _refuse("sha256 of the copy of %s differs from its source." % rel,
                    {"check": "sha256", "file": rel})
    for rel, _ in files:
        if not rel.lower().endswith('.sqlite'):
            continue
        source, copy = _sqlite_facts(os.path.join(old, rel)), _sqlite_facts(os.path.join(staging, rel))
        if copy["integrity_check"] != 'ok':
            _refuse("integrity_check on the copy of %s reported %r." % (rel, copy["integrity_check"]),
                    {"check": "integrity_check", "file": rel})
        for key in ("integrity_check", "user_version", "row_counts"):
            if source[key] != copy[key]:
                _refuse("%s of the copy of %s differs from its source." % (key, rel),
                        {"check": key, "file": rel})
    if all(os.path.isfile(os.path.join(staging, db + '.sqlite')) for db in TRIPLE):
        tmp = tempfile.mkdtemp(prefix=resolve_paths.staging_prefix('relocate'))
        try:
            copies = {db: shutil.copy2(os.path.join(staging, db + '.sqlite'),
                                       os.path.join(tmp, db + '.sqlite')) for db in TRIPLE}
            migrate_engine.verify(copies)
        finally:
            shutil.rmtree(tmp, ignore_errors=True)


def plan(matter_root):
    matter_root, _, old, target = _locate(matter_root)
    files, _ = _inventory(old)
    return {
        "mode": "plan",
        "old_folder": old,
        "target": target,
        "files": [{"path": rel, "size": size} for rel, size in files],
        "total_bytes": sum(size for _, size in files),
    }


def apply(matter_root):
    matter_root, pointer, old, target = _locate(matter_root)
    files, dirs = _inventory(old)
    ts = migrate_engine._stamp_id()

    pointer_files = [p for p in resolve_paths.pointer_paths(matter_root) if os.path.exists(p)]
    backups = []
    for p in pointer_files:
        backup = '%s.bak-%s' % (p, ts)
        migrate_engine._copy_fsync(p, backup)
        backups.append(backup)

    staging = os.path.join(matter_root, STAGING_PREFIX + ts)
    try:
        os.makedirs(staging)
        for rel in dirs:
            os.makedirs(os.path.join(staging, rel), exist_ok=True)
        for rel, _ in files:
            migrate_engine._copy_fsync(os.path.join(old, rel), os.path.join(staging, rel))
        _verify(old, staging, files)
    except MigrateError as exc:
        exc.message += " The pointer was not changed and nothing was deleted. The staging " \
                       "folder %s was left in place." % staging
        exc.details["staging"] = staging
        raise
    except Exception as exc:
        raise MigrateError(
            "relocate_refused",
            "Copying to %s failed (%s: %s). The pointer was not changed and nothing was "
            "deleted. The staging folder was left in place." % (staging, type(exc).__name__, exc),
            {"check": "copy", "staging": staging})

    try:
        if os.path.isdir(target):
            # An empty folder already there (checked in _locate) may not be Probanda's, so it is
            # kept: the staged entries move into it, then the staging folder, now empty, goes.
            for name in sorted(os.listdir(staging)):
                os.rename(os.path.join(staging, name), os.path.join(target, name))
            os.rmdir(staging)
        else:
            os.rename(staging, target)
    except OSError as exc:
        raise MigrateError(
            "relocate_refused",
            "Every copy verified, but moving %s to %s failed (%s). The pointer was not "
            "changed and nothing was deleted. Check both folders before a retry." % (staging, target, exc),
            {"check": "rename", "staging": staging})

    case_data_dir = resolve_paths.pointer_case_data_dir(matter_root, target)
    normalized = {
        'schema_version': resolve_paths.EXPECTED_SCHEMA_VERSION,
        'matter_root': pointer.get('matter_root') or matter_root,
        'case_data_dir': case_data_dir,
        'evidence_sql_path': resolve_paths.default_evidence_sql(matter_root, target),
    }
    text = json.dumps(normalized, indent=2)
    paths = resolve_paths.pointer_paths(matter_root)
    written = []
    try:
        for p in paths:
            migrate_engine.write_text_atomic(p, text)
            written.append(p)
    except OSError as exc:
        failed = paths[len(written)]
        rest = paths[len(written):]
        leftover = failed + '.tmp' if os.path.exists(failed + '.tmp') else None
        fix = ("Once the file is released, replace %s with %s, which holds the new pointer."
               % (failed, leftover) if leftover else
               "Write the new pointer below into each file not rewritten: %s" % text)
        raise MigrateError(
            "relocate_incomplete",
            "Every copy verified and is in place at %s, but writing the pointer file %s failed "
            "(%s: %s). Rewritten: %s. Not rewritten: %s. A rerun will refuse, because the new "
            "folder is no longer empty. %s Nothing was deleted." % (
                target, failed, type(exc).__name__, exc, ', '.join(written) or 'none',
                ', '.join(rest), fix),
            {"target": target, "rewritten": written, "not_rewritten": rest,
             "leftover_tmp": leftover, "pointer_backups": backups,
             "exception": "%s: %s" % (type(exc).__name__, exc)})

    return {
        "mode": "apply",
        "case_data_dir": target,
        "old_folder": old,
        "files_copied": len(files),
        "pointer_backups": backups,
        "message": (
            "Case data copied to %s and verified, and the pointer now names it. The old folder "
            "%s was left in place for the practitioner to delete once satisfied. Reopen any "
            "drafting session on this matter, and re-plan any migration of its databases: an "
            "outstanding plan token named the old path." % (target, old)),
    }


MODES = {"plan": plan, "apply": apply}


def run(request):
    mode = request.get("mode")
    if mode not in MODES:
        _refuse("unknown mode %r; expected plan or apply" % (mode,))
    if not request.get("matter_root"):
        _refuse("matter_root is required")
    try:
        return MODES[mode](request["matter_root"])
    except SystemExit as exc:
        raise MigrateError("relocate_refused", str(exc))
