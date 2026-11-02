// Every filing in Litigation Strategy order, each with its bootstrap entry.

import { orderFilings, type Orderable } from "../filing-order.js";
import { fetchAllFilingsForProceeding, fetchAllProceedings, fetchHearingDate, fetchLatestActivity, isJobOnlyBoard, isResearchWriting } from "./query.js";
import { deriveLifecycle } from "./lifecycle.js";
import type { RankedFiling } from "./render-matter-board.js";
import { type BootstrapResult } from "./bootstrap-result.js";
import { existingMockupPaths } from "./mockup-files.js";
import { type ClientContext, fetchApprovalsMark, stampFor, renderStateFor } from "./render-context.js";
import { type PhaseTimings, timed } from "./timings.js";
import { partiesFor, partiesDigest } from "./writing-parties.js";

export type Ranked = Orderable & RankedFiling & { entry: BootstrapResult["filings"][number] };

/**
 * Every filing of every proceeding, in the Litigation Strategy's order, each with its bootstrap entry
 * (#584). Shared by bootstrap and by the Litigation Strategy a render rewrites. Bootstrap re-sorts its own
 * list with orderByRecency. What produces either order stays in filing-order.ts and out of every
 * response field: the array order carries it and nothing else does.
 *
 * `now` is the call's single clock reading (#581 §4): render_state, lifecycle and the ordering all
 * date from it, so they cannot disagree across a midnight boundary mid-loop.
 */
export function rankFilings(
  dbPath: string,
  client: ClientContext,
  now: string,
  stamp: { revision: number; schemaVersion: number | null; buildStamp: string | null },
  timings: PhaseTimings
): Ranked[] {
  const listed = timed(timings, "filing_list", () =>
    fetchAllProceedings(dbPath).flatMap((proceeding) =>
      fetchAllFilingsForProceeding(dbPath, proceeding.id).map((filing) => ({ proceeding, filing }))
    )
  );

  // One activity read per proceeding, not per filing: proceeding-scoped rows count for every
  // filing in the proceeding, so the whole proceeding's answer arrives in one query.
  const activityByProceeding = new Map<number, Map<number | null, string>>();
  const activityFor = (proceedingId: number, filingId: number): Pick<Orderable, "own_activity" | "latest_activity"> => {
    let byFiling = activityByProceeding.get(proceedingId);
    if (byFiling === undefined) {
      byFiling = new Map(fetchLatestActivity(dbPath, proceedingId).map((r) => [r.filing_id, r.latest]));
      activityByProceeding.set(proceedingId, byFiling);
    }
    const own = byFiling.get(filingId) ?? null;
    const shared = byFiling.get(null) ?? null;
    return { own_activity: own, latest_activity: own === null || (shared !== null && shared > own) ? shared : own };
  };
  const noActivity = { own_activity: null, latest_activity: null };

  // Read once for the batch, as the caller reads the revision once: an approval moves no revision.
  const approvals = fetchApprovalsMark(dbPath);
  // Every live filing's parties digest (#1308): a sent Writing's from its snapshot, a drafting
  // Writing's from case data, read once per proceeding and shared by its drafting filings.
  const digests = timed(timings, "parties_drift", () => {
    const drafting = new Map<number, string>();
    return new Map(
      listed
        .filter(({ filing }) => !filing.retired_on && !isJobOnlyBoard(filing))
        .map(({ proceeding, filing }): [number, string] => {
          if (filing.filed_on) return [filing.id, partiesDigest(partiesFor(dbPath, proceeding, filing))];
          let digest = drafting.get(proceeding.id);
          if (digest === undefined) {
            digest = partiesDigest(partiesFor(dbPath, proceeding, filing));
            drafting.set(proceeding.id, digest);
          }
          return [filing.id, digest];
        })
    );
  });
  const ranked: Ranked[] = timed(timings, "filing_entries", () =>
    listed.map(({ proceeding, filing }) => {
      // A Work Board with no Writing has no mockup, so no folder is looked up and it answers no
      // render question. A closed one is listed as a retired filing is.
      if (isJobOnlyBoard(filing)) {
        const lifecycle = deriveLifecycle(filing, null, now.slice(0, 10));
        return {
          filing_id: filing.id,
          hearing_date: null,
          ...(filing.retired_on ? noActivity : activityFor(filing.proceeding_id, filing.id)),
          retired: Boolean(filing.retired_on),
          proceeding,
          filing,
          lifecycle,
          render_state: null,
          entry: {
            filing_id: filing.id,
            title: filing.title,
            paths: [],
            lifecycle: lifecycle.state,
            ...(filing.retired_on ? { retired_on: filing.retired_on } : {}),
            ...(filing.retired_on && filing.retirement_reason ? { retirement_reason: filing.retirement_reason } : {}),
            milestone_only: true as const,
          },
        };
      }
      const research = isResearchWriting(filing) ? { research_writing: true as const } : {};
      const hearingDate = fetchHearingDate(dbPath, filing.id);
      // No appeal deadline on this path (#583 §3), so the lifecycle never reaches appeal_expired.
      const lifecycle = deriveLifecycle(filing, hearingDate, now.slice(0, 10));
      // A retired filing is listed -- recovery has to find it -- but reports no paths and no
      // render_state: its mockups stand as they were at retirement and nothing re-renders them.
      if (filing.retired_on) {
        return {
          filing_id: filing.id,
          hearing_date: hearingDate,
          ...noActivity,
          retired: true,
          proceeding,
          filing,
          lifecycle,
          render_state: null,
          entry: {
            filing_id: filing.id,
            title: filing.title,
            paths: [],
            lifecycle: lifecycle.state,
            retired_on: filing.retired_on,
            ...(filing.retirement_reason ? { retirement_reason: filing.retirement_reason } : {}),
            ...research,
          },
        };
      }
      const state = renderStateFor(
        dbPath,
        stampFor(filing.id, proceeding, client, now, stamp.revision, stamp.schemaVersion, stamp.buildStamp, approvals),
        filing,
        digests.get(filing.id) as string
      );
      return {
        filing_id: filing.id,
        hearing_date: hearingDate,
        ...activityFor(filing.proceeding_id, filing.id),
        retired: false,
        proceeding,
        filing,
        lifecycle,
        render_state: state,
        entry: {
          filing_id: filing.id,
          title: filing.title,
          paths: existingMockupPaths(dbPath, filing.id),
          lifecycle: lifecycle.state,
          render_state: state,
          ...research,
        },
      };
    })
  );

  return timed(timings, "order", () => orderFilings(ranked, now));
}
