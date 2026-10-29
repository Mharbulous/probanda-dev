// matter_data__ingest_run (ingest orchestrator spec §2.4): one ingestion per matter at a time (G1).
// The lease and an append-only journal sit host-local, in a folder named by the case lock's key, so
// one matter's run state never reaches the synced matter folder. The owner is whoever holds the
// run_id, not a pid: Cowork shares one server process across sessions (case-lock.ts). Every read and
// write of the lease happens under this site's own lock, so a check and its set never interleave.
//
// Stage D2 adds the dispatch list (§6.1, §8): `next` takes the orchestrator's routed files, plans
// today's passes from the journal alone (so a resume after a crash or a compaction needs no memory,
// R9), stores each dispatch's inputs beside the journal for matter_data__dispatch_inputs, and lists
// the acknowledged results still to be written. `staged` records a bridged session's copies (§6.5).

import { createHash, randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { win32 as pathWin32 } from "node:path";

import { BUILD_STAMP } from "../build-stamp.js";
import { acquireLock, hostLocalDir, lockKey, type LockSite } from "../data-lock.js";
import { DataServerError, ValidationError } from "../errors.js";
import { classifyPdfPages, pdfPageImages } from "../files/extract/page-images.js";
import { caseDataFolder } from "./backend.js";
import { runCaseScript } from "./case-script.js";
import { stagedResultPath } from "./stage-result.js";

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
/** A run folder is deleted this long after its run ended, or its last heartbeat (est., spec §2.4). */
const KEEP_MS = 30 * 24 * 60 * 60_000;
/** Extractors running at once: #70's wave size, kept as a concurrency limit (spec §8.1). */
const WINDOW = 10;
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
/** The file faults a dispatch's inputs can meet: each fails its item alone (S-M2, N14). */
const ITEM_FAULTS = ["not_found", "not_pdf", "password_protected", "bad_pages", "page_too_large"];

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
  kind: "facts" | "notice_of_application" | "affidavit";
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
}

type Event = { ts: string; event: string; run_id: string; [k: string]: unknown };

// What the practitioner may be shown (spec §9 G5): plain words, no internal name. The code goes in `refused`.
const SAY = {
  run_active: "Another ingest of this matter is already under way. Let it finish, or resume it, before starting a new one. Nothing was written.",
  unknown_run: "That ingest has finished, or was never started on this computer, so it cannot be resumed. Nothing was written.",
  lease_lost: "Another session has taken over this ingest of the matter, so this session must stop here. Nothing more was written.",
  plugin_changed: "Probanda was updated while this ingest was running. Restart, and the ingest will resume where it stopped. Nothing more was written.",
};

export type Refusal = { ok: false; refused: keyof typeof SAY; say: string };
const refusal = (code: keyof typeof SAY): Refusal => ({ ok: false, refused: code, say: SAY[code] });

const leasePath = (dir: string) => pathWin32.join(dir, "lease.json");
const dispatchPath = (dir: string, id: string) => pathWin32.join(dir, "dispatches", `${id}.json`);

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

function readJournal(dir: string): Event[] {
  const path = pathWin32.join(dir, "journal.jsonl");
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf-8").split("\n").filter((l) => l.trim() !== "").map((l) => JSON.parse(l) as Event);
}

/** The events of the run in the lease: from its last begin, through every takeover since. */
function runEvents(dir: string): Event[] {
  const events = readJournal(dir);
  let start = 0;
  events.forEach((e, i) => {
    if (e.event === "begin") start = i;
  });
  return events.slice(start);
}

const isLive = (lease: Lease | null): boolean =>
  lease !== null && lease.ended === null && Date.now() - Date.parse(lease.heartbeat) < LIVE_MS;

const runDir = (matterRoot: string, env: NodeJS.ProcessEnv) => pathWin32.join(hostLocalDir(SITE, env), lockKey(matterRoot));

