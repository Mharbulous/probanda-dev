// drafting_data__take_job: take a Ready job in one call (work/references/job-session.md, Assign).
// It runs, in code, every check before the assigning write that needs no judgement, in this order,
// and refuses on the first that fails, writing nothing: the job is Ready (a Bring Forward job
// returns before_bf); it has steps, and not only the plan marker; on a job the pickup review covers,
// its title is at most 12 words; no other live job on its Writing overlaps it (a shared key, a shared
// scope entry, or two shared title words of four letters or more) unless the caller has judged it
// not the same work (not_duplicates); no step not yet done equals or contains the title or the
// intent; and a one-step job's keys pass the pre-claim check. It then assigns the job through
// assign_job's guard, writes the job's started entry to ProceduralHistory.md, and returns the claim
// number, the Job header, the job's card and the premise check's line. The judgements stay with the
// session: whether a title or step needs rewording or splitting, whether an overlapping job is the
// same work, and the plan upgrade, each written through rewrite_job before take_job runs again.

import { ValidationError } from "../../errors.js";
import { acquireCaseLock } from "../../case/case-lock.js";
import { proceduralHistoryAppend } from "../../case/procedural-history.js";
import { validateMatterRoot } from "../../files/matter-root.js";
import { DATES_NOT_READ } from "../matter-board-section.js";
import { boardSection } from "../board-card.js";
import { derivedOf, jobCardLines, type BoardProposal } from "../board-job-text.js";
import { submissionDataQuery } from "../backend.js";
import { submissionDataAssignJob, type AssignJobResult } from "./assign-job.js";
import { PLAN_MARKER } from "./approve-plan.js";
import { GATE_TITLE, PRE_SEND_TITLE, POSITION_CONFLICT_TITLE, STOCK_TITLES, waitsOnGate } from "./goal-gate.js";
import { BoardIndex } from "./board-members.js";
import { BRIEF_JOB_PREFIX } from "./brief-job.js";
import { fetchBoardFilings, proceedingJobBoard } from "./query.js";
import { nowStamp } from "./timings.js";
import type { WorkBoardData } from "./render-work-board.js";
import type { WorkBoardTicket } from "./work-board-ticket.js";

const TOOL = "drafting_data__take_job";
const TITLE_MAX_WORDS = 12;
const LIVE = new Set(["ready", "waiting", "wip"]);
const LANE: Record<string, string> = { wip: "In Progress", waiting: "Blocked", superseded: "Superseded", completed: "Completed", rejected: "Shelved" };

export interface TakeJobArgs {
  db_path: string;
  ticket_id: number;
  /** This session's identity from open_session/bootstrap. Never minted here. */
  session_token: string;
  /** The matter folder open_session returned, whose ProceduralHistory.md gets the started entry. */
  matter_root: string;
  /** Jobs the session judged not the same work as this one after an earlier `duplicates` refusal. */
  not_duplicates?: number[];
}

export type TakeRefusal = "not_ready" | "no_steps" | "needs_plan" | "long_title" | "duplicates" | "restates" | "keys_dead" | "some_keys_dead" | "item_changed";

export interface Premise {
  /** draft's `premise` fact: every key derives, a key is dead, or no keys to check. */
  state: "holds" | "failed" | "none";
  line: string;
}

export interface TakeJobResult {
  ticket_id: number;
  outcome: "refused" | AssignJobResult["outcome"];
  /** On refused: which check refused. */
  reason?: TakeRefusal;
  /** On refused restates: the step ordinals that restate the title or intent. */
  steps?: number[];
  /** On refused duplicates: each overlapping job's card, as board_card prints it. */
  duplicates?: { ticket_id: number; card: string }[];
  /** On assigned: the claim number every holder-guarded job tool takes. */
  claim_no?: number | null;
  /** On assigned: `# Job <N>: <title>`, the reply's first line. */
  header?: string;
  /** On assigned: the job's card as board_card(jobs: [N]) prints it now. */
  card?: string;
  premise?: Premise;
  /** On assigned: the ProceduralHistory.md entry written, or why none was. */
  history?: { added: string | null; note?: string };
  bf_on?: string | null;
  note: string;
}

