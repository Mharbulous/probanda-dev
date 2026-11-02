// Merged Work Boards (docs/ADRs/0010-milestones-organized-by-goals.md): drafting_data__merge_milestones
// joins two boards on the practitioner's yes. The survivor is a Writing's board over a Work Board with
// no Writing over a pre-filing board, then the lower id. One page per survivor draws every board on
// it as one board, one set of view pages spans its Writings, the absorbed pages go to TRASH, the board holds
// one goal with the earlier statements kept as history only, and the Litigation Strategy groups the merged
// sections under one heading.

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { runInNewContext } from "node:vm";
import test, { after } from "node:test";

process.env.COCLERK_SUBMISSION_LOCK_ROOT = mkdtempSync(join(tmpdir(), "coclerk-merge-boards-locks-"));
after(() => rmSync(process.env.COCLERK_SUBMISSION_LOCK_ROOT, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));

const { moveSeeds } = await import("./helpers/threads.mjs");
const { readThreads } = await import("../build/loose-threads/backend.js");
const { looseThreadsCapture } = await import("../build/loose-threads/tools.js");
const { freshSubmissionDb } = await import("./helpers/template-db.mjs");
const { submissionDataExecute, submissionDataQuery } = await import("../build/submission/backend.js");
const { submissionFormsRender } = await import("../build/submission/forms.js");
const { submissionFormsBoardCard } = await import("../build/submission/matter-pages.js");
const { callTool } = await import("../build/dispatch.js");
const { awaitBackgroundJobs } = await import("../build/submission/render-job.js");
const { materialFactsData, proceduralHistoryData } = await import("../build/submission/forms/facts-pages.js");
const { readBoardData, ASHBOURNE } = await import("./fixtures/forms-render-seeds.mjs");
const { combineSections } = await import("../build/submission/forms/combined-board.js");

const NOW = "2026-10-19 09:00";
const TOKEN = "tok-merge";
const code = (expected, message) => (err) => err.code === expected && (message === undefined || message.test(err.message));
const query = (dbPath, sql, params = []) => submissionDataQuery(dbPath, sql, params).rows;
const metaRows = (dbPath, glob) => query(dbPath, "SELECT key, value FROM db_meta WHERE key GLOB ? ORDER BY key", [glob]);
const merge = (dbPath, boards, confirmed = true, extra = {}) =>
  callTool({}, "drafting_data__merge_milestones", { db_path: dbPath, boards, confirmed, session_token: TOKEN, ...extra });
const setGoal = (dbPath, board, statement, extra = {}) =>
  callTool({}, "drafting_data__set_board_goal", { db_path: dbPath, ...board, statement, status: "inferred", session_token: TOKEN, ...extra });
const render = (m, filingId) => submissionFormsRender(m.dbPath, filingId, ASHBOURNE, "mockup", undefined, undefined, undefined, NOW, TOKEN, m.draft);

/** Each Writing's Work Board page, in its own folder (spec 2026-10-22 §9). */
const PAGE = {
  1: join("Opening Submissions Package", "Work Board.html"),
  2: join("Reply Submissions Package", "Work Board.html"),
  3: join("Counterclaim Submissions", "Work Board.html"),
};
const pageOf = (m, filingId) => join(m.draft, PAGE[filingId]);

/** Every Work Board page in the draft folder, relative to it: a Writing's in its folder, a board with no Writing's at the top. */
const milestonePages = (m) =>
  readdirSync(m.draft, { recursive: true })
    .map(String)
    .filter((p) => /^Work Board .*\.html$/.test(p) || basename(p) === "Work Board.html")
    .sort();

/** The boards drawn on a page's one section: each merged one's state, or the section's own. */
function members(page) {
  assert.equal(page.sections.length, 1, "a page draws one board");
  return page.sections[0].meta.writing_states ?? [page.sections[0].meta];
}

function matterBoard(path) {
  const prefix = "window.MATTER_BOARD = ";
  const line = readFileSync(path, "utf-8").split("\n").find((l) => l.startsWith(prefix));
  return JSON.parse(line.slice(prefix.length, -1));
}

