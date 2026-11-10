// The matter's pages (#1365, ADR 0033's 2026-10-05 amendment): one Litigation Strategy.html and one Work Board
// page per live filing (in its Writing's own folder) and per pre-filing proceeding in the matter's 0. DRAFT folder,
// rewritten by rename-replace and only over a file carrying their marker;
// the state sidecar board_changed and board_moves compare against, never a page; the old page files
// moved into the matter's TRASH; and the lean render response with its short board_summary, and
// board_card, which prints the live lanes, the completion criteria and what a card holds.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import test, { after } from "node:test";

import { startFakeCloud } from "./helpers/fake-cloud.mjs";
import { runInNewContext } from "node:vm";

// open_session starts the background render job (#589): its locks and status mirrors stay out of the
// practitioner's %LOCALAPPDATA%.
process.env.COCLERK_SUBMISSION_LOCK_ROOT = mkdtempSync(join(tmpdir(), "coclerk-matter-pages-locks-"));
after(() => rmSync(process.env.COCLERK_SUBMISSION_LOCK_ROOT, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));

const { seededDbFixture, seedVaniacProceeding, seedBcscDefaultJudgment, seedTickets, seedProposalCases, assertMatchesGolden, readBoardData, boardDataOf, ASHBOURNE, draftFolder } =
  await import("./fixtures/forms-render-seeds.mjs");
const { moveSeeds } = await import("./helpers/threads.mjs");
const { freshSubmissionDb, submissionDbAt } = await import("./helpers/template-db.mjs");
const { submissionDataExecute, submissionDataQuery, submissionDataWrite } = await import("../build/submission/backend.js");
const { submissionFormsRender, submissionFormsRenderProceedingBoard } = await import("../build/submission/forms.js");
const { fetchProceeding, fetchRevision } = await import("../build/submission/forms/query.js");
const { buildPreFilingBoardData } = await import("../build/submission/forms/render-work-board.js");
const { renderLiveLanes, submissionFormsBoardCard } = await import("../build/submission/matter-pages.js");
const { renderWorkBoardHtml } = await import("../build/submission/forms/workboard-shell.js");
const { VIEW_PAGES } = await import("../build/submission/view-pages.js");
const { ValidationError } = await import("../build/errors.js");
const { buildToolDefinitions, callTool, createDispatchContext } = await import("../build/index.js");
const { awaitBackgroundJobs } = await import("../build/submission/render-job.js");
const writes = await import("../build/tools/practice/writes.js");

const FIRST = "2026-10-02 09:00";
const SECOND = "2026-10-02 09:05";
// A Writing's Work Board page is in its own folder (spec 2026-10-22 §9); a pre-filing proceeding's stays at the top.
const OPENING_PAGE = join("Opening Submissions Package", "Work Board.html");
const REPLY_PAGE = join("Reply Submissions Package", "Work Board.html");
const PAGES = [OPENING_PAGE, "Litigation Strategy.html", "Loose Threads.html"];

/** A mockup render of one filing with draft_dir, at a pinned minute. */
function renderInto(f, filingId, draft, now, documents) {
  return submissionFormsRender(f.dbPath, filingId, ASHBOURNE, "mockup", documents, undefined, undefined, now, "tok", draft);
}

/** Every Work Board page in the draft folder, at its top or in a Writing's folder, relative to it, sorted. */
function milestonePages(draft) {
  return namesUnder(draft)
    .map(String)
    .filter((name) => /^Work Board( .*)?\.html$/.test(name.split(/[\\/]/).pop()))
    .sort();
}

/** The section of the Work Board page whose one section is filing `filingId`'s. */
function sectionOf(draft, filingId) {
  const page = milestonePages(draft)
    .map((name) => readBoardData(join(draft, name)))
    .find((data) => data.sections[0]?.meta.filing_id === filingId);
  assert.ok(page, `expected a Work Board page for filing ${filingId} in ${draft}`);
  assert.equal(page.sections.length, 1, `filing ${filingId}'s Work Board page holds one section`);
  return page.sections[0];
}

/** Every file name under `dir`, at any depth. */
function namesUnder(dir) {
  return readdirSync(dir, { recursive: true });
}

test("two renders of one matter leave one Work Board page per live filing and one Litigation Strategy at their fixed paths, holding the later render", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedVaniacProceeding(f.dbPath);
    await submissionDataExecute(f.dbPath, "INSERT INTO filings (id, proceeding_id, kind, subkind, round, title) VALUES (2, 1, 'submissions_package', NULL, 'reply', 'Reply Submissions Package');");
    const { draft } = draftFolder(f);

    renderInto(f, 1, draft, FIRST);
    renderInto(f, 2, draft, SECOND);

    assert.deepEqual(readdirSync(draft), ["Drafting records", "Litigation Strategy.html", "Loose Threads.html", "Opening Submissions Package", "Reply Submissions Package"]);
    for (const [name, filingId] of [[OPENING_PAGE, 1], [REPLY_PAGE, 2]]) {
      const page = readBoardData(join(draft, name));
      assert.equal(page.meta.rendered, SECOND, `the later render's ${name}`);
      assert.deepEqual(page.sections.map((s) => s.meta.filing_id), [filingId], `${name} holds its filing's section alone`);
    }
    assert.match(readFileSync(join(draft, "Litigation Strategy.html"), "utf-8"), new RegExp(`"rendered":"${SECOND}"`));
    assert.deepEqual(namesUnder(draft).filter((name) => /\.tmp$|-\d+\.html$/.test(name)), [], "no temp file and no numbered copy");
    for (const leaf of ["Opening Submissions Package", "Reply Submissions Package"]) {
      const pages = readdirSync(join(draft, leaf)).filter((name) => name.endsWith(".html")).sort();
      assert.deepEqual(pages, ["Work Board.html", ...VIEW_PAGES.map((p) => `${p.name}.html`)].sort(), `the board and its view pages in the Writing's folder ${leaf}`);
    }
    assert.equal(readdirSync(dirname(f.dbPath)).some((name) => /mockups|\.html$/.test(name)), false, "no board beside the database");
  } finally {
    f.cleanup();
  }
});

// ADR 0033, 2026-10-05 amendment: a Work Board page never holds more than one filing.
async function twoFilingBoard(f) {
  await freshSubmissionDb(f.dbPath);
  await seedVaniacProceeding(f.dbPath);
  await seedTickets(f.dbPath);
  await seedProposalCases(f.dbPath);
  const { draft } = draftFolder(f);
  const result = renderInto(f, 1, draft, FIRST, ["Work_board"]);
  return { draft, result };
}

test("two live filings in one proceeding get a Work Board page each, each with one section and at most one Goal", async () => {
  const f = seededDbFixture();
  try {
    const { draft, result } = await twoFilingBoard(f);

    // seedTickets' proceeding 2 has no filing, so it has a page of its own.
    assert.deepEqual(milestonePages(draft), [OPENING_PAGE, REPLY_PAGE, "Work Board - proceeding 2.html"]);
    for (const name of milestonePages(draft)) {
      const { sections } = readBoardData(join(draft, name));
      assert.equal(sections.length, 1, `${name} holds one section`);
      assert.ok(sections.filter((s) => s.goal !== undefined).length <= 1, `${name} holds at most one Goal`);
    }
    assert.equal(sectionOf(draft, 1).meta.filing_id, 1);
    assert.equal(sectionOf(draft, 2).meta.filing_id, 2);
    const board = result.documents.find((d) => d.document_type === "Work_board");
    assert.equal(board.path, join(draft, OPENING_PAGE), "the render returns its own filing's page");
    assert.equal(board.file_name, "Work Board.html");
  } finally {
    f.cleanup();
  }
});

test("a proceeding-scoped job shows on every filing's Work Board page in its proceeding", async () => {
  const f = seededDbFixture();
  try {
    const { draft } = await twoFilingBoard(f);

    for (const filingId of [1, 2]) {
      assert.ok(sectionOf(draft, filingId).tickets.some((t) => t.id === 7), `job 7 (no filing_id) is on filing ${filingId}'s page`);
    }
  } finally {
    f.cleanup();
  }
});

test("a matter with one live filing has that filing's Work Board page, the Litigation Strategy and the presentation folder, and the section a render builds", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedVaniacProceeding(f.dbPath);
    const { draft } = draftFolder(f);

    renderInto(f, 1, draft, FIRST);

    assert.deepEqual(readdirSync(draft), ["Drafting records", "Litigation Strategy.html", "Loose Threads.html", "Opening Submissions Package"]);
    const { meta: pageMeta, ...page } = sectionOf(draft, 1);
    const { meta: builtMeta, ...built } = boardDataOf(f.dbPath, 1, ASHBOURNE, SECOND);
    assert.deepEqual(page, built);
    assert.deepEqual({ ...pageMeta, rendered: undefined }, { ...builtMeta, rendered: undefined });
  } finally {
    f.cleanup();
  }
});

test("a retitle leaves the filing's Work Board page at its path and moves nothing to TRASH", async (t) => {
  const m = matterFixture(t);
  await seedOneFiling(m.dbPath);
  const render = (now) => submissionFormsRender(m.dbPath, 1, ASHBOURNE, "mockup", undefined, undefined, undefined, now, undefined, m.draft);
  render(FIRST);
  assert.deepEqual(milestonePages(m.draft), [OPENING_PAGE]);

  await submissionDataExecute(m.dbPath, "UPDATE filings SET title = 'Amended Opening Submissions' WHERE id = 1;");
  const retitled = render(SECOND);

  assert.deepEqual(milestonePages(m.draft), [OPENING_PAGE]);
  assert.equal(retitled.documents.find((d) => d.document_type === "Work_board").path, join(m.draft, OPENING_PAGE));
  assert.equal(sectionOf(m.draft, 1).meta.filing, "Amended Opening Submissions");
  assert.equal(retitled.moved_to_trash, undefined, "nothing moved to TRASH");
  assert.equal(existsSync(join(m.matterRoot, "TRASH")), false, "no TRASH folder");
});

test("a retired filing's Work Board page goes to TRASH", async (t) => {
  const m = matterFixture(t);
  await seedOneFiling(m.dbPath);
  await submissionDataExecute(m.dbPath, "INSERT INTO filings (id, proceeding_id, kind, round, title) VALUES (2, 1, 'submissions_package', 'reply', 'Reply Submissions Package');");
  const render = (now) => submissionFormsRender(m.dbPath, 1, ASHBOURNE, "mockup", undefined, undefined, undefined, now, undefined, m.draft);
  render(FIRST);
  assert.deepEqual(milestonePages(m.draft), [OPENING_PAGE, REPLY_PAGE]);

  await submissionDataExecute(m.dbPath, "UPDATE filings SET decided_on = '2026-09-02', retired_on = '2026-09-10', retirement_reason = 'decided' WHERE id = 2;");
  const retired = render(SECOND);
  assert.deepEqual(milestonePages(m.draft), [OPENING_PAGE]);
  assert.deepEqual(
    retired.moved_to_trash.map((x) => x.from.toLowerCase()),
    ["Arguments", "Legal Research", "Material Facts", "Procedural History", "Work Board"].map((n) => join(m.draft, "Reply Submissions Package", `${n}.html`).toLowerCase())
  );
  assert.ok(existsSync(join(m.matterRoot, "TRASH", "0. DRAFT", REPLY_PAGE)), "the retired filing's page is in TRASH");
});

