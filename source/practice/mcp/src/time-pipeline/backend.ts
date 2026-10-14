// Time-pipeline key-value backend (Step 0 — port off the retired cowork-db Go
// binary, decided 2026-08-26: planning/1. Design/2026-08-26_time-pipeline-store-design.md).
//
// Serves the `time_pipeline__get/set/list/delete` tool surface from a local
// SQLite database, reached through the host Python `sqlite3` module (the same
// ratified exception the practice and case-data backends use: shelling out to
// host Python keeps the Node >=20 pin and adds no node:sqlite dependency or
// build step). The three former cowork-db namespaces (`timeline`, `timesort`,
// `tedraft`) are not relational -- they are JSON blobs under string keys, so
// the schema stays a single generic table rather than a relational rewrite:
//
//   CREATE TABLE kv_store (
//     namespace  TEXT NOT NULL,
//     key        TEXT NOT NULL,
//     value      TEXT NOT NULL,   -- JSON, stored verbatim
//     updated_at TEXT NOT NULL,
//     PRIMARY KEY (namespace, key)
//   );
//
// This backend holds no knowledge of what a namespace or key means -- that
// stays inside the /time-pipeline-data skill and its consumers
// (build-timeline, time-sorting, time-entry-drafting), matching the
// case_data__query/execute connection-discipline pattern.

import { join } from "node:path";

import { resolveCaseDataRoot } from "../practice/backend.js";
import { pythonDriverFile } from "../python-driver.js";
import { runPythonDriver } from "../python-spawn.js";
import { EXECUTE_TIMEOUT_MS, pythonTimeoutMs, READ_TIMEOUT_MS, WRITE_TIMEOUT_MS } from "../python-timeout.js";

const PY_HELPER = String.raw`
import datetime, json, os, sqlite3, sys

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


def bulk_apply(con, namespace, path):
    """Apply a whole JSONL file of writes to one namespace in ONE transaction.
    Reading the file here rather than through tool arguments is what makes a
    58k-row import possible; one transaction is what makes it one process
    instead of 58k. Any bad line raises before the commit, so the caller either
    gets the whole file or none of it."""
    if not os.path.isfile(path):
        raise SystemExit("file not found: %s" % path)
    counts = {"lines": 0, "sets": 0, "deletes": 0, "merges": 0, "deleted_by_prefix": 0}
    with open(path, "r", encoding="utf-8") as fh:
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
    con.commit()
    return counts


def export(con, namespace, prefix, path):
    """The read twin of bulk_apply: write every key under prefix to a JSONL
    file of bulk_apply "set" lines, sorted by key, so an export re-applies as
    it stands. The rows go to a file the caller named, never back through tool
    output."""
    parent = os.path.dirname(os.path.abspath(path))
    if parent:
        os.makedirs(parent, exist_ok=True)
    rows = con.execute(
        "SELECT key, value FROM kv_store WHERE namespace = ? AND key LIKE ? ESCAPE '\\' ORDER BY key",
        (namespace, escape_like(prefix) + "%"),
    )
    items = 0
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        for key, value in rows:
            line = {"op": "set", "key": key, "value": value}
            fh.write(json.dumps(line, ensure_ascii=False, separators=(",", ":")) + "\n")
            items += 1
    return {"items": items, "path": path}


def main():
    req = json.load(sys.stdin)
    con = connect(req["db_path"])
    try:
        op = req["op"]
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
        if op == "list":
            prefix = req.get("prefix") or ""
            rows = con.execute(
                "SELECT key, value FROM kv_store WHERE namespace = ? AND key LIKE ? ESCAPE '\\' ORDER BY key",
                (namespace, escape_like(prefix) + "%"),
            ).fetchall()
            return {"items": [{"key": k, "value": v} for k, v in rows]}
        if op == "delete":
            cur = con.execute(
                "DELETE FROM kv_store WHERE namespace = ? AND key = ?",
                (namespace, req["key"]),
            )
            con.commit()
            return {"ok": True, "deleted": cur.rowcount > 0}
        if op == "bulk_apply":
            return bulk_apply(con, namespace, req["path"])
        if op == "export":
            return export(con, namespace, req.get("prefix") or "", req["path"])
        raise SystemExit("unknown op: %s" % op)
    finally:
        con.close()


print(json.dumps(main()))
`.trim();

function helperFile(): string {
  return pythonDriverFile("time-pipeline-sqlite", PY_HELPER);
}

// COCLERK_TIME_PIPELINE_DB_PATH is a full-path test override, mirroring
// COCLERK_DB_PATH for practice.db; otherwise the file sits alongside
// practice.db under the same case_data_root\_practice\ folder.
export function resolveTimePipelineDbPath(env: NodeJS.ProcessEnv = process.env): string {
  if (env.COCLERK_TIME_PIPELINE_DB_PATH) return env.COCLERK_TIME_PIPELINE_DB_PATH;
  const root = resolveCaseDataRoot(env);
  return join(root, "_practice", env.COCLERK_TIME_PIPELINE_DB_NAME || "time_pipeline.db");
}

