// A generic key-value store in one local SQLite file: one table, kv_store
// (namespace, key, value JSON, updated_at), reached through the host Python
// sqlite3 module like the other local backends. It holds no knowledge of what
// a namespace or key means; each caller names its own file, label, timeout and
// advice for a killed write.

import { pythonDriverFile } from "../python-driver.js";
import { runPythonDriver } from "../python-spawn.js";

const PY_HELPER = String.raw`
import datetime, hashlib, io, json, os, sqlite3, sys

SCHEMA = """
CREATE TABLE IF NOT EXISTS kv_store (
  namespace TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (namespace, key)
);
CREATE INDEX IF NOT EXISTS idx_kv_prefix ON kv_store(namespace, key);
""".strip()


def now_iso():
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def escape_like(s):
    return s.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def connect(db_path):
    d = os.path.dirname(os.path.abspath(db_path))
    if d:
        os.makedirs(d, exist_ok=True)
    con = sqlite3.connect(db_path)
    con.execute("PRAGMA journal_mode = DELETE")
    con.executescript(SCHEMA)
    return con


def other_tables(db_path):
    """True when the file holds any table but kv_store. Opens nothing that is absent."""
    if not os.path.exists(db_path):
        return False
    con = sqlite3.connect(db_path)
    try:
        row = con.execute(
            "SELECT count(*) FROM sqlite_master WHERE type = 'table' "
            "AND name <> 'kv_store' AND substr(name, 1, 7) <> 'sqlite_'"
        ).fetchone()
        return row[0] > 0
    finally:
        con.close()


UPSERT = (
    "INSERT INTO kv_store (namespace, key, value, updated_at) VALUES (?, ?, ?, ?) "
    "ON CONFLICT(namespace, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
)


def merge_ids(con, namespace, key, add, drop_prefix, line_no):
    """Treat one value as a JSON array of strings: drop every element starting
    with drop_prefix, append the new ones not already present, keep order.
    An array that ends up empty deletes the key -- an absent index and an empty
    index mean the same thing to every reader."""
    row = con.execute(
        "SELECT value FROM kv_store WHERE namespace = ? AND key = ?", (namespace, key)
    ).fetchone()
    current = []
    if row is not None:
        try:
            current = json.loads(row[0])
        except ValueError:
            raise SystemExit("line %d: merge target %r does not hold JSON" % (line_no, key))
        if not isinstance(current, list) or any(not isinstance(x, str) for x in current):
            raise SystemExit(
                "line %d: merge target %r is not a JSON array of strings" % (line_no, key)
            )
    kept = [x for x in current if not (drop_prefix and x.startswith(drop_prefix))]
    seen = set(kept)
    for item in add:
        if item not in seen:
            kept.append(item)
            seen.add(item)
    if kept:
        con.execute(
            UPSERT,
            (namespace, key, json.dumps(kept, ensure_ascii=False, separators=(",", ":")), now_iso()),
        )
    else:
        con.execute("DELETE FROM kv_store WHERE namespace = ? AND key = ?", (namespace, key))


def namespace_rows(con, namespace):
    return dict(con.execute("SELECT key, value FROM kv_store WHERE namespace = ?", (namespace,)))


def sha256_text(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def denied(deny, key):
    return bool(deny) and key.startswith(tuple(deny))


def apply_if(con, checks, writes):
    """All of the writes (sets and deletes, any namespace) land in ONE transaction, and only if every
    check still holds: a check names (namespace, key) and either expect_sha256 (the stored value
    still hashes to it) or expect_absent. BEGIN IMMEDIATE takes the write lock before the first read,
    so no other process changes a checked key between the compare and the writes. A failed check
    rolls everything back and replies {stale: true}."""
    con.execute("BEGIN IMMEDIATE")
    for check in checks:
        row = con.execute(
            "SELECT value FROM kv_store WHERE namespace = ? AND key = ?", (check["namespace"], check["key"])
        ).fetchone()
        if check.get("expect_absent"):
            stale = row is not None
        else:
            stale = row is None or sha256_text(row[0]) != check.get("expect_sha256")
        if stale:
            con.rollback()
            return {"stale": True}
    counts = {"sets": 0, "deletes": 0}
    for entry in writes:
        if entry["op"] == "set":
            con.execute(UPSERT, (entry["namespace"], entry["key"], entry["value"], now_iso()))
            counts["sets"] += 1
        elif entry["op"] == "delete":
            con.execute("DELETE FROM kv_store WHERE namespace = ? AND key = ?", (entry["namespace"], entry["key"]))
            counts["deletes"] += 1
        else:
            con.rollback()
            raise SystemExit("unknown write op: %r" % entry["op"])
    con.commit()
    return {"ok": True, **counts}


def delete_if(con, namespace, key, expect_sha256):
    """Delete a key only if its stored value still hashes to expect_sha256, in one transaction."""
    result = apply_if(
        con,
        [{"namespace": namespace, "key": key, "expect_sha256": expect_sha256}],
        [{"op": "delete", "namespace": namespace, "key": key}],
    )
    return {"stale": True} if result.get("stale") else {"ok": True, "deleted": True}


def set_if(con, namespace, key, value, expect_sha256, expect_absent):
    """Write only if the stored value is still the one the caller read: its
    SHA-256 matches expect_sha256, or with expect_absent the key is absent.
    BEGIN IMMEDIATE takes the write lock before the read, so a second process
    cannot write between the compare and the write."""
    con.execute("BEGIN IMMEDIATE")
    row = con.execute(
        "SELECT value FROM kv_store WHERE namespace = ? AND key = ?", (namespace, key)
    ).fetchone()
    if expect_absent:
        stale = row is not None
    else:
        stale = row is None or sha256_text(row[0]) != expect_sha256
    if stale:
        con.rollback()
        return {"stale": True}
    con.execute(UPSERT, (namespace, key, value, now_iso()))
    con.commit()
    return {"ok": True, "sha256": sha256_text(value)}


def bulk_apply(con, namespace, path, expect, deny=()):
    """Apply a whole JSONL file of writes to one namespace in ONE transaction.
    Reading the file here rather than through tool arguments is what makes a
    58k-row import possible; one transaction is what makes it one process
    instead of 58k. Any bad line raises before the commit, so the caller either
    gets the whole file or none of it.
    With no expect it previews: the same work, rolled back, reporting the net
    effect on the namespace and the fingerprint of the bytes it read. With
    expect it commits only if those match, which is what makes the counts a
    hook shows the practitioner true."""
    if not os.path.isfile(path):
        raise SystemExit("file not found: %s" % path)
    with open(path, "rb") as fh:
        data = fh.read()
    con.execute("BEGIN IMMEDIATE")
    before = namespace_rows(con, namespace)
    counts = {"lines": 0, "sets": 0, "deletes": 0, "merges": 0, "deleted_by_prefix": 0}
    with io.TextIOWrapper(io.BytesIO(data), encoding="utf-8") as fh:
        for line_no, raw in enumerate(fh, 1):
            raw = raw.strip()
            if not raw:
                continue
            try:
                entry = json.loads(raw)
            except ValueError as exc:
                raise SystemExit("line %d is not valid JSON: %s" % (line_no, exc))
            counts["lines"] += 1
            op = entry.get("op")
            if op == "set":
                con.execute(UPSERT, (namespace, entry["key"], entry["value"], now_iso()))
                counts["sets"] += 1
            elif op == "delete":
                con.execute(
                    "DELETE FROM kv_store WHERE namespace = ? AND key = ?",
                    (namespace, entry["key"]),
                )
                counts["deletes"] += 1
            elif op == "delete_prefix":
                cur = con.execute(
                    "DELETE FROM kv_store WHERE namespace = ? AND key LIKE ? ESCAPE '\\'",
                    (namespace, escape_like(entry["prefix"]) + "%"),
                )
                counts["deleted_by_prefix"] += cur.rowcount
            elif op == "merge":
                merge_ids(
                    con,
                    namespace,
                    entry["key"],
                    entry.get("add") or [],
                    entry.get("drop_prefix") or "",
                    line_no,
                )
                counts["merges"] += 1
            else:
                raise SystemExit("line %d has unknown op %r" % (line_no, op))
    after = namespace_rows(con, namespace)
    touched = sorted(
        key for key in set(before) | set(after)
        if denied(deny, key) and before.get(key) != after.get(key)
    )
    if touched:
        con.rollback()
        return {"denied": touched}
    effect = {
        "added": sum(key not in before for key in after),
        "replaced": sum(key in before and before[key] != value for key, value in after.items()),
        "removed": sum(key not in after for key in before),
        "file_sha256": hashlib.sha256(data).hexdigest(),
    }
    if expect is None:
        con.rollback()
    elif any(expect.get(name) != value for name, value in effect.items()):
        raise SystemExit("nothing was written: the file would now do %s, not what was approved; preview it again" % json.dumps(effect))
    else:
        con.commit()
    return {**counts, **effect, "applied": expect is not None}


def export(con, namespace, prefix, path, deny=()):
    """The read twin of bulk_apply: write every key under prefix to a JSONL
    file of bulk_apply "set" lines, sorted by key, so an export re-applies as
    it stands. The rows go to a file the caller named, never back through tool
    output. A key under a deny prefix refuses the export before the file is opened."""
    rows = con.execute(
        "SELECT key, value FROM kv_store WHERE namespace = ? AND key LIKE ? ESCAPE '\\' ORDER BY key",
        (namespace, escape_like(prefix) + "%"),
    ).fetchall()
    touched = [key for key, _ in rows if denied(deny, key)]
    if touched:
        return {"denied": touched}
    parent = os.path.dirname(os.path.abspath(path))
    if parent:
        os.makedirs(parent, exist_ok=True)
    items = 0
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        for key, value in rows:
            line = {"op": "set", "key": key, "value": value}
            fh.write(json.dumps(line, ensure_ascii=False, separators=(",", ":")) + "\n")
            items += 1
    return {"items": items, "path": path}


def dump(con, namespaces):
    out = {}
    for namespace in namespaces:
        rows = con.execute(
            "SELECT key, value FROM kv_store WHERE namespace = ? ORDER BY key", (namespace,)
        ).fetchall()
        out[namespace] = [{"key": k, "value": v} for k, v in rows]
    return {"namespaces": out}


def apply(con, writes):
    """Sets and deletes across namespaces in ONE transaction: all land or none."""
    counts = {"sets": 0, "deletes": 0}
    for entry in writes:
        if entry["op"] == "set":
            con.execute(UPSERT, (entry["namespace"], entry["key"], entry["value"], now_iso()))
            counts["sets"] += 1
        elif entry["op"] == "delete":
            con.execute(
                "DELETE FROM kv_store WHERE namespace = ? AND key = ?", (entry["namespace"], entry["key"])
            )
            counts["deletes"] += 1
        else:
            raise SystemExit("unknown write op: %r" % entry["op"])
    con.commit()
    return counts


def main():
    req = json.load(sys.stdin)
    # exclusive: the caller keeps nothing but kv_store in this file, so a file
    # holding any other table is refused before it is touched.
    if req.get("exclusive") and other_tables(req["db_path"]):
        return {"other_tables": True}
    con = connect(req["db_path"])
    try:
        op = req["op"]
        if op == "dump":
            return dump(con, req["namespaces"])
        if op == "apply":
            return apply(con, req["writes"])
        if op == "apply_if":
            return apply_if(con, req["checks"], req["writes"])
        namespace = req["namespace"]
        if op == "get":
            row = con.execute(
                "SELECT value FROM kv_store WHERE namespace = ? AND key = ?",
                (namespace, req["key"]),
            ).fetchone()
            return {"value": row[0] if row else None}
        if op == "set":
            con.execute(UPSERT, (namespace, req["key"], req["value"], now_iso()))
            con.commit()
            return {"ok": True}
        if op == "set_if":
            return set_if(
                con, namespace, req["key"], req["value"],
                req.get("expect_sha256"), bool(req.get("expect_absent")),
            )
        if op == "list":
            prefix = req.get("prefix") or ""
            rows = con.execute(
                "SELECT key, value FROM kv_store WHERE namespace = ? AND key LIKE ? ESCAPE '\\' ORDER BY key",
                (namespace, escape_like(prefix) + "%"),
            ).fetchall()
            return {"items": [{"key": k, "value": v} for k, v in rows]}
        deny = req.get("deny_prefixes") or ([req["deny_prefix"]] if req.get("deny_prefix") else [])
        if op == "delete_if":
            if denied(deny, req["key"]):
                return {"denied": [req["key"]]}
            return delete_if(con, namespace, req["key"], req["expect_sha256"])
        if op == "delete":
            if denied(deny, req["key"]):
                return {"denied": [req["key"]]}
            cur = con.execute(
                "DELETE FROM kv_store WHERE namespace = ? AND key = ?",
                (namespace, req["key"]),
            )
            con.commit()
            return {"ok": True, "deleted": cur.rowcount > 0}
        if op == "bulk_apply":
            return bulk_apply(con, namespace, req["path"], req.get("expect"), deny)
        if op == "export":
            return export(con, namespace, req.get("prefix") or "", req["path"], deny)
        raise SystemExit("unknown op: %s" % op)
    finally:
        con.close()


print(json.dumps(main()))
`.trim();

