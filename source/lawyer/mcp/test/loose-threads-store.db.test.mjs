// A matter's loose threads in their own store (loose-threads/): the one move out of `seeds`, the three
// tools, the refusal on the old path, the page's tabs, and what stays in the working database.

import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { freshSubmissionDb } = await import("./helpers/template-db.mjs");
const { submissionDataExecute, submissionDataQuery } = await import("../build/submission/backend.js");
const { looseThreadsPath, readThreads } = await import("../build/loose-threads/backend.js");
const { moveSeedsOnce } = await import("../build/loose-threads/migrate.js");
const { looseThreadsCapture, looseThreadsRead, looseThreadsUpdate } = await import("../build/loose-threads/tools.js");
const { submissionDataCreateJob } = await import("../build/submission/forms/create-job.js");
const { buildLooseIdeasData } = await import("../build/submission/forms/loose-ideas-page.js");

const BASE = `
  INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L8470 - Larchmont', 'CAN/BC/BCSC');
  INSERT INTO tickets (id, proceeding_id, title, intent, status, kind, billing_anchor, created) VALUES (10, 1, 'Live job', 'Do it.', 'queued', 'work', 'L8470|x', '2026-10-01T09:00');`;
const SEEDS = `
  INSERT INTO seeds (id, proceeding_id, created, surfaced_by, idea, charted_into, rank, rank_group, rank_reason, rank_job, deferred_at, discarded_at) VALUES
    (2, 1, '2026-10-01T10:00', 'noticed', 'Ranked and open.', NULL, 1, 'tooling', 'First.', 'Fix it.', NULL, NULL),
    (5, 1, '2026-10-01T10:01', 'noticed', 'Deferred.', NULL, NULL, NULL, NULL, NULL, '2026-10-02T09:00', NULL),
    (7, 1, '2026-10-01T10:02', 'noticed', 'Discarded.', NULL, NULL, NULL, NULL, NULL, NULL, '2026-10-03T09:00'),
    (9, 1, '2026-10-01T10:03', 'noticed', 'Outlined.', 10, NULL, NULL, NULL, NULL, NULL, NULL);`;

async function matter(t, script = BASE + SEEDS) {
  const dir = mkdtempSync(join(tmpdir(), "coclerk-loose-threads-"));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
  const caseData = join(dir, "L8470 Larchmont", "0. CASE DATA");
  mkdirSync(caseData, { recursive: true });
  const dbPath = join(caseData, "submission.sqlite");
  await freshSubmissionDb(dbPath);
  await submissionDataExecute(dbPath, script);
  return { dir, caseData, dbPath, draft: join(dir, "L8470 Larchmont", "0. DRAFT") };
}

const count = (dbPath, table) => submissionDataQuery(dbPath, `SELECT COUNT(*) AS n FROM ${table}`).rows[0].n;
const backups = (caseData) => readdirSync(caseData).filter((f) => f.includes(".bak-"));

test("the move keeps every id, field and count, backs up first, empties seeds and leaves the table", async (t) => {
  const { dbPath, caseData } = await matter(t);
  const moved = await moveSeedsOnce(dbPath);
  assert.equal(moved.moved, 4);
  assert.deepEqual(backups(caseData).length, 1);
  assert.equal(moved.backup, join(caseData, backups(caseData)[0]));
  const threads = readThreads(dbPath);
  assert.deepEqual(threads.map((x) => x.id), [2, 5, 7, 9]);
  assert.deepEqual(threads.map((x) => x.kind), ["idea", "idea", "idea", "idea"]);
  const first = threads[0];
  assert.deepEqual([first.rank, first.rank_group, first.rank_reason, first.rank_job, first.origin_job, first.filing_id], [1, "tooling", "First.", "Fix it.", null, null]);
  assert.equal(threads[1].deferred_at, "2026-10-02T09:00");
  assert.equal(threads[2].discarded_at, "2026-10-03T09:00");
  assert.equal(threads[3].charted_into, 10);
  assert.equal(count(dbPath, "seeds"), 0);
  assert.equal(looseThreadsPath(dbPath), join(caseData, "loose_threads.db"));
});

