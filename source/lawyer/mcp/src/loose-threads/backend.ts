// Loose threads (docs/ADRs/0018-loose-threads-have-their-own-store.md): one key-value file per matter,
// `loose_threads.db` beside the drafting database, reached through the generic kv backend. Every thread
// is one JSON value in one namespace under its id. `kind` is its only type field (Commandment 5). The
// file is the boundary: drafting_data__query cannot reach it, so a session sees threads only by the
// loose_threads__* tools (./tools.ts), and a board's job card names only the threads that job wrote.

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

import { forgetPerCall, oncePerCall } from "../call-memo.js";
import { DataServerError } from "../errors.js";
import { isKvRead, type KvRequest, runKv } from "../kv/backend.js";
import { EXECUTE_TIMEOUT_MS, pythonTimeoutMs, READ_TIMEOUT_MS } from "../python-timeout.js";

export const LOOSE_THREADS_FILE = "loose_threads.db";
export const THREAD_KINDS = ["idea", "proposition", "correspondence", "argument", "work_board"] as const;
export type ThreadKind = (typeof THREAD_KINDS)[number];

/** A ranked thread's group, loose-thread triage's content groups. */
export const RANK_GROUPS = ["decision", "tooling", "housekeeping", "research", "authority", "evidence", "other"] as const;
export type RankGroup = (typeof RANK_GROUPS)[number];

export interface LooseThread {
  id: number;
  kind: ThreadKind;
  idea: string;
  surfaced_by: string;
  created: string;
  proceeding_id: number;
  filing_id: number | null;
  origin_job: number | null;
  /** The file path or record id a thread of work left off at. */
  ref?: string;
  /** The job it was outlined into. */
  charted_into: number | null;
  rank: number | null;
  rank_group: RankGroup | null;
  rank_reason: string | null;
  rank_job: string | null;
  deferred_at: string | null;
  discarded_at: string | null;
  suggested_at: string | null;
}

const THREADS = "threads";
const META = "meta";
const SEEDS_MOVED = "seeds_moved";

const KILLED_WRITE_ADVICE = "The write may already have committed: read the thread back before retrying.";

export function looseThreadsPath(dbPath: string): string {
  return join(dirname(dbPath), LOOSE_THREADS_FILE);
}

function run(dbPath: string, request: Omit<KvRequest, "db_path" | "exclusive">, env: NodeJS.ProcessEnv): Record<string, unknown> {
  const db_path = looseThreadsPath(dbPath);
  const out = runKv({ ...request, db_path, exclusive: true }, {
    label: "loose-threads sqlite helper",
    env,
    timeoutMs: pythonTimeoutMs(env, isKvRead(request.op) ? READ_TIMEOUT_MS : EXECUTE_TIMEOUT_MS, "COCLERK_SUBMISSION_PYTHON_TIMEOUT_MS"),
    timeoutAdvice: isKvRead(request.op) ? undefined : KILLED_WRITE_ADVICE,
  });
  if (out.other_tables === true) throw new DataServerError(`${db_path} holds tables of another kind, so it was not read or written.`, "loose_threads_file_foreign");
  return out;
}

const memoKey = (dbPath: string) => JSON.stringify(["loose-threads", dbPath]);

/** Every thread of the matter, in id order. A matter with no file has none, and a read never makes the file. */
export function readThreads(dbPath: string, env: NodeJS.ProcessEnv = process.env): LooseThread[] {
  return oncePerCall(memoKey(dbPath), () => {
    if (!existsSync(looseThreadsPath(dbPath))) return [];
    const { items } = run(dbPath, { op: "list", namespace: THREADS }, env) as unknown as { items: { key: string; value: string }[] };
    return items.map((i): LooseThread => ({ ...(JSON.parse(i.value) as Omit<LooseThread, "id">), id: Number(i.key) })).sort((a, b) => a.id - b.id);
  }).map((t) => ({ ...t }));
}

/** Writes these threads whole, in one transaction: all land or none. */
export function writeThreads(dbPath: string, threads: readonly LooseThread[], env: NodeJS.ProcessEnv = process.env): void {
  const stale = memoKey(dbPath);
  forgetPerCall((key) => key === stale);
  run(dbPath, { op: "apply", writes: threads.map(({ id, ...value }) => ({ op: "set", namespace: THREADS, key: String(id), value: JSON.stringify(value) })) }, env);
}

/** The stamp of the one move out of `seeds`, or null while it has not run. */
export function readSeedsMoved(dbPath: string, env: NodeJS.ProcessEnv = process.env): string | null {
  if (!existsSync(looseThreadsPath(dbPath))) return null;
  return (run(dbPath, { op: "get", namespace: META, key: SEEDS_MOVED }, env) as { value: string | null }).value;
}

export function stampSeedsMoved(dbPath: string, value: string, env: NodeJS.ProcessEnv = process.env): void {
  run(dbPath, { op: "set", namespace: META, key: SEEDS_MOVED, value }, env);
}

/** Open: never outlined, or outlined into a deleted job, and neither discarded nor suggested. */
export function isOpenThread(t: LooseThread, deletedIds: ReadonlySet<number>): boolean {
  return (t.charted_into === null || deletedIds.has(t.charted_into)) && t.discarded_at === null && t.suggested_at === null;
}

/** The local minute a thread is stamped with, `YYYY-MM-DDTHH:MM`. */
export function threadStamp(now: Date = new Date()): string {
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
