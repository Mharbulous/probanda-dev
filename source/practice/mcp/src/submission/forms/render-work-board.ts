// Job Board data (ADR 0009; a local file only since 2026-09-14, docs/design/2026-09-14
// work-board-local-only-design.md): one filing's stored ticket process state -- tickets sorted
// into ready / in progress / blocked / completed / shelved / superseded, plus
// loose threads not yet outlined -- as one JSON object. workboard-shell.ts inlines it as the one section of
// that filing's self-contained Job Board page, and matter-pages.ts prints the same object
// as the render response's board_summary, which is what a session orients from. Never an advocacy document (forms.ts tags it
// neverDelivered, dropped from renderMode:'filed' entirely, same as the Counsel Brief). The board
// now prints marker glyphs, in its Shelved lane and board_card's proposed lane only (design §13). It holds
// no predicate of its own: every glyph comes from the render's inventory.
//
// The category rules live here and only here. The board page draws the category it is given and never
// derives one, so a session and the practitioner always see the same sort.

import { DataServerError } from "../../errors.js";
import { idleFlagHours } from "../../tools/practice/firm-profile.js";
import { submissionDataQuery } from "../backend.js";
import type { CourtFileAffidavit } from "../court-file-affidavits.js";
import { type BoardGoals, fetchBoardGoals } from "./board-goals.js";
import type { PageDates } from "../matter-dates.js";
import { storedLayout } from "./layout-snapshot.js";
import { LIFECYCLE_LABELS, type LifecycleState } from "./lifecycle.js";
import { LEGISLATION_KINDS } from "./markers.js";
import { currencyLabel, currencyWithheldClauses, type LayoutPart } from "./projections.js";
import { NO_TO_RECIPIENT_TABLE, authorityUnconfirmed } from "./render-general.js";
import {
  deriveProposals,
  GLYPH_SLUGS,
  proposalKey,
  type GlyphInstance,
  type InventoryEntry,
  type MarkerInventory,
  type NonGeneratingGlyph,
  type Proposal,
  type ProposalHolder,
  type ProposalRejection,
  type ProposalSlug,
  withNoteUpSteps,
} from "./proposal-inventory.js";
import { ticketSourcesHeld } from "./track-source.js";
import { boardAttachmentsHeld, deletedAtHeld, fetchHearingDate, isJobOnlyBoard, JOB_BOARD_KIND, liveSeedClause, liveTicketClause, seedClosedColumns, ticketAnswersHeld, type FilingRow, type ProceedingRow } from "./query.js";
import type { RenderContext } from "./render-vaniac-submissions.js";
import type { WritingLabel } from "./writing-label.js";

function rows<T>(dbPath: string, sql: string, params: unknown[] = []): T[] {
  return submissionDataQuery(dbPath, sql, params).rows as unknown as T[];
}

type TicketStatus = "queued" | "wip" | "completed" | "superseded";

interface TicketRow {
  id: number;
  proceeding_id: number;
  filing_id: number | null;
  title: string;
  intent: string;
  status: TicketStatus;
  priority: number;
  kind: "work" | "charting";
  locked_by: string | null;
  locked_at: string | null;
  plan_approved_at: string | null;
  created: string;
  completed_at: string | null;
  superseded_by: number | null;
  rejected_at: string | null;
  superseded_marker_gone_at: string | null;
  /** Schema v54; absent on a database held below it. */
  deleted_at?: string | null;
  /** Schema v74; absent on a database held below it. */
  bf_on?: string | null;
}

/** A deleted job (schema v54, jobs-closeout.md §10a): drawn only as a struck line on the page. */
interface DeletedTicket {
  id: number;
  title: string;
  filing_id: number | null;
}

/** A loose thread that left the board without being outlined (schema v75): discarded, or else suggested. */
export interface DiscardedSeed {
  id: number;
  idea: string;
  filing_id: number | null;
  /** The minute the practitioner dropped it; null on a suggested thread. */
  discarded_at: string | null;
  /** The minute it was sent to Probanda as a suggestion; null when it was not. */
  suggested_at: string | null;
}

interface StepRow {
  ticket_id: number;
  ordinal: number;
  text: string;
  done_at: string | null;
}

interface ScopeRow {
  ticket_id: number;
  entity: string;
  entity_id: number | null;
}

interface BlockRow {
  blocker_id: number;
  blocked_id: number;
}

interface ConflictRow {
  a_id: number;
  b_id: number;
}

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

interface SeedCaptureRow {
  origin_ticket_id: number;
  created: string;
}

interface AnswerRow {
  ticket_id: number;
  file_path: string;
  saved_at: string;
}

interface SourceRow {
  ticket_id: number;
  kind: string;
  label: string;
  added_at: string;
  closed_at: string | null;
  outcome: string | null;
  reason: string | null;
}

interface ProposalRow {
  ticket_id: number;
  proposal_key: string;
  item: string;
}

interface RejectionRow {
  proposal_key: string;
  ticket_id: number | null;
  marker: string;
  item: string;
}

interface FilingTitleRow {
  id: number;
  title: string;
}

interface FilingRetiredRow {
  id: number;
  retired_on: string | null;
}

/** A draft that is not a Writing (schema v67, ADR 0042): a client letter's folder or a reply's file. */
export type AttachmentKind = "client_letter" | "reply";

/** One board_attachments row: the board and the path, nothing else. `path` is in documents.file_path's
 * stored form, relative to the matter root with backslash separators. `filing_id` is null on a row
 * naming its proceeding's own board. */
export interface WorkBoardAttachment {
  id: number;
  filing_id: number | null;
  path: string;
  kind: AttachmentKind;
  attached_on: string;
}

export type Category = "ready" | "wip" | "bring_forward" | "waiting" | "superseded" | "completed" | "rejected";

/** An edge to another ticket (blocker, conflict partner, superseding ticket). `status` is null when
 * that ticket is outside this proceeding's own fetch -- discipline forbids such an edge
 * (jobs.md §11) but the schema doesn't, so the edge is reported rather than silently dropped.
 * `rejected` is that ticket's own rejection, so a reader sees why its blocked side needs a fresh
 * outline; false for an edge outside the proceeding, whose rejection state is unreadable. */
export interface WorkBoardEdge {
  id: number;
  status: TicketStatus | null;
  rejected: boolean;
}

export type DispatchSkip =
  | { reason: "practitioner_own" }
  | { reason: "either_or"; job: number }
  | { reason: "shared_material"; job: number; material: string[] }
  | { reason: "before_gate" };

export interface WorkBoardTicket {
  id: number;
  title: string;
  intent: string;
  kind: TicketRow["kind"];
  priority: number;
  /** SQLite's own status. */
  status: TicketStatus;
  /** The board column, derived from status, blockers and conflict partners. */
  category: Category;
  /** The opaque session token holding the ticket, exactly as stored -- never a display identity. */
  locked_by: string | null;
  locked_at: string | null;
  completed_at: string | null;
  /** When the practitioner rejected the angle this ticket was outlined from; null on a live ticket. */
  rejected_at: string | null;
  /** The job's bring-forward date (`YYYY-MM-DD`, schema v74): the first day it may be worked, a
   * start date and never a deadline. Null when none is set, and on a database held below v74. */
  bf_on: string | null;
  superseded_by: WorkBoardEdge | null;
  /** `entity` for a whole-table grant, `entity:id` for a row. Stale the instant it renders; a write gate reads live. */
  scope: string[];
  blocked_by: WorkBoardEdge[];
  conflicts: WorkBoardEdge[];
  /** True only on a waiting ticket whose blockers lead back to itself -- a charting defect the board labels. */
  circular: boolean;
  steps: { ordinal: number; text: string; done_at: string | null }[];
  /** The Proposal keys this ticket holds, so the board can say which work is already outlined. */
  proposal_keys: string[];
  /** Each held key's item as its ticket_proposals row stored it, keyed as in `proposal_keys` -- the
   * stored side of the changed-item check (Goal card design §4.6, §4.8); `proposals[].item` is the
   * current side. A key whose Proposal no longer derives still carries it; `{}` when no keys. */
  proposal_items: Record<string, string>;
  /** Why a superseded ticket is superseded, finished for the board (Goal card design §4.7); null
   * when another ticket superseded it, which the `superseded_by` pointer says, and on a live ticket. */
  superseded_reason: string | null;
  /** The card's subtitle: how many of a live ticket's keys the inventory no longer prints (design
   * §4.7), or on an eligible ticket that it can run unattended (design §5.7). Null when neither
   * holds, and on a board with no inventory. The lane is unchanged by it. */
  subtitle: string | null;
  /** Whether an unattended run may take this ticket (design §5.3). Re-derived at every render,
   * never stored; false on a board with no inventory. Always equals `ineligible_reasons` being empty. */
  eligible: boolean;
  /** Each §5.3 condition this ticket fails, and #1051's shared material, in `INELIGIBLE_REASONS` order, so an unattended run
   * reports why it passed a job over without working it out. Re-derived at every render, never stored. */
  ineligible_reasons: IneligibleReason[];
  /** Section 14 Dispatch's skip reasons for a Ready job, in that section's order; empty for the job the walk may choose, and on any job not in Ready. */
  dispatch_skips: DispatchSkip[];
  /** The In progress card's note when an unattended run holds the lock, read off the token's class
   * (design §5.4); null for any other holder. */
  lock_note: string | null;
  /** The answers saved for this job by `research_filing__save_answer` (schema v52), in the order they
   * were saved: each file's path from its `6. LAW` segment, and the minute it was saved. Empty on a
   * database held below v52. */
  answers: { file_path: string; saved_at: string }[];
  /** The sources to get recorded on this job by `drafting_data__track_source` (schema v76), in the
   * order they were added: the job's own record beside its steps, never part of its plan. `outcome`
   * is null while a source is open. Empty on a database held below v76. */
  sources: { kind: string; label: string; outcome: string | null; reason: string | null }[];
  /** The job's latest recorded activity: the latest of its lock, its done steps, the loose threads
   * captured from it, the answers saved for it and the sources to get added to it or closed on it.
   * Null when it has none of them. The idle tag measures from it. */
  last_activity_at: string | null;
  /** `idle past <N> h` on an In progress job idle longer than the firm's `idle_flag_hours` (N), set by
   * the section builders; absent, which reads as null, within it, with nothing to measure, or with no
   * threshold set, so an unset threshold leaves the board data as it was. */
  idle_flag?: string | null;
}