// Proceeding 1 (VanIAC): Writings 1 and 2, and job 3 with no filing. Proceeding 2 (VanIAC): Writing 3
// and its job 2. Proceeding 3: no filing, holding job 4. Job 1 is Writing 1's. Fact 1 is used by
// Writings 1 and 2, fact 2 by Writing 2 alone.
async function fixture(t) {
  const base = mkdtempSync(join(tmpdir(), "coclerk-merge-boards-"));
  t.after(async () => {
    await awaitBackgroundJobs();
    rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });
  const matterRoot = join(base, "L9999 Test Matter");
  const caseDataDir = join(matterRoot, "0. CASE DATA");
  mkdirSync(join(matterRoot, "0. DRAFT"), { recursive: true });
  mkdirSync(caseDataDir, { recursive: true });
  writeFileSync(join(matterRoot, "coclerk.json"), JSON.stringify({ schema_version: 5, matter_root: matterRoot, case_data_dir: "0. CASE DATA", evidence_sql_path: "x.sql" }), "utf-8");
  const m = { matterRoot, draft: join(matterRoot, "0. DRAFT"), dbPath: join(caseDataDir, "submission.sqlite") };
  await freshSubmissionDb(m.dbPath);
  await submissionDataExecute(
    m.dbPath,
    `INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L9999 - Test', 'CAN/BC/Vancouver-International-Arbitration-Centre'),
                                                                 (2, 'L9999 - Test', 'CAN/BC/Vancouver-International-Arbitration-Centre'),
                                                                 (3, 'L9999 - Test', NULL);
     INSERT INTO filings (id, proceeding_id, kind, round, title) VALUES (1, 1, 'submissions_package', 'opening', 'Opening Submissions Package'),
                                                                        (2, 1, 'submissions_package', 'reply', 'Reply Submissions Package'),
                                                                        (3, 2, 'submissions_package', 'opening', 'Counterclaim Submissions');
     INSERT INTO tickets (id, proceeding_id, filing_id, title, intent, status, priority, kind, billing_anchor, created)
       VALUES (1, 1, 1, 'Settle the opening', 'Settle it.', 'queued', 0, 'work', 'L9999', '2026-10-19 08:00'),
              (2, 2, 3, 'Settle the counterclaim', 'Settle it.', 'queued', 0, 'work', 'L9999', '2026-10-19 08:01'),
              (3, 1, NULL, 'Confirm the style of cause', 'Check it.', 'queued', 0, 'work', 'L9999', '2026-10-19 08:02'),
              (4, 3, NULL, 'Choose the forum', 'BCSC or arbitration.', 'queued', 0, 'work', 'L9999', '2026-10-19 08:03');
     INSERT INTO facts (id, proceeding_id, postulate) VALUES (1, 1, 'The order was served.'), (2, 1, 'The respondent did not appear.');
     INSERT INTO filing_facts (filing_id, fact_id, document, part, ordinal) VALUES (1, 1, 'form', 'part2', 1), (2, 2, 'form', 'part2', 1), (2, 1, 'form', 'part2', 2);
     INSERT INTO seeds (id, proceeding_id, filing_id, created, surfaced_by, idea) VALUES (1, 1, NULL, '2026-10-19 08:10', 'noticed', 'Ask about costs.'),
                                                                                         (2, 2, 3, '2026-10-19 08:11', 'noticed', 'Is the counterclaim late?');`
  );
  await moveSeeds(m.dbPath);
  return m;
}

const goalsCard = (m) => submissionFormsBoardCard({ db_path: m.dbPath, filing_id: 1, lanes: ["goals"] }, ASHBOURNE, NOW).card;
const goalLine = (m) => submissionFormsRender(m.dbPath, 1, ASHBOURNE, "mockup", ["Work_board"], undefined, undefined, NOW, TOKEN, m.draft).documents.find((d) => d.document_type === "Work_board").board_summary.split("\n").find((l) => l.startsWith("Goal:"));

test("merging two boards of one proceeding repoints the absorbed board's loose threads to the survivor, and across proceedings leaves them", async (t) => {
  const m = await fixture(t);
  const { id } = await looseThreadsCapture({ db_path: m.dbPath, proceeding_id: 1, filing_id: 2, surfaced_by: "noticed", idea: "On the absorbed board." });
  await merge(m.dbPath, [{ filing_id: 1 }, { filing_id: 2 }]);
  assert.equal(readThreads(m.dbPath).find((x) => x.id === id).filing_id, 1, "same proceeding: repointed");
  await merge(m.dbPath, [{ filing_id: 1 }, { filing_id: 3 }]);
  assert.equal(readThreads(m.dbPath).find((x) => x.id === 2).filing_id, 3, "another proceeding's filing id stays");
});

test("the merge keeps the lower-id Writing's board, writes one membership row and keeps both statements of goals as history, drawn nowhere once the board holds one goal", async (t) => {
  const m = await fixture(t);
  await setGoal(m.dbPath, { filing_id: 1 }, "Goal: obtain the award.");
  await setGoal(m.dbPath, { filing_id: 3 }, "Goal: defeat the counterclaim.");

  const result = await merge(m.dbPath, [{ filing_id: 3 }, { filing_id: 1 }], true, { goal_statement: "Goal: obtain the award and defeat the counterclaim." });

  assert.deepEqual(result.survivor, { filing_id: 1, proceeding_id: 1 });
  assert.deepEqual(result.absorbed, { filing_id: 3, proceeding_id: 2 });
  assert.equal(result.goal_status, "confirmed");
  assert.deepEqual(metaRows(m.dbPath, "board_member:*"), [{ key: "board_member:filing:3", value: JSON.stringify({ filing_id: 1, proceeding_id: 1 }) }]);
  assert.deepEqual(metaRows(m.dbPath, "board_goal:*").map((r) => r.key), ["board_goal:filing:1"], "the absorbed board's row moved into the survivor's");
  const stored = JSON.parse(metaRows(m.dbPath, "board_goal:*")[0].value);
  assert.equal(stored.statement, "Goal: obtain the award and defeat the counterclaim.");
  assert.equal(stored.status, "confirmed");
  assert.ok(stored.approved_at && stored.consolidated_at, "a merge given a goal stamps it approved and consolidated");
  assert.deepEqual(
    stored.merged.map((g) => [g.from, g.statement, g.status]),
    [["board_goal:filing:1", "Goal: obtain the award.", "inferred"], ["board_goal:filing:3", "Goal: defeat the counterclaim.", "inferred"]],
    "both earlier statements are kept as history"
  );
  assert.equal(query(m.dbPath, "SELECT COUNT(*) AS n FROM tickets WHERE filing_id = 3")[0].n, 1, "no job is rewritten");

  // board_card, board_summary and the page's Goal card each draw the one goal and no history.
  assert.equal(goalsCard(m), "## Goal (confirmed)\nOpening Submissions Package\nGoal: obtain the award and defeat the counterclaim.");
  assert.equal(goalLine(m), "Goal: Opening Submissions Package (confirmed)");
  const page = readBoardData(pageOf(m, 1));
  assert.deepEqual(page.sections[0].goals, { description: "Opening Submissions Package", statement: "Goal: obtain the award and defeat the counterclaim.", status: "confirmed" });
});

