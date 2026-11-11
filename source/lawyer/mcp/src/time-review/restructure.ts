// Split, merge and their undo for the time review page (build plan slice 9; spec Part 1, "Split",
// "Merge", "Unmerge and unsplit"). Every function here works on the stored block records only:
// it opens no image, dispatches no reader and calls no model, and it never touches TimeCamp. Only
// the page listener calls split, merge and undo (for a click), and the waiting session calls
// redraft and markIssued through their tools.
//
// A split or merge keeps the originals and makes new blocks. The link is one entry in a block's
// `links` list whose `role` is a value (Commandment 5): a half carries `split_from` -> the original,
// each merged original carries `merged_into` -> the new block. The original's `state` becomes
// `split` or `merged`, which hides nothing and approves nothing. Undo removes the new blocks and
// brings the originals back exactly as they were, flagged, until the time is on an issued invoice.

import { DataServerError, ValidationError } from "../errors.js";
import type { KvCheck, KvWrite } from "../kv/backend.js";
import { timePipelineApplyIf, timePipelineList } from "../time-pipeline/backend.js";
import type { ReviewDateSeams } from "../time-pipeline/review-date.js";
import { type BillBasis, type MatterBasis, MATTER_BASIS, decideFlags } from "./flags.js";
import {
  BLOCK_PREFIX,
  type BlockRecord,
  type DayEvidenceRecord,
  type EvidenceRef,
  NAMESPACE,
  blockId,
  blockKey,
  envOf,
  nowOf,
  readDayEvidence,
} from "./records.js";

export const ROLE_SPLIT_FROM = "split_from";
export const ROLE_MERGED_INTO = "merged_into";
export const FLAG_REDRAFT = "split:redraft_pending";
export const FLAG_MERGED = "merge:new_block";

const ATTEMPTS = 5;
const SHOT = "syncopaid_captures";
const ID_FIELDS = ["id", "native_id", "capture_id", "entry_id"];
const TIME_FIELDS = ["captured_at", "native_id", "id"];
const MAX_MERGE = 20;
const MAX_TEXT = 2000;
const MAX_SHORT = 200;
const CLOCK = /^(\d{1,2}):(\d{2})$/;
const BLOCK_ID = /^\d{4}-\d{2}-\d{2}:\d{3}$/;

const RESTRUCTURED = ["merged", "split"];
const isRestructured = (b: BlockRecord): boolean => RESTRUCTURED.includes(b.state);
const linkTo = (b: BlockRecord, role: string): string | undefined => b.links.find((l) => l.role === role)?.block;

function checkId(label: string, value: unknown): string {
  if (typeof value !== "string" || !BLOCK_ID.test(value)) throw new ValidationError(`${label} must be a block id as YYYY-MM-DD:nnn`);
  return value;
}

function unique<T>(list: T[]): T[] {
  return [...new Set(list)];
}

// ---- Reading and writing a day's blocks, as one transaction --------------------------------

interface Plan<T> {
  /** Blocks to save whole (new, or changed). */
  save: BlockRecord[];
  /** Ids of blocks to remove. */
  remove: string[];
  result: T;
}

/** Reads the day's blocks, lets `plan` decide, and writes only if no block of the day changed
 * meanwhile (and no new id was taken). A lost race reads and decides again. `plan` throws
 * ValidationError to refuse, writing nothing. */
function commit<T>(tool: string, date: string, seams: ReviewDateSeams, plan: (blocks: BlockRecord[]) => Plan<T>): T {
  const env = envOf(seams);
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    const items = timePipelineList(NAMESPACE, `${BLOCK_PREFIX}${date}:`, env).items;
    const blocks = items.map((item) => JSON.parse(item.value) as BlockRecord);
    const { save, remove, result } = plan(blocks);
    const known = new Set(blocks.map((b) => b.id));
    const checks: KvCheck[] = [
      ...items.map((item): KvCheck => ({ namespace: NAMESPACE, key: item.key, expect_sha256: item.sha256 })),
      ...save.filter((b) => !known.has(b.id)).map((b): KvCheck => ({ namespace: NAMESPACE, key: blockKey(b.id), expect_absent: true })),
    ];
    const writes: KvWrite[] = [
      ...save.map((block): KvWrite => ({ op: "set", namespace: NAMESPACE, key: blockKey(block.id), value: JSON.stringify(block) })),
      ...remove.map((id): KvWrite => ({ op: "delete", namespace: NAMESPACE, key: blockKey(id) })),
    ];
    if (!("stale" in timePipelineApplyIf(checks, writes, env))) return result;
  }
  throw new DataServerError(`${tool}: ${date} changed ${ATTEMPTS} times while this call was saving; nothing was written. Try again`, "contended");
}

