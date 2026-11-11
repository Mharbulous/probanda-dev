// Per-date review records for billing's `timekeeping` server (issue 284, decision tickets 279, 280
// and 282). One record per date, key `review_date:<YYYY-MM-DD>` in namespace `item`, value
// {kind, date, judged_at, judged_by, claim: {token, holder, claimed_at, expires_at}}. Status is
// derived from the value, never stored: judged_at set means judged, else a claim whose expires_at
// is in the future means in progress, else not started.
//
// Each change reads the record, decides, and writes only if the record is still the one read
// (timePipelineWriteIf). A write that loses the race reads again and decides again, so the claim
// rules live here while the store keeps one atomic compare-and-write.

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { DataServerError, ValidationError } from "../errors.js";
import { fingerprintForJudge } from "../time-review/fingerprint.js";
import { BLOCK_PREFIX } from "../time-review/records.js";
import {
  REVIEW_DATE_NAMESPACE,
  REVIEW_DATE_PREFIX,
  timePipelineGet,
  timePipelineList,
  timePipelineWriteIf,
  valueSha256,
} from "./backend.js";

/** A claim lasts this long, and a renew sets a full claim again (ticket 280). */
export const CLAIM_MS = 60 * 60 * 1000;
/** Lost races before a change gives up; each is another run writing the same date at that moment. */
const MAX_ATTEMPTS = 5;

/** Test seams. Dispatch passes neither: the clock is the real one and env is process.env. */
export interface ReviewDateSeams {
  now?: () => Date;
  env?: NodeJS.ProcessEnv;
}

interface Claim {
  token: string;
  holder: string;
  claimed_at: string;
  expires_at: string;
}

interface ReviewDateRecord {
  kind: "review_date";
  date: string;
  judged_at: string | null;
  judged_by: string | null;
  claim: Claim | null;
  [field: string]: unknown;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function checkDate(tool: string, date: unknown): string {
  if (typeof date !== "string" || !DATE.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    throw new ValidationError(`${tool}: ${JSON.stringify(date)} is not a date as YYYY-MM-DD`);
  }
  return date;
}

function nowOf(seams: ReviewDateSeams): Date {
  return seams.now ? seams.now() : new Date();
}

function envOf(seams: ReviewDateSeams): NodeJS.ProcessEnv {
  return seams.env ?? process.env;
}

/** The stored record and the hash a write names, or null for a date never recorded. */
function read(date: string, seams: ReviewDateSeams): { record: ReviewDateRecord; sha256: string } | null {
  const { value, sha256 } = timePipelineGet(REVIEW_DATE_NAMESPACE, REVIEW_DATE_PREFIX + date, envOf(seams));
  if (value === null || sha256 === null) return null;
  return { record: JSON.parse(value) as ReviewDateRecord, sha256 };
}

function blank(date: string): ReviewDateRecord {
  return { kind: "review_date", date, judged_at: null, judged_by: null, claim: null };
}

function isLive(claim: Claim | null, now: Date): claim is Claim {
  return claim !== null && Date.parse(claim.expires_at) > now.getTime();
}

/** Read, decide, write-if-unchanged; on a lost race, read and decide again. `decide` returns the
 * record to write and the result to give, or a result alone when nothing is to be written. */
function change<R>(
  tool: string,
  date: string,
  seams: ReviewDateSeams,
  decide: (current: ReviewDateRecord | null) => { write?: ReviewDateRecord; result: R }
): R {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const current = read(date, seams);
    const { write, result } = decide(current?.record ?? null);
    if (write === undefined) return result;
    const expectation = current ? { expect_sha256: current.sha256 } : { expect_absent: true };
    const reply = timePipelineWriteIf(REVIEW_DATE_NAMESPACE, REVIEW_DATE_PREFIX + date, JSON.stringify(write), expectation, envOf(seams));
    if (!("stale" in reply)) return result;
  }
  throw new DataServerError(`${tool}: ${date} changed ${MAX_ATTEMPTS} times while this call was deciding; nothing was written. Try again`, "contended");
}

