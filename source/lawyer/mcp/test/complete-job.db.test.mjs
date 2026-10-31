// drafting_data__complete_job: a /draft session completes the job it holds in one call -- the
// queued conflict partners superseded, the completion, the confirm-read (jobs-run.md §9) -- and,
// only when this call completed the job, the matter's pages rewritten by the render a session runs
// with draft_dir. Also render's pages_written on the Milestone document.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

import { startFakeCloud } from "./helpers/fake-cloud.mjs";

// open_session starts the background render job (#589): its locks and status mirrors stay out of the
// practitioner's %LOCALAPPDATA%.
process.env.COCLERK_SUBMISSION_LOCK_ROOT = mkdtempSync(join(tmpdir(), "coclerk-complete-job-locks-"));
after(() => rmSync(process.env.COCLERK_SUBMISSION_LOCK_ROOT, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));

const { freshSubmissionDb, submissionDbAt } = await import("./helpers/template-db.mjs");
const { submissionDataCompleteJob } = await import("../build/submission/forms/complete-job.js");
const { submissionDataExecute, submissionDataQuery } = await import("../build/submission/backend.js");
const { submissionFormsRender } = await import("../build/submission/forms.js");
const { callTool, createDispatchContext } = await import("../build/index.js");
const { awaitBackgroundJobs } = await import("../build/submission/render-job.js");
const writes = await import("../build/tools/practice/writes.js");

// The open_session fixture: <tmp>/L9999 Test Matter/coclerk.json -> <tmp>/L9999 Test Matter/0. CASE DATA/submission.sqlite, beside its 0. DRAFT.
function matterFixture(t) {
  const base = mkdtempSync(join(tmpdir(), "coclerk-complete-job-"));
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
  const practicePath = join(tmpdir(), `coclerk-complete-job-practice-${randomUUID()}.db`);
  t.after(() => rmSync(practicePath, { recursive: true, force: true }));
  const context = await createDispatchContext({ ...process.env, ...(await startFakeCloud(t)).env, COCLERK_DB_PATH: practicePath });
  await writes.upsert_client_matter(context.practiceDb, { client_num: "C-9999", name: "Lookup Client Ltd.", matt_num: "L9999", file_number: "F-9999" });
  return context;
}

const TICKET = "INSERT INTO tickets (id, proceeding_id, filing_id, title, intent, status, priority, kind, billing_anchor, created";
/** Filing 1's Milestone page, in its Writing's own folder (spec 2026-10-22 §9). */
const OPENING_PAGE = join("Opening Submissions Package", "Milestone.html");
const row = (dbPath, id) => submissionDataQuery(dbPath, "SELECT status, superseded_by, locked_by, completed_at FROM tickets WHERE id = ?", [id]).rows[0];

/** A matter with one filing and job 1 queued, opened and assigned to the session's token. */
async function heldJob(t, sql = "", filingId = "1") {
  const m = matterFixture(t);
  await seedOneFiling(m.dbPath);
  await submissionDataExecute(m.dbPath, `${TICKET}) VALUES (1, 1, ${filingId}, 'Settle the opening', 'Draft it.', 'queued', 0, 'work', 'L9999|opening', '2026-09-23 10:00');${sql}`);
  const context = await practiceContext(t);
  const opened = await callTool(context, "drafting_forms__open_session", { matter_root: m.matterRoot });
  const assigned = await callTool(context, "drafting_data__assign_job", { db_path: m.dbPath, ticket_id: 1, session_token: opened.session_token });
  assert.equal(assigned.outcome, "assigned");
  const complete = (args = {}) =>
    callTool(context, "drafting_data__complete_job", { db_path: m.dbPath, ticket_id: 1, session_token: opened.session_token, claim_no: assigned.claim_no, draft_dir: opened.draft_dir, ...args });
  return { m, context, opened, complete };
}

