// The Legal Research view page (docs/Plans/2026-11-01_legal-research-board-and-case-briefs.md): one
// `Legal Research.html` per board holding a live Writing, written by the view-page registry
// (../view-pages.ts), with four folder tabs over one panel. Legal Memos (legal-memos.ts) lists the memos
// linked to the board. Propositions (research-propositions.ts) holds the propositions of law recorded, placed
// in a Writing or not. Statutes (statutes-tab.ts) lists the legislation and when each was last checked. Cases
// (case-briefs.ts) lists the cases the board's Writings rely on and each one's brief. It replaced Legal
// Memos, which had replaced Raw Research, on 2026-11-01.
//
// A human interface generated from the database (ADR 0033): no session reads, greps, parses or
// screenshots it. Sessions read propositions through /drafting-data, and memos and case briefs through
// drafting_forms__board_card's `memos` and `briefs` lanes.

import { dirname } from "node:path";

import { templated } from "../../compose-template.js";
import boardCss from "../../templates/practice-board/board.css.js";
import legalResearchCss from "../../templates/view-pages/legal-research.css.js";
import legalResearchHtml from "../../templates/view-pages/legal-research.html.js";
import legalResearchJs from "../../templates/view-pages/legal-research.js.js";
import sharedJs from "../../templates/view-pages/shared.js.js";
import viewFolderCss from "../../templates/view-pages/view-folder.css.js";
import viewHeadHtml from "../../templates/view-pages/view-head.html.js";
import type { ViewPage } from "../view-pages.js";
import { buildCaseBriefsData, type CaseBriefsData } from "./case-briefs.js";
import { buildLegalMemosData, type LegalMemosData } from "./legal-memos.js";
import { buildPropositionsData, type PropositionsData } from "./research-propositions.js";
import { buildStatutesData, type StatutesData } from "./statutes-tab.js";

export interface LegalResearchData {
  propositions: PropositionsData;
  statutes: StatutesData;
  briefs: CaseBriefsData;
  memos: LegalMemosData;
}

// The page's script (legal-research.js) draws window.VIEW_PAGE.data into .board: the tabs, and in each
// tab its own filters over its own list.
/** The page's view-page registry entry (../view-pages.ts VIEW_PAGES). */
export const LEGAL_RESEARCH_PAGE: ViewPage = {
  name: "Legal Research",
  ...templated({
    entry: "legal-research.html",
    files: {
      "legal-research.html": legalResearchHtml,
      "view-head.html": viewHeadHtml,
      "board.css": boardCss,
      "view-folder.css": viewFolderCss,
      "legal-research.css": legalResearchCss,
      "shared.js": sharedJs,
      "legal-research.js": legalResearchJs,
    },
  }),
  data: (ctx): LegalResearchData => {
    const matterDir = dirname(ctx.draftDir);
    const filings = ctx.writings.map((w) => w.filing);
    return {
      propositions: buildPropositionsData(ctx.dbPath, filings),
      statutes: buildStatutesData(ctx.dbPath, filings.map((f) => f.id), filings.map((f) => f.proceeding_id)),
      briefs: buildCaseBriefsData(ctx.dbPath, filings.map((f) => f.id), matterDir, filings.map((f) => f.proceeding_id)),
      memos: buildLegalMemosData(ctx.dbPath, ctx.jobs, matterDir),
    };
  },
};
