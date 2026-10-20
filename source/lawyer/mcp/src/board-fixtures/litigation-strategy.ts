// The Litigation Strategy page's placeholder fixture (map #125, #141): hand-written synthetic data for a
// fixture-mode preview. No real person, entity or matter, and no machine path (#140). It holds dated
// and undated to-dos, live, job-only and retired lines, a pre-filing proceeding and a merged board.

import type { MatterBoardData } from "../submission/forms/render-matter-board.js";

export const LITIGATION_STRATEGY_FIXTURE: MatterBoardData = {
  meta: { revision: 12, matter: "L4801", client: "Ashbourne", rendered: "2026-01-15 09:00" },
  todos: [
    { id: "t1", description: "Ask the client for the signed purchase agreement", bf_date: "2026-01-16", filing_id: 1 },
    { id: "t2", description: "Book the chambers hearing date", bf_date: "2026-01-19" },
    { id: "t3", description: "Decide whether to amend the response", bf_date: null, proceeding_id: 3 },
  ],
  filings: [
    { filing_id: 1, title: "Opening Submissions Package", state: "drafting", state_label: "Drafting", state_since: null, render_state: "stale", in_progress: 2 },
    { filing_id: 2, title: "Notice of Application for Document Production", state: "filed", state_label: "Filed", state_since: "2026-01-08", render_state: "fresh", in_progress: 0 },
    { filing_id: 4, title: "Trial Preparation", state: "drafting", state_label: "Open", state_since: null, render_state: "never", in_progress: 1, job_only: true },
    { filing_id: 5, title: "Merged Reply Submissions", state: "drafting", state_label: "Drafting", state_since: null, render_state: "fresh", in_progress: 0 },
    { filing_id: 6, title: "Merged Reply Brief", state: "drafting", state_label: "Drafting", state_since: null, render_state: "fresh", in_progress: 1 },
    { filing_id: 3, title: "Withdrawn Application", state: "retired", state_label: "Retired", state_since: "2025-12-01", render_state: null, retired_on: "2025-12-01", retirement_reason: "withdrawn" },
  ],
  pre_filing: [{ proceeding_id: 3, proceeding: { court_or_centre: "Supreme Court of British Columbia", file_number: "S-000000" }, state_label: "Pre-filing", in_progress: 1 }],
  boards: [{ name: "Merged Reply Submissions", filing_ids: [5, 6], proceeding_ids: [] }],
};