test("the move runs once: a row written to seeds after it is left alone and reported", async (t) => {
  const { dbPath, caseData } = await matter(t);
  await moveSeedsOnce(dbPath);
  assert.equal(await moveSeedsOnce(dbPath), null, "seeds is empty: nothing to do");
  await submissionDataExecute(dbPath, "INSERT INTO seeds (id, proceeding_id, created, surfaced_by, idea) VALUES (2, 1, '2026-11-01T09:00', 'an older copy', 'Stray.');");
  assert.deepEqual(await moveSeedsOnce(dbPath), { stray: 1 });
  assert.equal(readThreads(dbPath).find((x) => x.id === 2).idea, "Ranked and open.", "the store is untouched");
  assert.equal(backups(caseData).length, 1, "no second backup");
});

test("a move killed before the delete finishes on the next run and overwrites no thread", async (t) => {
  const { dbPath } = await matter(t);
  await moveSeedsOnce(dbPath);
  await looseThreadsUpdate({ db_path: dbPath, action: "restore", id: 7 });
  // The same rows back in seeds with no marker: the state a kill between the copy and the delete leaves.
  const { runKv } = await import("../build/kv/backend.js");
  runKv({ op: "delete", db_path: looseThreadsPath(dbPath), namespace: "meta", key: "seeds_moved", exclusive: true }, { label: "test", timeoutMs: 20000, env: process.env });
  await submissionDataExecute(dbPath, SEEDS);
  assert.equal((await moveSeedsOnce(dbPath)).moved, 4);
  assert.equal(readThreads(dbPath).find((x) => x.id === 7).discarded_at, null, "the store's copy stands");
  assert.equal(count(dbPath, "seeds"), 0);
});

test("a database with nothing in seeds makes no store file", async (t) => {
  const { dbPath, caseData } = await matter(t, BASE);
  assert.equal(await moveSeedsOnce(dbPath), null);
  assert.deepEqual(readThreads(dbPath), []);
  assert.equal(existsSync(join(caseData, "loose_threads.db")), false);
});

test("a review point's old link survives the move as a plain number, and the point can still be resolved", async (t) => {
  const { dbPath } = await matter(t, `${BASE}${SEEDS}
    INSERT INTO filings (id, proceeding_id, kind, title) VALUES (1, 1, 'notice_of_application', 'Notice of Application');
    INSERT INTO review_points (id, filing_id, ticket_id, entity, entity_id, created, comment, seed_id) VALUES (5, 1, 10, 'filings', 1, '2026-10-01T10:00', 'A point.', 7);`);
  await moveSeedsOnce(dbPath);
  assert.equal(count(dbPath, "seeds"), 0);
  assert.equal(submissionDataQuery(dbPath, "SELECT seed_id FROM review_points WHERE id = 5").rows[0].seed_id, 7, "the number stands");
  assert.equal(readThreads(dbPath).find((x) => x.id === 7).idea, "Discarded.", "and names the same thread");
  await submissionDataExecute(dbPath, "UPDATE review_points SET resolution = 'answered', resolved_at = '2026-10-02T09:00' WHERE id = 5;");
  assert.equal(submissionDataQuery(dbPath, "SELECT resolution, seed_id FROM review_points WHERE id = 5").rows[0].seed_id, 7);
});

test("drafting_data__query returns no thread data after the move", async (t) => {
  const { dbPath } = await matter(t);
  await moveSeedsOnce(dbPath);
  await looseThreadsCapture({ db_path: dbPath, proceeding_id: 1, surfaced_by: "noticed", idea: "After the move." });
  assert.deepEqual(submissionDataQuery(dbPath, "SELECT * FROM seeds").rows, []);
  const tables = submissionDataQuery(dbPath, "SELECT name FROM sqlite_master WHERE type = 'table'").rows.map((r) => r.name);
  for (const table of tables) {
    const dump = JSON.stringify(submissionDataQuery(dbPath, `SELECT * FROM "${table}"`).rows);
    assert.doesNotMatch(dump, /Ranked and open|After the move/, table);
  }
});

