// The background render job (#589; decided in #588, brief §4 D3). Bootstrap lists every filing
// and renders none (#584); this job then renders the stale ones, one filing per event-loop turn,
// through the caller's own render function -- the same submissionFormsRender a foreground render
// uses, so memoisation and archiving behave identically.
//
// In process, never detached (#588 §1). Each turn is an unref'd setImmediate, so a queued tool
// call is read between filings and the job never keeps the server alive on its own (#588 §2).
//
// Concurrency (#588 §3): a HOST-LOCAL lock beside lock.ts's, written once at acquire and never
// rewritten. Its mtime is the heartbeat. A takeover mints a new job_id, and a holder re-reads the
// lock before every render and every status write, so a holder taken over mid-render writes
// nothing more (fencing). Staleness is pid death (ESRCH only), this process's own pid with no live
// job, or an mtime older than 3x the stall threshold -- never started_at, which measures the
// queue's length rather than the job's health.
//
// Status goes to two places, both written temp-then-rename with a bounded retry because OneDrive
// can hold the target (#583, #588 acceptance 6): workboard-status.js beside Litigation Strategy.html,
// which only that page reads (ADR 0015's 2026-09-15 amendment), and a JSON mirror beside the lock,
// which is what a bootstrap or render response reports -- a job in another server process on this
// host included. A session never reads either file itself (#324).

import { randomUUID } from "node:crypto";
import { closeSync, existsSync, openSync, readFileSync, statSync, utimesSync, writeSync } from "node:fs";
import { join } from "node:path";

import { inOneCall } from "../call-memo.js";
import { readLockKey, removeLockIfKey } from "../lock-claim.js";
import { sleepSync, writeStatusFile } from "../status-file.js";
import { hostLocalPath } from "./lock.js";

export const STATUS_FILE = "workboard-status.js";

const DEFAULT_STALL_MS = 60_000;

export interface JobStatus {
  job_id: string;
  state: "running" | "done" | "aborted";
  started_at: string;
  updated_at: string;
  /** The page cannot read an environment variable, so the stall threshold travels here (#588 §4). */
  stall_after_ms: number;
  /** Still to render, after `current`. */
  queued: number[];
  done: number[];
  failed: { filing_id: number; error: string }[];
  /** The filing the job renders next; null once nothing is left. */
  current: number | null;
  /** The last status write that exhausted its retries -- reported rather than swallowed. */
  write_error?: { target: string; code: string; at: string };
}

/** What a bootstrap or render response carries: the status object, a state computed from it, and
 * `joined` when this call found another job already holding the lock. */
export type BackgroundJob =
  | (Omit<JobStatus, "state"> & { state: JobStatus["state"] | "stalled"; joined?: true })
  | { state: "running"; job_id: string | null; started_at: string | null; joined: true }
  | { state: "idle" };

export interface JobSummary {
  job_id: string;
  /** Filings this job actually rendered -- not the ones it found already fresh. */
  rendered: number[];
  done: number[];
  failed: JobStatus["failed"];
}

export interface RenderJobOptions {
  dbPath: string;
  /** The matter's 0. DRAFT folder, already confined; absent means no page file is written. */
  draftDir?: string;
  queue: number[];
  /** Renders one filing's mockups. Throws on failure. */
  render: (filingId: number) => void;
  /** True when the filing's mockups already match what `render` would produce now. */
  isFresh: (filingId: number) => boolean;
  /** Runs once after the last filing, when this job rendered any, before it reports done. Throws on failure. */
  settle?: () => void;
  /** Settle once more before the first filing, even with an empty queue: session entry left pages to it. */
  settleFirst?: boolean;
  env?: NodeJS.ProcessEnv;
}

interface LockRecord {
  job_id: string;
  pid: number;
  started_at: string;
  db_path: string;
}

interface Job {
  lockFile: string;
  mirrorFile: string;
  pageFile?: string;
  dbPath: string;
  status: JobStatus;
  rendered: number[];
  /** Filings a foreground render already made fresh under this job's stamp. */
  skip: Set<number>;
  render: (filingId: number) => void;
  isFresh: (filingId: number) => boolean;
  settle?: () => void;
  settleFirst: boolean;
  promise: Promise<JobSummary>;
  resolve: (summary: JobSummary) => void;
}

/** In-process jobs, keyed by lock file. */
const jobs = new Map<string, Job>();
let exitHandlerInstalled = false;

function nowIso(): string {
  return new Date().toISOString();
}

function stallMs(env: NodeJS.ProcessEnv): number {
  const value = Number(env.COCLERK_RENDER_STALL_MS);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_STALL_MS;
}

