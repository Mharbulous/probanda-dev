// drafting_data__create_job: one call creates a job (a tickets row) with its steps, scope, blocking
// edges, conflict pairs and conversion records (ticket_proposals), under the duplicate guard its kind
// takes, in one transaction, then consumes its loose thread, which lives in another file, so a failed
// second write is reported in the result. Each guard is the condition /drafting-data
// documents for that kind of job (jobs-create.md §3, §3e, §3f; jobs-stock.md §3c, §3d, §3g). It is
// tested in the job's own INSERT ... SELECT ... WHERE, before the row exists, so a guard can never
// match the job it guards, and a guarded call writes nothing and names the job that blocked it. The
// job tables carry no revision triggers.

import { DataServerError, ValidationError } from "../../errors.js";
import { readThreads } from "../../loose-threads/backend.js";
import { moveSeedsOnce } from "../../loose-threads/migrate.js";
import { looseThreadsUpdate } from "../../loose-threads/tools.js";
import { submissionDataQuery, submissionDataWriteAll, type WriteStatement } from "../backend.js";
import { BRIEF_JOB_PREFIX, citationKey } from "./brief-job.js";
import { createdByHeld, liveTicketClause, MILESTONE_KIND } from "./query.js";
import { checkClaim, heldBy } from "./job-activity.js";
import { isResearchTitle, RESEARCH_JOB_PREFIX, researchFormProblems } from "./research-job.js";
import { nowMinuteSql } from "./timings.js";

const TOOL = "drafting_data__create_job";

export type CreateJobGuard =
  | "none"
  | "live_key"
  | "never_held_key"
  | "title_live_with_step"
  | "title_and_step_any_status"
  | "scrutiny_statement"
  | "authority_brief"
  | "research_title"
  | "holder_lock";

export interface ScopeRow {
  entity: string;
  /** NULL covers the whole table within the job's filing or proceeding. */
  entity_id: number | null;
}

export interface ProposalKey {
  /** The key as the card printed it, character for character. */
  key: string;
  /** That key's item as the card printed it, without any count. */
  item: string;
}

/** A further job written in the same transaction under the same guard: §3c's review job. */
export interface Companion {
  title: string;
  intent: string;
  steps: string[];
  scope?: ScopeRow[];
  /** Write a ticket_blocks edge from the lead job to this one. */
  blocked_by_lead?: boolean;
}

export interface CreateJobArgs {
  db_path: string;
  proceeding_id: number;
  /** The Writing's or Work Board's id, or null for a proceeding-scoped job. Never left out. */
  filing_id: number | null;
  title: string;
  intent: string;
  kind: "work" | "charting";
  /** An integer, or `top`/`bottom` to run §3's priority read inside the write. */
  priority: number | "top" | "bottom";
  billing_anchor?: string;
  steps: string[];
  scope?: ScopeRow[];
  /** Existing jobs this one waits on: each is a ticket_blocks blocker_id, this job the blocked_id. */
  blocks?: number[];
  /** Existing jobs this one conflicts with, written in the CHECK's order. */
  conflicts?: number[];
  proposal_keys?: ProposalKey[];
  /** A loose thread this job consumes (its charted_into in the loose-thread store). */
  seed_id?: number;
  /** tickets.created_by (schema v72): this session's token, written only by the creates that say so. */
  created_by?: string;
  guard: CreateJobGuard;
  /** holder_lock only: the holding session's token. */
  session_token?: string;
  /** holder_lock only: the job this session holds, whose scope the new job copies. */
  held_ticket_id?: number;
  /** holder_lock only: the claim_no this session's drafting_data__assign_job returned for the held job. */
  claim_no?: number;
  /** title_live_with_step only: §3c's review job, written after the lead. */
  companions?: Companion[];
}

export interface CreateJobResult {
  outcome: "created" | "guarded";
  ticket_id?: number;
  companion_ids?: number[];
  /** The priority written, so a batch can give the rest of its jobs the first job's value. */
  priority?: number;
  /** The job whose existence fired the guard, when one is still there to read. */
  holder_id?: number;
  note: string;
  warning?: string;
  /** The job was created, and this says why the loose thread named by seed_id was not consumed. */
  thread_not_consumed?: string;
}

