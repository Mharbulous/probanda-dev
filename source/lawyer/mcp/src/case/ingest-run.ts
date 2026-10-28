// matter_data__ingest_run (ingest orchestrator spec §2.4): one ingestion per matter at a time (G1).
// The lease and an append-only journal sit host-local, in a folder named by the case lock's key, so
// one matter's run state never reaches the synced matter folder. The owner is whoever holds the
// run_id, not a pid: Cowork shares one server process across sessions (case-lock.ts). Every read and
// write of the lease happens under this site's own lock, so a check and its set never interleave.
//
// Stage D1: next and staged return empty lists until D2 adds dispatches.

import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { win32 as pathWin32 } from "node:path";

import { BUILD_STAMP } from "../build-stamp.js";
import { acquireLock, hostLocalDir, lockKey, type LockSite } from "../data-lock.js";
import { DataServerError, ValidationError } from "../errors.js";

const SITE: LockSite = {
  envVar: "COCLERK_INGEST_RUN_ROOT",
  dirName: "ingest-runs",
  attempts: 5,
  recordField: "matterRoot",
  label: "ingest run",
  subject: "matter",
};

/** A lease whose heartbeat is younger than this is live (est., spec §2.4). */
const LIVE_MS = 60 * 60_000;
/** A run folder is deleted this long after its run ended (est., spec §2.4). */
const KEEP_MS = 30 * 24 * 60 * 60_000;

interface Lease {
  run_id: string;
  started: string;
  heartbeat: string;
  build_stamp: string | null;
  mode: "attended" | "unattended";
  ended: string | null;
}

export interface IngestRunArgs {
  matter_root: string;
  action: string;
  run_id?: string;
  resume?: string;
  mode?: string;
}

// What the practitioner may be shown (spec §9 G5): plain words, no internal name. The code goes in `refused`.
const SAY = {
  run_active: "Another ingest of this matter is already under way. Let it finish, or resume it, before starting a new one. Nothing was written.",
  unknown_run: "That ingest has finished, or was never started on this computer, so it cannot be resumed. Nothing was written.",
  lease_lost: "Another session has taken over this ingest of the matter, so this session must stop here. Nothing more was written.",
};

type Refusal = { ok: false; refused: keyof typeof SAY; say: string };
const refusal = (code: keyof typeof SAY): Refusal => ({ ok: false, refused: code, say: SAY[code] });

const leasePath = (dir: string) => pathWin32.join(dir, "lease.json");

function readLease(dir: string): Lease | null {
  return existsSync(leasePath(dir)) ? (JSON.parse(readFileSync(leasePath(dir), "utf-8")) as Lease) : null;
}

function writeLease(dir: string, lease: Lease): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(leasePath(dir), JSON.stringify(lease), "utf-8");
}

function journal(dir: string, event: string, runId: string, extra: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), event, run_id: runId, ...extra });
  appendFileSync(pathWin32.join(dir, "journal.jsonl"), line + "\n", "utf-8");
}

const isLive = (lease: Lease | null): boolean =>
  lease !== null && lease.ended === null && Date.now() - Date.parse(lease.heartbeat) < LIVE_MS;

async function underLock<T>(matterRoot: string, env: NodeJS.ProcessEnv, work: (dir: string) => T): Promise<T> {
  const lock = await acquireLock(SITE, matterRoot, env);
  try {
    return work(pathWin32.join(hostLocalDir(SITE, env), lockKey(matterRoot)));
  } finally {
    lock.release();
  }
}

/** Renews the heartbeat of `runId`'s lease; null when `runId` no longer holds an unfinished lease. */
function renew(dir: string, runId: string): Lease | null {
  const lease = readLease(dir);
  if (lease === null || lease.ended !== null || lease.run_id !== runId) return null;
  lease.heartbeat = new Date().toISOString();
  writeLease(dir, lease);
  return lease;
}

/** Deletes each run folder whose run ended more than KEEP_MS ago. */
function sweep(env: NodeJS.ProcessEnv): void {
  const root = hostLocalDir(SITE, env);
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = pathWin32.join(root, entry.name);
    const lease = readLease(dir);
    if (lease?.ended && Date.now() - Date.parse(lease.ended) > KEEP_MS) rmSync(dir, { recursive: true, force: true });
  }
}

function requireRunId(args: IngestRunArgs): string {
  if (typeof args.run_id !== "string") throw new ValidationError(`${args.action} needs run_id`);
  return args.run_id;
}

/**
 * matter_data__execute's run check: a write carrying `runId` goes ahead only while `runId` holds the
 * matter's lease, and renews its heartbeat.
 */
export async function assertLiveRun(matterRoot: string, runId: string, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const held = await underLock(matterRoot, env, (dir) => renew(dir, runId));
  if (held === null) throw new DataServerError(SAY.lease_lost, "lease_lost");
}

export async function ingestRun(args: IngestRunArgs, env: NodeJS.ProcessEnv = process.env): Promise<unknown> {
  switch (args.action) {
    case "begin": {
      const mode = args.mode;
      if (mode !== "attended" && mode !== "unattended") throw new ValidationError("begin needs mode attended or unattended");
      sweep(env);
      return underLock(args.matter_root, env, (dir) => {
        const current = readLease(dir);
        const now = new Date().toISOString();
        const runId = randomUUID();
        if (args.resume !== undefined) {
          if (current === null || current.ended !== null || current.run_id !== args.resume) return refusal("unknown_run");
          // A new id for the resuming session, so the displaced one is refused at its next call.
          writeLease(dir, { ...current, run_id: runId, heartbeat: now, build_stamp: BUILD_STAMP, mode });
          journal(dir, "takeover", runId, { displaced: current.run_id });
          return { ok: true, run_id: runId, resumed: true, next: [] };
        }
        if (current !== null && isLive(current)) return { ...refusal("run_active"), run_id: current.run_id };
        if (current !== null && current.ended === null) journal(dir, "takeover", runId, { displaced: current.run_id });
        writeLease(dir, { run_id: runId, started: now, heartbeat: now, build_stamp: BUILD_STAMP, mode, ended: null });
        journal(dir, "begin", runId, { mode });
        return { ok: true, run_id: runId, resumed: false, next: [] };
      });
    }
    case "status":
      return underLock(args.matter_root, env, (dir) => {
        if (args.run_id !== undefined && renew(dir, args.run_id) === null) return refusal("lease_lost");
        const lease = readLease(dir);
        return {
          ok: true,
          active: isLive(lease),
          run_id: lease?.run_id ?? null,
          started: lease?.started ?? null,
          heartbeat: lease?.heartbeat ?? null,
          mode: lease?.mode ?? null,
          ended: lease?.ended ?? null,
          next: [],
        };
      });
    case "next":
    case "staged": {
      const runId = requireRunId(args);
      return underLock(args.matter_root, env, (dir) => (renew(dir, runId) === null ? refusal("lease_lost") : { ok: true, items: [] }));
    }
    case "end": {
      const runId = requireRunId(args);
      return underLock(args.matter_root, env, (dir) => {
        const lease = renew(dir, runId);
        if (lease === null) return refusal("lease_lost");
        writeLease(dir, { ...lease, ended: lease.heartbeat });
        journal(dir, "end", runId);
        return { ok: true, run_id: runId };
      });
    }
    default:
      throw new ValidationError(`unknown action ${JSON.stringify(args.action)}; expected begin, next, staged, status or end`);
  }
}
