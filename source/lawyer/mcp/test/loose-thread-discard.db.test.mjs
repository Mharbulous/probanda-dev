// A loose thread that left the board without being outlined (schema v75): seeds.discarded_at and
// seeds.suggested_at. A discarded or suggested thread is not open, so it is out of fetchOpenSeeds,
// the Defer write and the latest-activity read, and is listed by fetchResolvedSeeds on the matter's
// one Loose Threads page. No Milestone draws or counts a loose thread. A database held at v74 has
// neither column and still reads, with none of either.

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { freshSubmissionDb, submissionDbAt } = await import("./helpers/template-db.mjs");
const { submissionDataExecute, submissionDataQuery } = await import("../build/submission/backend.js");
const { submissionFormsRender } = await import("../build/submission/forms.js");
const { fetchLatestActivity, fetchProceeding, liveSeedClause, seedClosedColumns } = await import("../build/submission/forms/query.js");
const { buildPreFilingBoardData, fetchOpenSeeds, fetchResolvedSeeds, inRankOrder, openSeedCondition } = await import("../build/submission/forms/render-work-board.js");
const { setSeedDeferral } = await import("../build/submission/forms/seed-deferral.js");
const { buildLooseIdeasData, LOOSE_IDEAS_PAGE } = await import("../build/submission/forms/loose-ideas-page.js");
const { renderViewPageHtml } = await import("../build/submission/view-pages.js");
const { renderBoardSummary, renderLiveLanes, TODOS_NOT_READ } = await import("../build/submission/matter-pages.js");

const META = { revision: 1, matter: "L8470", client: "Larchmont", rendered: "2026-10-13 12:00" };
const CLIENT = { clientName: "Larchmont", clientNo: "8470", matterNo: "L8470" };

// Proceeding 1's threads: 1 open, 2 discarded, 3 suggested, 4 outlined into live job 10. Proceeding 2
// holds one discarded thread, which no read of proceeding 1 returns.
const THREADS = `
  INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L8470 - Larchmont', NULL), (2, 'L8470 - Larchmont', NULL);
  INSERT INTO tickets (id, proceeding_id, title, intent, status, kind, billing_anchor, created) VALUES (10, 1, 'Live job', 'Do it.', 'queued', 'work', 'L8470|x', '2026-10-01T09:00');
  INSERT INTO seeds (id, proceeding_id, created, surfaced_by, idea, charted_into) VALUES
    (1, 1, '2026-10-01T10:00', 'noticed', 'An open thread.', NULL),
    (2, 1, '2026-10-01T10:01', 'noticed', 'A discarded thread.', NULL),
    (3, 1, '2026-10-01T10:02', 'noticed', 'A suggested thread.', NULL),
    (4, 1, '2026-10-01T10:03', 'noticed', 'Outlined into a live job.', 10),
    (5, 2, '2026-10-01T10:04', 'noticed', 'Another proceeding''s discarded thread.', NULL);`;
const CLOSE = `
  UPDATE seeds SET discarded_at = '2026-10-12T09:00' WHERE id IN (2, 5);
  UPDATE seeds SET suggested_at = '2026-10-13T09:00' WHERE id = 3;`;

function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), "coclerk-loose-thread-discard-"));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
  return dir;
}

/** A current database holding THREADS, with 2, 3 and 5 closed. */
async function current(t) {
  const dir = tempDir(t);
  const caseData = join(dir, "L8470 Larchmont", "0. CASE DATA");
  mkdirSync(caseData, { recursive: true });
  const dbPath = join(caseData, "submission.sqlite");
  await freshSubmissionDb(dbPath);
  await submissionDataExecute(dbPath, THREADS + CLOSE);
  return { dir, dbPath };
}

/** A database held at v74, before the two columns, holding THREADS. */
async function heldAt74(t) {
  const dir = tempDir(t);
  const dbPath = join(dir, "submission.sqlite");
  submissionDbAt(dbPath, 74);
  await submissionDataExecute(dbPath, THREADS);
  return { dir, dbPath };
}

const seedRow = (dbPath, id) => submissionDataQuery(dbPath, "SELECT * FROM seeds WHERE id = ?", [id]).rows[0];
const resolvedOf = (dbPath, p) => fetchResolvedSeeds(dbPath, p).map((r) => [r.id, r.how]);