test("drafting_data__execute refuses a write naming seeds, and a script that changes it, writing nothing", async (t) => {
  const { dbPath } = await matter(t);
  await moveSeedsOnce(dbPath);
  for (const script of [
    "INSERT INTO seeds (proceeding_id, created, surfaced_by, idea) VALUES (1, 'x', 'x', 'x');",
    "UPDATE seeds SET charted_into = 10 WHERE id = 7;",
    "update  main.\"seeds\" set idea = 'x';",
    "DELETE FROM seeds WHERE id = 1;",
    "UPDATE tickets SET priority = 3 WHERE id = 10; UPDATE seeds SET idea = 'x';",
  ]) {
    await assert.rejects(submissionDataExecute(dbPath, script, process.env, true), /loose_thread_write_refused: use loose_threads__capture/, script);
  }
  assert.equal(submissionDataQuery(dbPath, "SELECT priority FROM tickets WHERE id = 10").rows[0].priority, 0, "the whole script was refused");
  await submissionDataExecute(dbPath, "UPDATE tickets SET priority = 3 WHERE id = 10;", process.env, true);
  assert.equal(submissionDataQuery(dbPath, "SELECT priority FROM tickets WHERE id = 10").rows[0].priority, 3, "a script not naming it still runs");
});

test("capture returns only the new id, one above the highest held, and moves first", async (t) => {
  const { dbPath } = await matter(t);
  const out = await looseThreadsCapture({ db_path: dbPath, proceeding_id: 1, origin_job: 10, surfaced_by: "noticed", idea: "A new idea." });
  assert.deepEqual(out, { id: 10 }, "highest held was 9, moved by this call");
  const t10 = readThreads(dbPath).find((x) => x.id === 10);
  assert.deepEqual([t10.kind, t10.origin_job, t10.idea, t10.charted_into], ["idea", 10, "A new idea.", null]);
  assert.deepEqual(await looseThreadsCapture({ db_path: dbPath, proceeding_id: 1, surfaced_by: "x", idea: "A draft.", kind: "correspondence", ref: "letter.eml" }), { id: 11 });
  await assert.rejects(looseThreadsCapture({ db_path: dbPath, proceeding_id: 99, surfaced_by: "x", idea: "y" }), /names no proceeding/);
  await assert.rejects(looseThreadsCapture({ db_path: dbPath, proceeding_id: 1, surfaced_by: "x", idea: "y", kind: "memo" }), /must be one of/);
});

test("read returns the open set for triage and only matches for the duplicate test", async (t) => {
  const { dbPath } = await matter(t);
  await looseThreadsCapture({ db_path: dbPath, proceeding_id: 1, surfaced_by: "x", idea: "Does the example rule govern service by courier?" });
  const triage = await looseThreadsRead({ db_path: dbPath, mode: "triage", kind: "idea" });
  assert.deepEqual(triage.threads.map((x) => x.id), [2, 5, 10], "ranked first; discarded and outlined are out; a deferred thread stays, carrying deferred_at");
  const hit = await looseThreadsRead({ db_path: dbPath, mode: "duplicates", proceeding_id: 1, text: "Does the example rule govern service by courier in this case?" });
  assert.deepEqual(hit.threads, [{ id: 10, idea: "Does the example rule govern service by courier?" }]);
  assert.deepEqual((await looseThreadsRead({ db_path: dbPath, mode: "duplicates", proceeding_id: 1, text: "A wholly different question about limitation periods" })).threads, []);
  await assert.rejects(looseThreadsRead({ db_path: dbPath, mode: "duplicates" }), /required under duplicates/);
});