export interface WorkBoardSeed {
  id: number;
  idea: string;
  surfaced_by: string;
  created: string;
  filing_id: number | null;
  origin_ticket_id: number | null;
  /** The title of the sibling filing the loose thread was captured on (ADR 0024 D11); null when it was
   * captured on this board's own filing or on none. */
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

/** Each group's label, in triage's group order. board_card's loose_threads lane prints these; the Loose Threads page prints its own short names (loose-ideas-page.ts). */
export const RANK_GROUP_LABELS: Readonly<Record<RankGroup, string>> = {
  decision: "Practitioner remarks and decisions already made",
  tooling: "Plugin and tooling feedback",
  housekeeping: "Case-data and law-folder housekeeping",
  research: "Research offers and research questions",
  authority: "Writing doesn't match an authority as cited",
  evidence: "Writing doesn't match the evidence or pleadings",
  other: "Miscellaneous",
};

/** The loose threads' shared order: the ranked by rank (ties by id), then the unranked by id. The
 * Loose Threads page and board_card's loose_threads lane both print in it; the Job Board page keeps id order. */
export function inRankOrder<T extends { id: number; rank: number | null }>(seeds: readonly T[]): T[] {
  return [...seeds].sort((a, b) => (a.rank === null ? 1 : 0) - (b.rank === null ? 1 : 0) || (a.rank ?? 0) - (b.rank ?? 0) || a.id - b.id);
}

/** Where a loose thread came from, as board_card's line and the Loose Threads page print it: its origin
 * job, on a sibling filing when it was captured there, or the sibling filing alone; null for neither. */
export function seedOrigin(s: Pick<WorkBoardSeed, "origin_ticket_id" | "from_filing">): string | null {
  if (s.origin_ticket_id !== null) return `from Job #${s.origin_ticket_id}${s.from_filing === null ? "" : ` on ${s.from_filing}`}`;
  return s.from_filing === null ? null : `from ${s.from_filing}`;
}

/** A criterion's, and the goal's, state (Goal card design §2.1). Pending never counts as met. */
export type GoalState = "met" | "unmet" | "pending";

/** The criterion ids: shared/declared-layout.md section 6's `goal_criteria` members, plus the
 * universal `gate`, `currency` and `authority-confirmed`, which no type declares, plus one
 * `deadline:<type>` per deadline of an anchor linked to the filing in practice data.
 * `currency`, `authority-confirmed` and `position-conflict` are the pre-send hold's last checks
 * (jobs.md §14a), never Goal-card rows. */
export type CriterionId =
  | "orders-sought" | "orders-positioned" | "primary-authority" | "excerpts" | "noting-up" | "evidence" | "open-items"
  | "opposing-points" | "counsel-review" | "terms-traced" | "recipients" | "hearing-date" | "gate" | "currency" | "authority-confirmed"
  | "position-conflict" | `deadline:${string}`;

/** One Goal-card condition as this render derived it (design §2.3). `outstanding` counts the
 * matches still open; `items` names them, count-free, followed by each shelved one. */
export interface GoalCriterion {
  id: CriterionId;
  text: string;
  state: GoalState;
  outstanding: number;
  items: string[];
  source: "inventory" | "sqlite" | "practice";
  /** A deadline criterion only: the criteria at the previous date within its anchor (ADR 0013,
   * second 2026-10-04 amendment). Absent on the first, and on every other criterion. */
  follows?: string[];
  /** An inventory criterion with a suppressed item only (schema v69): one entry per item, by index,
   * the marker a 🤫 item replaces, which the HTML board shows as its tooltip, or null for any other
   * item. Absent otherwise. */
  replaces?: (string | null)[];
}

/** The Goal card's head (design §2.3, §2.9): `sentence` is the card's fixed head, `Completion
 * Criteria`; `text` is the finished card string, null where no §2.9 row applies. */
export interface Goal {
  sentence: string;
  state: GoalState;
  text: string | null;
}

export interface WorkBoardData {
  meta: {
    /** First key on purpose: forms.ts reads it back off the board's data line to decide archiving. */
    revision: number;
    matter: string;
    client: string;
    file: string;
    /** "" on a pre-filing proceeding's board (ADR 0018). */
    filing: string;
    /** Null on a pre-filing proceeding's board (ADR 0018). */
    filing_id: number | null;
    proceeding_id: number;
    rendered: string;
    /** Null on a pre-filing proceeding's board, which has no lifecycle; state_label then says why. */
    state: LifecycleState | null;
    state_label: string;
    /** The date that put the filing in `state`; null only while drafting. */
    state_since: string | null;
    /** True only once the appeal period has run: retiring the filing is the ordinary next step. */
    ready_to_retire: boolean;
    /** Present only when the filing's stored layout declares `ingest_inputs`: those folders, and the
     * ids of this filing's own Ready jobs (never a proceeding-wide job's). Absent on a pre-filing board. */
    ingest_inputs?: { folders: string[]; ready_jobs: number[] };
    /** True only on a Job Board with no Writing (JOB_BOARD_KIND): `state` is null, `state_label` reads
     * Open or Closed, and the section has no Goal card, criteria or Proposals. */
    job_only?: true;
  };
  tickets: WorkBoardTicket[];
  seeds: WorkBoardSeed[];
  /** The deleted jobs this section's page draws as struck lines in Completed (schema v54), in id
   * order. Nothing else reads them: the summary and board_card name no deleted job. */
  deleted: { id: number; title: string }[];
  /** The discarded and suggested loose threads this section's pages draw as lines (schema v75), in id
   * order: a discarded one struck, a suggested one plain. Nothing else reads them: the summary and
   * board_card name none. Empty on a database held below v75. */
  discardedSeeds: Omit<DiscardedSeed, "filing_id">[];
  /** The drafts attached to this board (schema v67, ADR 0042), in id order (fetchAttachments): on a
   * filing's board its own rows, plus, on the proceeding's lowest-id live Writing only, the
   * proceeding's rows with no Writing; on a pre-filing board every row of the proceeding. Empty on a
   * database held below v67. */
  attachments: WorkBoardAttachment[];
  /** This render's derived Proposals, in card order. Empty on a pre-filing or retired board. */
  proposals: Proposal[];
  /** Keys whose stored rejection no longer describes the work; the next Opening deletes those rows. */
  lapsed_keys: string[];
  /** Every board's statement of goals (board-goals.ts), drawn as the card labelled Goal above the
   * Completion Criteria card. Not `goal`, which is the Completion Criteria card's. */
  goals: BoardGoals;
  /** A filing's board only: a pre-filing proceeding's board has no Goal card (design §2.1). */
  goal?: Goal;
  /** The stored layout's `goal_criteria` in their declared order, then `gate`, then `hearing-date`
   * where it is declared, then the linked deadlines; empty on a type declaring none and on a retired filing. */
  criteria?: GoalCriterion[];
}

/** One Job Board page (#1365, ADR 0033's 2026-10-05 amendment): the matter's meta and one section, a
 * live filing's or a pre-filing proceeding's. `meta.revision` stays the data line's first key, so
 * readExistingRevision still reads it. The client number and the section's proceeding's forum,
 * registry, file number and style of proceeding are "" when unknown. */
export interface MatterJobBoardData {
  meta: {
    revision: number;
    matter: string;
    client: string;
    rendered: string;
    client_no: string;
    forum: string;
    registry: string;
    file_number: string;
    style_of_cause: string;
  };
  sections: WorkBoardData[];
  /** The matter's dates (ADR 0013, 2026-10-04 amendments): drawn on the page, in no section. */
  dates: PageDates;
  /** Each live Writing's label from the last render's manifest, in that render's document order
   * (venue document, companions, Counsel Brief): `short` is drawn on the tile, `long` is its
   * `title`; a manifest entry with no label gives the file name for both. Drawn on the page, in no
   * section; empty on a pre-filing page, on a never-rendered filing, and on one whose manifest
   * predates the inventory field. */
  writings: WritingLabel[];
  /** The filing's view pages (../view-pages.ts VIEW_PAGES), in registry order: each page's name and
   * its sibling file's name, drawn after the Writings as a tile, never a link. Empty on a pre-filing
   * page; a retired filing has no page and no view pages. */
  views: { name: string; file: string }[];
  /** The section's attachments as found on disk when the page was written (../board-attachments.ts),
   * drawn in the Attached lane as plain text, never a link (shared/html-pages.md, "Cards only, no link"). */
  attached: AttachedDraft[];
  /** The filing's relied-on affidavits whose court-file name disagrees with drafting data when the page
   * was written (../court-file-affidavits.ts): one card each, in a Court File lane drawn only when
   * there is one. Empty on a pre-filing page. */
  court_file?: CourtFileAffidavit[];
}

/** A board attachment as found on disk at a page write or a board_card read (ADR 0042). */
export interface AttachedDraft {
  id: number;
  kind: AttachmentKind;
  /** The stored path, relative to the matter root. */
  path: string;
  /** The folder's or file's own name, the path's last segment. */
  name: string;
  attached_on: string;
  /** A row of the proceeding with no Writing, on a Writing's board: it shows only on the proceeding's
   * lowest-id live Writing's board, until it is moved to a Writing. False on a pre-filing board,
   * whose own row it is. */
  proceeding_wide: boolean;
  /** `missing` when nothing is at the path, `outside` when the path, or its real path, leaves the
   * matter's draft folder or lies in a privileged or disclosed tree (never read), `unreadable` when
   * reading it failed, with the error code in `error`. */
  state: "present" | "missing" | "outside" | "unreadable";
  /** The error code of a failed read; present only when `state` is `unreadable`. */
  error?: string;
  /** A present client letter's review drafts: each `.md` at the top of its folder whose first line is
   * a counsel's-review line, with the rest of that line (`pending`, `approved by …`). Only that line
   * is read and drawn, never the body. Empty for a reply. */
  review: { file: string; status: string }[];
}

/** The sibling data script the board used from 2026-09-14 to 2026-09-15. Kept only as a name renders delete. */
export const WORKBOARD_DATA_FILE = "workboard-data.js";

/** The proceeding's jobs that are not deleted: a deleted job counts toward nothing (jobs-closeout.md §10a). */
function fetchProceedingTickets(dbPath: string, proceedingId: number): TicketRow[] {
  return rows<TicketRow>(dbPath, `SELECT * FROM tickets WHERE proceeding_id = ?${liveTicketClause(dbPath)} ORDER BY priority DESC, id`, [proceedingId]);
}

/** The proceeding's deleted jobs, in id order; none on a database held below v54. */
export function fetchDeletedTickets(dbPath: string, proceedingId: number): DeletedTicket[] {
  if (!deletedAtHeld(dbPath)) return [];
  return rows<DeletedTicket>(dbPath, "SELECT id, title, filing_id FROM tickets WHERE proceeding_id = ? AND deleted_at IS NOT NULL ORDER BY id", [proceedingId]);
}

/** Detects a blocker cycle reachable from `startId` by walking ticket_blocks upward
 * (blocked -> blocker -> its own blocker -> ...), independent of ticket status --
 * a cycle is a charting defect regardless of which side happens to be queued right
 * now. Bounded by construction: each ticket id is visited at most once. */
function reachesItself(startId: number, blockersOf: Map<number, number[]>): boolean {
  const stack = [...(blockersOf.get(startId) ?? [])];
  const seen = new Set<number>();
  while (stack.length > 0) {
    const cur = stack.pop() as number;
    if (cur === startId) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const next of blockersOf.get(cur) ?? []) stack.push(next);
  }
  return false;
}

