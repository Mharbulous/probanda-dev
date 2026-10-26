// /housekeeping's work list, built host-side in one call (Steps 6-7 of the skill, issue #174).
//
// Lists the candidates by Step 6's rules, hashes them, runs the name gate and its mechanical second
// pass, reads ingest status and the review log through /matter-data's housekeeping_lookup.py (one
// spawn: the SQL and the verdict code stay in that skill's operation files), admits by Step 7's
// rules and orders and caps with orderCandidates. Only admitted files leave with their hash: a
// file that is not admitted is never returned. A deferred file carries its hash only because
// proposal.json's deferred rows require one.
// Read-only: it renames, moves and writes nothing.

import { readdirSync } from "node:fs";
import { win32 as pathWin32 } from "node:path";

import { DataServerError } from "../errors.js";
import { pythonDriverFile } from "../python-driver.js";
import { runPythonDriver } from "../python-spawn.js";
import { pythonTimeoutMs } from "../python-timeout.js";
import { caseDataMigrateScriptsDir } from "../repo-root.js";
import { type GateGroup, type GateResult, runNameGate } from "./name-gate.js";
import { orderCandidates } from "./order.js";
import { relativePathProblem, samePath } from "./proposal.js";
import { hashAt } from "./reconcile.js";
import { existingRunDir, openMatter } from "./run-dir.js";

// Hashing a few hundred files over a synced folder can outlast READ_TIMEOUT_MS. The Cowork bridge
// gives up on a tool call after 60 s (case/ingest-coverage.ts); the live run on a 330-file matter
// measures whether this budget holds. Past it the call fails whole, never with a partial list.
export const CANDIDATES_TIMEOUT_MS = 120_000;

const WHITELIST = new Set([".pdf", ".docx", ".doc", ".eml", ".msg", ".xls"]);
const NEVER_ROOT_FILES = new Set(["probanda.json", "coclerk.json", "claude.md", "agents.md", "proceduralhistory.md", "desktop.ini"]);
// The pointer copies matter-data's relocate writes before it changes the pointer (relocate_case_data.py).
const POINTER_BACKUP = /^(?:probanda|coclerk)\.json\.bak-\d{8}t\d{6}z$/;
const NEVER_ROOT_FOLDERS = new Set(["trash", "claude outputs"]);
const NUMBERED_0_OR_1 = /^[01](?!\d)/;
const HASH_CONCURRENCY = 8;

// The mechanical second pass (file-sorting's litigation-matter profile, "Name-gate second pass").
// Law: `[Neutral citation] [Short style of cause]` and `YYYY-MM-DD Alexi|Westlaw|Claude <topic>`
// (notes/law-notes.md). Discovery: `[Party][Part].[No] - ` before a name that passes the gate, and
// the legacy bare item number, which the notes say to leave alone (notes/discovery-notes.md).
const LAW_CITATION = /^\d{4} [A-Za-z][A-Za-z.]* \d+ \S.*$/;
const LAW_AI_MEMO = /^\d{4}-\d{2}-\d{2} (?:Alexi|Westlaw|Claude) \S.*$/;
const DISCOVERY_ITEM = /^[A-Za-z]+\d+\.\d+ - (.+)$/;
const DISCOVERY_LEGACY = /^[A-Za-z]*\d+\.\d+$/;

const DRIVER = String.raw`
import json, sys


def main():
    request = json.loads(sys.stdin.read())
    try:
        from housekeeping_lookup import run
        sys.stdout.write(json.dumps({"ok": True, "result": run(request)}))
    except BaseException as exc:
        sys.stdout.write(json.dumps({"ok": False, "error": "%s: %s" % (type(exc).__name__, exc)}))


main()
`.trim();

export interface SweptFolder {
  path: string;
  folder_type: string;
  flag_tokens?: string[];
  second_pass?: boolean;
}

export interface CandidatesArgs {
  matter_root: string;
  run_id: string;
  swept_folders: SweptFolder[];
  skip_folders: string[];
  subfolder?: string;
  files?: string[];
  finished?: string[];
  force?: boolean;
}

export interface NameResult {
  verdict: "conforms" | "fails" | "second_pass_required";
  reason: string;
  flags: string[];
}

/** One `ingest-status` entry, as housekeeping_lookup.py returns it. */
export interface IngestEntry {
  path: string;
  hash: string;
  verdict: string;
  [field: string]: unknown;
}

