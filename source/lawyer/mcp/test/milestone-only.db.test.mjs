// A Milestone with no Writing: a `filings` row of the reserved kind `task-board`, written only by
// drafting_data__create_milestone on a proceeding that already has a Writing. It has a Milestone page
// and jobs, and never a mockup, a view page, completion criteria or Proposals. Its
// place in open_session's default opening is in open-session.db.test.mjs, and in the background render
// job's queue in render-job.e2e.test.mjs.

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

const { freshSubmissionDb } = await import("./helpers/template-db.mjs");
const { submissionDataExecute, submissionDataQuery } = await import("../build/submission/backend.js");
const { submissionFormsBootstrap, submissionFormsRender } = await import("../build/submission/forms.js");
const { CARD_LANES, submissionFormsBoardCard } = await import("../build/submission/matter-pages.js");
const { submissionDataCompleteJob } = await import("../build/submission/forms/complete-job.js");
const { submissionDataCreateMilestone } = await import("../build/submission/forms/create-milestone.js");
const { MILESTONE_KIND, isJobOnlyBoard } = await import("../build/submission/forms/query.js");
const { callTool } = await import("../build/dispatch.js");
const { boardDataOf, readBoardData } = await import("./fixtures/forms-render-seeds.mjs");

const PINNED = "2026-10-10 10:00";
const CLIENT = { clientName: "Larchmont", clientNo: "1", matterNo: "L8470" };
const CREATE = "drafting_data__create_milestone";
const TITLE = "Paper originals";

const code = (expected, message) => (err) => err.code === expected && (message === undefined || message.test(err.message));
const query = (dbPath, sql, params = []) => submissionDataQuery(dbPath, sql, params).rows;
const revisionOf = (dbPath) => Number(query(dbPath, "SELECT value FROM db_meta WHERE key = 'revision'")[0].value);
const filingsOf = (dbPath) => query(dbPath, "SELECT id, proceeding_id, kind, title, needs_forum_parts, layout_snapshot, retired_on FROM filings ORDER BY id");
const createBoard = (dbPath, args = {}) => callTool({}, CREATE, { db_path: dbPath, proceeding_id: 1, title: TITLE, ...args });
const render = (dbPath, filingId, { mode = "mockup", presentationDir, draftDir } = {}) =>
  submissionFormsRender(dbPath, filingId, CLIENT, mode, undefined, undefined, presentationDir, PINNED, "tok-1", draftDir);
const boardOf = (result) => result.documents.find((d) => d.document_type === "Work_board");

function matterBoard(path) {
  const prefix = "window.MATTER_BOARD = ";
  const line = readFileSync(path, "utf-8").split("\n").find((l) => l.startsWith(prefix));
  return JSON.parse(line.slice(prefix.length, -1));
}

// Proceeding 1: BCSC with one Writing, filing 1. Proceeding 2: no filing. With `board`, filing 2 is a
// Milestone with no Writing on proceeding 1, opened through the tool. Attachment 2 names proceeding 1
// alone: it is written before the proceeding's first Writing, the only time the v67 guard allows one.
async function fixture(t, { board = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "coclerk-milestone-only-"));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
  mkdirSync(join(dir, "L8470 Matter", "0. CASE DATA"), { recursive: true });
  const dbPath = join(dir, "L8470 Matter", "0. CASE DATA", "submission.sqlite");
  await freshSubmissionDb(dbPath);
  await submissionDataExecute(
    dbPath,
    `
    INSERT INTO proceedings (id, matter_reference, forum, court_or_centre, file_number) VALUES (1, 'L8470 - Larchmont', 'CAN/BC/BCSC', 'BC Supreme Court', 'S-1');
    INSERT INTO proceedings (id, matter_reference, forum) VALUES (2, 'L8470 - Larchmont', NULL);
    INSERT INTO board_attachments (id, proceeding_id, filing_id, path, kind, attached_on) VALUES (2, 1, NULL, '0. DRAFT\\Reply to counsel.eml', 'reply', '2026-10-10');
    INSERT INTO filings (id, proceeding_id, kind, subkind, title) VALUES (1, 1, 'requisition_consent', 'consent', 'Consent Order Requisition');
    `.trim()
  );
  const draft = join(dir, "L8470 Matter", "0. DRAFT");
  mkdirSync(draft, { recursive: true });
  const boardId = board ? (await createBoard(dbPath)).filing_id : undefined;
  return { dir, dbPath, draft, boardId };
}

