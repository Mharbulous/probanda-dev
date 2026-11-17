"""Compare, then merge, the two copies a sync conflict split a matter's drafting records into
(references/sync-split.md; drafting_data__split_merge runs this through its Python driver).

One JSON request on stdin, one JSON result on stdout. Standard library only.

request = {"op": "diff", "inputs": [path_a, path_b]}
        | {"op": "merge", "inputs": [path_a, path_b], "sha256": [hex_a, hex_b],
           "decisions": {"<difference id>": "a" | "b"}, "out": path}

diff -> {"inputs": [{"path", "sha256"}], "schema_version", "differences": [...], "resolved": [...]}
  Each difference is one record, by table and primary key (or the whole row, for a table with
  none): {"id", "table", "key", "kind": "only_a" | "only_b" | "differ", "columns", "a", "b"}.
  "a" and "b" hold that record's values in each copy (only the columns that differ, for
  "differ"), or null where the copy has no such record. There is no common ancestor, so a record
  in one copy only may be one copy's addition or the other's deletion: nothing is merged without
  a decision. The one exception, listed in "resolved", is the revision counter, which takes the
  higher value.

merge -> {"out", "applied": n}
  Every difference needs a decision: "a" or "b" takes that copy's version of the record, its
  absence included. Both inputs are opened immutable and must still hash as the diff reported.
  The merged file is built from a copy of input a in a temporary folder, with every trigger
  dropped while the decisions are applied and restored after, and is copied to "out" only once it
  passes SQLite's integrity check and adds no foreign key fault that neither input had. The same
  request gives the same file, and the inputs are never written.

A refusal returns {"refused": code, "message"}.
"""
import hashlib
import json
import os
import shutil
import sqlite3
import sys
import tempfile

from migrate_engine import sqlite_too_old


