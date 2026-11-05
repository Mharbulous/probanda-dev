// Time-pipeline key-value backend (Step 0 — port off the retired cowork-db Go
// binary, decided 2026-08-26: planning/1. Design/2026-08-26_time-pipeline-store-design.md).
//
// Serves the `time_pipeline__get/set/list/delete` tool surface from a local
// SQLite database, reached through the host Python `sqlite3` module (the same
// ratified exception the practice and matter-data backends use: shelling out to
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
// matter_data__query/execute connection-discipline pattern.

import { join } from "node:path";

import { ValidationError } from "../errors.js";
import { type BulkApplyExpect, isKvRead, type KvOp, type KvRequest, runKv } from "../kv/backend.js";
import { resolveCaseDataRoot } from "../practice/backend.js";
import { EXECUTE_TIMEOUT_MS, pythonTimeoutMs, READ_TIMEOUT_MS, WRITE_TIMEOUT_MS } from "../python-timeout.js";

// COCLERK_TIME_PIPELINE_DB_PATH is a full-path test override, mirroring
// COCLERK_DB_PATH for practice.db; otherwise the file sits alongside
// practice.db under the same case_data_root\_practice\ folder.
export function resolveTimePipelineDbPath(env: NodeJS.ProcessEnv = process.env): string {
  if (env.COCLERK_TIME_PIPELINE_DB_PATH) return env.COCLERK_TIME_PIPELINE_DB_PATH;
  const root = resolveCaseDataRoot(env);
  return join(root, "_practice", env.COCLERK_TIME_PIPELINE_DB_NAME || "time_pipeline.db");
}

type TimePipelineOp = KvOp;

export interface BulkApplyCounts {
  lines: number;
  sets: number;
  deletes: number;
  merges: number;
  deleted_by_prefix: number;
  added: number;
  replaced: number;
  removed: number;
  file_sha256: string;
  applied: boolean;
}

/** Issue #693. bulk_apply is the ~58k-row Chrometa import in one transaction: killing a slow but
 * healthy import is worse than letting it finish, so it takes the migrate budget. */
export function timePipelineTimeoutMs(op: TimePipelineOp, env: NodeJS.ProcessEnv = process.env): number {
  const defaultMs = isKvRead(op) ? READ_TIMEOUT_MS : op === "bulk_apply" ? WRITE_TIMEOUT_MS : EXECUTE_TIMEOUT_MS;
  return pythonTimeoutMs(env, defaultMs, "COCLERK_TIME_PIPELINE_PYTHON_TIMEOUT_MS");
}

// The helper writes in DELETE journal mode, one transaction per call (a whole bulk_apply file
// included): a kill before COMMIT is rolled back when the database next opens, and a kill after
// it leaves the write in place.
const KILLED_WRITE_ADVICE =
  "The write may already have committed: verify it by reading it back before retrying (/time-pipeline-data Conventions).";

function runHelper(request: KvRequest, env: NodeJS.ProcessEnv): Record<string, unknown> {
  return runKv(request, {
    label: "time-pipeline sqlite helper",
    env,
    timeoutMs: timePipelineTimeoutMs(request.op, env),
    timeoutAdvice: isKvRead(request.op) ? undefined : KILLED_WRITE_ADVICE,
  });
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
// `preview` rolls that transaction back and reports what it would do; `expect`
// carries those numbers back and commits only if they still hold. The approval
// gate is a hook that cannot see this machine in Cowork, so these are its only facts.
export function timePipelineBulkApply(
  namespace: string,
  path: string,
  mode: { preview?: boolean; expect?: BulkApplyExpect },
  env: NodeJS.ProcessEnv = process.env
): BulkApplyCounts {
  if ((mode.preview === true) === (mode.expect !== undefined)) {
    throw new ValidationError("time_pipeline__bulk_apply takes preview or expect, not both and not neither");
  }
  const db_path = resolveTimePipelineDbPath(env);
  return runHelper({ op: "bulk_apply", db_path, namespace, path, expect: mode.expect }, env) as unknown as BulkApplyCounts;
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