test("a current database holds both columns, and the open-thread condition names them", async (t) => {
  const { dbPath } = await current(t);
  assert.deepEqual(seedClosedColumns(dbPath), ["discarded_at", "suggested_at"]);
  assert.equal(liveSeedClause(dbPath), " AND discarded_at IS NULL AND suggested_at IS NULL");
  assert.deepEqual(openSeedCondition(dbPath, new Set()), { sql: "(charted_into IS NULL) AND discarded_at IS NULL AND suggested_at IS NULL", params: [] });
  assert.deepEqual(openSeedCondition(dbPath, new Set([11, 12])), {
    sql: "(charted_into IS NULL OR charted_into IN (?,?)) AND discarded_at IS NULL AND suggested_at IS NULL",
    params: [11, 12],
  });
});

test("fetchOpenSeeds hides a discarded and a suggested thread, and fetchResolvedSeeds returns them", async (t) => {
  const { dbPath } = await current(t);
  assert.deepEqual(fetchOpenSeeds(dbPath, 1).map((s) => s.id), [1], "the discarded, the suggested and the outlined thread are not open");
  assert.deepEqual(resolvedOf(dbPath, 1), [[3, "suggested"], [2, "discarded"], [4, "job"]]);
  assert.deepEqual(resolvedOf(dbPath, 2), [[5, "discarded"]], "each proceeding's own");
  assert.deepEqual(fetchOpenSeeds(dbPath, 2), []);
});

test("restoring a discarded thread opens it again, and it leaves fetchResolvedSeeds", async (t) => {
  const { dbPath } = await current(t);
  await submissionDataExecute(dbPath, "UPDATE seeds SET discarded_at = NULL WHERE id = 2 AND discarded_at IS NOT NULL;");
  assert.deepEqual(fetchOpenSeeds(dbPath, 1).map((s) => s.id), [1, 2]);
  assert.deepEqual(resolvedOf(dbPath, 1), [[3, "suggested"], [4, "job"]]);
});

test("a thread outlined into a deleted job and then discarded stays off the board", async (t) => {
  const { dbPath } = await current(t);
  await submissionDataExecute(dbPath, "UPDATE tickets SET deleted_at = '2026-10-10T09:00' WHERE id = 10;");
  assert.deepEqual(fetchOpenSeeds(dbPath, 1).map((s) => s.id), [1, 4], "outlined into a deleted job, thread 4 is open again");
  await submissionDataExecute(dbPath, "UPDATE seeds SET discarded_at = '2026-10-13T10:00' WHERE id = 4;");
  assert.deepEqual(fetchOpenSeeds(dbPath, 1).map((s) => s.id), [1]);
  assert.deepEqual(resolvedOf(dbPath, 1), [[4, "discarded"], [3, "suggested"], [2, "discarded"]]);
});

test("setSeedDeferral answers not_open for a discarded and for a suggested thread, writing nothing", async (t) => {
  const { dbPath } = await current(t);
  for (const [seedId, action] of [[2, "defer"], [3, "defer"], [2, "undefer"]]) {
    const before = seedRow(dbPath, seedId);
    const result = await setSeedDeferral({ db_path: dbPath, proceeding_id: 1, seed_id: seedId, action });
    assert.equal(result.outcome, "not_open", `${action} of thread ${seedId}`);
    assert.deepEqual(seedRow(dbPath, seedId), before, "the row is as it was");
  }
  assert.equal((await setSeedDeferral({ db_path: dbPath, proceeding_id: 1, seed_id: 1, action: "defer" })).outcome, "deferred", "the open thread still defers");
});

test("a deferred thread that is then discarded is not open, and cannot be brought back by undefer", async (t) => {
  const { dbPath } = await current(t);
  assert.equal((await setSeedDeferral({ db_path: dbPath, proceeding_id: 1, seed_id: 1, action: "defer" })).outcome, "deferred");
  await submissionDataExecute(dbPath, "UPDATE seeds SET discarded_at = '2026-10-13T10:00' WHERE id = 1;");
  assert.equal((await setSeedDeferral({ db_path: dbPath, proceeding_id: 1, seed_id: 1, action: "undefer" })).outcome, "not_open");
  assert.notEqual(seedRow(dbPath, 1).deferred_at, null, "the deferral stands");
});

