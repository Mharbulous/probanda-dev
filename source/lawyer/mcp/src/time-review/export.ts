// The blocks of a range of days, written to a file for /vet-billable-time's blocks_export.py (build
// plan slice 11). The reviewed blocks reach the bill's tie-out through this file, never through a
// model: the file holds each day's blocks as time_review__read_day returns them, without the evidence
// rows and readings, which the bill does not need and which can be long.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { ValidationError } from "../errors.js";
import type { ReviewDateSeams } from "../time-pipeline/review-date.js";
import { timePipelineList, valueSha256 } from "../time-pipeline/backend.js";
import { dayIsClear } from "./act.js";
import { BLOCK_PREFIX, type BlockRecord, NAMESPACE, envOf } from "./records.js";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** More than a year of days in one export is a mistake in the range, not a bill. */
const MAX_DAYS = 400;

function checkDate(tool: string, value: unknown): string {
  if (typeof value !== "string" || !DATE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new ValidationError(`${tool}: ${JSON.stringify(value)} is not a date as YYYY-MM-DD`);
  }
  return value;
}

export interface ExportedDay {
  date: string;
  clear: boolean;
  blocks: BlockRecord[];
}

/** Every date from `from` to `to` that has a staged block, with its blocks and whether it is clear.
 * A date with no block is left out: the reader treats a date missing from the file as not judged. */
export function timeReviewExportBlocks(
  fromIn: unknown,
  toIn: unknown,
  outPath: unknown,
  seams: ReviewDateSeams = {}
): { path: string; days: number; blocks: number; sha256: string } {
  const tool = "time_review__export_blocks";
  const from = checkDate(tool, fromIn);
  const to = checkDate(tool, toIn);
  if (from > to) throw new ValidationError(`${tool}: from ${from} is after to ${to}`);
  if (typeof outPath !== "string" || outPath.trim() === "") throw new ValidationError(`${tool}: out_path must be an absolute path`);

  const span = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / (24 * 60 * 60 * 1000) + 1;
  if (span > MAX_DAYS) throw new ValidationError(`${tool}: at most ${MAX_DAYS} days in one export`);

  // One read of every block, grouped by date: a read per calendar day would cost a query each.
  const all = timePipelineList(NAMESPACE, BLOCK_PREFIX, envOf(seams)).items.map((item) => JSON.parse(item.value) as BlockRecord);
  const byDate = new Map<string, BlockRecord[]>();
  for (const block of all) {
    if (block.date < from || block.date > to) continue;
    byDate.set(block.date, [...(byDate.get(block.date) ?? []), block]);
  }
  const days: ExportedDay[] = [...byDate.keys()].sort().map((date) => {
    const blocks = (byDate.get(date) as BlockRecord[]).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return { date, clear: dayIsClear(date, blocks, seams), blocks };
  });
  const text = JSON.stringify({ from, to, days }, null, 2) + "\n";
  const path = resolve(outPath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, "utf-8");
  return { path, days: days.length, blocks: days.reduce((n, d) => n + d.blocks.length, 0), sha256: valueSha256(text) };
}
