// matter_data__ingest_run (ingest orchestrator spec §2.4, group locking spec): several runs may share
// a matter, each holding a claim on the files it is reading. Each run's lease and append-only journal
// sit host-local, in its own folder under a folder named by the case lock's key, so one matter's run
// state never reaches the synced matter folder. The owner is whoever holds the run_id, not a pid:
// Cowork shares one server process across sessions (case-lock.ts). Every read and write of a lease
// or a journal happens under this site's own per-matter lock, so a check and its set never
// interleave. A run's claims are worked out from its journal, so no claims file can fall out of step.
//
// Stage D2 adds the dispatch list (§6.1, §8): `next` takes the orchestrator's routed files, plans
// today's passes from the journal alone (so a resume after a crash or a compaction needs no memory,
// R9), stores each dispatch's inputs beside the journal for matter_data__dispatch_inputs, and lists
// the acknowledged results still to be written. `staged` records a bridged session's copies (§6.5).

import { createHash, randomUUID } from "node:crypto";
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, renameSync, rmdirSync, rmSync, statSync, truncateSync, unlinkSync, writeFileSync } from "node:fs";
import { win32 as pathWin32 } from "node:path";

import { BUILD_STAMP } from "../build-stamp.js";
import { exclusiveHeld, matterRevision } from "./case-lock.js";
import { acquireLock, hostLocalDir, lockKey, type LockSite } from "../data-lock.js";
import { DataServerError, ValidationError } from "../errors.js";
import { classifyPdfPages, pdfPageImages } from "../files/extract/page-images.js";
import { caseDataFolder } from "./backend.js";
import { runCaseScript } from "./case-script.js";
import { dropStagedResults, stagedResultPath } from "./stage-result.js";

const SITE: LockSite = {
  envVar: "COCLERK_INGEST_RUN_ROOT",
  dirName: "ingest-runs",
  // Several runs now take turns on it, each for a moment.
  attempts: 25,
  recordField: "matterRoot",
  label: "ingest run",
  subject: "matter",
  staleMs: 5 * 60_000,
  breakDead: true,
};

/** A lease whose heartbeat is younger than this is live (est., spec §2.4). */
const LIVE_MS = 60 * 60_000;
/** A run folder is deleted this long after its run ended, or its last heartbeat (est., spec §2.4). */
const KEEP_MS = 30 * 24 * 60 * 60_000;
/** Extractors running at once on this computer: #70's wave size, kept as a concurrency limit (spec
 *  §8.1, group locking spec 5.6). */
const WINDOW = 10;
/** A dispatch this old stops counting against WINDOW, so a crashed session's readers free their slots
 *  without waiting out LIVE_MS. */
const SLOT_MS = 30 * 60_000;
/** How long, and how often, `next` looks for a free slot before telling the caller to call again. It
 *  stays well under the bridge's 60 seconds. */
const SLOT_WAIT_MS = 30_000;
const SLOT_POLL_MS = 5_000;
/** A write kept waiting this long, across calls, is reported (group locking spec section 10). */
const WAIT_REPORT_MS = 2 * 60_000;
/** Lines per `next` page (est., spec §1.5). */
const PAGE = 50;
/** Pages per read (#70) and per boundary-scan batch (ingest-extract.md Pass 2). */
const READ_PAGES = 20;
const SCAN_PAGES = 40;
/** The contract version every D2 extractor stages (spec §6.2); R7 refuses any other. Version 2: Pass 1
 *  carries informant_privileged and the sworn date, and a privilege_signal sends a document to Path B (N19). */
export const CONTRACT_VERSION = 2;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** A refused write whose reason clears without a new extraction: it is listed again (S-m8). A write
 *  refused `needs_answer` waits for the practitioner instead, listed under `asked` (N10). */
const RETRYABLE = ["waiting"];
/** A write refused for a reason no repeat clears: a store change, a race, a document for Path B or /ingest. */
const blocks = (e: Record<string, unknown>) => e.outcome === "refused" && e.reason !== "needs_answer"
  && e.reason !== "invalid" && !RETRYABLE.includes(String(e.reason));
/** The file faults a dispatch's inputs can meet: each fails its item alone (S-M2, N14). A file too
 *  large for the renderer's memory is one (m-3); a renderer that does not load is not. */
const ITEM_FAULTS = ["not_found", "not_pdf", "password_protected", "bad_pages", "page_too_large", "file_too_large"];

interface Lease {
  run_id: string;
  started: string;
  heartbeat: string;
  build_stamp: string | null;
  mode: "attended" | "unattended";
  ended: string | null;
  /** Begun by the ingest orchestrator: an inline sql_script over 8 KB is refused in it (spec §2.5, N3). */
  orchestrator?: boolean;
  /** The matter the run belongs to, so a swept run's page images can be found (N13). */
  matter_root?: string;
}

/** A file the orchestrator routed by today's gate (spec §11 D2, interim classifier). */
export interface Route {
  ref: string;
  file_path: string;
  file_hash: string;
  /** `path_b`: an internal document the session reads itself (Path B); journaled so a resume lists it (N-10). */
  kind: "facts" | "notice_of_application" | "affidavit" | "path_b";
  /** An email's attachment files, claimed with it, all or none (group locking spec 5.1). */
  attachment_hashes?: string[];
  /** A .docx/.eml/.msg rendering, a host path (ingest-extract.md "Document pre-processing"). */
  rendering?: string;
  execution?: "draft" | "affirmed" | "filed";
  witness?: "fact" | "expert";
  answers_source_id?: number;
  category?: string;
  proceeding_id?: number;
}

export interface IngestRunArgs {
  matter_root: string;
  action: string;
  run_id?: string;
  resume?: string;
  mode?: string;
  orchestrator?: boolean;
  routes?: Array<Omit<Route, "ref">>;
  bridged?: boolean;
  ack?: string;
  dispatch_id?: string;
  paths?: string[];
  /** action claim: files a path that routes nothing through `next` is about to read. */
  files?: ClaimFile[];
}

export interface ClaimFile {
  file_path: string;
  file_hash: string;
  attachment_hashes?: string[];
}

type Event = { ts: string; event: string; run_id: string; [k: string]: unknown };

// What the practitioner may be shown (spec §9 G5): plain words, no internal name. The code goes in `refused`.
const SAY = {
  matter_busy: "This matter is busy with a change that affects the whole file. Try the ingest again shortly. Nothing was written.",
  run_unfinished: "An earlier ingest of this matter stopped before it finished, and some of what it read is not yet recorded. Resume it to record that, or start afresh and those documents will be read again. Nothing was written.",
  unknown_run: "That ingest has finished, or was never started on this computer, so it cannot be resumed. Nothing was written.",
  lease_lost: "Another session has taken over this ingest of the matter, so this session must stop here. Nothing more was written.",
  plugin_changed: "Probanda was updated while this ingest was running. Restart, and the ingest will resume where it stopped. Nothing more was written.",
};

/** A report line when page images could not be deleted, most often because another program holds
 *  them (N-5, N-12, M-1, m-5). */
const IMAGES_LEFT = "Some page images made for an ingest could not be deleted yet, perhaps because another program is using them. They will be deleted after a later ingest.";
/** A report line when an earlier run's own records on this computer could not be checked or deleted (M-1, m-5). */
const RECORDS_LEFT = "Some working files an ingest keeps on this computer could not be checked or deleted, so they were left as they are. They will be tried again after a later ingest.";
/** A report line when a plain begin displaces a run that still had results to record (m-6). */
const DISPLACED = "An earlier ingest of this matter stopped before it finished. What it read but had not yet recorded was set aside, and those documents will be read again when they are next ingested.";
/** A report line when a crash cut short a step a run saved, this run's own included, or an older build
 *  joined that step to the next (round 5, 1; round 6, N4, N7). */
const STEP_LOST = "An ingest of this matter was cut off while saving its progress. One step it saved could not be read and may be done again.";
/** A report line when begin cannot read an earlier run's record: a plain begin takes the run over, a
 *  resume is refused (round 5, 1; round 6, N7). */
const RUN_UNREADABLE = "The record of an earlier ingest of this matter could not be read. Anything it read but had not yet recorded will be read again when those documents are next ingested.";
/** Report lines when end deletes, or cannot yet delete, what was read for a privilege question still open (round 5, 7). */
const PRIVILEGED_DROPPED = "What was read from documents whose privilege question is still open was deleted as this ingest ended. They will be read again when they are next ingested.";
const PRIVILEGED_LEFT = "Some of what was read from documents whose privilege question is still open could not be deleted yet. It is deleted within 7 days.";

/** The section 10 lines (group locking spec), each naming its file. */
const shortName = (path: string) => pathWin32.basename(path).slice(0, 80);
const LEFT_OUT = (name: string) => `${name} is being ingested in another session, so I left it out of this run.`;
const JUST_HELD = (name: string) => `${name} has just been added to this matter in another session, so I left it out of this run.`;
const PICKED_UP = (names: string[]) => `An earlier ingest of ${names.join(", ")} stopped without finishing. I've taken those files into this run.`;
const TAKEN = (name: string) => `${name} was taken into another session's ingest while this one was stopped, so nothing more was recorded for it here.`;
const SAVING = (name: string) => `Another session is saving to this matter. ${name} will be saved once it finishes.`;

export type Refusal = { ok: false; refused: keyof typeof SAY | "taken"; say: string };
const refusal = (code: keyof typeof SAY): Refusal => ({ ok: false, refused: code, say: SAY[code] });

/** Each folder left behind is reported once by this server, not at every begin or end (n-4). */
const reported = new Set<string>();
/** The report line for the folders in `left` not said yet, and those folders, which the caller marks
 *  as said only once it returns the line, so a refusal or an error loses none (round 5 nit 9). */
type Said = { lines: string[]; keys: string[] };
function sayOnce(left: string[], line: string): Said {
  const keys = left.filter((key) => !reported.has(key));
  return { lines: keys.length > 0 ? [line] : [], keys };
}
const reportLines = (report: string[]) => (report.length > 0 ? { report } : {});

const leasePath = (dir: string) => pathWin32.join(dir, "lease.json");
/** A run's lease, or null when it is missing or a crash cut it short. */
function leaseOrNull(dir: string): Lease | null {
  try {
    return readLease(dir);
  } catch (err) {
    if (err instanceof SyntaxError) return null;
    throw err;
  }
}
const dispatchPath = (dir: string, id: string) => pathWin32.join(dir, "dispatches", `${id}.json`);

