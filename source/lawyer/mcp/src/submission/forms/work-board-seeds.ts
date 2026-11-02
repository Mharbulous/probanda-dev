// The Work Board's loose threads: their shapes, their shared order and labels, and their reads.

import { isOpenThread, type LooseThread, type RankGroup, readThreads, type ThreadKind } from "../../loose-threads/backend.js";
import { fetchDeletedTickets, type FilingTitleRow } from "./work-board-reads.js";
import { liveTicketClause } from "./query.js";
import { rows } from "../query-rows.js";

export type { RankGroup };

export interface WorkBoardSeed {
  id: number;
  idea: string;
  surfaced_by: string;
  created: string;
  filing_id: number | null;
  origin_ticket_id: number | null;
  /** The title of the filing the loose thread was captured on; null when captured on none. */
  from_filing: string | null;
  /** The loose thread's place in the last ranking, its group and the one-line reason; all null while unranked. */
  rank: number | null;
  rank_group: RankGroup | null;
  rank_reason: string | null;
  /** The job description the ranking restated the loose thread as; null while unranked. */
  rank_job: string | null;
  /** When the practitioner deferred the loose thread from the Loose Threads page; null when not deferred. */
  deferred_at: string | null;
}

/** The Loose Threads page's order: the ranked by rank (ties by id), then the unranked by id. */
export function inRankOrder<T extends { id: number; rank: number | null }>(seeds: readonly T[]): T[] {
  return [...seeds].sort((a, b) => (a.rank === null ? 1 : 0) - (b.rank === null ? 1 : 0) || (a.rank ?? 0) - (b.rank ?? 0) || a.id - b.id);
}

/** Where a loose thread came from, as the Loose Threads page prints it: its origin
 * job, on a sibling filing when it was captured there, or the sibling filing alone; null for neither. */
export function seedOrigin(s: Pick<WorkBoardSeed, "origin_ticket_id" | "from_filing">): string | null {
  if (s.origin_ticket_id !== null) return `from Job #${s.origin_ticket_id}${s.from_filing === null ? "" : ` on ${s.from_filing}`}`;
  return s.from_filing === null ? null : `from ${s.from_filing}`;
}

/** A loose thread that is not open: discarded, else suggested, else outlined into a job that is not deleted. */
export interface ResolvedSeed {
  id: number;
  idea: string;
  how: "discarded" | "suggested" | "job";
  /** The thread's kind, which the page sorts it under. */
  kind: ThreadKind;
  /** `discarded_at`, `suggested_at`, or the job's `created`: the store holds no time for the outlining,
   * and the job is created just before `charted_into` is set. */
  at: string;
  /** The job it was outlined into, and that job's title; null unless `how` is `job`. */
  job_id: number | null;
  job_title: string | null;
}

/** The proceeding's resolved loose threads, newest first, ties by id: the Loose Threads page's Resolved
 * section. A thread outlined into a deleted job is open again, so only live jobs count. */
export function fetchResolvedSeeds(dbPath: string, proceedingId: number): ResolvedSeed[] {
  const jobs = new Map(rows<{ id: number; title: string; created: string }>(dbPath, `SELECT id, title, created FROM tickets WHERE 1 = 1${liveTicketClause(dbPath)}`).map((j) => [j.id, j]));
  return readThreads(dbPath)
    .filter((t) => t.proceeding_id === proceedingId)
    .flatMap((t): ResolvedSeed[] => {
      const base = { id: t.id, idea: t.idea, kind: t.kind };
      if (t.discarded_at !== null) return [{ ...base, how: "discarded", at: t.discarded_at, job_id: null, job_title: null }];
      if (t.suggested_at !== null) return [{ ...base, how: "suggested", at: t.suggested_at, job_id: null, job_title: null }];
      const job = t.charted_into === null ? undefined : jobs.get(t.charted_into);
      return job === undefined ? [] : [{ ...base, how: "job", at: job.created, job_id: job.id, job_title: job.title }];
    })
    .sort((a, b) => (a.at === b.at ? a.id - b.id : a.at < b.at ? 1 : -1));
}

/** Every open loose thread in one proceeding, in id order, in the store's own shape. */
export function fetchOpenThreads(dbPath: string, proceedingId: number, deletedIds: ReadonlySet<number>): LooseThread[] {
  return readThreads(dbPath).filter((t) => t.proceeding_id === proceedingId && isOpenThread(t, deletedIds));
}

/** Every open loose thread in one proceeding, in id order: the board's and the Loose Threads page's one
 * set. A loose thread outlined into a deleted job shows again, and one captured from a deleted job names no origin job. */
export function fetchOpenSeeds(
  dbPath: string,
  proceedingId: number,
  deletedIds: ReadonlySet<number> = new Set(fetchDeletedTickets(dbPath, proceedingId).map((d) => d.id))
): Omit<WorkBoardSeed, "from_filing">[] {
  return fetchOpenThreads(dbPath, proceedingId, deletedIds).map((s) => ({
    id: s.id,
    idea: s.idea,
    surfaced_by: s.surfaced_by,
    created: s.created,
    filing_id: s.filing_id,
    origin_ticket_id: s.origin_job !== null && deletedIds.has(s.origin_job) ? null : s.origin_job,
    rank: s.rank,
    rank_group: s.rank_group,
    rank_reason: s.rank_reason,
    rank_job: s.rank_job,
    deferred_at: s.deferred_at,
  }));
}

/** Each loose thread with the title of the filing it was captured on, null when captured on none. */
export function withFromFiling<T extends { filing_id: number | null }>(dbPath: string, proceedingId: number, seeds: readonly T[]): (T & { from_filing: string | null })[] {
  const filingTitles = new Map(rows<FilingTitleRow>(dbPath, "SELECT id, title FROM filings WHERE proceeding_id = ?", [proceedingId]).map((f) => [f.id, f.title]));
  return seeds.map((s) => ({ ...s, from_filing: s.filing_id === null ? null : filingTitles.get(s.filing_id) ?? null }));
}
