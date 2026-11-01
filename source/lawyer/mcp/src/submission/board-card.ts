// drafting_forms__board_card: the tool entry point that reads one section's cards (board-card-render.ts
// prints them).

import { dirname } from "node:path";

import { ValidationError } from "../errors.js";
import { attachedDrafts, withCodes } from "./board-attachments.js";
import { type CardLane, CARD_LANES, renderBoardCard } from "./board-card-render.js";
import { BoardIndex, type BoardRef } from "./forms/board-members.js";
import { buildCaseBriefsData } from "./forms/case-briefs.js";
import { buildLegalMemosData } from "./forms/legal-memos.js";
import { courtFileAffidavits } from "./court-file-affidavits.js";
import { type ClientContext, nowStamp, resolveDraftDir } from "./forms.js";
import { fetchBoardFilings, fetchFiling, fetchProceeding, fetchRevision } from "./forms/query.js";
import { buildPreFilingBoardData, type WorkBoardData } from "./forms/render-work-board.js";
import { boardSectionOf, DATES_NOT_READ, filingBoardData } from "./matter-board-section.js";
import type { MatterDates } from "./matter-dates.js";

export interface BoardCardArgs {
  db_path: string;
  filing_id?: number;
  proceeding_id?: number;
  jobs?: number[];
  lanes?: CardLane[];
  key?: string;
  /** The matter's `0. DRAFT*` folder, which the attached lane needs to find each attachment on disk,
   * and the court file lane needs for its parent, the matter folder. */
  draft_dir?: string;
}

export interface BoardCardResult {
  filing_id?: number;
  proceeding_id?: number;
  revision: number;
  rendered_at: string;
  card: string;
}

/** A board as board_card's refusal names it. */
function boardLabel(board: BoardRef): string {
  return board.filing_id === null ? `proceeding ${board.proceeding_id}'s board` : `Milestone ${board.filing_id}`;
}

/** Refuses a card on a board a merge absorbed (docs/ADRs/0010): its jobs are read on its survivor's
 * card. A retired survivor has no page of its own, so the absorbed board's card still reads the board. */
function refuseAbsorbedCard(dbPath: string, board: BoardRef): void {
  const index = new BoardIndex(dbPath);
  if (!index.absorbed(board)) return;
  const survivor = index.survivorOf(board);
  if (survivor.filing_id !== null && fetchFiling(dbPath, survivor.filing_id).retired_on) return;
  throw new ValidationError(`${boardLabel(board)} is merged into ${boardLabel(survivor)}; read the card on ${boardLabel(survivor)}`, "board_merged");
}

/** One board's section as the matter pages build it -- a filing's from the inventory its last render
 * saved, a proceeding with no filing's from its jobs and loose threads -- read whole on a merged board
 * (boardSectionOf); an absorbed board refuses board_merged. Read by board_card and take_job. */
export function boardSection(
  dbPath: string,
  board: { filing_id?: number; proceeding_id?: number },
  client: ClientContext,
  now: string,
  dates: MatterDates,
  revision: number = fetchRevision(dbPath)
): WorkBoardData {
  if (board.filing_id !== undefined) {
    const filing = fetchFiling(dbPath, board.filing_id);
    refuseAbsorbedCard(dbPath, { filing_id: filing.id, proceeding_id: filing.proceeding_id });
    return boardSectionOf(dbPath, filingBoardData(dbPath, filing, fetchProceeding(dbPath, filing.proceeding_id), client, now, revision, dates), client, now, revision, dates);
  }
  const proceeding = fetchProceeding(dbPath, board.proceeding_id as number);
  refuseAbsorbedCard(dbPath, { filing_id: null, proceeding_id: proceeding.id });
  return boardSectionOf(
    dbPath,
    buildPreFilingBoardData(dbPath, proceeding, { revision, matter: client.matterNo ?? "", client: client.clientName ?? proceeding.matter_reference, rendered: now }),
    client,
    now,
    revision,
    dates
  );
}

/**
 * drafting_forms__board_card: what one section's cards hold when opened, read-only. The section is
 * built as the matter pages build it -- a filing's from the inventory its last render saved, a
 * proceeding with no filing's from its jobs and loose threads -- so the card reads the inventory the
 * session's latest board_summary came from, with the current job and rejection rows, and `dates`'
 * linked deadlines as its criteria. On a merged board the card reads the whole board as the page
 * draws it (boardSectionOf), by its survivor's id; an absorbed board's id refuses board_merged. Writes
 * nothing, moves no revision and writes no page.
 */