// Jobs 1 and 2 are the Writing's and the proceeding's; 3 (queued), 4 (in progress) and 5 (deleted) name
// the board. Loose thread 1 names the board, 2 the proceeding. Attachment 1 names the board.
async function seedWork(f) {
  await submissionDataExecute(
    f.dbPath,
    `
    INSERT INTO tickets (id, proceeding_id, filing_id, title, intent, status, priority, kind, billing_anchor, locked_by, locked_at, created)
      VALUES (1, 1, 1, 'Settle the requisition', 'Settle it.', 'queued', 0, 'work', 'L8470', NULL, NULL, '2026-10-10 09:00'),
             (2, 1, NULL, 'Confirm the style of cause', 'Check the pleadings.', 'queued', 0, 'charting', NULL, NULL, NULL, '2026-10-10 09:05'),
             (3, 1, ${f.boardId}, 'Find the paper original', 'Look in the vault.', 'queued', 0, 'work', 'L8470', NULL, NULL, '2026-10-10 09:10'),
             (4, 1, ${f.boardId}, 'Stamp the original', 'Stamp it.', 'wip', 0, 'work', 'L8470', 'sess-a', '2026-10-10 09:30', '2026-10-10 09:15'),
             (5, 1, ${f.boardId}, 'Scan it twice', 'A mistake.', 'queued', 0, 'work', 'L8470', NULL, NULL, '2026-10-10 09:20');
    UPDATE tickets SET deleted_at = '2026-10-10T09:25' WHERE id = 5;
    INSERT INTO seeds (id, proceeding_id, filing_id, created, surfaced_by, idea)
      VALUES (1, 1, ${f.boardId}, '2026-10-10 09:40', 'noticed', 'Is there a second original?'),
             (2, 1, NULL, '2026-10-10 09:45', 'noticed', 'Ask about costs.');
    INSERT INTO board_attachments (id, proceeding_id, filing_id, path, kind, attached_on)
      VALUES (1, 1, ${f.boardId}, '0. DRAFT\\Letter about the original', 'client_letter', '2026-10-10');
    `.trim()
  );
}

test("create_milestone writes one filings row of the reserved kind, with no stored layout and no job", async (t) => {
  const f = await fixture(t, { board: false });
  const before = revisionOf(f.dbPath);

  const result = await createBoard(f.dbPath, { title: "  Paper originals  " });

  assert.deepEqual(result, { filing_id: 2, proceeding_id: 1, title: TITLE }, "the title is trimmed");
  assert.equal(MILESTONE_KIND, "task-board");
  assert.deepEqual(filingsOf(f.dbPath)[1], { id: 2, proceeding_id: 1, kind: "task-board", title: TITLE, needs_forum_parts: 0, layout_snapshot: null, retired_on: null });
  assert.equal(isJobOnlyBoard(filingsOf(f.dbPath)[1]), true);
  assert.equal(isJobOnlyBoard(filingsOf(f.dbPath)[0]), false);
  assert.equal(query(f.dbPath, "SELECT COUNT(*) AS n FROM tickets")[0].n, 0, "this tool writes no job");
  assert.ok(revisionOf(f.dbPath) > before, "opening a board moves the revision");

  const second = await createBoard(f.dbPath, { title: "Courier runs" });
  assert.equal(second.filing_id, 3, "a proceeding can hold more than one");
});

