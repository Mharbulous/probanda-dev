// loose_threads__capture, __read and __update: the only way a session reaches the store (./backend.ts).
// Capture takes a thread and answers with its id alone, so capturing mid-job brings no other thread
// into context. Read answers triage with the open set, and the duplicate test with matches only.
// Update is one read-modify-write under the drafting database's data lock.

import { ValidationError } from "../errors.js";
import { submissionDataQuery } from "../submission/backend.js";
import { acquireDataLock } from "../submission/lock.js";
import { type LooseThread, isOpenThread, RANK_GROUPS, type RankGroup, readThreads, THREAD_KINDS, threadStamp, type ThreadKind, writeThreads } from "./backend.js";
import { moveSeedsOnce } from "./migrate.js";

const isId = (v: unknown): v is number => Number.isInteger(v) && (v as number) > 0;
const isText = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

function check(ok: boolean, tool: string, field: string, why: string): void {
  if (!ok) throw new ValidationError(`loose_threads__${tool}.${field} ${why}`, `invalid_${field}`);
}

function count(dbPath: string, sql: string, params: unknown[]): number {
  return (submissionDataQuery(dbPath, sql, params).rows[0] as { n: number }).n;
}

/** Runs `write` with the store moved and the data lock held. */
async function locked<T>(dbPath: string, env: NodeJS.ProcessEnv, write: () => T): Promise<T> {
  await moveSeedsOnce(dbPath, env);
  const lock = await acquireDataLock(dbPath, env);
  try {
    return write();
  } finally {
    lock.release();
  }
}

/** The ids of the jobs deleted anywhere in the matter (jobs-closeout.md §10a). */
function deletedJobs(dbPath: string): Set<number> {
  return new Set((submissionDataQuery(dbPath, "SELECT id FROM tickets WHERE deleted_at IS NOT NULL").rows as unknown as { id: number }[]).map((r) => r.id));
}

export interface CaptureArgs {
  db_path: string;
  proceeding_id: number;
  filing_id?: number | null;
  origin_job?: number | null;
  surfaced_by: string;
  idea: string;
  kind?: ThreadKind;
  ref?: string;
}

/** loose_threads__capture. Returns the new id and nothing else. */
export async function looseThreadsCapture(args: CaptureArgs, env: NodeJS.ProcessEnv = process.env): Promise<{ id: number }> {
  const { db_path: dbPath, proceeding_id: proceedingId, surfaced_by: surfacedBy, idea, ref } = args;
  const filingId = args.filing_id ?? null;
  const originJob = args.origin_job ?? null;
  const kind = args.kind ?? "idea";
  check(isId(proceedingId) && count(dbPath, "SELECT COUNT(*) AS n FROM proceedings WHERE id = ?", [proceedingId]) === 1, "capture", "proceeding_id", "names no proceeding in this matter");
  check(filingId === null || (isId(filingId) && count(dbPath, "SELECT COUNT(*) AS n FROM filings WHERE id = ? AND proceeding_id = ?", [filingId, proceedingId]) === 1), "capture", "filing_id", "names no Writing or Work Board in that proceeding");
  check(originJob === null || (isId(originJob) && count(dbPath, "SELECT COUNT(*) AS n FROM tickets WHERE id = ?", [originJob]) === 1), "capture", "origin_job", "names no job");
  check(isText(idea), "capture", "idea", "must be the idea, verbatim");
  check(isText(surfacedBy), "capture", "surfaced_by", "must name what surfaced it");
  check(THREAD_KINDS.includes(kind), "capture", "kind", `must be one of ${THREAD_KINDS.join(", ")}`);
  check(ref === undefined || isText(ref), "capture", "ref", "must be a file path or a record id");
  return locked(dbPath, env, () => {
    const id = readThreads(dbPath, env).reduce((top, t) => Math.max(top, t.id), 0) + 1;
    writeThreads(dbPath, [{
      id, kind, idea, surfaced_by: surfacedBy, created: threadStamp(), proceeding_id: proceedingId, filing_id: filingId, origin_job: originJob,
      ...(ref === undefined ? {} : { ref }),
      charted_into: null, rank: null, rank_group: null, rank_reason: null, rank_job: null, deferred_at: null, discarded_at: null, suggested_at: null,
    }], env);
    return { id };
  });
}

