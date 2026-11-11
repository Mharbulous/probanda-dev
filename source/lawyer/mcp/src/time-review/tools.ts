// The time_review__* tools on billing's `timekeeping` server (build plan slice 5): save a day's
// evidence, stage a reviewer's blocks for the day, read the day back. Code decides every block's
// flags and state (flags.ts); the reviewer states only the bases.

import { DataServerError, ValidationError } from "../errors.js";
import type { KvCheck, KvWrite } from "../kv/backend.js";
import { REVIEW_DATE_PREFIX, timePipelineApplyIf, timePipelineGet, timePipelineList } from "../time-pipeline/backend.js";
import {
  type ReviewDateSeams,
  reviewDateJudgment,
  reviewDateStageGate,
} from "../time-pipeline/review-date.js";
import { dayIsClear, recordTimecamp } from "./act.js";
import { acceptEntry, normalizeEntry } from "./fingerprint.js";
import { captureId } from "./page.js";
import { checkBillBasis, checkMatterBasis, decideFlags, MATTER_BASIS } from "./flags.js";
import {
  BLOCK_PREFIX,
  type BlockRecord,
  type DayEvidenceRecord,
  type EvidenceRef,
  NAMESPACE,
  type SourceStatus,
  blockId,
  blockKey,
  dayEvidenceKey,
  envOf,
  nowOf,
  NAMESPACE as ITEM,
  putRecord,
  readDayEvidence,
  sourcesShort,
} from "./records.js";
import { GATE_SOURCES, type GateSource } from "./sources.js";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const BLOCK_ID = /^\d{4}-\d{2}-\d{2}:\d{3}$/;
const MAX_BLOCKS = 999;
const STAGE_ATTEMPTS = 5;

