// The Litigation Strategy (matter-board-shell.ts, map #125): a sha256 pin of the page it renders for a
// fixture, taken before the move to templates. The fixture's to-dos stand in for a MatterTodos read.
// The pin is checked by hash only; no test reads the page.

import test from "node:test";

import { assertSha256Pin } from "./helpers/sha256-pin.mjs";

const { renderMatterBoardHtml } = await import("../build/submission/forms/matter-board-shell.js");

/** Every branch the page draws: to-dos pointing at a filing, a proceeding and nothing, a `<` in a
 * description, a live Writing, a Job Board with no Writing, a retired filing and a pre-filing proceeding. */
const FIXTURE = {
  meta: { revision: 7, matter: "L200", client: "Acme Co", rendered: "2026-10-15 09:30" },
  todos: [
    { id: "t-1", description: "Serve the <reply> on Beta", bf_date: "2026-10-20", filing_id: 11 },
    { id: "t-2", description: "Draft the notice", bf_date: null, proceeding_id: 3 },
    { id: "t-3", description: "Call the client", bf_date: null },
  ],
  filings: [
    { filing_id: 11, title: "Notice of Application", state: "drafting", state_label: "Drafting", state_since: null, render_state: "stale", in_progress: 2 },
    { filing_id: 12, title: "Research", state: "drafting", state_label: "Open", state_since: null, render_state: null, in_progress: 1, job_only: true },
    { filing_id: 9, title: "Old Affidavit", state: "filed", state_label: "Filed", state_since: "2026-09-01", render_state: null, retired_on: "2026-09-30", retirement_reason: "superseded_by_new" },
  ],
  pre_filing: [{ proceeding_id: 3, proceeding: { court_or_centre: "BCSC", file_number: "S-123" }, state_label: "Not yet filed", in_progress: 0 }],
};

/** sha256 of renderMatterBoardHtml(FIXTURE), taken from the inline-string shell before the move to templates. */
const PAGE_PIN = "52287db7e7e0bffc438a555f4f60d1343142fdba7a37f5c13a4e0088009c1c38";

test("the Litigation Strategy page is byte-identical to the pinned render", () => {
  assertSha256Pin(renderMatterBoardHtml(FIXTURE), PAGE_PIN, "Litigation Strategy");
});