test("update ranks ideas only, defers, discards, restores, consumes and corrects", async (t) => {
  const { dbPath } = await matter(t);
  const other = (await looseThreadsCapture({ db_path: dbPath, proceeding_id: 1, surfaced_by: "x", idea: "An argument never drafted.", kind: "argument" })).id;
  const entry = (id, rank) => ({ id, rank, group: "research", job: "Do it.", reason: "Why." });
  await assert.rejects(looseThreadsUpdate({ db_path: dbPath, action: "rank", ranks: [entry(other, 1)] }), /only ideas are ranked/);
  await assert.rejects(looseThreadsUpdate({ db_path: dbPath, action: "rank", ranks: [entry(7, 1)] }), /is not open/);
  const ranked = await looseThreadsUpdate({ db_path: dbPath, action: "rank", ranks: [entry(2, 1)] });
  assert.deepEqual(ranked, { updated: [2], unranked_open: 0 }, "the deferred idea is not counted, and the argument is not an idea");
  assert.deepEqual(await looseThreadsUpdate({ db_path: dbPath, action: "correct", id: 2, job: "Their words." }), { updated: [2] });
  assert.equal(readThreads(dbPath).find((x) => x.id === 2).rank_job, "Their words.");
  await assert.rejects(looseThreadsUpdate({ db_path: dbPath, action: "correct", id: 5, job: "x" }), /is not ranked/);
  assert.deepEqual(await looseThreadsUpdate({ db_path: dbPath, action: "defer", id: 5 }), { updated: [] }, "already deferred");
  assert.deepEqual(await looseThreadsUpdate({ db_path: dbPath, action: "undefer", id: 5 }), { updated: [5] });
  assert.deepEqual(await looseThreadsUpdate({ db_path: dbPath, action: "discard", ids: [2, 7] }), { updated: [2] }, "7 is already discarded");
  assert.deepEqual(await looseThreadsUpdate({ db_path: dbPath, action: "restore", id: 7 }), { updated: [7] });
  assert.equal(readThreads(dbPath).find((x) => x.id === 2).rank, 1, "a discard keeps the rank");
  assert.deepEqual(await looseThreadsUpdate({ db_path: dbPath, action: "consume", id: 7, job_id: 10 }), { updated: [7] });
  await assert.rejects(looseThreadsUpdate({ db_path: dbPath, action: "consume", id: 5, job_id: 99 }), /names no job/);
  await assert.rejects(looseThreadsUpdate({ db_path: dbPath, action: "restore", id: 99 }), /names no loose thread/);
});

test("move takes a board's open threads to a live board of their proceeding, and refuses a board with a job in progress", async (t) => {
  const { dbPath } = await matter(t, `${BASE}
    INSERT INTO filings (id, proceeding_id, kind, title, retired_on) VALUES (7, 1, 'task-board', 'Source', NULL), (8, 1, 'task-board', 'Target', NULL), (9, 1, 'task-board', 'Closed', '2026-10-01');
    INSERT INTO seeds (id, proceeding_id, filing_id, created, surfaced_by, idea, discarded_at) VALUES (3, 1, 7, '2026-10-01T10:00', 'noticed', 'Open.', NULL), (4, 1, 7, '2026-10-01T10:01', 'noticed', 'Discarded.', '2026-10-02T09:00');`);
  await moveSeedsOnce(dbPath);
  await assert.rejects(looseThreadsUpdate({ db_path: dbPath, action: "move", from_filing_id: 7, filing_id: 9 }), /no live Writing/);
  await submissionDataExecute(dbPath, "UPDATE tickets SET filing_id = 7, status = 'wip', locked_by = 's', locked_at = '2026-10-01T09:00' WHERE id = 10;");
  await assert.rejects(looseThreadsUpdate({ db_path: dbPath, action: "move", from_filing_id: 7, filing_id: 8 }), /job in progress/);
  await submissionDataExecute(dbPath, "UPDATE tickets SET filing_id = NULL, status = 'queued', locked_by = NULL, locked_at = NULL WHERE id = 10;");
  assert.deepEqual(await looseThreadsUpdate({ db_path: dbPath, action: "move", from_filing_id: 7, filing_id: 8 }), { updated: [3] });
  assert.deepEqual(readThreads(dbPath).map((x) => [x.id, x.filing_id]), [[3, 8], [4, 7]]);
});