export function submissionFormsBoardCard(
  args: BoardCardArgs,
  client: ClientContext = {},
  now: string = nowStamp(),
  dates: MatterDates = DATES_NOT_READ
): BoardCardResult {
  if ((args.filing_id === undefined) === (args.proceeding_id === undefined)) {
    throw new ValidationError("drafting_forms__board_card takes exactly one of filing_id and proceeding_id");
  }
  const jobs = args.jobs ?? [];
  const lanes = (args.lanes ?? []).map((lane) => (lane === "goal" ? "criteria" : lane));
  if (jobs.length === 0 && lanes.length === 0 && args.key === undefined) {
    throw new ValidationError("drafting_forms__board_card needs at least one of jobs, lanes and key");
  }
  const unknownLanes = lanes.filter((lane) => !CARD_LANES.includes(lane));
  if (unknownLanes.length > 0) {
    throw new ValidationError(`drafting_forms__board_card.lanes: no lane ${unknownLanes.join(", ")} (lanes: ${CARD_LANES.join(", ")})`);
  }
  if (lanes.includes("attached") && args.draft_dir === undefined) {
    throw new ValidationError("drafting_forms__board_card: the attached lane needs draft_dir, the matter's 0. DRAFT folder session entry returned");
  }
  if (lanes.includes("court_file") && (args.draft_dir === undefined || args.filing_id === undefined)) {
    throw new ValidationError("drafting_forms__board_card: the court_file lane needs filing_id and draft_dir, the matter's 0. DRAFT folder session entry returned");
  }
  for (const lane of ["memos", "briefs"] as const) {
    if (lanes.includes(lane) && args.draft_dir === undefined) {
      throw new ValidationError(`drafting_forms__board_card: the ${lane} lane needs draft_dir, the matter's 0. DRAFT folder session entry returned`);
    }
  }
  const draftDir = args.draft_dir === undefined ? undefined : resolveDraftDir(args.draft_dir, "drafting_forms__board_card.draft_dir");
  if (args.proceeding_id !== undefined && fetchBoardFilings(args.db_path, args.proceeding_id).length > 0) {
    throw new ValidationError("This proceeding has a Writing, so its jobs are on each Writing's Milestone -- read the card there");
  }
  const revision = fetchRevision(args.db_path);
  const section = boardSection(args.db_path, args, client, now, dates, revision);
  if (args.proceeding_id !== undefined && (lanes.includes("criteria") || lanes.includes("proposed"))) {
    throw new ValidationError("This proceeding has no Writing yet, so its board has no completion criteria and no Proposed lane");
  }
  const missing = jobs.filter((id) => !section.tickets.some((t) => t.id === id));
  if (missing.length > 0) {
    throw new ValidationError(`drafting_forms__board_card.jobs: no ${missing.map((id) => `Job #${id}`).join(", ")} on this section`);
  }
  return {
    ...(args.filing_id !== undefined ? { filing_id: args.filing_id } : { proceeding_id: args.proceeding_id }),
    revision,
    rendered_at: now,
    card: renderBoardCard(
      section,
      jobs,
      lanes,
      args.key,
      lanes.includes("attached") && draftDir !== undefined ? withCodes(attachedDrafts(args.db_path, draftDir, section)) : [],
      lanes.includes("court_file") && draftDir !== undefined && args.filing_id !== undefined
        ? (section.meta.writing_states?.map((w) => w.filing_id) ?? [args.filing_id])
            .filter((id): id is number => id !== null)
            .flatMap((id) => courtFileAffidavits(args.db_path, id, dirname(draftDir)))
        : [],
      lanes.includes("memos") && draftDir !== undefined ? buildLegalMemosData(args.db_path, section.tickets, dirname(draftDir)).memos : [],
      lanes.includes("briefs") && draftDir !== undefined
        ? buildCaseBriefsData(
            args.db_path,
            (section.meta.writing_states?.map((w) => w.filing_id) ?? (args.filing_id === undefined ? [] : [args.filing_id])).filter((id): id is number => id !== null),
            dirname(draftDir)
          ).cases
        : []
    ),
  };
}