test("create_milestone refuses a blank title and a proceeding with no Writing, writing nothing", async (t) => {
  const f = await fixture(t, { board: false });
  const filings = filingsOf(f.dbPath);
  const revision = revisionOf(f.dbPath);

  await assert.rejects(createBoard(f.dbPath, { title: "   " }), code("invalid_title"));
  await assert.rejects(submissionDataCreateMilestone({ db_path: f.dbPath, proceeding_id: 1, title: "" }), code("invalid_title"));
  await assert.rejects(createBoard(f.dbPath, { title: "" }), /title is required/, "the dispatch refuses an empty title before the tool does");
  await assert.rejects(createBoard(f.dbPath, { proceeding_id: 2 }), code("no_writing", /proceeding 2 has no Writing.*nothing was written/));
  await assert.rejects(createBoard(f.dbPath, { proceeding_id: 99 }), /99/);
  assert.deepEqual(filingsOf(f.dbPath), filings);
  assert.equal(revisionOf(f.dbPath), revision);

  // A board is not a Writing: a proceeding holding only one still has no Writing.
  await submissionDataExecute(f.dbPath, `INSERT INTO filings (id, proceeding_id, kind, title, needs_forum_parts) VALUES (9, 2, '${MILESTONE_KIND}', 'Stray board', 0);`);
  await assert.rejects(createBoard(f.dbPath, { proceeding_id: 2 }), code("no_writing"));
  assert.deepEqual(filingsOf(f.dbPath).map((x) => x.id), [1, 9]);
});

test("create_writing refuses the reserved kind and writes nothing", async (t) => {
  const f = await fixture(t, { board: false });
  await assert.rejects(
    callTool({}, "drafting_data__create_writing", { db_path: f.dbPath, proceeding_id: 1, tree: { country: "CAN", jurisdiction: "BC", venue: "BCSC" }, kind: MILESTONE_KIND, title: TITLE }),
    code("reserved_kind", /drafting_data__create_milestone/)
  );
  assert.deepEqual(filingsOf(f.dbPath).map((x) => x.id), [1]);
});

