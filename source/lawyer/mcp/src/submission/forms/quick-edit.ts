// drafting_forms__preview_edit and drafting_forms__apply_edit: pinned-revision quick edits
// (CoClerk spec 2026-10-08_pinned-revision-quick-edits-spec.md; /drafting-data's contract is
// paragraph-revision.md section 8). A short edit -- reword one reviewed paragraph, move, recast,
// remove, restore or kill -- runs in any session with no job. The model gives the ops with the
// printed numbers the practitioner saw. This module resolves them through the paragraph map of the
// revision they saw, checks every touched row against that map, runs the foreign-scope read over
// every row the edit and its triggers touch, runs the exact statements apply_edit will run on a
// disposable copy, renders that copy, and returns a code-generated before-and-after and its
// consequences. apply_edit re-checks every precondition and the foreign-scope read, writes the same
// statements in one transaction, and once it commits appends one line per change to the filing's
// quick-edits log in the Drafting records folder. No SQL is composed by the model.
//
// Ops resolve once, at the seen revision, so a batch that removes "paragraph 15" after a recast
// renumbers Part 3 still removes the record that printed as 15. Later ops in a batch are planned
// against the state the earlier ones leave (Sim), so every guard in the script names the ordinal the
// row will hold when the statement runs.

import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import { ValidationError } from "../../errors.js";
import { submissionDataQuery, submissionDataTrial, submissionDataWriteAll, type WriteStatement } from "../backend.js";
import { hostLocalPath } from "../lock.js";
import { currentSchemaVersion } from "../migrate.js";
import { paragraphMapDir, previewDir as previewDirOf, recordsDir } from "../render-manifest.js";
import { renderableSchemaVersion } from "../schema-ceiling.js";
import { fetchFilingById, readSchemaVersion } from "./filing-reads.js";
import { renderFilingInMemory, type InMemoryRender } from "./render.js";
import { nowStamp, todaySql } from "./timings.js";
import { fetchRevision, type FilingRow } from "./query.js";
import { withLegend } from "./legend.js";
import {
  buildParagraphMap,
  factPart,
  mapSources,
  normalizePart,
  QUICK_EDIT_MIN_SCHEMA,
  readParagraphMap,
  readTexts,
  sha256Text,
  TEXT_COLUMN,
  type MapDocument,
  type MapEntity,
  type MapEntry,
  type ParagraphMap,
  type TextEntry,
} from "./paragraph-map.js";

const PREVIEW = "drafting_forms__preview_edit";
const APPLY = "drafting_forms__apply_edit";
const TOKEN_TTL_MS = 30 * 60 * 1000;
const TOKEN_PRUNE_MS = 24 * 60 * 60 * 1000;
/** Read before and after the trial, so the foreign-scope read and the preconditions cover every row a
 * trigger touches as well as the rows the ops name. */
const TRIAL_TABLES = [
  "facts",
  "statements_of_fact",
  "submissions",
  "law_assertions",
  "statements_of_law",
  "order_sought",
  "rhetorical_paragraphs",
  "filing_facts",
  "filing_submissions",
  "filing_orders",
  "filing_rhetoric",
  "submission_facts",
  "submission_law",
  "order_sought_served_by",
  "filings",
];
const DOCUMENTS: MapDocument[] = ["form", "written_argument"];

type DeployTable = "filing_facts" | "filing_submissions" | "filing_orders";
interface Deploy {
  table: DeployTable;
  fk: string;
  part: boolean;
  kind: string;
}
const DEPLOY: Partial<Record<MapEntity, Deploy>> = {
  facts: { table: "filing_facts", fk: "fact_id", part: true, kind: "fact" },
  submissions: { table: "filing_submissions", fk: "submission_id", part: false, kind: "submission" },
  order_sought: { table: "filing_orders", fk: "order_sought_id", part: false, kind: "order" },
};
const DEPLOY_BY_TABLE: Record<DeployTable, Deploy> = {
  filing_facts: DEPLOY.facts as Deploy,
  filing_submissions: DEPLOY.submissions as Deploy,
  filing_orders: DEPLOY.order_sought as Deploy,
};
const KIND: Record<MapEntity, string> = {
  facts: "fact",
  submissions: "submission",
  law_assertions: "proposition",
  order_sought: "order",
  rhetorical_paragraphs: "rhetorical paragraph",
  statements_of_fact: "statement of fact",
  statements_of_law: "statement of law",
};

// ---------------------------------------------------------------------------------------------
// Inputs

export type DocumentChoice = MapDocument | "both";

export interface ParagraphRef {
  document: MapDocument;
  part?: string;
  printed_number: string | number;
  /** The k-th excerpt printed under the paragraph (a statement of fact or of law), counting from 1. */
  statement?: number;
}

export interface AnchorRef extends ParagraphRef {
  position: "before" | "after";
}

export type EditOp =
  | {
      op: "reword";
      target: ParagraphRef;
      new_text: string;
      /** The practitioner's request as they gave it, their wording or their description. */
      proposed_text: string;
      /** `proposed` when new_text is, character for character, wording the practitioner typed in one turn. */
      choice: "proposed" | "alternative";
      review_flags?: string[];
      /** A rhetorical paragraph only: whether the revised wording states law, and fact. */
      states_law?: boolean;
      states_fact?: boolean;
    }
  | { op: "move"; target: ParagraphRef; anchor: AnchorRef; document?: DocumentChoice }
  | { op: "recast"; target: ParagraphRef; anchor: AnchorRef; new_type: "fact" | "submission"; document?: DocumentChoice; detach?: boolean }
  | { op: "remove"; target: ParagraphRef; document: DocumentChoice }
  /** remove_line: the 1-based line of the remove in the filing's quick-edits log. */
  | { op: "restore"; remove_line: number }
  | { op: "kill"; target: ParagraphRef };

export interface PreviewEditArgs {
  db_path: string;
  filing_id: number;
  session_token: string;
  seen_revision: number;
  ops: EditOp[];
}

export interface ApplyEditArgs {
  db_path: string;
  preview_token: string;
  session_token: string;
}

// ---------------------------------------------------------------------------------------------
// Outputs

export interface ChangedSinceSeen {
  paragraph: string;
  entity: string;
  row_id: number;
  what: "text" | "ordinal" | "placement" | "link";
  seen: string;
  now: string;
}

export interface DiffBlock {
  document: MapDocument;
  title: string;
  /** Print verbatim as one fenced block. */
  text: string;
}

export interface Consequences {
  /** A guard's refusal, verbatim. Any one makes the preview non-appliable. */
  guard_refusals: string[];
  markers: { paragraph: string; added: string[]; cleared: string[] }[];
  /** Paragraphs whose 🧐 the edit re-raises. */
  review_reraised: string[];
  criteria: { id: string; text: string; before: string; after: string }[];
  /** Other Writings printing a row the edit changes. */
  other_filings: string[];
  /** Attachments a recast with detach deletes. */
  detached: string[];
}

export interface PreviewEditResult {
  preview_token: string | null;
  filing_id: number;
  seen_revision: number;
  current_revision: number;
  resolved: string[];
  changed_since_seen: ChangedSinceSeen[];
  foreign_jobs: { id: number; title: string }[];
  diff: DiffBlock[];
  consequences: Consequences;
  /** The trial mockups, written into the matter's records folder (render-manifest.ts previewDir). */
  preview_paths: string[];
  /** A recast's closed menu: the types the anchor's Part takes. */
  recast_menu?: string[];
  /** The reword this preview carries, for the practitioner-words gate. */
  rewords: { new_text: string; choice: "proposed" | "alternative" }[];
  appliable: boolean;
  /** Set only on an appliable preview. */
  expires_at?: string;
  /** Why the preview is not appliable, or what to do next. */
  refused?: string;
  note: string;
}