/** One review-log lookup result, as housekeeping_lookup.py returns it. */
export interface ReviewEntry {
  reviewed: boolean;
  not_ingested: boolean;
  [field: string]: unknown;
}

export interface LookupRequest {
  case_data_dir: string;
  matter_root: string;
  files: { path: string; hash: string }[];
}

export interface LookupResult {
  ingest: IngestEntry[];
  reviews: ReviewEntry[];
}

export interface CandidatesDeps {
  gate?: (groups: GateGroup[], env: NodeJS.ProcessEnv) => GateResult[][];
  lookup?: (request: LookupRequest, env: NodeJS.ProcessEnv, timeoutMs: number) => LookupResult;
  env?: NodeJS.ProcessEnv;
}

/** An admitted row carries only what Steps 8-13 read, so 50 rows fit a tool reply (Cowork saved a 78,615-character one to a file). */
export interface AdmittedRow {
  path: string;
  hash: string;
  location: "root" | "subfolder";
  folder_type: string | null;
  admitted_by: "root" | "name" | "ingest" | "both";
  name: NameResult | null;
  ingest: Record<string, unknown>;
  ingest_failure?: unknown;
}

export interface CandidatesResult {
  run_id: string;
  previous_run: string | null;
  header: { open_in_word: string[]; folders_not_looked_inside: string[] };
  errors: { path: string; error: string }[];
  admitted: AdmittedRow[];
  deferred: { path: string; hash: string }[];
}

interface Listed {
  path: string;
  folder: SweptFolder | null;
}

const HELD = new Set(["ingested", "ingested_by_reference", "superseded"]);

export async function candidates(args: CandidatesArgs, deps: CandidatesDeps = {}): Promise<CandidatesResult> {
  const env = deps.env ?? process.env;
  const started = Date.now();
  const budget = pythonTimeoutMs(env, CANDIDATES_TIMEOUT_MS, "COCLERK_CASE_PYTHON_TIMEOUT_MS");
  const matter = openMatter(args.matter_root);
  existingRunDir(matter, args.run_id);
  const swept = checkSwept(matter.root, args.swept_folders);

  const { listed, header } = list(matter.root, swept, args.skip_folders ?? []);
  const scoped = applyArgument(listed, args);

  const errors: { path: string; error: string }[] = [];
  const hashed = await hashAll(matter.root, scoped, errors);
  if (Date.now() - started > budget) throw overBudget(budget, `hashing ${scoped.length} files`);

  const names = gateNames(hashed, deps.gate ?? runNameGate, env);

  const lookup = deps.lookup ?? runLookup;
  const remaining = Math.max(budget - (Date.now() - started), 1);
  const found = lookup({ case_data_dir: matter.caseData, matter_root: matter.root, files: hashed.map(({ path, hash }) => ({ path, hash })) }, env, remaining);
  if (found.ingest.length !== hashed.length || found.reviews.length !== hashed.length) {
    throw new DataServerError(
      `the matter-data lookup returned ${found.ingest.length} ingest entries and ${found.reviews.length} review entries for ${hashed.length} files`,
      "lookup_failed"
    );
  }

  const rows = new Map<string, AdmittedRow>();
  hashed.forEach((c, i) => {
    const ingest = found.ingest[i];
    const review = found.reviews[i];
    const name = names[i];
    let admittedBy: AdmittedRow["admitted_by"] | null = null;
    if (c.folder === null) {
      admittedBy = "root";
    } else {
      const nameArm = name!.verdict !== "conforms" && (args.force === true || !review.reviewed);
      const ingestArm = !HELD.has(ingest.verdict) && !review.not_ingested;
      admittedBy = nameArm && ingestArm ? "both" : nameArm ? "name" : ingestArm ? "ingest" : null;
    }
    if (admittedBy === null) return;
    rows.set(samePath(c.path), {
      path: c.path,
      hash: c.hash,
      location: c.folder === null ? "root" : "subfolder",
      folder_type: c.folder?.folder_type ?? null,
      admitted_by: admittedBy,
      name,
      ingest: slimIngest(ingest),
      ...(review.ingest_failure ? { ingest_failure: review.ingest_failure } : {}),
    });
  });

  const ordered = orderCandidates(args.matter_root, args.run_id, [...rows.values()].map(({ path, hash }) => ({ path, hash })));
  return {
    run_id: ordered.run_id,
    previous_run: ordered.previous_run,
    header,
    errors,
    admitted: ordered.admitted.map((c) => rows.get(samePath(c.path)) as AdmittedRow),
    deferred: ordered.deferred.map((c) => ({ path: c.path, hash: c.hash })),
  };
}