test("a file without the page marker at another filing's or proceeding's page name refuses filing 1's render before any presentation copy is written", async (t) => {
  for (const [other, seed] of [
    [REPLY_PAGE, "INSERT INTO filings (id, proceeding_id, kind, round, title) VALUES (2, 1, 'submissions_package', 'reply', 'Reply Submissions Package');"],
    ["Work Board - proceeding 2.html", "INSERT INTO proceedings (id, matter_reference, forum) VALUES (2, 'L9999 - Other', 'CAN/BC/Vancouver-International-Arbitration-Centre');"],
  ]) {
    const m = matterFixture(t);
    await seedOneFiling(m.dbPath);
    await submissionDataExecute(m.dbPath, seed);
    const own = "<p>the practitioner's own page</p>\n";
    const page = join(m.draft, other);
    mkdirSync(dirname(page), { recursive: true });
    writeFileSync(page, own, "utf-8");

    assert.throws(
      () => submissionFormsRender(m.dbPath, 1, ASHBOURNE, "mockup", undefined, undefined, undefined, FIRST, undefined, m.draft),
      (err) => err.message.includes(page) && /does not carry the Work Board's marker, so this renderer did not write it/.test(err.message),
      other
    );

    assert.equal(readFileSync(page, "utf-8"), own, `${other}: the practitioner's file is untouched`);
    // Filing 1's mockups are written before the page write refuses, as every refusal leaves them.
    const html = namesUnder(m.draft).map(String).filter((name) => /\.html$|\.tmp$/.test(name));
    assert.deepEqual(html, [other], `${other}: no page, no Litigation Strategy, no view page, no temp file`);
  }
});

test("a pre-filing proceeding has a Work Board page of its own until it gains a filing, which moves that page to TRASH", async (t) => {
  const m = matterFixture(t);
  await freshSubmissionDb(m.dbPath);
  await submissionDataExecute(m.dbPath, "INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L9999 - Test', 'CAN/BC/Vancouver-International-Arbitration-Centre');");
  const proceedingPage = "Work Board - proceeding 1.html";

  const board = submissionFormsRenderProceedingBoard(m.dbPath, 1, ASHBOURNE, FIRST, "tok", m.draft);
  assert.equal(board.milestone_path, join(m.draft, proceedingPage));
  assert.deepEqual(board.milestone_paths, [{ filing_id: null, proceeding_id: 1, path: join(m.draft, proceedingPage) }]);
  assert.equal(board.loose_threads_path, join(m.draft, "Loose Threads.html"));
  assert.deepEqual(readdirSync(m.draft), ["Drafting records", "Litigation Strategy.html", "Loose Threads.html", proceedingPage]);
  assert.deepEqual(readBoardData(join(m.draft, proceedingPage)).sections.map((s) => [s.meta.filing_id, s.meta.proceeding_id]), [[null, 1]]);

  await submissionDataExecute(m.dbPath, "INSERT INTO filings (id, proceeding_id, kind, round, title) VALUES (1, 1, 'submissions_package', 'opening', 'Opening Submissions Package');");
  const rendered = submissionFormsRender(m.dbPath, 1, ASHBOURNE, "mockup", undefined, undefined, undefined, SECOND, undefined, m.draft);
  assert.deepEqual(milestonePages(m.draft), [OPENING_PAGE]);
  assert.deepEqual(rendered.moved_to_trash.map((x) => x.from.toLowerCase()), [join(m.draft, proceedingPage).toLowerCase()]);
});

test("a Work Board page without the page's marker refuses the render before any page or presentation copy is written", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedVaniacProceeding(f.dbPath);
    const { draft } = draftFolder(f);
    const own = "<p>the practitioner's own page</p>\n";
    const page = join(draft, OPENING_PAGE);
    mkdirSync(dirname(page), { recursive: true });
    writeFileSync(page, own, "utf-8");

    assert.throws(
      () => renderInto(f, 1, draft, FIRST),
      (err) => err.message.includes(page) && /does not carry the Work Board's marker, so this renderer did not write it/.test(err.message)
    );

    assert.equal(readFileSync(page, "utf-8"), own, "the practitioner's file is untouched");
    assert.deepEqual(namesUnder(draft).map(String).filter((name) => /\.html$|\.tmp$/.test(name)), [OPENING_PAGE], "no Litigation Strategy, no view page, no temp file");
    assert.ok(existsSync(join(draft, "Drafting records", "render-manifest-1.json")), "the mockups are written, as every refusal leaves them");
  } finally {
    f.cleanup();
  }
});

// The open_session fixture: <tmp>/L9999 Test Matter/coclerk.json -> <tmp>/L9999 Test Matter/0. CASE DATA/submission.sqlite, beside its 0. DRAFT.
function matterFixture(t) {
  const base = mkdtempSync(join(tmpdir(), "coclerk-matter-pages-"));
  t.after(async () => {
    await awaitBackgroundJobs();
    rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });
  const matterRoot = join(base, "L9999 Test Matter");
  const caseDataDir = join(matterRoot, "0. CASE DATA");
  mkdirSync(join(matterRoot, "0. DRAFT"), { recursive: true });
  mkdirSync(caseDataDir, { recursive: true });
  writeFileSync(join(matterRoot, "coclerk.json"), JSON.stringify({ schema_version: 5, matter_root: matterRoot, case_data_dir: "0. CASE DATA", evidence_sql_path: "x.sql" }), "utf-8");
  return { matterRoot, caseDataDir, draft: join(matterRoot, "0. DRAFT"), dbPath: join(caseDataDir, "submission.sqlite") };
}

async function seedOneFiling(dbPath) {
  await freshSubmissionDb(dbPath);
  await submissionDataExecute(
    dbPath,
    `INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L9999 - Test', 'CAN/BC/Vancouver-International-Arbitration-Centre');
     INSERT INTO filings (id, proceeding_id, kind, round, title) VALUES (1, 1, 'submissions_package', 'opening', 'Opening Submissions Package');`
  );
}

async function practiceContext(t) {
  const practicePath = join(tmpdir(), `coclerk-matter-pages-practice-${randomUUID()}.db`);
  t.after(() => rmSync(practicePath, { recursive: true, force: true }));
  const context = await createDispatchContext({ ...process.env, ...(await startFakeCloud(t)).env, COCLERK_DB_PATH: practicePath });
  await writes.upsert_client_matter(context.practiceDb, { client_num: "C-9999", name: "Lookup Client Ltd.", matt_num: "L9999", file_number: "F-9999" });
  return context;
}

// R4: a ticket write moves no revision, so only board_changed can tell the session the board it
// already read is out of date. It compares against the state sidecar, which a deleted page leaves standing.
test("session entry and render report board_changed against the state sidecar, with the Work Board page never read", async (t) => {
  const m = matterFixture(t);
  await seedOneFiling(m.dbPath);
  const context = await practiceContext(t);
  const render = (opened) =>
    callTool(context, "drafting_forms__render", { db_path: m.dbPath, filing_id: 1, draft_dir: opened.draft_dir, session_token: opened.session_token, documents: ["Work_board"] });
  const boardOf = (rendered) => rendered.documents.find((d) => d.document_type === "Work_board");

  const first = await callTool(context, "drafting_forms__open_session", { matter_root: m.matterRoot });
  assert.equal(first.milestone_path.toLowerCase(), join(m.draft, OPENING_PAGE).toLowerCase());
  assert.deepEqual(
    first.milestone_paths.map((p) => ({ ...p, path: p.path.toLowerCase() })),
    [{ filing_id: 1, proceeding_id: 1, path: join(m.draft, OPENING_PAGE).toLowerCase() }],
    "session entry returns every page it wrote"
  );
  assert.equal(first.opened.board_changed, true, "no section recorded yet");
  assert.equal(first.opened.board_moves, undefined, "nothing recorded, so no moves to report");
  const firstBoard = boardOf(await render(first));
  assert.equal(firstBoard.board_changed, false, "the opening recorded the section");
  assert.deepEqual(firstBoard.board_moves, []);
  const state = JSON.parse(readFileSync(join(m.draft, "Drafting records", "matter-pages-state.json"), "utf-8"));
  assert.deepEqual(Object.keys(state.sections), ["filing:1"]);
  assert.ok(Array.isArray(state.todos.rows), "the to-dos open_session read are recorded");

  unlinkSync(first.milestone_path);
  const second = await callTool(context, "drafting_forms__open_session", { matter_root: m.matterRoot });
  assert.equal(second.opened.board_changed, false, "same section apart from meta.rendered, though the page was gone");
  assert.deepEqual(second.opened.board_moves, []);
  assert.ok(existsSync(second.milestone_path), "the opening wrote the page again");

  await submissionDataExecute(
    m.dbPath,
    `INSERT INTO tickets (id, proceeding_id, filing_id, title, intent, status, priority, kind, billing_anchor, created)
       VALUES (1, 1, 1, 'Settle the opening', 'Draft the opening submission.', 'queued', 0, 'work', 'L9999|opening', '2026-09-23 10:00');`
  );
  const third = await callTool(context, "drafting_forms__open_session", { matter_root: m.matterRoot });
  assert.equal(third.opened.revision, second.opened.revision, "the ticket moved no revision");
  assert.equal(third.opened.board_changed, true, "a new job changed the board");
  assert.deepEqual(third.opened.board_moves, [{ id: 1, title: "Settle the opening", from: null, to: "ready" }]);
});

// #1035: board_moves names only the jobs whose column the server compared against the recorded
// section, so a change that moves no job (here a holder change) reports board_changed with no moves.
test("render reports board_moves: a job taken, a holder change that moves no job, a job removed", async (t) => {
  const m = matterFixture(t);
  await seedOneFiling(m.dbPath);
  await submissionDataExecute(
    m.dbPath,
    `INSERT INTO tickets (id, proceeding_id, filing_id, title, intent, status, priority, kind, billing_anchor, created)
       VALUES (1, 1, 1, 'Settle the opening', 'Draft the opening submission.', 'queued', 0, 'work', 'L9999|opening', '2026-09-23 10:00');`
  );
  const context = await practiceContext(t);
  const opened = await callTool(context, "drafting_forms__open_session", { matter_root: m.matterRoot });
  const board = async (sql) => {
    if (sql) await submissionDataExecute(m.dbPath, sql);
    const rendered = await callTool(context, "drafting_forms__render", { db_path: m.dbPath, filing_id: 1, draft_dir: opened.draft_dir, session_token: opened.session_token, documents: ["Work_board"] });
    return rendered.documents.find((d) => d.document_type === "Work_board");
  };

  await board();
  const taken = await board(`UPDATE tickets SET status = 'wip', locked_by = 'other-session', locked_at = strftime('%Y-%m-%dT%H:%M', 'now', 'localtime') WHERE id = 1;`);
  assert.deepEqual(taken.board_moves, [{ id: 1, title: "Settle the opening", from: "ready", to: "wip" }]);
  const handedOver = await board(`UPDATE tickets SET locked_by = 'third-session' WHERE id = 1;`);
  assert.equal(handedOver.board_changed, true);
  assert.deepEqual(handedOver.board_moves, []);
  const removed = await board(`DELETE FROM tickets WHERE id = 1;`);
  assert.deepEqual(removed.board_moves, [{ id: 1, title: "Settle the opening", from: "wip", to: null }]);
});

