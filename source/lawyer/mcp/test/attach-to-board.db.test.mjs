// drafting_data__attach_to_board (ADR 0042): one call attaches a file that is no Writing to one Work
// Board, creating the forum-less proceeding when the matter has none. No text of the file reaches the database.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

import { startFakeCloud } from "./helpers/fake-cloud.mjs";

const { callTool, createDispatchContext } = await import("../build/index.js");
const { awaitBackgroundJobs } = await import("../build/submission/render-job.js");
const { freshSubmissionDb } = await import("./helpers/template-db.mjs");
const { submissionDataExecute, submissionDataQuery } = await import("../build/submission/backend.js");
const { closePageServer } = await import("../build/housekeeping/server.js");

after(() => closePageServer());

const TOKEN = "sess-attach-test";
const LETTER = "2026-10-08 ET Client re costs.md";
const SECRET_LINE = "Counsel's review: pending";
const SECRET_TITLE = "Advice on the invented settlement";

async function fixture(t) {
  const base = mkdtempSync(join(tmpdir(), "coclerk-attach-"));
  t.after(async () => {
    await awaitBackgroundJobs();
    rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });
  const matterRoot = join(base, "L9999 Test Matter");
  const draftDir = join(matterRoot, "0. DRAFT");
  mkdirSync(join(matterRoot, "0. CASE DATA"), { recursive: true });
  mkdirSync(draftDir);
  mkdirSync(join(base, "0. CASE DATA"));
  writeFileSync(join(draftDir, LETTER), `${SECRET_LINE}\n\n${SECRET_TITLE}\n`, "utf-8");
  const dbPath = join(matterRoot, "0. CASE DATA", "submission.sqlite");
  await freshSubmissionDb(dbPath);
  const context = await createDispatchContext({ ...process.env, ...(await startFakeCloud(t)).env, COCLERK_DB_PATH: join(base, "practice.db") });
  return { base, matterRoot, draftDir, dbPath, context };
}

const attach = (f, extra = {}) =>
  callTool(f.context, "drafting_data__attach_to_board", { db_path: f.dbPath, kind: "client_letter", path: `0. DRAFT\\${LETTER}`, draft_dir: f.draftDir, session_token: TOKEN, ...extra });
const rows = (f, sql) => submissionDataQuery(f.dbPath, sql).rows;

test("no proceeding: one call creates the forum-less proceeding and attaches the file", async (t) => {
  const f = await fixture(t);
  const result = await attach(f);
  assert.equal(result.proceeding_created, true);
  assert.deepEqual(rows(f, "SELECT id, forum, matter_reference FROM proceedings"), [{ id: 1, forum: null, matter_reference: "L9999 Test Matter" }]);
  assert.deepEqual(rows(f, "SELECT proceeding_id, filing_id, path, kind FROM board_attachments"), [{ proceeding_id: 1, filing_id: null, path: `0. DRAFT\\${LETTER}`, kind: "client_letter" }]);
  assert.equal(result.pages_written, true);
  assert.equal(result.board_changed, true, "the page is due to be presented");
  assert.match(result.milestone_path, /\.html$/);
});

test("no client-letter text, title or status reaches the database", async (t) => {
  const f = await fixture(t);
  await attach(f);
  const tables = rows(f, "SELECT name FROM sqlite_master WHERE type = 'table'").map((r) => r.name);
  for (const table of tables) {
    const held = JSON.stringify(rows(f, `SELECT * FROM "${table}"`));
    assert.equal(held.includes(SECRET_TITLE), false, `${table} holds the letter's title`);
    assert.equal(held.includes(SECRET_LINE), false, `${table} holds the letter's status`);
  }
});

test("one board attaches there; an absolute path is stored in the same form", async (t) => {
  const f = await fixture(t);
  await submissionDataExecute(
    f.dbPath,
    `INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L9999', NULL);
     INSERT INTO filings (id, proceeding_id, kind, title, needs_forum_parts) VALUES (5, 1, 'task-board', 'Paper originals', 0);`
  );
  const result = await attach(f, { path: join(f.draftDir, LETTER) });
  assert.equal(result.proceeding_created, undefined);
  assert.deepEqual(rows(f, "SELECT proceeding_id, filing_id, path FROM board_attachments"), [{ proceeding_id: 1, filing_id: 5, path: `0. DRAFT\\${LETTER}` }]);
  assert.equal(rows(f, "SELECT COUNT(*) AS n FROM proceedings")[0].n, 1);
});

