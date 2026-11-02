// Work Board data (ADR 0009; a local file only since 2026-09-14, docs/design/2026-09-14
// work-board-local-only-design.md): one filing's stored ticket process state -- tickets sorted
// into ready / in progress / blocked / completed / shelved / superseded, plus
// loose threads not yet outlined -- as one JSON object. workboard-shell.ts inlines it as the one section of
// that filing's self-contained Work Board page, and matter-pages.ts prints the same object
// as the render response's board_summary, which is what a session orients from. Never an advocacy document, and never part of
// renderMode:'filed'. The board
// now prints marker glyphs, in its Shelved lane and board_card's proposed lane only (design §13). It holds
// no predicate of its own: every glyph comes from the render's inventory.
//
// The code lives in forms/, one module per concern (the category rules in ticket-category.ts); this file re-exports the board's public surface.

export type { AttachmentKind, WorkBoardAttachment } from "./work-board-reads.js";
export { fetchDeletedTickets, fetchAttachments } from "./work-board-reads.js";
export type { Category, WorkBoardEdge, DispatchSkip, WorkBoardTicket, IneligibleReason } from "./work-board-ticket.js";
export { INELIGIBLE_REASONS } from "./work-board-ticket.js";
export type { WorkBoardSeed, RankGroup, ResolvedSeed } from "./work-board-seeds.js";
export { inRankOrder, seedOrigin, fetchResolvedSeeds, fetchOpenSeeds, fetchOpenThreads, withFromFiling } from "./work-board-seeds.js";
export type { GoalState, CriterionId, GoalCriterion, Goal, WorkBoardData } from "./work-board-data.js";
export { WORKBOARD_DATA_FILE } from "./work-board-data.js";
export type { MatterMilestoneData, StripItem, AttachedDraft } from "./work-board-page.js";
export { localMinutes } from "./ticket-category.js";
export type { ProceedingBoard } from "./build-proceeding-board.js";
export { buildProceedingBoard, onFilingBoard } from "./build-proceeding-board.js";
export { UNATTENDED_TOKEN_PREFIX, UNATTENDED_ELIGIBLE } from "./unattended-eligibility.js";
export { RESERVE_INVENTORY_DOC, NEVER_DELIVERED_DOCS, isEvidenceWork } from "./goal-criteria.js";
export { POSITION_CONFLICT_TITLE, PRE_SEND_TITLE, STOCK_TITLES } from "./goal-gate.js";
export { holdsBeforeSend, unmetHeldCriteria, unmetCurrencyCriterion, unmetAuthorityConfirmedCriterion, unmetPositionConflictCriterion } from "./pre-send-hold.js";
export { preFilingLabel, milestoneLabel, buildPreFilingBoardData } from "./no-writing-boards.js";
export { buildWorkBoardData } from "./build-work-board.js";
