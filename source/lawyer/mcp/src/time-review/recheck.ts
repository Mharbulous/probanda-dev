// Re-check on request (build plan slice 12; spec Part 4, criterion 19). A fresh day reviewer judges a
// judged day again in compare mode, from the day's saved evidence alone, and hands its blocks to
// time_review__recheck_day. Those blocks are saved whole as a `day_recheck` record. Each stored block
// the fresh judgment disagrees with goes back to flagged, its approval kept on the block as
// `superseded_review`. A stored block's matter, description, times, bases and evidence are never
// rewritten, and a block the fresh judgment agrees with is not touched, so its hash does not change.
// Nothing is written to TimeCamp.
//
// day_recheck:<YYYY-MM-DD>:<nnn>  one re-check: the fresh blocks as code would stage them, and the
//                                 stored blocks that differ with the reasons, as values in a list.

import { DataServerError, ValidationError } from "../errors.js";
import type { KvCheck, KvWrite } from "../kv/backend.js";
import { REVIEW_DATE_PREFIX, timePipelineApplyIf, timePipelineGet, timePipelineList } from "../time-pipeline/backend.js";
import { type ReviewDateSeams, reviewDateJudgment } from "../time-pipeline/review-date.js";
import { dayIsClear } from "./act.js";
import { checkBlock, type NewBlock } from "./tools.js";
import {
  BLOCK_PREFIX,
  type BlockRecord,
  NAMESPACE,
  blockKey,
  dayEvidenceKey,
  envOf,
  nowOf,
} from "./records.js";

export const DAY_RECHECK_PREFIX = "day_recheck:";
const ATTEMPTS = 5;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_BLOCKS = 999;

export interface Difference {
  block: string;
  /** Values: `matter_differs`, `times_differ`. */
  reasons: string[];
}

export interface DayRecheckRecord {
  kind: "day_recheck";
  id: string;
  date: string;
  rechecked_at: string;
  blocks: NewBlock[];
  differences: Difference[];
  /** Indexes into `blocks` of fresh blocks that match no live stored block. */
  unmatched: number[];
}

export type RecheckResult =
  | { status: "not_judged"; date: string }
  | { status: "no_blocks"; date: string }
  | { status: "evidence_missing"; date: string }
  | { status: "agreed"; date: string; recheck: string; unmatched: number[]; clear: boolean }
  | { status: "differs"; date: string; recheck: string; differing: Difference[]; flagged: string[]; unmatched: number[]; clear: boolean };

const recheckKey = (id: string): string => DAY_RECHECK_PREFIX + id;
const live = (b: BlockRecord): boolean => b.state !== "merged" && b.state !== "split";

/** Compare each live stored block with the fresh blocks that cover the same stretch. A block agrees
 * when a fresh block has its start and end and names its matter. */
export function differences(stored: BlockRecord[], fresh: NewBlock[]): { differing: Difference[]; unmatched: number[] } {
  const used = new Set<number>();
  const differing: Difference[] = [];
  for (const block of stored.filter(live)) {
    const sameTimes = fresh.findIndex((f) => f.start === block.start && f.end === block.end);
    if (sameTimes >= 0) {
      used.add(sameTimes);
      if (fresh[sameTimes].matter !== block.matter) differing.push({ block: block.id, reasons: ["matter_differs"] });
    } else {
      differing.push({ block: block.id, reasons: ["times_differ"] });
    }
  }
  const unmatched = fresh.map((_, i) => i).filter((i) => !used.has(i));
  return { differing, unmatched };
}

/** Save a fresh reviewer's blocks for a judged day as a `day_recheck` record and flag the stored
 * blocks that differ. One transaction: the stored blocks, the review-date record and the day's
 * evidence must still be the ones this call read, or it reads and decides again. */