// D3: a session's board_moves compare against that session's own last render of the section, so a
// move another session made and rendered in between still reaches it.
test("a release another session renders between two of this session's renders still reaches this session's board_moves", async (t) => {
  const m = matterFixture(t);
  await seedOneFiling(m.dbPath);
  await submissionDataExecute(
    m.dbPath,
    `INSERT INTO tickets (id, proceeding_id, filing_id, title, intent, status, priority, kind, billing_anchor, created)
       VALUES (1, 1, 1, 'Settle the opening', 'Draft the opening submission.', 'queued', 0, 'work', 'L9999|opening', '2026-09-23 10:00');`
  );
  const context = await practiceContext(t);
  const x = await callTool(context, "drafting_forms__open_session", { matter_root: m.matterRoot });
  const y = await callTool(context, "drafting_forms__open_session", { matter_root: m.matterRoot });
  assert.notEqual(x.session_token, y.session_token);
  const board = async (opened) => {
    const rendered = await callTool(context, "drafting_forms__render", { db_path: m.dbPath, filing_id: 1, draft_dir: opened.draft_dir, session_token: opened.session_token, documents: ["Work_board"] });
    return rendered.documents.find((d) => d.document_type === "Work_board");
  };

  const assigned = await callTool(context, "drafting_data__assign_job", { db_path: m.dbPath, ticket_id: 1, session_token: x.session_token });
  assert.equal(assigned.outcome, "assigned");
  const yHeld = await board(y);
  assert.deepEqual(yHeld.board_moves, [{ id: 1, title: "Settle the opening", from: "ready", to: "wip" }]);

  assert.equal((await callTool(context, "drafting_data__release_job", { db_path: m.dbPath, ticket_id: 1, session_token: x.session_token, claim_no: assigned.claim_no })).outcome, "released");
  await board(x);
  const yAgain = await board(y);
  assert.equal(yAgain.board_changed, true);
  assert.deepEqual(yAgain.board_moves, [{ id: 1, title: "Settle the opening", from: "wip", to: "ready" }]);

  const state = JSON.parse(readFileSync(join(m.draft, "Drafting records", "matter-pages-state.json"), "utf-8"));
  assert.deepEqual(Object.keys(state.sections), ["filing:1"]);
  assert.deepEqual(Object.keys(state.sessions).sort(), [x.session_token, y.session_token].sort());
});

const SHIPPED_BC = new URL("../../../../source/skills/draft/references/CAN/BC/", import.meta.url);

/** The layout block of a shipped /draft file under CAN/BC. */
function shippedBlock(rel) {
  const text = readFileSync(new URL(rel, SHIPPED_BC), "utf-8").replace(/\r\n/g, "\n");
  return JSON.parse(/^```json\n([\s\S]*?)\n```$/m.exec(text)[1]);
}

/** A BCSC proceeding whose filing 1 is a Notice of Application with the shipped stored layout, so its
 * section has a Goal card, and whose filing 2 is a default judgment requisition, which has none. */
async function seedNoticeAndRequisition(dbPath) {
  await freshSubmissionDb(dbPath);
  await seedBcscDefaultJudgment(dbPath);
  await submissionDataExecute(
    dbPath,
    `UPDATE filings SET kind = 'notice_of_application', subkind = NULL, title = 'Notice of Application' WHERE id = 1;
     INSERT INTO filings (id, proceeding_id, kind, subkind, round, title) VALUES (2, 1, 'requisition_default_judgment', 'default_judgment', NULL, 'Default Judgment Requisition');
     INSERT INTO filing_orders (filing_id, order_sought_id, document, ordinal) VALUES (2, 1, 'form', 1), (2, 2, 'form', 2);
     INSERT INTO filing_documents (filing_id, document_id, ordinal, role) VALUES (2, 1, 1, 'order');`
  );
  const stored = { layout: shippedBlock("BCSC/Documents/notice-of-application.md"), venue: shippedBlock("BCSC/venue.md"), passage_hashes: {} };
  await submissionDataWrite(dbPath, "UPDATE filings SET layout_snapshot = ? WHERE id = 1", [JSON.stringify(stored)]);
}

/** Runs the Work Board page's drawing script against stand-in elements and returns its header and main.
 * The script's clock stands at the page's own Rendered minute, so a held job's lapse and a step's wait
 * read as they did when the page was drawn, and its reload timer and `location` are stubs. */