test("several boards refuse, naming them, until the call names one", async (t) => {
  const f = await fixture(t);
  await submissionDataExecute(
    f.dbPath,
    `INSERT INTO proceedings (id, matter_reference, forum, file_number) VALUES (1, 'L9999', NULL, NULL), (2, 'L9999', NULL, NULL);
     INSERT INTO filings (id, proceeding_id, kind, title, needs_forum_parts) VALUES (5, 1, 'task-board', 'Paper originals', 0);`
  );
  await assert.rejects(attach(f), (err) => {
    assert.equal(err.code, "several_boards");
    assert.match(err.message, /"Paper originals"/);
    assert.deepEqual(err.details.boards.map((b) => [b.filing_id, b.proceeding_id]), [[5, 1], [null, 2]]);
    return true;
  });
  assert.equal(rows(f, "SELECT COUNT(*) AS n FROM board_attachments")[0].n, 0, "the refusal writes nothing");
  await assert.rejects(attach(f, { filing_id: 99 }), (err) => err.code === "not_a_board");
  await attach(f, { proceeding_id: 2 });
  assert.deepEqual(rows(f, "SELECT proceeding_id, filing_id FROM board_attachments"), [{ proceeding_id: 2, filing_id: null }]);
});

test("a retry leaves the file on its board, and proceedings with no live board refuse", async (t) => {
  const f = await fixture(t);
  const first = await attach(f);
  const again = await attach(f);
  assert.equal(again.already_attached, true);
  assert.equal(again.attachment_id, first.attachment_id);
  assert.equal(rows(f, "SELECT COUNT(*) AS n FROM board_attachments")[0].n, 1);

  const g = await fixture(t);
  await submissionDataExecute(
    g.dbPath,
    `INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L9999', NULL);
     INSERT INTO filings (id, proceeding_id, kind, title, needs_forum_parts) VALUES (5, 1, 'task-board', 'Closed', 0);
     UPDATE filings SET retired_on = '2026-10-01', retirement_reason = 'abandoned' WHERE id = 5;`
  );
  await assert.rejects(attach(g), (err) => err.code === "no_board");
});

test("a proceeding holding only a research memo takes the file through that memo's id", async (t) => {
  const f = await fixture(t);
  await submissionDataExecute(
    f.dbPath,
    `INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L9999', NULL);
     INSERT INTO filings (id, proceeding_id, kind, title, needs_forum_parts) VALUES (3, 1, 'research_memo', 'Memo', 0);`
  );
  const result = await attach(f);
  assert.deepEqual(rows(f, "SELECT proceeding_id, filing_id FROM board_attachments"), [{ proceeding_id: 1, filing_id: 3 }]);
  assert.equal(result.pages_written, true);
});

test("a file not written, outside its folder, or a wrong kind refuses and writes nothing", async (t) => {
  const f = await fixture(t);
  await assert.rejects(attach(f, { path: "0. DRAFT\\No such letter.md" }), (err) => err.code === "path_missing");
  writeFileSync(join(f.matterRoot, "Loose.md"), "x");
  await assert.rejects(attach(f, { path: "Loose.md" }), (err) => err.code === "path_outside");
  await assert.rejects(attach(f, { path: "0. DRAFT\\..\\Loose.md" }), (err) => err.code === "path_outside");
  await assert.rejects(attach(f, { kind: "letter" }), (err) => err.code === "invalid_kind" || /kind/.test(err.message));
  assert.equal(rows(f, "SELECT COUNT(*) AS n FROM proceedings")[0].n, 0);
  assert.equal(rows(f, "SELECT COUNT(*) AS n FROM board_attachments")[0].n, 0);
});

test("a reply takes the same call; another party's filing may sit anywhere in the matter folder", async (t) => {
  const f = await fixture(t);
  const reply = "2026-10-08 ET Smith re hearing.md";
  writeFileSync(join(f.draftDir, reply), "Dear Smith\n");
  mkdirSync(join(f.matterRoot, "3. COURT FILE"));
  writeFileSync(join(f.matterRoot, "3. COURT FILE", "Response.pdf"), "x");
  await attach(f, { kind: "reply", path: `0. DRAFT\\${reply}` });
  await attach(f, { kind: "opposing_filing", path: "3. COURT FILE\\Response.pdf" });
  assert.deepEqual(rows(f, "SELECT path, kind FROM board_attachments ORDER BY id"), [
    { path: `0. DRAFT\\${reply}`, kind: "reply" },
    { path: "3. COURT FILE\\Response.pdf", kind: "opposing_filing" },
  ]);
});