function readLease(dir: string): Lease | null {
  return existsSync(leasePath(dir)) ? (JSON.parse(readFileSync(leasePath(dir), "utf-8")) as Lease) : null;
}

/** The codes a rename over lease.json gives on Windows while another program (an antivirus scan, an
 *  indexer, another server's sweep) holds the file for a moment. */
const HELD = ["EPERM", "EACCES", "EBUSY"];

/** Runs `op`, trying it again for about a second while another program holds its file up, as
 *  graceful-fs does (round 5, 2; round 6, N5). */
function whileHeld(op: () => void): void {
  for (let attempt = 1; ; attempt++) {
    try {
      op();
      return;
    } catch (err) {
      if (attempt >= 10 || !HELD.includes(String((err as NodeJS.ErrnoException).code))) throw err;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    }
  }
}

/** Written whole or not at all: a temp file in the same folder, then renamed over lease.json (M-1). */
function writeLease(dir: string, lease: Lease): void {
  mkdirSync(dir, { recursive: true });
  const temp = pathWin32.join(dir, "lease.tmp");
  writeFileSync(temp, JSON.stringify(lease), "utf-8");
  whileHeld(() => renameSync(temp, leasePath(dir)));
}

const journalPath = (dir: string) => pathWin32.join(dir, "journal.jsonl");
/** Run folders whose journal's last line a crash cut short mid-append, or holds a line that cannot be
 *  read, said at the next begin or end (round 5, 1; round 6, N4). */
const torn = new Set<string>();
/** Each unreadable journal line already put in `torn`, by folder and line number, so it is said once (N4). */
const unreadableLines = new Set<string>();

/** The journal's last byte, read through a handle rather than reading the whole journal (round 6, N6). */
function lastByte(path: string): number | null {
  const size = statSync(path).size;
  if (size === 0) return null;
  const fd = openSync(path, "r");
  try {
    const byte = Buffer.alloc(1);
    readSync(fd, byte, 0, 1, size - 1);
    return byte[0];
  } finally {
    closeSync(fd);
  }
}

function journal(dir: string, event: string, runId: string, extra: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), event, run_id: runId, ...extra });
  const path = journalPath(dir);
  // A line a crash cut short is dropped before the next is added, so no line is ever joined to it.
  if (existsSync(path) && ![null, 0x0a].includes(lastByte(path))) {
    const bytes = readFileSync(path);
    truncateSync(path, bytes.lastIndexOf(0x0a) + 1);
    torn.add(dir);
  }
  // An append another program holds up is tried again, so a begin never leaves a lease it has just
  // written with no journal line behind it (round 6, N5).
  whileHeld(() => appendFileSync(path, line + "\n", "utf-8"));
}

function readJournal(dir: string): Event[] {
  const path = journalPath(dir);
  if (!existsSync(path)) return [];
  const lines = readFileSync(path, "utf-8").split("\n");
  // What follows the last newline is a line a crash cut short mid-append, never a whole event. Said
  // once: a stale run's journal stays as it is, and may be read at every begin.
  if (lines.pop() !== "") {
    const key = `${dir}\ntail ${lines.length}`;
    if (!unreadableLines.has(key)) {
      unreadableLines.add(key);
      torn.add(dir);
    }
  }
  // A whole line that cannot be read (one an older build joined to a cut-short line) is skipped, and
  // said once at the next begin or end, rather than block the matter for good (round 6, N4).
  const events: Event[] = [];
  lines.forEach((l, i) => {
    if (l.trim() === "") return;
    try {
      events.push(JSON.parse(l) as Event);
    } catch (err) {
      if (!(err instanceof SyntaxError)) throw err;
      const key = `${dir}\n${i}`;
      if (!unreadableLines.has(key)) {
        unreadableLines.add(key);
        torn.add(dir);
      }
    }
  });
  return events;
}

/** The events of the run in the lease: from its last begin, through every takeover since. Records
 *  held back for this folder (unjournaled) are journaled first when they belong to that run, so every
 *  caller plans from them (N-7). Called only under the run lock. */
function runEvents(dir: string): Event[] {
  const events = readJournal(dir);
  let start = 0;
  events.forEach((e, i) => {
    if (e.event === "begin") start = i;
  });
  const run = events.slice(start);
  const held = unjournaled.get(dir);
  if (held === undefined) return run;
  unjournaled.delete(dir);
  // A record of a run a plain begin displaced is dropped: the new run's refs start again at f1.
  const lineage = new Set(run.map((e) => e.run_id));
  const kept = held.filter((r) => lineage.has(r.runId));
  for (const r of kept) journal(dir, r.event, r.runId, r.extra);
  return kept.length > 0 ? runEvents(dir) : run;
}

const isLive = (lease: Lease | null): boolean =>
  lease !== null && lease.ended === null && Date.now() - Date.parse(lease.heartbeat) < LIVE_MS;

const matterDirOf = (matterRoot: string, env: NodeJS.ProcessEnv) => pathWin32.join(hostLocalDir(SITE, env), lockKey(matterRoot));

/** Moves a run left in the matter's folder by a build from before several runs could share a matter
 *  into a run folder of its own, so it can still be resumed (F9). Its lease moves last, so a move a
 *  crash cuts short is finished next time. */
function adoptOldLayout(matterDir: string): void {
  if (!existsSync(leasePath(matterDir))) return;
  const started = Date.parse(String(leaseOrNull(matterDir)?.started));
  const dir = pathWin32.join(matterDir, `legacy-${Number.isNaN(started) ? "unreadable" : started}`);
  mkdirSync(dir, { recursive: true });
  for (const name of ["journal.jsonl", "dispatches", "lease.tmp", "lease.json"]) {
    const from = pathWin32.join(matterDir, name);
    if (existsSync(from)) whileHeld(() => renameSync(from, pathWin32.join(dir, name)));
  }
}

/** Every run folder of a matter. */
function runFolders(matterDir: string): string[] {
  if (!existsSync(matterDir)) return [];
  return readdirSync(matterDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => pathWin32.join(matterDir, e.name));
}

/** The folder of the run `runId` holds now, or null. */
function findRun(matterDir: string, runId: string): string | null {
  return runFolders(matterDir).find((dir) => leaseOrNull(dir)?.run_id === runId) ?? null;
}