function drawPage(file) {
  class Node {
    constructor(tag) {
      Object.assign(this, { tag, children: [], attrs: {}, className: "", text: "", style: { setProperty() {} } });
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
  const board = readBoardData(file);
  const [, y, mo, d, h, mi] = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(board.meta.rendered);
  const renderedAt = new Date(+y, +mo - 1, +d, +h, +mi).getTime();
  class PageDate extends Date {
    constructor(...args) {
      super(...(args.length ? args : [renderedAt]));
    }
    static now() {
      return renderedAt;
    }
  }
  runInNewContext(script, { window: { WORKBOARD: board }, document, Date: PageDate, setTimeout() {}, location: { reload() {} } });
  return { header, main };
}

// ADR 0013, both 2026-10-04 amendments. A hearing anchor linked to filing 1 makes its deadlines that
// filing's Goal criteria: board_summary and board_card carry each one's name, state and order within
// the anchor, and no date, rule or review flag. Every date is drawn on the Work Board page alone, by
// every path that writes it: an unmet deadline in the Goal card's head, every deadline criterion on
// its row, and the anchors and the deadlines no card carries in the header's date rows. No response,
// Litigation Strategy or state file carries a date.
test("linked deadlines are dateless Goal criteria to a session; every date is on the Work Board page alone", async (t) => {
  const m = matterFixture(t);
  await seedNoticeAndRequisition(m.dbPath);
  const context = await practiceContext(t);
  const HEARING = "2031-03-17";
  const SERVICE = "2031-02-24";
  const RESPONSE = "2031-03-05";
  const RECORD = "2031-03-10";
  const REPLY = "2031-03-12";
  const TRIAL = "2031-06-02";
  const BRIEF = "2031-05-05";
  const DATES = [HEARING, SERVICE, RESPONSE, RECORD, REPLY, TRIAL, BRIEF];
  const anchorOf = async (anchor_type, anchor_date, filing_ref) =>
    (await writes.upsert_anchor(context.practiceDb, { matt_num: "L9999", anchor_type, anchor_date, source_document: "Fixture notice", stated_date: anchor_date, filing_ref })).anchor;
  const hearing = await anchorOf("application_hearing_date", HEARING, "filing:1");
  const trial = await anchorOf("trial_date", TRIAL, undefined);
  for (const [anchor, deadline_type, deadline_date, status, review_flag] of [
    [hearing, "notice_of_application_service", SERVICE, "met"],
    [hearing, "application_response", RESPONSE, "active", "limited_day"],
    [hearing, "application_record", RECORD, "active"],
    [hearing, "application_reply", REPLY, "not_applicable"],
    [trial, "trial_brief", BRIEF, "active"],
  ]) {
    await writes.upsert_deadline(context.practiceDb, {
      matt_num: "L9999",
      anchor_id: anchor.id,
      deadline_type,
      deadline_date,
      rule_ref: "Fixture rule",
      rule_description: "Fixture deadline",
      source_type: "bc_rules",
      status,
      review_flag,
    });
  }
  const milestone = join(m.draft, "Notice of Application", "Work Board.html");
  const onPage = (when) => {
    const page = readFileSync(milestone, "utf-8");
    for (const date of DATES) assert.ok(page.includes(date), `${when}: ${date} is on the Work Board`);
    assert.equal(JSON.stringify(readBoardData(milestone).sections).match(/\d{4}-\d{2}-\d{2}/g)?.some((d) => DATES.includes(d)) ?? false, false, `${when}: no section carries a date`);
  };
  const absent = (text, what) => {
    for (const leak of [...DATES, "Fixture rule", "limited_day"]) assert.equal(text.includes(leak), false, `${what} carries ${leak}`);
  };
  const CRITERIA = [
    "- ✅ deadline:notice_of_application_service: Notice of application service",
    "- ❌ deadline:application_response: Application response (after Notice of application service)",
    "- ❌ deadline:application_record: Application record (after Application response)",
  ];
  const deadlineLines = (text) => text.split("\n").filter((line) => line.includes(" deadline:"));
  // The summary lists the unmet deadlines as criterion lines and the met one by id alone.
  const summaryDeadlines = (summary) => {
    const lines = summary.split("\n");
    assert.ok(lines.find((line) => line.startsWith("Met completion criteria: ")).split(", ").some((id) => id.endsWith("deadline:notice_of_application_service")), summary);
    assert.deepEqual(deadlineLines(summary).filter((line) => line.startsWith("- ")), CRITERIA.slice(1), summary);
  };

  const opened = await callTool(context, "drafting_forms__open_session", { matter_root: m.matterRoot, filing_id: 1 });
  onPage("session entry");
  absent(JSON.stringify(opened), "the open_session response");
  summaryDeadlines(opened.opened.board_summary);

  // Taken off the page before the background job's first turn, so only the job's rewrite can put them back.
  writeFileSync(milestone, DATES.reduce((page, date) => page.replaceAll(date, "withheld"), readFileSync(milestone, "utf-8")), "utf-8");
  const jobs = await awaitBackgroundJobs();
  assert.ok(jobs.some((job) => job.rendered.includes(2)), `the job rendered filing 2: ${JSON.stringify(jobs)}`);
  onPage("after the background job");

  const rendered = await callTool(context, "drafting_forms__render", { db_path: m.dbPath, filing_id: 1, draft_dir: opened.draft_dir, session_token: opened.session_token, documents: ["Work_board"] });
  onPage("after the render");
  absent(JSON.stringify(rendered), "the render response");
  const board = rendered.documents.find((d) => d.document_type === "Work_board");
  summaryDeadlines(board.board_summary);
  assert.equal(board.board_changed, false, "the render built the section the opening recorded, deadline criteria included");

  const card = await callTool(context, "drafting_forms__board_card", { db_path: m.dbPath, filing_id: 1, lanes: ["criteria"], matter_no: "L9999" });
  absent(JSON.stringify(card), "the board_card response");
  assert.deepEqual(deadlineLines(card.card), CRITERIA, "board_card's criteria lane prints the same criteria");
  const alias = await callTool(context, "drafting_forms__board_card", { db_path: m.dbPath, filing_id: 1, lanes: ["goal"], matter_no: "L9999" });
  assert.equal(alias.card, card.card, "goal is the criteria lane's former name");

  absent(readFileSync(join(m.draft, "Litigation Strategy.html"), "utf-8"), "the Litigation Strategy");
  absent(readFileSync(join(m.draft, "Drafting records", "matter-pages-state.json"), "utf-8"), "matter-pages-state.json");

  const { header, main } = drawPage(milestone);
  assert.equal(readFileSync(milestone, "utf-8").includes("limited_day"), false, "no review flag is printed as stored");
  assert.deepEqual(header.children.map((n) => n.className), ["", "writing-title", "meta", "meta proceeding"], "no date is drawn above the Goal cards");
  const nodes = main.all();
  const dates = nodes.find((n) => n.id === "dates");
  assert.equal(dates.tag, "details", "the Key dates card folds");
  assert.equal(dates.attrs.open, undefined, "the Key dates card is closed until clicked");
  assert.ok(nodes.indexOf(dates) > nodes.findIndex((n) => n.className === "goal"), "the Key dates card follows the Completion Criteria card");
  assert.equal(dates.children[0].children.map((n) => n.textContent).join(""), "Key dates 4", "its head names the card and counts its dates");
  const rowOf = (className) => [...header.children, ...dates.all()].find((n) => n.className === className);
  const labelled = (row) => row.children.map((n) => `${n.attrs["data-k"]}: ${n.textContent}`);
  assert.deepEqual(
    header.children.slice(0, 2).map((n) => [n.tag, n.className, n.textContent]),
    [["h1", "", "Work Board 1"], ["p", "writing-title", "Notice of Application"]],
    "the heading names the page's number, and the Writing's title is drawn directly after it"
  );
  const metaRow = rowOf("meta");
  assert.deepEqual(labelled(metaRow), ["Matter: L9999", "Client: Lookup Client Ltd. (C-9999)"], "the meta row names the matter and the client with its number");
  assert.equal(metaRow.children.some((n) => n.attrs["data-k"] === "Rev" || n.attrs["data-k"] === "Rendered"), false, "no Rev or Rendered is drawn");
  assert.deepEqual(
    rowOf("meta proceeding").children.map((n) => (n.attrs["data-k"] === undefined ? n.textContent : `${n.attrs["data-k"]}: ${n.textContent}`)),
    ["BCSC", " · ", "Vancouver Registry", " · ", "Court File No.: S-901433", " · ", "Halloway v. Vasey"],
    "the proceeding row draws the venue and registry unlabelled, the court file number, then the style of proceeding, a dot between each two; a page with a Goal card draws no state chip there"
  );
  const lines = (row) => row.children.map((n) => `${n.tag}: ${n.textContent}`);
  assert.deepEqual(
    lines(rowOf("meta writing")),
    [`div: Application hearing date ${HEARING}`, `div: Application reply (other side) ${REPLY}`],
    "this Writing's row carries its linked anchor and each of its deadlines no Goal card carries, one line each"
  );
  assert.deepEqual(lines(rowOf("meta dates")), [`div: Trial date ${TRIAL}`, `div: Trial brief ${BRIEF}`], "the matter's row carries the anchor linked to no filing on this page");
  assert.equal(dates.all().some((n) => n.attrs["data-k"] !== undefined), false, "every label is text a copy keeps, not CSS-generated");
  assert.equal(/user-select\s*:\s*none|\.dates[^{]*::before/.test(readFileSync(milestone, "utf-8")), false, "nothing stops a copy of the Key dates card");
  const goal = main.all().find((n) => n.tag === "details" && n.className === "goal");
  const head = goal.children[0];
  assert.deepEqual(
    head.children.slice(0, 3).map((n) => [n.className, n.className === "sentence" ? "" : n.textContent]),
    [["sentence", ""], ["", " "], ["lifecycle", "Drafting"]],
    "the Writing's state is a pill right after the Completion Criteria sentence"
  );
  assert.deepEqual(
    head.children.filter((n) => n.className === "deadline").map((n) => n.children.map((c) => c.textContent).join(" ")),
    [`Application response ${RESPONSE} Limited day`, `Application record ${RECORD}`],
    "each unmet deadline is in the Goal card's head with its date"
  );
  assert.equal(head.textContent.includes(SERVICE), false, "the met deadline is not in the head");
  const rows = Object.fromEntries(goal.all().filter((n) => n.attrs["data-criterion"]?.startsWith("deadline:")).map((n) => [n.attrs["data-criterion"], n.textContent]));
  assert.deepEqual(rows, {
    "deadline:notice_of_application_service": `Notice of application service${SERVICE}Met`,
    "deadline:application_response": `Application response${RESPONSE}Limited dayUnmet`,
    "deadline:application_record": `Application record${RECORD}Unmet`,
  });
});

test("a pre-filing Work Board's header names its proceeding, draws its state as a chip on a blank proceeding line, and omits an empty Writing-dates row", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "coclerk-milestone-header-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const section = {
    meta: { revision: 1, matter: "", client: "", file: "", filing: "", filing_id: null, proceeding_id: 1, rendered: "2026-10-05 09:00", state: null, state_label: "No filing yet", state_since: null, ready_to_retire: false },
    goals: { description: "Proceeding 1", statement: null, status: null },
    tickets: [], seeds: [], deleted: [], proposals: [], lapsed_keys: [],
  };
  const draw = (name, dates) => {
    const file = join(dir, name);
    writeFileSync(
      file,
      renderWorkBoardHtml({ meta: { revision: 1, matter: "L1", client: "C", rendered: "2026-10-05 09:00", client_no: "", forum: "", registry: "", file_number: "", style_of_cause: "" }, sections: [section], dates }),
      "utf-8"
    );
    const { header, main } = drawPage(file);
    return { header, dates: main.all().find((n) => n.id === "dates").children[1] };
  };

  const { header: none, dates: noDates } = draw("none.html", { writing: [], header: [], criteria: {} });
  assert.equal(none.children[0].textContent, "Work Board: Proceeding 1", "a page with no filing is named by its proceeding");
  assert.deepEqual(none.children.map((n) => n.className), ["", "meta", "meta proceeding"], "a proceeding row for the state chip, and no date row");
  assert.deepEqual(none.children[1].children.map((n) => `${n.attrs["data-k"]}: ${n.textContent}`), ["Matter: L1", "Client: C"], "no brackets without a client number");
  assert.deepEqual(none.children[2].children.map((n) => [n.className, n.textContent]), [["chip", "No filing yet"]], "a blank proceeding line holds the state chip alone, with no dot");
  assert.deepEqual(noDates.children.map((n) => [n.className, n.textContent]), [["meta dates", "No date is recorded for this matter."]], "the Key dates card says the matter has none");

  const { dates: writingOnly } = draw("writing.html", { writing: [{ label: "Trial date", date: "2027-03-01", flag: null }], header: [], criteria: {} });
  assert.deepEqual(writingOnly.children.map((n) => n.className), ["meta writing"], "every date is this Writing's, so no matter row");
});

test("a filing's Work Board page draws its Writings in the render's order between the Goal card and Ready; a page given none draws no strip", async (t) => {
  const f = seededDbFixture();
  t.after(() => f.cleanup());
  await seedNoticeAndRequisition(f.dbPath);
  const { draft } = draftFolder(f);
  renderInto(f, 1, draft, FIRST);

  const { readManifest } = await import("../build/submission/render-manifest.js");
  const stem = (name) => name.replace(/\.[^.]+$/, "");
  const expected = readManifest(f.dbPath, 1).files.map((file) => file.label ?? { short: stem(file.file_name), long: stem(file.file_name) });
  assert.ok(expected.length > 0, "the render's manifest lists its Writings");
  const noticePage = join(draft, "Notice of Application", "Work Board.html");
  const { main } = drawPage(noticePage);
  const nodes = main.all();
  const strip = nodes.find((n) => n.tag === "ol" && n.className === "writings");
  assert.ok(strip, "the page draws the Writings strip");
  assert.equal(strip.attrs["aria-label"], "Writings");
  const tiles = strip.children.filter((li) => li.className === "writing");
  assert.deepEqual(tiles.map((li) => li.querySelector(".label").textContent), expected.map((w) => w.short), "one thumbnail per Writing, in the manifest's order, showing its short label");
  assert.deepEqual(tiles.map((li) => li.querySelector(".sr").textContent), expected.map((w) => w.long), "each thumbnail reads out the fuller description");
  assert.deepEqual(tiles.map((li) => li.attrs["data-long"]), expected.map((w) => w.long), "each thumbnail's tooltip text is the fuller description");
  assert.equal(tiles[0].querySelector(".label").textContent, "NOA", "the Notice of Application's tile shows the firm's code");
  assert.ok(strip.children.every((li) => li.tag === "li"));
  assert.deepEqual(
    strip.children.slice(tiles.length).map((li) => [li.className, li.querySelector(".label").textContent]),
    VIEW_PAGES.map((page) => ["writing view unviewed", page.name]),
    "after the Writings, one view tile per view page, in registry order, dashed while never viewed"
  );
  const goal = nodes.findIndex((n) => n.className === "goal");
  const ready = nodes.findIndex((n) => n.tag === "section" && n.id === "ready");
  assert.ok(goal >= 0 && goal < nodes.indexOf(strip) && nodes.indexOf(strip) < ready, "the strip sits after the Goal card and before Ready");

  const file = join(draft, "no-writings.html");
  writeFileSync(file, renderWorkBoardHtml({ ...readBoardData(noticePage), strip: undefined }), "utf-8");
  assert.equal(drawPage(file).main.all().some((n) => n.className === "writings"), false, "no strip key draws no strip");
});

test("a malformed state sidecar reads as no section recorded", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedVaniacProceeding(f.dbPath);
    const { draft } = draftFolder(f);
    renderInto(f, 1, draft, FIRST);
    writeFileSync(join(draft, "Drafting records", "matter-pages-state.json"), "{ not json", "utf-8");

    const board = renderInto(f, 1, draft, SECOND, ["Work_board"]).documents.find((d) => d.document_type === "Work_board");
    assert.equal(board.board_changed, true);
    assert.equal(board.board_moves, undefined);
  } finally {
    f.cleanup();
  }
});