function readLock(lockFile: string): LockRecord | null {
  try {
    return JSON.parse(readFileSync(lockFile, "utf-8")) as LockRecord;
  } catch {
    return null;
  }
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // On Windows EPERM means a process exists that this one cannot open; only ESRCH means gone.
    return (err as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

/** Null when the lock file is gone (retry at once); otherwise whether its holder may be taken over. */
function holderIsStale(lockFile: string, holder: LockRecord | null, stall: number): boolean | null {
  let mtimeMs: number;
  try {
    mtimeMs = statSync(lockFile).mtimeMs;
  } catch {
    return null;
  }
  if (holder && typeof holder.pid === "number") {
    if (!pidAlive(holder.pid)) return true;
    if (holder.pid === process.pid && !jobs.has(lockFile)) return true;
  }
  return Date.now() - mtimeMs > 3 * stall;
}

type Acquired = { acquired: LockRecord } | { holder: LockRecord | null };

function acquire(lockFile: string, dbPath: string, stall: number): Acquired {
  for (let attempt = 0; attempt < 3; attempt++) {
    const record: LockRecord = { job_id: randomUUID(), pid: process.pid, started_at: nowIso(), db_path: dbPath };
    try {
      const fd = openSync(lockFile, "wx");
      try {
        writeSync(fd, JSON.stringify(record));
      } finally {
        closeSync(fd);
      }
      return { acquired: record };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }

    const key = readLockKey(lockFile, "job_id");
    const holder = readLock(lockFile);
    const stale = holderIsStale(lockFile, holder, stall);
    if (stale === false) return { holder };
    if (stale === null || key === null) continue;
    // Remove only the lock judged stale, under lock-claim.ts's per-key claim: a bare unlink or rename
    // aside would remove a fresh lock another taker created after breaking this one first.
    if (!removeLockIfKey(lockFile, "job_id", key, () => holderIsStale(lockFile, readLock(lockFile), stall) === true)) {
      sleepSync(50);
    }
  }
  return { holder: readLock(lockFile) };
}

function ours(job: Job): boolean {
  return readLock(job.lockFile)?.job_id === job.status.job_id;
}

/** Writes the status to the page file and the mirror, only while this job still holds the lock. */
function publish(job: Job): boolean {
  if (!ours(job)) return false;
  job.status.updated_at = nowIso();
  if (job.pageFile) {
    const page = `window.WORKBOARD_STATUS = ${JSON.stringify(job.status).replace(/</g, "\\u003c")};\n`;
    const code = writeStatusFile(job.pageFile, page);
    if (code !== null) job.status.write_error = { target: job.pageFile, code, at: nowIso() };
  }
  const code = writeStatusFile(job.mirrorFile, JSON.stringify(job.status));
  if (code !== null) job.status.write_error = { target: job.mirrorFile, code, at: nowIso() };
  return true;
}

function releaseLock(job: Job): void {
  try {
    removeLockIfKey(job.lockFile, "job_id", job.status.job_id, undefined, 500);
  } catch {
    // Nothing to undo; a leaked lock is taken over once it is stale.
  }
}

function finish(job: Job, release: boolean): void {
  if (release) releaseLock(job);
  jobs.delete(job.lockFile);
  job.resolve({ job_id: job.status.job_id, rendered: job.rendered, done: job.status.done, failed: job.status.failed });
}

function schedule(job: Job): void {
  setImmediate(() => step(job)).unref();
}

function settle(job: Job): void {
  if (!job.settle) return;
  try {
    inOneCall(job.settle);
  } catch (err) {
    job.status.write_error = { target: "settle", code: err instanceof Error ? err.message : String(err), at: nowIso() };
  }
}

function step(job: Job): void {
  try {
    if (!ours(job)) return finish(job, false);
    if (!existsSync(job.dbPath)) {
      job.status.state = "aborted";
      job.status.current = null;
      publish(job);
      return finish(job, true);
    }

    if (job.settleFirst) {
      job.settleFirst = false;
      settle(job);
    }
    const id = job.status.current;
    const started = performance.now();
    if (id !== null) {
      try {
        if (!job.skip.has(id) && !job.isFresh(id)) {
          // Each render and each settle is one call for call-memo.ts: its repeated reads run once.
          inOneCall(() => job.render(id));
          job.rendered.push(id);
          console.error(`[render-job] filing ${id} ${Math.round(performance.now() - started)} ms`);
        }
        job.status.done.push(id);
      } catch (err) {
        job.status.failed.push({ filing_id: id, error: err instanceof Error ? err.message : String(err) });
      }
    }

    job.status.current = job.status.queued.shift() ?? null;
    if (job.status.current === null) {
      job.status.state = "done";
      if (job.rendered.length > 0) settle(job);
    }
    try {
      utimesSync(job.lockFile, new Date(), new Date());
    } catch {
      // A lock gone mid-render is caught by the fence check in publish.
    }
    if (!publish(job)) return finish(job, false);
    if (job.status.state === "done") return finish(job, true);
    schedule(job);
  } catch (err) {
    // Never let the job reject: an uncaught error here would take down the shared server (#588 acceptance 1).
    try {
      job.status.state = "aborted";
      job.status.write_error ??= { target: job.mirrorFile, code: err instanceof Error ? err.message : String(err), at: nowIso() };
      publish(job);
    } finally {
      finish(job, true);
    }
  }
}

function installExitHandler(): void {
  if (exitHandlerInstalled) return;
  exitHandlerInstalled = true;
  // A graceful exit (stdin EOF) leaves the board honest at once instead of after the stall
  // threshold. A hard kill runs no handler; the stall guard covers that case.
  process.on("exit", () => {
    for (const job of jobs.values()) {
      job.status.state = "aborted";
      job.status.current = null;
      if (publish(job)) releaseLock(job);
    }
  });
}

function mirrorStatus(dbPath: string, env: NodeJS.ProcessEnv): BackgroundJob {
  const lockFile = hostLocalPath(dbPath, "render-job.lock", env);
  const job = jobs.get(lockFile);
  let status: JobStatus;
  if (job) {
    status = job.status;
  } else {
    try {
      status = JSON.parse(readFileSync(hostLocalPath(dbPath, "render-job.status.json", env), "utf-8")) as JobStatus;
    } catch {
      return { state: "idle" };
    }
  }
  if (status.state !== "running") return { ...status };
  if (!job && !existsSync(lockFile)) return { ...status, state: "aborted" };
  if (Date.now() - Date.parse(status.updated_at) > status.stall_after_ms) return { ...status, state: "stalled" };
  return { ...status };
}

/** The background job for this database as the host-local mirror (or this process's live job) reports it. */
export function backgroundJobStatus(dbPath: string, env: NodeJS.ProcessEnv = process.env): BackgroundJob {
  return mirrorStatus(dbPath, env);
}

/**
 * Starts the job for one database, or joins the one already running. The lock is taken and the
 * first status written before this returns, so the page's first poll finds a file. An empty queue
 * writes `done` and releases at once, which replaces a status file a killed job left `running`.
 */
export function startRenderJob(options: RenderJobOptions): BackgroundJob {
  const env = options.env ?? process.env;
  const stall = stallMs(env);
  const lockFile = hostLocalPath(options.dbPath, "render-job.lock", env);
  const result = acquire(lockFile, options.dbPath, stall);

  if ("holder" in result) {
    // This process's own running job takes over the pages session entry left to this one.
    const live = jobs.get(lockFile);
    if (live && options.settleFirst) live.settleFirst = true;
    const reported = mirrorStatus(options.dbPath, env);
    if (result.holder && reported.state !== "idle" && "job_id" in reported && reported.job_id === result.holder.job_id) {
      return { ...reported, joined: true } as BackgroundJob;
    }
    return { state: "running", job_id: result.holder?.job_id ?? null, started_at: result.holder?.started_at ?? null, joined: true };
  }

  let resolve!: (summary: JobSummary) => void;
  const promise = new Promise<JobSummary>((r) => (resolve = r));
  const [current = null, ...queued] = options.queue;
  const settleFirst = options.settle !== undefined && options.settleFirst === true;
  const idle = current === null && !settleFirst;
  const job: Job = {
    lockFile,
    mirrorFile: hostLocalPath(options.dbPath, "render-job.status.json", env),
    ...(options.draftDir ? { pageFile: join(options.draftDir, STATUS_FILE) } : {}),
    dbPath: options.dbPath,
    status: {
      job_id: result.acquired.job_id,
      state: idle ? "done" : "running",
      started_at: result.acquired.started_at,
      updated_at: result.acquired.started_at,
      stall_after_ms: stall,
      queued,
      done: [],
      failed: [],
      current,
    },
    rendered: [],
    skip: new Set(),
    render: options.render,
    isFresh: options.isFresh,
    ...(options.settle ? { settle: options.settle } : {}),
    settleFirst,
    promise,
    resolve,
  };
  jobs.set(lockFile, job);
  installExitHandler();
  publish(job);
  const reported = { ...job.status } as BackgroundJob;
  if (idle) finish(job, true);
  else schedule(job);
  return reported;
}

/**
 * A foreground render just wrote this filing. When this process's job still has it to do and it is
 * now fresh under the job's own stamp, the job counts it done and skips it (#588 acceptance 7). A
 * render made with other client fields is not fresh under that stamp, so the job still renders it.
 */
export function markRenderedInForeground(dbPath: string, filingId: number, env: NodeJS.ProcessEnv = process.env): void {
  const job = jobs.get(hostLocalPath(dbPath, "render-job.lock", env));
  if (!job || job.status.state !== "running") return;
  const queuedAt = job.status.queued.indexOf(filingId);
  if (queuedAt === -1 && job.status.current !== filingId) return;
  if (!job.isFresh(filingId)) return;
  job.skip.add(filingId);
  if (queuedAt !== -1) {
    job.status.queued.splice(queuedAt, 1);
    job.status.done.push(filingId);
    publish(job);
  }
}

/**
 * Resolves once every job running in this process has settled. The job's own turns and the Python
 * sidecar are both unref'd, so while this is awaited a ref'd timer keeps the process alive.
 */
export async function awaitBackgroundJobs(): Promise<JobSummary[]> {
  const pending = [...jobs.values()].map((job) => job.promise);
  if (pending.length === 0) return [];
  const keepAlive = setInterval(() => {}, 60_000);
  try {
    return await Promise.all(pending);
  } finally {
    clearInterval(keepAlive);
  }
}