const isId = (v: unknown): v is number => Number.isInteger(v) && (v as number) > 0;
const isText = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

function check(ok: boolean, field: string, why: string): void {
  if (!ok) throw new ValidationError(`${TOOL}.${field} ${why}`, `invalid_${field.replace(/[.[].*$/, "")}`);
}

function checkSteps(steps: unknown, field: string): void {
  check(Array.isArray(steps) && steps.every(isText), field, "must be a list of non-empty step texts");
  check((steps as string[]).length > 0, field, "must hold at least one step");
}

function checkScope(scope: unknown, field: string): void {
  check(
    scope === undefined || (Array.isArray(scope) && scope.every((r) => isText(r?.entity) && (r.entity_id === null || isId(r.entity_id)))),
    field,
    "must be a list of {entity, entity_id}, entity_id a row id or null"
  );
}

/** A title opening the research prefix must be in the form (research-job.ts). */
function checkResearchForm(title: string, intent: string): void {
  if (!isResearchTitle(title)) return;
  const problems = researchFormProblems(title, intent);
  if (problems.length > 0) throw new ValidationError(`${TOOL}: this research job is not in the form: ${problems.join("; ")}. Nothing was written.`, "research_form");
}

function validate(args: CreateJobArgs): void {
  const guard = args.guard;
  check(isId(args.proceeding_id), "proceeding_id", "must be a positive integer");
  check(args.filing_id === null || isId(args.filing_id), "filing_id", "must be the Writing's or Work Board's id, or null for a proceeding-scoped job");
  check(isText(args.title), "title", "must be a non-empty string");
  check(isText(args.intent), "intent", "must be a non-empty string");
  check(args.kind === "work" || args.kind === "charting", "kind", "must be work or charting");
  check(Number.isInteger(args.priority) || args.priority === "top" || args.priority === "bottom", "priority", "must be an integer, top or bottom");
  check(
    ["none", "live_key", "never_held_key", "title_live_with_step", "title_and_step_any_status", "scrutiny_statement", "authority_brief", "research_title", "holder_lock"].includes(guard),
    "guard",
    "must be one of none, live_key, never_held_key, title_live_with_step, title_and_step_any_status, scrutiny_statement, authority_brief, research_title, holder_lock"
  );
  checkResearchForm(args.title, args.intent);
  checkSteps(args.steps, "steps");
  checkScope(args.scope, "scope");
  check(args.blocks === undefined || (Array.isArray(args.blocks) && args.blocks.every(isId)), "blocks", "must be a list of job ids");
  check(args.conflicts === undefined || (Array.isArray(args.conflicts) && args.conflicts.every(isId)), "conflicts", "must be a list of job ids");
  check(args.seed_id === undefined || isId(args.seed_id), "seed_id", "must be a loose thread's id");
  check(args.created_by === undefined || isText(args.created_by), "created_by", "must be the session_token open_session or bootstrap returned");
  const keys = args.proposal_keys ?? [];
  check(Array.isArray(keys) && keys.every((k) => isText(k?.key) && isText(k?.item)), "proposal_keys", "must be a list of {key, item}, each copied from the card");
  const keyed = guard === "live_key" || guard === "never_held_key";
  check(keyed === keys.length > 0, "proposal_keys", keyed ? `must name the job's keys under guard ${guard}` : "are written only under guard live_key or never_held_key");
  const locked = guard === "holder_lock";
  check(locked === isText(args.session_token), "session_token", locked ? "is required under guard holder_lock" : "is passed only under guard holder_lock");
  check(locked === isId(args.held_ticket_id), "held_ticket_id", locked ? "is required under guard holder_lock" : "is passed only under guard holder_lock");
  check(locked || args.claim_no === undefined, "claim_no", "is passed only under guard holder_lock");
  check(!locked || args.scope === undefined, "scope", "is not passed under guard holder_lock: the job copies the held job's scope");
  if (guard === "title_live_with_step" || guard === "title_and_step_any_status") {
    check(args.filing_id !== null, "filing_id", `must be the Writing's id under guard ${guard}`);
  }
  if (guard === "scrutiny_statement") {
    const statements = (args.scope ?? []).filter((r) => r.entity === "statements_of_law" && r.entity_id !== null);
    check(statements.length === 1, "scope", "must hold exactly one ('statements_of_law', <statement id>) row under guard scrutiny_statement");
  }
  if (guard === "authority_brief") {
    check(args.title.startsWith(BRIEF_JOB_PREFIX), "title", `must open "${BRIEF_JOB_PREFIX}" under guard authority_brief`);
    const authorities = (args.scope ?? []).filter((r) => r.entity === "authorities" && r.entity_id !== null);
    check(authorities.length === 1, "scope", "must hold exactly one ('authorities', <authority id>) row under guard authority_brief");
  }
  if (guard === "research_title") {
    check(isResearchTitle(args.title), "title", `must open "${RESEARCH_JOB_PREFIX}" under guard research_title`);
  }
  const companions = args.companions ?? [];
  check(Array.isArray(companions), "companions", "must be a list");
  check(companions.length === 0 || guard === "title_live_with_step", "companions", "are written only under guard title_live_with_step (§3c's pair)");
  companions.forEach((c, i) => {
    check(isText(c?.title) && isText(c?.intent), `companions[${i}]`, "needs a title and an intent");
    checkResearchForm(c.title, c.intent);
    checkSteps(c.steps, `companions[${i}].steps`);
    checkScope(c.scope, `companions[${i}].scope`);
  });
}

