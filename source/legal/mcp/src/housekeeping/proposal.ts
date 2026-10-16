// proposal.json and approval.json: the /housekeeping page model and the practitioner's choices
// (housekeeping redesign spec §B7.5, §B8.2, §B8.3, §C8).
//
// proposal.json is written by the session through housekeeping__write_run_file and is the whole
// page: the server renders from it and refuses to serve one that does not validate here.
// approval.json is written only by the page server: one `approve: true` entry per approved row id,
// nothing else. A row left as is has no entry.
//
// Paths inside proposal.json are matter-root-relative with backslash separators (the stored
// path form, §B4.2). Names are bare file names.

import { realpathSync } from "node:fs";
import { win32 as pathWin32 } from "node:path";

export const SECTIONS = ["offered", "ingested_only", "deferred"] as const;
export type Section = (typeof SECTIONS)[number];

/** The page groups rows by their one action, in page order (§B7.2), each under its page heading. */
export const ACTION_GROUPS = {
  file: "Rename and move",
  rename: "Rename",
  move: "Move",
  draft: "Unfinished drafts",
  duplicate: "Duplicates",
  misfiled: "Mis-filed",
  unreadable: "Unreadable",
  stuck: "Left where they are",
} as const;
export type ActionKind = keyof typeof ACTION_GROUPS;

/**
 * Kinds shown for information only (practitioner decision of 2026-09-27, #987): no radio pair, no
 * group box, not counted on the page, and never approved. Approve would do nothing on them.
 */
export const INFORMATION_ONLY: readonly ActionKind[] = ["misfiled", "stuck"];

/** §B4.1/§B4.2 verdicts, plus `stopped` (ingest stopped on a question). */
export const INGEST_OUTCOMES = ["ingested", "ingested_by_reference", "partial", "failed", "stopped", "none"] as const;
export type IngestOutcome = (typeof INGEST_OUTCOMES)[number];

/** A page-build check (§B7.4) of the proposed name against its destination. */
export interface NameCheck {
  name: string;
  folder: string;
  ok: boolean;
  reason?: string;
}

/** The one action an offered row proposes (§B7.5). Approve carries it out as it stands. */
export interface Action {
  kind: ActionKind;
  /** The new name: `rename` and `file`. */
  name?: string;
  /** The destination folder: `file` and `move`. */
  folder?: string;
  /** `folder` is a new non-standard folder, created when the row is approved. */
  create_folder?: boolean;
  /** Filed without reading it into the case database. */
  file_no_ingest?: boolean;
  /** A firm draft judged final: read in at apply, then filed. */
  final?: boolean;
  /** The option (a questions.json label) the session picked where ingest stopped on a question. */
  answer?: string;
  /** `misfiled`: the matter the file appears to belong to. */
  matter?: string;
  /** `stuck`: the short reason no proposal is possible. */
  reason?: string;
}

export interface Twin {
  path: string;
  row_id?: string;
  /** The other copy is in the case database at page build. */
  ingested: boolean;
}

export interface Row {
  row_id: string;
  current_path: string;
  hash: string;
  ingest_outcome: IngestOutcome;
  store?: "main" | "privileged" | "law";
  source_ids: Array<string | number>;
  section: Section;
  /** Present exactly on offered rows. */
  action?: Action;
  name_checks: NameCheck[];
  notes: string[];
  twin?: Twin;
}

export interface Folder {
  path: string;
  /** False: a missing template folder, created on apply. */
  exists: boolean;
  /** Passed to the name gate as --flag-tokens for names filed here (Law's designator list). */
  flag_tokens?: string[];
  /** The folder has alternate whole-name formats checked by the prose second pass (Law, Discovery). */
  second_pass?: boolean;
}

/** One naming-rule gap (§B13), self-contained so gaps can be read across matters. */
export interface RuleGap {
  run_date: string;
  matter_root: string;
  file_name: string;
  /** The three escape-log pieces (file-naming general-conventions.md). */
  trigger: string;
  current_rule: string;
  missing: string;
  reference_file: string;
  best_guess?: string | null;
  outcome?: string;
}