function find(blocks: BlockRecord[], id: string): BlockRecord {
  const found = blocks.find((b) => b.id === id);
  if (!found) throw new ValidationError(`${id} is not a block`);
  return found;
}

function refuseIssued(b: BlockRecord): void {
  if (b.issued) {
    throw new ValidationError(
      `The time in block ${b.id} is on issued invoice ${b.issued.invoice_number}, so it is final. Record a later correction as an adjustment`
    );
  }
}

/** The next unused block number on the day, as the 0-based index `blockId` takes. */
function nextIndex(blocks: BlockRecord[]): number {
  return blocks.reduce((most, b) => Math.max(most, Number(b.id.slice(11))), 0);
}

// ---- Times --------------------------------------------------------------------------------

function clockMinutes(text: string): number | null {
  const m = CLOCK.exec(text);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** A comparable number for a block's start: its minutes when a clock time, else its instant. */
function sortValue(text: string): number {
  const clock = clockMinutes(text);
  if (clock !== null) return clock;
  const instant = Date.parse(text);
  return Number.isFinite(instant) ? instant : Number.POSITIVE_INFINITY;
}

function byStart(a: BlockRecord, b: BlockRecord): number {
  const diff = sortValue(a.start) - sortValue(b.start);
  if (diff !== 0 && Number.isFinite(diff)) return diff;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

const clockText = (d: Date): string => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

// ---- Screenshots in the saved evidence ------------------------------------------------------

type Row = DayEvidenceRecord["rows"][number];

/** The saved evidence row a screenshot reference points at: by position when the reference is a
 * number, else by an id field. Null when the day's evidence does not hold it. */
function shotRow(day: DayEvidenceRecord | null, ref: string): Row | null {
  if (!day) return null;
  if (/^\d+$/.test(ref)) {
    const at = day.rows[Number(ref)];
    if (at && at.source === SHOT) return at;
  }
  return day.rows.find((r) => r.source === SHOT && ID_FIELDS.some((f) => r[f] !== undefined && String(r[f]) === ref)) ?? null;
}

/** When the screenshot was taken, from the saved evidence row (or, failing that, from the reference
 * itself when that reads as a time). Null when neither does. */
function shotInstant(day: DayEvidenceRecord | null, ref: string): { date: Date; text: string } | null {
  const row = shotRow(day, ref);
  const candidates = [...(row ? TIME_FIELDS.map((f) => row[f]) : []), ref];
  for (const c of candidates) {
    if (typeof c !== "string") continue;
    const ms = Date.parse(c);
    if (Number.isFinite(ms)) return { date: new Date(ms), text: c };
  }
  return null;
}

const shotName = (day: DayEvidenceRecord | null, ref: string): string => {
  const row = shotRow(day, ref);
  return row && typeof row.capture_id === "string" && row.capture_id !== "" ? row.capture_id : ref;
};

// ---- Split --------------------------------------------------------------------------------

export interface SplitResult {
  original: string;
  halves: [string, string];
}

/** Splits `id` at the screenshot `capture` (the reference the block cites, or its capture id): the
 * time from that screenshot on becomes a new block. Both halves are new, flagged, and hold the
 * original's description and matter as a placeholder until the waiting session redrafts them
 * (`redraft` pending). The original is kept, marked `split`. Throws ValidationError, writing nothing,
 * when the block cannot be split there. */
export function splitBlock(idIn: unknown, captureIn: unknown, seams: ReviewDateSeams = {}): SplitResult {
  const id = checkId("The block", idIn);
  if (typeof captureIn !== "string" || captureIn.trim() === "" || captureIn.length > MAX_SHORT) {
    throw new ValidationError("A split needs the screenshot to split at");
  }
  const capture = captureIn.trim();
  const date = id.slice(0, 10);
  const day = readDayEvidence(date, seams);
  const at = nowOf(seams).toISOString();
  return commit("split", date, seams, (blocks) => {
    const b = find(blocks, id);
    refuseIssued(b);
    if (isRestructured(b)) throw new ValidationError(`Block ${id} is already ${b.state}; undo that first`);
    if (b.state === "written_off") throw new ValidationError(`Block ${id} is written off and cannot be split`);
    const cited = b.evidence.filter((e) => e.source === SHOT);
    const chosen = cited.find((e) => e.ref === capture || shotName(day, e.ref) === capture);
    if (!chosen) throw new ValidationError(`Block ${id} does not cite a screenshot ${capture}`);
    const when = shotInstant(day, chosen.ref);
    if (!when) throw new ValidationError(`The saved evidence does not say when screenshot ${capture} was taken`);

    // The cut, in the block's own terms: a clock time (the minutes of the PC's local time) or an instant.
    const startClock = clockMinutes(b.start);
    const endClock = clockMinutes(b.end);
    let cutText: string;
    let before: (d: Date) => boolean;
    if (startClock !== null && endClock !== null) {
      const cut = when.date.getHours() * 60 + when.date.getMinutes();
      if (!(cut > startClock && cut < endClock)) throw new ValidationError(`Screenshot ${capture} is not inside block ${id} (${b.start} to ${b.end}), so it cannot split it`);
      cutText = clockText(when.date);
      before = (d) => d.getHours() * 60 + d.getMinutes() < cut;
    } else {
      const s = Date.parse(b.start);
      const e = Date.parse(b.end);
      const cut = when.date.getTime();
      if (!(Number.isFinite(s) && Number.isFinite(e) && cut > s && cut < e)) {
        throw new ValidationError(`Screenshot ${capture} is not inside block ${id} (${b.start} to ${b.end}), so it cannot split it`);
      }
      cutText = when.text;
      before = (d) => d.getTime() < cut;
    }

    // A cited screenshot goes to the half it falls in; any other evidence, or a screenshot whose
    // time the evidence does not give, goes to both.
    const evidenceFor = (first: boolean): EvidenceRef[] =>
      b.evidence.filter((e) => {
        if (e.source !== SHOT) return true;
        const t = shotInstant(day, e.ref);
        return t === null || before(t.date) === first;
      });

    const base = nextIndex(blocks);
    const bill_basis = unique<BillBasis>([...b.bill_basis, "description_inferred"]);
    const half = (n: number, start: string, end: string, first: boolean): BlockRecord => ({
      kind: "block",
      id: blockId(date, base + n),
      date,
      start,
      end,
      matter: b.matter,
      description: b.description,
      matter_basis: b.matter_basis,
      bill_basis,
      flags: [...decideFlags(b.matter_basis, bill_basis).flags, FLAG_REDRAFT],
      state: "flagged",
      evidence: evidenceFor(first),
      links: [{ role: ROLE_SPLIT_FROM, block: b.id }],
      staged_at: at,
      redraft: { status: "pending", at },
    });
    const first = half(0, b.start, cutText, true);
    const second = half(1, cutText, b.end, false);
    return { save: [{ ...b, state: "split" }, first, second], remove: [], result: { original: b.id, halves: [first.id, second.id] } };
  });
}

/** Saves the redrafted matter and description of one split half, from the stored evidence and saved
 * readings, and ends its pending redraft. The half stays flagged: only a click approves it. */
export function redraftBlock(idIn: unknown, matterIn: unknown, descriptionIn: unknown, seams: ReviewDateSeams = {}): BlockRecord {
  const tool = "time_review__redraft";
  const id = checkId(`${tool}: block`, idIn);
  const text = (label: string, value: unknown, max: number): string => {
    if (typeof value !== "string" || value.trim() === "") throw new ValidationError(`${tool}: ${label} must be a non-empty text`);
    if (value.length > max) throw new ValidationError(`${tool}: ${label} is longer than ${max} characters`);
    return value.trim();
  };
  const matter = text("matter", matterIn, MAX_SHORT);
  const description = text("description", descriptionIn, MAX_TEXT);
  const at = nowOf(seams).toISOString();
  return commit(tool, id.slice(0, 10), seams, (blocks) => {
    const b = find(blocks, id);
    if (b.redraft?.status !== "pending") throw new ValidationError(`${tool}: block ${id} has no redraft waiting`);
    const next: BlockRecord = {
      ...b,
      matter,
      description,
      flags: b.flags.filter((f) => f !== FLAG_REDRAFT),
      state: "flagged",
      redraft: { status: "done", at },
    };
    return { save: [next], remove: [], result: next };
  });
}

// ---- Merge --------------------------------------------------------------------------------

export interface MergeResult {
  merged: string;
  originals: string[];
}

/** Joins adjacent blocks of one matter on one day into a new flagged block. A script joins the
 * descriptions with "; ": no model writes or edits them. The originals are kept, marked `merged`
 * and linked `merged_into` the new block. */
export function mergeBlocks(idsIn: unknown, seams: ReviewDateSeams = {}): MergeResult {
  if (!Array.isArray(idsIn) || idsIn.length < 2 || idsIn.length > MAX_MERGE) {
    throw new ValidationError(`A merge needs between 2 and ${MAX_MERGE} blocks`);
  }
  const ids = unique(idsIn.map((v, i) => checkId(`Block ${i + 1}`, v)));
  if (ids.length < 2) throw new ValidationError("A merge needs two different blocks");
  const date = ids[0].slice(0, 10);
  if (ids.some((id) => id.slice(0, 10) !== date)) throw new ValidationError("A merge joins blocks of one day only");
  const at = nowOf(seams).toISOString();
  return commit("merge", date, seams, (blocks) => {
    const picked = ids.map((id) => find(blocks, id));
    for (const b of picked) {
      refuseIssued(b);
      if (isRestructured(b)) throw new ValidationError(`Block ${b.id} is already ${b.state}; undo that first`);
      if (b.state === "written_off") throw new ValidationError(`Block ${b.id} is written off and cannot be merged`);
    }
    if (unique(picked.map((b) => b.matter)).length !== 1) throw new ValidationError("A merge joins blocks of one matter only");
    const live = blocks.filter((b) => !isRestructured(b)).sort(byStart);
    const at_ = picked.map((b) => live.indexOf(b)).sort((x, y) => x - y);
    if (at_.some((pos, i) => i > 0 && pos !== at_[i - 1] + 1)) throw new ValidationError("A merge joins blocks that are next to each other");
    const ordered = at_.map((pos) => live[pos]);

    const matter_basis: MatterBasis = (ordered.find((b) => MATTER_BASIS[b.matter_basis]) ?? ordered[0]).matter_basis;
    const bill_basis = unique<BillBasis>(ordered.flatMap((b) => b.bill_basis));
    const evidence = ordered
      .flatMap((b) => b.evidence)
      .filter((e, i, all) => all.findIndex((o) => o.source === e.source && o.ref === e.ref) === i);
    const made: BlockRecord = {
      kind: "block",
      id: blockId(date, nextIndex(blocks)),
      date,
      start: ordered[0].start,
      end: ordered[ordered.length - 1].end,
      matter: ordered[0].matter,
      description: ordered.map((b) => b.description).join("; "),
      matter_basis,
      bill_basis,
      flags: [...decideFlags(matter_basis, bill_basis).flags, FLAG_MERGED],
      state: "flagged",
      evidence,
      links: [],
      staged_at: at,
    };
    const kept = ordered.map((b): BlockRecord => ({ ...b, state: "merged", links: [...b.links, { role: ROLE_MERGED_INTO, block: made.id }] }));
    return { save: [...kept, made], remove: [], result: { merged: made.id, originals: ordered.map((b) => b.id) } };
  });
}

// ---- Undo ---------------------------------------------------------------------------------

export interface UndoResult {
  undone: "split" | "merge";
  /** The originals, back in the store and flagged. */
  restored: string[];
  /** The new blocks that were removed. */
  removed: string[];
}

function restore(b: BlockRecord, role: string, flag: string): BlockRecord {
  return { ...b, state: "flagged", links: b.links.filter((l) => l.role !== role), flags: unique([...b.flags, flag]) };
}

/** Undoes the split or merge `id` belongs to, whether `id` names an original or a new block. The
 * originals come back exactly as they were except that they are flagged (the approval was for the
 * other version), and the new blocks go. Refused, writing nothing, when any block in the group is on
 * an issued invoice or a new block has itself been split or merged. */
export function undoRestructure(idIn: unknown, seams: ReviewDateSeams = {}): UndoResult {
  const id = checkId("The block", idIn);
  return commit<UndoResult>("undo", id.slice(0, 10), seams, (blocks) => {
    const b = find(blocks, id);
    const mergedInto = linkTo(b, ROLE_MERGED_INTO);
    const splitFrom = linkTo(b, ROLE_SPLIT_FROM);
    const asMergeResult = blocks.filter((o) => linkTo(o, ROLE_MERGED_INTO) === b.id);

    if (b.state === "split" || splitFrom) {
      const original = splitFrom ? find(blocks, splitFrom) : b;
      const halves = blocks.filter((h) => linkTo(h, ROLE_SPLIT_FROM) === original.id);
      for (const x of [original, ...halves]) refuseIssued(x);
      const moved = halves.find(isRestructured);
      if (moved) throw new ValidationError(`Block ${moved.id} has since been ${moved.state}; undo that first`);
      return {
        save: [restore(original, "", "undo:split")],
        remove: halves.map((h) => h.id),
        result: { undone: "split", restored: [original.id], removed: halves.map((h) => h.id) },
      };
    }
    if (mergedInto || asMergeResult.length > 0) {
      const made = mergedInto ? find(blocks, mergedInto) : b;
      const originals = blocks.filter((o) => linkTo(o, ROLE_MERGED_INTO) === made.id);
      for (const x of [made, ...originals]) refuseIssued(x);
      if (isRestructured(made)) throw new ValidationError(`Block ${made.id} has since been ${made.state}; undo that first`);
      return {
        save: originals.map((o) => restore(o, ROLE_MERGED_INTO, "undo:merge")),
        remove: [made.id],
        result: { undone: "merge", restored: originals.map((o) => o.id), removed: [made.id] },
      };
    }
    throw new ValidationError(`Block ${id} is not part of a split or a merge`);
  });
}

// ---- The issued lock ----------------------------------------------------------------------

/** Marks blocks as on issued invoice `invoice`. Called when an invoice is issued, for the blocks
 * its lines rest on: from then on split, merge and undo refuse them and the blocks they came from. */
export function markIssued(idsIn: unknown, invoiceIn: unknown, seams: ReviewDateSeams = {}): { marked: string[] } {
  const tool = "time_review__mark_issued";
  if (!Array.isArray(idsIn) || idsIn.length === 0) throw new ValidationError(`${tool}: blocks must be a list of block ids`);
  const ids = unique(idsIn.map((v, i) => checkId(`${tool}: block ${i + 1}`, v)));
  if (typeof invoiceIn !== "string" || invoiceIn.trim() === "" || invoiceIn.length > 80) {
    throw new ValidationError(`${tool}: invoice must be the invoice number as text`);
  }
  const invoice_number = invoiceIn.trim();
  const at = nowOf(seams).toISOString();
  for (const date of unique(ids.map((id) => id.slice(0, 10)))) {
    commit(tool, date, seams, (blocks) => {
      const save = ids
        .filter((id) => id.startsWith(date))
        .map((id) => {
          const b = find(blocks, id);
          return b.issued ? b : { ...b, issued: { invoice_number, at } };
        });
      return { save, remove: [], result: null };
    });
  }
  return { marked: ids };
}