async function underLock<T>(matterRoot: string, env: NodeJS.ProcessEnv, work: (matterDir: string) => T | Promise<T>): Promise<T> {
  const lock = await acquireLock(SITE, matterRoot, env);
  try {
    const matterDir = matterDirOf(matterRoot, env);
    adoptOldLayout(matterDir);
    return await work(matterDir);
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

type HeldRun = Lease & { dir: string };

/** renew, and R7: a running bundle whose stamp differs from the one recorded at begin is refused. */
function hold(matterDir: string, runId: string): HeldRun | Refusal {
  const dir = findRun(matterDir, runId);
  const lease = dir === null ? null : renew(dir, runId);
  if (dir === null || lease === null) return refusal("lease_lost");
  if (lease.build_stamp !== BUILD_STAMP) return refusal("plugin_changed");
  return { ...lease, dir };
}

/** Deletes a host-local folder this server made: a run folder, or a run's dispatches folder. A run
 *  folder's lease.json goes last, so a folder a delete error leaves part-way is swept again (round 5 nit 10). */
function removeOwn(path: string): void {
  const rest = existsSync(path) ? readdirSync(path).filter((name) => name !== "lease.json").map((name) => pathWin32.join(path, name)) : [];
  for (const target of [...rest, path]) rmSync(target, { recursive: true, force: true });
}

/** The names the page renderer gives its images (page-images.ts pageName, four digits or more), in
 *  its per-PDF folder. */
const RENDERED = /^page-\d{4,}(-tile-\d+)?\.png$/;

/** Deletes the page images the renderer wrote for one bridged dispatch, and each folder that leaves
 *  empty; a file anyone else put there stays, with its folder (N-13). False when any delete fails,
 *  whatever the error (a file in use, or a cloud-file provider's own error): the folder is left for a
 *  later end or sweep, and never stops the run's calls (N-5, N-12, M-1, m-5). */
function removeImageFolder(folder: string): boolean {
  try {
    if (!existsSync(folder)) return true;
    for (const sub of readdirSync(folder, { withFileTypes: true })) {
      if (!sub.isDirectory() || !/^[0-9a-f]{16}$/.test(sub.name)) continue;
      const pdfDir = pathWin32.join(folder, sub.name);
      for (const name of readdirSync(pdfDir)) if (RENDERED.test(name)) unlinkSync(pathWin32.join(pdfDir, name));
      if (readdirSync(pdfDir).length === 0) rmdirSync(pdfDir);
    }
    if (readdirSync(folder).length === 0) rmdirSync(folder);
    reported.delete(folder);
    return true;
  } catch {
    return false;
  }
}

/** Deletes the page images of every dispatch the run folder's journal records, a run displaced or
 *  never ended included (N13): at an end, only since the last end that deleted all of its own
 *  (N-19); in the sweep (`all`), every one. Returns the image folders left. */
function removeImages(dir: string, matterRoot: string, all = false): string[] {
  const events = readJournal(dir);
  let start = 0;
  if (!all) {
    events.forEach((e, i) => {
      if (e.event === "end" && e.images_left !== true) start = i + 1;
    });
  }
  const left: string[] = [];
  for (const e of events.slice(start)) {
    if (e.event !== "dispatch") continue;
    const folder = imagesDir(matterRoot, e.dispatch_id as string);
    if (!removeImageFolder(folder)) left.push(folder);
  }
  return left;
}

const expired = (lease: Lease | null): boolean => {
  const last = lease?.ended ?? lease?.heartbeat;
  return last !== undefined && Date.now() - Date.parse(last) > KEEP_MS;
};

/** Deletes each run folder whose run ended, or whose last heartbeat came, more than KEEP_MS ago, with
 *  its page images. Each is checked again under its own lock, so a run another session is renewing
 *  is left alone (N13). A lock another session holds now leaves that folder to a later sweep; so
 *  does any error in one folder, its lease's read included, and an image that cannot be deleted
 *  (N-5, M-1): none stops this begin. Returns the report lines for what was left, each folder said
 *  once (n-4). An error in the begin's own run folder (`own`) is left to that begin, which reads it
 *  again under its lock and says what it finds (round 5, 1). */
async function sweep(env: NodeJS.ProcessEnv, own: string): Promise<Said> {
  const root = hostLocalDir(SITE, env);
  const imagesLeft: string[] = [];
  const recordsLeft: string[] = [];
  const dirs: Array<{ dir: string; key: string; matterDir: string }> = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const matterDir = pathWin32.join(root, entry.name);
    try {
      adoptOldLayout(matterDir);
      for (const dir of runFolders(matterDir)) dirs.push({ dir, key: entry.name, matterDir });
    } catch {
      if (matterDir !== own) recordsLeft.push(matterDir);
    }
  }
  for (const { dir, key, matterDir } of dirs) {
    try {
      const lease = readLease(dir);
      if (!expired(lease)) continue;
      const matterRoot = lease?.matter_root;
      if (matterRoot === undefined || lockKey(matterRoot) !== key) {
        // A run from before the lease named its matter (a single-document ingest, which renders no
        // images), or a lease that names another folder's matter: only the run folder goes (N-17).
        removeOwn(dir);
        reported.delete(dir);
        torn.delete(dir);
        continue;
      }
      let lock;
      try {
        // One attempt: a lock held now leaves the folder to a later sweep without a wait (N-17).
        lock = await acquireLock({ ...SITE, attempts: 1 }, matterRoot, env);
      } catch (err) {
        if ((err as DataServerError).code === "lock_unavailable") continue;
        throw err;
      }
      try {
        if (expired(readLease(dir))) {
          const left = removeImages(dir, matterRoot, true);
          if (left.length === 0) {
            removeOwn(dir);
            reported.delete(dir);
            torn.delete(dir);
          } else imagesLeft.push(...left);
        }
      } finally {
        lock.release();
      }
    } catch {
      if (matterDir !== own) recordsLeft.push(dir);
    }
  }
  for (const matterDir of new Set(dirs.map((d) => d.matterDir))) {
    try {
      if (readdirSync(matterDir).length === 0) rmdirSync(matterDir);
    } catch {
      // Another session has just begun a run there, or the folder is held for a moment: left for a later sweep.
    }
  }
  const images = sayOnce(imagesLeft, IMAGES_LEFT);
  const records = sayOnce(recordsLeft, RECORDS_LEFT);
  return { lines: [...images.lines, ...records.lines], keys: [...images.keys, ...records.keys] };
}

function requireRunId(args: { run_id?: string; action?: string }): string {
  if (typeof args.run_id !== "string") throw new ValidationError(`${args.action ?? "this call"} needs run_id`);
  return args.run_id;
}

/**
 * matter_data__execute's run check, made inside the case lock (N6): a write carrying `runId` goes
 * ahead only while `runId` holds the matter's lease under the bundle that began it (R7), and renews
 * its heartbeat. Returns whether the ingest orchestrator began the run (the inline cap, N3).
 */
export async function assertLiveRun(matterRoot: string, runId: string, env: NodeJS.ProcessEnv = process.env): Promise<{ orchestrator: boolean }> {
  const held = await underLock(matterRoot, env, (matterDir) => hold(matterDir, runId));
  if ("refused" in held) throw new DataServerError(held.say, held.refused);
  return { orchestrator: held.orchestrator === true };
}

/** What `events` says another run has taken from this one (group locking spec 5.5). */
const takenHashes = (events: Event[]) => new Set(events.filter((e) => e.event === "taken").map((e) => e.file_hash as string));

/** ingest_result's second check, made inside the case lock just before its write (R8): null while
 *  `runId` still holds the lease, and no other run has taken the file from it. */
export async function checkRun(matterRoot: string, runId: string, env: NodeJS.ProcessEnv = process.env, route?: Route | null): Promise<Refusal | null> {
  return underLock(matterRoot, env, (matterDir) => {
    const held = hold(matterDir, runId);
    if ("refused" in held) return held;
    if (route && takenHashes(runEvents(held.dir)).has(route.file_hash)) return { ok: false, refused: "taken", say: TAKEN(shortName(route.file_path)) };
    return null;
  });
}

// ---------------------------------------------------------------- the plan (spec §8, today's passes)

/** One extractor task: `f3` a document or an affidavit body, `f3:so` its sought orders, `f3:p2:1` a
 *  boundary-scan batch, `f3:B` an exhibit. */
interface Item {
  ref: string;
  agent: string;
  contract: string | null;
  route: Route;
  pass?: 1 | 2 | 3;
  pages?: [number, number];
  letter?: string;
}

/** `blocked`: its result was refused for a reason a repeat cannot clear (a store change, a race, a
 *  document for Path B or for /ingest): neither written nor listed again. `asked`: its write waits
 *  for the practitioner's answer (N10): listed apart, never as a write to repeat. */
type ItemState = "new" | "in_flight" | "acked" | "asked" | "written" | "failed" | "blocked";

interface Ledger {
  routes: Route[];
  state(ref: string): { state: ItemState; result_id?: string; failures: number };
  written: (contract: string, ref: string) => Event | undefined;
  /** The last write event for `ref` under `contract`, whatever its outcome. */
  lastWrite: (contract: string, ref: string) => Event | undefined;
  pageCount(ref: string): number | undefined;
}

function ledger(events: Event[]): Ledger {
  const routes = events.filter((e) => e.event === "route").map((e) => e.route as Route);
  let lastTakeover = -1;
  events.forEach((e, i) => {
    if (e.event === "takeover") lastTakeover = i;
  });
  // Each result's latest write decides it: an answered write after a question clears the question.
  const outcomeOf = new Map<string, "written" | "blocked" | "asked">();
  for (const e of events) {
    if (e.event !== "write") continue;
    const ids = (e.result_ids as string[]) ?? [];
    if (e.outcome === "written" || e.outcome === "already_written") ids.forEach((id) => outcomeOf.set(id, "written"));
    else if (e.reason === "needs_answer") ids.forEach((id) => outcomeOf.get(id) !== "written" && outcomeOf.set(id, "asked"));
    else if (blocks(e)) ids.forEach((id) => outcomeOf.set(id, "blocked"));
  }
  // A dispatch whose inputs could not be built for a reason outside the item is void (S-M2).
  const voided = new Set(events.filter((e) => e.event === "void").map((e) => e.dispatch_id as string));
  return {
    routes,
    state(ref) {
      let failures = 0;
      let lastDispatch = -1;
      let last: Event | undefined;
      events.forEach((e, i) => {
        if (e.ref !== ref) return;
        if (e.event === "dispatch" && !voided.has(e.dispatch_id as string)) lastDispatch = i;
        if (e.event === "ack") {
          last = e;
          if (!e.ok) failures += 1;
        }
      });
      const lastAck = last ? events.indexOf(last) : -1;
      if (last && lastAck > lastDispatch) {
        if (last.ok) {
          const id = last.result_id as string;
          return { state: outcomeOf.get(id) ?? "acked", result_id: id, failures };
        }
        return { state: failures >= 2 ? "failed" : "new", failures };
      }
      // A dispatch made before the last takeover never came back: dispatched again, not a failure.
      if (lastDispatch > lastTakeover) return { state: "in_flight", failures };
      return { state: "new", failures };
    },
    written: (contract, ref) =>
      events.find((e) => e.event === "write" && e.contract === contract && (e.refs as string[]).includes(ref)
        && (e.outcome === "written" || e.outcome === "already_written")),
    lastWrite: (contract, ref) =>
      events.filter((e) => e.event === "write" && e.contract === contract && (e.refs as string[]).includes(ref)).pop(),
    pageCount: (ref) => {
      const d = events.find((e) => (e.event === "dispatch" || e.event === "inputs") && e.ref === ref && typeof e.page_count === "number");
      return d?.page_count as number | undefined;
    },
  };
}

function staged(resultId: string, env: NodeJS.ProcessEnv): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(stagedResultPath(resultId, env), "utf-8")) as Record<string, unknown>;
  } catch {
    return null; // expired (R10) or unreadable: the item is planned again
  }
}

/** A staged result that can still be written: present (R10) and of this build's contract version (R7). */
function usable(resultId: string | undefined, env: NodeJS.ProcessEnv): boolean {
  return resultId !== undefined && staged(resultId, env)?.contract_version === CONTRACT_VERSION;
}

/** An affidavit's exhibit work as far as the journal (its body write records Pass 1's exhibit list,
 *  N9) and the staged Pass 2 results show it. */
export interface AffidavitPlan {
  /** Each with `redo` when its staged result can no longer be read (R10, R7). */
  items: Array<Item & { redo?: boolean }>;
  expected: string[];
  failed: string[];
  deferred: string[];
  uncertain: string[];
  /** Every boundary-scan batch has come back, so the exhibit list is known. */
  located: boolean;
}

function affidavitPlan(route: Route, l: Ledger, env: NodeJS.ProcessEnv): AffidavitPlan {
  const empty: AffidavitPlan = { items: [], expected: [], failed: [], deferred: [], uncertain: [], located: false };
  const body = l.state(route.ref);
  if (body.state !== "written" || route.rendering) return { ...empty, located: body.state === "written" };
  // Read from the journal, never from the staged Pass 1 result: one that expired would otherwise
  // send the whole body to be read and written again (N9).
  const pass1 = l.written("affidavit_body", route.ref) ?? ({} as Partial<Event>);
  const inventory = (Array.isArray(pass1.inventory) ? pass1.inventory : []) as Array<Record<string, unknown>>;
  const letters = inventory.map((e) => String(e.letter ?? "").trim()).filter((s) => s !== "");
  let bounds: Array<{ letter: string; start: number; end: number; uncertain: boolean }> = [];
  const items: AffidavitPlan["items"] = [];
  const stated = inventory.length > 0 && inventory.every((e) => Number(e.page_start) > 0 && Number(e.page_end) >= Number(e.page_start));
  let located = true;
  if (stated) {
    bounds = inventory.map((e) => ({ letter: String(e.letter), start: Number(e.page_start), end: Number(e.page_end), uncertain: false }));
  } else {
    // Pass 2 over the pages after the body, in ~40-page batches, whenever Pass 1 gave no page
    // starts, an empty inventory included (ingest-extract.md Pass 2).
    const count = l.pageCount(route.ref) ?? 0;
    const first = Math.max(Number(pass1.body_page_count) || 1, 1) + 1;
    for (let k = 0, start = first; start <= count; k++, start += SCAN_PAGES) {
      const item: Item = { ref: `${route.ref}:p2:${k + 1}`, agent: "lawyer:extract-affidavit", contract: null, route, pass: 2, pages: [start, Math.min(count, start + SCAN_PAGES - 1)] };
      const s = l.state(item.ref);
      if (s.state === "acked" || s.state === "written") {
        const result = s.result_id && usable(s.result_id, env) ? staged(s.result_id, env) : null;
        if (result === null) {
          items.push({ ...item, redo: true });
          located = false;
          continue;
        }
        for (const b of (result.boundaries ?? []) as Array<Record<string, unknown>>) {
          bounds.push({ letter: String(b.letter), start: Number(b.content_start), end: Number(b.content_end), uncertain: b.ocr_uncertain === true });
        }
      } else if (s.state !== "failed") located = false;
      items.push(item);
    }
  }
  if (!located) return { ...empty, items };
  const seen = new Set<string>();
  bounds = bounds.filter((b) => b.letter !== "" && !seen.has(b.letter) && seen.add(b.letter) && b.start > 0 && b.end >= b.start);
  const expected = bounds.map((b) => b.letter);
  const failed: string[] = [];
  for (const b of bounds) {
    const item: Item = { ref: `${route.ref}:${b.letter}`, agent: "lawyer:extract-affidavit", contract: "affidavit_exhibits", route, pass: 3, pages: [b.start, b.end], letter: b.letter };
    const s = l.state(item.ref);
    items.push(s.state === "acked" && !usable(s.result_id, env) ? { ...item, redo: true } : item);
    if (s.state === "failed") failed.push(b.letter);
  }
  return {
    items,
    expected,
    failed,
    deferred: letters.filter((x) => !seen.has(x)),
    uncertain: bounds.filter((b) => b.uncertain).map((b) => b.letter),
    located: true,
  };
}