/** A job whose plan ran to the end: at least one step, every step stamped. */
const allStepsDone = (steps: readonly { done_at: string | null }[]): boolean => steps.length > 0 && steps.every((s) => s.done_at !== null);

/** A job that holds its scope's material: in progress by status, not category, so a shelved job with
 * open steps still holds it under its lock. A job with every step done holds none. */
const holdsMaterial = (t: { status: TicketStatus; steps: readonly { done_at: string | null }[] }): boolean => t.status === "wip" && !allStepsDone(t.steps);

/** The latest of minute-precision local stamps written with a `T` or a space (`2026-10-02T09:00`,
 * `2026-10-02 09:00`), compared with that separator made equal; null when none is given. */
function latestStamp(stamps: readonly (string | null)[]): string | null {
  let latest: string | null = null;
  for (const s of stamps) if (s !== null && (latest === null || s.replace(" ", "T") > latest.replace(" ", "T"))) latest = s;
  return latest;
}

/** An edge outside this proceeding (status null) is treated as an unresolved, non-superseded
 * blocker -- it can never silently read as "completed" or "no blocker at all" the way
 * filtering it out of the list would. A wip job is In Progress whether or not its steps are all
 * stamped, so Dispatch never claims a job another session still holds. A queued job whose blocker
 * was superseded or shelved is Blocked until it is outlined afresh. A queued job whose bring-forward
 * date (bf_on) is later than `today`, the local date, is in Bring Forward whatever its blockers;
 * from that date on it reads as Blocked or Ready, with no write. */
function classify(ticket: TicketRow, blockers: WorkBoardEdge[], conflictPartners: WorkBoardEdge[], today: string): Category {
  if (ticket.rejected_at !== null) return "rejected";
  if (ticket.status === "completed") return "completed";
  if (ticket.status === "superseded") return "superseded";
  if (ticket.status === "wip") return "wip";
  // queued
  if (ticket.bf_on != null && ticket.bf_on > today) return "bring_forward";
  if (blockers.some((b) => b.status !== "completed")) return "waiting";
  if (conflictPartners.some((p) => p.status === "wip")) return "waiting";
  return "ready";
}

/** A superseded ticket's reason (Goal card design §4.7). A `superseded_by` pointer wins whatever
 * the filing's state: the pointer row says it. Then the dead-marker closure's stamp, then the
 * retirement of the ticket's own filing, which supersedes only that filing's queued jobs (jobs.md
 * §9a). A stale gate job not yet linked to its replacement (jobs.md §14) matches none. */
function supersededReason(ticket: TicketRow, retiredOn: ReadonlyMap<number, string | null>): string | null {
  if (ticket.status !== "superseded" || ticket.superseded_by !== null) return null;
  if (ticket.superseded_marker_gone_at !== null) return `Superseded: its marker no longer shows (${ticket.superseded_marker_gone_at.slice(0, 10)})`;
  const retired = ticket.filing_id === null ? null : retiredOn.get(ticket.filing_id) ?? null;
  return retired === null ? null : `Superseded by: retirement of this Writing (${retired})`;
}

function groupBy<T>(items: T[], key: (item: T) => number): Map<number, T[]> {
  const map = new Map<number, T[]>();
  for (const item of items) {
    const list = map.get(key(item)) ?? [];
    list.push(item);
    map.set(key(item), list);
  }
  return map;
}

/** Every ticket and open loose thread in one proceeding, each ticket already classified. The per-filing
 * Job Board and the Matter Board both draw from this, so the category rules run in one place. */
export interface ProceedingBoard {
  /** In board order (priority, then id), each with the filing it belongs to -- null when proceeding-scoped. */
  tickets: { filing_id: number | null; ticket: WorkBoardTicket }[];
  /** In id order, every open loose thread in the proceeding whatever its filing (ADR 0024 D11). */
  seeds: Omit<WorkBoardSeed, "from_filing">[];
  /** Proposal key -> the live (queued or wip, unrejected) ticket holding it, and the filing that
   * ticket sits on. First ticket by id wins a duplicated key (plan A4). */
  holders: Map<string, { ticket_id: number; filing_id: number | null }>;
  /** The proceeding's deleted jobs, in id order. They are on no card, in no count and in no summary. */
  deleted: DeletedTicket[];
  /** The proceeding's discarded and suggested loose threads, in id order. They are in no count and in no summary. */
  discardedSeeds: DiscardedSeed[];
}

/** Today's local date, `YYYY-MM-DD`, which a bring-forward date reads against as a string. */
function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** `today` is the local date the Bring Forward lane reads against: a section builder passes its
 * Rendered minute's date, so the lane agrees with the stamp the section prints. */
export function buildProceedingBoard(dbPath: string, proceedingId: number, today: string = localToday()): ProceedingBoard {
  const proceedingTickets = fetchProceedingTickets(dbPath, proceedingId);
  const ticketById = new Map(proceedingTickets.map((t) => [t.id, t]));
  const proceedingIds = proceedingTickets.map((t) => t.id);
  const idList = proceedingIds.map(() => "?").join(",");
  // A deleted job's rows all stay (jobs-closeout.md §10a) and are read as if it were gone: an edge
  // touching it is dropped, so a job that waited on it no longer does and its either/or partner is
  // no longer held back, and no edge names a job the page has no card for.
  const deleted = fetchDeletedTickets(dbPath, proceedingId);
  const deletedIds = new Set(deleted.map((d) => d.id));

  const blocks = (
    proceedingIds.length === 0
      ? []
      : rows<BlockRow>(dbPath, `SELECT * FROM ticket_blocks WHERE blocker_id IN (${idList}) OR blocked_id IN (${idList})`, [...proceedingIds, ...proceedingIds])
  ).filter((b) => !deletedIds.has(b.blocker_id) && !deletedIds.has(b.blocked_id));
  const conflicts = (
    proceedingIds.length === 0
      ? []
      : rows<ConflictRow>(dbPath, `SELECT * FROM ticket_conflicts WHERE a_id IN (${idList}) OR b_id IN (${idList})`, [...proceedingIds, ...proceedingIds])
  ).filter((c) => !deletedIds.has(c.a_id) && !deletedIds.has(c.b_id));
  const steps = proceedingIds.length === 0 ? [] : rows<StepRow>(dbPath, `SELECT * FROM ticket_steps WHERE ticket_id IN (${idList})`, proceedingIds);
  const scopeRows = proceedingIds.length === 0 ? [] : rows<ScopeRow>(dbPath, `SELECT * FROM ticket_scope WHERE ticket_id IN (${idList})`, proceedingIds);
  const proposalRows =
    proceedingIds.length === 0 ? [] : rows<ProposalRow>(dbPath, `SELECT ticket_id, proposal_key, item FROM ticket_proposals WHERE ticket_id IN (${idList})`, proceedingIds);
  // A job's own records beyond its steps: every loose thread captured from it, outlined since or not, and every
  // answer saved for it. Its last activity reads both, and its card lists the answers.
  const captures =
    proceedingIds.length === 0 ? [] : rows<SeedCaptureRow>(dbPath, `SELECT origin_ticket_id, created FROM seeds WHERE origin_ticket_id IN (${idList})`, proceedingIds);
  const answerRows =
    proceedingIds.length === 0 || !ticketAnswersHeld(dbPath)
      ? []
      : rows<AnswerRow>(dbPath, `SELECT ticket_id, file_path, saved_at FROM ticket_answers WHERE ticket_id IN (${idList}) ORDER BY id`, proceedingIds);
  const sourceRows =
    proceedingIds.length === 0 || !ticketSourcesHeld(dbPath)
      ? []
      : rows<SourceRow>(dbPath, `SELECT ticket_id, kind, label, added_at, closed_at, outcome, reason FROM ticket_sources WHERE ticket_id IN (${idList}) ORDER BY id`, proceedingIds);

  const blockersOf = new Map<number, number[]>(); // blocked_id -> [blocker_id]
  for (const b of blocks) blockersOf.set(b.blocked_id, [...(blockersOf.get(b.blocked_id) ?? []), b.blocker_id]);
  const conflictsOf = new Map<number, number[]>();
  for (const c of conflicts) {
    conflictsOf.set(c.a_id, [...(conflictsOf.get(c.a_id) ?? []), c.b_id]);
    conflictsOf.set(c.b_id, [...(conflictsOf.get(c.b_id) ?? []), c.a_id]);
  }
  const stepsByTicket = groupBy(steps, (s) => s.ticket_id);
  const scopeByTicket = groupBy(scopeRows, (s) => s.ticket_id);
  const proposalsByTicket = groupBy(proposalRows, (p) => p.ticket_id);
  const capturesByTicket = groupBy(captures, (s) => s.origin_ticket_id);
  const answersByTicket = groupBy(answerRows, (a) => a.ticket_id);
  const sourcesByTicket = groupBy(sourceRows, (s) => s.ticket_id);
  const retiredOn = new Map(rows<FilingRetiredRow>(dbPath, "SELECT id, retired_on FROM filings WHERE proceeding_id = ?", [proceedingId]).map((f) => [f.id, f.retired_on]));
  const edge = (id: number): WorkBoardEdge => {
    const other = ticketById.get(id);
    return { id, status: other?.status ?? null, rejected: other !== undefined && other.status === "queued" && other.rejected_at !== null };
  };

  // A rejected ticket holds nothing: its angle is off the board, so the Proposal it was outlined
  // from is derived afresh rather than shown as already taken.
  const holders = new Map<string, { ticket_id: number; filing_id: number | null }>();
  for (const t of [...proceedingTickets].sort((a, b) => a.id - b.id)) {
    if (t.rejected_at !== null || (t.status !== "queued" && t.status !== "wip")) continue;
    for (const p of proposalsByTicket.get(t.id) ?? []) {
      if (!holders.has(p.proposal_key)) holders.set(p.proposal_key, { ticket_id: t.id, filing_id: t.filing_id });
    }
  }

  const tickets = proceedingTickets.map((t) => {
    const blockedBy = (blockersOf.get(t.id) ?? []).map(edge);
    const conflictPartners = (conflictsOf.get(t.id) ?? []).map(edge);
    const category = classify(t, blockedBy, conflictPartners, today);
    const ticket: WorkBoardTicket = {
      id: t.id,
      title: t.title,
      intent: t.intent,
      kind: t.kind,
      priority: t.priority,
      status: t.status,
      category,
      locked_by: t.locked_by,
      locked_at: t.locked_at,
      completed_at: t.completed_at,
      rejected_at: t.rejected_at,
      bf_on: t.bf_on ?? null,
      // A stale gate job pointed at a deleted replacement reads as superseded with no pointer.
      superseded_by: t.superseded_by === null || deletedIds.has(t.superseded_by) ? null : edge(t.superseded_by),
      scope: (scopeByTicket.get(t.id) ?? []).map((s) => (s.entity_id === null ? s.entity : `${s.entity}:${s.entity_id}`)),
      blocked_by: blockedBy,
      conflicts: conflictPartners,
      circular: category === "waiting" && reachesItself(t.id, blockersOf),
      steps: [...(stepsByTicket.get(t.id) ?? [])].sort((a, b) => a.ordinal - b.ordinal).map((s) => ({ ordinal: s.ordinal, text: s.text, done_at: s.done_at })),
      proposal_keys: (proposalsByTicket.get(t.id) ?? []).map((p) => p.proposal_key),
      proposal_items: Object.fromEntries((proposalsByTicket.get(t.id) ?? []).map((p) => [p.proposal_key, p.item])),
      superseded_reason: supersededReason(t, retiredOn),
      // Set by a filing's board, which holds the inventory the dead keys are read against.
      subtitle: null,
      eligible: false,
      // A board with no filing has no inventory; a filing's board replaces this.
      ineligible_reasons: ["no_inventory"],
      dispatch_skips: [],
      lock_note: category === "wip" && t.locked_by?.startsWith(UNATTENDED_TOKEN_PREFIX) ? "In progress with nobody present" : null,
      answers: (answersByTicket.get(t.id) ?? []).map((a) => ({ file_path: a.file_path, saved_at: a.saved_at })),
      sources: (sourcesByTicket.get(t.id) ?? []).map((s) => ({ kind: s.kind, label: s.label, outcome: s.outcome, reason: s.reason })),
      last_activity_at: latestStamp([
        t.locked_at,
        ...(stepsByTicket.get(t.id) ?? []).map((s) => s.done_at),
        ...(capturesByTicket.get(t.id) ?? []).map((s) => s.created),
        ...(answersByTicket.get(t.id) ?? []).map((a) => a.saved_at),
        ...(sourcesByTicket.get(t.id) ?? []).flatMap((s) => [s.added_at, s.closed_at]),
      ]),
    };
    return { filing_id: t.filing_id, ticket };
  });

  // Section 14 Dispatch's skip reasons, over every filing in the proceeding: substance tables are proceeding-scoped.
  const holding = tickets.map((t) => t.ticket).filter(holdsMaterial);
  for (const { ticket } of tickets) {
    if (ticket.category !== "ready") continue;
    if (ticket.title.startsWith("Counsel's review of ")) ticket.dispatch_skips.push({ reason: "practitioner_own" });
    for (const p of ticket.conflicts) if (p.status === "queued" && !p.rejected) ticket.dispatch_skips.push({ reason: "either_or", job: p.id });
    for (const held of holding) {
      if (held.id === ticket.id) continue;
      const material = ticket.scope.filter((s) => held.scope.some((h) => scopesShare(h, s)));
      if (material.length > 0) ticket.dispatch_skips.push({ reason: "shared_material", job: held.id, material });
    }
  }

  return { tickets, seeds: fetchOpenSeeds(dbPath, proceedingId, deletedIds), holders, deleted, discardedSeeds: fetchDiscardedSeeds(dbPath, proceedingId) };
}