test("fetchLatestActivity ignores a discarded and a suggested thread", async (t) => {
  const { dbPath } = await current(t);
  await submissionDataExecute(
    dbPath,
    `UPDATE proceedings SET forum = 'CAN/BC/BCSC' WHERE id = 1;
     INSERT INTO filings (id, proceeding_id, kind, title) VALUES (1, 1, 'notice_of_application', 'Notice of Application'), (2, 1, 'application_response', 'Application Response');
     INSERT INTO seeds (id, proceeding_id, filing_id, created, surfaced_by, idea) VALUES
       (20, 1, 1, '2026-10-05T10:00', 'noticed', 'Open, on filing 1.'),
       (21, 1, 1, '2026-10-09T10:00', 'noticed', 'Newer, on filing 1.'),
       (22, 1, 2, '2026-10-08T10:00', 'noticed', 'The only thread on filing 2.');`
  );
  const latest = () => Object.fromEntries(fetchLatestActivity(dbPath, 1).map((r) => [String(r.filing_id), r.latest]));
  assert.deepEqual(latest(), { null: "2026-10-01T10:00", 1: "2026-10-09T10:00", 2: "2026-10-08T10:00" }, "proceeding-wide: job 10's creation and open thread 1, never threads 2 and 3");

  await submissionDataExecute(dbPath, "UPDATE seeds SET discarded_at = '2026-10-13T10:00' WHERE id = 21; UPDATE seeds SET suggested_at = '2026-10-13T10:00' WHERE id = 22;");
  assert.deepEqual(latest(), { null: "2026-10-01T10:00", 1: "2026-10-05T10:00" }, "filing 1 falls back to its open thread, and filing 2 has no activity left");

  await submissionDataExecute(dbPath, "UPDATE seeds SET discarded_at = NULL WHERE id = 21;");
  assert.equal(latest()[1], "2026-10-09T10:00", "a restored thread counts again");
});

test("no Milestone counts a loose thread or carries a resolved one", async (t) => {
  const { dbPath } = await current(t);
  const data = buildPreFilingBoardData(dbPath, fetchProceeding(dbPath, 1), META);
  assert.deepEqual(data.seeds.map((s) => s.id), [1], "the open thread, for its job card's line alone");
  assert.equal("discardedSeeds" in data, false);
  for (const text of [renderLiveLanes(data).join("\n"), renderBoardSummary(data, CLIENT, TODOS_NOT_READ)]) {
    assert.doesNotMatch(text, /Loose Threads|An open thread|A discarded thread|A suggested thread/, text);
  }
});

// The matter's one page: every proceeding's open threads, each set as fetchOpenSeeds reads it, and no copy in a Writing's folder.
test("the matter's Loose Threads page lists every open thread of every proceeding, as fetchOpenSeeds reads each", async (t) => {
  const { dir, dbPath } = await current(t);
  await submissionDataExecute(
    dbPath,
    `UPDATE proceedings SET forum = 'CAN/BC/BCSC', file_number = 'S-770011' WHERE id = 1;
     INSERT INTO filings (id, proceeding_id, kind, title) VALUES (1, 1, 'notice_of_application', 'Notice of Application');
     INSERT INTO seeds (id, proceeding_id, filing_id, created, surfaced_by, idea) VALUES
       (6, 2, NULL, '2026-10-01T10:05', 'noticed', 'Proceeding 2''s open thread.'),
       (7, 1, 1, '2026-10-01T10:06', 'noticed', 'Captured on the Writing.');`
  );
  const draft = join(dir, "L8470 Larchmont", "0. DRAFT");
  mkdirSync(draft, { recursive: true });
  const result = submissionFormsRender(dbPath, 1, CLIENT, "mockup", undefined, undefined, undefined, undefined, undefined, draft);
  assert.equal(result.loose_threads_path, join(draft, "Loose Threads.html"));
  assert.equal(existsSync(join(draft, "Notice of Application", "Loose Threads.html")), false, "no Writing has a copy");
  const page = JSON.parse(/^window\.VIEW_PAGE = (.*);$/m.exec(readFileSync(result.loose_threads_path, "utf-8"))[1]);
  for (const p of [1, 2]) {
    assert.deepEqual(page.data.ideas.filter((i) => i.proceeding_id === p).map((i) => i.id), fetchOpenSeeds(dbPath, p).map((s) => s.id), `proceeding ${p}`);
  }
  assert.deepEqual(page.data.ideas.map((i) => i.id), [1, 6, 7], "every open thread, none lost");
  assert.equal(page.data.ideas.find((i) => i.id === 7).origin, "from Notice of Application", "a thread names the Writing it was captured on");
  assert.deepEqual(Object.keys(page.data.api.tokens), ["1", "2"], "each proceeding's own token, so Defer reaches either");
});