type TimePipelineOp = "get" | "set" | "list" | "delete" | "bulk_apply" | "export";

interface TimePipelineRequest {
  op: TimePipelineOp;
  db_path: string;
  namespace: string;
  key?: string;
  value?: string;
  prefix?: string;
  path?: string;
}

export interface BulkApplyCounts {
  lines: number;
  sets: number;
  deletes: number;
  merges: number;
  deleted_by_prefix: number;
}

/** Issue #693. bulk_apply is the ~58k-row Chrometa import in one transaction: killing a slow but
 * healthy import is worse than letting it finish, so it takes the migrate budget. */
export function timePipelineTimeoutMs(op: TimePipelineOp, env: NodeJS.ProcessEnv = process.env): number {
  const defaultMs = isRead(op) ? READ_TIMEOUT_MS : op === "bulk_apply" ? WRITE_TIMEOUT_MS : EXECUTE_TIMEOUT_MS;
  return pythonTimeoutMs(env, defaultMs, "COCLERK_TIME_PIPELINE_PYTHON_TIMEOUT_MS");
}

// export writes a file but never the store, so it is a read for timeout and advice purposes.
function isRead(op: TimePipelineOp): boolean {
  return op === "get" || op === "list" || op === "export";
}

// The helper writes in DELETE journal mode, one transaction per call (a whole bulk_apply file
// included): a kill before COMMIT is rolled back when the database next opens, and a kill after
// it leaves the write in place.
const KILLED_WRITE_ADVICE =
  "The write may already have committed: verify it by reading it back before retrying (/time-pipeline-data Conventions).";

function runHelper(request: TimePipelineRequest, env: NodeJS.ProcessEnv): Record<string, unknown> {
  const read = isRead(request.op);
  return runPythonDriver({
    label: "time-pipeline sqlite helper",
    driver: helperFile(),
    payload: JSON.stringify(request),
    env,
    timeoutMs: timePipelineTimeoutMs(request.op, env),
    timeoutAdvice: read ? undefined : KILLED_WRITE_ADVICE,
  }) as Record<string, unknown>;
}

export function timePipelineGet(
  namespace: string,
  key: string,
  env: NodeJS.ProcessEnv = process.env
): { value: string | null } {
  const db_path = resolveTimePipelineDbPath(env);
  return runHelper({ op: "get", db_path, namespace, key }, env) as { value: string | null };
}

export function timePipelineSet(
  namespace: string,
  key: string,
  value: string,
  env: NodeJS.ProcessEnv = process.env
): { ok: true } {
  const db_path = resolveTimePipelineDbPath(env);
  return runHelper({ op: "set", db_path, namespace, key, value }, env) as { ok: true };
}

export function timePipelineList(
  namespace: string,
  prefix: string | undefined,
  env: NodeJS.ProcessEnv = process.env
): { items: { key: string; value: string }[] } {
  const db_path = resolveTimePipelineDbPath(env);
  return runHelper({ op: "list", db_path, namespace, prefix: prefix ?? "" }, env) as {
    items: { key: string; value: string }[];
  };
}

export function timePipelineDelete(
  namespace: string,
  key: string,
  env: NodeJS.ProcessEnv = process.env
): { ok: true; deleted: boolean } {
  const db_path = resolveTimePipelineDbPath(env);
  return runHelper({ op: "delete", db_path, namespace, key }, env) as { ok: true; deleted: boolean };
}

// Bulk writes arrive as a host-local JSONL file rather than as tool arguments:
// the Chrometa historical import is ~58k rows / ~25 MB, which fits neither an
// argument payload nor an agent loop of one `set` call per row. The helper
// reads the file itself and applies every line in a single transaction.
export function timePipelineBulkApply(
  namespace: string,
  path: string,
  env: NodeJS.ProcessEnv = process.env
): BulkApplyCounts {
  const db_path = resolveTimePipelineDbPath(env);
  return runHelper({ op: "bulk_apply", db_path, namespace, path }, env) as unknown as BulkApplyCounts;
}

// The read twin of bulk_apply: a whole prefix (a source's full history can run
// to megabytes) goes to a host-local JSONL file of bulk_apply `set` lines, so
// a consumer builds from the stored rows without them passing through tool
// output. Generic KV: no knowledge of what any key means.
export function timePipelineExport(
  namespace: string,
  prefix: string | undefined,
  path: string,
  env: NodeJS.ProcessEnv = process.env
): { items: number; path: string } {
  const db_path = resolveTimePipelineDbPath(env);
  return runHelper({ op: "export", db_path, namespace, prefix: prefix ?? "", path }, env) as {
    items: number;
    path: string;
  };
}