function columnHeld(dbPath: string, table: string, column: string): boolean {
  return rows<{ n: number }>(dbPath, `SELECT COUNT(*) AS n FROM pragma_table_info('${table}') WHERE name = ?`, [column])[0].n > 0;
}

/** What makes a loose thread open, given its proceeding's deleted job ids: never outlined, or outlined
 * into a deleted job, and neither discarded nor suggested (schema v75; a database below it holds none
 * of either). fetchOpenSeeds reads with it and the Loose Threads page's Defer write guards with it. */
export function openSeedCondition(dbPath: string, deletedIds: ReadonlySet<number>): { sql: string; params: number[] } {
  const deletedList = [...deletedIds];
  const outlinedIntoDeleted = deletedList.length === 0 ? "" : ` OR charted_into IN (${deletedList.map(() => "?").join(",")})`;
  return { sql: `(charted_into IS NULL${outlinedIntoDeleted})${liveSeedClause(dbPath)}`, params: deletedList };
}

/** The proceeding's discarded and suggested loose threads, in id order; none on a database held below v75. */
export function fetchDiscardedSeeds(dbPath: string, proceedingId: number): DiscardedSeed[] {
  if (seedClosedColumns(dbPath).length < 2) return [];
  return rows<DiscardedSeed>(
    dbPath,
    "SELECT id, idea, filing_id, discarded_at, suggested_at FROM seeds WHERE proceeding_id = ? AND (discarded_at IS NOT NULL OR suggested_at IS NOT NULL) ORDER BY id",
    [proceedingId]
  );
}

/** A section's discarded and suggested loose threads, as its page draws them. */
const discardedSeedLines = (seeds: readonly DiscardedSeed[]): WorkBoardData["discardedSeeds"] =>
  seeds.map((s) => ({ id: s.id, idea: s.idea, discarded_at: s.discarded_at, suggested_at: s.suggested_at }));

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
  const ranking = columnHeld(dbPath, "seeds", "rank") ? "rank, rank_group, rank_reason" : "NULL AS rank, NULL AS rank_group, NULL AS rank_reason";
  // The job description (schema v70); a database below it holds none.
  const job = columnHeld(dbPath, "seeds", "rank_job") ? "rank_job" : "NULL AS rank_job";
  // The deferral (schema v68); a database below it holds no loose thread deferred.
  const deferral = columnHeld(dbPath, "seeds", "deferred_at") ? "deferred_at" : "NULL AS deferred_at";
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

/** The drafts on one board (ADR 0042), in id order; none on a database held below v67. A pre-filing
 * board (`filingId` null) holds every row of its proceeding. A Writing's board holds its own rows and,
 * only when it is the proceeding's lowest-id live Writing, the proceeding's rows with no Writing (rows
 * written by hand after the proceeding's first Writing, which create_writing does not re-point), so no
 * draft is ever on two boards. A Job Board with no Writing holds its own rows only and is never that Writing. */
export function fetchAttachments(dbPath: string, proceedingId: number, filingId: number | null): WorkBoardAttachment[] {
  if (!boardAttachmentsHeld(dbPath)) return [];
  return rows<WorkBoardAttachment>(
    dbPath,
    "SELECT id, filing_id, path, kind, attached_on FROM board_attachments WHERE proceeding_id = ? AND (? IS NULL OR filing_id = ? " +
      "OR (filing_id IS NULL AND ? = (SELECT MIN(id) FROM filings WHERE proceeding_id = ? AND retired_on IS NULL AND kind <> ?))) ORDER BY id",
    [proceedingId, filingId, filingId, filingId, proceedingId, JOB_BOARD_KIND]
  );
}

/** Each loose thread with the title of the sibling filing it was captured on, null when captured on
 * `filingId` itself or on none (ADR 0024 D11). */
export function withFromFiling(dbPath: string, proceedingId: number, filingId: number, seeds: readonly Omit<WorkBoardSeed, "from_filing">[]): WorkBoardSeed[] {
  const filingTitles = new Map(rows<FilingTitleRow>(dbPath, "SELECT id, title FROM filings WHERE proceeding_id = ?", [proceedingId]).map((f) => [f.id, f.title]));
  return seeds.map((s) => ({ ...s, from_filing: s.filing_id === null || s.filing_id === filingId ? null : filingTitles.get(s.filing_id) ?? null }));
}

/** True when a ticket belongs on `filingId`'s board (loose threads are proceeding-wide, ADR 0024 D11): its own tickets, plus proceeding-scoped ones
 * (filing_id IS NULL) -- design §5.1. A proceeding-scoped row appears identically on every
 * filing's board in its proceeding, by design. */
export function onFilingBoard(rowFilingId: number | null, filingId: number): boolean {
  return rowFilingId === filingId || rowFilingId === null;
}

/** The render context the board reads. `inventory` is null where no render recorded one (the
 * Proposals plan's paragraph labelled "Assumption, not a settled decision"): the Goal card then
 * reads pending, because an absent inventory matches no entry and would read falsely green (Goal
 * card design §2.4). An empty inventory is a render that printed no marker. */
type WorkBoardContext = Omit<RenderContext, "inventory"> & { inventory: MarkerInventory | null };

/** What proposalsFor reads of a render context, so the Sent write's hold can derive the same sets. */
interface ProposalScope {
  dbPath: string;
  proceeding: { id: number };
  filing: { id: number; retired_on: string | null };
  inventory: MarkerInventory | null;
}

/** A retired filing derives no Proposals (design §8): its work is over, and its render carries an
 * empty inventory anyway. Otherwise this render's inventory plus the proceeding's ticket and
 * rejection state give board_card's proposed lane and the board's Shelved lane, `shelved` names the keys
 * whose Proposal the practitioner rejected, and `current` names every key a Proposal derived for,
 * in any lane: the keyed rows at their current rung. */
