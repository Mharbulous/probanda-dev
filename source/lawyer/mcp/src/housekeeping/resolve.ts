// One resolve function for /housekeeping's approved rows (spec §B9.1, §B9.2, §B9.4).
//
// A row's effective action is a function of its proposal.json row (its one proposed action,
// §B7.5) alone. Only rows with an approval.json entry (always approve) are resolved: a row left as
// is has no entry and means nothing to do. The live apply and the recovery (§B10) both call this,
// so they cannot disagree about what a row means. Nothing here moves a file: it names the kind, the chosen name and folder, the
// expected old and new paths, the folders a move would create, and the apply-time checks.

import { readdirSync, realpathSync, statSync } from "node:fs";
import { win32 as pathWin32 } from "node:path";

import { DataServerError } from "../errors.js";
import { zoneProblem } from "../files/zones.js";
import { resolveCaseDataRoot } from "../practice/matter-data-root.js";
import { type GateGroup, type GateResult, runNameGate } from "./name-gate.js";
import { type Approval, INFORMATION_ONLY, type Proposal, type Row } from "./proposal.js";
import {
  type JournalLine,
  type Matter,
  existingRunDir,
  isDirectory,
  openMatter,
  readJournal,
  requireApproval,
  requireProposal,
} from "./run-dir.js";

export type Kind =
  | "rename_and_file"
  | "rename_in_place"
  | "answered_question"
  | "final"
  | "file_no_ingest"
  | "draft_unchanged"
  | "ingested_by_reference"
  | "retry"
  | "trash"
  | "invalid";

export interface NameVerdict {
  verdict: "pass" | "fail" | "second_pass_required" | "not_checked";
  reason?: string;
  flags?: string[];
}

export interface Check {
  ok: boolean;
  reason?: string;
}

export interface Resolution {
  row_id: string;
  kind: Kind;
  /** The row moves a file: it gets one journal line. A trash row moves through file_ops__trash. */
  move: boolean;
  old_path: string;
  new_path?: string;
  name?: string;
  /** Matter-root-relative, on-disk names where the folder exists. */
  folder?: string;
  /** Absolute, parent first. Pass to file_ops__move as create_folders. */
  folders_to_create: string[];
  answer?: string;
  checks?: { name: NameVerdict; clash: Check; folder: Check };
  /** Every check passed. False with no `failure` means a name awaits the folder's prose second pass. */
  ok: boolean;
  failure?: string;
  journal?: JournalLine;
}

const PLACEHOLDER = /^party #\d+$/i;

/** The firm's template matter, the SSOT for standard folders (§B9.2). Resolved at call time from
 * the configured case data root, whose parent is the firm's litigation library -- a literal
 * would bake one host path and one firm's name into the bundle. */
export function templateRoot(env: NodeJS.ProcessEnv = process.env): string {
  if (env.COCLERK_HOUSEKEEPING_TEMPLATE_ROOT) return env.COCLERK_HOUSEKEEPING_TEMPLATE_ROOT;
  let caseData: string;
  try {
    caseData = resolveCaseDataRoot(env);
  } catch (err) {
    throw new DataServerError(
      `the template matter cannot be located: it sits beside probanda.json's "case_data_root", which did not resolve ` +
        `(${(err as Error).message}). Fix "case_data_root", or set COCLERK_HOUSEKEEPING_TEMPLATE_ROOT.`,
      "template_missing"
    );
  }
  return pathWin32.join(pathWin32.dirname(caseData), "ADMIN", "0. TEMPLATE", "L### Litigation");
}