// The stored fields Step 12's cross-check compares: date, category and parties.
const CROSS_CHECK = ["date", "category", "filed_by", "author", "recipient"];

/**
 * The ingest-status entry less what no later step reads (the echoed path and hash, `stored_path`,
 * `merged_into`) and less every null, false or empty field. `metadata` keeps the cross-check's
 * fields, or the whole record on a duplicate, whose name is composed from its twin's record.
 */
function slimIngest(entry: IngestEntry): Record<string, unknown> {
  const { path: _p, hash: _h, stored_path: _s, merged_into: _m, metadata, ...rest } = entry;
  const kept = metadata && typeof metadata === "object" ? (metadata as Record<string, unknown>) : {};
  const picked = entry.duplicate_of ? kept : Object.fromEntries(CROSS_CHECK.map((k) => [k, kept[k]]));
  return present({ ...rest, metadata: present(picked) });
}

function present(fields: Record<string, unknown>): Record<string, unknown> {
  const empty = (v: unknown) =>
    v === null || v === undefined || v === false || (Array.isArray(v) ? v.length === 0 : typeof v === "object" && Object.keys(v as object).length === 0);
  return Object.fromEntries(Object.entries(fields).filter(([, v]) => !empty(v)));
}

function checkSwept(root: string, swept: unknown): SweptFolder[] {
  if (!Array.isArray(swept)) throw new DataServerError("swept_folders must be an array", "invalid_argument");
  return swept.map((f, i) => {
    const refuse = (problem: string) => new DataServerError(`swept_folders[${i}] ${problem}`, "invalid_argument");
    const pathProblem = relativePathProblem(f?.path);
    if (pathProblem) throw refuse(`path ${pathProblem}`);
    if (typeof f.folder_type !== "string" || f.folder_type === "") throw refuse("folder_type must be the folder type's name");
    const segments = (f.path as string).split(/[\\/]+/);
    if (!childDirNames(pathWin32.join(root, ...segments.slice(0, -1))).includes(segments[segments.length - 1])) {
      throw refuse(`path ${f.path} is not a folder in the matter (give its on-disk name)`);
    }
    return { ...f, path: segments.join("\\") };
  });
}

/** Step 6's listing: root files, then every whitelisted file inside a swept folder. */
function list(root: string, swept: SweptFolder[], skip: string[]): { listed: Listed[]; header: CandidatesResult["header"] } {
  const skipped = new Set(skip.map((s) => s.toLowerCase()));
  const entries = readdirSync(root, { withFileTypes: true });
  const lockFiles = entries.filter((e) => e.isFile() && e.name.startsWith("~$")).map((e) => e.name.slice(2).toLowerCase());
  const header: CandidatesResult["header"] = { open_in_word: [], folders_not_looked_inside: [] };
  const listed: Listed[] = [];

  for (const e of entries) {
    const name = e.name;
    const lower = name.toLowerCase();
    if (name.startsWith("~") || name.startsWith(".")) continue;
    if (e.isDirectory()) {
      if (NEVER_ROOT_FOLDERS.has(lower) || skipped.has(lower)) continue;
      const sweptHere = !NUMBERED_0_OR_1.test(name) && swept.some((f) => f.path.split("\\")[0].toLowerCase() === lower);
      if (!sweptHere) header.folders_not_looked_inside.push(name);
      continue;
    }
    if (!e.isFile()) continue;
    const ext = pathWin32.extname(lower);
    if (NEVER_ROOT_FILES.has(lower) || POINTER_BACKUP.test(lower) || /^\.cm/.test(ext) || ext === ".lnk") continue;
    if (isOpenInWord(lower, lockFiles)) {
      header.open_in_word.push(name);
      continue;
    }
    listed.push({ path: name, folder: null });
  }

  const sweptPaths = new Set(swept.map((f) => f.path.toLowerCase()));
  for (const folder of swept) {
    if (NUMBERED_0_OR_1.test(folder.path)) continue;
    walk(root, folder.path, folder, sweptPaths, listed);
  }
  listed.sort(byPath);
  header.open_in_word.sort();
  header.folders_not_looked_inside.sort();
  return { listed, header };
}