test("completing a held job supersedes its queued partner, leaves its wip partner, and rewrites the Milestone", async (t) => {
  const { m, context, opened, complete } = await heldJob(
    t,
    `${TICKET}) VALUES (2, 1, 1, 'Queued partner', 'Do it.', 'queued', 0, 'work', 'L9999|opening', '2026-09-23 10:00');
     ${TICKET}, locked_by, locked_at) VALUES (3, 1, 1, 'Wip partner', 'Do it.', 'wip', 0, 'work', 'L9999|opening', '2026-09-23 10:00', 'sess-other', '2026-09-23 10:30');
     INSERT INTO ticket_conflicts (a_id, b_id) VALUES (1, 2), (1, 3);`
  );
  // Record the section with job 1 in progress, as the session's own render after assigning does.
  await callTool(context, "drafting_forms__render", { db_path: m.dbPath, filing_id: 1, draft_dir: opened.draft_dir, session_token: opened.session_token, documents: ["Work_board"] });
  const page = join(m.draft, OPENING_PAGE);
  unlinkSync(page);

  const result = await complete();

  assert.equal(result.outcome, "completed");
  assert.equal(result.changes, 1);
  assert.equal(result.superseded, 1);
  assert.equal(result.pages_written, true);
  assert.equal(result.milestone_path.toLowerCase(), page.toLowerCase());
  assert.equal(result.board_summary, undefined, "a completion returns no board summary");
  assert.equal(result.board_changed, true);
  assert.ok(
    result.board_moves.some((mv) => mv.id === 1 && mv.from === "wip" && mv.to === "completed"),
    JSON.stringify(result.board_moves)
  );
  assert.ok(existsSync(page), "the filing's Milestone page was written again");
  assert.equal(result.pages_refused, undefined);
  assert.equal(row(m.dbPath, 1).status, "completed");
  assert.equal(row(m.dbPath, 1).locked_by, null);
  assert.deepEqual({ status: row(m.dbPath, 2).status, superseded_by: row(m.dbPath, 2).superseded_by }, { status: "superseded", superseded_by: 1 });
  assert.deepEqual({ status: row(m.dbPath, 3).status, locked_by: row(m.dbPath, 3).locked_by }, { status: "wip", locked_by: "sess-other" });
});

test("a job with no filing_id in a proceeding that has a filing rewrites the Milestone through that filing's render", async (t) => {
  // A scrutiny review job is created with filing_id NULL and shows on every filing's board.
  const { m, context, opened, complete } = await heldJob(t, "", "NULL");
  await callTool(context, "drafting_forms__render", { db_path: m.dbPath, filing_id: 1, draft_dir: opened.draft_dir, session_token: opened.session_token, documents: ["Work_board"] });

  const result = await complete();

  assert.equal(result.outcome, "completed");
  assert.equal(result.pages_written, true);
  assert.equal(result.board_changed, true);
  assert.ok(
    result.board_moves.some((mv) => mv.id === 1 && mv.from === "wip" && mv.to === "completed"),
    JSON.stringify(result.board_moves)
  );
  assert.equal(result.pages_refused, undefined, JSON.stringify(result.pages_refused));
});

test("another session's token completes nothing and writes no page", async (t) => {
  const { m, complete } = await heldJob(t, `${TICKET}) VALUES (2, 1, 1, 'Queued partner', 'Do it.', 'queued', 0, 'work', 'L9999|opening', '2026-09-23 10:00');
     INSERT INTO ticket_conflicts (a_id, b_id) VALUES (1, 2);`);
  const page = join(m.draft, OPENING_PAGE);
  unlinkSync(page);
  const before = [row(m.dbPath, 1), row(m.dbPath, 2)];

  const result = await complete({ session_token: "sess-intruder" });

  assert.equal(result.outcome, "not_held");
  assert.equal(result.changes, 0);
  assert.equal(result.superseded, 0);
  assert.equal(result.pages_written, false);
  assert.deepEqual([row(m.dbPath, 1), row(m.dbPath, 2)], before, "rows unchanged");
  assert.equal(existsSync(page), false, "no page written");
});