export async function resolveRun(
  matterRoot: string,
  runId: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<{ run_id: string; approved_at: string; rows: Resolution[] }> {
  const matter = openMatter(matterRoot);
  const dir = existingRunDir(matter, runId);
  const proposal = requireProposal(dir, runId, matter.root);
  const approval = requireApproval(dir, runId);
  return { run_id: runId, approved_at: approval.approved_at, rows: resolveRows(matter, proposal, approval, readJournal(dir), env) };
}

interface Decision {
  kind: Kind;
  error?: string;
  name?: string;
  /** The current name is kept and never gated: a `draft` row, or a `move` row filed without reading. */
  keep?: boolean;
  folderRel?: string;
  answer?: string;
}

/** One approval entry, decided and mapped onto disk, before the name gate runs. */
export interface Planned {
  res: Resolution;
  row?: Row;
  decision: Decision;
}

/** Resolves every approval entry against its proposal row. */
export function resolveRows(
  matter: Matter,
  proposal: Proposal,
  approval: Approval,
  journal: Map<string, JournalLine>,
  env: NodeJS.ProcessEnv
): Resolution[] {
  return checkRows(planRows(matter, proposal, approval, journal, env), proposal, env);
}

/** The row gets one journal line: a move row (a trash row included) or an invalid entry. */
export function needsJournalLine(res: Resolution): boolean {
  return res.move || res.kind === "invalid";
}

/**
 * Every approval entry's kind, chosen name and folder, paths and move flag, with the folder check.
 * Cheap: the name gate is not run until checkRows.
 */
export function planRows(
  matter: Matter,
  proposal: Proposal,
  approval: Approval,
  journal: Map<string, JournalLine>,
  env: NodeJS.ProcessEnv
): Planned[] {
  const rows = new Map(proposal.rows.map((r) => [r.row_id, r]));
  const template = new TemplateTree(env);
  const out: Planned[] = [];

  for (const entry of approval.rows) {
    const row = rows.get(entry.row_id);
    const oldPath = row ? pathWin32.join(matter.root, row.current_path) : "";
    const decision: Decision = row ? decide(proposal, row) : { kind: "invalid", error: "the row is not in proposal.json" };
    const res: Resolution = { row_id: entry.row_id, kind: decision.kind, move: false, old_path: oldPath, folders_to_create: [], ok: false };
    const line = journal.get(entry.row_id);
    if (line) res.journal = line;
    if (decision.answer !== undefined) res.answer = decision.answer;
    out.push({ res, row, decision });
    if (decision.error) {
      res.failure = decision.error;
      continue;
    }
    if (decision.kind === "trash") {
      res.move = true;
      res.ok = true;
      continue;
    }
    if (decision.kind === "retry") {
      res.ok = true;
      continue;
    }

    const folder = mapFolder(matter.root, decision.folderRel as string);
    res.folder = folder.rel;
    res.folders_to_create = folder.missing;
    res.checks = {
      name: { verdict: "not_checked" },
      clash: { ok: true },
      folder: folderCheck(matter.root, decision, folder, row as Row, proposal, template),
    };
    res.name = decision.name;
    res.new_path = pathWin32.join(folder.abs, decision.name as string);
    res.move = res.new_path !== oldPath;
  }
  return out;
}

/** Runs the name gate (one spawn) and the clash check over planned rows, completing each resolution. */
export function checkRows(planned: Planned[], proposal: Proposal, env: NodeJS.ProcessEnv): Resolution[] {
  const groups: GateGroup[] = [];
  const gates = new Map<Planned, { group: number; index: number }>();
  for (const item of planned) {
    const { res, decision } = item;
    if (!res.checks || decision.keep) continue;
    const tokens = folderEntry(proposal, decision.folderRel as string)?.flag_tokens ?? [];
    let g = groups.findIndex((x) => x.flag_tokens.join("\0") === tokens.join("\0"));
    if (g < 0) g = groups.push({ names: [], flag_tokens: tokens }) - 1;
    gates.set(item, { group: g, index: groups[g].names.push(decision.name as string) - 1 });
  }

  const results: GateResult[][] = groups.length ? runNameGate(groups, env) : [];
  const claimed = new Map<string, string>();
  for (const item of planned) {
    const { res, row, decision } = item;
    if (!res.checks) continue;
    const gate = gates.get(item);
    if (gate) {
      res.checks.name = nameVerdict(results[gate.group][gate.index], row as Row, decision, proposal);
    }
    res.checks.clash = clashCheck(res, claimed);
    const failed = [res.checks.folder, res.checks.clash].find((c) => !c.ok);
    const nameOk = res.checks.name.verdict === "pass" || res.checks.name.verdict === "not_checked";
    res.ok = nameOk && !failed;
    if (res.checks.name.verdict === "fail") res.failure = `name check failed: ${res.checks.name.reason}`;
    else if (failed) res.failure = failed.reason;
  }
  return planned.map((item) => item.res);
}

function decide(proposal: Proposal, row: Row): Decision {
  const invalid = (error: string): Decision => ({ kind: "invalid", error });
  const a = row.action;
  const currentName = pathWin32.basename(row.current_path);
  const currentFolder = pathWin32.dirname(row.current_path);

  // validateProposal and validateApproval hold every per-kind field rule (§B7.5) on each read.
  if (row.section !== "offered" || !a) return invalid(`the row was not offered for a decision (${row.section})`);
  if (INFORMATION_ONLY.includes(a.kind)) return invalid(`the row is information only (${a.kind}): nothing is approved on it`);

  switch (a.kind) {
    case "duplicate":
      return { kind: "trash" };
    case "unreadable":
      return { kind: "retry" };
    case "draft":
      return { kind: "draft_unchanged", name: currentName, keep: true, folderRel: proposal.draft_folder as string };
  }

  const folderRel = a.kind === "rename" ? currentFolder : (a.folder as string);
  const name = a.kind === "move" ? currentName : (a.name as string);

  let kind: Kind;
  if (a.file_no_ingest) kind = "file_no_ingest";
  else if (a.final) kind = "final";
  else if (a.answer !== undefined) kind = "answered_question";
  else if (row.ingest_outcome === "ingested_by_reference") kind = "ingested_by_reference";
  else if (row.ingest_outcome !== "ingested") return invalid(`the file is not ingested (${row.ingest_outcome}), so it cannot be filed`);
  else kind = same(folderRel, currentFolder) ? "rename_in_place" : "rename_and_file";

  const decision: Decision = { kind, folderRel, name, keep: a.kind === "move" && a.file_no_ingest === true };
  if (kind === "answered_question") decision.answer = a.answer;
  return decision;
}

function nameVerdict(gate: GateResult, row: Row, decision: Decision, proposal: Proposal): NameVerdict {
  const folderRel = decision.folderRel as string;
  const name = decision.name as string;
  const precomputed = row.name_checks.find((c) => c.name === name && same(c.folder, folderRel));
  if (precomputed && !precomputed.ok) return { verdict: "fail", reason: precomputed.reason ?? `does not pass the check for ${folderRel}` };
  // A raised flag token fails the folder's check outright: no second-pass format rescues it (§B7.4).
  if (gate.flags.length) return { verdict: "fail", reason: `flag token raised: ${gate.flags.join(", ")}`, flags: gate.flags };
  if (gate.verdict === "conforms") return { verdict: "pass" };
  if (precomputed?.ok) return { verdict: "pass", reason: "passed the page-build check for this folder" };
  const secondPass = folderEntry(proposal, folderRel)?.second_pass === true;
  return { verdict: secondPass ? "second_pass_required" : "fail", reason: gate.reason };
}

function clashCheck(res: Resolution, claimed: Map<string, string>): Check {
  if (!res.move || !res.new_path) return { ok: true };
  const key = res.new_path.toLowerCase();
  const other = claimed.get(key);
  if (other) return { ok: false, reason: `row ${other} files to the same name` };
  claimed.set(key, res.row_id);
  if (!exists(res.new_path) || sameFile(res.new_path, res.old_path)) return { ok: true };
  return { ok: false, reason: `a file named ${pathWin32.basename(res.new_path)} is already in ${res.folder}` };
}

interface MappedFolder {
  /** Absolute path, on-disk names for the segments that exist. */
  abs: string;
  rel: string;
  /** Absolute paths of the segments that do not exist, parent first. */
  missing: string[];
  ambiguous?: string;
}

/** Maps a chosen folder onto disk. A folder is present when a name matches ignoring case and a
 * trailing plural (§B9.2), so housekeeping never makes a second copy of one. */
function mapFolder(root: string, rel: string): MappedFolder {
  let abs = root;
  const missing: string[] = [];
  let ambiguous: string | undefined;
  for (const segment of rel.split(/[\\/]+/)) {
    if (missing.length === 0 && isDirectory(abs)) {
      const found = matchName(childDirs(abs), segment);
      if (found.ambiguous) ambiguous ??= `${segment} matches ${found.ambiguous.join(" and ")} in ${pathWin32.relative(root, abs) || "the matter root"}`;
      if (found.name) {
        abs = pathWin32.join(abs, found.name);
        continue;
      }
    }
    abs = pathWin32.join(abs, segment);
    missing.push(abs);
  }
  return { abs, rel: pathWin32.relative(root, abs), missing, ambiguous };
}

function folderCheck(root: string, decision: Decision, folder: MappedFolder, row: Row, proposal: Proposal, template: TemplateTree): Check {
  if (folder.ambiguous) return { ok: false, reason: `the folder is ambiguous: ${folder.ambiguous}` };
  const problem = zoneProblem("move-to", folder.abs, root, decision.kind === "draft_unchanged");
  if (problem) return { ok: false, reason: problem };
  if (decision.kind === "draft_unchanged") {
    return folder.missing.length ? { ok: false, reason: `${proposal.draft_folder} does not exist` } : { ok: true };
  }
  for (const missing of folder.missing) {
    const rel = pathWin32.relative(root, missing);
    // The one approved non-standard folder: the row's own destination, marked create_folder.
    if (row.action?.create_folder && same(rel, decision.folderRel as string)) continue;
    const problem = template.creatable(rel.split(pathWin32.sep));
    if (problem) return { ok: false, reason: problem };
  }
  return { ok: true };
}

/** The template tree, located and listed lazily: both happen only when some chosen folder is missing. */
class TemplateTree {
  private readonly listings = new Map<string, string[] | null>();
  private located?: { root: string } | { error: string };

  constructor(private readonly env: NodeJS.ProcessEnv) {}

  /** Null when `segments` (matter-root-relative) may be created, else why not. */
  creatable(segments: string[]): string | null {
    const shown = segments.join("\\");
    if (segments.some((s) => PLACEHOLDER.test(s))) return `${shown}: a Party #N placeholder folder is never created`;
    const where = this.locate();
    if ("error" in where) return `${shown} is missing and ${where.error}`;
    let cursor = where.root;
    for (const segment of segments) {
      const children = this.list(cursor);
      if (children === null) return `${shown} is missing and the template matter was not found at ${where.root}`;
      const found = matchName(children, segment, true);
      if (!found.name) return `${shown} is not one of the firm's standard folders and was not approved as a new folder`;
      if (PLACEHOLDER.test(found.name)) return `${shown}: a Party #N placeholder folder is never created`;
      if (found.name.endsWith("#") && segment.toLowerCase() === found.name.toLowerCase()) {
        return `${shown}: a court-file folder needs its action number`;
      }
      cursor = pathWin32.join(cursor, found.name);
    }
    return null;
  }

  private locate(): { root: string } | { error: string } {
    if (!this.located) {
      try {
        this.located = { root: templateRoot(this.env) };
      } catch (err) {
        this.located = { error: (err as Error).message };
      }
    }
    return this.located;
  }

  private list(dir: string): string[] | null {
    if (!this.listings.has(dir)) this.listings.set(dir, isDirectory(dir) ? childDirs(dir) : null);
    return this.listings.get(dir) as string[] | null;
  }
}

/** Case- and trailing-plural-insensitive match. With `stems`, a template name ending in `#`
 * (`5. COURT FILE#`) also matches any longer name it begins (`5. COURT FILE#S-290001`). */
function matchName(candidates: string[], wanted: string, stems = false): { name?: string; ambiguous?: string[] } {
  const exact = candidates.filter((c) => c.toLowerCase() === wanted.toLowerCase());
  if (exact.length) return { name: exact[0] };
  const plural = candidates.filter((c) => depluralize(c) === depluralize(wanted));
  if (plural.length > 1) return { ambiguous: plural };
  if (plural.length === 1) return { name: plural[0] };
  if (stems) {
    const stem = candidates.find((c) => c.endsWith("#") && wanted.toLowerCase().startsWith(c.toLowerCase()));
    if (stem) return { name: stem };
  }
  return {};
}

function depluralize(name: string): string {
  return name.toLowerCase().replace(/s$/, "");
}

function childDirs(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
}

function folderEntry(proposal: Proposal, rel: string) {
  // The nearest listed folder at or above `rel`: a Law issue folder takes the Law folder's rules.
  let best: Proposal["folders"][number] | undefined;
  for (const folder of proposal.folders) {
    const f = folder.path.toLowerCase().replace(/\//g, "\\");
    const r = rel.toLowerCase().replace(/\//g, "\\");
    if ((r === f || r.startsWith(f + "\\")) && (!best || folder.path.length > best.path.length)) best = folder;
  }
  return best;
}

function same(a: string, b: string): boolean {
  const norm = (p: string) => p.replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();
  return norm(a) === norm(b);
}

function exists(path: string): boolean {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}

/** Both paths name one file (a case-only rename). */
export function sameFile(a: string, b: string): boolean {
  try {
    return realpathSync.native(a).toLowerCase() === realpathSync.native(b).toLowerCase();
  } catch {
    return false;
  }
}
