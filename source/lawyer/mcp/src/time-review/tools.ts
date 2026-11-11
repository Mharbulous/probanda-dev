// The time_review__* tools on billing's `timekeeping` server (build plan slice 5): save a day's
// evidence, stage a reviewer's blocks for the day, read the day back. Code decides every block's
// flags and state (flags.ts); the reviewer states only the bases.

import { ValidationError } from "../errors.js";
import { timePipelineDelete, timePipelineList } from "../time-pipeline/backend.js";
import {
  type ReviewDateSeams,
  reviewDateJudgment,
  reviewDateStageGate,
} from "../time-pipeline/review-date.js";
import { checkBillBasis, checkMatterBasis, decideFlags } from "./flags.js";
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
  putRecord,
  readDayEvidence,
  sourcesShort,
} from "./records.js";
import { GATE_SOURCES, type GateSource } from "./sources.js";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_BLOCKS = 999;

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

type NewBlock = Omit<BlockRecord, "kind" | "id" | "date" | "links" | "staged_at">;

function checkBlock(tool: string, index: number, raw: unknown): NewBlock {
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
 * gate source is short in it. Staging again before the day is judged replaces the day's blocks. */
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

  const gate = reviewDateStageGate(date, token, seams);
  if (!gate.ok) {
    const { ok: _ok, ...refusal } = gate;
    return { ...refusal, date };
  }
  const evidence = readDayEvidence(date, seams);
  if (evidence === null) return { status: "evidence_missing", date };
  const short = sourcesShort(evidence);
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
  for (const block of written) putRecord(tool, blockKey(block.id), block, seams);
  const keep = new Set(written.map((b) => blockKey(b.id)));
  for (const item of timePipelineList(NAMESPACE, `${BLOCK_PREFIX}${date}:`, envOf(seams)).items) {
    if (!keep.has(item.key)) timePipelineDelete(NAMESPACE, item.key, envOf(seams));
  }
  return { status: "staged", date, blocks: written.map((b) => ({ id: b.id, state: b.state, flags: b.flags })) };
}

/** The day's saved evidence (or null) and its staged blocks, in order. Writes nothing. */
export function timeReviewReadDay(
  dateIn: unknown,
  seams: ReviewDateSeams = {}
): { date: string; evidence: DayEvidenceRecord | null; blocks: BlockRecord[] } {
  const date = checkDate("time_review__read_day", dateIn);
  const { items } = timePipelineList(NAMESPACE, `${BLOCK_PREFIX}${date}:`, envOf(seams));
  return {
    date,
    evidence: readDayEvidence(date, seams),
    blocks: items.map((item) => JSON.parse(item.value) as BlockRecord),
  };
}
