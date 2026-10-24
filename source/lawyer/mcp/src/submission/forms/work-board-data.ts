// One Job Board section's data, its Goal card and criteria types, and the render context it reads.

import type { BoardGoals } from "./board-goals.js";
import type { LifecycleState } from "./lifecycle.js";
import type { MarkerInventory, Proposal } from "./proposal-inventory.js";
import type { RenderContext } from "./render-vaniac-submissions.js";
import type { WorkBoardAttachment } from "./work-board-reads.js";
import type { WorkBoardTicket } from "./work-board-ticket.js";
import type { DiscardedSeed, WorkBoardSeed } from "./work-board-seeds.js";

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
  /** An inventory criterion two of whose items print the same text only: one entry per item, by
   * index, the row it was merged on (its Proposal key, or `<marker>:<table>:<id>`), so board_card can
   * print such items once and still say where each sits. Null for an item no row locates. Absent
   * otherwise. */
  locators?: (string | null)[];
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
    /** Present only when the filing's stored layout declares `ingest_inputs`: those document types, and the
     * ids of this filing's own Ready jobs (never a proceeding-wide job's). Absent on a pre-filing board. */
    ingest_inputs?: { types: string[]; ready_jobs: number[] };
    /** True only on a Job Board with no Writing (JOB_BOARD_KIND): `state` is null, `state_label` reads
     * Open or Closed, and the section has no Goal card, criteria or Proposals. */
    job_only?: true;
    /** A merged board only (combined-board.ts): each section's own state, the survivor's first.
     * `state_label` then lists them all and `ready_to_retire` is false. Absent otherwise. */
    writing_states?: { filing_id: number | null; proceeding_id: number; title: string; state_label: string; state_since: string | null; ready_to_retire: boolean }[];
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

/** The sibling data script the board used from 2026-09-14 to 2026-09-15. Kept only as a name renders delete. */
export const WORKBOARD_DATA_FILE = "workboard-data.js";

/** The render context the board reads. `inventory` is null where no render recorded one (the
 * Proposals plan's paragraph labelled "Assumption, not a settled decision"): the Goal card then
 * reads pending, because an absent inventory matches no entry and would read falsely green (Goal
 * card design §2.4). An empty inventory is a render that printed no marker. */
export type WorkBoardContext = Omit<RenderContext, "inventory"> & { inventory: MarkerInventory | null };
