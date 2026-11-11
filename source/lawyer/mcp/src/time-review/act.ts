// The acts a click on the review page records on a block (build plan slice 8): Approve, Correct and
// Write off. Only the page listener calls applyAct, and only for a click that names the block, so a
// block records an approval from nothing else: no tool takes an act, and stage_day cannot pass a
// state. The waiting session reports how the TimeCamp write went with recordTimecamp.

import { DataServerError, ValidationError } from "../errors.js";
import { timePipelineGet, timePipelineWriteIf } from "../time-pipeline/backend.js";
import { type ReviewDateSeams, reviewDateJudgment } from "../time-pipeline/review-date.js";
import {
  type BlockRecord,
  type BlockReview,
  type TimecampResult,
  NAMESPACE,
  blockKey,
  envOf,
  nowOf,
} from "./records.js";

/** The practitioner clicking on the page is the only actor an act records. */
export const ACTOR = "practitioner";
export const ACTS = ["approve", "correct", "write_off"] as const;
export type Act = (typeof ACTS)[number];
export const isAct = (value: string): value is Act => (ACTS as readonly string[]).includes(value);

const ATTEMPTS = 5;
const MAX_TEXT = 2000;
const MAX_SHORT = 200;

export interface ActFields {
  matter?: unknown;
  description?: unknown;
  start?: unknown;
  end?: unknown;
  reason?: unknown;
}

function text(label: string, value: unknown, max: number): string {
  if (typeof value !== "string" || value.trim() === "") throw new ValidationError(`${label} must be a non-empty text`);
  if (value.length > max) throw new ValidationError(`${label} is longer than ${max} characters`);
  return value.trim();
}

/** Reads the block, applies the act and saves it only if the block is still the one read. */
function change(id: string, seams: ReviewDateSeams, edit: (block: BlockRecord) => BlockRecord): BlockRecord {
  const env = envOf(seams);
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    const read = timePipelineGet(NAMESPACE, blockKey(id), env);
    if (read.value === null) throw new ValidationError(`${id} is not a block`);
    const current = JSON.parse(read.value) as BlockRecord;
    if (current.state === "merged" || current.state === "split") {
      throw new ValidationError(`${id} was ${current.state} into a new block; act on the new block, or undo first`);
    }
    const next = edit(current);
    const saved = timePipelineWriteIf(NAMESPACE, blockKey(id), JSON.stringify(next), { expect_sha256: read.sha256 as string }, env);
    if (!("stale" in saved)) return next;
  }
  throw new DataServerError(`block ${id} changed ${ATTEMPTS} times while it was being saved; nothing was written. Try again`, "contended");
}

/** Records one click's act on its block. Approve and Correct leave the TimeCamp result `pending`
 * for the waiting session; Write off has none. Correct needs the matter, description, start and end
 * the form holds; Write off needs a reason. Throws ValidationError, writing nothing, for anything else. */
export function applyAct(act: Act, id: string, fields: ActFields, seams: ReviewDateSeams = {}): BlockRecord {
  const at = nowOf(seams).toISOString();
  const review = (extra: Partial<BlockReview>): BlockReview => ({ act: "approved", by: ACTOR, at, ...extra });
  if (act === "write_off") {
    const reason = text("A write-off reason", fields.reason, MAX_SHORT);
    return change(id, seams, (b) => {
      const { timecamp: _none, ...rest } = b;
      return { ...rest, state: "written_off", review: review({ act: "written_off", reason }) };
    });
  }
  if (act === "approve") {
    return change(id, seams, (b) => ({ ...b, state: "approved", review: review({}), timecamp: { status: "pending", at } }));
  }
  const matter = text("The matter", fields.matter, MAX_SHORT);
  const description = text("The description", fields.description, MAX_TEXT);
  const start = text("The start", fields.start, MAX_SHORT);
  const end = text("The end", fields.end, MAX_SHORT);
  return change(id, seams, (b) => ({
    ...b,
    matter,
    description,
    start,
    end,
    state: "corrected",
    // A second correction keeps the first `before`: the version the AI staged.
    review: review({ act: "corrected", before: b.review?.before ?? { matter: b.matter, description: b.description, start: b.start, end: b.end } }),
    timecamp: { status: "pending", at },
  }));
}

export const TIMECAMP_STATUSES = ["saved", "unchanged", "staff_left_alone", "error"] as const;

/** Saves how the write to TimeCamp went onto the block it was for. Refused for a block no click
 * has approved or corrected, which has nothing to write. */
export function recordTimecamp(id: string, status: string, message: string | undefined, seams: ReviewDateSeams = {}): BlockRecord {
  if (!(TIMECAMP_STATUSES as readonly string[]).includes(status)) {
    throw new ValidationError(`status must be one of ${TIMECAMP_STATUSES.join(", ")}`);
  }
  if (status === "error" && (message === undefined || message.trim() === "")) {
    throw new ValidationError("status error needs the message TimeCamp or the re-read gave");
  }
  if (message !== undefined && message.length > MAX_TEXT) throw new ValidationError(`message is longer than ${MAX_TEXT} characters`);
  const at = nowOf(seams).toISOString();
  return change(id, seams, (b) => {
    if (b.review?.act !== "approved" && b.review?.act !== "corrected") {
      throw new ValidationError(`block ${id} has no approval or correction to write to TimeCamp`);
    }
    return { ...b, timecamp: { status: status as TimecampResult["status"], ...(message ? { message } : {}), at } };
  });
}

/** A day is clear when it is judged and no block on it is flagged. */
export function dayIsClear(date: string, blocks: BlockRecord[], seams: ReviewDateSeams = {}): boolean {
  return reviewDateJudgment(date, seams) !== null && !blocks.some((b) => b.date === date && b.state === "flagged");
}