async function underLock<T>(matterRoot: string, env: NodeJS.ProcessEnv, work: (dir: string) => T | Promise<T>): Promise<T> {
  const lock = await acquireLock(SITE, matterRoot, env);
  try {
    return await work(runDir(matterRoot, env));
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

/** renew, and R7: a running bundle whose stamp differs from the one recorded at begin is refused. */
function hold(dir: string, runId: string): Lease | Refusal {
  const lease = renew(dir, runId);
  if (lease === null) return refusal("lease_lost");
  if (lease.build_stamp !== BUILD_STAMP) return refusal("plugin_changed");
  return lease;
}

/** Deletes a folder this server made: a run folder, a dispatch folder or a bridged run's page images. */
function removeOwn(path: string): void {
  rmSync(path, { recursive: true, force: true });
}

/** Deletes the page-image folder of every dispatch in the run folder's journal, a run displaced or
 *  never ended included (N13): each is a folder this server made for a bridged dispatch. */
function removeImages(dir: string, matterRoot: string): void {
  for (const e of readJournal(dir)) {
    if (e.event === "dispatch") removeOwn(imagesDir(matterRoot, e.dispatch_id as string));
  }
}

const expired = (lease: Lease | null): boolean => {
  const last = lease?.ended ?? lease?.heartbeat;
  return last !== undefined && Date.now() - Date.parse(last) > KEEP_MS;
};

/** Deletes each run folder whose run ended, or whose last heartbeat came, more than KEEP_MS ago, with
 *  its page images. Each is checked again under its own lock, so a run another session is renewing
 *  is left alone (N13); a lock another session holds now leaves that folder to a later sweep. */
async function sweep(env: NodeJS.ProcessEnv): Promise<void> {
  const root = hostLocalDir(SITE, env);
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = pathWin32.join(root, entry.name);
    const lease = readLease(dir);
    if (!expired(lease)) continue;
    const matterRoot = lease?.matter_root;
    if (matterRoot === undefined) {
      removeOwn(dir); // a run from before the lease named its matter: no images can be found
      continue;
    }
    let lock;
    try {
      lock = await acquireLock(SITE, matterRoot, env);
    } catch (err) {
      if ((err as DataServerError).code === "lock_unavailable") continue;
      throw err;
    }
    try {
      if (expired(readLease(dir))) {
        removeImages(dir, matterRoot);
        removeOwn(dir);
      }
    } finally {
      lock.release();
    }
  }
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
  const held = await underLock(matterRoot, env, (dir) => hold(dir, runId));
  if ("refused" in held) throw new DataServerError(held.say, held.refused);
  return { orchestrator: held.orchestrator === true };
}

/** ingest_result's second check, made inside the case lock just before its write (R8): null while
 *  `runId` still holds the lease. */
export async function checkRun(matterRoot: string, runId: string, env: NodeJS.ProcessEnv = process.env): Promise<Refusal | null> {
  const held = await underLock(matterRoot, env, (dir) => hold(dir, runId));
  return "refused" in held ? held : null;
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
    else if (e.outcome === "refused" && !RETRYABLE.includes(String(e.reason)) && e.reason !== "invalid") ids.forEach((id) => outcomeOf.set(id, "blocked"));
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
  const consider = (item: Item, writable = true) => {
    const s = l.state(item.ref);
    if (s.state === "in_flight") inFlight += 1;
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
  for (const route of l.routes) {
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
      if (s.state === "in_flight") inFlight += 1;
      if (s.state === "new" || item.redo) dispatch.push(item);
      if (item.pass === 3 && s.state === "acked" && !item.redo) exhibits.push(s.result_id as string);
      if (item.pass === 3 && s.state !== "written" && s.state !== "failed") open = true;
    }
    // An exhibit write waits for its body write (spec §8.3); exhibits acknowledged since the last
    // call for the affidavit go in one call (§2.3).
    if (exhibits.length > 0) write.push({ ref: route.ref, contract: "affidavit_exhibits", result_ids: exhibits });
    if (affidavit.located && !open && exhibits.length === 0) close.push({ ref: route.ref, contract: "affidavit_exhibits" });
  }
  return { dispatch: dispatch.slice(0, Math.max(0, WINDOW - inFlight)), write, close, asked, inFlight };
}

/** The exhibit letters ingest_result's affidavit_exhibits converter needs, and whether this call,
 *  writing the exhibits `refsHere`, resolves the last of them. */
export async function affidavitRun(matterRoot: string, fileRef: string, refsHere: string[], env: NodeJS.ProcessEnv = process.env) {
  return underLock(matterRoot, env, (dir) => {
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

const ROUTE_KINDS = ["facts", "notice_of_application", "affidavit"];

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
    if (r.rendering === undefined && pathWin32.extname(stored).toLowerCase() !== ".pdf") {
      throw new ValidationError(`routes[${i}] is not a PDF, so it needs its rendering`);
    }
    return { ...r, file_path: stored };
  });
}

/** Records a dispatch's outcome made after `next`'s lock was released (S-m10). When that second lock
 *  cannot be had, the records wait here and the run's next `next` journals them first (N8), so an
 *  item whose inputs failed is never left counted as running. */
const unjournaled = new Map<string, Array<{ event: string; extra: Record<string, unknown> }>>();

function flushUnjournaled(dir: string, runId: string): void {
  for (const r of unjournaled.get(dir) ?? []) journal(dir, r.event, runId, r.extra);
  unjournaled.delete(dir);
}

async function next(args: IngestRunArgs, env: NodeJS.ProcessEnv): Promise<unknown> {
  const runId = requireRunId(args);
  const checked = checkRoutes(args.routes ?? [], args.matter_root);
  // Under the lock: route, plan and reserve each dispatch. The page images are rendered after the
  // lock is released (S-m10), so the run's other calls are not kept waiting on them.
  const reserved = await underLock(args.matter_root, env, (dir) => {
    const held = hold(dir, runId);
    if ("refused" in held) return held;
    flushUnjournaled(dir, runId);
    const l = ledger(runEvents(dir));
    let n = l.routes.length;
    const fresh: Route[] = [];
    const routed: string[] = [];
    const report: string[] = [];
    for (const r of checked) {
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
    const items = p.dispatch.map((item) => {
      const id = randomUUID();
      journal(dir, "dispatch", runId, { dispatch_id: id, ref: item.ref, agent: item.agent, contract: item.contract });
      return { id, item };
    });
    return { routed, report, items, write: p.write, close: p.close, asked: p.asked, inFlight: p.inFlight, dir };
  });
  if ("refused" in reserved) return reserved;

  const contexts = new Map<string, Record<string, unknown> | Error>();
  const dispatch = [];
  const built: Array<{ ref: string; dispatch_id: string; page_count?: number }> = [];
  const failed: string[] = [];
  const voided: string[] = [];
  let contextError: Error | null = null;
  mkdirSync(pathWin32.join(reserved.dir, "dispatches"), { recursive: true });
  for (const { id, item } of reserved.items) {
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
      // error is a fault of this server, and surfaces (N14).
      if (!(err instanceof DataServerError) || !ITEM_FAULTS.includes(String(err.code))) throw err;
      failed.push(item.ref);
    }
  }
  const records = [
    ...built.filter((b) => b.page_count !== undefined).map((b) => ({ event: "inputs", extra: b as Record<string, unknown> })),
    ...failed.map((ref) => ({ event: "ack", extra: { ref, ok: false, reason: "unreadable" } })),
    ...voided.map((id) => ({ event: "void", extra: { dispatch_id: id } })),
  ];
  if (records.length > 0) {
    try {
      await underLock(args.matter_root, env, (dir) => {
        for (const r of records) journal(dir, r.event, runId, r.extra);
      });
    } catch (err) {
      if ((err as DataServerError).code !== "lock_unavailable") throw err;
      unjournaled.set(reserved.dir, [...(unjournaled.get(reserved.dir) ?? []), ...records]);
    }
  }
  if (contextError && dispatch.length === 0) throw contextError;

  const lines = dispatch.length + reserved.write.length + reserved.close.length;
  return {
    ok: true,
    ...(reserved.routed.length ? { routed: reserved.routed } : {}),
    ...(reserved.report.length ? { report: reserved.report } : {}),
    dispatch,
    write: reserved.write.slice(0, Math.max(0, PAGE - dispatch.length)),
    close: reserved.close.slice(0, Math.max(0, PAGE - dispatch.length - reserved.write.length)),
    ...(reserved.asked.length ? { asked: reserved.asked.slice(0, PAGE) } : {}),
    running: reserved.inFlight + dispatch.length,
    ...(lines > PAGE ? { more: true } : {}),
  };
}

const ACK = /^(ok)\s+(\S+)\s+([0-9a-f-]{36})\s+\d+$|^(failed)\s+(\S+)\s+(\S+)$/;

/** Records one extractor reply that is not passed to ingest_result: a `failed` line, or the `ok` of
 *  a boundary scan, which writes nothing (spec §6.3). */
function recordAck(dir: string, runId: string, ack: string): Record<string, unknown> {
  const m = ACK.exec(ack.trim());
  if (!m) throw new ValidationError("ack must be one line: ok <ref> <result_id> <bytes>, or failed <ref> <reason>");
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
}

/** ingest_result's run check and its record: renews the heartbeat, refuses lease_lost or
 *  plugin_changed, and returns the run's mode and the route the document names by `ref`, or by its
 *  hash when one was routed. */
export async function runForWrite(matterRoot: string, runId: string, document: { ref?: string; file_hash?: string }, env: NodeJS.ProcessEnv = process.env): Promise<Refusal | WriteRun> {
  return underLock(matterRoot, env, (dir) => {
    const held = hold(dir, runId);
    if ("refused" in held) return held;
    const events = runEvents(dir);
    const routes = ledger(events).routes;
    // A line's ref (f3, f3:so, f3:B) names its file by the part before the first colon.
    const route = document.ref !== undefined
      ? routes.find((r) => r.ref === document.ref?.split(":")[0]) ?? null
      : routes.find((r) => r.file_hash === document.file_hash) ?? null;
    if (document.ref !== undefined && route === null) throw new ValidationError(`no file with ref ${document.ref} in this run`);
    const answered = { facts: [] as string[], relief: [] as string[] };
    const last = route ? events.filter((e) => e.event === "dispatch" && e.ref === route.ref && e.agent === "lawyer:extract-facts").pop() : undefined;
    if (last && existsSync(dispatchPath(dir, last.dispatch_id as string))) {
      const inputs = (JSON.parse(readFileSync(dispatchPath(dir, last.dispatch_id as string), "utf-8")) as { inputs: Record<string, unknown> }).inputs;
      answered.facts = ((inputs.ANSWERED_FACTS ?? []) as Array<{ fact_key: string }>).map((f) => f.fact_key);
      answered.relief = ((inputs.ANSWERED_RELIEF ?? []) as Array<{ relief_key: string }>).map((r) => r.relief_key);
    }
    return { ok: true as const, mode: held.mode, route, answered };
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
  return underLock(matterRoot, env, (dir) => {
    journalAcks(dir, runId, acks);
    journal(dir, "write", runId, write);
    for (const f of failures) journal(dir, "ack", runId, { ref: f.ref, ok: false, reason: f.reason });
    const l = ledger(runEvents(dir));
    return failures.map((f) => f.ref).filter((ref) => l.state(ref).failures >= 2);
  });
}

/** ingest_result's refusal before any write (S-M4): a result that cannot be read, was staged under
 *  another contract or version, or belongs to another file. Each result's reply is journaled first,
 *  where its staged result names its item, and every acknowledged item among them is recorded as a
 *  failed reply, so it is read once more (R4) rather than left waiting forever. A result that cannot
 *  be read names no item: the reply's own ref (`claimed`) stands in, when it names an item dispatched
 *  under this contract. */
export async function recordRefusal(matterRoot: string, runId: string, acks: Array<{ ref: string; result_id: string }>, resultIds: string[], reason: string, claimed: { ref: string; result_id: string; contract: string } | null, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  await underLock(matterRoot, env, (dir) => {
    const dispatched = claimed !== null && runEvents(dir).some((e) => e.event === "dispatch" && e.ref === claimed.ref && e.contract === claimed.contract);
    journalAcks(dir, runId, [...acks, ...(dispatched && claimed ? [{ ref: claimed.ref, result_id: claimed.result_id }] : [])]);
    const events = runEvents(dir);
    const l = ledger(events);
    for (const id of resultIds) {
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
  for (const entry of existsSync(root) ? readdirSync(root, { withFileTypes: true }) : []) {
    const path = dispatchPath(pathWin32.join(root, entry.name), dispatchId);
    if (!entry.isDirectory() || !existsSync(path)) continue;
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

export async function ingestRun(args: IngestRunArgs, env: NodeJS.ProcessEnv = process.env): Promise<unknown> {
  switch (args.action) {
    case "begin": {
      const mode = args.mode;
      if (mode !== "attended" && mode !== "unattended") throw new ValidationError("begin needs mode attended or unattended");
      await sweep(env);
      return underLock(args.matter_root, env, (dir) => {
        const current = readLease(dir);
        const now = new Date().toISOString();
        const runId = randomUUID();
        if (args.resume !== undefined) {
          // A run left unended by plugin_changed (R7) is resumed here; one that ended is not.
          if (current === null || current.ended !== null || current.run_id !== args.resume) return refusal("unknown_run");
          // A new id for the resuming session, so the displaced one is refused at its next call.
          writeLease(dir, { ...current, run_id: runId, heartbeat: now, build_stamp: BUILD_STAMP, mode });
          journal(dir, "takeover", runId, { displaced: current.run_id });
          flushUnjournaled(dir, runId);
          const p = plan(runEvents(dir), env);
          return { ok: true, run_id: runId, resumed: true, next: [...p.write, ...p.close], ...(p.asked.length ? { asked: p.asked } : {}) };
        }
        if (current !== null && isLive(current)) return { ...refusal("run_active"), run_id: current.run_id };
        if (current !== null && current.ended === null) journal(dir, "takeover", runId, { displaced: current.run_id });
        writeLease(dir, {
          run_id: runId, started: now, heartbeat: now, build_stamp: BUILD_STAMP, mode, ended: null,
          orchestrator: args.orchestrator === true, matter_root: args.matter_root,
        });
        journal(dir, "begin", runId, { mode });
        return { ok: true, run_id: runId, resumed: false, next: [] };
      });
    }
    case "status":
      return underLock(args.matter_root, env, (dir) => {
        if (args.run_id !== undefined) {
          const held = hold(dir, args.run_id);
          if ("refused" in held) return held;
        }
        if (args.ack !== undefined) return recordAck(dir, requireRunId(args), args.ack);
        const lease = readLease(dir);
        const p = isLive(lease) ? plan(runEvents(dir), env) : { write: [], close: [], asked: [] };
        return {
          ok: true,
          active: isLive(lease),
          run_id: lease?.run_id ?? null,
          started: lease?.started ?? null,
          heartbeat: lease?.heartbeat ?? null,
          mode: lease?.mode ?? null,
          ended: lease?.ended ?? null,
          next: [...p.write, ...p.close],
          ...(p.asked.length ? { asked: p.asked } : {}),
        };
      });
    case "next":
      return next(args, env);
    case "staged": {
      const runId = requireRunId(args);
      return underLock(args.matter_root, env, (dir) => {
        const held = hold(dir, runId);
        if ("refused" in held) return held;
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
      return underLock(args.matter_root, env, (dir) => {
        const lease = renew(dir, runId);
        if (lease === null) return refusal("lease_lost");
        writeLease(dir, { ...lease, ended: lease.heartbeat });
        journal(dir, "end", runId);
        // The dispatches' stored inputs (parties, answered facts) and a bridged run's page images,
        // a displaced earlier run's included (N13), are not needed once the run has ended (S-m15).
        removeImages(dir, args.matter_root);
        removeOwn(pathWin32.join(dir, "dispatches"));
        return { ok: true, run_id: runId };
      });
    }
    default:
      throw new ValidationError(`unknown action ${JSON.stringify(args.action)}; expected begin, next, staged, status or end`);
  }
}