test("a pre-filing proceeding's job rewrites the Milestone through the proceeding's render", async (t) => {
  const m = matterFixture(t);
  await freshSubmissionDb(m.dbPath);
  await submissionDataExecute(
    m.dbPath,
    `INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L9999 - Test', 'CAN/BC/Vancouver-International-Arbitration-Centre');
     ${TICKET}) VALUES (1, 1, NULL, 'Scope the claim', 'Do it.', 'queued', 0, 'work', 'L9999|claim', '2026-09-23 10:00');`
  );
  const context = await practiceContext(t);
  const opened = await callTool(context, "drafting_forms__open_session", { matter_root: m.matterRoot });
  assert.equal(opened.opened.proceeding_id, 1);
  const { claim_no } = await callTool(context, "drafting_data__assign_job", { db_path: m.dbPath, ticket_id: 1, session_token: opened.session_token });

  const result = await callTool(context, "drafting_data__complete_job", { db_path: m.dbPath, ticket_id: 1, session_token: opened.session_token, claim_no, draft_dir: opened.draft_dir });

  assert.equal(result.outcome, "completed");
  assert.equal(result.pages_written, true);
  assert.equal(result.milestone_path.toLowerCase(), join(m.draft, "Milestone - proceeding 1.html").toLowerCase());
  assert.equal(typeof result.board_changed, "boolean");
});

test("a Milestone page without the marker is reported as pages_refused; the completion stands and the file is untouched", async (t) => {
  const { m, complete } = await heldJob(t);
  const page = join(m.draft, OPENING_PAGE);
  const own = "<p>the practitioner's own page</p>\n";
  writeFileSync(page, own, "utf-8");

  const result = await complete();

  assert.equal(result.outcome, "completed");
  assert.equal(result.changes, 1);
  assert.equal(row(m.dbPath, 1).status, "completed");
  assert.equal(result.pages_written, false);
  assert.ok(result.pages_refused.message.includes(page), result.pages_refused.message);
  assert.equal(readFileSync(page, "utf-8"), own, "the practitioner's file is untouched");
});

test("an omitted draft_dir is refused by input validation, writing nothing", async (t) => {
  const { m, opened, context } = await heldJob(t);
  await assert.rejects(
    callTool(context, "drafting_data__complete_job", { db_path: m.dbPath, ticket_id: 1, session_token: opened.session_token }),
    /draft_dir is required/
  );
  assert.deepEqual(row(m.dbPath, 1), { status: "wip", superseded_by: null, locked_by: opened.session_token, completed_at: null });
});

test("render's Milestone reports pages_written: false without draft_dir, true with it", async (t) => {
  const m = matterFixture(t);
  await seedOneFiling(m.dbPath);
  const boardOf = (rendered) => rendered.documents.find((d) => d.document_type === "Work_board");

  const inline = boardOf(submissionFormsRender(m.dbPath, 1, {}, "mockup", ["Work_board"]));
  assert.equal(inline.pages_written, false);
  assert.equal(inline.board_changed, undefined);

  const written = boardOf(submissionFormsRender(m.dbPath, 1, {}, "mockup", ["Work_board"], undefined, undefined, undefined, undefined, m.draft));
  assert.equal(written.pages_written, true);
});

// Step states (schema v78): a job with any step open, to be retried or waiting is refused with
// steps_open, naming each one, and nothing is written; one whose only steps not done were cancelled or
// deferred on the practitioner's words completes.
const STEPS = "INSERT INTO ticket_steps (ticket_id, ordinal, text, done_at, status, wait_until, status_note) VALUES";

test("a held job with a step open, to be retried, waiting or past its wait is refused with steps_open, naming each, writing nothing", async (t) => {
  const { m, complete } = await heldJob(
    t,
    `${STEPS} (1, 1, 'Read the file', '2026-09-23T10:05', NULL, NULL, NULL),
       (1, 2, 'Draft the memo', NULL, NULL, NULL, NULL),
       (1, 3, 'Search the pool', NULL, 'retry', NULL, NULL),
       (1, 4, 'Run the Westlaw query', NULL, 'waiting', '2099-01-01T09:00', NULL),
       (1, 5, 'Download the memo', NULL, 'waiting', '2020-01-01T09:00', NULL),
       (1, 6, 'Note up', NULL, 'cancelled', NULL, 'Skip it.');`
  );
  const page = join(m.draft, OPENING_PAGE);
  unlinkSync(page);

  const result = await complete();

  assert.equal(result.outcome, "steps_open");
  assert.equal(result.changes, 0);
  assert.equal(result.pages_written, false);
  assert.deepEqual(result.open_steps, [
    { ordinal: 2, text: "Draft the memo", state: "open" },
    { ordinal: 3, text: "Search the pool", state: "retry" },
    { ordinal: 4, text: "Run the Westlaw query", state: "waiting" },
    { ordinal: 5, text: "Download the memo", state: "waiting" },
  ]);
  for (const name of ["Draft the memo", "Search the pool", "Run the Westlaw query", "Download the memo"]) assert.ok(result.note.includes(name), result.note);
  assert.equal(result.note.includes("Note up"), false, "a cancelled step is resolved");
  assert.equal(row(m.dbPath, 1).status, "wip");
  assert.equal(existsSync(page), false, "no page written");
});