const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, " ").trim().replace(/[.!?;:,]+$/, "").trim();
const words = (s: string): Set<string> => new Set(s.toLowerCase().match(/[a-z0-9'’]{4,}/g) ?? []);

/** A job whose title readers match by text: stock, gate, counsel's review and scrutiny review jobs. */
export function fixedText(title: string): boolean {
  return (
    STOCK_TITLES.has(title) || waitsOnGate(title) || [GATE_TITLE, PRE_SEND_TITLE, POSITION_CONFLICT_TITLE].includes(title) ||
    title.startsWith("Counsel's review of ") || title.startsWith("Review scrutiny finding: ") || title.startsWith(BRIEF_JOB_PREFIX)
  );
}

/** The step ordinals, not yet done, that equal or contain the job's title or intent, ignoring case,
 * whitespace and trailing punctuation. The plan marker and a fixed-text job's steps are never flagged. */
export function restatingSteps(t: Pick<WorkBoardTicket, "title" | "intent" | "steps">): number[] {
  if (fixedText(t.title)) return [];
  const whole = [norm(t.title), norm(t.intent)].filter((s) => s !== "");
  return t.steps.filter((s) => s.done_at === null && s.text !== PLAN_MARKER && whole.some((w) => norm(s.text).includes(w))).map((s) => s.ordinal);
}

/** The premise check's line: what the job's keys derive now on its board. */
export function premiseOf(t: Pick<WorkBoardTicket, "proposal_keys" | "proposal_items">, derived: Map<string, BoardProposal> | null): Premise & { dead: number; changed: { key: string; stored: string; now: string }[] } {
  const keys = t.proposal_keys;
  if (keys.length === 0) return { state: "none", line: "No keys: outlined by hand, so there is no marker premise to check.", dead: 0, changed: [] };
  if (derived === null) return { state: "none", line: "This board derives no Proposals, so the job's keys are not checked.", dead: 0, changed: [] };
  const dead = keys.filter((k) => !derived.has(k)).length;
  const changed = keys.flatMap((k) => {
    const now = derived.get(k);
    return now !== undefined && now.item !== t.proposal_items[k] ? [{ key: k, stored: t.proposal_items[k] ?? "", now: now.item }] : [];
  });
  const reworded = changed.map((c) => ` The item now reads: ${c.now}`).join("");
  if (dead > 0) return { state: "failed", line: `The marker no longer fires on ${dead} of ${keys.length} items.${reworded}`, dead, changed };
  return { state: "holds", line: `Each item's marker still fires.${reworded}`, dead, changed };
}

/** The other live jobs on the job's Writing (General Jobs only with General Jobs, a research Writing's only
 * with that Writing's) that share a key, a scope entry or two title words with it, fixed-text jobs left out on
 * either side. */
function overlapping(section: WorkBoardData, t: WorkBoardTicket, cleared: number[]): WorkBoardTicket[] {
  if (fixedText(t.title)) return [];
  const mine = words(t.title);
  return section.tickets.filter((o) => {
    if (o.id === t.id || cleared.includes(o.id) || !LIVE.has(o.category) || fixedText(o.title)) return false;
    if (Boolean(o.general) !== Boolean(t.general) || o.writing !== t.writing || o.research_writing !== t.research_writing) return false;
    const sharedWords = [...words(o.title)].filter((w) => mine.has(w)).length;
    return o.proposal_keys.some((k) => t.proposal_keys.includes(k)) || o.scope.some((s) => t.scope.includes(s)) || sharedWords >= 2;
  });
}

/** The board the job is drawn on: its Writing's, a General Job's or a research Writing's job's first
 * live Writing's in its proceeding (proceedingJobBoard), or its proceeding's; on a merged board, the
 * survivor's, unless that Writing is retired (board-card.ts refuseAbsorbedCard). A proceeding that holds
 * only Work Boards with no Writing draws such a job on no page, so it is read on the proceeding's section. */
function boardOf(dbPath: string, id: number): { filing_id?: number; proceeding_id?: number } {
  const [row] = submissionDataQuery(dbPath, "SELECT filing_id, proceeding_id FROM tickets WHERE id = ?", [id]).rows as unknown as { filing_id: number | null; proceeding_id: number }[];
  if (row === undefined) throw new ValidationError(`${TOOL}: no job ${id} in ${dbPath}; nothing was written`, "not_found");
  const filings = fetchBoardFilings(dbPath, row.proceeding_id);
  const own = filings.some((f) => f.id === row.filing_id) ? row.filing_id : (proceedingJobBoard(filings)?.id ?? null);
  if (own === null && filings.length > 0) return { proceeding_id: row.proceeding_id };
  const index = new BoardIndex(dbPath);
  const ref = { filing_id: own, proceeding_id: row.proceeding_id };
  const survivor = index.absorbed(ref) ? index.survivorOf(ref) : ref;
  const board = survivor.filing_id !== null && filings.some((f) => f.id === survivor.filing_id && f.retired_on) ? ref : survivor;
  return board.filing_id === null ? { proceeding_id: board.proceeding_id } : { filing_id: board.filing_id };
}

function readJob(dbPath: string, id: number): { section: WorkBoardData; job: WorkBoardTicket } {
  const section = boardSection(dbPath, boardOf(dbPath, id), {}, nowStamp(), DATES_NOT_READ);
  const job = section.tickets.find((t) => t.id === id);
  if (job === undefined) throw new ValidationError(`${TOOL}: job ${id} is not on its board (deleted or moved); nothing was written`, "not_found");
  return { section, job };
}

const today = (d = new Date()): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** drafting_data__take_job. Every refusal writes nothing. */
export async function submissionDataTakeJob(args: TakeJobArgs, env: NodeJS.ProcessEnv = process.env): Promise<TakeJobResult> {
  if (!Number.isInteger(args.ticket_id) || args.ticket_id <= 0) throw new ValidationError(`${TOOL}.ticket_id must be a positive integer; nothing was written`, "invalid_ticket_id");
  if (typeof args.session_token !== "string" || args.session_token.trim() === "") {
    throw new ValidationError(`${TOOL}.session_token must be the session_token open_session or bootstrap returned; nothing was written`, "invalid_session_token");
  }
  // A folder the history entry cannot go to refuses before anything is written.
  const matterRoot = validateMatterRoot(args.matter_root);
  const cleared = args.not_duplicates ?? [];
  if (!Array.isArray(cleared) || !cleared.every((n) => Number.isInteger(n) && n > 0)) throw new ValidationError(`${TOOL}.not_duplicates must be a list of job numbers; nothing was written`, "invalid_not_duplicates");
  const id = args.ticket_id;
  const { section, job } = readJob(args.db_path, id);
  const refuse = (reason: TakeRefusal, note: string, extra: Partial<TakeJobResult> = {}): TakeJobResult => ({ ticket_id: id, outcome: "refused", reason, ...extra, note: `Nothing was written. ${note}` });

  if (job.category === "bring_forward") {
    return { ticket_id: id, outcome: "before_bf", bf_on: job.bf_on, note: `Job ${id} was not assigned: it is held until its bring-forward date (bf_on=${job.bf_on}), so nothing was written. Only the practitioner changes or clears that date.` };
  }
  if (job.category !== "ready") return refuse("not_ready", `Job ${id} is not Ready: its card reads ${LANE[job.category] ?? job.category}. Re-render; never re-run to win.`);
  if (job.steps.length === 0) return refuse("no_steps", `Job ${id} has no steps. What steps will complete it?`);
  if (job.steps.length === 1 && job.steps[0].text === PLAN_MARKER) return refuse("needs_plan", `Job ${id} needs a plan: its only step is the plan marker.`);

  const reviewed = !fixedText(job.title) && job.proposal_keys.length === 0 && job.steps.every((s) => s.done_at === null) && !planApproved(args.db_path, id);
  const titleWords = job.title.trim().split(/\s+/).length;
  if (reviewed && titleWords > TITLE_MAX_WORDS) return refuse("long_title", `Job ${id}'s title is ${titleWords} words, more than ${TITLE_MAX_WORDS}. What shorter phrase names the work?`);

  const dupes = overlapping(section, job, cleared);
  if (dupes.length > 0) {
    const derived = derivedOf(section);
    return refuse("duplicates", `Job ${id} overlaps ${dupes.map((d) => `Job #${d.id}`).join(", ")}. Is any of them the same work?`, {
      duplicates: dupes.map((d) => ({ ticket_id: d.id, card: jobCardLines(d, derived, section.seeds, section.meta.rendered).join("\n") })),
    });
  }

  const restating = restatingSteps(job);
  if (restating.length > 0) return refuse("restates", `Step ${restating.join(", ")} of job ${id} only restates its title or intent, so it names no work. What does the work divide into?`, { steps: restating });

  // A research Writing's job's keys are its own Writing's, which this board does not derive.
  const premise = premiseOf(job, job.research_writing === undefined ? derivedOf(section) : null);
  if (job.steps.length === 1 && premise.dead > 0) {
    return premise.dead === job.proposal_keys.length
      ? refuse("keys_dead", `The marker no longer fires on any of job ${id}'s ${premise.dead} items: close it as superseded, or keep it and say what it should now do?`)
      : refuse("some_keys_dead", `${premise.line} What should job ${id} now do?`);
  }
  if (job.steps.length === 1 && premise.changed.length > 0 && job.title === job.intent) {
    return refuse("item_changed", `${premise.changed.map((c) => `The item was: ${c.stored} It now reads: ${c.now}`).join(" ")} Run it as worded, close it as superseded, or re-outline it?`);
  }

  const assigned = await submissionDataAssignJob({ db_path: args.db_path, ticket_id: id, session_token: args.session_token }, env);
  if (assigned.outcome !== "assigned") return { ticket_id: id, outcome: assigned.outcome, bf_on: assigned.bf_on, note: assigned.note };

  const after = readJob(args.db_path, id);
  const line = `Started Job ${id}: ${job.title}${/[.!?]$/.test(job.title) ? "" : "."}`;
  let history: TakeJobResult["history"];
  try {
    // The file is read, edited and renamed, so two sessions must take turns (group locking spec 7.2).
    const lock = await acquireCaseLock(matterRoot, env);
    try {
      history = { added: proceduralHistoryAppend({ matter_root: matterRoot, date: today(), line }).added };
    } finally {
      lock.release();
    }
  } catch (err) {
    const code = (err as { code?: string }).code;
    history = { added: null, note: code === "duplicate_entry" ? "Today's heading already holds this job's started entry." : `Not written: ${(err as Error).message}` };
  }
  return {
    ticket_id: id,
    outcome: "assigned",
    claim_no: assigned.claim_no,
    header: `# Job ${id}: ${after.job.title}`,
    card: jobCardLines(after.job, derivedOf(after.section), after.section.seeds, after.section.meta.rendered).join("\n"),
    premise: { state: premise.state, line: premise.line },
    history,
    note: assigned.note,
  };
}

function planApproved(dbPath: string, id: number): boolean {
  const [row] = submissionDataQuery(dbPath, "SELECT plan_approved_at FROM tickets WHERE id = ?", [id]).rows as unknown as { plan_approved_at: string | null }[];
  return row?.plan_approved_at != null;
}