function proposalsFor(
  ctx: ProposalScope,
  board: ProceedingBoard
): { proposals: Proposal[]; lapsed_keys: string[]; shelved: Set<string>; current: Set<string> } {
  if (ctx.filing.retired_on || ctx.inventory === null) return { proposals: [], lapsed_keys: [], shelved: new Set(), current: new Set() };

  const titles = new Map(rows<FilingTitleRow>(ctx.dbPath, "SELECT id, title FROM filings WHERE proceeding_id = ?", [ctx.proceeding.id]).map((f) => [f.id, f.title]));
  const holders = new Map<string, ProposalHolder>();
  for (const [key, h] of board.holders) {
    // Null on this board's own filing and on a proceeding-scoped ticket, so the shell prints
    // "already a job on X" without deriving anything (plan A2).
    const ticketedOn = h.filing_id === null || h.filing_id === ctx.filing.id ? null : titles.get(h.filing_id) ?? null;
    holders.set(key, { ticket_id: h.ticket_id, ticketed_on: ticketedOn });
  }
  // Proceeding-wide by construction of the keys, so no filing filter applies. A deleted job's
  // snapshot rows are ignored (jobs-closeout.md §10a): they hide nothing and never read as lapsed.
  const deletedIds = new Set(board.deleted.map((d) => d.id));
  const rejections = new Map<string, ProposalRejection>(
    rows<RejectionRow>(ctx.dbPath, "SELECT proposal_key, ticket_id, marker, item FROM proposal_rejections")
      .filter((r) => r.ticket_id === null || !deletedIds.has(r.ticket_id))
      .map((r) => [r.proposal_key, { ticket_id: r.ticket_id, marker: r.marker, item: r.item }])
  );
  // Shelved (Goal card design §2.4): a Proposal rejected directly, and one hidden behind the
  // rejected ticket it was outlined from. Both read off one more derivation that takes every
  // rejection row as direct, so the lapse, rung and holder rules stay deriveProposals's own. That
  // derivation hides no Proposal behind a ticket, so its keys are every current-rung key.
  const asDirect = new Map([...rejections].map(([key, r]) => [key, { ...r, ticket_id: null }]));
  const every = deriveProposals(ctx.inventory, holders, asDirect).proposals;
  const shelved = new Set(every.filter((p) => p.lane === "rejected").map((p) => p.key));
  const current = new Set(every.map((p) => p.key));
  const derived = deriveProposals(ctx.inventory, holders, rejections);
  // A note-up of a statute, regulation or rule takes one step per provision the filing cites. Read
  // only when such an authority printed 📇, since each read is a host-Python spawn.
  if (!ctx.inventory.some((e) => e.generating !== false && e.provision !== undefined)) return { ...derived, shelved, current };
  const kinds = [...LEGISLATION_KINDS];
  const pinpoints = rows<{ authority_id: number; pinpoint: string }>(
    ctx.dbPath,
    `SELECT sl.authority_id, sl.pinpoint FROM statements_of_law sl JOIN authorities a ON a.id = sl.authority_id
      WHERE sl.proceeding_id = ? AND a.kind IN (${kinds.map(() => "?").join(", ")}) AND a.killed_on IS NULL AND sl.pinpoint IS NOT NULL
      ORDER BY sl.id`,
    [ctx.proceeding.id, ...kinds]
  );
  const contentions = rows<{ contention: string }>(
    ctx.dbPath,
    `SELECT s.contention FROM filing_submissions fs JOIN submissions s ON s.id = fs.submission_id
      WHERE fs.filing_id = ? AND s.killed_on IS NULL ORDER BY fs.document, fs.ordinal`,
    [ctx.filing.id]
  ).map((r) => r.contention);
  return { ...derived, proposals: withNoteUpSteps(derived.proposals, ctx.inventory, pinpoints, contentions), shelved, current };
}

// ---------------------------------------------------------------------------------------------
// The Goal card (planning/1. Design/2026-09-21_goal-card-and-prepare-design.md §2). Derived here,
// in the render call that derives the Proposals and from the same inventory, and never stored.
// ---------------------------------------------------------------------------------------------

/** Whether one inventory entry is a member of a criterion (design §2.6, §2.7). */
type Member = (e: InventoryEntry) => boolean;

const slugs =
  (...members: ProposalSlug[]): Member =>
  (e) =>
    e.generating && members.includes(e.slug);

/** A glyph that never generates; with `instances`, only those instances of it. */
const glyph =
  (marker: NonGeneratingGlyph, ...instances: GlyphInstance[]): Member =>
  (e) =>
    !e.generating && e.marker === marker && (instances.length === 0 || (e.instance !== undefined && instances.includes(e.instance)));

/** Every non-generating ⬜ but the instance a declared orders criterion counts (design §2.7). */
const unchosenExcept =
  (instance: GlyphInstance): Member =>
  (e) =>
    !e.generating && e.marker === "⬜" && e.instance !== instance;

const anyOf =
  (...members: Member[]): Member =>
  (e) =>
    members.some((m) => m(e));

/** One inventory criterion. Every one counts only the documents that go to the forum. */
interface StockCriterion {
  id: CriterionId;
  text: string;
  members: Member;
}

const PRIMARY_AUTHORITY: StockCriterion = {
  id: "primary-authority",
  text: "Every proposition of law rests on primary authority",
  members: anyOf(slugs("doctrinal-basis", "primary-authority", "authority-rating"), glyph("🏅"), glyph("🚧", "proposition"), glyph("📖", "proposition")),
};
const EXCERPTS: StockCriterion = {
  id: "excerpts",
  text: "Every excerpt is quoted, pinpointed and checked",
  members: anyOf(slugs("authority-excerpt", "authority-pinpoint", "scrutinize"), glyph("🔬"), glyph("👃", "law")),
};
const NOTING_UP: StockCriterion = {
  id: "noting-up",
  text: "Note up all cited authorities",
  // 📇's non-generating instances: a statute, regulation or rule found repealed or archived (#1628),
  // and a citation in the text that no authorities row tracks (citation-scan.ts).
  members: anyOf(slugs("note-up"), glyph("📇")),
};
const EVIDENCE: StockCriterion = {
  id: "evidence",
  text: "Every fact is proved by evidence in hand",
  members: anyOf(
    slugs("exhibit-excerpt", "testimony-excerpt", "exhibit-pinpoint", "testimony-pinpoint", "interview", "draft-it", "sign-it", "swear-it", "serve-it", "enter-it"),
    glyph("👤"),
    glyph("👃", "fact"),
    glyph("🏆"),
    glyph("🚧", "fact")
  ),
};
const OPEN_ITEMS_TEXT = "Nothing is left open on the form";
/** Open items' members on every type, bar the ⬜ instance and the ↩️ other declared criteria may count. */
const OPEN_ITEMS_COMMON = anyOf(slugs("loose-thread", "factual-basis", "proposition", "not-recorded", "unchosen", "choose-template"), glyph("🧩"), glyph("🕵️"));
const COUNSEL_REVIEW: StockCriterion = { id: "counsel-review", text: "Counsel has reviewed every paragraph", members: glyph("🧐") };
/** The 🧩 line a general Writing declaring `recipients` prints with no To recipient (#1234). */
const NO_TO_RECIPIENT: Member = (e) => glyph("🧩")(e) && e.table === NO_TO_RECIPIENT_TABLE;

/** Every declared criterion but `open-items`, whose members depend on what else is declared. A Map,
 * so a stored name such as "constructor" finds nothing rather than a prototype member. */
const DECLARABLE_LIST: StockCriterion[] = [
  {
    id: "orders-sought",
    text: "Every order asked for has a legal basis and a submission behind it",
    members: anyOf(slugs("jurisdictional-basis", "unserved-petitum"), glyph("⬜", "associate-judge"), glyph("🚧", "order")),
  },
  { id: "orders-positioned", text: "Every order the applicant asks for has a position", members: glyph("⬜", "unpositioned-order") },
  PRIMARY_AUTHORITY,
  EXCERPTS,
  NOTING_UP,
  EVIDENCE,
  { id: "opposing-points", text: "Every opposing point is answered", members: glyph("↩️") },
  COUNSEL_REVIEW,
  // 📌 and 📍 on clause rows (shared/declared-layout.md section 6).
  { id: "terms-traced", text: "Every clause traces to the offer or acceptance", members: (e) => e.table === "clauses" && (e.marker === "📑" || e.marker === "📌" || e.marker === "📍") },
  { id: "recipients", text: "The Writing is addressed to a recipient", members: NO_TO_RECIPIENT },
];
const DECLARABLE = new Map<string, StockCriterion>(DECLARABLE_LIST.map((c) => [c.id, c]));

/** Open items: every ⬜ but the instance a declared orders criterion counts, ↩️ unless opposing
 * points counts it, and every 🧩 but the one a declared `recipients` counts, so no work marker on a
 * forum document goes uncounted, or counted twice (design §2.7). */
function openItems(declared: readonly string[]): StockCriterion {
  const counted = declared.includes("orders-sought") ? "associate-judge" : declared.includes("orders-positioned") ? "unpositioned-order" : null;
  const unchosen = counted === null ? glyph("⬜") : unchosenExcept(counted);
  const common: Member = declared.includes("recipients") ? (e) => OPEN_ITEMS_COMMON(e) && !NO_TO_RECIPIENT(e) : OPEN_ITEMS_COMMON;
  return {
    id: "open-items",
    text: OPEN_ITEMS_TEXT,
    members: declared.includes("opposing-points") ? anyOf(common, unchosen) : anyOf(common, unchosen, glyph("↩️")),
  };
}

/** The Writing's goal criteria: its stored layout's `goal_criteria`, in their declared order
 * (spec §5 "Job Board"; shared/declared-layout.md sections 5-6). Empty where the type declares
 * none, and on a row with no stored layout (a seeded test row; every real database is snapshotted
 * since v30). A name outside the vocabulary fails hard, naming the filing. `hearing-date` is
 * skipped: it is not an inventory criterion (hearingDateCriterion). */
function declaredCriteria(filing: FilingRow): StockCriterion[] {
  if (filing.layout_snapshot === null) return [];
  const raw = storedLayout(filing).layout.goal_criteria;
  if (raw === undefined) return [];
  const bad = (why: string): never => {
    throw new DataServerError(`Filing ${filing.id}: layout_snapshot's goal_criteria ${why}`, "invalid_layout_snapshot");
  };
  if (!Array.isArray(raw) || !raw.every((name) => typeof name === "string")) return bad("is not an array of names");
  const declared = raw as string[];
  return declared
    .filter((name) => name !== "hearing-date")
    .map((name) => (name === "open-items" ? openItems(declared) : DECLARABLE.get(name) ?? bad(`names "${name}", which is not a goal criterion`)));
}

/** The matter folders the Writing's jobs read: its stored layout's `ingest_inputs`
 * (shared/declared-layout.md section 5). Undefined on a row with no stored layout and on a type
 * declaring none. A value that is not an array of names fails hard, naming the filing. */
function declaredIngestInputs(filing: FilingRow): string[] | undefined {
  if (filing.layout_snapshot === null) return undefined;
  const raw = storedLayout(filing).layout.ingest_inputs;
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw) || !raw.every((name) => typeof name === "string")) {
    throw new DataServerError(`Filing ${filing.id}: layout_snapshot's ingest_inputs is not an array of names`, "invalid_layout_snapshot");
  }
  return raw as string[];
}

/** The hearing-date criterion (shared/declared-layout.md section 6): met once the filing's
 * hearing_details row records a hearing date. It records a fact only, and is not a drafting
 * criterion, so it prints after the gate and holds nothing. */
function hearingDateCriterion(dbPath: string, filing: FilingRow): GoalCriterion {
  const met = fetchHearingDate(dbPath, filing.id) !== null;
  return { id: "hearing-date", text: "The hearing date is recorded", state: met ? "met" : "unmet", outstanding: 0, items: [], source: "sqlite" };
}

/** The criteria the pre-send hold reads (#951 note; `recipients`, #1234). Counsel's review never
 * holds sending. */
const HELD_CRITERIA: readonly CriterionId[] = ["primary-authority", "excerpts", "noting-up", "recipients"];

/** Whether the Sent write holds this Writing before it is sent (jobs.md §14a): a Writing that needs
 * no forum parts, and any general-renderer Writing, a venue's `letter` included (#1236). Those are
 * the Writings `record_sent` records. A row with no stored layout is a seeded test row. */
