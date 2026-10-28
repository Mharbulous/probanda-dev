// The RenderContext a render builds, its stamp and its render-state helpers.

import { submissionDataQuery } from "../backend.js";
import { renderState, type RenderState, type RenderStamp } from "../render-manifest.js";
import { fetchHearingDate, requireForum, type FilingRow, type PartyRow, type ProceedingRow } from "./query.js";
import type { MarkerInventory } from "./proposal-inventory.js";
import { fetchReviewState, type ReviewState } from "./review-state.js";
import type { PointerDocument } from "./submission-reads.js";
import { storedLayout, type StoredLayout } from "./layout-snapshot.js";
import { deriveLifecycle, type Lifecycle } from "./lifecycle.js";
import { nowStamp } from "./timings.js";

export type RenderMode = "mockup" | "filed";

/** What a venue renderer actually assigned to one submission's contention paragraph. */
export interface LedgerEntry {
  document: PointerDocument;
  para: number;
}

export interface RenderContext {
  dbPath: string;
  proceeding: ProceedingRow;
  parties: PartyRow[];
  filing: FilingRow;
  revision: number;
  rendered: string;
  clientName: string;
  clientNo: string;
  matterNo: string;
  /** The matter's description from practice data, "" when the caller resolved none. */
  matterDescription: string;
  /**
   * submission_id -> the paragraph number and source document a venue renderer actually assigned
   * to that submission's contention. Written first-write-wins by every renderSubmissionParagraphs
   * call site; read only by recordReserveInventory, which reproduces the venue numbering rather than
   * re-deriving it (each venue document has its own base offset -- NoA Part 3 restarts at 1, the
   * Application Response continues from Part 4's fact count, the BCCA response book runs one
   * counter across the whole document, Written Arguments starts at 1). That walk must therefore
   * stay LAST in forms.ts's documentsForFiling, after every renderer that fills this. Required,
   * not optional, so a future RenderContext construction site cannot silently forget it.
   * Per-filing: buildContext creates a fresh Map for each render.
   */
  paragraphLedger: Map<number, LedgerEntry>;
  /** The filing's derived lifecycle state (schema v17, forms/lifecycle.ts). Read by the Work
   * Board only -- no advocacy document shows it. Required, not optional, so a future
   * RenderContext construction site cannot silently forget it. */
  lifecycle: Lifecycle;
  /**
   * Every generating work-marker glyph this render emitted, recorded at its emit site on the row
   * the work is done on (Work Board Proposals design §8; forms/proposal-inventory.ts), plus the
   * glyphs a Goal-card criterion counts although they never generate, flagged `generating: false`
   * (Goal card design §2.2). forms.ts stamps each entry with the document that emitted it. The Milestone
   * derives its proposed and Shelved lanes from it, and render-manifest.json saves
   * it so a stamp hit derives the same lanes without re-rendering. Every mockup render builds all
   * documents before the board, so the inventory is complete by the time the board reads it -- the
   * ORDER IS LOAD-BEARING comment in forms.ts's documentsForFiling is what guarantees that.
   * Required, not optional, for the same reason as paragraphLedger above.
   */
  inventory: MarkerInventory;
  /**
   * Every reviewed object's current snapshot and latest approval (fetchReviewState; the
   * /drafting-data reference review.md). Read by the forum emit sites through reviewMarkerFor,
   * which prints 🧐 final review; the reserve inventory never reads it. Required, not optional, so
   * a future RenderContext construction site cannot forget it.
   */
  review: ReviewState;
}

export interface ClientContext {
  clientName?: string;
  clientNo?: string;
  matterNo?: string;
  /** The matter's description from practice data's matter lookup, for board_summary's header and
   * the mockup header's `Matter Description:`. */
  matterDescription?: string;
}