export interface ApplyEditResult {
  applied: boolean;
  filing_id?: number;
  revision?: number;
  /** The filing's quick-edits log, and the 1-based lines this apply appended to it. */
  audit_log?: string;
  audit_lines?: number[];
  refused?: string;
  stale_rows?: string[];
  foreign_jobs?: { id: number; title: string }[];
  note: string;
}

// ---------------------------------------------------------------------------------------------
// Plumbing

class Refusal extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

type Row = Record<string, unknown>;

function rows(db: string, sql: string, params: unknown[] = []): Row[] {
  return submissionDataQuery(db, sql, params).rows;
}

interface SqlValue {
  sql: string;
  params: unknown[];
}

function lit(value: unknown): SqlValue {
  return { sql: "?", params: [value] };
}

interface Precondition {
  label: string;
  sql: string;
  params: unknown[];
  hash: string;
}

function hashRows(db: string, sql: string, params: unknown[]): string {
  return sha256Text(JSON.stringify(rows(db, sql, params)));
}

/** One planned placement row: an existing row, or one a statement of this script inserts. */
interface SimRow {
  id: number | null;
  key: string | null;
  fk: number | null;
  ordinal: number;
  pending: boolean;
}

function rowName(row: SimRow): string {
  return row.id !== null ? `row ${row.id}` : `the new row`;
}

function docLabel(document: MapDocument): string {
  return document === "form" ? "form" : "Written Arguments";
}

function position(e: { part: string; number: string; sub: number }): string {
  return `${e.part ? `${e.part} ` : ""}¶${e.number}${e.sub ? ` (excerpt ${e.sub})` : ""}`;
}

function describe(e: MapEntry): string {
  return `${docLabel(e.document)} ${position(e)}`;
}

function describeRef(ref: ParagraphRef): string {
  return `${docLabel(ref.document)} ${ref.part ? `${normalizePart(ref.part)} ` : ""}¶${ref.printed_number}${ref.statement ? ` (excerpt ${ref.statement})` : ""}`;
}

// ---------------------------------------------------------------------------------------------
// The plan: statements, labels, log lines, and the state later ops plan against

/** A row id: known at preview, or the rowid statement n of the script inserts (write_all binds { $rowid: n }). */
type IdRef = number | { $rowid: number };

/** One line of the filing's quick-edits log (paragraph-revision.md section 8), planned at preview. It holds
 * ids, ordinals and text hashes, never the text. apply_edit fills each IdRef from the write's results. */
interface LogEntry {
  op: "reword" | "move" | "recast" | "remove" | "restore" | "kill";
  document: MapDocument;
  /** The paragraph's own table, or filing_orders for an order's wording override. */
  entity: string;
  entity_id: IdRef;
  /** The placement row (filing_facts, filing_submissions or filing_orders) the op moves, takes off or puts back. */
  deployment_id: IdRef | null;
  from: string | number | null;
  to: string | number | null;
  old_hash: string | null;
  new_hash: string | null;
}

class Plan {
  readonly statements: WriteStatement[] = [];
  readonly labels: string[] = [];
  readonly log: LogEntry[] = [];
  /** Each key's inserting statement, by index, for a { $rowid } parameter. */
  private readonly keys = new Map<string, number>();
  /** Existing rows a statement writes, as table:id, for the pin check and the scope read. */
  readonly written = new Set<string>();
  /** Placement lists a statement renumbers or inserts into, for the list preconditions. */
  readonly lists = new Map<string, { table: DeployTable; document: MapDocument; part: string | null }>();
  readonly detached: string[] = [];
  private readonly sim = new Map<string, SimRow[]>();

  constructor(
    readonly db: string,
    readonly filing: FilingRow,
    readonly session: string,
    readonly token: string,
    readonly seen: number
  ) {}

  push(label: string, sql: string, params: unknown[], expect?: number): void {
    this.statements.push(expect === undefined ? { sql, params } : { sql, params, expect_changes: expect });
    this.labels.push(label);
  }

  /** Names the row the statement just pushed inserts, so a later statement or log line can refer to it. */
  remember(key: string): void {
    this.keys.set(key, this.statements.length - 1);
  }

  idOf(key: string): IdRef {
    const n = this.keys.get(key);
    if (n === undefined) throw new Error(`quick edit: no statement inserts ${key}`);
    return { $rowid: n };
  }

  keyRef(key: string): SqlValue {
    return { sql: "?", params: [this.idOf(key)] };
  }

  rowId(row: SimRow): IdRef {
    return row.id !== null ? row.id : this.idOf(row.key as string);
  }

  rowRef(row: SimRow): SqlValue {
    return row.id !== null ? lit(row.id) : this.keyRef(row.key as string);
  }

  audit(entry: LogEntry): void {
    this.log.push(entry);
  }

  /** One filing's placement list as this script will have left it so far. */
  list(table: DeployTable, document: MapDocument, part: string | null): SimRow[] {
    const key = `${table}|${document}|${part ?? ""}`;
    let list = this.sim.get(key);
    if (list === undefined) {
      const d = DEPLOY_BY_TABLE[table];
      list = rows(
        this.db,
        `SELECT id, ${d.fk} AS fk, ordinal FROM ${table} WHERE filing_id = ? AND document = ?${part === null ? "" : " AND part = ?"} ORDER BY ordinal, id`,
        part === null ? [this.filing.id, document] : [this.filing.id, document, part]
      ).map((r) => ({ id: Number(r.id), key: null, fk: Number(r.fk), ordinal: Number(r.ordinal), pending: false }));
      this.sim.set(key, list);
    }
    return list;
  }

  setList(table: DeployTable, document: MapDocument, part: string | null, list: SimRow[]): void {
    this.sim.set(`${table}|${document}|${part ?? ""}`, list);
    this.lists.set(`${table}|${document}|${part ?? ""}`, { table, document, part });
  }

  /** Gives `order` the list's own ordinals, sorted, so a rhetorical paragraph placed on the same scale keeps
   * its place among the rows; an inserted row adds one past the last, and a tie is pushed one past the
   * slot before it. Writes only the rows whose ordinal changes; a pending row takes its ordinal for its INSERT. */
  reorder(table: DeployTable, order: SimRow[], what: string): void {
    const slots = order.filter((r) => !r.pending).map((r) => r.ordinal).sort((a, b) => a - b);
    while (slots.length < order.length) slots.push((slots[slots.length - 1] ?? 0) + 1);
    for (let i = 1; i < slots.length; i += 1) if (slots[i] <= slots[i - 1]) slots[i] = slots[i - 1] + 1;
    order.forEach((row, i) => {
      const want = slots[i];
      if (row.pending) {
        row.ordinal = want;
        return;
      }
      if (row.ordinal === want) return;
      const ref = this.rowRef(row);
      this.push(`${what}: renumber ${table} ${rowName(row)} from ${row.ordinal} to ${want}`, `UPDATE ${table} SET ordinal = ? WHERE id = ${ref.sql} AND ordinal = ?`, [want, ...ref.params, row.ordinal], 1);
      if (row.id !== null) this.written.add(`${table}:${row.id}`);
      row.ordinal = want;
    });
  }
}

// ---------------------------------------------------------------------------------------------
// Resolution through the seen revision's map

function resolve(map: ParagraphMap, ref: ParagraphRef, what: string, anchor = false): MapEntry {
  if (ref.document !== "form" && ref.document !== "written_argument") throw new ValidationError(`${PREVIEW}: ${what}.document must be form or written_argument`, "invalid_document");
  const number = String(ref.printed_number).trim();
  const sub = anchor ? 0 : ref.statement ?? 0;
  const hits = map.entries.filter(
    (e) => e.document === ref.document && e.number === number && e.sub === sub && (ref.part === undefined || normalizePart(e.part) === normalizePart(ref.part))
  );
  if (hits.length === 0) {
    throw new Refusal(
      "not_found",
      `The ${what}, ${describeRef(ref)}, is not a paragraph this route edits on the mockup at revision ${map.revision}. Check the paragraph against that mockup, or name its Part.`
    );
  }
  if (hits.length > 1) {
    throw new Refusal("ambiguous", `The ${what}, ${describeRef(ref)}, names more than one paragraph: ${hits.map(describe).join("; ")}. Name its Part.`);
  }
  return hits[0];
}