/** What the orchestrator does next: extractors to start, acknowledged results to write, and
 *  documents whose extraction failed twice to close with their honest status (R4). A write or close
 *  line names the file by its `ref`, which ingest_result takes in place of the path and hash (R9). */
function plan(events: Event[], env: NodeJS.ProcessEnv) {
  const l = ledger(events);
  const dispatch: Item[] = [];
  type Line = { ref: string; contract: string; result_ids: string[] };
  const write: Line[] = [];
  const close: Array<{ ref: string; contract: string }> = [];
  // Writes and closes that wait for the practitioner's answer (N10): never a write to repeat.
  const asked: Line[] = [];
  let inFlight = 0;
  const inFlightRefs: string[] = [];
  const running = (ref: string) => {
    inFlight += 1;
    inFlightRefs.push(ref);
  };
  const taken = takenHashes(events);
  const consider = (item: Item, writable = true) => {
    const s = l.state(item.ref);
    if (s.state === "in_flight") running(item.ref);
    // An acknowledged result that expired (R10) or was staged under another contract version (R7)
    // is extracted again rather than listed for a write that would be refused.
    const stale = (s.state === "acked" || s.state === "asked") && !usable(s.result_id, env);
    if (s.state === "new" || stale) dispatch.push(item);
    else if (s.state === "acked" && item.contract && writable) write.push({ ref: item.ref, contract: item.contract, result_ids: [s.result_id as string] });
    else if (s.state === "asked" && item.contract) asked.push({ ref: item.ref, contract: item.contract, result_ids: [s.result_id as string] });
    return s;
  };
  /** An item whose extraction failed twice is closed, unless its close waits for an answer. */
  const closeOrAsk = (contract: string, ref: string) => {
    const last = l.lastWrite(contract, ref);
    if (last?.reason === "needs_answer" && (last.result_ids as string[]).length === 0) asked.push({ ref, contract, result_ids: [] });
    else close.push({ ref, contract });
  };
  const closedAs = (contract: string, ref: string) => events.some((e) => e.event === "write" && e.contract === contract
    && (e.refs as string[]).includes(ref) && e.closed === true);
  // Documents for Path B, routed so or refused path_b, until their privileged write lands, or is
  // refused for a reason no repeat clears (a store change, a race), whose refusal said so (N-10, m-4).
  const pathB: Array<{ ref: string; file_path: string }> = [];
  for (const route of l.routes) {
    if (taken.has(route.file_hash)) continue;
    const refusedPathB = events.some((e) => e.event === "write" && (e.refs as string[]).includes(route.ref) && e.reason === "path_b");
    if (route.kind === "path_b" || refusedPathB) {
      const blocked = events.some((e) => e.event === "write" && e.contract === "privileged" && (e.refs as string[]).includes(route.ref) && blocks(e));
      if (!l.written("privileged", route.ref) && !blocked) pathB.push({ ref: route.ref, file_path: route.file_path });
      continue;
    }
    if (route.kind !== "affidavit") {
      const s = consider({ ref: route.ref, agent: "lawyer:extract-facts", contract: "facts", route });
      if (s.state === "failed" && !l.written("facts", route.ref)) closeOrAsk("facts", route.ref);
      if (route.kind === "notice_of_application" && !closedAs("facts", route.ref) && s.state !== "blocked") {
        // The orders wait for their document's own write (S-m8), and are never written onto a
        // document recorded as not read (K-m4).
        const ref = `${route.ref}:so`;
        const so = consider({ ref, agent: "lawyer:extract-sought-orders", contract: "sought_orders", route }, s.state === "written");
        if (so.state === "failed" && s.state === "written" && !l.written("sought_orders", ref)) close.push({ ref, contract: "sought_orders" });
      }
      continue;
    }
    const bodyItem: Item = { ref: route.ref, agent: "lawyer:extract-affidavit", contract: "affidavit_body", route, pass: 1 };
    const body = consider(bodyItem);
    if (body.state === "failed" && !l.written("affidavit_body", route.ref)) closeOrAsk("affidavit_body", route.ref);
    if (body.state !== "written" || route.rendering) continue;
    const closed = events.some((e) => e.event === "write" && e.contract === "affidavit_exhibits" && (e.refs as string[]).includes(route.ref) && e.closing === true);
    if (closed) continue;
    const affidavit = affidavitPlan(route, l, env);
    const exhibits: string[] = [];
    let open = false;
    for (const item of affidavit.items) {
      const s = l.state(item.ref);
      if (s.state === "in_flight") running(item.ref);
      if (s.state === "new" || item.redo) dispatch.push(item);
      if (item.pass === 3 && s.state === "acked" && !item.redo) exhibits.push(s.result_id as string);
      if (item.pass === 3 && s.state !== "written" && s.state !== "failed") open = true;
    }
    // An exhibit write waits for its body write (spec §8.3); exhibits acknowledged since the last
    // call for the affidavit go in one call (§2.3).
    if (exhibits.length > 0) write.push({ ref: route.ref, contract: "affidavit_exhibits", result_ids: exhibits });
    if (affidavit.located && !open && exhibits.length === 0) close.push({ ref: route.ref, contract: "affidavit_exhibits" });
  }
  return { dispatch, write, close, asked, pathB, inFlight, inFlightRefs };
}

// ---------------------------------------------------------------- claims (group locking spec section 5)

/** The file hashes a run holds, each with a file name: its routed files with work still open, an
 *  email's attachments with it, and what it claimed outright, until its run ends. */
function heldBy(events: Event[], env: NodeJS.ProcessEnv): Map<string, string> {
  const p = plan(events, env);
  const open = new Set([...p.dispatch, ...p.write, ...p.close, ...p.asked, ...p.pathB].map((line) => line.ref.split(":")[0]));
  p.inFlightRefs.forEach((ref) => open.add(ref.split(":")[0]));
  const held = new Map<string, string>();
  const add = (hash: string, path: string) => held.set(hash, shortName(path));
  for (const route of ledger(events).routes) {
    if (!open.has(route.ref)) continue;
    add(route.file_hash, route.file_path);
    route.attachment_hashes?.forEach((hash) => add(hash, route.file_path));
  }
  for (const e of events) if (e.event === "claim") add(e.file_hash as string, e.file_path as string);
  takenHashes(events).forEach((hash) => held.delete(hash));
  return held;
}

/** What each other unfinished run of the matter holds, and whether its heartbeat is still fresh. */
function otherHolders(matterDir: string, own: string, env: NodeJS.ProcessEnv) {
  return runFolders(matterDir).filter((dir) => dir !== own).flatMap((dir) => {
    const lease = leaseOrNull(dir);
    if (lease === null || lease.ended !== null) return [];
    return [{ dir, runId: lease.run_id, live: isLive(lease), held: heldBy(runEvents(dir), env) }];
  });
}

/** The files other runs have written since `since`: each write's file hash and source. */
export function writesElsewhere(matterDir: string, own: string, since: string): Array<{ file_hash: string; source_id: number | null }> {
  const out: Array<{ file_hash: string; source_id: number | null }> = [];
  for (const dir of runFolders(matterDir)) {
    if (dir === own) continue;
    for (const e of readJournal(dir)) {
      if (e.event === "write" && e.outcome === "written" && e.closed !== true && typeof e.file_hash === "string" && e.ts >= since) {
        out.push({ file_hash: e.file_hash, source_id: (e.source_id as number | null | undefined) ?? null });
      }
    }
  }
  return out;
}

/** Takes the claims of `files` for the run in `own`. Each file, with its attachments, gets its claim
 *  or is left out, whatever happens to the others, and none waits on another (5.2). */
function takeClaims(matterDir: string, own: string, started: string, files: ClaimFile[], env: NodeJS.ProcessEnv) {
  const holders = otherHolders(matterDir, own, env);
  const written = new Set(writesElsewhere(matterDir, own, started).map((w) => w.file_hash));
  const granted = new Set<string>();
  const leftOut: string[] = [];
  const report: string[] = [];
  const pickedUp: string[] = [];
  for (const file of files) {
    const hashes = [file.file_hash, ...(file.attachment_hashes ?? [])];
    const name = shortName(file.file_path);
    if (holders.some((h) => h.live && hashes.some((hash) => h.held.has(hash)))) {
      leftOut.push(file.file_path);
      report.push(LEFT_OUT(name));
      continue;
    }
    if (hashes.some((hash) => written.has(hash))) {
      leftOut.push(file.file_path);
      report.push(JUST_HELD(name));
      continue;
    }
    for (const holder of holders) {
      for (const hash of hashes) {
        if (!holder.held.has(hash)) continue;
        journal(holder.dir, "taken", holder.runId, { file_hash: hash });
        holder.held.delete(hash);
        if (!pickedUp.includes(name)) pickedUp.push(name);
      }
    }
    granted.add(file.file_hash);
  }
  if (pickedUp.length > 0) report.push(PICKED_UP(pickedUp));
  return { granted, leftOut, report };
}

/** One run's readers running now, read without its lock: every dispatch not yet answered, voided or
 *  overtaken by a takeover, and not so old that its session must have gone (SLOT_MS). */