/** A root file is open when a `~$` sibling has its extension and its stem less 0, 1 or 2 leading characters. */
function isOpenInWord(lower: string, lockFiles: string[]): boolean {
  const ext = pathWin32.extname(lower);
  const stem = lower.slice(0, lower.length - ext.length);
  return lockFiles.some((lock) => {
    const lockExt = pathWin32.extname(lock);
    if (lockExt !== ext) return false;
    const lockStem = lock.slice(0, lock.length - lockExt.length);
    return [0, 1, 2].some((k) => stem.slice(k) === lockStem);
  });
}

/** Every whitelisted file under `rel`, skipping `~`- and `.`-names; a nested swept folder is walked as its own. */
function walk(root: string, rel: string, folder: SweptFolder, sweptPaths: Set<string>, out: Listed[]): void {
  for (const e of readdirSync(pathWin32.join(root, rel), { withFileTypes: true })) {
    if (e.name.startsWith("~") || e.name.startsWith(".")) continue;
    const child = `${rel}\\${e.name}`;
    if (e.isDirectory()) {
      if (!sweptPaths.has(child.toLowerCase())) walk(root, child, folder, sweptPaths, out);
    } else if (e.isFile() && WHITELIST.has(pathWin32.extname(e.name).toLowerCase())) {
      out.push({ path: child, folder });
    }
  }
}

/** Root files by name, then subfolder files by folder, then name, lowercased (order.ts's fresh order). */
function byPath(a: Listed, b: Listed): number {
  const key = (l: Listed): [number, string, string] => {
    const p = samePath(l.path);
    const cut = p.lastIndexOf("\\");
    return [cut < 0 ? 0 : 1, cut < 0 ? "" : p.slice(0, cut).replace(/\\/g, "\0"), p.slice(cut + 1)];
  };
  const [ka, kb] = [key(a), key(b)];
  for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] < kb[i] ? -1 : 1;
  return 0;
}

/** The Arguments table: a subfolder sweeps only that folder (no root files); a file list keeps only those files. */
function applyArgument(listed: Listed[], args: CandidatesArgs): Listed[] {
  let out = listed;
  if (args.subfolder !== undefined) {
    const problem = relativePathProblem(args.subfolder);
    if (problem) throw new DataServerError(`subfolder ${problem}`, "invalid_argument");
    const prefix = `${samePath(args.subfolder)}\\`;
    out = out.filter((l) => l.folder !== null && samePath(l.path).startsWith(prefix));
  }
  if (args.files !== undefined) {
    const wanted = new Set(args.files.map((f) => samePath(f)));
    out = out.filter((l) => wanted.has(samePath(l.path)));
  }
  if (args.finished !== undefined) {
    const done = new Set(args.finished.map((f) => samePath(f)));
    out = out.filter((l) => !done.has(samePath(l.path)));
  }
  return out;
}

async function hashAll(root: string, listed: Listed[], errors: { path: string; error: string }[]): Promise<(Listed & { hash: string })[]> {
  const hashes: (string | null)[] = new Array(listed.length).fill(null);
  let next = 0;
  const worker = async () => {
    while (next < listed.length) {
      const i = next++;
      const l = listed[i];
      try {
        const at = await hashAt(pathWin32.join(root, ...l.path.split("\\")));
        if (at.kind === "file") hashes[i] = at.sha256;
        else errors.push({ path: l.path, error: at.kind === "absent" ? "the file is gone" : "not a file" });
      } catch (err) {
        errors.push({ path: l.path, error: (err as Error).message });
      }
    }
  };
  await Promise.all(Array.from({ length: HASH_CONCURRENCY }, worker));
  errors.sort((a, b) => (samePath(a.path) < samePath(b.path) ? -1 : 1));
  return listed.flatMap((l, i) => (hashes[i] === null ? [] : [{ ...l, hash: hashes[i] as string }]));
}

