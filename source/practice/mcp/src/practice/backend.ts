// Local practice-data storage: practice.db holds the one generic kv_store table
// (src/kv/backend.ts) and nothing else, reached through the host Python
// `sqlite3` module like the other local backends. It holds items, their
// metadata and any write not yet applied, under the namespaces `item`, `meta`
// and `pending` (docs/Plans/2026-10-14_practice-db-conversion.md, "Local
// storage"). It has no table, column or file per kind of item.
//
// This module imports nothing that reaches Probanda's Cloud: housekeeping
// (built into the file-admin bundle) imports resolveCaseDataRoot from here.

import { join } from "node:path";

import { resolveCaseDataRoot } from "./case-data-root.js";
import { DataServerError } from "../errors.js";
import { isKvRead, runKv, type KvOp, type KvRequest, type KvWrite } from "../kv/backend.js";
import { EXECUTE_TIMEOUT_MS, pythonTimeoutMs, READ_TIMEOUT_MS } from "../python-timeout.js";

// Moved to ./case-data-root.ts; re-exported for the modules that import it from here.
export { resolveCaseDataRoot };

/** Issue #693. Every write is one transaction, so a kill leaves it whole or absent. */
export function practiceTimeoutMs(op: KvOp, env: NodeJS.ProcessEnv = process.env): number {
  return pythonTimeoutMs(env, isKvRead(op) ? READ_TIMEOUT_MS : EXECUTE_TIMEOUT_MS, "COCLERK_PRACTICE_PYTHON_TIMEOUT_MS");
}

// The helper writes in DELETE journal mode, one transaction per call: a kill before COMMIT is
// rolled back when the database next opens, and a kill after it leaves the write in place.
const KILLED_WRITE_ADVICE =
  "The write may already have committed: verify it by reading it back before retrying (/practice-data Conventions).";

// Resolves the practice.db path (spec §5): COCLERK_DB_PATH wins (test override);
// otherwise the Roaming coclerk.json `case_data_root` + `_practice\<name>`.
export function resolvePracticeDbPath(env: NodeJS.ProcessEnv = process.env): string {
  if (env.COCLERK_DB_PATH) return env.COCLERK_DB_PATH;
  const root = resolveCaseDataRoot(env);
  return join(root, "_practice", env.COCLERK_DB_NAME || "practice.db");
}

export interface KvEntry {
  key: string;
  value: string;
}

/** The local store practice data reads and writes: practice.db's kv_store, or an in-memory one in tests. */
export interface PracticeKv {
  /** Every entry of each namespace, sorted by key. */
  dump(namespaces: string[]): Record<string, KvEntry[]>;
  /** Sets and deletes, in one transaction. */
  apply(writes: KvWrite[]): void;
}

export class SqlitePracticeKv implements PracticeKv {
  private dbPath: string | undefined;

  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  private path(): string {
    if (!this.dbPath) this.dbPath = resolvePracticeDbPath(this.env);
    return this.dbPath;
  }

  private run(request: Omit<KvRequest, "db_path" | "exclusive">): Record<string, unknown> {
    const path = this.path();
    const reply = runKv({ ...request, db_path: path, exclusive: true }, {
      label: "practice-data sqlite helper",
      env: this.env,
      timeoutMs: practiceTimeoutMs(request.op, this.env),
      timeoutAdvice: isKvRead(request.op) ? undefined : KILLED_WRITE_ADVICE,
    });
    if (reply.other_tables) {
      throw new DataServerError(
        `${path} holds tables other than kv_store, so it is a practice.db in the format before Probanda's Cloud. ` +
          "Nothing was read or written. Convert it with the practice.db migration, scripts/migrate_practice_db.py " +
          "(step 6 of the practice.db conversion), before using practice data.",
        "practice_db_legacy"
      );
    }
    return reply;
  }

  dump(namespaces: string[]): Record<string, KvEntry[]> {
    return (this.run({ op: "dump", namespaces }).namespaces ?? {}) as Record<string, KvEntry[]>;
  }

  apply(writes: KvWrite[]): void {
    if (writes.length) this.run({ op: "apply", writes });
  }
}
