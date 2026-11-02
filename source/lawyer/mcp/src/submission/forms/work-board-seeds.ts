// The Work Board's loose threads: their shapes, their shared order and labels, and their reads.

import { fetchDeletedTickets, type FilingTitleRow } from "./work-board-reads.js";
import { liveSeedClause, liveTicketClause, seedClosedColumns } from "./query.js";
import { rows } from "../query-rows.js";
import { hasColumn } from "../schema-capabilities.js";

interface SeedRow {
  id: number;
  filing_id: number | null;
  origin_ticket_id: number | null;
  created: string;
  surfaced_by: string;
  idea: string;
  /** Schema v66; NULL on a database held below it. */
  rank: number | null;
  rank_group: RankGroup | null;
  rank_reason: string | null;
  /** Schema v70; NULL on a database held below it. */
  rank_job: string | null;
  /** Schema v68; NULL on a database held below it. */
  deferred_at: string | null;
}

export interface WorkBoardSeed {
  id: number;
  idea: string;
  surfaced_by: string;
  created: string;
  filing_id: number | null;
  origin_ticket_id: number | null;
  /** The title of the filing the loose thread was captured on; null when captured on none. */
  from_filing: string | null;
  /** The loose thread's place in the last ranking (schema v66), its group and the one-line reason;
   * all null while unranked, which is every loose thread on a database held below v66. */
  rank: number | null;
  rank_group: RankGroup | null;
  rank_reason: string | null;
  /** The job description the ranking restated the loose thread as (schema v70); null while unranked,
   * on a loose thread ranked before v70, and on every loose thread on a database held below v70. */
  rank_job: string | null;
  /** When the practitioner deferred the loose thread from the Loose Threads page (schema v68); null
   * when not deferred, which is every loose thread on a database held below v68. */
  deferred_at: string | null;
}

/** A ranked loose thread's group (schema v66), loose-thread triage's content groups. */
export type RankGroup = "decision" | "tooling" | "housekeeping" | "research" | "authority" | "evidence" | "other";

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

/** What makes a loose thread open, given its proceeding's deleted job ids: never outlined, or outlined
 * into a deleted job, and neither discarded nor suggested (schema v75; a database below it holds none
 * of either). fetchOpenSeeds reads with it and the Loose Threads page's Defer write guards with it. */
export function openSeedCondition(dbPath: string, deletedIds: ReadonlySet<number>): { sql: string; params: number[] } {
  const deletedList = [...deletedIds];
  const outlinedIntoDeleted = deletedList.length === 0 ? "" : ` OR charted_into IN (${deletedList.map(() => "?").join(",")})`;
  return { sql: `(charted_into IS NULL${outlinedIntoDeleted})${liveSeedClause(dbPath)}`, params: deletedList };
}

/** A loose thread that is not open: discarded, else suggested, else outlined into a job that is not deleted. */
export interface ResolvedSeed {
  id: number;
  idea: string;
  how: "discarded" | "suggested" | "job";
  /** `discarded_at`, `suggested_at`, or the job's `created`: `seeds` stores no time for the outlining,
   * and the job is created in the script that sets `charted_into`. */
  at: string;
  /** The job it was outlined into, and that job's title; null unless `how` is `job`. */
  job_id: number | null;
  job_title: string | null;
}

/** The proceeding's resolved loose threads, newest first, ties by id: the Loose Threads page's Resolved
 * section. A thread outlined into a deleted job is open again, so the join keeps live jobs only. A
 * database held below v75 lists its outlined threads. */
export function fetchResolvedSeeds(dbPath: string, proceedingId: number): ResolvedSeed[] {
  const closed = seedClosedColumns(dbPath);
  const column = (name: string): string => (closed.includes(name) ? `s.${name}` : `NULL AS ${name}`);
  const resolved = [...closed.map((name) => `s.${name} IS NOT NULL`), "t.id IS NOT NULL"].join(" OR ");
  return rows<{ id: number; idea: string; discarded_at: string | null; suggested_at: string | null; job_id: number | null; job_title: string | null; job_created: string | null }>(
    dbPath,
    `SELECT s.id, s.idea, ${column("discarded_at")}, ${column("suggested_at")}, t.id AS job_id, t.title AS job_title, t.created AS job_created
     FROM seeds s LEFT JOIN tickets t ON t.id = s.charted_into${liveTicketClause(dbPath, "t")}
     WHERE s.proceeding_id = ? AND (${resolved})`,
    [proceedingId]
  )
    .map((r): ResolvedSeed => {
      if (r.discarded_at !== null) return { id: r.id, idea: r.idea, how: "discarded", at: r.discarded_at, job_id: null, job_title: null };
      if (r.suggested_at !== null) return { id: r.id, idea: r.idea, how: "suggested", at: r.suggested_at, job_id: null, job_title: null };
      return { id: r.id, idea: r.idea, how: "job", at: r.job_created as string, job_id: r.job_id, job_title: r.job_title };
    })
    .sort((a, b) => (a.at === b.at ? a.id - b.id : a.at < b.at ? 1 : -1));
}

/** Every open loose thread in one proceeding, in id order: the board's and the Loose Threads page's one
 * set. A loose thread outlined into a deleted job shows again, and one captured from a deleted job names no origin job. */
export function fetchOpenSeeds(
  dbPath: string,
  proceedingId: number,
  deletedIds: ReadonlySet<number> = new Set(fetchDeletedTickets(dbPath, proceedingId).map((d) => d.id))
): Omit<WorkBoardSeed, "from_filing">[] {
  const open = openSeedCondition(dbPath, deletedIds);
  // The ranking (schema v66); a database below it holds every loose thread unranked.
  const ranking = hasColumn(dbPath, "seeds", "rank") ? "rank, rank_group, rank_reason" : "NULL AS rank, NULL AS rank_group, NULL AS rank_reason";
  // The job description (schema v70); a database below it holds none.
  const job = hasColumn(dbPath, "seeds", "rank_job") ? "rank_job" : "NULL AS rank_job";
  // The deferral (schema v68); a database below it holds no loose thread deferred.
  const deferral = hasColumn(dbPath, "seeds", "deferred_at") ? "deferred_at" : "NULL AS deferred_at";
  return rows<SeedRow>(
    dbPath,
    `SELECT id, filing_id, origin_ticket_id, created, surfaced_by, idea, ${ranking}, ${job}, ${deferral} FROM seeds WHERE ${open.sql} AND proceeding_id = ? ORDER BY id`,
    [...open.params, proceedingId]
  ).map((s) => ({
    id: s.id,
    idea: s.idea,
    surfaced_by: s.surfaced_by,
    created: s.created,
    filing_id: s.filing_id,
    origin_ticket_id: s.origin_ticket_id !== null && deletedIds.has(s.origin_ticket_id) ? null : s.origin_ticket_id,
    rank: s.rank,
    rank_group: s.rank_group,
    rank_reason: s.rank_reason,
    rank_job: s.rank_job,
    deferred_at: s.deferred_at,
  }));
}

/** Each loose thread with the title of the filing it was captured on, null when captured on none. */
export function withFromFiling(dbPath: string, proceedingId: number, seeds: readonly Omit<WorkBoardSeed, "from_filing">[]): WorkBoardSeed[] {
  const filingTitles = new Map(rows<FilingTitleRow>(dbPath, "SELECT id, title FROM filings WHERE proceeding_id = ?", [proceedingId]).map((f) => [f.id, f.title]));
  return seeds.map((s) => ({ ...s, from_filing: s.filing_id === null ? null : filingTitles.get(s.filing_id) ?? null }));
}