/** The gate over every subfolder name, grouped by flag tokens, in one spawn; then the second pass. Root rows get null. */
function gateNames(
  hashed: Listed[],
  gate: (groups: GateGroup[], env: NodeJS.ProcessEnv) => GateResult[][],
  env: NodeJS.ProcessEnv
): (NameResult | null)[] {
  const groups: GateGroup[] = [];
  const slot = (tokens: string[], name: string): [number, number] => {
    let g = groups.findIndex((x) => x.flag_tokens.join("\0") === tokens.join("\0"));
    if (g < 0) g = groups.push({ names: [], flag_tokens: tokens }) - 1;
    return [g, groups[g].names.push(name) - 1];
  };
  const slots = hashed.map((c) => {
    if (c.folder === null) return null;
    const name = pathWin32.basename(c.path);
    const tokens = c.folder.flag_tokens ?? [];
    const own = slot(tokens, name);
    // A Discovery listed-document name: gate its tail in the same spawn.
    const item = isType(c.folder, "Discovery") ? DISCOVERY_ITEM.exec(name) : null;
    return { own, tail: item ? slot(tokens, item[1]) : null };
  });
  const results = groups.length ? gate(groups, env) : [];
  const at = ([g, i]: [number, number]) => results[g][i];
  return hashed.map((c, i) => {
    const s = slots[i];
    if (s === null || c.folder === null) return null;
    return secondPass(at(s.own), s.tail ? at(s.tail) : null, c.folder, pathWin32.basename(c.path));
  });
}

function isType(folder: SweptFolder, type: string): boolean {
  return folder.second_pass === true && folder.folder_type.trim().toLowerCase() === type.toLowerCase();
}

function secondPass(gate: GateResult, tail: GateResult | null, folder: SweptFolder, name: string): NameResult {
  // A raised flag token fails the folder's check outright: no second-pass format rescues it.
  if (gate.flags.length) return { verdict: "fails", reason: `flag token raised: ${gate.flags.join(", ")}`, flags: gate.flags };
  if (gate.verdict === "conforms") return { verdict: "conforms", reason: gate.reason, flags: [] };
  if (folder.second_pass !== true) return { verdict: "fails", reason: gate.reason, flags: [] };
  const stem = name.slice(0, name.length - pathWin32.extname(name).length);
  if (isType(folder, "Law")) {
    if (LAW_CITATION.test(stem)) return { verdict: "conforms", reason: "Law citation form", flags: [] };
    if (LAW_AI_MEMO.test(stem)) return { verdict: "conforms", reason: "Law AI research memo form", flags: [] };
  }
  if (isType(folder, "Discovery")) {
    if (DISCOVERY_LEGACY.test(stem)) return { verdict: "conforms", reason: "Discovery legacy bare item number", flags: [] };
    if (tail && tail.verdict === "conforms" && tail.flags.length === 0) {
      return { verdict: "conforms", reason: "Discovery listed-document form", flags: [] };
    }
  }
  return { verdict: "second_pass_required", reason: gate.reason, flags: [] };
}

function overBudget(budget: number, what: string): DataServerError {
  return new DataServerError(
    `building the work list took longer than its ${budget} ms budget (${what}). Nothing was written and no list is returned; ` +
      "run /housekeeping on one subfolder at a time, or on a file list, to make the run smaller.",
    "python_timeout"
  );
}

/** One spawn of /matter-data's housekeeping_lookup.py: ingest-status and the review-log lookup per file, in order. */
function runLookup(request: LookupRequest, env: NodeJS.ProcessEnv, timeoutMs: number): LookupResult {
  const parsed = runPythonDriver({
    label: "matter-data housekeeping lookup",
    driver: pythonDriverFile("housekeeping-lookup-driver", DRIVER),
    payload: JSON.stringify(request),
    env,
    timeoutMs,
    extraEnv: { PYTHONPATH: caseDataMigrateScriptsDir(env) },
    timeoutAdvice:
      "Reading ingest status and the review log for the work list outlasted the budget. Nothing was written; " +
      "run /housekeeping on one subfolder at a time, or on a file list, to make the run smaller.",
    stagingDescription: "staging copy of the matter-data databases",
  }) as { ok: boolean; result?: { status: string; reason?: string } & Partial<LookupResult>; error?: string };
  if (!parsed.ok || !parsed.result) {
    throw new DataServerError(`the matter-data lookup failed: ${parsed.error ?? "no result"}`, "lookup_failed");
  }
  const r = parsed.result;
  if (r.status !== "ok") throw new DataServerError(`the matter-data lookup is ${r.status}: ${r.reason}`, "lookup_failed");
  return { ingest: r.ingest ?? [], reviews: r.reviews ?? [] };
}

function childDirNames(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}