/** Every authority of the proceeding that is one case with this one, as the Case Briefs tab folds them
 * (case-briefs.ts): authorities are per exact citation, so a parallel citation is its own row. */
function authoritiesOfCase(dbPath: string, proceedingId: number, authorityId: number): number[] {
  const all = submissionDataQuery(dbPath, "SELECT id, citation FROM authorities WHERE proceeding_id = ?", [proceedingId]).rows as unknown as { id: number; citation: string | null }[];
  const key = citationKey(all.find((a) => a.id === authorityId)?.citation ?? null);
  return key === null ? [authorityId] : all.filter((a) => citationKey(a.citation) === key).map((a) => a.id);
}

/** The job whose existence fires the guard: `SELECT t.id FROM ... WHERE ...`, for the INSERT's NOT
 * EXISTS and, after a guarded call, for naming the holder. Null for none and holder_lock. */
function holderQuery(args: CreateJobArgs, titles: string[]): { sql: string; params: unknown[] } | null {
  const live = liveTicketClause(args.db_path, "t");
  const liveStatus = `t.status IN ('queued', 'wip') AND t.rejected_at IS NULL${live}`;
  const keys = JSON.stringify((args.proposal_keys ?? []).map((k) => k.key));
  switch (args.guard) {
    case "live_key": // jobs-create.md §3: a queued or wip, unshelved job holds one of the keys.
      return {
        sql: `SELECT t.id FROM ticket_proposals p JOIN tickets t ON t.id = p.ticket_id WHERE p.proposal_key IN (SELECT value FROM json_each(?)) AND ${liveStatus}`,
        params: [keys],
      };
    case "never_held_key": // jobs-create.md §3e: any job not deleted, of any status, has held one of the keys.
      return {
        sql: `SELECT t.id FROM ticket_proposals p JOIN tickets t ON t.id = p.ticket_id WHERE p.proposal_key IN (SELECT value FROM json_each(?))${live}`,
        params: [keys],
      };
    case "title_live_with_step": // jobs-stock.md §3c: a live job on the Writing with one of the titles already holds a step.
      return {
        sql: `SELECT t.id FROM tickets t WHERE t.filing_id = ? AND ${liveStatus} AND t.title IN (SELECT value FROM json_each(?)) AND EXISTS (SELECT 1 FROM ticket_steps s WHERE s.ticket_id = t.id)`,
        params: [args.filing_id, JSON.stringify(titles)],
      };
    case "title_and_step_any_status": // jobs-stock.md §3g: any job on the Writing, shelved included, not deleted, with the same title and step.
      return {
        sql: `SELECT t.id FROM tickets t JOIN ticket_steps s ON s.ticket_id = t.id WHERE t.filing_id = ?${live} AND t.title = ? AND s.text IN (SELECT value FROM json_each(?))`,
        params: [args.filing_id, args.title, JSON.stringify(args.steps)],
      };
    case "scrutiny_statement": { // jobs-stock.md §3d: a live scrutiny review job is scoped to the statement.
      const statement = (args.scope ?? []).find((r) => r.entity === "statements_of_law" && r.entity_id !== null) as ScopeRow;
      return {
        sql: `SELECT t.id FROM tickets t JOIN ticket_scope sc ON sc.ticket_id = t.id WHERE ${liveStatus} AND t.title LIKE 'Review scrutiny finding: %' AND sc.entity = 'statements_of_law' AND sc.entity_id = ?`,
        params: [statement.entity_id],
      };
    }
    case "authority_brief": { // jobs-stock.md §3n: a live case brief job in the proceeding is scoped to an authority of the same case.
      const authority = (args.scope ?? []).find((r) => r.entity === "authorities" && r.entity_id !== null) as ScopeRow;
      return {
        sql: `SELECT t.id FROM tickets t JOIN ticket_scope sc ON sc.ticket_id = t.id WHERE t.proceeding_id = ? AND ${liveStatus} AND t.title LIKE '${BRIEF_JOB_PREFIX}%' AND sc.entity = 'authorities' AND sc.entity_id IN (SELECT value FROM json_each(?))`,
        params: [args.proceeding_id, JSON.stringify(authoritiesOfCase(args.db_path, args.proceeding_id, authority.entity_id as number))],
      };
    }
    case "research_title": // jobs-stock.md §3i, §3l: any job in the proceeding, of any status, not deleted, has this title and a step.
      return {
        sql: `SELECT t.id FROM tickets t WHERE t.proceeding_id = ?${live} AND t.title = ? AND EXISTS (SELECT 1 FROM ticket_steps s WHERE s.ticket_id = t.id)`,
        params: [args.proceeding_id, args.title],
      };
    default:
      return null;
  }
}