export function holdsBeforeSend(filing: FilingRow): boolean {
  return filing.needs_forum_parts === 0 || (filing.layout_snapshot !== null && storedLayout(filing).layout.renderer === "general");
}

/** The documents that never go to the forum (design §2.2), by documentType: the one list. forms.ts
 * derives each document's neverDelivered tag from it, and the Goal card filters the inventory by it. */
export const NEVER_DELIVERED_DOCS: ReadonlySet<string> = new Set(["Counsel_brief", "Work_board"]);

/** Whether one inventory entry is work the `evidence` criterion counts, on a document that goes to
 * the forum: the Provable Facts page reads it per statement of fact (provable-facts-page.ts). */
export function isEvidenceWork(e: InventoryEntry): boolean {
  return !NEVER_DELIVERED_DOCS.has(e.doc) && EVIDENCE.members(e);
}

/** Met when no forum-document entry matches; pending with no inventory (design §2.4). Matches count
 * once per keyed row: a generating entry per (slug, row), as a Proposal does, and only while its key
 * is in `current` -- a row at a later rung of its ladder is not counted twice -- and any other per
 * (glyph, row), since one glyph is recorded once per edge and once per forum document printing its
 * line. A shelved Proposal's entries count as met and are named as such -- bar a note-up, which
 * stays open because /draft makes noting up mandatory before filing. A suppressed 👤 (schema v69)
 * counts as met too, listed last as 🤫 and named as suppressed. */
function inventoryCriterion(
  def: StockCriterion,
  forum: readonly InventoryEntry[] | null,
  shelved: ReadonlySet<string>,
  current: ReadonlySet<string>
): GoalCriterion {
  if (forum === null) return { id: def.id, text: def.text, state: "pending", outstanding: 0, items: [], source: "inventory" };
  const matches = new Map<string, InventoryEntry>();
  for (const e of forum) {
    if (!def.members(e)) continue;
    if (e.generating && !current.has(proposalKey(e))) continue;
    const key = e.generating ? proposalKey(e) : `${e.marker}:${e.table}:${e.id}`;
    if (!matches.has(key)) matches.set(key, e);
  }
  const open: string[] = [];
  const shelvedItems: string[] = [];
  const suppressed: InventoryEntry[] = [];
  for (const [key, e] of matches) {
    if (e.generating && e.slug !== "note-up" && shelved.has(key)) shelvedItems.push(`${e.item} — shelved by you`);
    else if (!e.generating && e.suppressed) suppressed.push(e);
    else open.push(e.item);
  }
  const items = [...open, ...shelvedItems, ...suppressed.map((e) => `🤫 ${e.item} — suppressed by you`)];
  return {
    id: def.id,
    text: def.text,
    state: open.length === 0 ? "met" : "unmet",
    outstanding: open.length,
    items,
    source: "inventory",
    ...(suppressed.length > 0
      ? { replaces: [...new Array<null>(open.length + shelvedItems.length).fill(null), ...suppressed.map((e) => e.marker)] }
      : {}),
  };
}

const GATE_TITLE = "Pre-filing consistency gate";
/** A Pass 2 finding job's fixed title (jobs-stock.md §3g): a position the firm's own prior
 * correspondence contradicts. While one is open the pre-send hold reads `position-conflict` unmet. */
export const POSITION_CONFLICT_TITLE = "Decide a position our own correspondence contradicts";
/** The job the Sent write's pre-send hold creates (jobs.md "Pre-send gate"). */
export const PRE_SEND_TITLE = "Pre-send gate";
/** Jobs identified by fixed title that the gate row's open-job reading leaves out (design §2.4): the
 * two gate jobs (jobs.md §14 and "Pre-send gate") and the stock jobs, which are not drafting work
 * (plan decision 3; jobs.md §3b). */
const UNCOUNTED_TITLES: ReadonlySet<string> = new Set([
  GATE_TITLE,
  PRE_SEND_TITLE,
  "Availability letter",
  "File and serve",
  "Application book",
  "Draft the letter",
  "Draft the Writing",
  "Deliver",
]);

/** Every counted job this board shows still to do, rejected jobs left out (design §2.4). Loose threads
 * are not jobs. While any is open the gate row is unmet and names them. A hand-outlined `File and serve …`
 * job is stock work too, or it would hold the gate it waits on. */
function openJobs(tickets: readonly WorkBoardTicket[]): WorkBoardTicket[] {
  return tickets.filter(
    (t) => (t.status === "queued" || t.status === "wip") && t.rejected_at === null && !UNCOUNTED_TITLES.has(t.title) && !t.title.startsWith("File and serve")
  );
}

const WAIVER = " — WAIVED: ";

/** The revision a gate step's check ran against: the ` [rev N]` token ending its text before any
 * waiver (plan, "Names this plan fixes"), so a waiver reason carrying the pattern is never read. */
function recordedRevision(text: string): number | null {
  const m = text.split(WAIVER)[0].match(/\[rev (\d+)\]$/);
  return m ? Number(m[1]) : null;
}

interface GateReading {
  criterion: GoalCriterion;
  present: boolean;
  open: number;
  /** Some step records a check run at the current revision (design §2.5). */
  current: boolean;
  /** How many counted jobs are open (openJobs). While any is, the row is unmet and names them. */
  jobs: number;
}

/** Which gate a Writing's `gate` row reads: the Pre-send gate job for a Writing the Sent write
 * holds (holdsBeforeSend), the pre-filing gate job for any other. */
interface GateKind {
  title: string;
  text: string;
  stale: string;
}
const PRE_FILING: GateKind = {
  title: GATE_TITLE,
  text: "The pre-filing checks are passed or waived",
  stale: "The pre-filing checks ran before the latest changes.",
};
const PRE_SEND: GateKind = {
  title: PRE_SEND_TITLE,
  text: "The pre-send checks are passed or waived",
  stale: "The pre-send checks ran before the latest changes.",
};

/** The Gate criterion, read off the board's gate job (design §2.4, §2.5). Unmet when the job is
 * absent, a step is open, or the gate is stale: no step records a check run at the current revision.
 * Setting filed_on moves the revision, so a filed filing's gate is never stale. Met or stale, it
 * names the date the checks ran, and met, each waived step, whose text carries the practitioner's
 * verbatim line. While a counted job is open it is unmet whatever the gate job reads, and names the
 * open jobs instead. */
function readGate(tickets: readonly WorkBoardTicket[], revision: number, filed: boolean, kind: GateKind, jobs: readonly WorkBoardTicket[]): GateReading {
  const criterion = (state: GoalState, outstanding: number, items: string[]): GoalCriterion =>
    jobs.length > 0
      ? { id: "gate", text: kind.text, state: "unmet", outstanding: jobs.length, items: jobs.map((t) => t.title), source: "sqlite" }
      : { id: "gate", text: kind.text, state, outstanding, items, source: "sqlite" };
  const gate = tickets.find((t) => t.title === kind.title && t.status !== "superseded");
  if (gate === undefined) return { criterion: criterion("unmet", 0, []), present: false, open: 0, current: false, jobs: jobs.length };
  const open = gate.steps.filter((s) => s.done_at === null);
  const revisions = gate.steps.map((s) => recordedRevision(s.text)).filter((n): n is number => n !== null);
  const current = revisions.length > 0 && Math.max(...revisions) >= revision;
  const reading = { present: true, open: open.length, current, jobs: jobs.length };
  if (open.length > 0) return { ...reading, criterion: criterion("unmet", open.length, open.map((s) => s.text)) };
  // A waived step's done_at is the waiver's; the run's own date is a step the run closed. With none,
  // the date is left out rather than read off a waiver.
  const ranOn = gate.steps
    .filter((s) => !s.text.includes(WAIVER) && s.done_at !== null)
    .map((s) => s.done_at as string)
    .sort()
    .at(-1);
  const ran = ranOn === undefined ? [] : [`checks run on ${ranOn.slice(0, 10)}`];
  if (!current && !filed) return { ...reading, criterion: criterion("unmet", 0, [kind.stale, ...ran]) };
  const waived = gate.steps.filter((s) => s.text.includes(WAIVER)).map((s) => s.text);
  return { ...reading, criterion: criterion("met", 0, [...ran, ...waived]) };
}

/** A Writing the Sent write holds: its `gate` row reads the Pre-send gate job as readGate
 * reads the pre-filing gate job. The Sent write creates that job only when a held criterion or the
 * currency check is unmet, so with no job the row reads those itself: met when none is unmet,
 * pending with no inventory. While a counted job is open it is unmet and names the open jobs, as
 * readGate's row does. */
function readPreSendGate(
  ctx: WorkBoardContext,
  tickets: readonly WorkBoardTicket[],
  filed: boolean,
  drafting: readonly GoalCriterion[],
  jobs: readonly WorkBoardTicket[]
): GateReading {
  if (tickets.some((t) => t.title === PRE_SEND_TITLE && t.status !== "superseded")) return readGate(tickets, ctx.revision, filed, PRE_SEND, jobs);
  const held = drafting.filter((c) => HELD_CRITERIA.includes(c.id));
  const currency = unmetCurrencyCriterion(ctx.dbPath, ctx.filing);
  const confirmed = unmetAuthorityConfirmedCriterion(ctx.filing);
  const conflict = unmetPositionConflictCriterion(ctx.dbPath, ctx.filing);
  const unmet = [
    ...held.filter((c) => c.state === "unmet"),
    ...(currency === null ? [] : [currency]),
    ...(confirmed === null ? [] : [confirmed]),
    ...(conflict === null ? [] : [conflict]),
  ];
  const state: GoalState = held.some((c) => c.state === "pending") ? "pending" : unmet.length > 0 ? "unmet" : "met";
  return {
    criterion:
      jobs.length > 0
        ? { id: "gate", text: PRE_SEND.text, state: "unmet", outstanding: jobs.length, items: jobs.map((t) => t.title), source: "sqlite" }
        : { id: "gate", text: PRE_SEND.text, state, outstanding: unmet.length, items: unmet.map((c) => c.text), source: "inventory" },
    present: false,
    open: 0,
    current: false,
    jobs: jobs.length,
  };
}

/** Design §2.9's gate and drafting rows, or null where none applies. The drafting criteria are the
 * rows above the Gate. While a counted job is open none applies. With every other row met, an unmet
 * `hearing-date` gives its own string, and an unmet deadline says only the drafting conditions hold.
 * `send` gives the "to send" variant, for a Writing the Sent write holds. */