export function timeReviewRecheckDay(dateIn: unknown, blocksIn: unknown, seams: ReviewDateSeams = {}): RecheckResult {
  const tool = "time_review__recheck_day";
  if (typeof dateIn !== "string" || !DATE.test(dateIn) || Number.isNaN(Date.parse(`${dateIn}T00:00:00Z`))) {
    throw new ValidationError(`${tool}: ${JSON.stringify(dateIn)} is not a date as YYYY-MM-DD`);
  }
  const date = dateIn;
  if (!Array.isArray(blocksIn)) throw new ValidationError(`${tool}: blocks must be a list`);
  if (blocksIn.length > MAX_BLOCKS) throw new ValidationError(`${tool}: at most ${MAX_BLOCKS} blocks a day`);
  const fresh = blocksIn.map((raw, i) => checkBlock(tool, i, raw));

  const env = envOf(seams);
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    if (!reviewDateJudgment(date, seams)) return { status: "not_judged", date };
    const evidence = timePipelineGet(NAMESPACE, dayEvidenceKey(date), env);
    if (evidence.value === null) return { status: "evidence_missing", date };
    const listed = timePipelineList(NAMESPACE, `${BLOCK_PREFIX}${date}:`, env).items;
    if (listed.length === 0) return { status: "no_blocks", date };
    const stored = listed.map((item) => JSON.parse(item.value) as BlockRecord);
    const record = timePipelineGet(NAMESPACE, REVIEW_DATE_PREFIX + date, env);

    const { differing, unmatched } = differences(stored, fresh);
    const priorRechecks = timePipelineList(NAMESPACE, `${DAY_RECHECK_PREFIX}${date}:`, env).items;
    const next = Math.max(0, ...priorRechecks.map((item) => Number(item.key.slice(-3)) || 0)) + 1;
    const id = `${date}:${String(next).padStart(3, "0")}`;
    const now = nowOf(seams).toISOString();
    const saved: DayRecheckRecord = { kind: "day_recheck", id, date, rechecked_at: now, blocks: fresh, differences: differing, unmatched };

    const writes: KvWrite[] = [{ op: "set", namespace: NAMESPACE, key: recheckKey(id), value: JSON.stringify(saved) }];
    const flagged: string[] = [];
    const after = new Map(stored.map((b) => [b.id, b]));
    for (const diff of differing) {
      const block = { ...(after.get(diff.block) as BlockRecord) };
      if (block.review) {
        block.superseded_review = block.review;
        delete block.review;
        delete block.timecamp;
      }
      block.state = "flagged";
      for (const reason of diff.reasons) {
        const flag = `recheck:${reason}`;
        if (!block.flags.includes(flag)) block.flags = [...block.flags, flag];
      }
      after.set(block.id, block);
      flagged.push(block.id);
      writes.push({ op: "set", namespace: NAMESPACE, key: blockKey(block.id), value: JSON.stringify(block) });
    }
    const checks: KvCheck[] = [
      { namespace: NAMESPACE, key: REVIEW_DATE_PREFIX + date, expect_sha256: record.sha256 as string },
      { namespace: NAMESPACE, key: dayEvidenceKey(date), expect_sha256: evidence.sha256 as string },
      ...listed.map((item): KvCheck => ({ namespace: NAMESPACE, key: item.key, expect_sha256: item.sha256 })),
      { namespace: NAMESPACE, key: recheckKey(id), expect_absent: true },
      ...priorRechecks.map((item): KvCheck => ({ namespace: NAMESPACE, key: item.key, expect_sha256: item.sha256 })),
    ];
    if ("stale" in timePipelineApplyIf(checks, writes, env)) continue;

    const clear = dayIsClear(date, [...after.values()], seams);
    if (differing.length === 0) return { status: "agreed", date, recheck: id, unmatched, clear };
    return { status: "differs", date, recheck: id, differing, flagged, unmatched, clear };
  }
  throw new DataServerError(`${tool}: ${date} changed ${ATTEMPTS} times while this call was comparing; nothing was written. Try again`, "contended");
}