test("a merge's goal_statement and goal_description refuse a blank, and goal_description needs goal_statement, writing nothing", async (t) => {
  const m = await fixture(t);
  await assert.rejects(merge(m.dbPath, [{ filing_id: 1 }, { filing_id: 3 }], true, { goal_statement: "  " }), code("invalid_statement"));
  await assert.rejects(merge(m.dbPath, [{ filing_id: 1 }, { filing_id: 3 }], true, { goal_description: "Award" }), code("invalid_description"));
  await assert.rejects(merge(m.dbPath, [{ filing_id: 1 }, { filing_id: 3 }], true, { goal_statement: "Goal: x.", goal_description: " " }), code("invalid_description"));
  assert.deepEqual(metaRows(m.dbPath, "board_*"), []);
  const written = await merge(m.dbPath, [{ filing_id: 1 }, { filing_id: 3 }], true, { goal_statement: "Goal: draft the reply.", goal_description: "Award" });
  assert.match(written.note, /names a drafting step/, "the framing warning of set_board_goal is relayed");
  assert.equal(JSON.parse(metaRows(m.dbPath, "board_goal:*")[0].value).description, "Award");
});

test("a merge without a goal leaves the board needs_consolidation, drawing one goal and listing the statements to combine until set_board_goal writes one", async (t) => {
  const m = await fixture(t);
  await setGoal(m.dbPath, { filing_id: 1 }, "Goal: obtain the award.");
  await setGoal(m.dbPath, { filing_id: 3 }, "Goal: defeat the counterclaim.");
  const result = await merge(m.dbPath, [{ filing_id: 1 }, { filing_id: 3 }]);
  assert.equal(result.goal_status, "needs_consolidation");
  assert.match(result.note, /ask the practitioner once for one combined goal/);

  const stored = JSON.parse(metaRows(m.dbPath, "board_goal:*")[0].value);
  assert.deepEqual([stored.statement, stored.status, stored.approved_at, stored.consolidated_at], [null, "needs_consolidation", null, undefined]);
  assert.equal(
    goalsCard(m),
    "## Goal (needs_consolidation)\nGoal not set\n### To combine 1 (inferred)\nGoal: obtain the award.\n### To combine 2 (inferred)\nGoal: defeat the counterclaim."
  );
  assert.equal(goalLine(m), "Goal: Goal not set (needs_consolidation), 2 statements to combine");
  const page = readBoardData(pageOf(m, 1)).sections[0].goals;
  assert.equal(page.merged, undefined, "the page is sent no merged statement to draw");
  assert.equal(page.statement, null);

  // The practitioner's one goal clears the flag; the history stays, drawn nowhere.
  await setGoal(m.dbPath, { filing_id: 1 }, "Goal: obtain the award and defeat the counterclaim.", { status: "confirmed" });
  const after = JSON.parse(metaRows(m.dbPath, "board_goal:*")[0].value);
  assert.ok(after.consolidated_at);
  assert.equal(after.merged.length, 2);
  assert.equal(goalsCard(m), "## Goal (confirmed)\nOpening Submissions Package\nGoal: obtain the award and defeat the counterclaim.");
  assert.equal(goalLine(m), "Goal: Opening Submissions Package (confirmed)");
});

test("a board merged before 2026-10-22, holding merged statements, reads needs_consolidation until its own goal is written", async (t) => {
  const m = await fixture(t);
  await merge(m.dbPath, [{ filing_id: 1 }, { filing_id: 3 }]);
  // The row an earlier merge wrote: the survivor's own statement, the absorbed one under `merged`, no consolidated_at.
  await submissionDataExecute(
    m.dbPath,
    `UPDATE db_meta SET value = '${JSON.stringify({
      description: null, statement: "Goal: obtain the award.", status: "confirmed", approved_at: "2026-10-18T09:00", session_token: TOKEN, updated_at: "2026-10-18T09:00",
      merged: [{ from: "board_goal:filing:3", description: null, statement: "Goal: defeat the counterclaim.", status: "inferred", approved_at: null, session_token: TOKEN, updated_at: "2026-10-18T09:00" }],
    })}' WHERE key = 'board_goal:filing:1'`
  );
  assert.equal(goalsCard(m), "## Goal (needs_consolidation)\nOpening Submissions Package\nGoal: obtain the award.\n### To combine 1 (inferred)\nGoal: defeat the counterclaim.");
  assert.equal(goalLine(m), "Goal: Opening Submissions Package (needs_consolidation), 1 statement to combine");
  const page = readBoardData(pageOf(m, 1)).sections[0].goals;
  assert.deepEqual([page.statement, page.merged], ["Goal: obtain the award.", undefined], "the page draws one statement");

  await setGoal(m.dbPath, { filing_id: 1 }, "Goal: obtain the award and defeat the counterclaim.", { status: "declined", statement: null });
  assert.equal(goalsCard(m), "## Goal (declined)\nGoal not set", "any own write ends the one ask");
});