// /work's triage step reads the open threads with this query (drafting_data__query); it must equal fetchOpenSeeds.
const TRIAGE_READ =
  "SELECT id, proceeding_id, filing_id, origin_ticket_id, surfaced_by, idea, rank, rank_group, rank_reason, rank_job, deferred_at FROM seeds " +
  "WHERE (charted_into IS NULL OR charted_into IN (SELECT id FROM tickets WHERE deleted_at IS NOT NULL)) AND discarded_at IS NULL AND suggested_at IS NULL " +
  "ORDER BY rank IS NULL, rank, id";

test("the triage read returns the open threads fetchOpenSeeds returns, in the page's order", async (t) => {
  const { dbPath } = await current(t);
  await submissionDataExecute(
    dbPath,
    `UPDATE tickets SET deleted_at = '2026-10-10T09:00' WHERE id = 10;
     UPDATE seeds SET rank = 1, rank_group = 'research', rank_reason = 'Ranked first.' WHERE id = 4;
     INSERT INTO seeds (id, proceeding_id, created, surfaced_by, idea) VALUES (6, 2, '2026-10-01T10:05', 'noticed', 'Proceeding 2''s open thread.');`
  );
  const open = inRankOrder([1, 2].flatMap((p) => fetchOpenSeeds(dbPath, p)));
  assert.deepEqual(open.map((s) => s.id), [4, 1, 6], "4 is outlined into a deleted job; 2, 3 and 5 are discarded or suggested");
  assert.deepEqual(submissionDataQuery(dbPath, TRIAGE_READ, []).rows.map((r) => r.id), open.map((s) => s.id));
});

test("the Loose Threads page lists a discarded, a suggested and an outlined thread as resolved, newest first", async (t) => {
  const { dbPath } = await current(t);
  const data = buildLooseIdeasData(dbPath, [1], process.env);
  assert.deepEqual(data.ideas.map((i) => i.id), [1], "only the open thread is a card");
  assert.deepEqual(data.resolved, [
    { id: 3, idea: "A suggested thread.", how: "suggested", at: "2026-10-13T09:00", job_id: null, job_title: null },
    { id: 2, idea: "A discarded thread.", how: "discarded", at: "2026-10-12T09:00", job_id: null, job_title: null },
    { id: 4, idea: "Outlined into a live job.", how: "job", at: "2026-10-01T09:00", job_id: 10, job_title: "Live job" },
  ]);
  assert.deepEqual(fetchResolvedSeeds(dbPath, 2).map((r) => [r.id, r.how]), [[5, "discarded"]]);
  const html = renderViewPageHtml(LOOSE_IDEAS_PAGE, { filing: "", matter: "L8470", client: "", revision: 1, rendered: "2026-10-13 12:00" }, data);
  const page = JSON.parse(/^window\.VIEW_PAGE = (.*);$/m.exec(html)[1]);
  assert.deepEqual(page.data.resolved, data.resolved, "the page carries them");
  assert.deepEqual(page.extra, [["Threads", "1"], ["Ranked", "0"], ["Unranked", "1"], ["Deferred", "0"], ["Resolved", "3"]], "the header counts the open threads apart from the resolved");
});

test("a database held at v74 has neither column and still reads and defers", async (t) => {
  const { dbPath } = await heldAt74(t);
  assert.deepEqual(seedClosedColumns(dbPath), []);
  assert.equal(liveSeedClause(dbPath), "");
  assert.deepEqual(openSeedCondition(dbPath, new Set()), { sql: "(charted_into IS NULL)", params: [] });
  assert.deepEqual(fetchOpenSeeds(dbPath, 1).map((s) => s.id), [1, 2, 3], "every thread not outlined is open");
  assert.deepEqual(resolvedOf(dbPath, 1), [[4, "job"]], "it lists its outlined threads");
  assert.deepEqual(fetchLatestActivity(dbPath, 1), [{ filing_id: null, latest: "2026-10-01T10:02" }]);

  assert.equal((await setSeedDeferral({ db_path: dbPath, proceeding_id: 1, seed_id: 2, action: "defer" })).outcome, "deferred");
  assert.equal((await setSeedDeferral({ db_path: dbPath, proceeding_id: 1, seed_id: 4, action: "defer" })).outcome, "not_open", "outlined into a live job");

  const ideas = buildLooseIdeasData(dbPath, [1], process.env);
  assert.deepEqual(ideas.ideas.map((i) => i.id), [1, 2, 3]);
  assert.deepEqual(ideas.resolved.map((r) => r.id), [4]);
});