export type ClaimResult =
  | { status: "claimed"; date: string; token: string; expires_at: string }
  | { status: "judged"; date: string; judged_at: string; judged_by: string | null }
  | { status: "held"; date: string; holder: string; expires_at: string };

export function reviewDateClaim(dateIn: unknown, holder: string, seams: ReviewDateSeams = {}): ClaimResult {
  const date = checkDate("review_date__claim", dateIn);
  if (holder.trim() === "") throw new ValidationError("review_date__claim: holder must name the bill or the run");
  return change<ClaimResult>("review_date__claim", date, seams, (current) => {
    const now = nowOf(seams);
    if (current?.judged_at) return { result: { status: "judged", date, judged_at: current.judged_at, judged_by: current.judged_by } };
    if (current && isLive(current.claim, now)) {
      return { result: { status: "held", date, holder: current.claim.holder, expires_at: current.claim.expires_at } };
    }
    const claim: Claim = {
      token: randomUUID(),
      holder,
      claimed_at: now.toISOString(),
      expires_at: new Date(now.getTime() + CLAIM_MS).toISOString(),
    };
    return {
      write: { ...(current ?? blank(date)), claim },
      result: { status: "claimed", date, token: claim.token, expires_at: claim.expires_at },
    };
  });
}

export type RejudgeResult =
  | { status: "claimed"; date: string; token: string; expires_at: string }
  | { status: "not_judged"; date: string }
  | { status: "has_blocks"; date: string; blocks: number }
  | { status: "held"; date: string; holder: string; expires_at: string };

/** Open a date judged before the review page existed (in chat, so with no staged block) for one more
 * judgment, which builds its blocks (build plan slice 11). Refused for a date that is not judged
 * (claim it) and for any date that has a block, so a staged day is never staged twice. The earlier
 * judgment stays on the record as `rejudged_from`. Returns a claim, as review_date__claim does. */
export function reviewDateRejudge(dateIn: unknown, holder: string, seams: ReviewDateSeams = {}): RejudgeResult {
  const date = checkDate("review_date__rejudge", dateIn);
  if (holder.trim() === "") throw new ValidationError("review_date__rejudge: holder must name the bill or the run");
  return change<RejudgeResult>("review_date__rejudge", date, seams, (current) => {
    const now = nowOf(seams);
    if (!current?.judged_at) return { result: { status: "not_judged", date } };
    const staged = timePipelineList(REVIEW_DATE_NAMESPACE, `${BLOCK_PREFIX}${date}:`, envOf(seams)).items.length;
    if (staged > 0) return { result: { status: "has_blocks", date, blocks: staged } };
    if (isLive(current.claim, now)) {
      return { result: { status: "held", date, holder: current.claim.holder, expires_at: current.claim.expires_at } };
    }
    const claim: Claim = {
      token: randomUUID(),
      holder,
      claimed_at: now.toISOString(),
      expires_at: new Date(now.getTime() + CLAIM_MS).toISOString(),
    };
    const { fingerprint: _old, ...rest } = current;
    return {
      write: { ...rest, judged_at: null, judged_by: null, claim, rejudged_from: { judged_at: current.judged_at, judged_by: current.judged_by } },
      result: { status: "claimed", date, token: claim.token, expires_at: claim.expires_at },
    };
  });
}

type ClaimLost = { status: "claim_lost"; date: string };
export type RenewResult = { status: "renewed"; date: string; expires_at: string } | ClaimLost;
export type JudgeResult = { status: "judged"; date: string; judged_at: string; judged_by: string } | ClaimLost;
export type ReleaseResult = { status: "released"; date: string } | ClaimLost;

/** The stored claim when it is still this token's, lapsed or not; else null. */
function ownClaim(current: ReviewDateRecord | null, token: string): Claim | null {
  if (!current || current.judged_at || !current.claim || current.claim.token !== token) return null;
  return current.claim;
}