/** §3's priority read as a subquery, run inside the write: one above the highest queued, or one
 * below the lowest, 0 when nothing is queued. A Writing's job reads that Writing's queue with the
 * proceeding-scoped jobs, a Work Board's job reads the Work Board's alone (§11), and a
 * proceeding-scoped job reads every queued job in the proceeding, so it is first or last on every
 * board it shows on. */
function priorityExpr(args: CreateJobArgs): { sql: string; params: unknown[] } {
  if (typeof args.priority === "number") return { sql: "?", params: [args.priority] };
  const queue = `proceeding_id = ? AND status = 'queued' AND rejected_at IS NULL${liveTicketClause(args.db_path)}`;
  const board =
    args.filing_id === null
      ? { sql: queue, params: [args.proceeding_id] }
      : {
          sql: `${queue} AND (filing_id = ? OR (filing_id IS NULL AND NOT EXISTS (SELECT 1 FROM filings WHERE id = ? AND kind = ?)))`,
          params: [args.proceeding_id, args.filing_id, args.filing_id, MILESTONE_KIND],
        };
  const pick = args.priority === "top" ? "MAX(priority) + 1" : "MIN(priority) - 1";
  return { sql: `(SELECT COALESCE(${pick}, 0) FROM tickets WHERE ${board.sql})`, params: board.params };
}

function children(job: { steps: string[]; scope?: ScopeRow[] }, at: number): WriteStatement[] {
  const id = { $rowid: at };
  return [
    ...job.steps.map((text, i) => ({ sql: "INSERT INTO ticket_steps (ticket_id, ordinal, text) VALUES (?, ?, ?)", params: [id, i + 1, text] })),
    ...(job.scope ?? []).map((r) => ({ sql: "INSERT INTO ticket_scope (ticket_id, entity, entity_id) VALUES (?, ?, ?)", params: [id, r.entity, r.entity_id] })),
  ];
}