// R3: the fast-open render (/draft §7) returns the board as a short fixed-grammar summary and a path,
// never its data or markup. The seeded board is the one fixture with every lane, Proposals and a
// lapsed key, none of which the summary carries; its type declares no criteria, so a State line
// stands in for the two criteria lists.
test("the fast-open render returns the short board_summary, and no lane, board data, page path list or markup", async (t) => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedVaniacProceeding(f.dbPath);
    await seedTickets(f.dbPath);
    await seedProposalCases(f.dbPath);
    const { draft } = draftFolder(f);

    const result = renderInto(f, 1, draft, FIRST, ["Work_board"]);
    const board = result.documents.find((d) => d.document_type === "Work_board");
    assert.deepEqual(Object.keys(board), ["document_type", "path", "file_name", "board_summary", "board_changed", "pages_written"]);
    assert.equal(board.path, join(draft, OPENING_PAGE));
    assertMatchesGolden("board-summary.md", board.board_summary + "\n");
    assert.deepEqual(board.board_summary.split("\n"), [
      "# Work Board — Matter L4801 · Client Ashbourne (2417) · Rev 1",
      "To Do: This matter's to-dos were not read.",
      "Goal: Goal not set (none)",
      "State: Drafting — No completion criteria are declared for this type of Writing.",
    ]);
    assert.equal(/^## /m.test(board.board_summary), false, "no lane");
    assert.equal(board.board_summary.includes("dispatch"), false, "no dispatch tag or choice");

    const json = JSON.stringify(result);
    for (const absent of ["board_data", "board_copy_path", "window.WORKBOARD", "<html"]) {
      assert.equal(json.includes(absent), false, `expected no ${absent} in the response`);
    }
    const bytes = Buffer.byteLength(json);
    t.diagnostic(`fast-open render ${bytes} B; board_summary ${board.board_summary.length} chars`);
    assert.ok(bytes < 15000, `the fast-open render is ${bytes} B`);
    assert.ok(board.board_summary.length < 600, `board_summary is ${board.board_summary.length} chars`);
  } finally {
    f.cleanup();
  }
});

test("board_summary's header prints no bare Matter or Client part when the matter number and client name are empty", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedVaniacProceeding(f.dbPath);
    const { draft } = draftFolder(f);

    const result = submissionFormsRender(f.dbPath, 1, { clientName: "", clientNo: "", matterNo: "" }, "mockup", ["Work_board"], undefined, undefined, FIRST, "tok", draft);
    const board = result.documents.find((d) => d.document_type === "Work_board");
    assert.equal(board.board_summary.split("\n")[0], "# Work Board — Rev 1");
  } finally {
    f.cleanup();
  }
});

/** The seeded board (every lane, Proposals and a lapsed key), rendered once so the filing's manifest
 * holds the inventory board_card reads. `extraSql` runs before the render. */
async function seededBoard(f, extraSql) {
  await freshSubmissionDb(f.dbPath);
  await seedVaniacProceeding(f.dbPath);
  await seedTickets(f.dbPath);
  await seedProposalCases(f.dbPath);
  await submissionDataExecute(f.dbPath, HELD_AT_FIRST);
  if (extraSql) await submissionDataExecute(f.dbPath, extraSql);
  return renderInto(f, 1, undefined, FIRST, ["Work_board"]);
}

/** Moves the seed's In progress job #4's last activity to 10 minutes before FIRST, so its lock has
 * not lapsed at FIRST (ADR 0015). */
const HELD_AT_FIRST = `UPDATE kv_store SET value = '"2026-10-02T08:50"' WHERE namespace = 'last_activity' AND key = 'tickets:4';`;

function cardOf(f, selection) {
  return submissionFormsBoardCard({ db_path: f.dbPath, filing_id: 1, ...selection }, ASHBOURNE, FIRST).card;
}

const HELD = "The Respondent owes $150,000 under the plain words of the Asset Purchase Agreement.";

// A Proposal held by a job on the section's own filing gets no line of its own, so the job's keys:
// line says, per key, what derives now: the Proposal's glyph and current item, or dead.
test("board_card's keys: line gives each held key's glyph and current item, or dead", async () => {
  const f = seededDbFixture();
  try {
    await seededBoard(f, "INSERT INTO ticket_proposals (ticket_id, proposal_key, item) VALUES (2, 'authority-excerpt:statements_of_law:999', 'An authority no longer cited');");

    const keys = cardOf(f, { jobs: [2] }).split("\n").find((line) => line.startsWith("  keys: "));
    assert.deepEqual(keys.slice("  keys: ".length).split("; ").sort(), [
      `authority-excerpt:statements_of_law:999 = "An authority no longer cited" (now: dead)`,
      `factual-basis:submissions:1 = "${HELD}" (now: 🧾 "${HELD}")`,
    ]);
  } finally {
    f.cleanup();
  }
});

// A job's card is its live-lane line without the tags, a kind line, then the detail lines the summary
// printed before it became the headline, byte for byte (the lines below are that summary's).
test("board_card(jobs) prints each job in board order: its collapsed line, a kind line, then the old summary's detail lines", async () => {
  const f = seededDbFixture();
  try {
    await seededBoard(f);

    assert.equal(
      cardOf(f, { jobs: [4, 2] }),
      [
        "- Job #2 Draft the reply on attornment · Ready",
        "  kind: work · priority: 4",
        "  intent: Write the reply submission once the memos are audited.",
        `  keys: factual-basis:submissions:1 = "${HELD}" (now: 🧾 "${HELD}")`,
        "  scope: facts, statements_of_law:12 · waits on: #1 (completed) · either-or: —",
        "- Job #4 Rebuild the evidence index · In Progress 1/2",
        "  kind: work · priority: 2 · taken: 2026-09-02T10:05 · holder: sess-a1 · last activity: 2026-10-02T08:50",
        "  intent: Reconcile the exhibit list against the disclosure log.",
        "  scope: — · waits on: — · either-or: —",
        "  steps: 1 ☑ Audit the exhibit list (2026-09-02T10:10) · 2 ☐ Reconcile against the disclosure log",
        '  loose threads: loose thread 1: "Consider a standing exhibit-numbering convention for future filings in this proceeding." (2026-09-02T10:12)',
      ].join("\n")
    );
    assert.equal(
      cardOf(f, { jobs: [5, 1] }),
      [
        "- Job #1 Audit the three Westlaw memos · Completed",
        "  kind: work · priority: 5",
        "  intent: Verify the propositions with pinpoints.",
        "  scope: — · waits on: — · either-or: #5 (superseded)",
        "  completed: 2026-09-02T09:00",
        "- Job #5 Old approach to the stay argument · Superseded",
        "  superseded by: #1 · reason: —",
      ].join("\n"),
      "a completed job carries its detail and when it was completed; a superseded one its pointer and reason"
    );
    const shelved = cardOf(f, { jobs: [13] }).split("\n");
    assert.deepEqual(shelved.slice(0, 3), ["- Job #13 Serve the August notice to admit · Shelved", "  kind: work · priority: 0", "  intent: Serve it and diarise the response period."]);
    assert.equal(shelved.at(-1), "  shelved: 2026-09-03T09:00", "a shelved job carries its detail and when it was shelved");
  } finally {
    f.cleanup();
  }
});

// A completed job's card shows the plan it ran and each step with the minute it was done.
test("board_card(jobs) prints a completed job's plan and stamped steps, then when it was completed", async () => {
  const f = seededDbFixture();
  try {
    await seededBoard(
      f,
      `INSERT INTO tickets (id, proceeding_id, filing_id, title, intent, status, priority, kind, billing_anchor, plan_approved_at, created, completed_at)
         VALUES (15, 1, 1, 'Index the exhibits', 'Number every exhibit once.', 'completed', 1, 'work', 'L4801|exhibits', '2026-09-02T12:00', '2026-09-02T11:55', '2026-09-02T12:40');
       INSERT INTO ticket_steps (ticket_id, ordinal, text, done_at) VALUES (15, 1, 'Number them', '2026-09-02T12:20'), (15, 2, 'Check the index', '2026-09-02T12:40');`
    );

    assert.equal(
      cardOf(f, { jobs: [15] }),
      [
        "- Job #15 Index the exhibits · Completed 2/2",
        "  kind: work · priority: 1",
        "  intent: Number every exhibit once.",
        "  scope: — · waits on: — · either-or: —",
        "  steps: 1 ☑ Number them (2026-09-02T12:20) · 2 ☑ Check the index (2026-09-02T12:40)",
        "  completed: 2026-09-02T12:40",
      ].join("\n")
    );
  } finally {
    f.cleanup();
  }
});

// A job's plan is its steps (schema v55): its card on the Work Board page draws the title, the status
// chip and the step checklist, with no intent paragraph and no Plan row.
test("a job's card on the Work Board page draws its steps as its plan, with no intent paragraph and no Plan row", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedVaniacProceeding(f.dbPath);
    await seedTickets(f.dbPath);
    await submissionDataExecute(f.dbPath, HELD_AT_FIRST);
    const { draft } = draftFolder(f);
    const board = renderInto(f, 1, draft, FIRST, ["Work_board"]).documents.find((d) => d.document_type === "Work_board");
    const cards = drawPage(board.path).main.all().filter((n) => n.tag === "details");
    const card = (id) => cards.find((n) => n.id === `ticket-${id}`).all();
    const terms = (nodes) => nodes.filter((n) => n.tag === "dt").map((n) => n.textContent);

    const wip = card(4);
    assert.ok(wip.some((n) => n.className === "title" && n.textContent === "Rebuild the evidence index"));
    assert.ok(wip.some((n) => n.className === "chip wip" && n.textContent === "In Progress"));
    assert.deepEqual(wip.filter((n) => n.tag === "li").map((n) => n.textContent), ["Audit the exhibit list", "Reconcile against the disclosure log"]);
    assert.equal(wip.some((n) => n.className === "intent"), false, "no intent paragraph");
    assert.deepEqual(terms(wip), ["Progress", "Taken", "Priority"], "no Plan row");
    assert.ok(terms(card(3)).includes("Blocked by"));
  } finally {
    f.cleanup();
  }
});

// The three lanes the headline counts, printed in full. Proposed and Shelved are the summary's own
// lines from before the headline; the golden was checked against them line by line.
test("board_card(lanes) prints the counted lanes' members, in card order whatever order they are asked in", async () => {
  const f = seededDbFixture();
  try {
    await seededBoard(f);

    const card = cardOf(f, { lanes: ["rejected", "completed", "proposed"] });
    assertMatchesGolden("board-card-lanes.md", card + "\n");
    assert.equal(cardOf(f, { lanes: ["proposed", "completed", "rejected"] }), card);
    assert.equal(cardOf(f, { lanes: ["completed"] }), "## Completed (1)\n- Job #1 Audit the three Westlaw memos · Completed");
  } finally {
    f.cleanup();
  }
});

test("board_card(key) prints the live job holding the key, else the Proposal under its lane's heading, else a miss", async () => {
  const f = seededDbFixture();
  try {
    await seededBoard(f);

    assert.equal(cardOf(f, { key: "factual-basis:submissions:1" }), cardOf(f, { jobs: [2] }), "the job holding it");
    assert.equal(
      cardOf(f, { key: "not-recorded:documents:2" }),
      [
        "## Proposed (23)",
        "- 🏷️ Record label, date or description: Undescribed exhibit",
        "  key: not-recorded:documents:2 · item: Undescribed exhibit · lane: held by #12 on Reply Submissions Package",
      ].join("\n"),
      "held by a job on another filing: the Proposed line"
    );
    assert.equal(
      cardOf(f, { key: "unserved-petitum:order_sought:2" }),
      [
        "## Shelved (1 job, 1 proposal)",
        "- 🦵 Draft a submission for the order: a reserved fallback order",
        "  key: unserved-petitum:order_sought:2 · item: a reserved fallback order · lane: rejected",
      ].join("\n")
    );
    assert.equal(cardOf(f, { key: "interview:witnesses:404" }), "(no job or Proposal carries interview:witnesses:404)");
  } finally {
    f.cleanup();
  }
});