function cardText(
  drafting: readonly GoalCriterion[],
  gate: GateReading,
  hearing: GoalCriterion | null,
  deadlines: readonly GoalCriterion[],
  send: boolean
): string | null {
  if (gate.jobs > 0) return null;
  if (drafting.every((c) => c.state === "met")) {
    if (gate.criterion.state === "met") {
      if (hearing?.state === "unmet") return "Only the hearing date remains to be recorded.";
      return `Every ${deadlines.some((c) => c.state !== "met") ? "drafting " : ""}condition holds. Awaiting your approval to ${send ? "send" : "file"}.`;
    }
    if (gate.present && gate.open === 0) return `Drafting conditions hold. ${(send ? PRE_SEND : PRE_FILING).stale}`;
    if (gate.current) return `Drafting conditions hold. ${send ? "Pre-send" : "Pre-filing"} checks: ${gate.open} open.`;
    return send
      ? "Every drafting condition holds. Recording it as sent runs the pre-send checks again."
      : "Every drafting condition holds. The next session assembles the package and runs the pre-filing checks.";
  }
  const reviewOnly = drafting.every((c) => c.state === "met" || (c.id === "counsel-review" && c.state === "unmet"));
  return reviewOnly ? "Only your review remains. Every other drafting condition holds." : null;
}

/** The card string of a type that declares no goal criteria (spec §5 "Job Board"). It never fires
 * the filing-ready declaration: its goal stays pending. */
const NO_CRITERIA_TEXT = "No completion criteria are declared for this type of Writing.";

/** The goal and its criteria (design §2.3). Retired, then filed or sent, then the gate and drafting
 * rows give the card string. The goal is met only when every criterion is, the linked deadlines
 * included, and pending where the type declares none or there is no inventory. */
function goalFor(
  ctx: WorkBoardContext,
  tickets: readonly WorkBoardTicket[],
  shelved: ReadonlySet<string>,
  current: ReadonlySet<string>,
  deadlines: readonly GoalCriterion[]
): { goal: Goal; criteria: GoalCriterion[] } {
  const sentence = "Completion Criteria";
  if (ctx.lifecycle.state === "retired") {
    const reason = ctx.filing.retirement_reason;
    return { goal: { sentence, state: "pending", text: `Retired on ${ctx.lifecycle.since}` + (reason ? ` — ${reason.replace(/_/g, " ")}` : "") }, criteria: [] };
  }
  const send = holdsBeforeSend(ctx.filing);
  // The label follows the lifecycle, which a venue's letter keeps as Filed.
  const filed = ctx.filing.filed_on === null ? null : `${ctx.filing.needs_forum_parts === 0 ? "Sent" : "Filed"} on ${ctx.filing.filed_on}`;
  const declared = declaredCriteria(ctx.filing);
  // No gate row here, so no currency reading either: this goal stays pending and never reads ready to send.
  if (declared.length === 0) return { goal: { sentence, state: "pending", text: filed ?? NO_CRITERIA_TEXT }, criteria: [] };

  const forum = ctx.inventory === null ? null : ctx.inventory.filter((e) => !NEVER_DELIVERED_DOCS.has(e.doc));
  const drafting = declared.map((c) => inventoryCriterion(c, forum, shelved, current));
  const jobs = openJobs(tickets);
  const gate = send ? readPreSendGate(ctx, tickets, filed !== null, drafting, jobs) : readGate(tickets, ctx.revision, filed !== null, PRE_FILING, jobs);
  // A non-empty `declared` means a stored layout whose goal_criteria declaredCriteria has already checked.
  const hearing = (storedLayout(ctx.filing).layout.goal_criteria as string[]).includes("hearing-date") ? hearingDateCriterion(ctx.dbPath, ctx.filing) : null;
  const criteria = [...drafting, gate.criterion, ...(hearing === null ? [] : [hearing]), ...deadlines];
  const state: GoalState = forum === null ? "pending" : criteria.every((c) => c.state === "met") ? "met" : "unmet";
  return { goal: { sentence, state, text: filed ?? cardText(drafting, gate, hearing, deadlines, send) }, criteria };
}

/** The declared held criteria (HELD_CRITERIA) that `inventory` leaves unmet on this Writing,
 * derived exactly as its Job Board derives them from the same inventory: the Sent write's hold
 * (#951 note). */
export function unmetHeldCriteria(dbPath: string, filing: FilingRow, inventory: MarkerInventory): GoalCriterion[] {
  const board = buildProceedingBoard(dbPath, filing.proceeding_id);
  const { shelved, current } = proposalsFor({ dbPath, proceeding: { id: filing.proceeding_id }, filing, inventory }, board);
  const forum = inventory.filter((e) => !NEVER_DELIVERED_DOCS.has(e.doc));
  return declaredCriteria(filing)
    .filter((c) => HELD_CRITERIA.includes(c.id))
    .map((c) => inventoryCriterion(c, forum, shelved, current))
    .filter((c) => c.state === "unmet");
}

/** The pre-send hold's universal currency check (jobs.md §14a), read live from the database: unmet
 * while an implied clause this Writing prints names an enactment whose stored statute-currency
 * result is not `current`; null when none does. */
export function unmetCurrencyCriterion(dbPath: string, filing: FilingRow): GoalCriterion | null {
  const withheld = currencyWithheldClauses(dbPath, filing.id, storedLayout(filing).layout.parts as LayoutPart[]);
  if (withheld.length === 0) return null;
  return {
    id: "currency",
    text: "No implied clause names an enactment whose statute-currency result is not current",
    state: "unmet",
    outstanding: withheld.length,
    items: withheld.map((c) => `clause_id ${c.clause_id} [currency: ${currencyLabel(c)}]`),
    source: "sqlite",
  };
}

/** The pre-send hold's authority-confirmed check (jobs.md §14a, after `currency`), read live from the
 * Writing's row: unmet while `authority_confirmed_on` is NULL on a Writing `authorityUnconfirmed`
 * names, cleared by setting it. Nothing parses the Writing's prose. */
export function unmetAuthorityConfirmedCriterion(filing: FilingRow): GoalCriterion | null {
  if (filing.layout_snapshot === null || !authorityUnconfirmed(filing, storedLayout(filing).layout)) return null;
  return {
    id: "authority-confirmed",
    text: "The Writing records that its cited authority is linked, or that it cites none",
    state: "unmet",
    outstanding: 1,
    items: ["link each authority the text cites, or record that it cites none"],
    source: "sqlite",
  };
}

/** The pre-send hold's position-conflict check (jobs-stock.md §3g; letter-passes spec §12 decision
 * 1), read live from the database: unmet while a queued or wip, unshelved Pass 2 finding job is on
 * the Writing, met once each is closed. Null when none is open. */
export function unmetPositionConflictCriterion(dbPath: string, filing: FilingRow): GoalCriterion | null {
  const open = rows<{ id: number }>(
    dbPath,
    `SELECT id FROM tickets WHERE filing_id = ? AND title = ? AND status IN ('queued', 'wip') AND rejected_at IS NULL${liveTicketClause(dbPath)} ORDER BY id`,
    [filing.id, POSITION_CONFLICT_TITLE]
  );
  if (open.length === 0) return null;
  return {
    id: "position-conflict",
    text: "Counsel has decided every position the firm's own correspondence contradicts",
    state: "unmet",
    outstanding: open.length,
    items: open.map((r) => `decide Job #${r.id}`),
    source: "sqlite",
  };
}

/** "N of M items no longer show their marker" (design §4.7): the live ticket's keys that no
 * generating entry in this render's inventory carries. Null with no inventory, since an absent
 * inventory would read every key as dead, and on a completed, superseded or rejected ticket, whose
 * work is no longer to do. */
function deadKeySubtitle(ticket: WorkBoardTicket, printed: ReadonlySet<string> | null): string | null {
  if (printed === null || ticket.rejected_at !== null || (ticket.status !== "queued" && ticket.status !== "wip")) return null;
  const dead = ticket.proposal_keys.filter((key) => !printed.has(key)).length;
  return dead === 0 ? null : `${dead} of ${ticket.proposal_keys.length} items no longer show their marker`;
}

/** The session token class an unattended run holds a lock with (plan decision 4), beside an
 * ordinary session's `sess-<hex>`. forms.ts mints it; the renderer reads it off `locked_by`. */
export const UNATTENDED_TOKEN_PREFIX = "sess-unattended-";

/** Design §5.2's eligible list, judged per marker instance: every work marker of work-markers.md
 * table 1a by glyph, with the keyed tables of its eligible instances. An empty list classifies the
 * marker out by name, so eligible-list.unit.test.mjs can tell "classified out" from "never seen". A
 * glyph absent here is ineligible too, so a marker added later fails closed. */
export const UNATTENDED_ELIGIBLE: ReadonlyMap<string, readonly string[]> = new Map<string, readonly string[]>([
  ["🧩", []],
  ["🏛️", []],
  ["📖", []],
  ["📜", []],
  ["📑", []],
  ["💬", []],
  ["📍", []],
  // The court-record instance, keyed on `facts` (actor: holder of the record), is out.
  ["📌", ["statements_of_fact", "admissions"]],
  ["🧷", ["statements_of_fact", "admissions"]],
  ["🔬", []],
  ["↩️", []],
  ["👃", []],
  ["📇", []],
  ["🏷️", ["documents"]],
  ["🕵️", []],
  ["⬜", []],
  ["👤", []],
  ["🗣️", []],
  ["✍️", []],
  ["🖋️", []],
  ["✒️", []],
  ["🎾", []],
  ["🕹️", []],
  ["🥉", []],
  ["🥈", []],
  ["🏅", []],
  ["🦵", []],
  ["🧵", []],
  ["🧾", []],
  ["📚", []],
  ["🧐", []],
]);

/** Whether a Proposal key names an eligible marker instance: its slug's glyph lists its table. */
function eligibleKey(key: string): boolean {
  const [slug, table] = key.split(":");
  return [...GLYPH_SLUGS].some(([glyph, s]) => s === slug && (UNATTENDED_ELIGIBLE.get(glyph) ?? []).includes(table));
}

/** An either/or partner that could still be done: queued or in progress and not rejected. One outside
 * this proceeding (status null) counts as live, as classify() treats such a blocker. */
const livePartner = (p: WorkBoardEdge): boolean => p.status === null || ((p.status === "queued" || p.status === "wip") && !p.rejected);

/** Whether two scope entries name common material: equal strings do, and a bare `entity` names
 * every `entity:<id>` of that table, in either direction. */
const scopesShare = (a: string, b: string): boolean => a === b || a.split(":")[0] === b || b.split(":")[0] === a;

/** The codes for design §5.3's conditions, plus #1051's shared material, in the fixed order a
 * ticket's reasons are listed. */
export const INELIGIBLE_REASONS = [
  "not_ready",
  "filing_filed",
  "no_inventory",
  "not_one_step",
  "no_proposal_keys",
  "dead_key",
  "reworded",
  "marker_not_eligible",
  "live_partner",
  "shared_material",
] as const;
export type IneligibleReason = (typeof INELIGIBLE_REASONS)[number];