/** holder_lock's WHERE: the held job is still this session's under its claim (heldBy). */
function held(args: CreateJobArgs): { sql: string; params: unknown[] } {
  const id = args.held_ticket_id as number;
  const h = heldBy(args.db_path, args.session_token as string, checkClaim(TOOL, args.db_path, id, args.session_token as string, args.claim_no));
  return { sql: ` WHERE EXISTS (SELECT 1 FROM tickets WHERE id = ? AND ${h.sql})`, params: [id, ...h.params] };
}

/** drafting_data__create_job. Every refusal and every guarded call writes nothing. */
export async function submissionDataCreateJob(args: CreateJobArgs, env: NodeJS.ProcessEnv = process.env): Promise<CreateJobResult> {
  if (!("filing_id" in args)) {
    throw new ValidationError(`${TOOL}.filing_id is required: the Writing's or Work Board's id, or null for a proceeding-scoped job`, "invalid_filing_id");
  }
  validate(args);
  if (args.seed_id !== undefined) {
    await moveSeedsOnce(args.db_path, env);
    if (!readThreads(args.db_path, env).some((t) => t.id === args.seed_id)) throw new ValidationError(`${TOOL}.seed_id ${args.seed_id} names no loose thread; nothing was written`, "invalid_seed_id");
  }
  const companions = args.companions ?? [];
  const holder = holderQuery(args, [args.title, ...companions.map((c) => c.title)]);
  const priority = priorityExpr(args);
  const writer = args.created_by !== undefined && createdByHeld(args.db_path);
  const cols = `proceeding_id, filing_id, title, intent, kind, priority, billing_anchor, created${writer ? ", created_by" : ""}`;
  const tail = writer ? ", ?" : "";
  const tailParams = writer ? [args.created_by] : [];
  const where =
    args.guard === "holder_lock" ? held(args)
    : holder === null ? { sql: "", params: [] }
    : { sql: ` WHERE NOT EXISTS (${holder.sql})`, params: holder.params };
  const anchor = args.billing_anchor ?? null;
  const statements: WriteStatement[] = [
    {
      sql: `INSERT INTO tickets (${cols}) SELECT ?, ?, ?, ?, ?, ${priority.sql}, ?, ${nowMinuteSql()}${tail}${where.sql}`,
      params: [args.proceeding_id, args.filing_id, args.title, args.intent, args.kind, ...priority.params, anchor, ...tailParams, ...where.params],
      expect_changes: 1,
    },
    ...children(args, 0),
  ];
  const lead = { $rowid: 0 };
  if (args.guard === "holder_lock") {
    statements.push({ sql: "INSERT INTO ticket_scope (ticket_id, entity, entity_id) SELECT ?, entity, entity_id FROM ticket_scope WHERE ticket_id = ?", params: [lead, args.held_ticket_id] });
  }
  for (const blocker of args.blocks ?? []) statements.push({ sql: "INSERT INTO ticket_blocks (blocker_id, blocked_id) VALUES (?, ?)", params: [blocker, lead] });
  for (const other of args.conflicts ?? []) statements.push({ sql: "INSERT INTO ticket_conflicts (a_id, b_id) VALUES (MIN(?, ?), MAX(?, ?))", params: [other, lead, other, lead] });
  for (const k of args.proposal_keys ?? []) statements.push({ sql: "INSERT INTO ticket_proposals (ticket_id, proposal_key, item) VALUES (?, ?, ?)", params: [lead, k.key, k.item] });
  const companionAt: number[] = [];
  for (const c of companions) {
    // Each companion takes the lead's priority and is inserted after it, so the lead heads the queue.
    const at = statements.length;
    companionAt.push(at);
    statements.push({
      sql: `INSERT INTO tickets (${cols}) SELECT ?, ?, ?, ?, ?, (SELECT priority FROM tickets WHERE id = ?), ?, ${nowMinuteSql()}${tail}`,
      params: [args.proceeding_id, args.filing_id, c.title, c.intent, args.kind, lead, anchor, ...tailParams],
      expect_changes: 1,
    });
    statements.push(...children(c, at));
    if (c.blocked_by_lead) statements.push({ sql: "INSERT INTO ticket_blocks (blocker_id, blocked_id) VALUES (?, ?)", params: [lead, { $rowid: at }] });
  }

  const written = await submissionDataWriteAll(args.db_path, statements, env);
  const warning = written.warning ? { warning: written.warning } : {};
  if (!written.ok) {
    if (written.failed !== 0) throw new DataServerError(`${TOOL}: statement ${written.failed} changed ${written.changes} rows; nothing was written`);
    return { outcome: "guarded", ...guardedReport(args, holder), ...warning };
  }
  const ticketId = written.results[0].rowid;
  const companionIds = companionAt.map((at) => written.results[at].rowid);
  const [row] = submissionDataQuery(args.db_path, "SELECT priority FROM tickets WHERE id = ?", [ticketId]).rows as unknown as { priority: number }[];
  const all = [ticketId, ...companionIds].map((id) => `Job ${id}`).join(" and ");
  let threadNotConsumed: string | undefined;
  if (args.seed_id !== undefined) {
    try {
      await looseThreadsUpdate({ db_path: args.db_path, action: "consume", id: args.seed_id, job_id: ticketId }, env);
    } catch (err) {
      if (!(err instanceof DataServerError)) throw err;
      threadNotConsumed = `Loose thread ${args.seed_id} still shows as open: ${err.message}`;
    }
  }
  return {
    outcome: "created",
    ticket_id: ticketId,
    ...(companionIds.length > 0 ? { companion_ids: companionIds } : {}),
    priority: row.priority,
    note: `${all} created with steps, scope and links in one transaction${writer ? ", created_by this session" : ""}. Re-render.`,
    ...warning,
    ...(threadNotConsumed === undefined ? {} : { thread_not_consumed: threadNotConsumed }),
  };
}