function helperFile(): string {
  return pythonDriverFile("kv-sqlite", PY_HELPER);
}

export type KvOp = "get" | "set" | "set_if" | "list" | "delete" | "delete_if" | "bulk_apply" | "export" | "dump" | "apply" | "apply_if";

/** One write of an `apply` call. */
export interface KvWrite {
  op: "set" | "delete";
  namespace: string;
  key: string;
  value?: string;
}

export interface BulkApplyExpect {
  added: number;
  replaced: number;
  removed: number;
  file_sha256: string;
}

export interface KvRequest {
  op: KvOp;
  db_path: string;
  namespace?: string;
  key?: string;
  value?: string;
  prefix?: string;
  path?: string;
  /** bulk_apply: commit only if the file's net effect and fingerprint match; absent, preview. */
  expect?: BulkApplyExpect;
  /** dump: the namespaces to return, each as [{key, value}] sorted by key. */
  namespaces?: string[];
  /** apply: sets and deletes across namespaces, applied in one transaction. */
  writes?: KvWrite[];
  /** Refuse a file holding any table but kv_store: the reply is then {other_tables: true}. */
  exclusive?: boolean;
  /** set_if: write only if the stored value's SHA-256 (of its UTF-8 text) is this; else {stale: true}. */
  expect_sha256?: string;
  /** set_if: write only if the key is absent; else {stale: true}. */
  expect_absent?: boolean;
  /** delete, delete_if, bulk_apply, export: a key starting with this, touched, refuses the call with {denied: [keys]} and writes nothing. */
  deny_prefix?: string;
  /** The same, for several prefixes. */
  deny_prefixes?: string[];
  /** apply_if: every check must still hold; then the writes land in one transaction. Else {stale: true}. */
  checks?: KvCheck[];
}

/** One condition of an `apply_if` call. */
export interface KvCheck {
  namespace: string;
  key: string;
  expect_sha256?: string;
  expect_absent?: boolean;
}

export interface KvCallOptions {
  label: string;
  timeoutMs: number;
  timeoutAdvice?: string;
  env: NodeJS.ProcessEnv;
}

/** export writes a file but never the store, so it counts as a read. */
export function isKvRead(op: KvOp): boolean {
  return op === "get" || op === "list" || op === "export" || op === "dump";
}

export function runKv(request: KvRequest, options: KvCallOptions): Record<string, unknown> {
  return runPythonDriver({
    label: options.label,
    driver: helperFile(),
    payload: JSON.stringify(request),
    env: options.env,
    timeoutMs: options.timeoutMs,
    timeoutAdvice: options.timeoutAdvice,
  }) as Record<string, unknown>;
}
