// drafting_forms__bootstrap's response type.

import { type BuildStampStatus } from "../../build-stamp.js";
import { type SchemaSourceStatus } from "../schema-ceiling.js";
import { type RenderState } from "../render-manifest.js";
import { type MockupMove } from "../writing-folder.js";
import { type ProceedingRow } from "./query.js";
import { type LifecycleState } from "./lifecycle.js";
import { type PagesWritten } from "../matter-pages.js";
import { type PhaseTimings } from "./timings.js";

/** Carries the build-stamp fields (issue #452) on every response, refusals included -- a server
 * running pre-rebuild code can refuse wrongly just as it can render wrongly. */
export interface BootstrapResult extends BuildStampStatus, SchemaSourceStatus {
  db_path: string;
  schema_version: number | null;
  current_schema_version: number;
  migration_required: boolean;
  /** True only when the database is ahead of the installed plugin bundle (issue #352) -- distinguishes this refusal from `migration_required`'s. */
  bundle_outdated: boolean;
  /** Every filing of every proceeding, **in the order to present them in** -- the array order is
   * the whole of that signal, and no field here says anything about what produced it.
   *
   * A retired filing (schema v17) is listed like any other, because recovery has to find it, but
   * reports no paths: its mockups stand as they were at retirement. `lifecycle` is present on
   * every entry; `paths` is what is on disk, since this call renders nothing (#584). */
  filings: {
    filing_id: number;
    title: string;
    paths: string[];
    lifecycle: LifecycleState;
    /** Whether this filing's mockups would need rendering (#582): `fresh` when the manifest's
     * stamp and parties digest (#1308) match what a render now would use and every file it lists
     * is present, `never` when there is no manifest, `stale` otherwise. Read from the manifest,
     * directory entries and the parties' values -- no mockup file is opened, since the draft folder is cloud-synced and reading
     * a placeholder would cost a download here (#581 §5). Absent on a retired filing, whose
     * mockups stand as they were at retirement. */
    render_state?: RenderState;
    retired_on?: string;
    retirement_reason?: string;
    /** True only on a Milestone with no Writing (forms/query.ts MILESTONE_KIND): listed so a session
     * can find it, never a Writing, with no paths and no render_state, since it has no mockup. */
    milestone_only?: true;
    /** True only on a research memo or case brief Writing (forms/query.ts isResearchWriting): listed so a
     * session can find it. It has no board, and session entry opens it only when `filing_id` names it. */
    research_writing?: true;
  }[];
  /** Present only on success (ADR 0018): every proceeding with no filing, in id order, with its forum
   * (null while not yet chosen). Each is a section of the Milestone, rendered from proceeding_id. */
  pre_filing_proceedings?: { proceeding_id: number; forum: ProceedingRow["forum"] }[];
  /** Present only on success (#585): the Litigation Strategy written into the caller's draft_dir, or null
   * when no draft_dir was given. A path, never the board's data (#337). */
  matter_board_path?: string | null;
  /** Present only on success (#1365, ADR 0033's 2026-10-05 amendment): every Milestone page written
   * beside the Litigation Strategy, one per live filing then one per pre-filing proceeding, in page order;
   * null on the same terms. */
  milestone_paths?: PagesWritten["milestone_paths"] | null;
  /** Present only on success: every view page written beside them, each live filing's (ADR 0033,
   * 2026-10-07 amendment), [{name, filing_id, path}]; null on the same terms. */
  view_page_paths?: PagesWritten["view_page_paths"] | null;
  /** Present on the same terms: the matter's Loose Threads page. */
  loose_threads_path?: string | null;
  /** Old page files this call's page write moved into the matter's TRASH (#1365 D3). */
  moved_to_trash?: PagesWritten["moved_to_trash"];
  /** Old page files that page write could not move, and why. */
  trash_skipped?: PagesWritten["trash_skipped"];
  /** Each folder of an older build's `<case data>\mockups\` tree this call moved into 0. DRAFT, once per matter. */
  mockups_moved?: MockupMove[];
  /** Present only on success (ADR 0009, #609) -- a freshly minted opaque identity for THIS
   * session, unique per bootstrap call. A ticket-driven session uses it as tickets.locked_by and
   * passes it back to every later drafting_forms__render, which echoes it. Deliberately not
   * derived from the server process: under Cowork one server is shared by every session on the
   * machine (#586), so a process-derived token could not tell two sessions apart. */
  session_token?: string;
  /** Present only on success (#609) -- this session's own start stamp, local wall clock at
   * YYYY-MM-DD HH:mm: the same clock and granularity tickets.locked_at is written on and
   * RenderResult.rendered_at reports. A wip ticket whose locked_at precedes this was locked
   * before this session existed, so it is another session's, whatever its locked_by says.
   * Without it the earliest anchor a session had was its first render, leaving the
   * bootstrap-to-first-render window -- exactly when a second session is also starting up --
   * uncovered. */
  bootstrapped_at?: string;
  /** Present only on success (2026-09-14 local-only design) -- the hosted Practice Board artifact URL this
   * matter still records from the retired artifact design, or null. Read from
   * db_meta.workboard_artifact_url, so a session can offer its one-time cleanup: delete the hosted
   * artifact, then clear the key. No migration clears it, since only a session can delete the artifact. */
  legacy_workboard_artifact_url?: string | null;
  /** Present on either refusal -- what was skipped and what to do. */
  note?: string;
  /** On every response (#579). Each rendered filing's own render phases follow, prefixed `filing <id>: `. */
  timings: PhaseTimings;
}