/** The holder that fired the guard, read after the rolled-back write, and what the session says. */
function guardedReport(args: CreateJobArgs, holder: { sql: string; params: unknown[] } | null): { holder_id?: number; note: string } {
  if (holder === null) {
    return {
      note: `Job ${args.held_ticket_id} no longer carries this session's token, so the lock was lost and nothing was written. Stop, run the confirm-read after a release on job ${args.held_ticket_id} (jobs-create.md §3f), name any blocker already written, and report; never re-run.`,
    };
  }
  const [found] = submissionDataQuery(args.db_path, `${holder.sql} ORDER BY t.id DESC LIMIT 1`, holder.params).rows as unknown as { id: number }[];
  const job = found === undefined ? "a job that has since changed (re-render to see it)" : `Job #${found.id}`;
  const notes: Record<string, string> = {
    live_key: `A live job already holds one of these keys: ${job}. Nothing was written; say "already a job: ${job}" in one line and go on.`,
    never_held_key: `One of these keys was already held, by ${job}, so intake writes nothing for it. Skip it and go on.`,
    title_live_with_step: `A live job with one of these titles already holds a step: ${job}. Nothing was written; say "already a job: ${job}" in one line.`,
    title_and_step_any_status: `This finding is already on the board, or was settled there: ${job}. Nothing was written; say "already on the board" in one line.`,
    scrutiny_statement: `A live scrutiny review job already covers this statement: ${job}. Nothing was written; say "already a job: ${job}" in one line.`,
    authority_brief: `A live case brief job already covers this case: ${job}. Nothing was written; say "already a job: ${job}" in one line.`,
    research_title: `This research job already exists, or was answered: ${job}. Nothing was written; say "already a job: ${job}" in one line.`,
  };
  return { ...(found === undefined ? {} : { holder_id: found.id }), note: notes[args.guard] };
}
