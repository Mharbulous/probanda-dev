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

import { randomUUID } from "node:crypto";
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
/** A run folder is deleted this long after its run ended (est., spec §2.4). */
const KEEP_MS = 30 * 24 * 60 * 60_000;
/** Extractors running at once: #70's wave size, kept as a concurrency limit (spec §8.1). */
const WINDOW = 10;
/** Lines per `next` page (est., spec §1.5). */
const PAGE = 50;
/** Pages per read (#70) and per boundary-scan batch (ingest-extract.md Pass 2). */
const READ_PAGES = 20;
const SCAN_PAGES = 40;
/** The contract version every D2 extractor stages (spec §6.2); R7 refuses any other. */
export const CONTRACT_VERSION = 1;

interface Lease {
  run_id: string;
  started: string;
  heartbeat: string;
  build_stamp: string | null;
  mode: "attended" | "unattended";
  ended: string | null;
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

function requireRunId(args: { run_id?: string; action?: string }): string {
  if (typeof args.run_id !== "string") throw new ValidationError(`${args.action ?? "this call"} needs run_id`);
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

type ItemState = "new" | "in_flight" | "acked" | "written" | "failed";

interface Ledger {
  routes: Route[];
  state(ref: string): { state: ItemState; result_id?: string; failures: number };
  written: (contract: string, ref: string) => Event | undefined;
  pageCount(ref: string): number | undefined;
}

function ledger(events: Event[]): Ledger {
  const routes = events.filter((e) => e.event === "route").map((e) => e.route as Route);
  let lastTakeover = -1;
  events.forEach((e, i) => {
    if (e.event === "takeover") lastTakeover = i;
  });
  const writtenIds = new Set<string>();
  for (const e of events) {
    if (e.event === "write" && (e.outcome === "written" || e.outcome === "already_written")) {
      for (const id of (e.result_ids as string[]) ?? []) writtenIds.add(id);
    }
  }
  return {
    routes,
    state(ref) {
      let failures = 0;
      let lastDispatch = -1;
      let last: Event | undefined;
      events.forEach((e, i) => {
        if (e.ref !== ref) return;
        if (e.event === "dispatch") lastDispatch = i;
        if (e.event === "ack") {
          last = e;
          if (!e.ok) failures += 1;
        }
      });
      const lastAck = last ? events.indexOf(last) : -1;
      if (last && lastAck > lastDispatch) {
        if (last.ok) {
          const id = last.result_id as string;
          return { state: writtenIds.has(id) ? "written" : "acked", result_id: id, failures };
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
    pageCount: (ref) => {
      const d = events.find((e) => e.event === "dispatch" && e.ref === ref && typeof e.page_count === "number");
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

/** An affidavit's exhibit work as far as the journal and the staged Pass 1 and Pass 2 results show it. */
export interface AffidavitPlan {
  items: Item[];
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
  const pass1 = staged(body.result_id as string, env) ?? {};
  const inventory = (Array.isArray(pass1.exhibit_inventory) ? pass1.exhibit_inventory : []) as Array<Record<string, unknown>>;
  const letters = inventory.map((e) => String(e.letter ?? "").trim()).filter((s) => s !== "");
  let bounds: Array<{ letter: string; start: number; end: number; uncertain: boolean }> = [];
  const items: Item[] = [];
  const stated = inventory.length > 0 && inventory.every((e) => Number(e.page_start) > 0 && Number(e.page_end) >= Number(e.page_start));
  let located = true;
  if (stated) {
    bounds = inventory.map((e) => ({ letter: String(e.letter), start: Number(e.page_start), end: Number(e.page_end), uncertain: false }));
  } else if (letters.length > 0) {
    // Pass 2 over the pages after the body, in ~40-page batches (ingest-extract.md Pass 2).
    const count = l.pageCount(route.ref) ?? 0;
    const first = Math.max(Number(pass1.body_page_count) || 1, 1) + 1;
    for (let k = 0, start = first; start <= count; k++, start += SCAN_PAGES) {
      const item: Item = { ref: `${route.ref}:p2:${k + 1}`, agent: "lawyer:extract-affidavit", contract: null, route, pass: 2, pages: [start, Math.min(count, start + SCAN_PAGES - 1)] };
      items.push(item);
      const s = l.state(item.ref);
      if (s.state === "acked" || s.state === "written") {
        const found = (staged(s.result_id as string, env)?.boundaries ?? []) as Array<Record<string, unknown>>;
        for (const b of found) {
          bounds.push({ letter: String(b.letter), start: Number(b.content_start), end: Number(b.content_end), uncertain: b.ocr_uncertain === true });
        }
      } else if (s.state !== "failed") located = false;
    }
  }
  if (!located) return { ...empty, items };
  const seen = new Set<string>();
  bounds = bounds.filter((b) => b.letter !== "" && !seen.has(b.letter) && seen.add(b.letter) && b.start > 0 && b.end >= b.start);
  const expected = bounds.map((b) => b.letter);
  const failed: string[] = [];
  for (const b of bounds) {
    const item: Item = { ref: `${route.ref}:${b.letter}`, agent: "lawyer:extract-affidavit", contract: "affidavit_exhibits", route, pass: 3, pages: [b.start, b.end], letter: b.letter };
    items.push(item);
    if (l.state(item.ref).state === "failed") failed.push(b.letter);
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
 *  documents whose extraction failed twice to close with their honest status (R4). */
function plan(events: Event[], env: NodeJS.ProcessEnv) {
  const l = ledger(events);
  const dispatch: Item[] = [];
  const write: Array<{ ref: string; contract: string; result_ids: string[] }> = [];
  const close: Array<{ ref: string; contract: string }> = [];
  let inFlight = 0;
  const consider = (item: Item) => {
    const s = l.state(item.ref);
    if (s.state === "in_flight") inFlight += 1;
    if (s.state === "new") dispatch.push(item);
    if (s.state === "acked" && item.contract) write.push({ ref: item.ref, contract: item.contract, result_ids: [s.result_id as string] });
    return s;
  };
  for (const route of l.routes) {
    if (route.kind !== "affidavit") {
      const s = consider({ ref: route.ref, agent: "lawyer:extract-facts", contract: "facts", route });
      if (s.state === "failed" && !l.written("facts", route.ref)) close.push({ ref: route.ref, contract: "facts" });
      if (route.kind === "notice_of_application") {
        consider({ ref: `${route.ref}:so`, agent: "lawyer:extract-sought-orders", contract: "sought_orders", route });
      }
      continue;
    }
    const body = consider({ ref: route.ref, agent: "lawyer:extract-affidavit", contract: "affidavit_body", route, pass: 1 });
    if (body.state === "failed" && !l.written("affidavit_body", route.ref)) close.push({ ref: route.ref, contract: "affidavit_body" });
    if (body.state !== "written" || route.rendering) continue;
    const affidavit = affidavitPlan(route, l, env);
    const exhibits: string[] = [];
    let open = false;
    for (const item of affidavit.items) {
      const s = l.state(item.ref);
      if (s.state === "in_flight") inFlight += 1;
      if (s.state === "new") dispatch.push(item);
      if (item.pass === 3 && s.state === "acked") exhibits.push(s.result_id as string);
      if (item.pass === 3 && s.state !== "written" && s.state !== "failed") open = true;
    }
    // An exhibit write waits for its body write (spec §8.3); exhibits acknowledged since the last
    // call for the affidavit go in one call (§2.3).
    if (exhibits.length > 0) write.push({ ref: route.ref, contract: "affidavit_exhibits", result_ids: exhibits });
    const closed = events.some((e) => e.event === "write" && e.contract === "affidavit_exhibits" && (e.refs as string[]).includes(route.ref) && e.closing === true);
    if (affidavit.located && !open && exhibits.length === 0 && !closed) close.push({ ref: route.ref, contract: "affidavit_exhibits" });
  }
  return { dispatch: dispatch.slice(0, Math.max(0, WINDOW - inFlight)), write, close, inFlight };
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

async function inputsFor(item: Item, matterRoot: string, context: Record<string, unknown>, bridged: boolean) {
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
    const destination = bridged ? pathWin32.join(matterRoot, "0. CASE DATA", "Page images") : undefined;
    const m = await pageManifest(file, range, destination);
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

function storedForm(path: string, matterRoot: string): string {
  let p = path.replace(/\//g, "\\");
  const r = matterRoot.replace(/\//g, "\\").replace(/\\+$/, "");
  if (p.toLowerCase().startsWith(r.toLowerCase() + "\\")) p = p.slice(r.length + 1);
  while (p.startsWith(".\\")) p = p.slice(2);
  return p;
}

async function next(args: IngestRunArgs, env: NodeJS.ProcessEnv): Promise<unknown> {
  const runId = requireRunId(args);
  return underLock(args.matter_root, env, async (dir) => {
    const held = hold(dir, runId);
    if ("refused" in held) return held;
    const known = runEvents(dir).filter((e) => e.event === "route").length;
    const routed: string[] = [];
    for (const [i, r] of (args.routes ?? []).entries()) {
      if (!ROUTE_KINDS.includes(r.kind)) throw new ValidationError(`routes[${i}].kind must be one of ${ROUTE_KINDS.join(", ")}`);
      if (!/^[0-9a-f]{64}$/.test(r.file_hash ?? "")) throw new ValidationError(`routes[${i}].file_hash must be the file's SHA-256`);
      const route: Route = { ...r, ref: `f${known + i + 1}`, file_path: storedForm(r.file_path, args.matter_root) };
      journal(dir, "route", runId, { route });
      routed.push(route.ref);
    }
    const p = plan(runEvents(dir), env);
    const contexts = new Map<string, Record<string, unknown>>();
    const dispatch = [];
    for (const item of p.dispatch) {
      const key = String(item.route.answers_source_id ?? "");
      if (!contexts.has(key)) contexts.set(key, matterContext(args.matter_root, item.route.answers_source_id, env));
      const { inputs, stage, pageCount } = await inputsFor(item, args.matter_root, contexts.get(key) as Record<string, unknown>, args.bridged === true);
      const id = randomUUID();
      mkdirSync(pathWin32.join(dir, "dispatches"), { recursive: true });
      writeFileSync(dispatchPath(dir, id), JSON.stringify({ inputs, stage, session: null }), "utf-8");
      journal(dir, "dispatch", runId, { dispatch_id: id, ref: item.ref, agent: item.agent, contract: item.contract, page_count: pageCount });
      // #70: every fact extractor stays on Opus at high effort, on every dispatch.
      dispatch.push({ dispatch_id: id, agent: item.agent, model: "opus", effort: "high", ref: item.ref, contract: item.contract, ...(stage.length ? { stage } : {}) });
    }
    const lines = [...dispatch, ...p.write, ...p.close].length;
    const more = lines > PAGE;
    return {
      ok: true,
      ...(routed.length ? { routed } : {}),
      dispatch,
      write: p.write.slice(0, Math.max(0, PAGE - dispatch.length)),
      close: p.close.slice(0, Math.max(0, PAGE - dispatch.length - p.write.length)),
      running: p.inFlight + dispatch.length,
      ...(more ? { more: true } : {}),
    };
  });
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

export async function recordAckLine(matterRoot: string, runId: string, ack: string, env: NodeJS.ProcessEnv = process.env) {
  return underLock(matterRoot, env, (dir) => recordAck(dir, runId, ack));
}

/** ingest_result's run check and its record: renews the heartbeat, refuses lease_lost or
 *  plugin_changed, and returns the run's mode and the route of `fileHash`, when one was routed. */
export async function runForWrite(matterRoot: string, runId: string, fileHash: string, env: NodeJS.ProcessEnv = process.env): Promise<Refusal | { ok: true; mode: Lease["mode"]; route: Route | null }> {
  return underLock(matterRoot, env, (dir) => {
    const held = hold(dir, runId);
    if ("refused" in held) return held;
    const route = ledger(runEvents(dir)).routes.find((r) => r.file_hash === fileHash) ?? null;
    return { ok: true as const, mode: held.mode, route };
  });
}

export async function recordWrite(matterRoot: string, runId: string, acks: Array<{ ref: string; result_id: string }>, write: Record<string, unknown>, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  await underLock(matterRoot, env, (dir) => {
    const events = runEvents(dir);
    for (const a of acks) {
      const already = events.some((e) => e.event === "ack" && e.ok === true && e.result_id === a.result_id);
      if (!already) journal(dir, "ack", runId, { ref: a.ref, ok: true, result_id: a.result_id });
    }
    journal(dir, "write", runId, write);
  });
}

/** The stored inputs of `dispatchId`, with a bridged session's copies in place of host paths. */
export function dispatchInputs(dispatchId: string, env: NodeJS.ProcessEnv = process.env): Record<string, unknown> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(dispatchId ?? "")) {
    throw new ValidationError("dispatch_id must be the id from your dispatch line");
  }
  const root = hostLocalDir(SITE, env);
  for (const entry of readdirSync(root, { withFileTypes: true })) {
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
          const p = plan(runEvents(dir), env);
          return { ok: true, run_id: runId, resumed: true, next: [...p.write, ...p.close] };
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
        if (args.ack !== undefined) return recordAck(dir, requireRunId(args), args.ack);
        const lease = readLease(dir);
        const p = isLive(lease) ? plan(runEvents(dir), env) : { write: [], close: [] };
        return {
          ok: true,
          active: isLive(lease),
          run_id: lease?.run_id ?? null,
          started: lease?.started ?? null,
          heartbeat: lease?.heartbeat ?? null,
          mode: lease?.mode ?? null,
          ended: lease?.ended ?? null,
          next: [...p.write, ...p.close],
        };
      });
    case "next":
      return next(args, env);
    case "staged": {
      const runId = requireRunId(args);
      return underLock(args.matter_root, env, (dir) => {
        if (renew(dir, runId) === null) return refusal("lease_lost");
        if (args.dispatch_id === undefined) return { ok: true, items: [] };
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
        return { ok: true, run_id: runId };
      });
    }
    default:
      throw new ValidationError(`unknown action ${JSON.stringify(args.action)}; expected begin, next, staged, status or end`);
  }
}
