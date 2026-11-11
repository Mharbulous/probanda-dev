// Day-evidence and block records for billing's `timekeeping` server (build plan slice 5). Both are
// records in namespace `item`, key `<kind>:<native id>`, with `kind` a value of the record:
//   day_evidence:<YYYY-MM-DD>   one day's evidence rows, each row naming its `source`, and which of
//                               the assembly gate's sources were gathered for the day
//   block:<YYYY-MM-DD>:<nnn>    one reviewed block, with the flags and state that code decided
// Never a field per source or per link role: sources and links are lists of values.

import { DataServerError } from "../errors.js";
import {
  REVIEW_DATE_NAMESPACE,
  timePipelineGet,
  timePipelineWriteIf,
} from "../time-pipeline/backend.js";
import type { ReviewDateSeams } from "../time-pipeline/review-date.js";
import type { BillBasis, BlockState, MatterBasis } from "./flags.js";
import { GATE_SOURCES, type GateSource, TERMINAL_STATUSES } from "./sources.js";

export const NAMESPACE = REVIEW_DATE_NAMESPACE;
export const DAY_EVIDENCE_PREFIX = "day_evidence:";
export const BLOCK_PREFIX = "block:";

export interface SourceStatus {
  source: GateSource;
  status: string;
}

export interface DayEvidenceRecord {
  kind: "day_evidence";
  date: string;
  saved_at: string;
  sources: SourceStatus[];
  rows: ({ source: GateSource } & Record<string, unknown>)[];
}

export interface EvidenceRef {
  source: GateSource;
  ref: string;
}

/** What a click on the block recorded: the act, who, when and, for a write-off, the reason. */
export interface BlockReview {
  act: "approved" | "corrected" | "written_off";
  by: string;
  at: string;
  reason?: string;
  /** The fields a correction replaced, as they were. */
  before?: Pick<BlockRecord, "matter" | "description" | "start" | "end">;
}

/** How the write to TimeCamp after an approval or correction went (time_review__record_timecamp).
 * `pending` is set by the click and replaced by the waiting session. */
export interface TimecampResult {
  status: "pending" | "saved" | "unchanged" | "staff_left_alone" | "error";
  message?: string;
  at: string;
}

export interface BlockRecord {
  kind: "block";
  id: string;
  date: string;
  start: string;
  end: string;
  matter: string;
  description: string;
  matter_basis: MatterBasis;
  bill_basis: BillBasis[];
  flags: string[];
  state: BlockState;
  evidence: EvidenceRef[];
  links: { role: string; block: string }[];
  staged_at: string;
  review?: BlockReview;
  timecamp?: TimecampResult;
  /** A half made by a split: `pending` until the waiting session redrafts it from the evidence. */
  redraft?: { status: "pending" | "done"; at: string };
  /** Set when the time is on an issued invoice: split, merge and undo then refuse the block. */
  issued?: { invoice_number: string; at: string };
}

export const dayEvidenceKey = (date: string): string => DAY_EVIDENCE_PREFIX + date;
export const blockId = (date: string, index: number): string => `${date}:${String(index + 1).padStart(3, "0")}`;
export const blockKey = (id: string): string => BLOCK_PREFIX + id;

export function envOf(seams: ReviewDateSeams): NodeJS.ProcessEnv {
  return seams.env ?? process.env;
}

export function nowOf(seams: ReviewDateSeams): Date {
  return seams.now ? seams.now() : new Date();
}

/** The sources of a day's evidence with no outcome yet, in the gate's order. */
export function sourcesShort(record: DayEvidenceRecord): GateSource[] {
  const done = new Set(
    record.sources.filter((s) => (TERMINAL_STATUSES as readonly string[]).includes(s.status)).map((s) => s.source)
  );
  return GATE_SOURCES.filter((source) => !done.has(source));
}

export function readDayEvidence(date: string, seams: ReviewDateSeams): DayEvidenceRecord | null {
  const { value } = timePipelineGet(NAMESPACE, dayEvidenceKey(date), envOf(seams));
  return value === null ? null : (JSON.parse(value) as DayEvidenceRecord);
}

/** Replace a record whole: read its hash, write if unchanged, and on a lost race read again. */
export function putRecord(tool: string, key: string, value: unknown, seams: ReviewDateSeams): string {
  const attempts = 5;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const current = timePipelineGet(NAMESPACE, key, envOf(seams));
    const expectation = current.sha256 === null ? { expect_absent: true } : { expect_sha256: current.sha256 };
    const reply = timePipelineWriteIf(NAMESPACE, key, JSON.stringify(value), expectation, envOf(seams));
    if (!("stale" in reply)) return reply.sha256;
  }
  throw new DataServerError(`${tool}: ${key} changed ${attempts} times while this call was writing; try again`, "contended");
}