function readersOf(dir: string): number {
  let text: string;
  try {
    text = readFileSync(journalPath(dir), "utf-8");
  } catch {
    return 0;
  }
  const events: Event[] = [];
  for (const line of text.split("\n")) {
    try {
      if (line.trim() !== "") events.push(JSON.parse(line) as Event);
    } catch {
      // A line being appended now, or one a crash cut short: its own run's lock holder deals with it.
    }
  }
  const voided = new Set(events.filter((e) => e.event === "void").map((e) => e.dispatch_id as string));
  const open = new Map<string, string>();
  for (const e of events) {
    if (e.event === "takeover") open.clear();
    else if (e.event === "ack") open.delete(e.ref as string);
    else if (e.event === "dispatch" && !voided.has(e.dispatch_id as string)) open.set(e.ref as string, e.ts);
  }
  return [...open.values()].filter((ts) => Date.now() - Date.parse(ts) < SLOT_MS).length;
}

/** Readers running on this computer in every live run but `own`, whichever matter it belongs to. */
function readersElsewhere(own: string, env: NodeJS.ProcessEnv): number {
  const root = hostLocalDir(SITE, env);
  let count = 0;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    for (const dir of runFolders(pathWin32.join(root, entry.name))) {
      if (dir === own) continue;
      try {
        if (isLive(readLease(dir))) count += readersOf(dir);
      } catch {
        // A lease being replaced, or cut short: it counts for nothing this time.
      }
    }
  }
  return count;
}

/** The Path B documents still to read, as `next`, `begin {resume}` and `status` list them (N-10). */
const pathBLines = (pathB: Array<{ ref: string; file_path: string }>) => (pathB.length ? { path_b: pathB.slice(0, PAGE) } : {});

/** The exhibit letters ingest_result's affidavit_exhibits converter needs, and whether this call,
 *  writing the exhibits `refsHere`, resolves the last of them. */
export async function affidavitRun(matterRoot: string, runId: string, fileRef: string, refsHere: string[], env: NodeJS.ProcessEnv = process.env) {
  return underLock(matterRoot, env, (matterDir) => {
    const dir = findRun(matterDir, runId);
    if (dir === null) return null;
    const events = runEvents(dir);
    const l = ledger(events);
    const route = l.routes.find((r) => r.ref === fileRef);
    if (!route) return null;
    const a = affidavitPlan(route, l, env);
    const here = new Set(refsHere);
    const closing = a.located && a.items.filter((i) => i.pass === 3).every((i) => {
      const s = l.state(i.ref);
      return s.state === "written" || s.state === "failed" || here.has(i.ref);
    });
    return { expected: a.expected, failed: a.failed, deferred: a.deferred, uncertain: a.uncertain, closing };
  });
}

// ---------------------------------------------------------------- dispatch inputs (spec §6.1, §6.5)

type ManifestEntry = { page: number; images: string[] } | { pages: string; pdf: string };

async function pageManifest(pdf: string, pages: [number, number], destination?: string): Promise<{ manifest: ManifestEntry[]; scanned: boolean }> {
  const out = await pdfPageImages({ path: pdf, pages: `${pages[0]}-${pages[1]}`, destination_dir: destination });
  const manifest: ManifestEntry[] = [];
  for (const p of out.pages) {
    if (p.kind === "scanned") manifest.push({ page: p.page, images: (p.images ?? []).map((i) => i.path) });
    else {
      const last = manifest[manifest.length - 1];
      const run = last && "pages" in last ? /^(\d+)-(\d+)$/.exec(last.pages) : null;
      if (run && Number(run[2]) === p.page - 1) (last as { pages: string }).pages = `${run[1]}-${p.page}`;
      else manifest.push({ pages: `${p.page}-${p.page}`, pdf });
    }
  }
  return { manifest, scanned: out.pages.some((p) => p.kind === "scanned") };
}

const hostPath = (matterRoot: string, stored: string) => pathWin32.join(matterRoot, stored);
/** A bridged dispatch's page images: in the matter, where the session can stage them (spec §6.5),
 *  one folder per dispatch so that `end` removes exactly the run's own. */
const imagesDir = (matterRoot: string, dispatchId: string) => pathWin32.join(matterRoot, "0. CASE DATA", "Page images", `ingest-${dispatchId}`);

async function inputsFor(item: Item, matterRoot: string, context: Record<string, unknown>, bridged: boolean, dispatchId: string) {
  const route = item.route;
  const file = hostPath(matterRoot, route.file_path);
  const kind = pathWin32.extname(route.file_path).slice(1).toLowerCase();
  const inputs: Record<string, unknown> = {
    MATTER_CONTEXT: context.matter_context,
    CONTRACT: { id: item.contract ?? "boundaries", version: CONTRACT_VERSION },
  };
  let pageCount: number | undefined;
  let scanned = false;
  if (route.rendering) {
    inputs.RENDERING = route.rendering;
  } else {
    const count = (await classifyPdfPages(file)).length;
    pageCount = count;
    const range: [number, number] = item.pages ?? [1, item.pass === 1 ? Math.min(count, READ_PAGES) : count];
    const m = await pageManifest(file, range, bridged ? imagesDir(matterRoot, dispatchId) : undefined);
    inputs.PAGE_MANIFEST = m.manifest;
    scanned = m.scanned && m.manifest.every((e) => "page" in e);
  }
  // #71: a wholly scanned document is named, never given a path.
  inputs.DOCUMENT = scanned
    ? { name: pathWin32.basename(file), kind, date: "auto", author_or_filing_party: "auto" }
    : { path: file, kind, date: "auto", author_or_filing_party: "auto" };
  if (item.agent === "lawyer:extract-facts") {
    inputs.ANSWERED_FACTS = context.answered_facts;
    inputs.ANSWERED_RELIEF = context.answered_relief;
  }
  if (item.pass) inputs.PASS = item.pass;
  if (item.pages) inputs.PAGE_RANGE = item.pages;
  if (item.letter) inputs.EXHIBIT_LETTER = item.letter;
  inputs.ITEMS = [{ ref: item.ref, page_range: item.pages ?? null, ...(item.letter ? { letter: item.letter } : {}) }];
  const stage: string[] = [];
  if (bridged) {
    for (const e of (inputs.PAGE_MANIFEST as ManifestEntry[] | undefined) ?? []) {
      if ("images" in e) stage.push(...e.images);
      else if (!stage.includes(e.pdf)) stage.push(e.pdf);
    }
    if (route.rendering) stage.push(route.rendering);
  }
  return { inputs, stage, pageCount };
}

function matterContext(matterRoot: string, answersSourceId: number | undefined, env: NodeJS.ProcessEnv): Record<string, unknown> {
  const out = runCaseScript<Record<string, unknown>>("dispatch_context", "run", {
    case_data_dir: caseDataFolder(matterRoot, env),
    answers_source_id: answersSourceId ?? null,
  }, env);
  if (out.status !== "ok") throw new DataServerError(`the matter's case data cannot be read: ${String(out.reason)}`, "case_data_unavailable");
  return out;
}

const ROUTE_KINDS = ["facts", "notice_of_application", "affidavit", "path_b"];