export interface ReadArgs {
  db_path: string;
  /** triage: every open thread of the matter, in the page's order. duplicates: the open threads of one proceeding that `text` matches. */
  mode: "triage" | "duplicates";
  kind?: ThreadKind;
  proceeding_id?: number;
  text?: string;
}

const significant = (text: string) => new Set(text.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? []);

/** Half of the item's words of four letters or more appear in the thread: a thread is captured verbatim, so a restatement shares them. */
function restates(thread: LooseThread, words: Set<string>): boolean {
  const own = significant(`${thread.idea} ${thread.rank_job ?? ""}`);
  return words.size > 0 && [...words].filter((w) => own.has(w)).length * 2 >= words.size;
}

/** loose_threads__read. */
export async function looseThreadsRead(args: ReadArgs, env: NodeJS.ProcessEnv = process.env): Promise<{ threads: Partial<LooseThread>[] }> {
  check(args.mode === "triage" || args.mode === "duplicates", "read", "mode", "must be triage or duplicates");
  check(args.mode === "triage" || (isId(args.proceeding_id) && isText(args.text)), "read", "text", "and proceeding_id are required under duplicates");
  await moveSeedsOnce(args.db_path, env);
  const deleted = deletedJobs(args.db_path);
  const open = readThreads(args.db_path, env).filter((t) => isOpenThread(t, deleted) && (args.kind === undefined || t.kind === args.kind));
  if (args.mode === "duplicates") {
    const words = significant(args.text as string);
    return { threads: open.filter((t) => t.proceeding_id === args.proceeding_id && restates(t, words)).map((t) => ({ id: t.id, idea: t.idea })) };
  }
  const ranked = [...open].sort((a, b) => (a.rank === null ? 1 : 0) - (b.rank === null ? 1 : 0) || (a.rank ?? 0) - (b.rank ?? 0) || a.id - b.id);
  return { threads: ranked };
}

export interface RankEntry {
  id: number;
  rank: number;
  group: RankGroup;
  job: string;
  reason: string;
}

export interface UpdateArgs {
  db_path: string;
  action: "rank" | "correct" | "defer" | "undefer" | "discard" | "restore" | "consume" | "move";
  /** The thread acted on: correct, defer, undefer, restore, consume. */
  id?: number;
  /** The threads acted on: discard. */
  ids?: number[];
  /** move: the Writing or Work Board whose open threads move. */
  from_filing_id?: number;
  /** rank: every thread's job description, rank, group and reason, in one write. */
  ranks?: RankEntry[];
  /** correct: the description the thread should carry. */
  job?: string;
  /** consume: the job the thread was outlined into. */
  job_id?: number;
  /** move: the Writing or Work Board the threads move to, or null for the proceeding. */
  filing_id?: number | null;
}

export interface UpdateResult {
  updated: number[];
  /** rank: the open, undeferred ideas still lacking a rank or description, which a whole ranking leaves at 0. */
  unranked_open?: number;
}

function found(threads: LooseThread[], id: unknown, tool = "update"): LooseThread {
  const thread = threads.find((t) => t.id === id);
  check(thread !== undefined, tool, "id", `${String(id)} names no loose thread`);
  return thread as LooseThread;
}