// The eight lists, in order, then board_card's Proposed count: a wip job with every step stamped
// stays In Progress, a queued job whose blocker was superseded is Blocked, and an unheld Proposal is
// counted on the card but never drawn on the page.
test("the live lane prints Ready, In Progress, Bring Forward, Blocked, Completed, Shelved, Superseded, then Proposed, and the page draws no Proposed or Loose Threads section", async () => {
  const f = seededDbFixture();
  try {
    await seededBoard(
      f,
      `INSERT INTO tickets (id, proceeding_id, filing_id, title, intent, status, priority, kind, billing_anchor, locked_by, locked_at, created)
         VALUES (30, 1, 1, 'Settle the witness list', 'Settle it.', 'wip', 0, 'work', 'L4801|witnesses', 'sess-a30', '2026-10-02T08:15', '2026-10-02T07:55');
       INSERT INTO ticket_steps (ticket_id, ordinal, text, done_at) VALUES (30, 1, 'Settle it', '2026-10-02T08:30');`
    );

    const lines = cardOf(f, { lanes: ["live"] }).split("\n");
    const headings = lines.filter((l) => l.startsWith("## ")).map((l) => l.replace(/ \(.*$/, ""));
    assert.deepEqual(headings, ["## Ready", "## In Progress", "## Bring Forward", "## Blocked", "## Completed", "## Shelved", "## Superseded", "## Proposed"]);
    const lane = (heading) => {
      const start = lines.findIndex((l) => l.startsWith(`## ${heading} (`));
      const end = lines.findIndex((l, i) => i > start && l.startsWith("## "));
      return lines.slice(start + 1, end);
    };
    assert.ok(lane("In Progress").some((l) => l.startsWith("- Job #30 Settle the witness list · In Progress 1/1")), lines.join("\n"));
    assert.ok(lane("Blocked").some((l) => l.startsWith("- Job #6 ")), lines.join("\n"));
    assert.match(cardOf(f, { jobs: [6] }), / · waits on: #5 \(superseded\) · /);
    assert.match(lines.find((l) => l.startsWith("## Proposed (")), /^## Proposed \([1-9]\d*\)$/, "the unheld Proposals are counted");

    const { draft } = draftFolder(f);
    const board = renderInto(f, 1, draft, FIRST, ["Work_board"]).documents.find((d) => d.document_type === "Work_board");
    const sections = drawPage(board.path).main.all().filter((n) => n.tag === "section").map((n) => n.id);
    assert.deepEqual(sections, ["ready", "in-progress", "bring-forward", "waiting-on", "completed", "rejected-angles", "superseded"]);
    assert.equal(readFileSync(board.path, "utf-8").includes('<section id="proposed">'), false);
  } finally {
    f.cleanup();
  }
});

test("board_card refuses no selector, an unknown lane, a job not on the section, and a proceeding that has a filing", async () => {
  const f = seededDbFixture();
  try {
    await seededBoard(f);
    const refused = (args, pattern) => assert.throws(() => submissionFormsBoardCard({ db_path: f.dbPath, ...args }, ASHBOURNE, FIRST), (err) => err instanceof ValidationError && pattern.test(err.message));

    refused({ filing_id: 1 }, /needs at least one of jobs, lanes and key/);
    refused({ filing_id: 1, lanes: ["held"] }, /no lane held/);
    refused({ filing_id: 1, lanes: ["loose_threads"] }, /no lane loose_threads/);
    refused({ filing_id: 1, jobs: [2, 12, 99] }, /no Job #12, Job #99 on this section/);
    refused({ proceeding_id: 1, jobs: [2] }, /This proceeding has a Writing/);
  } finally {
    f.cleanup();
  }
});

test("board_card reads a proceeding with no filing", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await submissionDataExecute(
      f.dbPath,
      `INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L8470 - Larchmont', NULL);
       INSERT INTO tickets (id, proceeding_id, filing_id, title, intent, status, priority, kind, billing_anchor, locked_by, locked_at, created)
         VALUES (1, 1, NULL, 'Review the arbitration clause', 'Read the contract.', 'wip', 0, 'work', 'L8470', 'sess-a', '2026-10-02 08:30', '2026-10-02 08:05');`
    );

    const result = submissionFormsBoardCard({ db_path: f.dbPath, proceeding_id: 1, jobs: [1] }, {}, FIRST);
    assert.deepEqual(Object.keys(result), ["proceeding_id", "revision", "rendered_at", "card"]);
    assert.equal(
      result.card,
      [
        "- Job #1 Review the arbitration clause · In Progress",
        "  kind: work · priority: 0 · taken: 2026-10-02 08:30 · holder: sess-a · last activity: 2026-10-02 08:30",
        "  intent: Read the contract.",
        "  scope: — · waits on: — · either-or: —",
      ].join("\n")
    );
    assert.match(submissionFormsBoardCard({ db_path: f.dbPath, proceeding_id: 1, lanes: ["live"] }, {}, FIRST).card, /^## In Progress \(1\)\n- Job #1 Review the arbitration clause · In Progress · idle /m, "the live lane reads a proceeding with no filing");
    for (const lane of ["criteria", "goal", "proposed"]) {
      assert.throws(
        () => submissionFormsBoardCard({ db_path: f.dbPath, proceeding_id: 1, lanes: [lane] }, {}, FIRST),
        (err) => err instanceof ValidationError && /has no Writing yet, so its board has no completion criteria and no Proposed lane/.test(err.message),
        lane
      );
    }
  } finally {
    f.cleanup();
  }
});

// Read-only: no page, no state sidecar, no mockup and no revision moves.
test("board_card is listed read-only, and a call through the dispatcher writes nothing", async (t) => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedVaniacProceeding(f.dbPath);
    await seedTickets(f.dbPath);
    // The dispatcher reads the card at the host's now, so job #4 is active now and still held.
    await submissionDataExecute(f.dbPath, `UPDATE kv_store SET value = '"' || strftime('%Y-%m-%dT%H:%M', 'now', 'localtime') || '"' WHERE namespace = 'last_activity' AND key = 'tickets:4';`);
    const { draft } = draftFolder(f);
    renderInto(f, 1, draft, FIRST);
    const context = await practiceContext(t);
    const tool = buildToolDefinitions().find((d) => d.name === "drafting_forms__board_card");
    assert.deepEqual(tool.annotations, { readOnlyHint: true, openWorldHint: false });

    const snapshot = () =>
      [draft].flatMap((dir) =>
        namesUnder(dir).map((name) => {
          const file = join(dir, name);
          const stat = statSync(file);
          return [file, stat.isFile() ? `${stat.mtimeMs} ${readFileSync(file, "utf-8")}` : "dir"];
        })
      );
    const before = snapshot();
    const revision = fetchRevision(f.dbPath);
    const result = await callTool(context, "drafting_forms__board_card", { db_path: f.dbPath, filing_id: 1, jobs: [4], lanes: ["completed"], key: "x" });

    assert.ok(result.card.startsWith("- Job #4 Rebuild the evidence index · In Progress 1/2\n"), result.card);
    assert.deepEqual(snapshot(), before, "no file under the draft folder, the mockups and matter-pages-state.json included, changed");
    assert.equal(result.revision, revision);
    assert.equal(fetchRevision(f.dbPath), revision, "the revision did not move");
  } finally {
    f.cleanup();
  }
});

// The idle report's arithmetic, done by the server: elapsed from the job's last activity (its stored
// stamp, job-activity.db.test.mjs) to the section's Rendered minute, no tag at 15 minutes or less or
// with nothing to measure.
test("the live lane's idle tag on an In progress job", () => {
  const NOW = "2026-10-16 12:00";
  const ticket = (over) => ({
    id: 3, title: "Swear the affidavit", intent: "Swear it.", kind: "work", priority: 0, status: "wip", category: "wip",
    locked_by: "sess-a", locked_at: null, completed_at: null, rejected_at: null, superseded_by: null,
    scope: [], blocked_by: [], conflicts: [], circular: false, steps: [], proposal_keys: [], proposal_items: {},
    superseded_reason: null, subtitle: null, eligible: false, ineligible_reasons: [], dispatch_skips: [], lock_note: null,
    answers: [], last_activity_at: null, ...over,
  });
  const steps = (...doneAt) => doneAt.map((done_at, i) => ({ ordinal: i + 1, text: `Step ${i + 1}`, done_at }));
  const lineOf = (over) => {
    const section = {
      meta: { revision: 1, matter: "", client: "", file: "", filing: "", filing_id: null, proceeding_id: 1, rendered: NOW, state: null, state_label: "No filing yet", state_since: null, ready_to_retire: false },
      tickets: [ticket(over)], seeds: [], proposals: [], lapsed_keys: [],
    };
    return renderLiveLanes(section).find((line) => line.startsWith("- Job #3 "));
  };
  const head = "- Job #3 Swear the affidavit · In Progress";

  assert.equal(lineOf({ last_activity_at: "2026-10-05T18:56" }), `${head} · idle 10 days 17 h 4 min, no plan yet`);
  assert.equal(lineOf({ last_activity_at: "2026-10-16T03:24", steps: steps("2026-10-16T03:24", null, null) }), `${head} 1/3 · idle 8 h 36 min, about 33%`);
  assert.equal(lineOf({ last_activity_at: "2026-10-16 11:38" }), `${head} · idle 22 min, no plan yet`, "either separator");
  assert.equal(lineOf({ last_activity_at: "2026-10-15T11:55" }), `${head} · idle 1 day 0 h 5 min, no plan yet`);
  assert.equal(lineOf({ last_activity_at: "2026-10-16T11:44" }), `${head} · idle 16 min, no plan yet`);
  assert.equal(lineOf({ last_activity_at: "2026-10-16T11:45" }), head, "15 minutes is within the threshold");
  assert.equal(lineOf({ last_activity_at: "2026-10-16T12:30" }), head, "activity after the Rendered minute is 0 minutes");
  assert.equal(lineOf({ last_activity_at: null, locked_by: null }), head, "nothing to measure");
  assert.equal(lineOf({ last_activity_at: "2026-10-16T10:00", locked_by: null, steps: steps("2026-10-16T10:00", null) }), `${head} 1/2 · idle 2 h 0 min, about 50%`);
  assert.equal(lineOf({ last_activity_at: "2026-10-05T18:56", subtitle: "1 of 2 items no longer show their marker", lock_note: "In progress with nobody present" }), `- Job #3 Swear the affidavit · 1 of 2 items no longer show their marker · In progress with nobody present · In Progress · idle 10 days 17 h 4 min, no plan yet`);
  assert.equal(lineOf({ last_activity_at: "2026-10-05T19:00", steps: steps("2026-10-05T19:00") }), `${head} 1/1 · idle 10 days 17 h 0 min, about 100%`, "a job with every step stamped stays In Progress and carries the idle tag");
});

// The take-over card (FIX 3): a job's last activity is its stored stamp, and its card lists the seeds
// captured from it and the answers saved for it. Saving an answer with the job's id restarts its idle
// clock; a save naming a job the saving session does not hold is refused and saves no file.
async function heldMilestone(t) {
  const f = seededDbFixture();
  t.after(() => f.cleanup());
  await freshSubmissionDb(f.dbPath);
  await submissionDataExecute(
    f.dbPath,
    `INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L8470 - Larchmont', NULL);
     INSERT INTO tickets (id, proceeding_id, filing_id, title, intent, status, priority, kind, billing_anchor, locked_by, locked_at, plan_approved_at, created)
       VALUES (1, 1, NULL, 'Legal research: When did time start to run?', 'When did time start to run?', 'wip', 0, 'work', 'L8470|limitation', 'sess-holder', '2026-01-16 09:00', '2026-01-16 09:00', '2026-01-16 08:55');
     INSERT INTO ticket_steps (ticket_id, ordinal, text, done_at) VALUES (1, 1, 'Run the research', NULL);
     INSERT INTO seeds (id, proceeding_id, filing_id, origin_ticket_id, created, surfaced_by, idea) VALUES (1, 1, NULL, 1, '2026-01-16T09:20', 'noticed in the Westlaw memo', 'Is the guarantor a party?');
     INSERT INTO kv_store (namespace, key, value, updated_at) VALUES ('last_activity', 'tickets:1', '"2026-01-16T11:30"', '2026-01-16T19:30:00.000Z');
     INSERT INTO seeds (id, proceeding_id, filing_id, origin_ticket_id, created, surfaced_by, idea) VALUES (2, 1, NULL, NULL, '2026-01-16T11:50', 'a practitioner aside', 'Not this job''s.');`
  );
  await moveSeeds(f.dbPath);
  const law = join(dirname(dirname(f.dbPath)), "6. LAW");
  mkdirSync(join(law, "Limitation"), { recursive: true });
  return { f, law };
}

const NOON = "2026-01-16 12:00";
const proceedingCard = (f) => submissionFormsBoardCard({ db_path: f.dbPath, proceeding_id: 1, jobs: [1] }, {}, NOON).card;
const headline = (f) =>
  renderLiveLanes(buildPreFilingBoardData(f.dbPath, fetchProceeding(f.dbPath, 1), { revision: 1, matter: "", client: "", rendered: NOON })).find((line) =>
    line.startsWith("- Job #1 ")
  );

test("a job's last activity is its stored stamp, and its card lists the seeds captured from it", async (t) => {
  const { f } = await heldMilestone(t);

  assert.equal(headline(f), "- Job #1 Legal research: When did time start to run? · In Progress 0/1 · idle 30 min, about 0%", "the stamp at 11:30, not the lock at 09:00");
  assert.equal(
    proceedingCard(f),
    [
      "- Job #1 Legal research: When did time start to run? · In Progress 0/1",
      "  kind: work · priority: 0 · taken: 2026-01-16 09:00 · holder: s-holder · last activity: 2026-01-16T11:30",
      "  intent: When did time start to run?",
      "  scope: — · waits on: — · either-or: —",
      "  steps: 1 ☐ Run the research",
      '  loose threads: loose thread 1: "Is the guarantor a party?" (2026-01-16T09:20)',
    ].join("\n"),
    "only the seed captured from this job"
  );
});

test("save_answer with the job's id lists the answer on its card and restarts its idle clock", async (t) => {
  const { f, law } = await heldMilestone(t);
  const before = fetchRevision(f.dbPath);

  const saved = await callTool({}, "research_filing__save_answer", {
    destination_dir: join(law, "Limitation"),
    filename: "2026-10-16 research-lawyer answer.md",
    text: "Answer text.\n",
    db_path: f.dbPath,
    ticket_id: 1,
    session_token: "sess-holder",
  });

  assert.equal(saved.filename, "2026-10-16 research-lawyer answer.md");
  assert.deepEqual({ ...saved.job, note: undefined }, { ticket_id: 1, recorded: true, note: undefined });
  const [row] = submissionDataQuery(f.dbPath, "SELECT file_path, saved_at FROM ticket_answers WHERE ticket_id = 1").rows;
  assert.equal(row.file_path, "6. LAW\\Limitation\\2026-10-16 research-lawyer answer.md", "stored from its 6. LAW segment on");
  assert.equal(fetchRevision(f.dbPath), before, "the record moves no revision");
  // The record carries the host clock's minute, so read the card at that minute.
  const now = row.saved_at.replace("T", " ");
  const card = submissionFormsBoardCard({ db_path: f.dbPath, proceeding_id: 1, jobs: [1] }, {}, now).card;
  assert.match(card, new RegExp(`· last activity: ${row.saved_at} · session active: ${row.saved_at}\n`));
  assert.ok(card.endsWith(`\n  answers: 6. LAW\\Limitation\\2026-10-16 research-lawyer answer.md (${row.saved_at})`), card);
  const live = renderLiveLanes(buildPreFilingBoardData(f.dbPath, fetchProceeding(f.dbPath, 1), { revision: 1, matter: "", client: "", rendered: now }));
  assert.equal(live.find((line) => line.startsWith("- Job #1 ")), "- Job #1 Legal research: When did time start to run? · In Progress 0/1", "no idle tag right after the save");
});

test("save_answer refuses a job this session no longer holds, and saves no file", async (t) => {
  const { f, law } = await heldMilestone(t);
  const args = { destination_dir: join(law, "Limitation"), filename: "answer.md", text: "Late answer.\n", db_path: f.dbPath, ticket_id: 1 };
  const refused = async (extra, code, pattern) =>
    assert.rejects(callTool({}, "research_filing__save_answer", { ...args, ...extra }), (err) => err.code === code && (pattern === undefined || pattern.test(err.message)));

  await refused({ session_token: "sess-before-takeover" }, "not_held", /not this session's .*\(status=wip, locked by another session, rejected_at=NULL\).*dispatch nothing more/);
  await refused({}, "invalid_job");
  await refused({ session_token: "sess-holder", ticket_id: 99 }, "not_found");
  assert.deepEqual(readdirSync(join(law, "Limitation")), [], "a refusal writes no file");
  assert.equal(submissionDataQuery(f.dbPath, "SELECT COUNT(*) AS n FROM ticket_answers").rows[0].n, 0);
  assert.equal(submissionDataQuery(f.dbPath, "SELECT locked_by FROM tickets WHERE id = 1").rows[0].locked_by, "sess-holder", "the holder's lock is untouched");
});

// The board the headline was measured on (2026-10-04): 43,341 chars printed fully expanded. Its lanes
// are now board_card's live lane, and the summary keeps a cap of its own.
test("the live lane of a board shaped like the measured one is 3 KB or less, and its summary under 600 chars", async (t) => {
  const f = seededDbFixture();
  try {
    await seedOneFiling(f.dbPath);
    const title = (n) => `Reconcile the exhibit list against the disclosure log, item ${n}`;
    const row = (id, status, extra) => ({ id, status, ...extra });
    const tickets = [
      ...Array.from({ length: 7 }, (_, i) =>
        row(10 + i, "wip", { locked_by: `'sess-w${i}'`, locked_at: "'2026-10-02T08:45'", plan_approved_at: "'2026-10-01T09:00'" })
      ),
      ...Array.from({ length: 5 }, (_, i) => row(20 + i, "queued", {})),
      ...Array.from({ length: 21 }, (_, i) => row(30 + i, "completed", { completed_at: "'2026-09-30T09:00'" })),
      ...Array.from({ length: 7 }, (_, i) => row(60 + i, "queued", { rejected_at: "'2026-09-30T10:00'" })),
    ];
    const sql = [
      ...tickets.map(
        (r) =>
          `INSERT INTO tickets (id, proceeding_id, filing_id, title, intent, status, priority, kind, billing_anchor, created, locked_by, locked_at, plan_approved_at, completed_at, rejected_at)
             VALUES (${r.id}, 1, 1, '${title(r.id)}', 'Make the exhibit list match the disclosure log.', '${r.status}', 0, 'work', 'L9999|exhibits', '2026-09-20T09:00',
                     ${r.locked_by ?? "NULL"}, ${r.locked_at ?? "NULL"}, ${r.plan_approved_at ?? "NULL"}, ${r.completed_at ?? "NULL"}, ${r.rejected_at ?? "NULL"});`
      ),
      ...tickets.filter((r) => r.status === "wip").flatMap((r) => [
        `INSERT INTO ticket_steps (ticket_id, ordinal, text, done_at) VALUES (${r.id}, 1, 'Audit the exhibit list', '2026-10-01T10:00'), (${r.id}, 2, 'Reconcile against the disclosure log', NULL);`,
        `INSERT INTO ticket_scope (ticket_id, entity, entity_id) VALUES (${r.id}, 'documents', ${r.id});`,
        `INSERT INTO ticket_proposals (ticket_id, proposal_key, item) VALUES (${r.id}, 'not-recorded:documents:${r.id}', 'Exhibit ${r.id}'), (${r.id}, 'sign-it:documents:${r.id}', 'Statement ${r.id}');`,
      ]),
      ...Array.from({ length: 44 }, (_, i) => `INSERT INTO seeds (id, proceeding_id, filing_id, created, surfaced_by, idea) VALUES (${i + 1}, 1, 1, '2026-09-20T09:00', 'noticed', 'Consider a standing exhibit-numbering convention, idea ${i + 1}');`),
    ].join("\n");
    await submissionDataExecute(f.dbPath, sql);

    const summary = renderInto(f, 1, undefined, FIRST, ["Work_board"]).documents.find((d) => d.document_type === "Work_board").board_summary;
    const live = cardOf(f, { lanes: ["live"] });
    t.diagnostic(`board_summary ${summary.length} chars; live lane ${live.length} chars`);
    assert.match(live, /^## In Progress \(7\)$/m);
    assert.match(live, /^## Completed \(21\)$/m);
    assert.match(live, /^## Shelved \(7 jobs, 0 proposals\)$/m);
    assert.doesNotMatch(live, /Loose Threads/, "no Work Board counts the matter's loose threads");
    assert.ok(live.length <= 3072, `the live lane is ${live.length} chars\n${live}`);
    assert.ok(summary.length < 600, `board_summary is ${summary.length} chars\n${summary}`);
  } finally {
    f.cleanup();
  }
});

// D3: the old page files -- per-filing boards, numbered copies, the pages' older names, the single
// Work Board.html among them -- go to the matter's TRASH on the first page write, through
// file_ops__trash's mover. A file without a generator marker is the practitioner's and stays.
test("a page write moves every old page file the generator wrote into TRASH and leaves the rest", async (t) => {
  const m = matterFixture(t);
  await seedOneFiling(m.dbPath);
  const board = '<!doctype html>\n<html lang="en" data-workboard-shell>\n';
  const todoList = '<!doctype html>\n<html lang="en" data-matter-board-shell>\n';
  const view = '<!doctype html>\n<html lang="en" data-view-page>\n';
  const marked = {
    [join(m.draft, "Provable Facts - Milestone 1.html")]: view,
    [join(m.draft, "Provable Facts - Milestone - proceeding 3.html")]: view,
    // The Work Board's name before 2026-11-01.
    [join(m.draft, "Milestone.html")]: board,
    [join(m.draft, "Milestone-1.html")]: board,
    [join(m.draft, "Milestone - SUB Opening Submissions Package.html")]: board,
    [join(m.draft, "SUB Opening Submissions Package", "Milestone.html")]: board,
    [join(m.draft, "Pre-filing proceeding 3", "Milestone.html")]: board,
    [join(m.draft, "Material Facts - Milestone 7.html")]: view,
    [join(m.draft, "Litigation Strategy-2.html")]: todoList,
    [join(m.draft, "To Do List.html")]: todoList,
    [join(m.draft, "To Do List-2.html")]: todoList,
    [join(m.draft, "Matter Board.html")]: todoList,
    // The Work Board's name before 2026-10-28.
    [join(m.draft, "Job Board.html")]: board,
    [join(m.draft, "Job Board 12.html")]: board,
    [join(m.draft, "Job Board - filing 1.html")]: board,
    [join(m.draft, "Job Board - proceeding 3.html")]: board,
    [join(m.draft, "Provable Facts - Job Board 7.html")]: view,
    [join(m.draft, "Raw Research - Job Board 7.html")]: view,
    // Each board's Loose Threads page before 2026-10-29; the matter's own is at the top.
    [join(m.draft, "Opening Submissions Package", "Loose Threads.html")]: view,
    [join(m.draft, "Loose Threads - Milestone 4.html")]: view,
    [join(m.draft, "Loose Threads - Milestone - proceeding 3.html")]: view,
  };
  const unmarked = {
    [join(m.draft, "Work Board.html")]: "the practitioner's own board\n",
    [join(m.draft, "notes.html")]: "<p>notes</p>\n",
    [join(m.caseDataDir, "Work Board.html")]: board,
  };
  for (const [file, text] of Object.entries({ ...marked, ...unmarked })) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text, "utf-8");
  }

  const result = submissionFormsRender(m.dbPath, 1, ASHBOURNE, "mockup", undefined, undefined, undefined, FIRST, undefined, m.draft);

  for (const [file, text] of Object.entries(marked)) {
    assert.equal(existsSync(file), false, `${file} moved`);
    assert.equal(readFileSync(join(m.matterRoot, "TRASH", relative(m.matterRoot, file)), "utf-8"), text, `${file} is in TRASH at its relative path`);
  }
  for (const [file, text] of Object.entries(unmarked)) assert.equal(readFileSync(file, "utf-8"), text, `${file} untouched`);
  const lower = (paths) => paths.map((p) => p.toLowerCase()).sort();
  assert.deepEqual(lower(result.moved_to_trash.map((x) => x.from)), lower(Object.keys(marked)));
  assert.deepEqual(lower(result.moved_to_trash.map((x) => x.to)), lower(Object.keys(marked).map((file) => join(m.matterRoot, "TRASH", relative(m.matterRoot, file)))));
  assert.equal(result.trash_skipped, undefined);
  for (const page of PAGES) assert.ok(existsSync(join(m.draft, page)), `${page} written`);

  const again = submissionFormsRender(m.dbPath, 1, ASHBOURNE, "mockup", undefined, undefined, undefined, SECOND, undefined, m.draft);
  assert.equal(again.moved_to_trash, undefined, "nothing left to move");
});

test("a page write leaves a PDF in the draft folder's Superseded folder where it is", async (t) => {
  const m = matterFixture(t);
  await seedOneFiling(m.dbPath);
  const pdf = join(m.draft, "Superseded", "2024-04-20 AFF Smith DRAFT.pdf");
  mkdirSync(dirname(pdf), { recursive: true });
  writeFileSync(pdf, "%PDF-1.4 draft\n", "utf-8");

  const result = submissionFormsRender(m.dbPath, 1, ASHBOURNE, "mockup", undefined, undefined, undefined, FIRST, undefined, m.draft);

  assert.equal(readFileSync(pdf, "utf-8"), "%PDF-1.4 draft\n");
  assert.equal(result.moved_to_trash, undefined, "nothing moved to TRASH");
  assert.equal(existsSync(join(m.matterRoot, "TRASH")), false);
  for (const page of PAGES) assert.ok(existsSync(join(m.draft, page)), `${page} written`);
});

test("an old page file outside any matter with a coclerk.json is reported as skipped, never thrown", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedVaniacProceeding(f.dbPath);
    const { draft } = draftFolder(f);
    const old = join(draft, "Work Board-1.html");
    writeFileSync(old, '<!doctype html>\n<html lang="en" data-workboard-shell>\n', "utf-8");

    const result = renderInto(f, 1, draft, FIRST);

    assert.equal(result.moved_to_trash, undefined);
    assert.deepEqual(result.trash_skipped.map((x) => x.path), [old]);
    assert.match(result.trash_skipped[0].error, /coclerk\.json/);
    assert.ok(existsSync(old), "left where it was");
  } finally {
    f.cleanup();
  }
});

// Step states (schema v78): board_card prints each step's glyph at the section's Rendered minute,
// a waiting step with the plain minute it is next checked, and one whose minute has passed as open;
// the Work Board page draws the same states as classes, with `until HH:MM` beside a waiting step.
async function stepStatesBoard(t) {
  const { f } = await heldMilestone(t);
  await submissionDataExecute(
    f.dbPath,
    `DELETE FROM ticket_steps WHERE ticket_id = 1;
     INSERT INTO ticket_steps (ticket_id, ordinal, text, done_at, status, wait_until, status_note) VALUES
       (1, 1, 'Read the file', '2026-01-16T09:10', NULL, NULL, NULL),
       (1, 2, 'Search the pool', NULL, 'retry', NULL, NULL),
       (1, 3, 'Note up the case', NULL, 'cancelled', NULL, 'Not needed now.'),
       (1, 4, 'Check the regulation', NULL, 'deferred', NULL, 'After the reply.'),
       (1, 5, 'Run the Westlaw query', NULL, 'waiting', '2099-01-16T12:30', NULL),
       (1, 6, 'Download the memo', NULL, 'waiting', '2020-01-16T11:00', NULL),
       (1, 7, 'Draft the answer', NULL, NULL, NULL, NULL);`
  );
  await moveSeeds(f.dbPath);
  return f;
}

test("board_card prints each step state's glyph, the minute beside a waiting step, and a passed wait as open", async (t) => {
  const f = await stepStatesBoard(t);
  const steps = proceedingCard(f).split("\n").find((l) => l.startsWith("  steps: "));
  assert.equal(
    steps,
    "  steps: " +
      [
        "1 ☑ Read the file (2026-01-16T09:10)",
        "2 ↻ Search the pool",
        '3 ☒ Note up the case ("Not needed now.")',
        '4 ⏸ Check the regulation ("After the reply.")',
        "5 ⏳ until 12:30 Run the Westlaw query",
        "6 ☐ Download the memo",
        "7 ☐ Draft the answer",
      ].join(" · ")
  );
  // The minute is the next check, at the Rendered minute: on the day itself it still waits until it comes.
  await submissionDataExecute(f.dbPath, "UPDATE ticket_steps SET wait_until = '2026-01-16T12:30' WHERE ticket_id = 1 AND ordinal = 6;");
  assert.ok(proceedingCard(f).includes("6 ⏳ until 12:30 Download the memo"));
  await submissionDataExecute(f.dbPath, "UPDATE ticket_steps SET wait_until = '2026-01-16T12:00' WHERE ticket_id = 1 AND ordinal = 6;");
  assert.ok(proceedingCard(f).includes("6 ☐ Download the memo"), "a wait whose minute has come reads as open");
  assert.equal(headline(f), "- Job #1 Legal research: When did time start to run? · In Progress 1/7", "progress counts done steps only, and step 5's ⏳ keeps the job from reading idle");
});

test("the Work Board page draws each step state as a class, with until HH:MM beside a waiting step, and a passed wait as open", async (t) => {
  const f = await stepStatesBoard(t);
  const { draft } = draftFolder(f);
  submissionFormsRenderProceedingBoard(f.dbPath, 1, {}, NOON, "tok", draft);
  const page = join(draft, "Work Board - proceeding 1.html");
  const ticket = readBoardData(page).sections[0].tickets.find((x) => x.id === 1);
  assert.deepEqual(ticket.steps[4], { ordinal: 5, text: "Run the Westlaw query", done_at: null, status: "waiting", wait_until: "2099-01-16T12:30", status_note: null });
  const card = drawPage(page).main.all().find((n) => n.tag === "details" && n.id === "ticket-1").all();
  const items = card.filter((n) => n.tag === "li" && n.parent.className === "steps").slice(0, 7);
  assert.deepEqual(
    items.map((n) => [n.className, n.textContent]),
    [
      ["done", "Read the file"],
      ["retry", "Search the pool"],
      ["cancelled", "Note up the case"],
      ["deferred", "Check the regulation"],
      ["waiting", "Run the Westlaw query until 12:30"],
      ["next", "Download the memo"],
      ["", "Draft the answer"],
    ]
  );
  assert.ok(card.some((n) => n.className === "until" && n.textContent === " until 12:30"));
});

test("a step on a database held below v78 reads as open or done", async (t) => {
  const f = seededDbFixture();
  t.after(() => f.cleanup());
  submissionDbAt(f.dbPath, 77);
  await submissionDataExecute(
    f.dbPath,
    `INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L8470 - Larchmont', NULL);
     INSERT INTO tickets (id, proceeding_id, filing_id, title, intent, status, priority, kind, billing_anchor, locked_by, locked_at, plan_approved_at, created)
       VALUES (1, 1, NULL, 'Legal research: When did time start to run?', 'When did time start to run?', 'wip', 0, 'work', 'L8470|limitation', 'sess-holder', '2026-01-16 09:00', '2026-01-16 09:00', '2026-01-16 08:55');
     INSERT INTO ticket_steps (ticket_id, ordinal, text, done_at) VALUES (1, 1, 'Read the file', '2026-01-16T09:10'), (1, 2, 'Run the research', NULL);`
  );
  assert.ok(proceedingCard(f).includes("  steps: 1 ☑ Read the file (2026-01-16T09:10) · 2 ☐ Run the research"), proceedingCard(f));
});