/** conventions.md §2.4's stored form: relative to the matter root, backslashes, no leading `.\`. */
export function storedForm(path: string, matterRoot: string): string {
  let p = path.replace(/\//g, "\\");
  const r = matterRoot.replace(/\//g, "\\").replace(/\\+$/, "");
  if (p.toLowerCase().startsWith(r.toLowerCase() + "\\")) p = p.slice(r.length + 1);
  while (p.startsWith(".\\")) p = p.slice(2);
  return p;
}

/** A stored form that still names a drive, a share or a root, or climbs out: outside the matter. */
export const outsideMatter = (stored: string) => /^[A-Za-z]:|^\\/.test(stored) || stored.split("\\").includes("..");

const sha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

/** Every route checked before any is journaled (S-M3, S-m13): inside the matter, present, with the
 *  hash its bytes give, and a PDF or a file with a rendering (S-M2). */
function checkRoutes(routes: Array<Omit<Route, "ref">>, matterRoot: string): Array<Omit<Route, "ref">> {
  return routes.map((r, i) => {
    if (!ROUTE_KINDS.includes(r.kind)) throw new ValidationError(`routes[${i}].kind must be one of ${ROUTE_KINDS.join(", ")}`);
    if (!/^[0-9a-f]{64}$/.test(r.file_hash ?? "")) throw new ValidationError(`routes[${i}].file_hash must be the file's SHA-256`);
    const stored = storedForm(String(r.file_path ?? ""), matterRoot);
    if (stored === "" || outsideMatter(stored)) throw new ValidationError(`routes[${i}].file_path must be a file inside the matter folder`);
    const host = hostPath(matterRoot, stored);
    if (!existsSync(host)) throw new ValidationError(`routes[${i}].file_path does not exist: ${stored}`);
    if (sha256(host) !== r.file_hash) throw new ValidationError(`routes[${i}].file_hash is not the hash of ${stored}`);
    if (r.rendering !== undefined && !existsSync(r.rendering)) throw new ValidationError(`routes[${i}].rendering does not exist`);
    if (r.attachment_hashes?.some((hash) => !/^[0-9a-f]{64}$/.test(hash))) throw new ValidationError(`routes[${i}].attachment_hashes must each be a file's SHA-256`);
    if (r.kind !== "path_b" && r.rendering === undefined && pathWin32.extname(stored).toLowerCase() !== ".pdf") {
      throw new ValidationError(`routes[${i}] is not a PDF, so it needs its rendering`);
    }
    return { ...r, file_path: stored };
  });
}

/** Records a dispatch's outcome made after `next`'s lock was released (S-m10). When that second lock
 *  cannot be had, the records wait here, each with the run it belongs to, and runEvents journals them
 *  first under the next lock (N8, N-7), so an item whose inputs failed is never left counted as running. */
const unjournaled = new Map<string, Array<{ runId: string; event: string; extra: Record<string, unknown> }>>();

async function next(args: IngestRunArgs, env: NodeJS.ProcessEnv): Promise<unknown> {
  const runId = requireRunId(args);
  const checked = checkRoutes(args.routes ?? [], args.matter_root);
  const revision = matterRevision(args.matter_root, env);
  // Under the lock: route, plan and reserve each dispatch. The page images are rendered after the
  // lock is released (S-m10), so the run's other calls are not kept waiting on them.
  const reserve = (routes: typeof checked) => underLock(args.matter_root, env, (matterDir) => {
    const held = hold(matterDir, runId);
    if ("refused" in held) return held;
    const dir = held.dir;
    const before = runEvents(dir);
    const l = ledger(before);
    const taken = takenHashes(before);
    let n = l.routes.length;
    const fresh: Route[] = [];
    const routed: string[] = [];
    const report: string[] = [];
    const leftOut: string[] = [];
    // Each file not yet routed in this run takes its claim, or is left out (group locking spec 5.3).
    const routedBefore = (hash: string) => l.routes.some((x) => x.file_hash === hash);
    const newFiles = routes.filter((r) => !routedBefore(r.file_hash));
    if (newFiles.length > 0 && exclusiveHeld(args.matter_root, env)) return refusal("matter_busy");
    const claims = takeClaims(matterDir, dir, held.started, newFiles, env);
    report.push(...claims.report);
    leftOut.push(...claims.leftOut);
    for (const r of routes) {
      if (!routedBefore(r.file_hash) && !claims.granted.has(r.file_hash)) continue;
      if (taken.has(r.file_hash)) {
        leftOut.push(r.file_path);
        report.push(LEFT_OUT(shortName(r.file_path)));
        continue;
      }
      // A file routed again (a resume, a repeated call, a second copy with one hash) keeps its ref (S-M3).
      const known = [...l.routes, ...fresh].find((x) => x.file_hash === r.file_hash);
      if (known) {
        routed.push(known.ref);
        // A second file with the same bytes is read once, and the practitioner is told so (N15).
        if (known.file_path !== r.file_path) {
          report.push(`${pathWin32.basename(r.file_path).slice(0, 80)} is the same file as ${pathWin32.basename(known.file_path).slice(0, 80)}, so it is read once.`);
        }
        continue;
      }
      const route: Route = { ...r, ref: `f${++n}` };
      fresh.push(route);
      routed.push(route.ref);
    }
    for (const route of fresh) journal(dir, "route", runId, { route });
    const p = plan(runEvents(dir), env);
    // The limit is per computer (group locking spec 5.6), so other runs' readers count against it.
    const free = Math.max(0, WINDOW - p.inFlight - readersElsewhere(dir, env));
    const items = p.dispatch.slice(0, free).map((item) => {
      const id = randomUUID();
      journal(dir, "dispatch", runId, { dispatch_id: id, ref: item.ref, agent: item.agent, contract: item.contract, revision });
      return { id, item };
    });
    return { routed, report, leftOut, items, write: p.write, close: p.close, asked: p.asked, pathB: p.pathB, inFlight: p.inFlight, dir, noSlot: p.dispatch.length > items.length };
  });
  let reserved = await reserve(checked);
  // With nothing else to do and no slot free, look again for a while. The routes are in the journal
  // now, so a later look routes nothing (and claims nothing) again.
  for (let waited = 0; waited < SLOT_WAIT_MS && !("refused" in reserved) && reserved.noSlot && reserved.items.length === 0
    && reserved.inFlight === 0 && reserved.write.length === 0 && reserved.close.length === 0; waited += SLOT_POLL_MS) {
    await new Promise((resolve) => setTimeout(resolve, SLOT_POLL_MS));
    const again = await reserve([]);
    if ("refused" in again) {
      reserved = again;
      break;
    }
    reserved = { ...again, routed: reserved.routed, report: reserved.report, leftOut: reserved.leftOut };
  }
  if ("refused" in reserved) return reserved;

  const contexts = new Map<string, Record<string, unknown> | Error>();
  const dispatch = [];
  const built: Array<{ ref: string; dispatch_id: string; page_count?: number }> = [];
  const failed: string[] = [];
  const voided: string[] = [];
  let contextError: Error | null = null;
  let fault: unknown = null;
  let k = 0;
  try {
    mkdirSync(pathWin32.join(reserved.dir, "dispatches"), { recursive: true });
    for (; k < reserved.items.length; k++) {
      const { id, item } = reserved.items[k];
      const key = String(item.route.answers_source_id ?? "");
      if (!contexts.has(key)) {
        try {
          contexts.set(key, matterContext(args.matter_root, item.route.answers_source_id, env));
        } catch (err) {
          contexts.set(key, err as Error);
        }
      }
      const context = contexts.get(key) as Record<string, unknown> | Error;
      if (context instanceof Error) {
        // The matter's case data, not the item, is at fault: the dispatch is void, not a failure.
        voided.push(id);
        contextError = context;
        continue;
      }
      try {
        const { inputs, stage, pageCount } = await inputsFor(item, args.matter_root, context, args.bridged === true, id);
        writeFileSync(dispatchPath(reserved.dir, id), JSON.stringify({ inputs, stage, session: null }), "utf-8");
        built.push({ ref: item.ref, dispatch_id: id, page_count: pageCount });
        // #70: every fact extractor stays on Opus at high effort, on every dispatch.
        dispatch.push({ dispatch_id: id, agent: item.agent, model: "opus", effort: "high", ref: item.ref, contract: item.contract, ...(stage.length ? { stage } : {}) });
      } catch (err) {
        // A file that cannot be opened or rendered (a missing, encrypted or corrupt PDF) fails this
        // item alone, as an extractor would (R4): the rest of the list goes on (S-M2). Any other
        // error is a fault of this computer or server, and surfaces (N14), below.
        if (!(err instanceof DataServerError) || !ITEM_FAULTS.includes(String(err.code))) throw err;
        failed.push(item.ref);
      }
    }
  } catch (err) {
    // The list is never returned, so no dispatch reserved by this call may stay counted as running:
    // each one built and every one not yet reached is void, and is planned again (N-1).
    fault = err;
    voided.push(...built.map((b) => b.dispatch_id), ...reserved.items.slice(k).map((r) => r.id));
  }
  const records = [
    ...built.filter((b) => b.page_count !== undefined).map((b) => ({ event: "inputs", extra: b as Record<string, unknown> })),
    ...failed.map((ref) => ({ event: "ack", extra: { ref, ok: false, reason: "unreadable" } })),
    ...voided.map((id) => ({ event: "void", extra: { dispatch_id: id } })),
  ];
  if (records.length > 0) {
    try {
      await underLock(args.matter_root, env, () => {
        for (const r of records) journal(reserved.dir, r.event, runId, r.extra);
      });
    } catch (err) {
      if ((err as DataServerError).code !== "lock_unavailable") {
        // The fault that voided the dispatches, or the case data's error, stays the error; the
        // journal's own is added to it (n-5, round 5 nit 15).
        const first = fault ?? contextError;
        if (first instanceof Error) {
          first.message += ` (and this call's dispatches could not be recorded as void: ${(err as Error).message})`;
          throw first;
        }
        throw err;
      }
      unjournaled.set(reserved.dir, [...(unjournaled.get(reserved.dir) ?? []), ...records.map((r) => ({ runId, ...r }))]);
    }
  }
  if (fault !== null) throw fault;
  if (contextError && dispatch.length === 0) throw contextError;

  const lines = dispatch.length + reserved.write.length + reserved.close.length;
  return {
    ok: true,
    ...(reserved.routed.length ? { routed: reserved.routed } : {}),
    ...(reserved.report.length ? { report: reserved.report } : {}),
    ...(reserved.leftOut.length ? { left_out: reserved.leftOut } : {}),
    dispatch,
    write: reserved.write.slice(0, Math.max(0, PAGE - dispatch.length)),
    close: reserved.close.slice(0, Math.max(0, PAGE - dispatch.length - reserved.write.length)),
    ...(reserved.asked.length ? { asked: reserved.asked.slice(0, PAGE) } : {}),
    ...pathBLines(reserved.pathB),
    running: reserved.inFlight + dispatch.length,
    // Files still to read and no reader free: not finished, so the caller calls next again.
    ...(reserved.noSlot && dispatch.length === 0 ? { waiting_for_slot: true } : {}),
    ...(lines > PAGE ? { more: true } : {}),
  };
}

const ACK = /^(ok)\s+(\S+)\s+([0-9a-f-]{36})\s+\d+$|^(failed)\s+(\S+)\s+(\S+)$/;

/** Records one extractor reply that is not passed to ingest_result: a `failed` line, or the `ok` of
 *  a boundary scan, which writes nothing (spec §6.3). Its ref must name an item this run dispatched
 *  (m-2). */
function recordAck(dir: string, runId: string, ack: string): Record<string, unknown> {
  const m = ACK.exec(ack.trim());
  if (!m) throw new ValidationError("ack must be one line: ok <ref> <result_id> <bytes>, or failed <ref> <reason>");
  const ref = m[1] ? m[2] : m[5];
  if (!runEvents(dir).some((e) => e.event === "dispatch" && e.ref === ref)) throw new ValidationError(`ack names ${ref.slice(0, 40)}, which this run never dispatched`);
  if (m[1]) journal(dir, "ack", runId, { ref: m[2], ok: true, result_id: m[3] });
  else journal(dir, "ack", runId, { ref: m[5], ok: false, reason: m[6] });
  return { ok: true };
}

export interface WriteRun {
  ok: true;
  mode: Lease["mode"];
  route: Route | null;
  /** The answered pleading's keys as dispatched to the extractor (K-m2), for a `facts` write. */
  answered: { facts: string[]; relief: string[] };
  /** The item each of the call's results answers, by the ok reply journaled for it (N-4). */
  acked: Record<string, string>;
  /** The call's own ref when it names an item dispatched under the call's contract (N-4). */
  itemRef: string | null;
  /** Every item ref the run dispatched under the call's contract (m-2). */
  dispatched: string[];
  /** The call's results the run has already written (R6, N-11). */
  written: string[];
  /** The call's results whose item failed after their ok reply was journaled: a repeat of the call
   *  takes them as settled, as it does a result already written (round 6, N1). */
  settled: string[];
  /** When this run began, for what other runs have written since (group locking spec 7.2). */
  started: string;
  /** The matter revision when this file's last reader was dispatched, null when none was. */
  readRevision: number | null;
  /** The call's last unanswered question: the revision it rested on and its candidates (spec section 8). */
  question: { revision: number; candidates: Record<string, number[]> } | null;
  /** Other runs' writes since this run began. */
  elsewhere: Array<{ file_hash: string; source_id: number | null }>;
}

/** ingest_result's run check and its record: renews the heartbeat, refuses lease_lost or
 *  plugin_changed, and returns the run's mode, the route the document names by `ref`, or by its
 *  hash when one was routed, and what the journal says of the call's results. */
export async function runForWrite(matterRoot: string, runId: string, document: { ref?: string; file_hash?: string }, contract: string, resultIds: string[], env: NodeJS.ProcessEnv = process.env): Promise<Refusal | WriteRun> {
  return underLock(matterRoot, env, (matterDir) => {
    const held = hold(matterDir, runId);
    if ("refused" in held) return held;
    const dir = held.dir;
    const events = runEvents(dir);
    const routes = ledger(events).routes;
    const acked: Record<string, string> = {};
    for (const e of events) {
      if (e.event === "ack" && e.ok === true && resultIds.includes(e.result_id as string)) acked[e.result_id as string] = e.ref as string;
    }
    const dispatched = [...new Set(events.filter((e) => e.event === "dispatch" && e.contract === contract).map((e) => e.ref as string))];
    const itemRef = document.ref !== undefined && dispatched.includes(document.ref) ? document.ref : null;
    const written = resultIds.filter((id) => events.some((e) => e.event === "write" && (e.outcome === "written" || e.outcome === "already_written")
      && ((e.result_ids as string[] | undefined) ?? []).includes(id)));
    const settled = resultIds.filter((id) => {
      const at = events.findIndex((e) => e.event === "ack" && e.ok === true && e.result_id === id);
      return at >= 0 && events.slice(at + 1).some((e) => e.event === "ack" && e.ok === false && e.ref === events[at].ref);
    });
    // A line's ref (f3, f3:so, f3:B) names its file by the part before the first colon.
    const route = document.ref !== undefined
      ? routes.find((r) => r.ref === document.ref?.split(":")[0]) ?? null
      : routes.find((r) => r.file_hash === document.file_hash) ?? null;
    if (document.ref !== undefined && route === null) throw new ValidationError(`no file with ref ${document.ref} in this run`);
    if (route && takenHashes(events).has(route.file_hash)) return { ok: false as const, refused: "taken" as const, say: TAKEN(shortName(route.file_path)) };
    const answered = { facts: [] as string[], relief: [] as string[] };
    const last = route ? events.filter((e) => e.event === "dispatch" && e.ref === route.ref && e.agent === "lawyer:extract-facts").pop() : undefined;
    if (last && existsSync(dispatchPath(dir, last.dispatch_id as string))) {
      const inputs = (JSON.parse(readFileSync(dispatchPath(dir, last.dispatch_id as string), "utf-8")) as { inputs: Record<string, unknown> }).inputs;
      answered.facts = ((inputs.ANSWERED_FACTS ?? []) as Array<{ fact_key: string }>).map((f) => f.fact_key);
      answered.relief = ((inputs.ANSWERED_RELIEF ?? []) as Array<{ relief_key: string }>).map((r) => r.relief_key);
    }
    const reads = route ? events.filter((e) => e.event === "dispatch" && (e.ref as string).split(":")[0] === route.ref && typeof e.revision === "number") : [];
    const lastAsk = events.filter((e) => e.event === "write" && e.reason === "needs_answer" && e.contract === contract
      && ((e.result_ids as string[]) ?? []).join() === resultIds.join() && typeof e.revision === "number").pop();
    return {
      ok: true as const, mode: held.mode, route, answered, acked, itemRef, dispatched, written, settled,
      started: held.started,
      readRevision: reads.length > 0 ? (reads[reads.length - 1].revision as number) : null,
      question: lastAsk ? { revision: lastAsk.revision as number, candidates: (lastAsk.candidates ?? {}) as Record<string, number[]> } : null,
      elsewhere: writesElsewhere(matterDir, dir, held.started),
    };
  });
}

function journalAcks(dir: string, runId: string, acks: Array<{ ref: string; result_id: string }>): void {
  const events = runEvents(dir);
  for (const a of acks) {
    const already = events.some((e) => e.event === "ack" && e.ok === true && e.result_id === a.result_id);
    if (!already) journal(dir, "ack", runId, { ref: a.ref, ok: true, result_id: a.result_id });
  }
}

/** Journals a write. An item the write could not record counts as a failed extraction (R4, R5) and is
 *  read once more; returns the refs of those that have now failed twice, which are closed instead. */
export async function recordWrite(matterRoot: string, runId: string, acks: Array<{ ref: string; result_id: string }>, write: Record<string, unknown>, env: NodeJS.ProcessEnv = process.env, failures: Array<{ ref: string; reason: string }> = []): Promise<string[]> {
  return underLock(matterRoot, env, (matterDir) => {
    const dir = findRun(matterDir, runId);
    if (dir === null) throw new DataServerError(SAY.lease_lost, "lease_lost");
    journalAcks(dir, runId, acks);
    journal(dir, "write", runId, write);
    for (const f of failures) journal(dir, "ack", runId, { ref: f.ref, ok: false, reason: f.reason });
    const l = ledger(runEvents(dir));
    return failures.map((f) => f.ref).filter((ref) => l.state(ref).failures >= 2);
  });
}

/** ingest_result's refusal before any write (S-M4): a result that cannot be read, was staged under
 *  another contract, version or item, or belongs to another file. Each result's reply is journaled
 *  first, under the item the reply names, when that item was dispatched, and the item of each bad
 *  result alone is recorded as a failed reply, with that result's own reason (N-9), so it is read
 *  once more (R4) rather than left waiting forever; the call's good results stay acknowledged, to be
 *  written again. */
export async function recordRefusal(matterRoot: string, runId: string, acks: Array<{ ref: string; result_id: string }>, bad: Array<{ id: string; reason: string }>, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  await underLock(matterRoot, env, (matterDir) => {
    const dir = findRun(matterDir, runId);
    if (dir === null) throw new DataServerError(SAY.lease_lost, "lease_lost");
    const before = runEvents(dir);
    journalAcks(dir, runId, acks.filter((a) => before.some((e) => e.event === "dispatch" && e.ref === a.ref)));
    const events = runEvents(dir);
    const l = ledger(events);
    for (const { id, reason } of bad) {
      const ack = events.filter((e) => e.event === "ack" && e.ok === true && e.result_id === id).pop();
      const ref = ack?.ref as string | undefined;
      // Only an item still waiting on this very result: a repeat of the refused call fails it once.
      const s = ref === undefined ? null : l.state(ref);
      if (ref !== undefined && (s?.state === "acked" || s?.state === "asked") && s.result_id === id) {
        journal(dir, "ack", runId, { ref, ok: false, reason });
      }
    }
  });
}

/** The stored inputs of `dispatchId`, with a bridged session's copies in place of host paths. */
export function dispatchInputs(dispatchId: string, env: NodeJS.ProcessEnv = process.env): Record<string, unknown> {
  if (!UUID.test(dispatchId ?? "")) throw new ValidationError("dispatch_id must be the id from your dispatch line");
  const root = hostLocalDir(SITE, env);
  const dirs = (existsSync(root) ? readdirSync(root, { withFileTypes: true }) : [])
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      const matterDir = pathWin32.join(root, entry.name);
      return [matterDir, ...runFolders(matterDir)]; // a run an update has not yet moved stays in the matter's folder
    });
  for (const dir of dirs) {
    const path = dispatchPath(dir, dispatchId);
    if (!existsSync(path)) continue;
    const stored = JSON.parse(readFileSync(path, "utf-8")) as { inputs: unknown; stage: string[]; session: string[] | null };
    let text = JSON.stringify(stored.inputs);
    if (stored.session) {
      stored.stage.forEach((host, i) => {
        text = text.split(JSON.stringify(host).slice(1, -1)).join(JSON.stringify((stored.session as string[])[i]).slice(1, -1));
      });
    }
    return JSON.parse(text) as Record<string, unknown>;
  }
  throw new DataServerError("no dispatch with that id on this computer", "unknown_dispatch");
}