const JOB = { proceeding_id: 1, filing_id: null, title: "From a thread", intent: "Do it.", kind: "work", priority: 0, billing_anchor: "L8470|x", steps: ["One."], guard: "none" };

test("creating a job from a thread writes the job, then consumes the thread", async (t) => {
  const { dbPath } = await matter(t);
  const made = await submissionDataCreateJob({ ...JOB, db_path: dbPath, seed_id: 2 });
  assert.equal(made.outcome, "created");
  assert.equal(made.thread_not_consumed, undefined);
  assert.equal(readThreads(dbPath).find((x) => x.id === 2).charted_into, made.ticket_id);
  await assert.rejects(submissionDataCreateJob({ ...JOB, db_path: dbPath, seed_id: 99 }), /names no loose thread; nothing was written/);
});

test("a failed consume is reported in the result, and the job stands", async (t) => {
  const { dbPath } = await matter(t);
  await moveSeedsOnce(dbPath);
  // A store that can be read and not written: the second write fails after the job's has landed.
  const store = looseThreadsPath(dbPath);
  chmodSync(store, 0o444);
  const made = await submissionDataCreateJob({ ...JOB, db_path: dbPath, seed_id: 2 });
  chmodSync(store, 0o666);
  assert.equal(made.outcome, "created");
  assert.match(made.thread_not_consumed, /^Loose thread 2 still shows as open: /);
  assert.equal(submissionDataQuery(dbPath, "SELECT COUNT(*) AS n FROM tickets WHERE id = ?", [made.ticket_id]).rows[0].n, 1, "the job stands");
  assert.equal(readThreads(dbPath).find((x) => x.id === 2).charted_into, null);
});