class Refused(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def open_ro(path):
    # immutable: no lock, no journal, no write of any kind to a synced copy.
    uri = "file:" + path.replace("\\", "/").replace("?", "%3f").replace("#", "%23") + "?mode=ro&immutable=1"
    return sqlite3.connect(uri, uri=True)


def shown(value):
    if isinstance(value, bytes):
        return {"blob_bytes": len(value), "blob_sha256": hashlib.sha256(value).hexdigest()}
    return value


def tables(con):
    return {name: sql for name, sql in con.execute(
        "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")}


def pk_columns(con, table):
    info = con.execute(f'PRAGMA table_info("{table}")').fetchall()
    return [row[1] for row in sorted((r for r in info if r[5] > 0), key=lambda r: r[5])], [row[1] for row in info]


def records(con, table, pk, cols):
    out = {}
    for row in con.execute(f'SELECT {", ".join(f"[{c}]" for c in cols)} FROM "{table}"'):
        values = dict(zip(cols, row))
        key = tuple(values[c] for c in pk) if pk else row
        out[key] = values
    return out


def sort_key(key):
    return json.dumps([shown(v) for v in key], default=str)


def schema_version(con):
    row = con.execute("SELECT value FROM db_meta WHERE key = 'schema_version'").fetchone()
    return None if row is None else row[0]


def compare(a, b):
    ta, tb = tables(a), tables(b)
    if ta != tb or schema_version(a) != schema_version(b):
        raise Refused("split_schema_differs", "The two copies are not on the same schema, so they cannot be compared record by record. Nothing was written.")
    differences, resolved = [], []
    for table in sorted(ta):
        pk, cols = pk_columns(a, table)
        ra, rb = records(a, table, pk, cols), records(b, table, pk, cols)
        for key in sorted(set(ra) | set(rb), key=sort_key):
            va, vb = ra.get(key), rb.get(key)
            if va == vb:
                continue
            if table == "db_meta" and key == ("revision",) and va and vb:
                resolved.append({"table": table, "key": {"key": "revision"}, "took": "the higher value"})
                continue
            kind = "only_a" if vb is None else "only_b" if va is None else "differ"
            changed = [c for c in cols if va and vb and va[c] != vb[c]] if kind == "differ" else cols
            differences.append({
                "id": len(differences) + 1,
                "table": table,
                "key": {c: shown(v) for c, v in zip(pk, key)} if pk else None,
                "kind": kind,
                "columns": changed,
                "a": None if va is None else {c: shown(va[c]) for c in changed},
                "b": None if vb is None else {c: shown(vb[c]) for c in changed},
                "_pk": pk, "_key": key, "_cols": cols,
            })
    return differences, resolved


def public(differences):
    return [{k: v for k, v in d.items() if not k.startswith("_")} for d in differences]


def fk_faults(con):
    return {tuple(r) for r in con.execute("PRAGMA foreign_key_check")}


def diff(req):
    paths = req["inputs"]
    a, b = open_ro(paths[0]), open_ro(paths[1])
    try:
        differences, resolved = compare(a, b)
        version = schema_version(a)
    finally:
        a.close()
        b.close()
    return {
        "inputs": [{"path": p, "sha256": sha256(p)} for p in paths],
        "schema_version": version,
        "differences": public(differences),
        "resolved": resolved,
    }


def apply(con, b, differences, decisions):
    applied = 0
    for d in differences:
        if decisions[str(d["id"])] == "a":
            continue
        table, pk, key, cols = d["table"], d["_pk"], d["_key"], d["_cols"]
        where_cols = pk or cols
        where = " AND ".join(f"[{c}] IS ?" for c in where_cols)
        con.execute(f'DELETE FROM "{table}" WHERE {where}', list(key))
        if d["kind"] != "only_a":
            row = b.execute(f'SELECT {", ".join(f"[{c}]" for c in cols)} FROM "{table}" WHERE {where}', list(key)).fetchone()
            con.execute(f'INSERT INTO "{table}" ({", ".join(f"[{c}]" for c in cols)}) VALUES ({", ".join("?" for _ in cols)})', row)
        applied += 1
    revisions = [int(c.execute("SELECT value FROM db_meta WHERE key = 'revision'").fetchone()[0]) for c in (con, b)]
    con.execute("UPDATE db_meta SET value = ? WHERE key = 'revision'", (str(max(revisions)),))
    return applied


def merge(req):
    paths, out = req["inputs"], req["out"]
    if [sha256(p) for p in paths] != req["sha256"]:
        raise Refused("split_inputs_changed", "A copy changed since it was compared. Nothing was written: compare them again.")
    a, b = open_ro(paths[0]), open_ro(paths[1])
    try:
        differences, _ = compare(a, b)
        decisions = {str(k): v for k, v in (req.get("decisions") or {}).items()}
        ids = {str(d["id"]) for d in differences}
        undecided = sorted((i for i in ids if decisions.get(i) not in ("a", "b")), key=int)
        unknown = sorted(set(decisions) - ids)
        if undecided or unknown:
            raise Refused("split_undecided", f"Every difference needs a decision, a or b. Undecided: {', '.join(undecided) or 'none'}. Not a difference: {', '.join(unknown) or 'none'}. Nothing was written.")
        before = fk_faults(a) | fk_faults(b)
        with tempfile.TemporaryDirectory(prefix="coclerk_submission_split_") as tmp:
            staged = os.path.join(tmp, "merged.sqlite")
            shutil.copyfile(paths[0], staged)
            con = sqlite3.connect(staged, isolation_level=None)
            try:
                con.execute("PRAGMA journal_mode = DELETE")
                triggers = [sql for (sql,) in con.execute("SELECT sql FROM sqlite_master WHERE type = 'trigger' ORDER BY name")]
                con.execute("BEGIN")
                for (name,) in con.execute("SELECT name FROM sqlite_master WHERE type = 'trigger'").fetchall():
                    con.execute(f'DROP TRIGGER "{name}"')
                applied = apply(con, b, differences, decisions)
                for sql in triggers:
                    con.execute(sql)
                con.execute("COMMIT")
                integrity = con.execute("PRAGMA integrity_check").fetchone()[0]
                added = fk_faults(con) - before
            finally:
                con.close()
            if integrity != "ok" or added:
                raise Refused("split_merge_unsound", f"The merged records fail a check (integrity: {integrity}; {len(added)} new foreign key fault(s), in {', '.join(sorted({f[0] for f in added})) or 'none'}). Nothing was written: revisit the decisions on those tables.")
            shutil.copyfile(staged, out)
    finally:
        a.close()
        b.close()
    return {"out": out, "applied": applied}


def main():
    req = json.load(sys.stdin)
    try:
        too_old = sqlite_too_old()
        if too_old:
            raise Refused("sqlite_too_old", too_old)
        out = {"diff": diff, "merge": merge}[req["op"]](req)
    except Refused as exc:
        out = {"refused": exc.code, "message": str(exc)}
    sys.stdout.write(json.dumps(out))


if __name__ == "__main__":
    main()