interface Resolved {
  target?: MapEntry;
  anchor?: MapEntry;
}

function resolveOp(map: ParagraphMap, op: EditOp, i: number): Resolved {
  const n = `op ${i + 1}`;
  switch (op.op) {
    case "restore":
      return {};
    case "move":
    case "recast":
      return { target: resolve(map, op.target, `${n} target`), anchor: resolve(map, op.anchor, `${n} anchor`, true) };
    case "reword":
    case "remove":
    case "kill":
      return { target: resolve(map, op.target, `${n} target`) };
    default:
      throw new ValidationError(`${PREVIEW}: op ${i + 1} is none of reword, move, recast, remove, restore, kill`, "invalid_op");
  }
}

/** The current stored text an entry prints (its override for an order printing one); undefined when the row is gone. */
function currentText(db: string, e: MapEntry): string | undefined {
  if (e.override_id !== null) {
    const found = rows(db, "SELECT wording_override AS text FROM filing_orders WHERE id = ?", [e.override_id]);
    return found.length === 0 || found[0].text === null ? undefined : String(found[0].text);
  }
  return readTexts(db, e.entity, [e.row_id]).get(e.row_id);
}

/** Each way an entry's records differ from the map of the revision the practitioner saw. */
function pinCheck(db: string, entries: readonly MapEntry[]): ChangedSinceSeen[] {
  const out: ChangedSinceSeen[] = [];
  const seen = new Set<string>();
  for (const e of entries) {
    const id = `${e.document}|${e.part}|${e.number}|${e.sub}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const base = { paragraph: describe(e), entity: e.entity, row_id: e.row_id };
    const text = currentText(db, e);
    if (text === undefined) out.push({ ...base, what: "text", seen: "printed", now: "the row is gone" });
    else if (sha256Text(text) !== e.text_hash) out.push({ ...base, what: "text", seen: "the text you saw", now: text });
    if (e.deployment !== null) {
      const found = rows(db, `SELECT ordinal FROM ${e.deployment.table} WHERE id = ?`, [e.deployment.id]);
      if (found.length === 0) out.push({ ...base, what: "placement", seen: `on the ${docLabel(e.document)}`, now: `no longer on the ${docLabel(e.document)}` });
      else if (Number(found[0].ordinal) !== e.deployment.ordinal) out.push({ ...base, what: "ordinal", seen: String(e.deployment.ordinal), now: String(found[0].ordinal) });
    }
    if (e.entity === "law_assertions" && e.parent !== null && rows(db, "SELECT 1 FROM submission_law WHERE submission_id = ? AND law_assertion_id = ?", [e.parent, e.row_id]).length === 0) {
      out.push({ ...base, what: "link", seen: `under submission ${e.parent}`, now: `no longer under submission ${e.parent}` });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// The ops

function deploymentOf(e: MapEntry, what: string): Deploy {
  const d = e.sub === 0 ? DEPLOY[e.entity] : undefined;
  if (d === undefined) {
    throw new Refusal(
      "unsupported",
      `${describe(e)} is a ${e.sub ? "statement printed under a paragraph" : KIND[e.entity]}, which is not placed on a document by itself, so it cannot be ${what}. A proposition goes with the submission it prints under; kill it instead, or outline the change as a job.`
    );
  }
  return d;
}

function docsFor(choice: DocumentChoice | undefined, fallback: MapDocument): MapDocument[] {
  return choice === "both" ? DOCUMENTS : [choice ?? fallback];
}

/** Takes one record's placement off each named document, auditing each row taken. */
function takeOff(plan: Plan, e: MapEntry, docs: readonly MapDocument[], what: string): void {
  const d = deploymentOf(e, "taken off a document");
  let taken = 0;
  for (const doc of docs) {
    const part = d.part ? factPart(plan.filing.kind) : null;
    const list = plan.list(d.table, doc, part);
    const row = list.find((r) => r.fk === e.row_id);
    if (row === undefined) continue;
    const ref = plan.rowRef(row);
    plan.push(`${what}: take ${KIND[e.entity]} ${e.row_id} off the ${docLabel(doc)}`, `DELETE FROM ${d.table} WHERE id = ${ref.sql} AND ${d.fk} = ? AND ordinal = ?`, [...ref.params, e.row_id, row.ordinal], 1);
    if (row.id !== null) plan.written.add(`${d.table}:${row.id}`);
    // A remove's from is the placement row's stored ordinal, which a restore puts it back at.
    plan.audit({ op: "remove", document: doc, entity: e.entity, entity_id: e.row_id, deployment_id: plan.rowId(row), from: row.ordinal, to: null, old_hash: null, new_hash: null });
    plan.setList(d.table, doc, part, list.filter((r) => r !== row));
    taken += 1;
  }
  if (taken === 0) throw new Refusal("not_placed", `${describe(e)} is not on the ${docs.map(docLabel).join(" or ")}, so there is nothing to take off.`);
}

function planReword(plan: Plan, op: Extract<EditOp, { op: "reword" }>, t: MapEntry, rewords: PreviewEditResult["rewords"]): void {
  if (rewords.length > 0) throw new Refusal("one_reword", "A preview carries at most one reworded paragraph: one approval, one paragraph. Preview the others one at a time.");
  if (op.choice !== "proposed" && op.choice !== "alternative") throw new ValidationError(`${PREVIEW}: a reword's choice is proposed or alternative`, "invalid_choice");
  if (typeof op.new_text !== "string" || op.new_text.trim() === "") throw new ValidationError(`${PREVIEW}: a reword needs new_text`, "invalid_new_text");
  if (typeof op.proposed_text !== "string" || op.proposed_text.trim() === "") throw new ValidationError(`${PREVIEW}: a reword needs proposed_text, the practitioner's request as they gave it`, "invalid_proposed_text");
  if (t.entity === "statements_of_fact" && rows(plan.db, "SELECT 1 FROM statements_of_fact WHERE id = ? AND exhibit_id IS NOT NULL", [t.row_id]).length > 0) {
    throw new Refusal("exhibit_excerpt", "This statement prints its exhibit's excerpt, which an on-the-fly revision does not edit.");
  }
  const override = t.override_id !== null;
  const entity = override ? "filing_orders" : t.entity;
  const rowId = override ? (t.override_id as number) : t.row_id;
  const field = override ? "wording_override" : TEXT_COLUMN[t.entity];
  const current = currentText(plan.db, t) as string;
  if (op.new_text === current) throw new Refusal("no_change", `${describe(t)} already reads that way.`);
  const sets = [`${field} = ?`];
  const values: unknown[] = [op.new_text];
  if (t.entity === "rhetorical_paragraphs") {
    if (op.states_law !== undefined) {
      sets.push("states_law = ?");
      values.push(op.states_law ? 1 : 0);
    }
    if (op.states_fact !== undefined) {
      sets.push("states_fact = ?");
      values.push(op.states_fact ? 1 : 0);
    }
  }
  plan.push(`reword ${entity} ${rowId}`, `UPDATE ${entity} SET ${sets.join(", ")} WHERE id = ? AND ${field} = ?`, [...values, rowId, current], 1);
  plan.written.add(`${entity}:${rowId}`);
  plan.audit({ op: "reword", document: t.document, entity, entity_id: rowId, deployment_id: null, from: null, to: null, old_hash: sha256Text(current), new_hash: sha256Text(op.new_text) });
  rewords.push({ new_text: op.new_text, choice: op.choice });
}

/** The fk of the row an anchor places relative to, in the target's list: the anchor itself, or the submission a proposition prints under. */
function anchorFk(t: { entity: MapEntity }, a: MapEntry, what: string): number {
  if (a.entity === t.entity) return a.row_id;
  if (t.entity === "submissions" && a.entity === "law_assertions" && a.parent !== null) return a.parent;
  throw new Refusal("anchor_kind", `The ${what} anchor, ${describe(a)}, is a ${KIND[a.entity]}; a ${KIND[t.entity]} is placed among ${KIND[t.entity]}s.`);
}

function planMove(plan: Plan, op: Extract<EditOp, { op: "move" }>, t: MapEntry, a: MapEntry, i: number): void {
  const d = deploymentOf(t, "moved");
  if (t.document !== a.document) throw new Refusal("anchor_document", `The anchor ${describe(a)} is on another document than ${describe(t)}.`);
  if (normalizePart(t.part) !== normalizePart(a.part)) {
    throw new Refusal("move_across_parts", `A ${KIND[t.entity]} prints in one Part of this document, so ${describe(t)} moves within ${t.part || "its Part"}. A move to another Part is a recast.`);
  }
  const fk = anchorFk(t, a, "move");
  const docs = docsFor(op.document, t.document);
  if (d.table === "filing_facts" && docs.includes("written_argument")) {
    throw new Refusal("written_arguments_fact_order", "The Written Arguments print no fact order, so a move there would change nothing.");
  }
  const part = d.part ? t.deployment?.part ?? factPart(plan.filing.kind) : null;
  let moved = 0;
  for (const doc of docs) {
    const list = plan.list(d.table, doc, part);
    const tr = list.find((r) => r.fk === t.row_id);
    const ar = list.find((r) => r.fk === fk);
    if (tr === undefined || ar === undefined) throw new Refusal("not_placed", `${tr === undefined ? describe(t) : describe(a)} is not on the ${docLabel(doc)}.`);
    if (tr === ar) throw new Refusal("same_paragraph", `${describe(t)} cannot move relative to itself.`);
    const order = list.filter((r) => r !== tr);
    order.splice(order.indexOf(ar) + (op.anchor.position === "after" ? 1 : 0), 0, tr);
    const from = list.indexOf(tr) + 1;
    const to = order.indexOf(tr) + 1;
    if (from === to) continue;
    plan.reorder(d.table, order, `op ${i + 1} move`);
    plan.setList(d.table, doc, part, order);
    if (tr.id !== null) plan.written.add(`${d.table}:${tr.id}`);
    // A move's from and to are the row's position in its list, counting from 1, before and after.
    plan.audit({ op: "move", document: doc, entity: t.entity, entity_id: t.row_id, deployment_id: plan.rowId(tr), from, to, old_hash: null, new_hash: null });
    moved += 1;
  }
  if (moved === 0) throw new Refusal("no_change", `${describe(t)} is already ${op.anchor.position} ${describe(a)}.`);
}

function insertAt(plan: Plan, table: DeployTable, document: MapDocument, part: string | null, anchor: SimRow | null, where: "before" | "after", key: string, what: string): SimRow {
  const list = plan.list(table, document, part);
  const row: SimRow = { id: null, key, fk: null, ordinal: 0, pending: true };
  const order = [...list];
  const index = anchor === null ? order.length : order.indexOf(anchor) + (where === "after" ? 1 : 0);
  order.splice(index, 0, row);
  plan.reorder(table, order, what);
  plan.setList(table, document, part, order);
  return row;
}

function planRecast(plan: Plan, op: Extract<EditOp, { op: "recast" }>, t: MapEntry, a: MapEntry, i: number, menu: string[]): void {
  if (t.sub !== 0 || (t.entity !== "facts" && t.entity !== "submissions")) {
    throw new Refusal("unsupported", `${describe(t)} is a ${t.sub ? "statement printed under a paragraph" : KIND[t.entity]}; a recast makes a fact or a submission from a fact or a submission.`);
  }
  const offered = a.entity === "facts" ? ["fact"] : a.entity === "submissions" || a.entity === "law_assertions" ? ["submission"] : [];
  menu.push(...offered.filter((m) => !menu.includes(m)));
  if (!offered.includes(op.new_type)) {
    throw new Refusal("recast_type", `The Part holding ${describe(a)} takes ${offered.length > 0 ? `only: ${offered.join(", ")}` : "nothing this route makes"}, so ${describe(t)} cannot become a ${op.new_type} there.`);
  }
  if ((t.entity === "facts") === (op.new_type === "fact")) throw new Refusal("recast_same_type", `${describe(t)} is already a ${op.new_type}; placing it elsewhere among its kind is a move.`);
  const text = currentText(plan.db, t) as string;
  const label = `op ${i + 1} recast`;
  const newKey = `op${i + 1}.new`;
  if (op.new_type === "submission") {
    const docs = docsFor(op.document, a.document);
    if (op.detach) {
      const attached = rows(
        plan.db,
        `SELECT DISTINCT sf.rowid AS rid, sf.submission_id FROM submission_facts sf JOIN filing_submissions fs ON fs.submission_id = sf.submission_id
          WHERE fs.filing_id = ? AND fs.document = 'form' AND sf.fact_id = ? ORDER BY sf.submission_id`,
        [plan.filing.id, t.row_id]
      );
      for (const r of attached) {
        plan.push(`${label}: detach fact ${t.row_id} from submission ${r.submission_id}`, "DELETE FROM submission_facts WHERE submission_id = ? AND fact_id = ?", [r.submission_id, t.row_id], 1);
        plan.written.add(`submission_facts:${r.rid}`);
        plan.detached.push(`Fact ${t.row_id} is detached from submission ${r.submission_id}, in every Writing that prints that submission.`);
      }
    }
    plan.push(
      `${label}: create the submission`,
      "INSERT INTO submissions (proceeding_id, contention, ordinal) SELECT ?, ?, COALESCE(MAX(ordinal), 0) + 1 FROM submissions WHERE proceeding_id = ?",
      [plan.filing.proceeding_id, text, plan.filing.proceeding_id],
      1
    );
    plan.remember(newKey);
    const fk = anchorFk({ entity: "submissions" }, a, "recast");
    for (const doc of docs) {
      const anchorRow = plan.list("filing_submissions", doc, null).find((r) => r.fk === fk);
      if (anchorRow === undefined) throw new Refusal("not_placed", `The anchor's submission ${fk} is not on the ${docLabel(doc)}.`);
      const placed = insertAt(plan, "filing_submissions", doc, null, anchorRow, op.anchor.position, `${newKey}.${doc}`, label);
      plan.push(
        `${label}: place the new submission on the ${docLabel(doc)}`,
        "INSERT INTO filing_submissions (filing_id, submission_id, document, ordinal) VALUES (?, ?, ?, ?)",
        [plan.filing.id, plan.idOf(newKey), doc, placed.ordinal],
        1
      );
      plan.remember(placed.key as string);
      placed.pending = false;
    }
    takeOff(plan, t, docs, label);
    plan.audit({ op: "recast", document: a.document, entity: "submissions", entity_id: plan.idOf(newKey), deployment_id: null, from: null, to: null, old_hash: sha256Text(text), new_hash: sha256Text(text) });
    return;
  }
  if (a.document !== "form" || a.deployment === null || a.deployment.table !== "filing_facts") {
    throw new Refusal("recast_place", `A new fact is placed in the form's facts Part; ${describe(a)} is not there.`);
  }
  plan.push(`${label}: create the fact`, "INSERT INTO facts (proceeding_id, postulate) VALUES (?, ?)", [plan.filing.proceeding_id, text], 1);
  plan.remember(newKey);
  const part = a.deployment.part;
  const anchorRow = plan.list("filing_facts", "form", part).find((r) => r.fk === a.row_id);
  if (anchorRow === undefined) throw new Refusal("not_placed", `${describe(a)} is not on the form.`);
  const placed = insertAt(plan, "filing_facts", "form", part, anchorRow, op.anchor.position, `${newKey}.form`, label);
  plan.push(
    `${label}: place the new fact on the form`,
    "INSERT INTO filing_facts (filing_id, fact_id, document, part, ordinal) VALUES (?, ?, 'form', ?, ?)",
    [plan.filing.id, plan.idOf(newKey), part, placed.ordinal],
    1
  );
  plan.remember(placed.key as string);
  placed.pending = false;
  takeOff(plan, t, docsFor(op.document, t.document), label);
  plan.audit({ op: "recast", document: "form", entity: "facts", entity_id: plan.idOf(newKey), deployment_id: null, from: null, to: null, old_hash: sha256Text(text), new_hash: sha256Text(text) });
}

function planRestore(plan: Plan, op: Extract<EditOp, { op: "restore" }>, i: number): void {
  if (!Number.isInteger(op.remove_line) || op.remove_line <= 0) throw new ValidationError(`${PREVIEW}: restore needs remove_line, the remove's line in the Writing's quick-edits log`, "invalid_remove_line");
  const file = logFile(plan.db, plan.filing.id);
  const text = existsSync(file) ? readFileSync(file, "utf-8").split("\n")[op.remove_line - 1] : undefined;
  const removed = text ? (JSON.parse(text) as Record<string, unknown>) : undefined;
  const entity = String(removed?.entity);
  const d = removed?.op === "remove" && Object.hasOwn(DEPLOY, entity) ? DEPLOY[entity as MapEntity] : undefined;
  if (removed === undefined || d === undefined) {
    throw new Refusal("not_a_remove", `Line ${op.remove_line} of Writing ${plan.filing.id}'s quick-edits log is not a remove, so there is nothing to restore.`);
  }
  const fk = Number(removed.entity_id);
  const document = String(removed.document) as MapDocument;
  // A remove takes a fact off the Part takeOff names, so the restore puts it back there.
  const part = d.part ? factPart(plan.filing.kind) : null;
  const list = plan.list(d.table, document, part);
  if (list.some((r) => r.fk === fk)) throw new Refusal("already_placed", `${d.kind} ${fk} is already on the ${docLabel(document)}.`);
  const oldOrdinal = Number(removed.from);
  const next = list.find((r) => r.ordinal >= oldOrdinal) ?? null;
  const key = `op${i + 1}.restored`;
  const placed = insertAt(plan, d.table, document, part, next, "before", key, `op ${i + 1} restore`);
  const columns = d.part ? `filing_id, ${d.fk}, document, part, ordinal` : `filing_id, ${d.fk}, document, ordinal`;
  const values = d.part ? [plan.filing.id, fk, document, part, placed.ordinal] : [plan.filing.id, fk, document, placed.ordinal];
  plan.push(`op ${i + 1} restore: put ${d.kind} ${fk} back on the ${docLabel(document)}`, `INSERT INTO ${d.table} (${columns}) VALUES (${values.map(() => "?").join(", ")})`, values, 1);
  plan.remember(key);
  placed.pending = false;
  placed.fk = fk;
  plan.audit({ op: "restore", document, entity, entity_id: fk, deployment_id: plan.idOf(key), from: null, to: placed.ordinal, old_hash: null, new_hash: null });
}

function planKill(plan: Plan, t: MapEntry): void {
  if (t.sub !== 0 || (t.entity !== "submissions" && t.entity !== "law_assertions")) {
    throw new Refusal("unsupported", `${describe(t)} is a ${t.sub ? "statement printed under a paragraph" : KIND[t.entity]}; only a submission or a proposition is killed.`);
  }
  plan.push(`kill ${KIND[t.entity]} ${t.row_id}`, `UPDATE ${t.entity} SET killed_on = ${todaySql()} WHERE id = ? AND killed_on IS NULL`, [t.row_id], 1);
  plan.written.add(`${t.entity}:${t.row_id}`);
  if (t.entity === "submissions") {
    // Killing a submission takes it off every drafting Writing in the same write; a sent or retired Writing keeps its row.
    const elsewhere = Number(
      rows(
        plan.db,
        `SELECT COUNT(*) AS n FROM filing_submissions fs JOIN filings f ON f.id = fs.filing_id
          WHERE fs.submission_id = ? AND fs.filing_id <> ? AND f.filed_on IS NULL AND f.retired_on IS NULL`,
        [t.row_id, plan.filing.id]
      )[0].n
    );
    const drafting = plan.filing.filed_on === null && plan.filing.retired_on === null;
    let here = 0;
    if (drafting) {
      for (const doc of DOCUMENTS) {
        const list = plan.list("filing_submissions", doc, null);
        const kept = list.filter((r) => r.fk !== t.row_id);
        here += list.length - kept.length;
        if (kept.length !== list.length) plan.setList("filing_submissions", doc, null, kept);
      }
    }
    plan.push(
      `kill: take submission ${t.row_id} off every drafting Writing`,
      "DELETE FROM filing_submissions WHERE submission_id = ? AND filing_id IN (SELECT id FROM filings WHERE filed_on IS NULL AND retired_on IS NULL)",
      [t.row_id],
      elsewhere + here
    );
  }
  // A kill's to is the killed_on date, which apply_edit fills from the row it wrote.
  plan.audit({ op: "kill", document: t.document, entity: t.entity, entity_id: t.row_id, deployment_id: null, from: null, to: null, old_hash: null, new_hash: null });
}

// ---------------------------------------------------------------------------------------------
// The foreign-scope read (paragraph-revision.md §3), over every touched row

function foreignJobs(db: string, session: string, pairs: ReadonlyMap<string, Set<number>>): { id: number; title: string }[] {
  const clauses: string[] = [];
  const params: unknown[] = [session];
  for (const [table, ids] of pairs) {
    const list = [...ids].filter((id) => id > 0);
    clauses.push(`(s.entity = ? AND (s.entity_id IS NULL${list.length > 0 ? ` OR s.entity_id IN (${list.map(() => "?").join(", ")})` : ""}))`);
    params.push(table, ...list);
  }
  if (clauses.length === 0) return [];
  return rows(
    db,
    `SELECT DISTINCT t.id, t.title FROM tickets t JOIN ticket_scope s ON s.ticket_id = t.id
      WHERE t.status = 'wip' AND t.rejected_at IS NULL AND t.deleted_at IS NULL AND t.locked_by <> ?
        AND (${clauses.join(" OR ")}) ORDER BY t.id`,
    params
  ).map((r) => ({ id: Number(r.id), title: String(r.title) }));
}

function addPair(pairs: Map<string, Set<number>>, table: string, id: number): void {
  const set = pairs.get(table) ?? new Set<number>();
  set.add(id);
  pairs.set(table, set);
}

function entryPairs(pairs: Map<string, Set<number>>, e: MapEntry): void {
  addPair(pairs, e.entity, e.row_id);
  if (e.deployment !== null) addPair(pairs, e.deployment.table, e.deployment.id);
  if (e.override_id !== null) addPair(pairs, "filing_orders", e.override_id);
  if (e.parent !== null) addPair(pairs, "submissions", e.parent);
}

// ---------------------------------------------------------------------------------------------
// The diff and the consequences, from the before and after renders

function textKey(e: TextEntry): string {
  return `${e.entity}:${e.row_id}:${e.parent ?? ""}`;
}

function indent(text: string): string {
  return text.replace(/\n/g, "\n    ");
}

/** Before and after, code-generated, for every paragraph whose text, number or Part changes, one block per document. */
export function diffBlocks(before: readonly TextEntry[], after: readonly TextEntry[]): DiffBlock[] {
  const out: DiffBlock[] = [];
  for (const document of DOCUMENTS) {
    const b = before.filter((e) => e.document === document);
    const a = after.filter((e) => e.document === document);
    if (b.length === 0 && a.length === 0) continue;
    const bByKey = new Map(b.map((e) => [textKey(e), e]));
    const aKeys = new Set(a.map(textKey));
    const lines: string[] = [];
    for (const e of a) {
      const was = bByKey.get(textKey(e));
      if (was === undefined) {
        lines.push(`not printed → ${position(e)}`, `    ${indent(e.text)}`);
        continue;
      }
      const moved = position(was) !== position(e);
      const reworded = was.text !== e.text;
      if (!moved && !reworded) continue;
      lines.push(moved ? `${position(was)} → ${position(e)}` : `${position(e)}, reworded`);
      if (reworded) lines.push(`    before: ${indent(was.text)}`, `    after: ${indent(e.text)}`);
      else lines.push(`    ${indent(e.text)}`);
    }
    for (const e of b) {
      if (!aKeys.has(textKey(e))) lines.push(`${position(e)} → not printed`, `    ${indent(e.text)}`);
    }
    if (lines.length > 0) out.push({ document, title: (a[0] ?? b[0]).title, text: [(a[0] ?? b[0]).title, ...lines].join("\n") });
  }
  return out;
}

function consequencesOf(
  db: string,
  filingId: number,
  before: InMemoryRender,
  after: InMemoryRender,
  beforeMap: readonly TextEntry[],
  afterMap: readonly TextEntry[],
  touched: { entity: MapEntity; row_id: number }[],
  detached: string[]
): Consequences {
  const docOf = new Map(mapSources(after.documents).map((s) => [s.documentType, s.document]));
  const label = (entries: readonly TextEntry[], doc: string, table: string, id: number): string => {
    const document = docOf.get(doc);
    const e = entries.find((x) => x.document === document && x.entity === table && x.row_id === id && x.sub === 0) ?? entries.find((x) => x.document === document && x.entity === table && x.row_id === id);
    return e ? `${e.title} ${position(e)}` : `${table} ${id} (${doc})`;
  };
  const keyOf = (x: { doc: string; table: string; id: number; marker: string }) => `${x.doc}\u0001${x.table}\u0001${x.id}\u0001${x.marker}`;
  const mapped = (x: { doc: string }) => docOf.has(x.doc);
  const was = new Set(before.inventory.filter(mapped).map(keyOf));
  const now = new Set(after.inventory.filter(mapped).map(keyOf));
  const groups = new Map<string, { paragraph: string; added: string[]; cleared: string[] }>();
  const group = (x: { doc: string; table: string; id: number }, entries: readonly TextEntry[]) => {
    const k = `${x.doc}\u0001${x.table}\u0001${x.id}`;
    let g = groups.get(k);
    if (g === undefined) {
      g = { paragraph: label(entries, x.doc, x.table, x.id), added: [], cleared: [] };
      groups.set(k, g);
    }
    return g;
  };
  for (const x of after.inventory.filter(mapped)) if (!was.has(keyOf(x))) {
    const g = group(x, afterMap);
    if (!g.added.includes(x.marker)) g.added.push(x.marker);
  }
  for (const x of before.inventory.filter(mapped)) if (!now.has(keyOf(x))) {
    const g = group(x, beforeMap);
    if (!g.cleared.includes(x.marker)) g.cleared.push(x.marker);
  }
  const markers = [...groups.values()];

  const criteria: Consequences["criteria"] = [];
  const state = (c: { state: string; outstanding: number } | undefined) => (c === undefined ? "absent" : `${c.state} (${c.outstanding} open)`);
  for (const c of after.criteria) {
    const b = before.criteria.find((x) => x.id === c.id);
    if (b === undefined || b.state !== c.state || b.outstanding !== c.outstanding) criteria.push({ id: c.id, text: c.text, before: state(b), after: state(c) });
  }
  for (const b of before.criteria) if (!after.criteria.some((c) => c.id === b.id)) criteria.push({ id: b.id, text: b.text, before: state(b), after: "absent" });

  const other: string[] = [];
  const byEntity = new Map<MapEntity, number[]>();
  for (const t of touched) byEntity.set(t.entity, [...(byEntity.get(t.entity) ?? []), t.row_id]);
  const via: Partial<Record<MapEntity, { from: string; fk: string }>> = {
    facts: { from: "filing_facts x", fk: "x.fact_id" },
    submissions: { from: "filing_submissions x", fk: "x.submission_id" },
    order_sought: { from: "filing_orders x", fk: "x.order_sought_id" },
    law_assertions: { from: "submission_law sl JOIN filing_submissions x ON x.submission_id = sl.submission_id", fk: "sl.law_assertion_id" },
  };
  for (const [entity, ids] of byEntity) {
    const v = via[entity];
    if (v === undefined) continue;
    const unique = [...new Set(ids)];
    for (const r of rows(
      db,
      `SELECT DISTINCT ${v.fk} AS row_id, x.filing_id, f.title, x.document FROM ${v.from} JOIN filings f ON f.id = x.filing_id
        WHERE ${v.fk} IN (${unique.map(() => "?").join(", ")}) AND x.filing_id <> ? ORDER BY x.filing_id`,
      [...unique, filingId]
    )) {
      other.push(`${KIND[entity]} ${r.row_id} also prints on Writing ${r.filing_id} (${r.title}), ${docLabel(String(r.document) as MapDocument)}.`);
    }
  }

  return {
    guard_refusals: [],
    markers,
    review_reraised: markers.filter((g) => g.added.includes("🧐")).map((g) => g.paragraph),
    criteria,
    other_filings: other,
    detached,
  };
}

function emptyConsequences(guard: string[] = [], detached: string[] = []): Consequences {
  return { guard_refusals: guard, markers: [], review_reraised: [], criteria: [], other_filings: [], detached };
}

// ---------------------------------------------------------------------------------------------
// The token store, host-local beside the write lock

interface StoredPreview {
  token: string;
  db_path: string;
  filing_id: number;
  session_token: string;
  seen_revision: number;
  statements: WriteStatement[];
  labels: string[];
  log: LogEntry[];
  preconditions: Precondition[];
  scope: [string, number[]][];
  expires_at: string;
  used_at: string | null;
}

function tokenFile(db: string, token: string): string {
  return hostLocalPath(db, `preview-${token}.json`);
}

function saveToken(stored: StoredPreview): void {
  const file = tokenFile(stored.db_path, stored.token);
  writeFileSync(`${file}.tmp`, JSON.stringify(stored), "utf-8");
  renameSync(`${file}.tmp`, file);
}

/** Removes this database's preview tokens older than a day: a token expires long before. */
function pruneTokens(db: string): void {
  const sample = tokenFile(db, "x");
  const dir = dirname(sample);
  const prefix = basename(sample).slice(0, -"x.json".length);
  const cutoff = Date.now() - TOKEN_PRUNE_MS;
  for (const name of readdirSync(dir)) {
    if (!name.startsWith(prefix)) continue;
    const file = join(dir, name);
    if (statSync(file).mtimeMs < cutoff) unlinkSync(file);
  }
}

// ---------------------------------------------------------------------------------------------
// drafting_forms__preview_edit

function refusedPreview(base: { filing_id: number; seen_revision: number; current_revision: number }, code: string, note: string, extra: Partial<PreviewEditResult> = {}): PreviewEditResult {
  return {
    preview_token: null,
    ...base,
    resolved: [],
    changed_since_seen: [],
    foreign_jobs: [],
    diff: [],
    consequences: emptyConsequences(),
    preview_paths: [],
    rewords: [],
    appliable: false,
    refused: code,
    note,
    ...extra,
  };
}

function checkSchema(db: string, tool: string): void {
  const version = readSchemaVersion(db);
  if (version === null || version < QUICK_EDIT_MIN_SCHEMA) {
    throw new ValidationError(`${tool}: this database is on schema version ${version ?? "unknown"}; quick edits need ${QUICK_EDIT_MIN_SCHEMA} or later. Run drafting_data__migrate first.`, "schema_behind");
  }
  const ceiling = renderableSchemaVersion(currentSchemaVersion());
  if (version > ceiling) {
    throw new ValidationError(`${tool}: this database is on schema version ${version}; the installed plugin bundle supports up to ${ceiling}. Rebuild/reinstall the plugin.`, "bundle_outdated");
  }
}

export async function submissionFormsPreviewEdit(args: PreviewEditArgs): Promise<PreviewEditResult> {
  const db = args.db_path;
  if (!Number.isInteger(args.filing_id) || args.filing_id <= 0) throw new ValidationError(`${PREVIEW}.filing_id must be a positive integer`, "invalid_filing_id");
  if (typeof args.session_token !== "string" || args.session_token.trim() === "") throw new ValidationError(`${PREVIEW}.session_token must be the session_token open_session or bootstrap returned`, "invalid_session_token");
  if (!Number.isInteger(args.seen_revision) || args.seen_revision < 0) throw new ValidationError(`${PREVIEW}.seen_revision must be the revision printed on the mockup the practitioner saw`, "invalid_seen_revision");
  if (!Array.isArray(args.ops) || args.ops.length === 0) throw new ValidationError(`${PREVIEW}.ops must name at least one op`, "invalid_ops");
  checkSchema(db, PREVIEW);
  const filing = fetchFilingById(db, args.filing_id);
  const currentRevision = fetchRevision(db);
  const base = { filing_id: filing.id, seen_revision: args.seen_revision, current_revision: currentRevision };

  const map = readParagraphMap(paragraphMapDir(db, filing.id), args.seen_revision);
  if (map === null) {
    return refusedPreview(
      base,
      "seen_revision_unknown",
      `No paragraph map is recorded for revision ${args.seen_revision} of Writing ${filing.id}, so the printed numbers cannot be resolved as the practitioner saw them. Render and present the current mockup, then ask again.`
    );
  }

  const token = randomBytes(12).toString("hex");
  const plan = new Plan(db, filing, args.session_token, token, args.seen_revision);
  const rewords: PreviewEditResult["rewords"] = [];
  const menu: string[] = [];
  let resolved: Resolved[];
  try {
    resolved = args.ops.map((op, i) => resolveOp(map, op, i));
    const named = resolved.flatMap((r) => [r.target, r.anchor].filter((e): e is MapEntry => e !== undefined));
    const changed = pinCheck(db, named);
    if (changed.length > 0) {
      return refusedPreview(base, "changed_since_seen", "A paragraph this edit names has changed since the practitioner saw it. Render and present the current mockup, then ask again.", { changed_since_seen: changed });
    }
    args.ops.forEach((op, i) => {
      const { target, anchor } = resolved[i];
      switch (op.op) {
        case "reword":
          return planReword(plan, op, target as MapEntry, rewords);
        case "move":
          return planMove(plan, op, target as MapEntry, anchor as MapEntry, i);
        case "recast":
          return planRecast(plan, op, target as MapEntry, anchor as MapEntry, i, menu);
        case "remove":
          return takeOff(plan, target as MapEntry, docsFor(op.document, (target as MapEntry).document), `op ${i + 1} remove`);
        case "restore":
          return planRestore(plan, op, i);
        case "kill":
          return planKill(plan, target as MapEntry);
      }
    });
    // Every other printed paragraph whose placement row the plan writes was touched too.
    const incidental = map.entries.filter((e) => e.deployment !== null && plan.written.has(`${e.deployment.table}:${e.deployment.id}`));
    const moved = pinCheck(db, incidental);
    if (moved.length > 0) {
      return refusedPreview(base, "changed_since_seen", "A paragraph this edit renumbers has changed since the practitioner saw it. Render and present the current mockup, then ask again.", { changed_since_seen: moved });
    }
  } catch (err) {
    if (err instanceof Refusal) return refusedPreview(base, err.code, err.message, { recast_menu: menu.length > 0 ? menu : undefined });
    throw err;
  }

  const summary = args.ops.map((op, i) => {
    const { target, anchor } = resolved[i];
    const parts: string[] = [op.op];
    if (target) parts.push(`${KIND[target.entity]} ${target.row_id} (${describe(target)})`);
    if (anchor && "anchor" in op) parts.push(`${op.anchor.position} ${KIND[anchor.entity]} ${anchor.row_id} (${describe(anchor)})`);
    if (op.op === "restore") parts.push(`the row the remove on line ${op.remove_line} of the quick-edits log took off`);
    if ("document" in op && op.document) parts.push(`on ${op.document === "both" ? "both documents" : docLabel(op.document)}`);
    return parts.join(" ");
  });

  // The trial: the exact statements apply_edit will run, on a disposable copy.
  const trial = await submissionDataTrial(db, plan.statements, TRIAL_TABLES);
  const detached = plan.detached;
  if (!trial.ok) {
    const label = plan.labels[trial.failed] ?? `statement ${trial.failed}`;
    if (trial.error !== undefined) {
      return refusedPreview(base, "guard_refused", `A guard refused the edit at "${label}"; the refusal is in consequences.guard_refusals, verbatim. Nothing was written.`, {
        resolved: summary,
        consequences: emptyConsequences([trial.error], detached),
      });
    }
    return refusedPreview(base, "trial_mismatch", `The trial stopped at "${label}", which changed ${trial.changes} rows instead of the one planned. The database moved during the preview. Preview again.`, { resolved: summary });
  }

  try {
    // The foreign-scope read, over every row named, every row written and every row a trigger touched.
    const pairs = new Map<string, Set<number>>();
    for (const r of resolved) for (const e of [r.target, r.anchor]) if (e) entryPairs(pairs, e);
    for (const w of plan.written) {
      const [table, id] = w.split(":");
      addPair(pairs, table, Number(id));
    }
    for (const [table, c] of Object.entries(trial.changed)) {
      for (const id of [...c.inserted, ...c.updated, ...c.deleted]) addPair(pairs, table, c.inserted.includes(id) ? -1 : id);
    }
    addPair(pairs, "filings", filing.id);
    const jobs = foreignJobs(db, args.session_token, pairs);

    // Preconditions apply_edit re-checks: every existing row named, written or touched by a trigger,
    // each list renumbered or inserted into, and each proposition's link to the submission it prints under.
    const preconditions: Precondition[] = [];
    const rowsSeen = new Set<string>();
    const rowPrecondition = (table: string, id: number) => {
      const k = `${table}:${id}`;
      if (rowsSeen.has(k) || id <= 0) return;
      rowsSeen.add(k);
      const sql = `SELECT * FROM "${table}" WHERE rowid = ?`;
      preconditions.push({ label: `${table} row ${id}`, sql, params: [id], hash: hashRows(db, sql, [id]) });
    };
    for (const r of resolved) {
      for (const e of [r.target, r.anchor]) {
        if (!e) continue;
        rowPrecondition(e.entity, e.row_id);
        if (e.deployment) rowPrecondition(e.deployment.table, e.deployment.id);
        if (e.override_id !== null) rowPrecondition("filing_orders", e.override_id);
        if (e.entity === "law_assertions" && e.parent !== null) {
          const sql = "SELECT rowid FROM submission_law WHERE submission_id = ? AND law_assertion_id = ?";
          preconditions.push({ label: `proposition ${e.row_id} under submission ${e.parent}`, sql, params: [e.parent, e.row_id], hash: hashRows(db, sql, [e.parent, e.row_id]) });
        }
      }
    }
    for (const w of plan.written) {
      const [table, id] = w.split(":");
      rowPrecondition(table, Number(id));
    }
    for (const [table, c] of Object.entries(trial.changed)) for (const id of [...c.updated, ...c.deleted]) rowPrecondition(table, id);
    // A list the plan renumbers or inserts into keeps its membership: a row added or taken off it would
    // leave the renumbering wrong. Its untouched rows' ordinals are not preconditions.
    for (const l of plan.lists.values()) {
      const sql = `SELECT id FROM ${l.table} WHERE filing_id = ? AND document = ?${l.part === null ? "" : " AND part = ?"} ORDER BY id`;
      const params = l.part === null ? [filing.id, l.document] : [filing.id, l.document, l.part];
      preconditions.push({ label: `the rows of ${l.table} on the ${docLabel(l.document)}${l.part ? ` (${l.part})` : ""}`, sql, params, hash: hashRows(db, sql, params) });
    }

    // Before and after, rendered in memory from the live database and the trial copy.
    const now = nowStamp();
    const before = renderFilingInMemory(db, filing.id, now);
    const after = renderFilingInMemory(trial.staged_path, filing.id, now, db);
    const beforeMap = buildParagraphMap(db, filing, mapSources(before.documents));
    const afterMap = buildParagraphMap(trial.staged_path, filing, mapSources(after.documents));
    const diff = diffBlocks(beforeMap, afterMap);
    const touched = resolved.flatMap((r) => (r.target ? [{ entity: r.target.entity, row_id: r.target.row_id }] : []));
    const consequences = consequencesOf(db, filing.id, before, after, beforeMap, afterMap, touched, detached);

    // The trial mockups, for the practitioner to open as file cards.
    const previewDir = previewDirOf(db, filing.id);
    mkdirSync(previewDir, { recursive: true });
    const sources = new Set(mapSources(after.documents).map((s) => s.title));
    const previewPaths = after.documents
      .filter((doc) => sources.has(doc.fileName.replace(/\.md$/i, "")))
      .map((doc) => {
        const path = join(previewDir, doc.fileName);
        writeFileSync(path, withLegend(doc.markdown, doc.documentType).markdown, "utf-8");
        return path;
      });

    const appliable = jobs.length === 0 && diff.length > 0;
    const result: PreviewEditResult = {
      preview_token: appliable ? token : null,
      ...base,
      resolved: summary,
      changed_since_seen: [],
      foreign_jobs: jobs,
      diff,
      consequences,
      preview_paths: previewPaths,
      ...(menu.length > 0 ? { recast_menu: menu } : {}),
      rewords,
      appliable,
      note: "",
    };
    if (jobs.length > 0) {
      return { ...result, refused: "foreign_job", note: `Refused: ${jobs.map((j) => `Job #${j.id}: ${j.title}`).join("; ")} is in progress in another session over a row this edit touches. Nothing was written.` };
    }
    if (diff.length === 0) return { ...result, refused: "no_printed_change", note: "The edit changes nothing printed on the form or the Written Arguments, so there is nothing to approve." };
    const expires = new Date(Date.now() + TOKEN_TTL_MS).toISOString();
    pruneTokens(db);
    saveToken({
      token,
      db_path: db,
      filing_id: filing.id,
      session_token: args.session_token,
      seen_revision: args.seen_revision,
      statements: plan.statements,
      labels: plan.labels,
      log: plan.log,
      preconditions,
      scope: [...pairs].map(([table, ids]) => [table, [...ids]]),
      expires_at: expires,
      used_at: null,
    });
    return {
      ...result,
      expires_at: expires,
      note:
        "Print each diff block verbatim as its own fenced code block in the reply text, then your own reading under a separate heading, " +
        "and ask the practitioner to reply yes to apply it. On a bare yes, call drafting_forms__apply_edit with this preview_token.",
    };
  } finally {
    rmSync(trial.staged_dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------------------------
// drafting_forms__apply_edit

export async function submissionFormsApplyEdit(args: ApplyEditArgs): Promise<ApplyEditResult> {
  const db = args.db_path;
  if (typeof args.preview_token !== "string" || !/^[0-9a-f]{24}$/.test(args.preview_token)) {
    return { applied: false, refused: "unknown_token", note: "That is not a preview token drafting_forms__preview_edit issued. Preview the edit again." };
  }
  checkSchema(db, APPLY);
  const file = tokenFile(db, args.preview_token);
  if (!existsSync(file)) return { applied: false, refused: "unknown_token", note: "No preview with that token is recorded for this database. Preview the edit again." };
  const stored = JSON.parse(readFileSync(file, "utf-8")) as StoredPreview;
  if (stored.session_token !== args.session_token) return { applied: false, refused: "other_session", note: "That preview was made in another session. Preview the edit again in this one." };
  if (stored.used_at !== null) return { applied: false, refused: "used_token", note: `That preview was already applied, or its apply refused, at ${stored.used_at}. Preview the edit again.` };
  if (Date.parse(stored.expires_at) < Date.now()) return { applied: false, refused: "expired_token", note: `That preview expired at ${stored.expires_at}. Preview the edit again.` };
  // Single use: spent before anything is checked or written, so a refusal is never retried on the same approval.
  saveToken({ ...stored, used_at: new Date().toISOString() });

  const stale = stored.preconditions.filter((p) => hashRows(db, p.sql, p.params) !== p.hash).map((p) => p.label);
  if (stale.length > 0) {
    return { applied: false, filing_id: stored.filing_id, refused: "stale_preview", stale_rows: stale, note: `Refused: ${stale.join("; ")} changed since the preview. Nothing was written. Render, present and preview again.` };
  }
  const jobs = foreignJobs(db, args.session_token, new Map(stored.scope.map(([table, ids]) => [table, new Set(ids)])));
  if (jobs.length > 0) {
    return { applied: false, filing_id: stored.filing_id, refused: "foreign_job", foreign_jobs: jobs, note: `Refused: ${jobs.map((j) => `Job #${j.id}: ${j.title}`).join("; ")} is in progress in another session over a row this edit touches. Nothing was written.` };
  }
  let written: Awaited<ReturnType<typeof submissionDataWriteAll>>;
  try {
    written = await submissionDataWriteAll(db, stored.statements);
  } catch (err) {
    return { applied: false, filing_id: stored.filing_id, refused: "guard_refused", note: `A guard refused the edit, verbatim: ${(err as Error).message}. Nothing was written.` };
  }
  if (!written.ok) {
    const label = stored.labels[written.failed] ?? `statement ${written.failed}`;
    return { applied: false, filing_id: stored.filing_id, refused: "stale_preview", stale_rows: [label], note: `Refused: "${label}" matched ${written.changes} rows instead of one, so a touched row changed since the preview. Nothing was written. Render, present and preview again.` };
  }
  const revision = fetchRevision(db);
  const log = appendLog(db, stored, written.results, revision);
  return { applied: true, filing_id: stored.filing_id, revision, audit_log: log.file, audit_lines: log.lines, note: `Applied${written.warning ? ` (${written.warning})` : ""}.` };
}

// ---------------------------------------------------------------------------------------------
// The quick-edits log (paragraph-revision.md section 8)

/** One filing's quick-edits log, in the matter's Drafting records folder. */
function logFile(db: string, filingId: number): string {
  return join(recordsDir(db), `quick-edits-${filingId}.jsonl`);
}

/** Appends one line per planned change, after the write commits, with each inserted row's id filled
 * from the write's results. Returns the file and the 1-based lines appended. */
function appendLog(db: string, stored: StoredPreview, results: { rowid: number }[], revision: number): { file: string; lines: number[] } {
  const file = logFile(db, stored.filing_id);
  mkdirSync(dirname(file), { recursive: true });
  const before = existsSync(file) ? readFileSync(file, "utf-8").split("\n").length - 1 : 0;
  const id = (ref: IdRef | null) => (ref === null || typeof ref === "number" ? ref : results[ref.$rowid].rowid);
  const appliedAt = new Date().toISOString();
  const text = stored.log
    .map((e) => {
      const entityId = id(e.entity_id) as number;
      const to = e.op === "kill" ? String(rows(db, `SELECT killed_on FROM "${e.entity}" WHERE id = ?`, [entityId])[0].killed_on) : e.to;
      return JSON.stringify({
        applied_at: appliedAt,
        session_token: stored.session_token,
        preview_token: stored.token,
        seen_revision: stored.seen_revision,
        new_revision: revision,
        op: e.op,
        document: e.document,
        entity: e.entity,
        entity_id: entityId,
        deployment_id: id(e.deployment_id),
        from: e.from,
        to,
        old_hash: e.old_hash,
        new_hash: e.new_hash,
      });
    })
    .join("\n");
  appendFileSync(file, `${text}\n`, "utf-8");
  return { file, lines: stored.log.map((_, i) => before + i + 1) };
}