test("each tab's cards come from their own place, and a live letter is on none", async (t) => {
  const { dbPath, dir, draft } = await matter(t, `${BASE}${SEEDS}
    INSERT INTO filings (id, proceeding_id, kind, title, retired_on, retirement_reason, filed_on) VALUES
      (1, 1, 'notice_of_application', 'Notice of Application', NULL, NULL, NULL),
      (2, 1, 'letter-to-counsel', 'Live letter', NULL, NULL, NULL),
      (3, 1, 'letter-to-counsel', 'Abandoned letter', '2026-10-05', 'abandoned', NULL),
      (4, 1, 'letter-to-counsel', 'Delivered letter', '2026-10-06', 'delivered', NULL),
      (5, 1, 'task-board', 'Closed board', '2026-10-07', 'other', NULL),
      (6, 1, 'task-board', 'Open board', NULL, NULL, NULL);
    INSERT INTO tickets (id, proceeding_id, title, intent, status, kind, billing_anchor, created, rejected_at) VALUES (11, 1, 'Shelved job', 'Do it.', 'queued', 'work', 'L8470|x', '2026-10-01T09:00', '2026-10-08T09:00');
    INSERT INTO law_assertions (id, proceeding_id, proposition, killed_on) VALUES (1, 1, 'A killed proposition.', '2026-10-09'), (2, 1, 'An undecided proposition.', NULL);
    INSERT INTO submissions (id, proceeding_id, contention, ordinal, killed_on) VALUES (1, 1, 'A killed submission.', 1, '2026-10-10'), (2, 1, 'A live submission.', 2, NULL);`);
  mkdirSync(draft, { recursive: true });
  const law = join(dir, "L8470 Larchmont", "6. LAW", "Issue");
  mkdirSync(law, { recursive: true });
  writeFileSync(join(law, "2026-10-01 ML re stay.md"), "memo");
  await moveSeedsOnce(dbPath);
  await looseThreadsCapture({ db_path: dbPath, proceeding_id: 1, surfaced_by: "x", idea: "A proposition noted, never used.", kind: "proposition" });
  await looseThreadsCapture({ db_path: dbPath, proceeding_id: 1, surfaced_by: "x", idea: "An abandoned draft.", kind: "correspondence", ref: "draft.eml" });
  await looseThreadsCapture({ db_path: dbPath, proceeding_id: 1, surfaced_by: "x", idea: "Considered, never drafted.", kind: "argument" });
  await looseThreadsCapture({ db_path: dbPath, proceeding_id: 1, surfaced_by: "x", idea: "A board never created.", kind: "work_board" });

  const data = buildLooseIdeasData(dbPath, [1], process.env, draft);
  const cards = (tab) => data.in_place.filter((c) => c.tab === tab).map((c) => [c.record, c.title, c.status]);
  const threads = (tab) => data.ideas.filter((i) => i.tab === tab).map((i) => i.idea);
  assert.deepEqual(cards("jobs"), [["Job #11", "Shelved job", "Shelved"]]);
  assert.deepEqual(threads("ideas"), ["Ranked and open.", "Deferred."], "today's threads");
  assert.deepEqual(cards("propositions"), [["Proposition #1", "A killed proposition.", "Killed"]], "an undecided one is left on the Legal Research page");
  assert.deepEqual(threads("propositions"), ["A proposition noted, never used."]);
  assert.deepEqual(cards("memos"), [["Issue", "ML re stay", "No job"]]);
  assert.deepEqual(cards("correspondence"), [["Writing #3", "Abandoned letter", "Retired"]], "no live letter and no delivered one");
  assert.deepEqual(threads("correspondence"), ["An abandoned draft."]);
  assert.equal(data.ideas.find((i) => i.tab === "correspondence").ref, "draft.eml");
  assert.deepEqual(cards("arguments"), [["Submission #1", "A killed submission.", "Killed"]]);
  assert.deepEqual(threads("arguments"), ["Considered, never drafted."]);
  assert.deepEqual(cards("work_boards"), [["Work Board #5", "Closed board", "Closed"]]);
  assert.deepEqual(threads("work_boards"), ["A board never created."]);
  assert.doesNotMatch(JSON.stringify(data), /Live letter/, "a live unretired letter appears on no tab");
  assert.ok(data.in_place.find((c) => c.tab === "memos").url.includes("/files/open?path="), "a memo's card links its file");
});

test("a killed authority stays in the working database as a killed row, and its thread card holds no copy", async (t) => {
  const { dbPath } = await matter(t, `${BASE}
    INSERT INTO authorities (id, proceeding_id, kind, style_of_cause_or_title, citation, killed_on) VALUES (1, 1, 'case', 'Example v Sample', '2020 BCSC 1', '2026-10-09');
    INSERT INTO law_assertions (id, proceeding_id, proposition) VALUES (1, 1, 'Rests on a killed authority.');
    INSERT INTO statements_of_law (id, proceeding_id, law_assertion_id, authority_id, pinpoint, source, verification) VALUES (1, 1, 1, 1, 'para 1', 'primary', 'verified');`);
  await moveSeedsOnce(dbPath);
  assert.equal(submissionDataQuery(dbPath, "SELECT killed_on FROM authorities WHERE id = 1").rows[0].killed_on, "2026-10-09", "the row a later session reads before re-proposing it");
  const data = buildLooseIdeasData(dbPath, [1], process.env);
  assert.deepEqual(data.in_place.map((c) => [c.tab, c.record, c.title]), [["propositions", "Proposition #1", "Rests on a killed authority."]]);
  assert.deepEqual(readThreads(dbPath), [], "nothing was copied to the store");
});