export function buildContext(
  dbPath: string,
  proceeding: ProceedingRow,
  filing: FilingRow,
  /** partiesFor's rows: what every renderer reads for parties and counsel. */
  parties: PartyRow[],
  revision: number,
  client: ClientContext,
  appealDeadline?: string,
  /** The call's single clock reading (#581 §4). Every date this context derives -- the
   * `Rendered:` stamp, the lifecycle's today, the admission ladder's today -- comes from
   * this one value, so a determinism test pins it instead of normalising `Rendered:` lines. */
  now: string = nowStamp()
): RenderContext {
  const rendered = now;
  return {
    dbPath,
    proceeding: requireForum(proceeding, filing.needs_forum_parts === 1),
    parties,
    filing,
    revision,
    rendered,
    // Lifecycle (schema v17): derived here, once per render, from the filing's own dates, its
    // hearing_details row, and the caller-supplied appeal deadline -- `today` is `rendered`'s own
    // date part, so the board's state and its Rendered stamp can never disagree.
    lifecycle: deriveLifecycle(filing, fetchHearingDate(dbPath, filing.id), rendered.slice(0, 10), appealDeadline),
    clientName: client.clientName ?? proceeding.matter_reference,
    clientNo: client.clientNo ?? "",
    matterNo: client.matterNo ?? "",
    matterDescription: client.matterDescription ?? "",
    // Fresh per filing: every renderSubmissionParagraphs call site fills it, recordReserveInventory
    // reads it back. See the field's own doc comment on RenderContext.
    paragraphLedger: new Map(),
    // Fresh per filing: every emit site that prints a generating glyph appends to it, and the
    // Milestone reads it back last. See the field's own doc comment on RenderContext. The
    // filed-face emitters and the pre-filing check build a context through here too and simply
    // carry the empty array -- neither renders the board.
    inventory: [],
    // Read once per render; the forum emit sites print 🧐 from it. The filed-face emitters and the
    // pre-filing check carry it too and never read it.
    review: fetchReviewState(dbPath, proceeding.id),
  };
}

/** Greatest review_approvals.id, 0 with none -- the stamp's `approvals` field. An approval moves no
 * revision, so this is what makes a render after one miss the manifest (practitioner-review plan
 * Phase 5). */
export function fetchApprovalsMark(dbPath: string): number {
  const found = submissionDataQuery(dbPath, "SELECT COALESCE(MAX(id), 0) AS mark FROM review_approvals", []).rows as unknown as { mark: number }[];
  return found[0].mark;
}

/** The render stamp (#581 §1) a render of this filing with these client fields would carry now. The one
 * construction shared by render, bootstrap's render_state and the background job's freshness check, so
 * the three cannot disagree about what "fresh" means. */
export function stampFor(
  filingId: number,
  proceeding: ProceedingRow,
  client: ClientContext,
  now: string,
  revision: number,
  schemaVersion: number | null,
  buildStamp: string | null,
  approvals: number
): RenderStamp {
  return {
    filing_id: filingId,
    revision,
    approvals,
    schema_version: schemaVersion,
    build_stamp: buildStamp,
    client_name: client.clientName ?? proceeding.matter_reference,
    client_no: client.clientNo ?? "",
    matter_no: client.matterNo ?? "",
    date: now.slice(0, 10),
  };
}

/** The Writing's stored layout, or null for a row with none (a seeded test row; every real database
 * is snapshotted since v30). */
export function layoutFor(filing: FilingRow): StoredLayout | null {
  return filing.layout_snapshot === null ? null : storedLayout(filing);
}

/** A general Writing's stored layout, or null for a bespoke one. */
export function generalLayoutFor(filing: FilingRow): StoredLayout | null {
  const stored = layoutFor(filing);
  return stored !== null && stored.layout.renderer === "general" ? stored : null;
}

/** Whether a general Writing's stored layout cites an item, whose live confirmation status tags its
 * mockup outside the render stamp: such a Writing is never served from its manifest. */
export function hasLiveTags(general: StoredLayout | null): boolean {
  return general !== null && Object.keys(general.passage_hashes).length > 0;
}

/** The render state of a filing's mockups on disk, against partiesDigest's value for it. A Writing with
 * live tags is never `fresh`: the render never serves it from the manifest, so neither does the freshness check. */
export function renderStateFor(dbPath: string, stamp: RenderStamp, filing: FilingRow, digest: string): RenderState {
  const state = renderState(dbPath, filing.id, stamp, digest);
  return state === "fresh" && hasLiveTags(generalLayoutFor(filing)) ? "stale" : state;
}