export function reviewDateRenew(
  dateIn: unknown,
  token: string,
  seams: ReviewDateSeams = {}
): RenewResult {
  const date = checkDate("review_date__renew", dateIn);
  return change<RenewResult>("review_date__renew", date, seams, (current) => {
    const claim = ownClaim(current, token);
    if (!claim || !current) return { result: { status: "claim_lost", date } };
    const expires_at = new Date(nowOf(seams).getTime() + CLAIM_MS).toISOString();
    return { write: { ...current, claim: { ...claim, expires_at } }, result: { status: "renewed", date, expires_at } };
  });
}

export function reviewDateJudge(
  dateIn: unknown,
  token: string,
  seams: ReviewDateSeams = {}
): JudgeResult {
  const date = checkDate("review_date__judge", dateIn);
  return change<JudgeResult>("review_date__judge", date, seams, (current) => {
    const claim = ownClaim(current, token);
    if (!claim || !current) return { result: { status: "claim_lost", date } };
    const judged_at = nowOf(seams).toISOString();
    // The day's TimeCamp entries as judged, saved as one field of this record so an older copy
    // reads and rewrites the record unchanged (time_review__compare_day reads it on resume).
    const fingerprint = fingerprintForJudge(date, seams);
    return {
      write: { ...current, judged_at, judged_by: claim.holder, claim: null, ...(fingerprint ? { fingerprint } : {}) },
      result: { status: "judged", date, judged_at, judged_by: claim.holder },
    };
  });
}

export function reviewDateRelease(
  dateIn: unknown,
  token: string,
  seams: ReviewDateSeams = {}
): ReleaseResult {
  const date = checkDate("review_date__release", dateIn);
  return change<ReleaseResult>("review_date__release", date, seams, (current) => {
    if (!ownClaim(current, token) || !current) return { result: { status: "claim_lost", date } };
    return { write: { ...current, claim: null }, result: { status: "released", date } };
  });
}

export type DateStatus =
  | { date: string; status: "not_started" }
  | { date: string; status: "in_progress"; holder: string; expires_at: string }
  | { date: string; status: "judged"; judged_at: string; judged_by: string | null };

function statusOf(date: string, record: ReviewDateRecord | null, now: Date): DateStatus {
  if (record?.judged_at) return { date, status: "judged", judged_at: record.judged_at, judged_by: record.judged_by };
  if (record && isLive(record.claim, now)) return { date, status: "in_progress", holder: record.claim.holder, expires_at: record.claim.expires_at };
  return { date, status: "not_started" };
}

export function reviewDateStatus(dates: unknown, seams: ReviewDateSeams = {}): { dates: DateStatus[] } {
  if (!Array.isArray(dates)) throw new ValidationError("review_date__status: dates must be a list of YYYY-MM-DD dates");
  const checked = dates.map((d) => checkDate("review_date__status", d));
  const records = judgedOrClaimed(seams);
  const now = nowOf(seams);
  return { dates: checked.map((date) => statusOf(date, records.get(date) ?? null, now)) };
}

export type StageGate =
  | { ok: true; record_sha256: string | null }
  | { ok: false; record_sha256?: undefined; status: "judged"; judged_at: string; judged_by: string | null }
  | { ok: false; record_sha256?: undefined; status: "held"; holder: string; expires_at: string }
  | { ok: false; record_sha256?: undefined; status: "claim_lost" };

/** Whether the run holding `token` may put blocks on `date` (time_review__stage_day). Writes
 * nothing. An `ok` answer carries the hash of the record it read, which the write names. A judged date is refused first. The token's own claim passes even after it lapsed, as
 * judge does, if no other run has claimed the date since. A live claim of another run is `held`;
 * no claim at all, or a lapsed one that is not this token's, is `claim_lost`. */
export function reviewDateStageGate(dateIn: unknown, token: string, seams: ReviewDateSeams = {}): StageGate {
  const date = checkDate("time_review__stage_day", dateIn);
  const stored = read(date, seams);
  const current = stored?.record ?? null;
  if (current?.judged_at) return { ok: false, status: "judged", judged_at: current.judged_at, judged_by: current.judged_by };
  if (ownClaim(current, token)) return { ok: true, record_sha256: stored?.sha256 ?? null };
  if (current && isLive(current.claim, nowOf(seams))) {
    return { ok: false, status: "held", holder: current.claim.holder, expires_at: current.claim.expires_at };
  }
  return { ok: false, status: "claim_lost" };
}