/** One line of `status` with no run_id: an unfinished run and the files it routed or claimed. */
function runLine(dir: string, lease: Lease) {
  const events = runEvents(dir);
  const files = [...ledger(events).routes.map((r) => r.file_path), ...events.filter((e) => e.event === "claim").map((e) => e.file_path as string)];
  return {
    run_id: lease.run_id, active: isLive(lease), started: lease.started, heartbeat: lease.heartbeat, mode: lease.mode,
    files: [...new Set(files)].slice(0, PAGE).map(shortName),
  };
}

/** Ends a run: deletes what it no longer needs and marks its lease. The dispatches' stored inputs
 *  (parties, answered facts) and a bridged run's page images are not needed once the run has ended
 *  (S-m15). A folder any delete error leaves stays, and the run still ends: the next end or the sweep
 *  deletes it (N-12, m-5). */
function finishRun(dir: string, lease: Lease, runId: string, matterRoot: string, env: NodeJS.ProcessEnv) {
  const imagesLeft = removeImages(dir, matterRoot);
  const said = sayOnce(imagesLeft, IMAGES_LEFT);
  const report = [...said.lines];
  const keys = [...said.keys];
  try {
    removeOwn(pathWin32.join(dir, "dispatches"));
  } catch {
    const left = sayOnce([pathWin32.join(dir, "dispatches")], RECORDS_LEFT);
    report.push(...left.lines);
    keys.push(...left.keys);
  }
  writeLease(dir, { ...lease, ended: lease.heartbeat });
  journal(dir, "end", runId, imagesLeft.length > 0 ? { images_left: true } : {});
  // Privileged wording staged for a question still open is not needed once the run has ended, so it
  // never waits out the 7-day window (G4, round 5, 7). Nor is an exhibit's reading, one the reply's cap
  // held back with its privilege question included (round 6, N2); one this computer cannot delete now
  // waits out that window.
  const writes = readJournal(dir).filter((e) => e.event === "write");
  const idsOf = (contract: string) => writes.filter((e) => e.contract === contract).flatMap((e) => (e.result_ids as string[] | undefined) ?? []);
  const dropped = dropStagedResults(idsOf("privileged"), env);
  if (dropped.deleted > 0) report.push(PRIVILEGED_DROPPED);
  if (dropped.left > 0) report.push(PRIVILEGED_LEFT);
  dropStagedResults(idsOf("affidavit_exhibits"), env);
  return { report, keys };
}

/** Run folders of this matter whose journal a crash cut short, said at the next begin or end. */
const tornIn = (matterDir: string) => [...torn].filter((dir) => dir === matterDir || dir.startsWith(`${matterDir}\\`));

/** A write the call could not start because another session is saving: it stays queued, and past
 *  WAIT_REPORT_MS across calls the practitioner is told once (group locking spec section 10). A lone
 *  result's reply is journaled here, so `next` lists the write again. */
