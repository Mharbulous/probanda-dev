// One board section's data, and the merged board it is drawn on (matter-pages.ts has the whole picture).

import { BoardIndex, sameBoard } from "./forms/board-members.js";
import { combinedDeadlineIds, combineSections } from "./forms/combined-board.js";
import { buildContext, type ClientContext } from "./forms.js";
import { isJobOnlyBoard, type FilingRow, type ProceedingRow } from "./forms/query.js";
import { buildPreFilingBoardData, buildWorkBoardData, type WorkBoardData } from "./forms/render-work-board.js";
import { deadlineCriteria, type MatterDates, type PageDates, pageDates } from "./matter-dates.js";
import { liveMembers, memberRef, pageGroups } from "./matter-page-groups.js";
import { readManifest, type RenderManifest } from "./render-manifest.js";

/** What the Work Board's header draws when its caller read no dates: a direct call, never a tool entry point. */
export const DATES_NOT_READ: MatterDates = { note: "This matter's dates were not read." };

/**
 * One filing's Work Board section, built as a render builds it, from the inventory its last render
 * saved in the manifest: a filing never rendered reads null, so its Goal card reads pending. No
 * appeal deadline on this path (bootstrap's rule), and no party is read, since the board reads none.
 * `dates` gives its linked deadlines' criteria, as a render's own section has them. `manifest` is that
 * manifest when the caller has already read it.
 */
export function filingBoardData(
  dbPath: string,
  filing: FilingRow,
  proceeding: ProceedingRow,
  client: ClientContext,
  now: string,
  revision: number,
  dates: MatterDates = DATES_NOT_READ,
  manifest: RenderManifest | null = isJobOnlyBoard(filing) ? null : readManifest(dbPath, filing.id)
): WorkBoardData {
  const ctx = buildContext(dbPath, proceeding, filing, [], revision, client, undefined, now);
  return buildWorkBoardData({ ...ctx, inventory: manifest?.inventory ?? null }, deadlineCriteria(dates, filing.id));
}

/**
 * The whole board `own` is drawn on, as one section (combined-board.ts): `own` itself on a board
 * holding one section, and on a retired filing, which has no page; otherwise every live section on
 * its board pooled, `own` standing in for its own. What board_summary and board_card read, so a
 * session sees the board the page draws.
 */
export function boardSectionOf(dbPath: string, own: WorkBoardData, client: ClientContext, now: string, revision: number, dates: MatterDates): WorkBoardData {
  const ref = { filing_id: own.meta.filing_id, proceeding_id: own.meta.proceeding_id };
  const index = new BoardIndex(dbPath);
  if (!index.absorbed(ref) && index.membersOf(index.survivorOf(ref)).length === 0) return own;
  const { live, preFiling } = liveMembers(dbPath);
  const group = pageGroups(index, live, preFiling, new Map()).find((g) => g.members.some((m) => sameBoard(memberRef(m), ref)));
  if (group === undefined || group.members.length < 2) return own;
  const sections = group.members.map((m) => {
    if (sameBoard(memberRef(m), ref)) return own;
    if (m.filing !== null) return filingBoardData(dbPath, m.filing, m.proceeding, client, now, revision, dates);
    return buildPreFilingBoardData(dbPath, m.proceeding, { revision, matter: client.matterNo ?? "", client: client.clientName ?? m.proceeding.matter_reference, rendered: now });
  });
  return combineSections(dbPath, sections);
}

/** A merged page's dates: each section's deadline dates also under the combined section's filing,
 * by the ids its Goal card carries them under, so its one card joins every Writing's. */
export function combinedPageDates(dates: MatterDates, sections: WorkBoardData[], combined: WorkBoardData): PageDates {
  const result = pageDates(dates, sections);
  if (sections.length < 2 || combined.meta.filing_id === null) return result;
  const goaled = sections.filter((s) => s.goal !== undefined);
  const ids = combinedDeadlineIds(goaled);
  const merged: PageDates["criteria"][string] = {};
  goaled.forEach((s, i) => {
    for (const [id, when] of Object.entries(result.criteria[String(s.meta.filing_id)] ?? {})) merged[ids[i].get(id) ?? id] = when;
  });
  return { ...result, criteria: { ...result.criteria, [String(combined.meta.filing_id)]: merged } };
}