/** loose_threads__update. A refusal writes nothing. */
export async function looseThreadsUpdate(args: UpdateArgs, env: NodeJS.ProcessEnv = process.env): Promise<UpdateResult> {
  const dbPath = args.db_path;
  return locked(dbPath, env, (): UpdateResult => {
    const threads = readThreads(dbPath, env);
    const deleted = deletedJobs(dbPath);
    const save = (changed: LooseThread[]): UpdateResult => {
      if (changed.length > 0) writeThreads(dbPath, changed, env);
      return { updated: changed.map((t) => t.id) };
    };
    const one = () => found(threads, args.id);
    switch (args.action) {
      case "rank": {
        const ranks = args.ranks;
        check(Array.isArray(ranks) && ranks.length > 0, "update", "ranks", "must list every thread ranked");
        const changed = (ranks as RankEntry[]).map((r) => {
          const t = found(threads, r?.id);
          check(t.kind === "idea", "update", "ranks", `thread ${t.id} is not an idea, and only ideas are ranked`);
          check(isOpenThread(t, deleted), "update", "ranks", `thread ${t.id} is not open`);
          check(Number.isInteger(r.rank) && r.rank >= 1, "update", "ranks", "each rank must be 1 or more");
          check(RANK_GROUPS.includes(r.group), "update", "ranks", `each group must be one of ${RANK_GROUPS.join(", ")}`);
          check(isText(r.job) && isText(r.reason), "update", "ranks", "each needs a job description and a reason");
          t.rank = r.rank;
          t.rank_group = r.group;
          t.rank_job = r.job;
          t.rank_reason = r.reason;
          return t;
        });
        const result = save(changed);
        const lacking = threads.filter((t) => t.kind === "idea" && isOpenThread(t, deleted) && t.deferred_at === null && (t.rank === null || t.rank_job === null));
        return { ...result, unranked_open: lacking.length };
      }
      case "correct": {
        const t = one();
        check(t.rank !== null, "update", "id", `thread ${t.id} is not ranked, so it has no description to correct`);
        check(isText(args.job), "update", "job", "must be the description in the practitioner's words");
        t.rank_job = args.job as string;
        return save([t]);
      }
      case "defer":
      case "undefer": {
        const t = one();
        check(isOpenThread(t, deleted), "update", "id", `thread ${t.id} is not open`);
        if ((t.deferred_at !== null) === (args.action === "defer")) return save([]);
        t.deferred_at = args.action === "defer" ? threadStamp() : null;
        return save([t]);
      }
      case "discard": {
        check(Array.isArray(args.ids) && args.ids.length > 0, "update", "ids", "must name every thread discarded");
        const stamp = threadStamp();
        return save((args.ids as number[]).map((id) => found(threads, id)).filter((t) => t.discarded_at === null).map((t) => ({ ...t, discarded_at: stamp })));
      }
      case "restore": {
        const t = one();
        if (t.discarded_at === null) return save([]);
        t.discarded_at = null;
        return save([t]);
      }
      case "consume": {
        const t = one();
        check(isId(args.job_id) && count(dbPath, "SELECT COUNT(*) AS n FROM tickets WHERE id = ?", [args.job_id]) === 1, "update", "job_id", "names no job");
        t.charted_into = args.job_id as number;
        return save([t]);
      }
      case "move": {
        check(isId(args.from_filing_id), "update", "from_filing_id", "must name the board the threads move from");
        const target = args.filing_id ?? null;
        check(count(dbPath, "SELECT COUNT(*) AS n FROM tickets WHERE filing_id = ? AND status = 'wip'", [args.from_filing_id]) === 0, "update", "from_filing_id", "names a board with a job in progress");
        const moving = threads.filter((t) => t.filing_id === args.from_filing_id && isOpenThread(t, deleted));
        for (const t of moving) {
          check(target === null || count(dbPath, "SELECT COUNT(*) AS n FROM filings WHERE id = ? AND proceeding_id = ? AND retired_on IS NULL", [target, t.proceeding_id]) === 1, "update", "filing_id", "names no live Writing or Work Board in the threads' proceeding");
        }
        return save(moving.map((t) => ({ ...t, filing_id: target })));
      }
      default:
        throw new ValidationError(`loose_threads__update.action must be one of rank, correct, defer, undefer, discard, restore, consume, move`, "invalid_action");
    }
  });
}

/** Repoints the matter's threads from the absorbed boards' filings to the survivor's: same proceeding only, since a filing_id names a board in its thread's proceeding. */
export function repointThreads(dbPath: string, from: ReadonlySet<number>, to: { filing_id: number; proceeding_id: number }, env: NodeJS.ProcessEnv = process.env): number {
  const moving = readThreads(dbPath, env).filter((t) => t.filing_id !== null && from.has(t.filing_id) && t.proceeding_id === to.proceeding_id);
  if (moving.length > 0) writeThreads(dbPath, moving.map((t) => ({ ...t, filing_id: to.filing_id })), env);
  return moving.length;
}