test("a merge needs the practitioner's confirmation and refuses a merged, retired, repeated or pre-filing-with-Writing board, writing nothing", async (t) => {
  const m = await fixture(t);
  const before = JSON.stringify(metaRows(m.dbPath, "*"));
  await assert.rejects(merge(m.dbPath, [{ filing_id: 1 }, { filing_id: 3 }], false), code("not_confirmed"));
  await assert.rejects(merge(m.dbPath, [{ filing_id: 1 }]), code("invalid_boards"));
  await assert.rejects(merge(m.dbPath, [{ filing_id: 1 }, { filing_id: 1 }]), code("same_board"));
  await assert.rejects(merge(m.dbPath, [{ filing_id: 1 }, { proceeding_id: 1 }]), code("proceeding_has_writing"));
  await assert.rejects(merge(m.dbPath, [{ filing_id: 1 }, { filing_id: 1, proceeding_id: 1 }]), code("invalid_board"));
  await assert.rejects(merge(m.dbPath, [{ filing_id: 1 }, { filing_id: 99 }]), code("not_found"));
  assert.equal(JSON.stringify(metaRows(m.dbPath, "*")), before);

  await merge(m.dbPath, [{ filing_id: 1 }, { filing_id: 3 }]);
  await assert.rejects(merge(m.dbPath, [{ filing_id: 2 }, { filing_id: 3 }]), code("board_merged", /Work Board 3 is already merged into Work Board 1/));
  await assert.rejects(merge(m.dbPath, [{ filing_id: 1 }, { filing_id: 3 }]), code("board_merged"));
  await submissionDataExecute(m.dbPath, "UPDATE filings SET retired_on = '2026-10-19', retirement_reason = 'abandoned' WHERE id = 2;");
  await assert.rejects(merge(m.dbPath, [{ filing_id: 1 }, { filing_id: 2 }]), code("board_retired"));
});

test("a Writing's board survives a Work Board with no Writing of lower id, and a pre-filing board; a board's absorbed boards follow it", async (t) => {
  const m = await fixture(t);
  await submissionDataExecute(
    m.dbPath,
    `INSERT INTO filings (id, proceeding_id, kind, title, needs_forum_parts) VALUES (4, 1, 'task-board', 'Paper originals', 0);
     INSERT INTO filings (id, proceeding_id, kind, round, title) VALUES (5, 2, 'submissions_package', 'reply', 'Counterclaim Reply');`
  );
  // The Work Board with no Writing absorbs the pre-filing board, then Writing 5's board, of higher id, absorbs both.
  assert.deepEqual((await merge(m.dbPath, [{ proceeding_id: 3 }, { filing_id: 4 }])).survivor, { filing_id: 4, proceeding_id: 1 });
  assert.deepEqual((await merge(m.dbPath, [{ filing_id: 4 }, { filing_id: 5 }])).survivor, { filing_id: 5, proceeding_id: 2 });
  assert.deepEqual(
    metaRows(m.dbPath, "board_member:*").map((r) => [r.key, JSON.parse(r.value).filing_id]),
    [["board_member:filing:4", 5], ["board_member:proceeding:3", 5]]
  );
});

test("one page draws the merged boards as one board, each job once, with one set of view pages; the absorbed pages go to TRASH", async (t) => {
  const m = await fixture(t);
  render(m, 1);
  assert.deepEqual(milestonePages(m), ["Work Board - proceeding 3.html", PAGE[1], PAGE[2], PAGE[3]].sort());
  const rowsOf = () => ["tickets", "seeds", "board_attachments"].map((table) => JSON.stringify(query(m.dbPath, `SELECT * FROM ${table} ORDER BY id`)));
  const rowsBefore = rowsOf();

  await merge(m.dbPath, [{ filing_id: 1 }, { filing_id: 3 }]);
  const result = render(m, 3);

  assert.deepEqual(rowsOf(), rowsBefore, "no merge or render writes a job, loose thread or attachment row");
  assert.deepEqual(milestonePages(m), ["Work Board - proceeding 3.html", PAGE[1], PAGE[2]].sort());
  const absorbed = join(m.draft, "Counterclaim Submissions");
  assert.ok(result.view_page_paths.every((p) => dirname(p.path) !== absorbed), "no view page path is in the absorbed Writing's folder");
  const moved = result.moved_to_trash.map((x) => x.from.toLowerCase()).sort();
  assert.deepEqual(moved, ["Arguments", "Legal Research", "Work Board", "Material Facts", "Procedural History"].map((n) => join(absorbed, `${n}.html`).toLowerCase()).sort());
  const board = result.documents.find((d) => d.document_type === "Work_board");
  assert.equal(board.path, pageOf(m, 1), "the absorbed Writing's render returns its survivor's page");

  const page = readBoardData(pageOf(m, 1));
  assert.deepEqual(page.board, { filing_id: 1, proceeding_id: 1 });
  assert.equal(page.sections.length, 1, "one board, not a section per merged board");
  assert.deepEqual(members(page).map((w) => w.filing_id), [1, 3], "the survivor's Writing first");
  assert.deepEqual(
    page.sections[0].tickets.map((x) => [x.id, x.writing]),
    [[1, "Opening Submissions Package"], [3, "Proceeding 1"], [2, "Counterclaim Submissions"]],
    "each job once, tagged with its Writing"
  );
  assert.deepEqual(page.strip.filter((v) => v.kind === "view").map((v) => v.file), ["Procedural History", "Material Facts", "Legal Research", "Arguments"].map((n) => join("Opening Submissions Package", `${n}.html`)));
  assert.equal(readBoardData(pageOf(m, 2)).board, undefined, "an unmerged page carries no board key");

  const views = result.view_page_paths.filter((v) => dirname(v.path) === join(m.draft, "Opening Submissions Package"));
  assert.deepEqual([...new Set(views.map((v) => v.filing_id))].sort(), [1, 3], "each Writing on the board points at the board's view pages");
  assert.ok(readdirSync(absorbed).every((n) => !n.endsWith(".html")), "no page is left in the absorbed Writing's folder");
});