test("without draft_dir the render returns the board alone and writes nothing", async (t) => {
  const f = await fixture(t);
  await seedWork(f);

  const result = render(f.dbPath, f.boardId);

  assert.equal(result.filing_id, f.boardId);
  assert.equal(result.milestone_only, true);
  assert.equal(result.filing_retired, undefined);
  assert.equal(result.session_token, "tok-1");
  assert.equal(result.rendered_at, PINNED);
  assert.deepEqual(result.documents.map((d) => d.document_type), ["Work_board"], "no mockup");
  const board = boardOf(result);
  assert.match(board.board_summary, /^# Milestone — Matter L8470 · Client Larchmont \(1\) · Rev \d+\nTo Do: This matter's to-dos were not read\.\nGoal: Goal not set \(none\)\nState: Open$/);
  assert.equal(board.pages_written, false);
  assert.equal(board.path, undefined);
  assert.equal(board.ingest_inputs, undefined);
  assert.equal(result.view_page_paths, undefined);
  assert.deepEqual(readdirSync(f.draft), []);
  assert.equal(existsSync(join(dirname(f.dbPath), "mockups")), false, "no mockup folder and no manifest beside the database");
});

test("with draft_dir the render writes the board's page among the matter's pages, and no folder, mockup or view page for it", async (t) => {
  const f = await fixture(t);
  await seedWork(f);

  const result = render(f.dbPath, f.boardId, { draftDir: f.draft });

  const page = join(f.draft, `Milestone ${f.boardId}.html`);
  const board = boardOf(result);
  assert.equal(result.milestone_only, true);
  assert.deepEqual(result.documents.map((d) => d.document_type), ["Work_board"]);
  assert.equal(board.path, page);
  assert.equal(board.file_name, `Milestone ${f.boardId}.html`);
  assert.equal(board.pages_written, true);
  assert.match(board.board_summary, /^State: Open$/m);
  assert.equal(board.board_summary.includes("🎯"), false, "no completion criteria");

  const entries = readdirSync(f.draft, { withFileTypes: true });
  assert.deepEqual(entries.filter((e) => e.isDirectory()).map((e) => e.name), ["Consent Order Requisition", "Drafting records"], "the Writing's folder and the records folder, and no folder for the board");
  const names = entries.map((e) => e.name);
  assert.deepEqual(names.filter((name) => name.includes(`Milestone ${f.boardId}`)), [`Milestone ${f.boardId}.html`], "its page, and no view page beside it");
  assert.ok(names.includes("Litigation Strategy.html"));
  assert.ok(existsSync(join(f.draft, "Consent Order Requisition", "Milestone.html")), "the Writing's page is written too");
  assert.ok(existsSync(join(f.draft, "Consent Order Requisition", "Arguments.html")), "the Writing keeps its view pages");
  assert.deepEqual([...new Set(result.view_page_paths.map((p) => p.filing_id))], [1], "view pages are the Writing's alone");
  for (const name of readdirSync(dirname(f.dbPath))) {
    assert.doesNotMatch(name, /brief|manifest|mockups/i, `nothing of a mockup beside the database: ${name}`);
  }
  assert.deepEqual(readdirSync(join(f.draft, "Drafting records")), ["matter-pages-state.json"], "only the pages' own state file, no manifest");

  const data = readBoardData(page);
  assert.deepEqual(data.sections.map((s) => [s.meta.filing_id, s.meta.proceeding_id]), [[f.boardId, 1]], "its own section alone");
  assert.deepEqual(data.strip, [], "no Writings strip and no view page tiles");
  assert.deepEqual(data.court_file, []);
  const section = data.sections[0];
  assert.equal(section.meta.job_only, true);
  assert.equal(section.meta.filing, TITLE);
  assert.equal(section.meta.state, null);
  assert.equal(section.meta.state_label, "Open");
  assert.equal(section.meta.state_since, null);
  assert.equal(section.meta.ready_to_retire, false);
  assert.equal("ingest_inputs" in section.meta, false);
  assert.equal("goal" in section, false, "no Goal card");
  assert.equal("criteria" in section, false, "no criteria and no gate");
  assert.deepEqual(section.proposals, []);
  assert.deepEqual(section.lapsed_keys, []);
});

test("the render refuses a filed face and a Writing folder", async (t) => {
  const f = await fixture(t);
  assert.throws(() => render(f.dbPath, f.boardId, { mode: "filed" }), code("milestone_only", /no filed document/));
  assert.throws(() => render(f.dbPath, f.boardId, { presentationDir: join(f.draft, "Paper originals") }), code("milestone_only", /no Writing folder/));
  await assert.rejects(callTool({}, "drafting_forms__render", { db_path: f.dbPath, filing_id: f.boardId, render_mode: "filed" }), code("milestone_only"));
  assert.deepEqual(readdirSync(f.draft), []);
});

test("the board shows only the rows that name it, and its jobs show on no Writing's board", async (t) => {
  const f = await fixture(t);
  await seedWork(f);

  const board = boardDataOf(f.dbPath, f.boardId, CLIENT, PINNED);
  assert.deepEqual(board.tickets.map((x) => [x.id, x.category]), [[3, "ready"], [4, "wip"]], "never the Writing's job or the proceeding's");
  assert.deepEqual(board.deleted, [{ id: 5, title: "Scan it twice" }]);
  assert.deepEqual(board.seeds.map((s) => [s.id, s.from_filing]), [[1, null]], "its own loose thread, not the proceeding's");
  assert.deepEqual(board.attachments.map((a) => a.id), [1], "its own attachment, not the proceeding's");

  const writing = boardDataOf(f.dbPath, 1, CLIENT, PINNED);
  assert.deepEqual(writing.tickets.map((x) => x.id), [1, 2], "the Writing's job and the proceeding's, none of the board's");
  assert.deepEqual(writing.deleted, []);
  assert.deepEqual(writing.attachments.map((a) => a.id), [2], "the proceeding's attachment stays with the lowest-id live Writing");
  // Deliberate: every open loose thread in the proceeding shows on each Writing's board.
  assert.deepEqual(writing.seeds.map((s) => [s.id, s.from_filing]), [[1, TITLE], [2, null]]);
});

test("a board with the proceeding's lowest live id still takes no proceeding-wide row", async (t) => {
  const f = await fixture(t);
  await seedWork(f);
  // Filing 1 retires and Writing 3 is created, so the board (2) is the lowest-id live row.
  await submissionDataExecute(
    f.dbPath,
    `UPDATE tickets SET status = 'completed', completed_at = '2026-10-10T09:50' WHERE id = 1;
     INSERT INTO filings (id, proceeding_id, kind, subkind, title) VALUES (3, 1, 'requisition_consent', 'consent', 'Second Requisition');
     UPDATE filings SET retired_on = '2026-10-10', retirement_reason = 'abandoned' WHERE id = 1;`
  );

  assert.deepEqual(boardDataOf(f.dbPath, f.boardId, CLIENT, PINNED).attachments.map((a) => a.id), [1]);
  assert.deepEqual(boardDataOf(f.dbPath, f.boardId, CLIENT, PINNED).tickets.map((x) => x.id), [3, 4]);
  const writing = boardDataOf(f.dbPath, 3, CLIENT, PINNED);
  assert.deepEqual(writing.attachments.map((a) => a.id), [2], "the lowest-id live Writing is filing 3, never the board");
  assert.deepEqual(writing.tickets.map((x) => x.id), [2]);
});

test("board_card prints no criteria, Proposed or Court File lane for the board", async (t) => {
  const f = await fixture(t);
  await seedWork(f);

  const { card } = submissionFormsBoardCard({ db_path: f.dbPath, filing_id: f.boardId, lanes: [...CARD_LANES], draft_dir: f.draft }, CLIENT, PINNED);

  assert.equal(card.includes("🎯"), false, "the criteria lane prints nothing");
  assert.equal(card.includes("## Proposed"), false, "no Proposed lane, and no Proposed count in the live lane");
  assert.equal(card.includes("## Court File"), false);
  assert.match(card, /^## Ready \(1\)$/m);
  assert.match(card, /^## In Progress \(1\)$/m);
  assert.match(card, /^## Loose Threads \(1\)$/m);
  assert.match(card, /^## Attached \(1\)$/m);
  assert.match(card, /Find the paper original/);
  assert.equal(card.includes("Settle the requisition"), false, "the Writing's job is not on this card");
  assert.equal(card.includes("Confirm the style of cause"), false, "nor the proceeding's");

  const writingCard = submissionFormsBoardCard({ db_path: f.dbPath, filing_id: 1, lanes: ["live"] }, CLIENT, PINNED).card;
  assert.match(writingCard, /^## Proposed \(\d+\)$/m, "a Writing's live lane keeps its Proposed count");
  assert.throws(() => submissionFormsBoardCard({ db_path: f.dbPath, filing_id: 1, jobs: [3] }, CLIENT, PINNED), /no Job #3 on this section/);
});

test("bootstrap lists the board with no paths and no render_state, and the Litigation Strategy lists it under Milestones", async (t) => {
  const f = await fixture(t);
  await seedWork(f);

  const result = submissionFormsBootstrap(f.dbPath, CLIENT, PINNED, f.draft, { rows: [] });

  const listed = result.filings.find((x) => x.filing_id === f.boardId);
  assert.equal(listed.milestone_only, true);
  assert.equal(listed.title, TITLE);
  assert.deepEqual(listed.paths, []);
  assert.equal("render_state" in listed, false);
  assert.equal("retired_on" in listed, false);
  const writing = result.filings.find((x) => x.filing_id === 1);
  assert.equal("milestone_only" in writing, false);
  assert.equal(writing.render_state, "never");
  assert.deepEqual(
    result.milestone_paths.map((p) => [p.filing_id, p.proceeding_id, p.path]).sort(),
    [
      [1, 1, join(f.draft, "Consent Order Requisition", "Milestone.html")],
      [f.boardId, 1, join(f.draft, `Milestone ${f.boardId}.html`)],
      [null, 2, join(f.draft, "Milestone - proceeding 2.html")],
    ].sort(),
    "the board has a page of its own"
  );
  assert.equal(existsSync(join(f.draft, "Drafting records", "matter-pages-state.json")), true);
  assert.deepEqual(readdirSync(join(f.draft, "Drafting records")), ["matter-pages-state.json"], "bootstrap looks up no manifest for it");

  const page = readFileSync(result.matter_board_path, "utf-8");
  assert.ok(page.includes('section("milestones", "Milestones"'), "the page draws a Milestones section");
  const data = matterBoard(result.matter_board_path);
  const line = data.filings.find((x) => x.filing_id === f.boardId);
  assert.deepEqual(line, { filing_id: f.boardId, title: TITLE, state: line.state, state_label: "Open", state_since: null, render_state: null, in_progress: 1, job_only: true });
  const writingLine = data.filings.find((x) => x.filing_id === 1);
  assert.equal("job_only" in writingLine, false);
  assert.equal(writingLine.in_progress, 0, "the board's job in progress is not counted on the Writing");
  assert.deepEqual(data.pre_filing.map((p) => p.proceeding_id), [2]);
});

// jobs-closeout.md §9a: closing is the retirement script with the reason `other`.
const closeSql = (id) =>
  `UPDATE filings SET retired_on = '2026-10-11', retirement_reason = 'other' WHERE id = ${id}
     AND NOT EXISTS (SELECT 1 FROM tickets WHERE filing_id = ${id} AND status = 'wip');
   UPDATE tickets SET status = 'superseded' WHERE filing_id = ${id} AND status = 'queued' AND deleted_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM tickets WHERE filing_id = ${id} AND status = 'wip');`;

/** A board holding one queued job, closed. */
async function closedBoard(t) {
  const f = await fixture(t);
  await submissionDataExecute(
    f.dbPath,
    `INSERT INTO tickets (id, proceeding_id, filing_id, title, intent, status, priority, kind, billing_anchor, created)
       VALUES (3, 1, ${f.boardId}, 'Find the paper original', 'Look in the vault.', 'queued', 0, 'work', 'L8470', '2026-10-10 09:10');`
  );
  const open = revisionOf(f.dbPath);
  await submissionDataExecute(f.dbPath, closeSql(f.boardId));
  assert.ok(revisionOf(f.dbPath) > open, "closing moves the revision");
  assert.equal(query(f.dbPath, "SELECT status FROM tickets WHERE id = 3")[0].status, "superseded", "its queued job is superseded");
  return f;
}

test("a closed board reads Closed, has no page, and is listed under Retired", async (t) => {
  const f = await closedBoard(t);

  const closed = render(f.dbPath, f.boardId, { draftDir: f.draft });
  assert.equal(closed.milestone_only, true);
  assert.equal(closed.filing_retired, true);
  assert.match(closed.note, new RegExp(`^Milestone ${f.boardId} was closed on 2026-10-11, so it has no page\\.`));
  assert.deepEqual(closed.documents.map((d) => d.document_type), ["Work_board"]);
  assert.match(boardOf(closed).board_summary, /^State: Closed 2026-10-11$/m);
  assert.equal(boardOf(closed).path, undefined, "a closed board has no page");
  assert.equal(boardOf(closed).pages_written, true, "the matter's other pages are rewritten");

  const listing = submissionFormsBootstrap(f.dbPath, CLIENT, PINNED, f.draft, { rows: [] });
  const listed = listing.filings.find((x) => x.filing_id === f.boardId);
  assert.equal(listed.milestone_only, true);
  assert.equal(listed.retired_on, "2026-10-11");
  assert.equal(listed.retirement_reason, "other");
  assert.deepEqual(listed.paths, []);
  assert.equal(listing.milestone_paths.some((p) => p.filing_id === f.boardId), false);
  const line = matterBoard(listing.matter_board_path).filings.find((x) => x.filing_id === f.boardId);
  assert.equal(line.job_only, true);
  assert.equal(line.state_label, "Closed");
  assert.equal(line.retired_on, "2026-10-11");
  assert.equal(line.in_progress, undefined);
  assert.ok(readFileSync(listing.matter_board_path, "utf-8").includes('f.job_only ? "Closed " + f.retired_on'), "its Retired card reads Closed, with no reason");
  await assert.rejects(
    callTool({}, "drafting_data__record_filed", { db_path: f.dbPath, filing_id: f.boardId, filed_on: "2026-10-12", expect_revision: revisionOf(f.dbPath) }),
    code("milestone_only"),
    "a closed board is refused as a board, not as a retired Writing"
  );
});

test("reopening a closed board brings its page back and un-supersedes nothing", async (t) => {
  const f = await closedBoard(t);
  const page = join(f.draft, `Milestone ${f.boardId}.html`);
  assert.equal(boardOf(render(f.dbPath, f.boardId, { draftDir: f.draft })).path, undefined);
  assert.equal(existsSync(page), false);

  await submissionDataExecute(f.dbPath, `UPDATE filings SET retired_on = NULL, retirement_reason = NULL WHERE id = ${f.boardId};`);
  const reopened = render(f.dbPath, f.boardId, { draftDir: f.draft });
  assert.equal(reopened.filing_retired, undefined);
  assert.equal(reopened.note, undefined);
  assert.match(boardOf(reopened).board_summary, /^State: Open$/m);
  assert.equal(boardOf(reopened).path, page);
  assert.ok(existsSync(page));
  assert.equal(query(f.dbPath, "SELECT status FROM tickets WHERE id = 3")[0].status, "superseded", "reopening un-supersedes nothing");
});

test("a job in progress on the board refuses the close", async (t) => {
  const f = await fixture(t);
  await seedWork(f);
  await submissionDataExecute(f.dbPath, "DELETE FROM board_attachments;");

  const { changes } = await submissionDataExecute(f.dbPath, closeSql(f.boardId));

  assert.equal(changes, 0);
  assert.equal(filingsOf(f.dbPath).find((x) => x.id === f.boardId).retired_on, null);
  assert.equal(query(f.dbPath, "SELECT status FROM tickets WHERE id = 3")[0].status, "queued");
});

test("every tool that acts on a Writing's document refuses the board", async (t) => {
  const f = await fixture(t);
  const base = { db_path: f.dbPath, filing_id: f.boardId };
  const calls = {
    drafting_data__record_sent: { sent_on: "2026-10-10", sent_copy_text: "Sent as drafted.", expect_revision: revisionOf(f.dbPath) },
    drafting_data__record_filed: { filed_on: "2026-10-10", expect_revision: revisionOf(f.dbPath) },
    drafting_data__record_served: { served_on: "2026-10-10", expect_revision: revisionOf(f.dbPath) },
    drafting_data__resnapshot_writing: {},
    drafting_forms__pre_filing_check: { package_dir: f.draft },
    drafting_forms__emit_form32: {},
    drafting_forms__emit_form33: {},
    drafting_forms__emit_affidavit: { document_id: 1 },
    drafting_forms__emit_bcca_book: {},
    drafting_forms__emit_bcca_factum: { dated_on: "2026-10-10" },
  };
  const before = JSON.stringify(filingsOf(f.dbPath));
  const revision = revisionOf(f.dbPath);
  for (const [tool, args] of Object.entries(calls)) {
    await assert.rejects(async () => callTool({}, tool, { ...base, ...args }), code("milestone_only", /Milestone \d+ has no Writing/), tool);
  }
  assert.equal(JSON.stringify(filingsOf(f.dbPath)), before);
  assert.equal(revisionOf(f.dbPath), revision);
});

test("completing a proceeding-wide job rewrites a Writing's page, and completing the board's job its own", async (t) => {
  const f = await fixture(t);
  await seedWork(f);
  // Filing 1 retires, so the board (2) is the proceeding's lowest-id live row, ahead of Writing 3.
  await submissionDataExecute(
    f.dbPath,
    `UPDATE tickets SET status = 'completed', completed_at = '2026-10-10T09:50' WHERE id = 1;
     UPDATE tickets SET status = 'wip', locked_by = 'sess-a', locked_at = '2026-10-10 09:55' WHERE id = 2;
     INSERT INTO filings (id, proceeding_id, kind, subkind, title) VALUES (3, 1, 'requisition_consent', 'consent', 'Second Requisition');
     UPDATE filings SET retired_on = '2026-10-10', retirement_reason = 'abandoned' WHERE id = 1;`
  );
  const complete = (ticketId) => submissionDataCompleteJob({ db_path: f.dbPath, ticket_id: ticketId, session_token: "sess-a", draft_dir: f.draft }, CLIENT);

  const wide = await complete(2);
  assert.equal(wide.outcome, "completed");
  assert.equal(wide.pages_refused, undefined);
  assert.equal(wide.milestone_path, join(f.draft, "Second Requisition", "Milestone.html"), "never the board, which shows no job without a filing_id");

  const own = await complete(4);
  assert.equal(own.outcome, "completed");
  assert.equal(own.pages_refused, undefined);
  assert.equal(own.pages_written, true);
  assert.equal(own.milestone_path, join(f.draft, `Milestone ${f.boardId}.html`));
  assert.deepEqual(readBoardData(own.milestone_path).sections[0].tickets.map((x) => [x.id, x.category]), [[3, "ready"], [4, "completed"]]);
});
