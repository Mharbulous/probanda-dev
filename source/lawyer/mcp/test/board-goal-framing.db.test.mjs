// Milestone goal default title and framing (docs/Specs/2026-10-22_board-goal-default-title-and-framing-spec.md):
// a board with no statement of goals reads `Goal not set` on the Goal card, board_summary and board_card,
// a stored statement with no description reads the board's title with no `Drafting`, and
// drafting_data__set_board_goal warns, never refuses, on a goal naming a drafting step or joining goals.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

process.env.COCLERK_SUBMISSION_LOCK_ROOT = mkdtempSync(join(tmpdir(), "coclerk-goal-framing-locks-"));
after(() => rmSync(process.env.COCLERK_SUBMISSION_LOCK_ROOT, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));

const { freshSubmissionDb } = await import("./helpers/template-db.mjs");
const { submissionDataExecute } = await import("../build/submission/backend.js");
const { submissionFormsRender } = await import("../build/submission/forms.js");
const { submissionFormsBoardCard } = await import("../build/submission/matter-pages.js");
const { callTool } = await import("../build/dispatch.js");
const { awaitBackgroundJobs } = await import("../build/submission/render-job.js");
const { readBoardData, ASHBOURNE } = await import("./fixtures/forms-render-seeds.mjs");

const NOW = "2026-10-22 09:00";
const TOKEN = "tok-goal-framing";
const setGoal = (dbPath, statement, extra = {}) =>
  callTool({}, "drafting_data__set_board_goal", { db_path: dbPath, filing_id: 1, statement, status: "inferred", session_token: TOKEN, ...extra });

// One VanIAC proceeding with one Writing and one job.
async function fixture(t) {
  const base = mkdtempSync(join(tmpdir(), "coclerk-goal-framing-"));
  t.after(async () => {
    await awaitBackgroundJobs();
    rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });
  const matterRoot = join(base, "L9999 Test Matter");
  const caseDataDir = join(matterRoot, "0. CASE DATA");
  mkdirSync(join(matterRoot, "0. DRAFT"), { recursive: true });
  mkdirSync(caseDataDir, { recursive: true });
  writeFileSync(join(matterRoot, "coclerk.json"), JSON.stringify({ schema_version: 5, matter_root: matterRoot, case_data_dir: caseDataDir, evidence_sql_path: "x.sql" }), "utf-8");
  const m = { draft: join(matterRoot, "0. DRAFT"), dbPath: join(caseDataDir, "submission.sqlite") };
  await freshSubmissionDb(m.dbPath);
  await submissionDataExecute(
    m.dbPath,
    `INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L9999 - Test', 'CAN/BC/Vancouver-International-Arbitration-Centre');
     INSERT INTO filings (id, proceeding_id, kind, round, title) VALUES (1, 1, 'submissions_package', 'opening', 'Opening Submissions Package');
     INSERT INTO tickets (id, proceeding_id, filing_id, title, intent, status, priority, kind, billing_anchor, created)
       VALUES (1, 1, 1, 'Settle the opening', 'Settle it.', 'queued', 0, 'work', 'L9999', '2026-10-22 08:00');`
  );
  return m;
}

/** The three places a board's goal description shows: the Goal card's data, board_summary's Goal line and board_card's goals lane. */
function goalViews(m) {
  const result = submissionFormsRender(m.dbPath, 1, ASHBOURNE, "mockup", ["Work_board"], undefined, undefined, NOW, TOKEN, m.draft);
  const board = (result.documents ?? []).find((d) => d.document_type === "Work_board");
  assert.ok(board, `render returned no Milestone: ${JSON.stringify(result).slice(0, 400)}`);
  const summary = board.board_summary;
  const { card } = submissionFormsBoardCard({ db_path: m.dbPath, filing_id: 1, lanes: ["goals"] }, ASHBOURNE, NOW);
  return {
    page: readBoardData(join(m.draft, "Opening Submissions Package", "Milestone.html")).sections[0].goals.description,
    summary: summary.split("\n").find((l) => l.startsWith("Goal: ")),
    card: card.split("\n").slice(card.split("\n").findIndex((l) => l.startsWith("## Goal")), card.split("\n").findIndex((l) => l.startsWith("## Goal")) + 2),
  };
}

test("a board with no statement of goals reads Goal not set in all three places, never Drafting", async (t) => {
  const m = await fixture(t);
  const views = goalViews(m);
  assert.equal(views.page, "Goal not set", "the Goal card");
  assert.equal(views.summary, "Goal: Goal not set (none)", "board_summary");
  assert.deepEqual(views.card, ["## Goal (none)", "Goal not set"], "board_card's goals lane");
});

test("a stored statement with no description reads the Writing's title alone", async (t) => {
  const m = await fixture(t);
  await setGoal(m.dbPath, "Goal: obtain an order for costs?");
  const views = goalViews(m);
  assert.equal(views.page, "Opening Submissions Package");
  assert.equal(views.summary, "Goal: Opening Submissions Package (inferred)");
  assert.equal(views.card[1], "Opening Submissions Package");
});

test("set_board_goal warns once in its note on a confirmed goal naming drafting, and still writes it", async (t) => {
  const m = await fixture(t);
  const written = await setGoal(m.dbPath, "Goal: finish drafting the opening submissions.", { status: "confirmed" });
  assert.equal(written.statement, "Goal: finish drafting the opening submissions.", "stored verbatim");
  assert.equal(written.status, "confirmed");
  assert.match(written.note, /recorded as confirmed/);
  assert.match(written.note, /This goal names a drafting step\. A goal is one outcome/);
  assert.equal(written.note.match(/A goal is one outcome/g).length, 1);
});

test("set_board_goal warns on a description naming drafting or joining goals, and not on an outcome sentence", async (t) => {
  const m = await fixture(t);
  const outcome = await setGoal(m.dbPath, "Goal: obtain an award of the unpaid fees with interest and costs?", { description: "Award of unpaid fees" });
  assert.doesNotMatch(outcome.note, /A goal is one outcome/, "an outcome sentence carries no warning");
  const drafting = await setGoal(m.dbPath, "Goal: obtain the award?", { description: "Opening Submissions Package Drafting" });
  assert.match(drafting.note, /names a drafting step/);
  const joined = await setGoal(m.dbPath, "Goal: obtain the award?", { description: "Opening Submissions Package; Reply Submissions Package" });
  assert.match(joined.note, /reads as more than one goal/);
  assert.equal(joined.description, "Opening Submissions Package; Reply Submissions Package", "the description is stored as written");
});
