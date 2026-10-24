// The background render job a bootstrap starts.

import { dirname } from "node:path";

import { buildStampStatus } from "../../build-stamp.js";
import { type RenderState } from "../render-manifest.js";
import { backgroundJobStatus, startRenderJob, type BackgroundJob } from "../render-job.js";
import { fetchProceeding, fetchRevision } from "./query.js";
import { type MatterDates } from "../matter-dates.js";
import { DATES_NOT_READ, persistedTodos, writeMatterPages } from "../matter-pages.js";
import { type BootstrapResult } from "./bootstrap-result.js";
import { fetchFilingById, readSchemaVersion } from "./filing-reads.js";
import { submissionFormsRender } from "./render.js";
import { type ClientContext, fetchApprovalsMark, stampFor, renderStateFor } from "./render-context.js";
import { nowStamp } from "./timings.js";
import { partiesFor, partiesDigest } from "./writing-parties.js";

/** Whether this filing's mockups on disk are what a render with these client fields would write now. */
function renderStateOf(dbPath: string, filingId: number, client: ClientContext): RenderState {
  const filing = fetchFilingById(dbPath, filingId);
  const proceeding = fetchProceeding(dbPath, filing.proceeding_id);
  const stamp = stampFor(filing.id, proceeding, client, nowStamp(), fetchRevision(dbPath), readSchemaVersion(dbPath), buildStampStatus().build_stamp, fetchApprovalsMark(dbPath));
  return renderStateFor(dbPath, stamp, filing, partiesDigest(partiesFor(dbPath, proceeding, filing)));
}

/**
 * Starts the background render job (#589) for a successful bootstrap, or joins the one already
 * running. A refusal starts nothing and reports whatever job status is already recorded. Kept out of submissionFormsBootstrap so a caller that only
 * wants the listing -- a test, above all -- starts no job: the two tool entry points
 * (drafting_forms__bootstrap and open_session) call this after bootstrapping.
 *
 * The queue is every live filing bootstrap reported as not fresh, in the order it listed them, and
 * only when all three client fields were supplied (#588 §6): a stamp built from the fallbacks would
 * miss at step 6 anyway. An empty queue still starts a job, which writes `done` at once and so
 * replaces a status file a killed job left behind. After each filing it renders, the job rewrites
 * that filing's pages and the Litigation Strategy, and after the last every page bootstrap wrote
 * (#1365), so the work per filing does not grow with the matter's size, with the to-dos the last registry read recorded
 * and the hearing dates its caller read, held in this closure and never persisted (ADR 0013,
 * 2026-10-04 amendment); a page write that fails is recorded on failed[] like a render that fails.
 */
export function startBootstrapJob(result: BootstrapResult, client: ClientContext, dates: MatterDates = DATES_NOT_READ): BackgroundJob {
  const dbPath = result.db_path;
  if (result.migration_required || result.bundle_outdated) return backgroundJobStatus(dbPath);
  const complete = client.clientName !== undefined && client.clientNo !== undefined && client.matterNo !== undefined;
  // A Job Board with no Writing has no mockup to render.
  const queue = complete ? result.filings.filter((f) => !f.retired_on && !f.job_board_only && f.render_state !== "fresh").map((f) => f.filing_id) : [];
  const pages = (only?: number) =>
    writeMatterPages(dbPath, dirname(result.matter_board_path as string), client, nowStamp(), fetchRevision(dbPath), persistedTodos(dbPath), dates, [], only === undefined ? {} : { only });
  return startRenderJob({
    dbPath,
    ...(result.matter_board_path ? { draftDir: dirname(result.matter_board_path) } : {}),
    queue,
    render: (filingId) => {
      const rendered = submissionFormsRender(dbPath, filingId, client);
      if (rendered.note) throw new Error(rendered.note);
      if (result.matter_board_path) pages(filingId);
    },
    isFresh: (filingId) => renderStateOf(dbPath, filingId, client) === "fresh",
    ...(result.matter_board_path ? { settle: () => pages() } : {}),
  });
}