export interface Proposal {
  run_id: string;
  matter_root: string;
  created_at: string;
  header: {
    open_in_word: string[];
    folders_not_looked_inside: string[];
    finished_line?: string;
  };
  folders: Folder[];
  /** The on-disk `0. DRAFT` folder, the only folder-0 destination, or null when absent. */
  draft_folder: string | null;
  rows: Row[];
  rule_gaps: RuleGap[];
}

/** One approved row (§B8.3). A row left as is has no entry. */
export interface ApprovalEntry {
  row_id: string;
  approve: true;
}

export interface Approval {
  run_id: string;
  approved_at: string;
  rows: ApprovalEntry[];
}

const ENTRY_KEYS = new Set<string>(["row_id", "approve"]);

const ROW_ID_RE = /^[A-Za-z0-9._-]{1,64}$/;
export const HASH_RE = /^[0-9a-f]{64}$/;
const FORBIDDEN_NAME_CHARS = /[<>:"/\\|?*\x00-\x1f]/;
const RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/** Why `name` is not a bare Windows file name, or null. */
export function bareNameProblem(name: unknown): string | null {
  if (typeof name !== "string" || name.length === 0) return "is empty";
  if (name.length > 255) return "is longer than 255 characters";
  if (FORBIDDEN_NAME_CHARS.test(name)) return "contains a path separator or a character Windows forbids";
  if (name.includes("..")) return "contains '..'";
  if (/[. ]$/.test(name)) return "ends with a dot or a space";
  if (RESERVED_NAME.test(name)) return "is a name Windows reserves";
  return null;
}

/** Why `path` is not a matter-root-relative path, or null. */
export function relativePathProblem(path: unknown): string | null {
  if (typeof path !== "string" || path.length === 0) return "is empty";
  if (/^[A-Za-z]:/.test(path) || path.startsWith("\\") || path.startsWith("/")) return "is not matter-root-relative";
  for (const segment of path.split(/[\\/]+/)) {
    if (segment === "" || segment === "." || segment === "..") return "has an empty, '.' or '..' segment";
    if (/[<>:"|?*\x00-\x1f]/.test(segment)) return "contains a character Windows forbids";
  }
  return null;
}

/** Every problem with `value` as the proposal of run `runId` in matter `root`. Empty = valid. */
export function validateProposal(value: unknown, runId: string, root: string): string[] {
  const v = new Checker();
  if (!v.object(value, "proposal")) return v.problems;
  const p = value as Record<string, unknown>;
  if (p.run_id !== runId) v.add(`run_id is ${JSON.stringify(p.run_id)}, not this run's ${runId}`);
  if (typeof p.matter_root !== "string" || canonical(p.matter_root).toLowerCase() !== root.toLowerCase()) {
    v.add(`matter_root ${JSON.stringify(p.matter_root)} is not this matter (${root})`);
  }
  v.string(p.created_at, "created_at");
  if (v.object(p.header, "header")) {
    const h = p.header as Record<string, unknown>;
    v.strings(h.open_in_word, "header.open_in_word");
    v.strings(h.folders_not_looked_inside, "header.folders_not_looked_inside");
    v.optionalString(h.finished_line, "header.finished_line");
  }
  if (v.array(p.folders, "folders")) {
    (p.folders as unknown[]).forEach((f, i) => {
      const label = `folders[${i}]`;
      if (!v.object(f, label)) return;
      const folder = f as Record<string, unknown>;
      v.path(folder.path, `${label}.path`);
      v.boolean(folder.exists, `${label}.exists`);
      if (folder.flag_tokens !== undefined) v.strings(folder.flag_tokens, `${label}.flag_tokens`);
      if (folder.second_pass !== undefined) v.boolean(folder.second_pass, `${label}.second_pass`);
    });
  }
  if (p.draft_folder !== null) v.path(p.draft_folder, "draft_folder");
  if (v.array(p.rule_gaps, "rule_gaps")) {
    (p.rule_gaps as unknown[]).forEach((g, i) => {
      if (!v.object(g, `rule_gaps[${i}]`)) return;
      const gap = g as Record<string, unknown>;
      for (const key of ["run_date", "matter_root", "file_name", "trigger", "current_rule", "missing", "reference_file"]) {
        v.string(gap[key], `rule_gaps[${i}].${key}`);
      }
      if (gap.best_guess !== undefined && gap.best_guess !== null) v.string(gap.best_guess, `rule_gaps[${i}].best_guess`);
      v.optionalString(gap.outcome, `rule_gaps[${i}].outcome`);
    });
  }
  if (!v.array(p.rows, "rows")) return v.problems;
  const rows = p.rows as unknown[];
  const ids = new Set<string>();
  rows.forEach((r, i) => validateRow(v, r, `rows[${i}]`, ids, p.draft_folder));
  // A path names at most one row. A twin that is itself a row is followed through its row id to wherever that row files it (§C8).
  const byPath = new Map<string, string>();
  (rows as Row[]).forEach((r, i) => {
    if (typeof r?.current_path !== "string" || typeof r.row_id !== "string") return;
    const key = samePath(r.current_path);
    const earlier = byPath.get(key);
    if (earlier !== undefined) v.add(`rows[${i}].current_path ${r.current_path} is repeated: rows ${earlier} and ${r.row_id} name the same file`);
    else byPath.set(key, r.row_id);
  });
  rows.forEach((r, i) => {
    const twin = (r as Row)?.twin;
    if (typeof twin?.path !== "string") return;
    const label = `rows[${i}] (${(r as Row).row_id}).twin.row_id`;
    const twinRow = byPath.get(samePath(twin.path));
    if (twinRow !== undefined && twin.row_id !== twinRow) v.add(`${label} must be ${twinRow}: the twin ${twin.path} is that row on this page`);
    else if (twinRow === undefined && twin.row_id !== undefined) {
      if (!ids.has(twin.row_id)) v.add(`${label} ${twin.row_id} is not a row`);
      else v.add(`${label} ${twin.row_id} is not the row at ${twin.path}`);
    }
  });
  return v.problems;
}

/** A matter-root-relative path as Windows compares it: case-insensitive, either separator. */
export function samePath(path: string): string {
  return path.replace(/\//g, "\\").toLowerCase();
}

function validateRow(v: Checker, value: unknown, label: string, ids: Set<string>, draftFolder: unknown): void {
  if (!v.object(value, label)) return;
  const r = value as Record<string, unknown>;
  if (typeof r.row_id !== "string" || !ROW_ID_RE.test(r.row_id)) v.add(`${label}.row_id must match ${ROW_ID_RE}`);
  else if (ids.has(r.row_id)) v.add(`${label}.row_id ${r.row_id} is repeated`);
  else ids.add(r.row_id);
  v.path(r.current_path, `${label}.current_path`);
  if (typeof r.hash !== "string" || !HASH_RE.test(r.hash)) v.add(`${label}.hash must be a lowercase SHA-256 hex digest`);
  v.oneOf(r.ingest_outcome, INGEST_OUTCOMES, `${label}.ingest_outcome`);
  if (r.store !== undefined) v.oneOf(r.store, ["main", "privileged", "law"], `${label}.store`);
  if (v.array(r.source_ids, `${label}.source_ids`)) {
    if ((r.source_ids as unknown[]).some((id) => typeof id !== "string" && typeof id !== "number")) v.add(`${label}.source_ids must hold strings or numbers`);
  }
  if (v.array(r.name_checks, `${label}.name_checks`)) {
    (r.name_checks as unknown[]).forEach((c, i) => {
      const l = `${label}.name_checks[${i}]`;
      if (!v.object(c, l)) return;
      const check = c as Record<string, unknown>;
      v.name(check.name, `${l}.name`);
      v.path(check.folder, `${l}.folder`);
      v.boolean(check.ok, `${l}.ok`);
      v.optionalString(check.reason, `${l}.reason`);
    });
  }
  v.oneOf(r.section, SECTIONS, `${label}.section`);
  if (r.section === "offered") {
    if (r.action === undefined) v.add(`${label} is an offered row with no action`);
    else validateAction(v, r.action, `${label} (${String(r.row_id)}).action`, r, draftFolder);
  } else if (r.action !== undefined) {
    v.add(`${label} carries an action but is not offered`);
  }
  v.strings(r.notes, `${label}.notes`);
  if (r.twin !== undefined && v.object(r.twin, `${label}.twin`)) {
    const t = r.twin as Record<string, unknown>;
    v.path(t.path, `${label}.twin.path`);
    if (t.row_id !== undefined) v.string(t.row_id, `${label}.twin.row_id`);
    v.boolean(t.ingested, `${label}.twin.ingested`);
  }
}

/** Which action fields each kind needs, and which it may also take (§B7.5). */
const FILING_OPTIONS = ["create_folder", "file_no_ingest", "final", "answer"];
const ACTION_FIELDS: Record<ActionKind, { required: string[]; optional: string[] }> = {
  rename: { required: ["name"], optional: ["file_no_ingest"] },
  file: { required: ["name", "folder"], optional: FILING_OPTIONS },
  move: { required: ["folder"], optional: FILING_OPTIONS },
  draft: { required: [], optional: [] },
  duplicate: { required: [], optional: [] },
  misfiled: { required: ["matter"], optional: [] },
  unreadable: { required: [], optional: [] },
  stuck: { required: ["reason"], optional: [] },
};

function validateAction(v: Checker, value: unknown, label: string, r: Record<string, unknown>, draftFolder: unknown): void {
  if (!v.object(value, label)) return;
  const a = value as Record<string, unknown>;
  if (typeof a.kind !== "string" || !Object.hasOwn(ACTION_GROUPS, a.kind)) {
    v.add(`${label}.kind must be one of ${Object.keys(ACTION_GROUPS).join(", ")}`);
    return;
  }
  const kind = a.kind as ActionKind;
  const { required, optional } = ACTION_FIELDS[kind];
  for (const key of Object.keys(a)) if (key !== "kind" && !required.includes(key) && !optional.includes(key)) v.add(`${label}.${key} does not apply to a ${kind} action`);
  for (const key of required) if (a[key] === undefined) v.add(`${label} (${kind}) needs ${key}`);
  if (a.name !== undefined) v.name(a.name, `${label}.name`);
  if (a.folder !== undefined) v.folder(a.folder, `${label}.folder`);
  for (const key of ["create_folder", "file_no_ingest", "final"]) if (a[key] !== undefined) v.boolean(a[key], `${label}.${key}`);
  for (const key of ["answer", "matter", "reason"]) v.optionalString(a[key], `${label}.${key}`);
  if ([a.file_no_ingest === true, a.final === true, a.answer !== undefined].filter(Boolean).length > 1) {
    v.add(`${label} combines more than one of file_no_ingest, final and answer`);
  }
  if (a.create_folder === true && typeof a.folder === "string") {
    const segments = a.folder.split(/[\\/]+/);
    if (segments.length < 2 || !/^\d+\.\s/.test(segments[0])) v.add(`${label}.folder, a new folder, must sit inside a numbered folder, never directly under the root`);
  }
  const atRoot = typeof r.current_path === "string" && !/[\\/]/.test(r.current_path);
  if (kind === "rename" && atRoot) v.add(`${label}: a root file cannot be renamed in place`);
  if (a.file_no_ingest === true && !atRoot && typeof a.folder === "string" && typeof r.current_path === "string") {
    // Filed without ingest, a subfolder file stays in its folder (§B9.2, §C8).
    const own = r.current_path.replace(/[\\/][^\\/]*$/, "");
    if (a.folder.replace(/\//g, "\\").toLowerCase() !== own.replace(/\//g, "\\").toLowerCase()) v.add(`${label}: filed without reading, a subfolder file stays in ${own}`);
  }
  if (kind === "draft" && !atRoot) v.add(`${label}: only a root file moves to 0. DRAFT`);
  if (kind === "draft" && draftFolder === null) v.add(`${label}: the matter has no 0. DRAFT folder`);
  if (kind === "duplicate" && r.twin === undefined) v.add(`${label}: a duplicate row needs its twin`);
  if (kind === "unreadable" && r.ingest_outcome !== "failed") v.add(`${label}: try again next run is only for a failed ingest`);
}

/** Every problem with `value` as an approval of run `runId`: approved row ids only. */
export function validateApproval(value: unknown, runId: string): string[] {
  const v = new Checker();
  if (!v.object(value, "approval")) return v.problems;
  const a = value as Record<string, unknown>;
  if (a.run_id !== runId) v.add(`run_id is ${JSON.stringify(a.run_id)}, not ${runId}`);
  v.string(a.approved_at, "approved_at");
  validateEntries(v, a.rows);
  return v.problems;
}

/** The shape of the posted `rows`: `{row_id, approve: true}` only, one entry per row id. Empty is valid. */
export function validateEntries(v: Checker, rows: unknown): void {
  if (!v.array(rows, "rows")) return;
  const seen = new Set<string>();
  (rows as unknown[]).forEach((e, i) => {
    const label = `rows[${i}]`;
    if (!v.object(e, label)) return;
    const entry = e as Record<string, unknown>;
    for (const key of Object.keys(entry)) if (!ENTRY_KEYS.has(key)) v.add(`${label} has unknown key ${key}`);
    if (typeof entry.row_id !== "string") v.add(`${label}.row_id must be a string`);
    else if (seen.has(entry.row_id)) v.add(`${label}.row_id ${entry.row_id} is repeated`);
    else seen.add(entry.row_id);
    if (entry.approve !== true) v.add(`${label}.approve must be true: only approved rows are posted`);
  });
}

function canonical(path: string): string {
  try {
    return realpathSync.native(path);
  } catch {
    return pathWin32.resolve(path);
  }
}

const MAX_PROBLEMS = 20;

export class Checker {
  readonly problems: string[] = [];
  private dropped = 0;

  /** Records a problem. Past the cap, one last entry counts the problems left out. */
  add(problem: string): void {
    if (this.problems.length < MAX_PROBLEMS) {
      this.problems.push(problem);
      return;
    }
    this.dropped++;
    this.problems[MAX_PROBLEMS] = `and ${this.dropped} more problem${this.dropped === 1 ? "" : "s"}`;
  }

  object(value: unknown, label: string): boolean {
    if (typeof value === "object" && value !== null && !Array.isArray(value)) return true;
    this.add(`${label} must be an object`);
    return false;
  }

  array(value: unknown, label: string): boolean {
    if (Array.isArray(value)) return true;
    this.add(`${label} must be an array`);
    return false;
  }

  string(value: unknown, label: string): boolean {
    if (typeof value === "string" && value.length > 0) return true;
    this.add(`${label} must be a non-empty string`);
    return false;
  }

  optionalString(value: unknown, label: string): void {
    if (value !== undefined) this.string(value, label);
  }

  strings(value: unknown, label: string): boolean {
    if (Array.isArray(value) && value.every((s) => typeof s === "string" && s.length > 0)) return true;
    this.add(`${label} must be an array of non-empty strings`);
    return false;
  }

  boolean(value: unknown, label: string): void {
    if (typeof value !== "boolean") this.add(`${label} must be a boolean`);
  }

  oneOf(value: unknown, allowed: readonly string[], label: string): void {
    if (typeof value !== "string" || !allowed.includes(value)) this.add(`${label} must be one of ${allowed.join(", ")}`);
  }

  name(value: unknown, label: string): void {
    const problem = bareNameProblem(value);
    if (problem) this.add(`${label}${typeof value === "string" && value ? " " + JSON.stringify(value) : ""} ${problem}`);
  }

  /** A destination folder: matter-root-relative, and every segment a name Windows can create (no trailing dot or space). */
  folder(value: unknown, label: string): void {
    if (typeof value === "string") {
      const bad = value.split(/[\\/]+/).filter((s) => s !== "" && s !== "." && s !== "..").map((s) => [s, bareNameProblem(s)] as const).filter(([, p]) => p);
      for (const [segment, problem] of bad) this.add(`${label} segment ${JSON.stringify(segment)} ${problem}`);
      if (bad.length) return;
    }
    this.path(value, label);
  }

  path(value: unknown, label: string): boolean {
    const problem = relativePathProblem(value);
    if (problem) this.add(`${label} ${problem}`);
    return problem === null;
  }
}