export async function noteWriteWait(matterRoot: string, runId: string, ref: string | undefined, resultIds: string[], env: NodeJS.ProcessEnv = process.env): Promise<string[]> {
  return underLock(matterRoot, env, (matterDir) => {
    const held = hold(matterDir, runId);
    if ("refused" in held) return [];
    if (ref !== undefined && resultIds.length === 1 && runEvents(held.dir).some((e) => e.event === "dispatch" && e.ref === ref)) {
      journalAcks(held.dir, runId, [{ ref, result_id: resultIds[0] }]);
    }
    const events = runEvents(held.dir);
    const waits = events.filter((e) => e.event === "write_wait" && e.ref === (ref ?? null));
    if (waits.length === 0) {
      journal(held.dir, "write_wait", runId, { ref: ref ?? null });
      return [];
    }
    if (waits.some((e) => e.said === true) || Date.now() - Date.parse(waits[0].ts) < WAIT_REPORT_MS) return [];
    journal(held.dir, "write_wait", runId, { ref: ref ?? null, said: true });
    const route = ledger(events).routes.find((r) => r.ref === ref?.split(":")[0]);
    return [SAVING(route ? shortName(route.file_path) : "This document")];
  });
}

export async function ingestRun(args: IngestRunArgs, env: NodeJS.ProcessEnv = process.env): Promise<unknown> {
  switch (args.action) {
    case "begin": {
      const mode = args.mode;
      if (mode !== "attended" && mode !== "unattended") throw new ValidationError("begin needs mode attended or unattended");
      // What the sweep left (page images in use, a run folder it could not read) is said once (N-5, M-1, n-4).
      const swept = await sweep(env, matterDirOf(args.matter_root, env));
      const out = await underLock(args.matter_root, env, (matterDir) => {
        const report = [...swept.lines];
        const keys = [...swept.keys];
        // Every answer, a refusal included, carries the report lines, a cut-short journal's among them (round 5, 1, nit 9).
        const reply = <T extends object>(body: T) => ({ ...body, ...reportLines([...report, ...(tornIn(matterDir).length > 0 ? [STEP_LOST] : [])]) });
        // A lease.json that cannot be read holds no claim and cannot be resumed: said once (round 5, 1).
        const unreadable = sayOnce(runFolders(matterDir).filter((dir) => existsSync(leasePath(dir)) && leaseOrNull(dir) === null), RUN_UNREADABLE);
        report.push(...unreadable.lines);
        keys.push(...unreadable.keys);
        const now = new Date().toISOString();
        const runId = randomUUID();
        if (args.resume !== undefined) {
          // A run left unended by plugin_changed (R7) is resumed here; one that ended is not.
          const dir = findRun(matterDir, args.resume);
          const current = dir === null ? null : leaseOrNull(dir);
          if (dir === null || current === null || current.ended !== null) return { keys, reply: reply(refusal("unknown_run")) };
          // A new id for the resuming session, so the displaced one is refused at its next call. The
          // orchestrator resuming a single-document or unattended run makes it its own (n-2). The run's
          // claims move with it, except any another run took while it was stale (group locking spec 5.5).
          writeLease(dir, { ...current, run_id: runId, heartbeat: now, build_stamp: BUILD_STAMP, mode, matter_root: args.matter_root, ...(args.orchestrator === true ? { orchestrator: true } : {}) });
          journal(dir, "takeover", runId, { displaced: current.run_id });
          const events = runEvents(dir);
          const taken = takenHashes(events);
          for (const route of ledger(events).routes) if (taken.has(route.file_hash)) report.push(TAKEN(shortName(route.file_path)));
          const p = plan(events, env);
          return { keys, reply: reply({ ok: true, run_id: runId, resumed: true, next: [...p.write, ...p.close], ...(p.asked.length ? { asked: p.asked } : {}), ...pathBLines(p.pathB) }) };
        }
        if (exclusiveHeld(args.matter_root, env)) return { keys, reply: reply(refusal("matter_busy")) };
        // A stale run with results still to record is never dropped silently (m-6): the orchestrator is
        // refused, naming it to resume; any other caller goes on and is told once. A fresh run is left alone.
        for (const dir of runFolders(matterDir)) {
          const lease = leaseOrNull(dir);
          if (lease === null || lease.ended !== null || isLive(lease)) continue;
          const p = plan(runEvents(dir), env);
          if (p.write.length + p.asked.length + p.pathB.length === 0) continue;
          if (args.orchestrator === true) return { keys, reply: reply({ ...refusal("run_unfinished"), run_id: lease.run_id, files: runLine(dir, lease).files }) };
          const said = sayOnce([`${dir}#displaced`], DISPLACED);
          report.push(...said.lines);
          keys.push(...said.keys);
        }
        const dir = pathWin32.join(matterDir, runId);
        // The lease first: a lease that cannot be written leaves the journal as it was (round 5, 2).
        writeLease(dir, {
          run_id: runId, started: now, heartbeat: now, build_stamp: BUILD_STAMP, mode, ended: null,
          orchestrator: args.orchestrator === true, matter_root: args.matter_root,
        });
        journal(dir, "begin", runId, { mode });
        return { keys, reply: reply({ ok: true, run_id: runId, resumed: false, next: [] }) };
      });
      out.keys.forEach((key) => reported.add(key));
      tornIn(matterDirOf(args.matter_root, env)).forEach((dir) => torn.delete(dir));
      return out.reply;
    }
    case "status":
      return underLock(args.matter_root, env, (matterDir) => {
        const revision = matterRevision(args.matter_root, env);
        if (args.run_id === undefined) {
          const runs = runFolders(matterDir).flatMap((dir) => {
            const lease = leaseOrNull(dir);
            return lease === null || lease.ended !== null ? [] : [runLine(dir, lease)];
          });
          return { ok: true, active: runs.some((r) => r.active), revision, runs };
        }
        const held = hold(matterDir, args.run_id);
        if ("refused" in held) return held;
        if (args.ack !== undefined) return recordAck(held.dir, args.run_id, args.ack);
        const p = plan(runEvents(held.dir), env);
        return {
          ok: true,
          active: true,
          revision,
          run_id: held.run_id,
          started: held.started,
          heartbeat: held.heartbeat,
          mode: held.mode,
          ended: held.ended,
          next: [...p.write, ...p.close],
          ...(p.asked.length ? { asked: p.asked } : {}),
          ...pathBLines(p.pathB),
        };
      });
    case "next":
      return next(args, env);
    case "claim": {
      const runId = requireRunId(args);
      const files = (args.files ?? []).map((file, i) => {
        if (!/^[0-9a-f]{64}$/.test(file.file_hash ?? "") || file.attachment_hashes?.some((hash) => !/^[0-9a-f]{64}$/.test(hash))) {
          throw new ValidationError(`files[${i}] must carry the file's SHA-256, and its attachments' if any`);
        }
        return { ...file, file_path: storedForm(String(file.file_path ?? ""), args.matter_root) };
      });
      return underLock(args.matter_root, env, (matterDir) => {
        const held = hold(matterDir, runId);
        if ("refused" in held) return held;
        if (exclusiveHeld(args.matter_root, env)) return refusal("matter_busy");
        const claims = takeClaims(matterDir, held.dir, held.started, files, env);
        const claimed = files.filter((file) => claims.granted.has(file.file_hash));
        for (const file of claimed) {
          for (const hash of [file.file_hash, ...(file.attachment_hashes ?? [])]) journal(held.dir, "claim", runId, { file_hash: hash, file_path: file.file_path });
        }
        return { ok: true, claimed: claimed.map((file) => file.file_path), ...(claims.leftOut.length ? { left_out: claims.leftOut } : {}), ...reportLines(claims.report) };
      });
    }
    case "staged": {
      const runId = requireRunId(args);
      return underLock(args.matter_root, env, (matterDir) => {
        const held = hold(matterDir, runId);
        if ("refused" in held) return held;
        const dir = held.dir;
        if (args.dispatch_id === undefined) return { ok: true, items: [] };
        if (!UUID.test(args.dispatch_id)) throw new ValidationError("dispatch_id must be the id from the dispatch line");
        const path = dispatchPath(dir, args.dispatch_id);
        if (!existsSync(path)) throw new ValidationError("no dispatch with that dispatch_id in this run");
        const stored = JSON.parse(readFileSync(path, "utf-8")) as { stage: string[] };
        if (!Array.isArray(args.paths) || args.paths.length !== stored.stage.length) {
          throw new ValidationError(`paths must list the ${stored.stage.length} staged copies, in the order of stage`);
        }
        writeFileSync(path, JSON.stringify({ ...stored, session: args.paths }), "utf-8");
        journal(dir, "staged", runId, { dispatch_id: args.dispatch_id });
        return { ok: true };
      });
    }
    case "end": {
      const runId = requireRunId(args);
      const out = await underLock(args.matter_root, env, (matterDir) => {
        const dir = findRun(matterDir, runId);
        const lease = dir === null ? null : renew(dir, runId);
        if (dir === null || lease === null) return { keys: [], reply: refusal("lease_lost") };
        const { report, keys } = finishRun(dir, lease, runId, args.matter_root, env);
        // A stale run with nothing left open will never be resumed to any purpose: it ends here, so its
        // page images do not wait out the 30 days (N13).
        for (const other of runFolders(matterDir)) {
          const stale = other === dir ? null : leaseOrNull(other);
          if (stale === null) continue;
          // A run that ended with page images or records still in use: tried again at each end (N-12, m-5).
          if (stale.ended !== null) {
            const ends = readJournal(other).filter((e) => e.event === "end");
            if (ends[ends.length - 1]?.images_left !== true) continue;
            if (removeImages(other, args.matter_root).length > 0) continue;
            try {
              removeOwn(pathWin32.join(other, "dispatches"));
            } catch {
              // Left for the sweep, with its folder.
            }
            journal(other, "end", stale.run_id);
            continue;
          }
          if (isLive(stale) || heldBy(runEvents(other), env).size > 0) continue;
          const done = finishRun(other, stale, stale.run_id, args.matter_root, env);
          report.push(...done.report);
          keys.push(...done.keys);
        }
        if (tornIn(matterDir).length > 0) report.push(STEP_LOST);
        return { keys, reply: { ok: true, run_id: runId, ...reportLines(report) } };
      });
      out.keys.forEach((key) => reported.add(key));
      if (out.reply.ok) tornIn(matterDirOf(args.matter_root, env)).forEach((dir) => torn.delete(dir));
      return out.reply;
    }
    default:
      throw new ValidationError(`unknown action ${JSON.stringify(args.action)}; expected begin, next, claim, staged, status or end`);
  }
}