/** Design §5.3's conditions, one code for each that fails; the ticket is eligible exactly when
 * none does. `titles` maps each key this render derived a Proposal for to that Proposal's fixed
 * text, so a printed key at a later rung matches nothing and reads as `reworded`. With no inventory, the dead-key and
 * reworded checks have nothing to read against and are left to the no-inventory code. `inProgress`
 * is every in-progress job in the proceeding, on any of its filings: substance tables are
 * proceeding-scoped, so sharing a scope entry with one is shared material (#1051). A job with no
 * scope entries shares nothing, and a job never shares with itself. */
function ineligibleReasons(
  ticket: WorkBoardTicket,
  filed: boolean,
  printed: ReadonlySet<string> | null,
  titles: ReadonlyMap<string, string>,
  inProgress: readonly WorkBoardTicket[]
): IneligibleReason[] {
  const texts = [ticket.title, ticket.intent, ...ticket.steps.slice(0, 1).map((s) => s.text)];
  const failing: Record<IneligibleReason, boolean> = {
    not_ready: ticket.category !== "ready",
    filing_filed: filed,
    no_inventory: printed === null,
    not_one_step: ticket.steps.length !== 1,
    no_proposal_keys: ticket.proposal_keys.length === 0,
    dead_key: printed !== null && ticket.proposal_keys.some((key) => !printed.has(key)),
    reworded: printed !== null && ticket.proposal_keys.some((key) => printed.has(key) && texts.some((text) => text !== titles.get(key))),
    marker_not_eligible: ticket.proposal_keys.some((key) => !eligibleKey(key)),
    live_partner: ticket.conflicts.some(livePartner),
    shared_material: inProgress.some((held) => held.id !== ticket.id && held.scope.some((h) => ticket.scope.some((s) => scopesShare(h, s)))),
  };
  return INELIGIBLE_REASONS.filter((reason) => failing[reason]);
}

/** A minute-precision local stamp (`2026-09-02T10:05`, `2026-10-02 09:00`) in whole minutes, or
 * null when it does not read as one. */
export function localMinutes(stamp: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(stamp);
  return m === null ? null : Math.round(new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime() / 60_000);
}

/** The ticket with its idle flag when it is an In progress job whose last activity lies more than
 * `hours` (the firm's idle_flag_hours) before the section's Rendered minute. The text names the
 * threshold, not the elapsed time, so it changes once at the crossing and never churns board_changed. */
function withIdleFlag(t: WorkBoardTicket, rendered: string, hours: number | null): WorkBoardTicket {
  if (hours === null || t.category !== "wip") return t;
  const now = localMinutes(rendered);
  const last = t.last_activity_at === null ? null : localMinutes(t.last_activity_at);
  if (now === null || last === null || now - last <= hours * 60) return t;
  return { ...t, idle_flag: `idle past ${hours} h` };
}

/** `deadlines` are the dateless Goal criteria of the anchors linked to this filing in practice data
 * (matter-dates.ts deadlineCriteria); they print after `gate` and `hearing-date`. */
export function buildWorkBoardData(ctx: WorkBoardContext, deadlines: readonly GoalCriterion[] = []): WorkBoardData {
  if (isJobOnlyBoard(ctx.filing)) return buildJobOnlyBoardData(ctx);
  const board = buildProceedingBoard(ctx.dbPath, ctx.proceeding.id, ctx.rendered.slice(0, 10));
  const idleHours = idleFlagHours(process.env);
  const printed = ctx.inventory === null ? null : new Set(ctx.inventory.flatMap((e) => (e.generating ? [proposalKey(e)] : [])));
  const { proposals, lapsed_keys, shelved, current } = proposalsFor(ctx, board);
  const titles = new Map(proposals.map((p) => [p.key, p.title]));
  const filed = ctx.filing.filed_on !== null;
  // Read before the filing filter: a job in progress on a sibling filing holds proceeding material too.
  const inProgress = board.tickets.map((t) => t.ticket).filter(holdsMaterial);
  const tickets = board.tickets
    .filter((t) => onFilingBoard(t.filing_id, ctx.filing.id))
    .map((t) => {
      const ineligible_reasons = ineligibleReasons(t.ticket, filed, printed, titles, inProgress);
      const eligible = ineligible_reasons.length === 0;
      return withIdleFlag({ ...t.ticket, eligible, ineligible_reasons, subtitle: eligible ? "can be picked up with nobody present" : deadKeySubtitle(t.ticket, printed) }, ctx.rendered, idleHours);
    });
  // Every open loose thread in the proceeding, so none strands on a sibling filing (ADR 0024 D11).
  const seeds = withFromFiling(ctx.dbPath, ctx.proceeding.id, ctx.filing.id, board.seeds);
  const { goal, criteria } = goalFor(ctx, tickets, shelved, current, deadlines);
  // Section 14 Dispatch's last skip reason, read off this filing's gate row: a new array, since
  // dispatch_skips is shared with the proceeding board's ticket.
  const gate = criteria.find((c) => c.id === "gate");
  const gated =
    gate === undefined || gate.state === "met"
      ? tickets
      : tickets.map((t): WorkBoardTicket => (t.category === "ready" && t.title.startsWith("File and serve") ? { ...t, dispatch_skips: [...t.dispatch_skips, { reason: "before_gate" }] } : t));
  const folders = declaredIngestInputs(ctx.filing);
  // This filing's own Ready jobs: a proceeding-wide job has no filing, so no declared inputs.
  const readyJobs = board.tickets.filter((t) => t.filing_id === ctx.filing.id && t.ticket.category === "ready").map((t) => t.ticket.id);

  return {
    meta: {
      revision: ctx.revision,
      matter: ctx.matterNo,
      client: ctx.clientName,
      file: ctx.proceeding.file_number ?? "",
      filing: ctx.filing.title,
      filing_id: ctx.filing.id,
      proceeding_id: ctx.proceeding.id,
      rendered: ctx.rendered,
      state: ctx.lifecycle.state,
      state_label: LIFECYCLE_LABELS[ctx.lifecycle.state],
      state_since: ctx.lifecycle.since,
      ready_to_retire: ctx.lifecycle.readyToRetire,
      ...(folders !== undefined ? { ingest_inputs: { folders, ready_jobs: readyJobs } } : {}),
    },
    tickets: gated,
    seeds,
    deleted: board.deleted.filter((d) => onFilingBoard(d.filing_id, ctx.filing.id)).map((d) => ({ id: d.id, title: d.title })),
    discardedSeeds: discardedSeedLines(board.discardedSeeds),
    attachments: fetchAttachments(ctx.dbPath, ctx.proceeding.id, ctx.filing.id),
    proposals,
    lapsed_keys,
    goals: fetchBoardGoals(ctx.dbPath, { filing_id: ctx.filing.id, proceeding_id: ctx.proceeding.id }, `${ctx.filing.title} Drafting`),
    goal,
    criteria,
  };
}

/** The State row of a proceeding with no filing (ADR 0018), shared with its Matter Board card. */
export function preFilingLabel(proceeding: ProceedingRow): string {
  return proceeding.forum === null ? "Forum not yet chosen" : "No filing yet";
}

/** The State row of a Job Board with no Writing, shared with its Litigation Strategy line. */
export function jobBoardLabel(filing: Pick<FilingRow, "retired_on">): string {
  return filing.retired_on ? "Closed" : "Open";
}

/** A Job Board with no Writing (JOB_BOARD_KIND): only the jobs, deleted jobs, open loose threads and
 * attachments whose filing_id is its own, so a proceeding-wide row (filing_id NULL) stays on the
 * Writings' boards. No stored layout is read: it has no lifecycle, Goal card, criteria, Proposals or
 * ingest inputs. */
function buildJobOnlyBoardData(ctx: WorkBoardContext): WorkBoardData {
  const board = buildProceedingBoard(ctx.dbPath, ctx.proceeding.id, ctx.rendered.slice(0, 10));
  const idleHours = idleFlagHours(process.env);
  const own = ctx.filing.id;
  return {
    meta: {
      revision: ctx.revision,
      matter: ctx.matterNo,
      client: ctx.clientName,
      file: ctx.proceeding.file_number ?? "",
      filing: ctx.filing.title,
      filing_id: own,
      proceeding_id: ctx.proceeding.id,
      rendered: ctx.rendered,
      state: null,
      state_label: jobBoardLabel(ctx.filing),
      state_since: ctx.filing.retired_on,
      ready_to_retire: false,
      job_only: true,
    },
    tickets: board.tickets.filter((t) => t.filing_id === own).map((t) => withIdleFlag(t.ticket, ctx.rendered, idleHours)),
    seeds: board.seeds.filter((s) => s.filing_id === own).map((s) => ({ ...s, from_filing: null })),
    deleted: board.deleted.filter((d) => d.filing_id === own).map((d) => ({ id: d.id, title: d.title })),
    discardedSeeds: discardedSeedLines(board.discardedSeeds.filter((s) => s.filing_id === own)),
    attachments: fetchAttachments(ctx.dbPath, ctx.proceeding.id, own),
    proposals: [],
    lapsed_keys: [],
    goals: fetchBoardGoals(ctx.dbPath, { filing_id: own, proceeding_id: ctx.proceeding.id }, ctx.filing.title),
  };
}

/** A proceeding with no filing (ADR 0018): every ticket and open loose thread in it. No filing, so no
 * lifecycle, and no Proposals, which a filing's render derives. */
export function buildPreFilingBoardData(
  dbPath: string,
  proceeding: ProceedingRow,
  meta: { revision: number; matter: string; client: string; rendered: string }
): WorkBoardData {
  const board = buildProceedingBoard(dbPath, proceeding.id, meta.rendered.slice(0, 10));
  const idleHours = idleFlagHours(process.env);
  return {
    meta: {
      revision: meta.revision,
      matter: meta.matter,
      client: meta.client,
      file: proceeding.file_number ?? "",
      filing: "",
      filing_id: null,
      proceeding_id: proceeding.id,
      rendered: meta.rendered,
      state: null,
      state_label: preFilingLabel(proceeding),
      state_since: null,
      ready_to_retire: false,
    },
    tickets: board.tickets.map((t) => withIdleFlag(t.ticket, meta.rendered, idleHours)),
    seeds: board.seeds.map((s) => ({ ...s, from_filing: null })),
    deleted: board.deleted.map((d) => ({ id: d.id, title: d.title })),
    discardedSeeds: discardedSeedLines(board.discardedSeeds),
    attachments: fetchAttachments(dbPath, proceeding.id, null),
    proposals: [],
    lapsed_keys: [],
    goals: fetchBoardGoals(dbPath, { filing_id: null, proceeding_id: proceeding.id }, `Proceeding ${proceeding.id}`),
  };
}