function checkDate(tool: string, date: unknown): string {
  if (typeof date !== "string" || !DATE.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    throw new ValidationError(`${tool}: ${JSON.stringify(date)} is not a date as YYYY-MM-DD`);
  }
  return date;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function checkSource(label: string, value: unknown): GateSource {
  if (typeof value !== "string" || !(GATE_SOURCES as readonly string[]).includes(value)) {
    throw new ValidationError(`${label}: source must be one of ${GATE_SOURCES.join(", ")}`);
  }
  return value as GateSource;
}

function nonEmpty(label: string, field: string, value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") throw new ValidationError(`${label}: ${field} must be a non-empty string`);
  return value;
}

export type SaveEvidenceResult =
  | { status: "saved"; date: string; sha256: string; complete: boolean; short: GateSource[] }
  | { status: "judged"; date: string; judged_at: string; judged_by: string | null };

/** Save one day's `day_evidence` record whole. `sources` says what the gather step got from each
 * source; `rows` are the evidence rows, each naming its `source`. A day that is judged keeps the
 * evidence its blocks were judged on. */
export function timeReviewSaveEvidence(
  dateIn: unknown,
  sourcesIn: unknown,
  rowsIn: unknown,
  seams: ReviewDateSeams = {}
): SaveEvidenceResult {
  const tool = "time_review__save_evidence";
  const date = checkDate(tool, dateIn);
  if (!Array.isArray(sourcesIn)) throw new ValidationError(`${tool}: sources must be a list of {source, status}`);
  if (!Array.isArray(rowsIn)) throw new ValidationError(`${tool}: rows must be a list of evidence rows`);
  const sources: SourceStatus[] = [];
  sourcesIn.forEach((entry, i) => {
    const label = `${tool} sources[${i}]`;
    if (!isObject(entry)) throw new ValidationError(`${label} must be {source, status}`);
    const source = checkSource(label, entry.source);
    if (sources.some((s) => s.source === source)) throw new ValidationError(`${label}: ${source} is listed twice`);
    sources.push({ source, status: nonEmpty(label, "status", entry.status) });
  });
  const rows = rowsIn.map((row, i) => {
    const label = `${tool} rows[${i}]`;
    if (!isObject(row)) throw new ValidationError(`${label} must be an object naming its source`);
    const source = checkSource(label, row.source);
    if (!sources.some((s) => s.source === source)) {
      throw new ValidationError(`${label}: ${source} has a row but is not listed in sources`);
    }
    return { ...row, source };
  });

  const judged = reviewDateJudgment(date, seams);
  if (judged) return { status: "judged", date, ...judged };
  const record: DayEvidenceRecord = { kind: "day_evidence", date, saved_at: nowOf(seams).toISOString(), sources, rows };
  const sha256 = putRecord(tool, dayEvidenceKey(date), record, seams);
  const short = sourcesShort(record);
  return { status: "saved", date, sha256, complete: short.length === 0, short };
}

export type StageDayResult =
  | { status: "staged"; date: string; blocks: { id: string; state: string; flags: string[] }[] }
  | { status: "judged"; date: string; judged_at: string; judged_by: string | null }
  | { status: "held"; date: string; holder: string; expires_at: string }
  | { status: "claim_lost"; date: string }
  | { status: "evidence_missing"; date: string }
  | { status: "evidence_short"; date: string; short: GateSource[] };

const BLOCK_FIELDS = ["start", "end", "matter", "description", "matter_basis", "bill_basis", "evidence"];

export type NewBlock =Omit<BlockRecord, "kind" | "id" | "date" | "links" | "staged_at">;

export function checkBlock(tool: string, index: number, raw: unknown): NewBlock {
  const label = `${tool} blocks[${index}]`;
  if (!isObject(raw)) throw new ValidationError(`${label} must be an object`);
  for (const field of Object.keys(raw)) {
    if (!BLOCK_FIELDS.includes(field)) {
      const why = field === "flags" || field === "state" ? "code sets flags and state from the bases" : "not a block field";
      throw new ValidationError(`${label}: ${field} is ${why}; allowed: ${BLOCK_FIELDS.join(", ")}`);
    }
  }
  const matter_basis = checkMatterBasis(label, raw.matter_basis);
  const bill_basis = checkBillBasis(label, raw.bill_basis);
  if (!Array.isArray(raw.evidence)) throw new ValidationError(`${label}: evidence must be a list of {source, ref}`);
  const evidence: EvidenceRef[] = raw.evidence.map((entry, i) => {
    const elabel = `${label} evidence[${i}]`;
    if (!isObject(entry)) throw new ValidationError(`${elabel} must be {source, ref}`);
    return { source: checkSource(elabel, entry.source), ref: nonEmpty(elabel, "ref", entry.ref) };
  });
  if (!MATTER_BASIS[matter_basis] && evidence.length === 0) {
    throw new ValidationError(
      `${label}: matter_basis ${matter_basis} says the evidence carries the matter, so evidence must list at least one {source, ref}; state no_evidence if there is none`
    );
  }
  return {
    start: nonEmpty(label, "start", raw.start),
    end: nonEmpty(label, "end", raw.end),
    matter: nonEmpty(label, "matter", raw.matter),
    description: nonEmpty(label, "description", raw.description),
    matter_basis,
    bill_basis,
    ...decideFlags(matter_basis, bill_basis),
    evidence,
  };
}

/** Stage one day's blocks for the run holding `token`. Refused, writing nothing, when the day is
 * judged, another run holds its claim, the run holds none, the day has no saved evidence, or any
 * gate source is short in it. Staging again before the day is judged replaces the day's blocks.
 * The check and every write are one transaction, so a claim that is lost or a day that is judged
 * between the check and the write leaves nothing behind. */
export function timeReviewStageDay(
  dateIn: unknown,
  token: unknown,
  blocksIn: unknown,
  seams: ReviewDateSeams = {}
): StageDayResult {
  const tool = "time_review__stage_day";
  const date = checkDate(tool, dateIn);
  if (typeof token !== "string" || token === "") throw new ValidationError(`${tool}: token must be the claim token review_date__claim gave`);
  if (!Array.isArray(blocksIn)) throw new ValidationError(`${tool}: blocks must be a list`);
  if (blocksIn.length > MAX_BLOCKS) throw new ValidationError(`${tool}: at most ${MAX_BLOCKS} blocks a day`);
  const checked = blocksIn.map((raw, i) => checkBlock(tool, i, raw));

  // The claim check and the writes are one transaction: the writes land only if the review-date
  // record (the claim, the judged mark) and the day's evidence are still the ones this call read. A
  // run that loses that race reads and decides again.
  const env = envOf(seams);
  for (let attempt = 0; attempt < STAGE_ATTEMPTS; attempt += 1) {
    const gate = reviewDateStageGate(date, token, seams);
    if (!gate.ok) {
      const { ok: _ok, record_sha256: _sha, ...refusal } = gate;
      return { ...refusal, date };
    }
    const read = timePipelineGet(ITEM, dayEvidenceKey(date), env);
    if (read.value === null) return { status: "evidence_missing", date };
    const short = sourcesShort(JSON.parse(read.value) as DayEvidenceRecord);
    if (short.length > 0) return { status: "evidence_short", date, short };

    const staged_at = nowOf(seams).toISOString();
    const written = checked.map((fields, i): BlockRecord => ({
      kind: "block",
      id: blockId(date, i),
      date,
      ...fields,
      links: [],
      staged_at,
    }));
    const keep = new Set(written.map((b) => blockKey(b.id)));
    const existing = timePipelineList(NAMESPACE, `${BLOCK_PREFIX}${date}:`, env).items;
    const checks: KvCheck[] = [
      { namespace: NAMESPACE, key: REVIEW_DATE_PREFIX + date, ...(gate.record_sha256 === null ? { expect_absent: true } : { expect_sha256: gate.record_sha256 }) },
      { namespace: NAMESPACE, key: dayEvidenceKey(date), expect_sha256: read.sha256 as string },
      // A block written meanwhile by another call to this tool is a change this call did not read.
      ...existing.map((item): KvCheck => ({ namespace: NAMESPACE, key: item.key, expect_sha256: item.sha256 })),
    ];
    const writes: KvWrite[] = [
      ...written.map((block): KvWrite => ({ op: "set", namespace: NAMESPACE, key: blockKey(block.id), value: JSON.stringify(block) })),
      ...existing.filter((item) => !keep.has(item.key)).map((item): KvWrite => ({ op: "delete", namespace: NAMESPACE, key: item.key })),
    ];
    if ("stale" in timePipelineApplyIf(checks, writes, env)) continue;
    return { status: "staged", date, blocks: written.map((b) => ({ id: b.id, state: b.state, flags: b.flags })) };
  }
  throw new DataServerError(`${tool}: ${date} changed ${STAGE_ATTEMPTS} times while this call was staging; nothing was written. Try again`, "contended");
}

/** The day's saved evidence (or null), its staged blocks in order, whether the day is clear
 * (judged, with no flagged block) and the saved reading of each screenshot the blocks cite, by
 * capture id (null where none is saved). Writes nothing and opens no image. */
export function timeReviewReadDay(
  dateIn: unknown,
  seams: ReviewDateSeams = {}
): {
  date: string;
  clear: boolean;
  evidence: DayEvidenceRecord | null;
  blocks: BlockRecord[];
  readings: Record<string, unknown>;
} {
  const date = checkDate("time_review__read_day", dateIn);
  const env = envOf(seams);
  const { items } = timePipelineList(NAMESPACE, `${BLOCK_PREFIX}${date}:`, env);
  const blocks = items.map((item) => JSON.parse(item.value) as BlockRecord);
  const evidence = readDayEvidence(date, seams);
  const readings: Record<string, unknown> = {};
  for (const block of blocks) {
    for (const ref of block.evidence) {
      if (ref.source !== "syncopaid_captures") continue;
      const id = captureId(evidence, ref.ref);
      if (id in readings) continue;
      const { value } = timePipelineGet(NAMESPACE, `capture_reading:${id}`, env);
      readings[id] = value === null ? null : JSON.parse(value);
    }
  }
  return { date, clear: dayIsClear(date, blocks, seams), evidence, blocks, readings };
}

/** Save how the session's write of a block's matter or description to TimeCamp went, read back. */
export function timeReviewRecordTimecamp(
  blockIn: unknown,
  statusIn: unknown,
  messageIn: unknown,
  seams: ReviewDateSeams = {},
  entryIn?: unknown
): { block: string; timecamp: BlockRecord["timecamp"] } {
  const tool = "time_review__record_timecamp";
  if (typeof blockIn !== "string" || !BLOCK_ID.test(blockIn)) throw new ValidationError(`${tool}: block must be a block id as YYYY-MM-DD:nnn`);
  if (typeof statusIn !== "string") throw new ValidationError(`${tool}: status must be text`);
  if (messageIn !== undefined && typeof messageIn !== "string") throw new ValidationError(`${tool}: message must be text`);
  try {
    if (entryIn !== undefined) normalizeEntry(`${tool} entry`, entryIn);
    const saved = recordTimecamp(blockIn, statusIn, messageIn, seams);
    // The entry as read back after the write is the practitioner's own change: the day's
    // fingerprint takes it, so the next resume does not report it as a change.
    if (entryIn !== undefined && (statusIn === "saved" || statusIn === "unchanged")) acceptEntry(blockIn.slice(0, 10), entryIn, seams);
    return { block: blockIn, timecamp: saved.timecamp };
  } catch (err) {
    if (err instanceof ValidationError) throw new ValidationError(`${tool}: ${err.message}`);
    throw err;
  }
}