/** When and by whom a date was judged, or null if it is not judged. */
export function reviewDateJudgment(date: string, seams: ReviewDateSeams = {}): { judged_at: string; judged_by: string | null } | null {
  const current = read(date, seams)?.record ?? null;
  return current?.judged_at ? { judged_at: current.judged_at, judged_by: current.judged_by } : null;
}

/** Every review-date record, by date, in one read. */
function judgedOrClaimed(seams: ReviewDateSeams): Map<string, ReviewDateRecord> {
  const { items } = timePipelineList(REVIEW_DATE_NAMESPACE, REVIEW_DATE_PREFIX, envOf(seams));
  return new Map(items.map((item) => [item.key.slice(REVIEW_DATE_PREFIX.length), JSON.parse(item.value) as ReviewDateRecord]));
}

/** The judged dates from `from` to `to`, one line each, `{"date", "judged_at"}`: the file
 * vet-billable-time's tie_out.py reads as --judged. The file is rewritten whole. */
export function reviewDateExport(
  fromIn: unknown,
  toIn: unknown,
  outPath: string,
  seams: ReviewDateSeams = {}
): { path: string; count: number; sha256: string } {
  const from = checkDate("review_date__export", fromIn);
  const to = checkDate("review_date__export", toIn);
  if (from > to) throw new ValidationError(`review_date__export: from ${from} is after to ${to}`);
  const lines = [...judgedOrClaimed(seams).values()]
    .filter((r) => r.judged_at && r.date >= from && r.date <= to)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .map((r) => JSON.stringify({ date: r.date, judged_at: r.judged_at }) + "\n");
  const text = lines.join("");
  const path = resolve(outPath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, "utf-8");
  return { path, count: lines.length, sha256: valueSha256(text) };
}

/** One-time move of a matter's judged-dates.jsonl marks into the store. The file is never changed. */
export function reviewDateImportFile(
  path: string,
  judgedBy: string,
  dryRun: boolean,
  seams: ReviewDateSeams = {}
): { dry_run: boolean; added: string[]; skipped: string[] } {
  if (judgedBy.trim() === "") throw new ValidationError("review_date__import_file: judged_by must name who judged the dates");
  if (!existsSync(path)) throw new ValidationError(`review_date__import_file: ${path} not found`);
  const marks = new Map<string, string | null>();
  readFileSync(path, "utf-8").split(/\r?\n/).forEach((raw, index) => {
    if (raw.trim() === "") return;
    let line: { date?: unknown; judged_at?: unknown };
    try {
      line = JSON.parse(raw) as typeof line;
    } catch {
      throw new ValidationError(`review_date__import_file: line ${index + 1} of ${path} is not JSON; nothing was written`);
    }
    const date = checkDate(`review_date__import_file (line ${index + 1})`, line.date);
    if (!marks.has(date)) marks.set(date, typeof line.judged_at === "string" ? line.judged_at : null);
  });
  const stored = judgedOrClaimed(seams);
  const added: string[] = [];
  const skipped: string[] = [];
  for (const date of [...marks.keys()].sort()) {
    if (stored.get(date)?.judged_at) skipped.push(date);
    else added.push(date);
  }
  if (dryRun) return { dry_run: true, added, skipped };
  const written: string[] = [];
  for (const date of added) {
    const marked = change("review_date__import_file", date, seams, (current) => {
      if (current?.judged_at) return { result: false };
      const judged_at = marks.get(date) ?? nowOf(seams).toISOString();
      return { write: { ...(current ?? blank(date)), judged_at, judged_by: judgedBy, claim: null }, result: true };
    });
    if (marked) written.push(date);
    else skipped.push(date);
  }
  return { dry_run: false, added: written, skipped: skipped.sort() };
}