test("a survivor that is retired keeps its page's id while an absorbed Writing is live", async (t) => {
  const m = await fixture(t);
  await merge(m.dbPath, [{ filing_id: 1 }, { filing_id: 3 }]);
  await submissionDataExecute(m.dbPath, "UPDATE filings SET retired_on = '2026-10-19', retirement_reason = 'abandoned' WHERE id = 1;");

  render(m, 3);

  const page = readBoardData(pageOf(m, 1));
  assert.deepEqual(page.board, { filing_id: 1, proceeding_id: 1 }, "the page is named by its retired survivor");
  assert.deepEqual(page.sections.map((s) => s.meta.filing_id), [3]);
  assert.ok(existsSync(join(m.draft, "Opening Submissions Package", "Material Facts.html")));
  const { card } = submissionFormsBoardCard({ db_path: m.dbPath, filing_id: 3, jobs: [2] }, ASHBOURNE, NOW);
  assert.match(card, /^- Job #2 /, "with its survivor retired, the absorbed board's card still reads the board");
});

test("a merged pre-filing board's first Writing joins the survivor, and later Writings get their own boards", async (t) => {
  const m = await fixture(t);
  await merge(m.dbPath, [{ proceeding_id: 3 }, { filing_id: 2 }]);
  render(m, 2);
  assert.deepEqual(members(readBoardData(pageOf(m, 2))).map((w) => [w.filing_id, w.proceeding_id]), [[2, 1], [null, 3]]);

  await submissionDataExecute(
    m.dbPath,
    `UPDATE proceedings SET forum = 'CAN/BC/Vancouver-International-Arbitration-Centre' WHERE id = 3;
     INSERT INTO filings (id, proceeding_id, kind, round, title) VALUES (6, 3, 'submissions_package', 'opening', 'Third Opening'),
                                                                        (7, 3, 'submissions_package', 'reply', 'Third Reply');`
  );
  render(m, 2);
  assert.deepEqual(members(readBoardData(pageOf(m, 2))).map((w) => w.filing_id), [2, 6]);
  assert.ok(milestonePages(m).includes(join("Third Reply", "Work Board.html")));
  assert.equal(milestonePages(m).includes(join("Third Opening", "Work Board.html")), false);
});

test("two pre-filing boards merge onto the lower proceeding's page", async (t) => {
  const m = await fixture(t);
  await submissionDataExecute(m.dbPath, "INSERT INTO proceedings (id, matter_reference, forum) VALUES (4, 'L9999 - Test', NULL);");
  assert.deepEqual((await merge(m.dbPath, [{ proceeding_id: 4 }, { proceeding_id: 3 }])).survivor, { filing_id: null, proceeding_id: 3 });
  render(m, 1);
  assert.deepEqual(members(readBoardData(join(m.draft, "Work Board - proceeding 3.html"))).map((w) => w.proceeding_id), [3, 4]);
  assert.equal(milestonePages(m).includes("Work Board - proceeding 4.html"), false);
  const card = (proceedingId) => submissionFormsBoardCard({ db_path: m.dbPath, proceeding_id: proceedingId, lanes: ["live"] }, ASHBOURNE, NOW).card;
  assert.throws(() => card(4), code("board_merged", /proceeding 4's board is merged into proceeding 3's board; read the card on proceeding 3's board/));
  assert.match(card(3), /Job #4 /);
});

test("set_board_goal refuses an absorbed board, writes a merged statement by index and keeps the merged ones on an own write", async (t) => {
  const m = await fixture(t);
  await setGoal(m.dbPath, { filing_id: 3 }, "Goal: defeat the counterclaim.");
  await merge(m.dbPath, [{ filing_id: 1 }, { filing_id: 3 }]);

  await assert.rejects(setGoal(m.dbPath, { filing_id: 3 }, "Goal: anything."), code("board_merged", /merged into Work Board 1/));
  await assert.rejects(setGoal(m.dbPath, { filing_id: 1 }, "Goal: x.", { merged_index: 2 }), code("invalid_merged_index"));

  const written = await setGoal(m.dbPath, { filing_id: 1 }, "Goal: defeat the counterclaim in full.", { merged_index: 1 });
  assert.equal(written.statement, "Goal: defeat the counterclaim in full.");
  assert.equal(JSON.parse(metaRows(m.dbPath, "board_goal:*")[0].value).status, "needs_consolidation", "a history write leaves the board needing one goal");
  await setGoal(m.dbPath, { filing_id: 1 }, "Goal: obtain the award.");
  const stored = JSON.parse(metaRows(m.dbPath, "board_goal:*")[0].value);
  assert.equal(stored.statement, "Goal: obtain the award.");
  assert.deepEqual(stored.merged.map((g) => [g.from, g.statement]), [["board_goal:filing:3", "Goal: defeat the counterclaim in full."]]);
});

test("the merged view pages read every Writing: Material Facts and Procedural History Writing by Writing, each fact once", async (t) => {
  const m = await fixture(t);
  const filings = query(m.dbPath, "SELECT * FROM filings ORDER BY id");
  const proceedings = query(m.dbPath, "SELECT * FROM proceedings ORDER BY id");
  const w = (id) => ({ filing: filings.find((f) => f.id === id), proceeding: proceedings.find((p) => p.id === filings.find((f) => f.id === id).proceeding_id) });

  const ctx = { dbPath: m.dbPath, ...w(1), writings: [w(1), w(2)], now: NOW, revision: 1 };
  assert.deepEqual(materialFactsData(ctx).facts.map((f) => [f.position, f.text]), [[1, "The order was served."], [2, "The respondent did not appear."]]);
  assert.deepEqual(proceduralHistoryData(ctx).facts, [], "a fact with no procedural date is material only");

  // A fact the session dates as a procedural step moves to Procedural History, with its date, and leaves Material Facts.
  await submissionDataExecute(m.dbPath, "UPDATE facts SET procedural_on = '2026-03-04' WHERE postulate = 'The order was served.';");
  assert.deepEqual(materialFactsData(ctx).facts.map((f) => [f.position, f.date, f.text]), [[1, null, "The respondent did not appear."]]);
  const history = proceduralHistoryData(ctx);
  assert.equal(history.order, "date");
  assert.deepEqual(history.facts.map((f) => [f.position, f.date, f.text]), [[1, "2026-03-04", "The order was served."]]);
});

test("the Litigation Strategy draws a merged board as one heading over its sections", async (t) => {
  const m = await fixture(t);
  await merge(m.dbPath, [{ filing_id: 1 }, { filing_id: 3 }]);
  render(m, 1);
  const data = matterBoard(join(m.draft, "Litigation Strategy.html"));
  assert.deepEqual(data.boards, [{ name: "Work Board 1", filing_ids: [1, 3], proceeding_ids: [] }]);
  assert.ok(readFileSync(join(m.draft, "Litigation Strategy.html"), "utf-8").includes('"Merged Work Boards"'));
});

// docs/ADRs/0010, 2026-10-21 amendment: a merged board is one board, not a section per merged board.

/** Runs the Work Board page's drawing script against stand-in elements and returns every node drawn. */
function drawPage(file) {
  class Node {
    constructor(tag) {
      Object.assign(this, { tag, children: [], attrs: {}, className: "", id: "", text: "", style: { setProperty() {} } });
    }
    set textContent(value) {
      this.text = String(value);
      this.children = [];
    }
    get textContent() {
      return this.text + this.children.map((c) => c.textContent).join("");
    }
    appendChild(child) {
      this.children.push(child);
      child.parent = this;
      return child;
    }
    after(node) {
      this.parent.children.splice(this.parent.children.indexOf(this) + 1, 0, node);
      node.parent = this.parent;
    }
    setAttribute(key, value) {
      this.attrs[key] = String(value);
    }
    addEventListener() {}
    all() {
      return this.children.flatMap((c) => [c, ...c.all()]);
    }
    querySelector(selector) {
      if (!selector.startsWith(".")) return this.all().find((n) => n.tag === selector) ?? null;
      return this.all().find((n) => n.className.split(" ").includes(selector.slice(1))) ?? null;
    }
  }
  const header = new Node("header");
  header.appendChild(new Node("h1"));
  header.appendChild(Object.assign(new Node("div"), { className: "meta" }));
  const main = new Node("main");
  main.appendChild(header);
  const document = {
    title: "",
    body: new Node("body"),
    querySelector: (selector) => (selector === "main" ? main : selector === "header" ? header : null),
    createElement: (tag) => new Node(tag),
    createTextNode: (text) => Object.assign(new Node("#text"), { text: String(text) }),
  };
  const script = readFileSync(file, "utf-8").split("<script>")[2].split("</script>")[0];
  runInNewContext(script, { window: { WORKBOARD: readBoardData(file) }, document });
  return main.all();
}

/** A section as a board builder returns one, holding only what combineSections reads. */
function section(filingId, proceedingId, title, criteria, tickets = []) {
  return {
    meta: { revision: 1, matter: "L9999", client: "", file: "", filing: title, filing_id: filingId, proceeding_id: proceedingId, rendered: NOW, state: "drafting", state_label: "Drafting", state_since: null, ready_to_retire: false },
    tickets,
    seeds: [],
    deleted: [],
    attachments: [],
    proposals: [],
    lapsed_keys: [],
    goals: { description: "Goal", statement: null, status: null },
    goal: { sentence: "Completion Criteria", state: criteria.some((c) => c.state === "unmet") ? "unmet" : "met", text: null },
    criteria,
  };
}
const criterion = (id, text, state, items = [], source = "sqlite") => ({ id, text, state, outstanding: state === "unmet" ? items.length || 1 : 0, items, source });
const job = (id, extra = {}) => ({ id, status: "queued", rejected_at: null, superseded_by: null, blocked_by: [], conflicts: [], ...extra });

test("combineSections pools criteria by id, unmet while any Writing's is unmet, and passes one section through unchanged", async (t) => {
  const m = await fixture(t);
  const a = section(1, 1, "Opening Submissions Package", [
    criterion("noting-up", "Note up every authority", "met"),
    criterion("gate", "pre-filing checks", "unmet", ["step 2"]),
    criterion("open-items", "No open items", "met"),
    criterion("deadline:hearing", "Hearing", "unmet", [], "practice"),
  ], [job(1)]);
  const b = section(3, 2, "Counterclaim Submissions", [
    criterion("noting-up", "Note up every authority", "unmet", ["R v X"]),
    criterion("gate", "pre-send checks", "met"),
    criterion("counsel-review", "Counsel has reviewed", "unmet"),
    criterion("deadline:hearing", "Hearing", "met", [], "practice"),
  ], [job(2, { blocked_by: [{ id: 1, status: null, rejected: false }] })]);

  assert.equal(combineSections(m.dbPath, [a]), a, "one section is the same object");
  const board = combineSections(m.dbPath, [a, b]);
  const byId = Object.fromEntries(board.criteria.map((c) => [c.id, c]));
  assert.deepEqual(board.criteria.map((c) => c.id), ["noting-up", "gate", "open-items", "deadline:hearing", "counsel-review", "deadline:hearing@filing:3"]);
  assert.equal(byId["noting-up"].state, "unmet", "unmet while any Writing's is unmet");
  assert.equal(byId["noting-up"].text, "Note up every authority");
  assert.deepEqual(byId["noting-up"].items, ["Counterclaim Submissions: R v X"]);
  assert.equal(byId.gate.text, "Opening Submissions Package: pre-filing checks; Counterclaim Submissions: pre-send checks", "differing texts each name their Writing");
  assert.equal(byId.gate.state, "unmet");
  assert.equal(byId["open-items"].text, "No open items (Opening Submissions Package)", "a criterion one Writing holds names it");
  assert.equal(byId["deadline:hearing@filing:3"].text, "Hearing (Counterclaim Submissions)", "a deadline is never combined");
  assert.equal(board.goal.state, "unmet");
  assert.deepEqual(board.tickets.map((x) => [x.id, x.writing]), [[1, "Opening Submissions Package"], [2, "Counterclaim Submissions"]]);
  assert.deepEqual(board.tickets[1].blocked_by, [{ id: 1, status: "queued", rejected: false }], "a blocker on the board in another proceeding links");
  assert.deepEqual(board.meta.writing_states.map((w) => w.filing_id), [1, 3]);
  assert.equal(a.tickets[0].writing, undefined, "the sections themselves are not changed");
});

test("the page's copy of a merged board names no Writing on its Criteria card: one least-advanced state, one wording, a shared item once", async (t) => {
  const m = await fixture(t);
  const a = section(1, 1, "Opening Submissions Package", [
    criterion("gate", "The pre-filing checks are passed or waived", "unmet", ["Pre-filing gate", "step 2"]),
    criterion("open-items", "No open items", "met"),
    criterion("deadline:hearing", "Hearing", "unmet", [], "practice"),
  ]);
  const b = section(3, 2, "Counterclaim Submissions", [
    criterion("gate", "The pre-send checks are passed or waived", "unmet", ["Pre-filing gate"]),
    criterion("deadline:hearing", "Hearing", "met", [], "practice"),
  ]);
  b.meta = { ...b.meta, state: "filed", state_label: "Filed", state_since: "2026-10-01" };
  a.goal.text = "Drafting conditions hold.";
  b.goal.text = "Filed on 2026-10-01";

  const page = combineSections(m.dbPath, [a, b], true);
  const agent = combineSections(m.dbPath, [a, b]);
  assert.equal(page.meta.state_label, "Drafting", "the least advanced of Drafting and Filed");
  assert.equal(page.meta.state_since, null);
  const gate = page.criteria.find((c) => c.id === "gate");
  assert.equal(gate.text, "The pre-filing and pre-send checks are passed or waived");
  assert.deepEqual(gate.items, ["Pre-filing gate", "step 2"], "an item both Writings hold prints once, with no prefix");
  assert.equal(gate.outstanding, agent.criteria.find((c) => c.id === "gate").outstanding, "the count is board_card's");
  assert.deepEqual(gate.counts, { items: 3, suppressed: 0 });
  assert.deepEqual(page.criteria.map((c) => c.text), ["The pre-filing and pre-send checks are passed or waived", "No open items", "Hearing", "Hearing"]);
  assert.equal(page.goal.text, "Drafting conditions hold.; Filed on 2026-10-01");
  const card = JSON.stringify([page.meta.state_label, page.goal, page.criteria]);
  for (const title of ["Opening Submissions Package", "Counterclaim Submissions"]) assert.ok(!card.includes(title), `the card names no ${title}`);

  assert.equal(agent.meta.state_label, "Opening Submissions Package: Drafting · Counterclaim Submissions: Filed 2026-10-01", "board_summary's copy is unchanged");
  assert.equal(agent.criteria.find((c) => c.id === "gate").text, "Opening Submissions Package: The pre-filing checks are passed or waived; Counterclaim Submissions: The pre-send checks are passed or waived");
  assert.equal(combineSections(m.dbPath, [a], true), a, "one section is the same object on the page too");
});

test("a merged page's Completion Criteria card shows one state and no Writing title; board_card still names each Writing", async (t) => {
  const m = await fixture(t);
  await merge(m.dbPath, [{ filing_id: 1 }, { filing_id: 3 }]);
  render(m, 1);
  const criteria = submissionFormsBoardCard({ db_path: m.dbPath, filing_id: 1, lanes: ["criteria"] }, ASHBOURNE, NOW).card;
  assert.match(criteria, /Opening Submissions Package: .*; Counterclaim Submissions: /, "board_card keeps the Writing labels");
  const nodes = drawPage(pageOf(m, 1));
  const card = nodes.find((n) => n.id === "goal");
  assert.ok(card, "the merged page draws a Completion Criteria card");
  assert.equal(card.all().find((n) => n.className === "lifecycle").textContent, "Drafting");
  assert.equal(card.all().find((n) => n.className === "text").textContent, "No completion criteria are declared for this type of Writing.", "the Writings' one card text prints once");
  for (const title of ["Opening Submissions Package", "Counterclaim Submissions"]) assert.ok(!card.textContent.includes(title), `the card names no ${title}`);
});

test("a merged page draws one board: one Criteria card, one panel per lane, no per-Writing heading, no repeated id", async (t) => {
  const m = await fixture(t);
  await merge(m.dbPath, [{ filing_id: 1 }, { filing_id: 3 }]);
  render(m, 1);
  const nodes = drawPage(pageOf(m, 1));
  const ids = nodes.map((n) => n.id).filter((id) => id !== "");
  assert.deepEqual(ids.filter((id, i) => ids.indexOf(id) !== i), [], "no element id repeats");
  for (const id of ["goals", "ready", "in-progress", "completed"]) assert.equal(ids.filter((x) => x === id).length, 1, id);
  assert.equal(nodes.filter((n) => n.tag === "ol" && n.className === "writings").length, 1, "one thumbnail row");
  assert.equal(nodes.filter((n) => n.tag === "h2" && n.className === "writing-title").length, 0, "no per-Writing heading");
  assert.ok(nodes.find((n) => n.id === "ticket-2").textContent.includes("Counterclaim Submissions"), "a job card names its Writing");
});

test("board_card reads the merged board by its survivor and refuses the absorbed board; board_summary reads it by either Writing", async (t) => {
  const m = await fixture(t);
  await merge(m.dbPath, [{ filing_id: 1 }, { filing_id: 3 }]);
  const card = (filingId) => submissionFormsBoardCard({ db_path: m.dbPath, filing_id: filingId, lanes: ["live", "criteria"] }, ASHBOURNE, NOW).card;
  assert.throws(() => card(3), code("board_merged", /Work Board 3 is merged into Work Board 1; read the card on Work Board 1/));
  const jobs = card(1).split("\n").filter((l) => l.startsWith("- Job #"));
  assert.deepEqual(
    jobs.map((l) => /^- Job #(\d+) [^·]+ · ([^·]+) ·/.exec(l).slice(1, 3).map((s) => s.trim())),
    [["1", "Opening Submissions Package"], ["3", "Proceeding 1"], ["2", "Counterclaim Submissions"]]
  );
  assert.match(submissionFormsBoardCard({ db_path: m.dbPath, filing_id: 1, jobs: [2] }, ASHBOURNE, NOW).card, /^- Job #2 Settle the counterclaim/, "a job on the other Writing is on this board");

  const summary = (filingId) => render(m, filingId).documents.find((d) => d.document_type === "Work_board").board_summary;
  assert.equal(summary(3), summary(1), "the render's summary is the board's, whichever Writing rendered");
});

test("an unmerged board's page is unchanged: no Writing tag and no merged states", async (t) => {
  const m = await fixture(t);
  render(m, 1);
  for (const file of [PAGE[1], PAGE[3]]) {
    const page = readBoardData(join(m.draft, file));
    assert.equal(page.sections.length, 1);
    assert.equal(page.sections[0].meta.writing_states, undefined, file);
    assert.ok(page.sections[0].tickets.every((x) => !("writing" in x)), file);
  }
});

// A General Job (a job with no Writing) is drawn on every Writing's board in its proceeding, so it is
// tagged there and nowhere else (docs/Specs/2026-10-21_general-job-marker-and-terms-spec.md).
test("board_card ends a General Job's line ` · general` in every lane and on every board, and no Writing Job's", async (t) => {
  const m = await fixture(t);
  const card = (filingId, args) => submissionFormsBoardCard({ db_path: m.dbPath, filing_id: filingId, ...args }, ASHBOURNE, NOW).card;
  const jobLine = (text, id) => text.split("\n").find((l) => l.startsWith(`- Job #${id} `));
  for (const filingId of [1, 2]) {
    const live = card(filingId, { lanes: ["live"] });
    assert.ok(jobLine(live, 3).endsWith(" · general"), `Writing ${filingId}'s live lane:\n${live}`);
    assert.ok(jobLine(card(filingId, { jobs: [3] }), 3).endsWith(" · general"), "the jobs selector");
  }
  assert.ok(!card(1, { lanes: ["live"] }).split("\n").some((l) => l.startsWith("- Job #1 ") && l.includes("general")), "a Writing Job carries no tag");
  assert.ok(!jobLine(card(1, { jobs: [1] }), 1).includes("general"));

  await submissionDataExecute(m.dbPath, "UPDATE tickets SET status = 'completed', completed_at = '2026-10-19 08:30' WHERE id IN (1, 3)");
  const completed = card(2, { lanes: ["completed"] });
  assert.equal(jobLine(completed, 3), "- Job #3 Confirm the style of cause · Completed · general");
  assert.equal(jobLine(card(1, { lanes: ["completed"] }), 1), "- Job #1 Settle the opening · Completed");
});

test("board_card's merged board keeps the General tag after the job's Writing", async (t) => {
  const m = await fixture(t);
  await merge(m.dbPath, [{ filing_id: 1 }, { filing_id: 3 }]);
  const lines = submissionFormsBoardCard({ db_path: m.dbPath, filing_id: 1, lanes: ["live"] }, ASHBOURNE, NOW).card.split("\n").filter((l) => l.startsWith("- Job #"));
  assert.deepEqual(
    lines.map((l) => [l.slice(0, 8), l.endsWith(" · general")]),
    [["- Job #1", false], ["- Job #3", true], ["- Job #2", false]]
  );
  assert.ok(lines[1].startsWith("- Job #3 Confirm the style of cause · Proceeding 1 · "), lines[1]);
});

test("the page tags a General Job's card General on every Writing's board and on a merged board, and no Writing Job's", async (t) => {
  const m = await fixture(t);
  render(m, 1);
  for (const file of [PAGE[1], PAGE[2]]) {
    const tickets = readBoardData(join(m.draft, file)).sections[0].tickets;
    assert.deepEqual(tickets.map((x) => [x.id, x.general === true]).sort(), file === PAGE[1] ? [[1, false], [3, true]] : [[3, true]], file);
    const nodes = drawPage(join(m.draft, file));
    const tags = nodes.filter((n) => n.className === "chip general");
    assert.equal(tags.length, 1, file);
    assert.equal(tags[0].textContent, "General");
    assert.ok(nodes.find((n) => n.id === "ticket-3").textContent.includes("General"), file);
    if (file === PAGE[1]) assert.ok(!nodes.find((n) => n.id === "ticket-1").textContent.includes("General"));
  }

  await merge(m.dbPath, [{ filing_id: 1 }, { filing_id: 3 }]);
  render(m, 1);
  const nodes = drawPage(pageOf(m, 1));
  assert.deepEqual(
    ["ticket-1", "ticket-2", "ticket-3"].map((id) => nodes.find((n) => n.id === id).textContent.includes("General")),
    [false, false, true],
    "on a merged board too"
  );
});