test("a held job whose only steps not done were cancelled or deferred on the practitioner's words completes", async (t) => {
  const { m, complete } = await heldJob(
    t,
    `${STEPS} (1, 1, 'Read the file', '2026-09-23T10:05', NULL, NULL, NULL),
       (1, 2, 'Run the Westlaw query', NULL, 'cancelled', NULL, 'We have enough.'),
       (1, 3, 'Note up', NULL, 'deferred', NULL, 'After the reply.');`
  );
  const result = await complete();
  assert.equal(result.outcome, "completed");
  assert.equal(result.changes, 1);
  assert.equal(result.open_steps, undefined);
  assert.equal(row(m.dbPath, 1).status, "completed");
});

/** A held job with two stamped steps (and optionally one unstamped) on a database migrated to `version`. */
async function twoStateJob(t, version, extra = "") {
  const dir = mkdtempSync(join(tmpdir(), "coclerk-complete-job-v77-"));
  t.after(async () => {
    await awaitBackgroundJobs();
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });
  mkdirSync(join(dir, "0. CASE DATA"));
  const dbPath = join(dir, "0. CASE DATA", "submission.sqlite");
  const draft = join(dir, "0. DRAFT");
  mkdirSync(draft);
  submissionDbAt(dbPath, version);
  await submissionDataExecute(
    dbPath,
    `INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L9999 - Test', 'CAN/BC/Vancouver-International-Arbitration-Centre');
     INSERT INTO filings (id, proceeding_id, kind, round, title) VALUES (1, 1, 'submissions_package', 'opening', 'Opening Submissions Package');
     ${TICKET}, locked_by, locked_at) VALUES (1, 1, 1, 'Settle the opening', 'Draft it.', 'wip', 0, 'work', 'L9999|opening', '2026-09-23 10:00', 'sess-a1', '2026-09-23 10:01');
     INSERT INTO ticket_steps (ticket_id, ordinal, text, done_at) VALUES (1, 1, 'Read the file', '2026-09-23T10:05'), (1, 2, 'Draft it', '2026-09-23T10:30')${extra};`
  );
  return { dbPath, draft, complete: () => submissionDataCompleteJob({ db_path: dbPath, ticket_id: 1, session_token: "sess-a1", draft_dir: draft }) };
}

test("an old two-state job with every step stamped completes on a v77 database and on one migrated to v78", async (t) => {
  const old = await twoStateJob(t, 77);
  assert.equal((await old.complete()).outcome, "completed");
  assert.equal(row(old.dbPath, 1).status, "completed");

  const migrated = await twoStateJob(t, 77);
  submissionDbAt(migrated.dbPath, 78);
  assert.deepEqual(
    submissionDataQuery(migrated.dbPath, "SELECT ordinal, done_at, status, wait_until, status_note FROM ticket_steps ORDER BY ordinal").rows,
    [
      { ordinal: 1, done_at: "2026-09-23T10:05", status: null, wait_until: null, status_note: null },
      { ordinal: 2, done_at: "2026-09-23T10:30", status: null, wait_until: null, status_note: null },
    ],
    "the hop keeps every stamp and adds nothing"
  );
  assert.equal((await migrated.complete()).outcome, "completed");
});

test("on a v77 database an unstamped step is open, so the job is refused", async (t) => {
  const old = await twoStateJob(t, 77, ", (1, 3, 'File it', NULL)");
  const result = await old.complete();
  assert.equal(result.outcome, "steps_open");
  assert.deepEqual(result.open_steps, [{ ordinal: 3, text: "File it", state: "open" }]);
  assert.equal(row(old.dbPath, 1).status, "wip");
});
