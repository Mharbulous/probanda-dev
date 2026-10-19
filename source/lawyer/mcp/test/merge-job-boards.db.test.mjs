// Merged Job Boards (docs/ADRs/0010-job-boards-organized-by-goals.md): drafting_data__merge_job_boards
// joins two boards on the practitioner's yes. The survivor is a Writing's board over a Job Board with
// no Writing over a pre-filing board, then the lower id. One page per survivor draws every section on
// it, one set of view pages spans its Writings, the absorbed pages go to TRASH, the statements of
// goals are kept side by side, and the Litigation Strategy groups the merged sections under one heading.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

process.env.COCLERK_SUBMISSION_LOCK_ROOT = mkdtempSync(join(tmpdir(), "coclerk-merge-boards-locks-"));
after(() => rmSync(process.env.COCLERK_SUBMISSION_LOCK_ROOT, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));

const { freshSubmissionDb } = await import("./helpers/template-db.mjs");
const { submissionDataExecute, submissionDataQuery } = await import("../build/submission/backend.js");
const { submissionFormsRender } = await import("../build/submission/forms.js");
const { submissionFormsBoardCard } = await import("../build/submission/matter-pages.js");
const { callTool } = await import("../build/dispatch.js");
const { awaitBackgroundJobs } = await import("../build/submission/render-job.js");
const { provableFactsData } = await import("../build/submission/forms/provable-facts-page.js");
const { buildLooseIdeasData } = await import("../build/submission/forms/loose-ideas-page.js");
const { readBoardData, jobBoardPages, ASHBOURNE } = await import("./fixtures/forms-render-seeds.mjs");

const NOW = "2026-10-19 09:00";
const TOKEN = "tok-merge";
const code = (expected, message) => (err) => err.code === expected && (message === undefined || message.test(err.message));
const query = (dbPath, sql, params = []) => submissionDataQuery(dbPath, sql, params).rows;
const metaRows = (dbPath, glob) => query(dbPath, "SELECT key, value FROM db_meta WHERE key GLOB ? ORDER BY key", [glob]);
const merge = (dbPath, boards, confirmed = true) => callTool({}, "drafting_data__merge_job_boards", { db_path: dbPath, boards, confirmed, session_token: TOKEN });
const setGoal = (dbPath, board, statement, extra = {}) =>
  callTool({}, "drafting_data__set_board_goal", { db_path: dbPath, ...board, statement, status: "inferred", session_token: TOKEN, ...extra });
const render = (m, filingId) => submissionFormsRender(m.dbPath, filingId, ASHBOURNE, "mockup", undefined, undefined, undefined, NOW, TOKEN, m.draft);

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
  const caseDataDir = join(base, "0. CASE DATA", "L9999 Test Matter");
  mkdirSync(join(matterRoot, "0. DRAFT"), { recursive: true });
  mkdirSync(caseDataDir, { recursive: true });
  writeFileSync(join(matterRoot, "coclerk.json"), JSON.stringify({ schema_version: 5, matter_root: matterRoot, case_data_dir: caseDataDir, evidence_sql_path: "x.sql" }), "utf-8");
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
  return m;
}

test("the merge keeps the lower-id Writing's board, writes one membership row and keeps both statements of goals", async (t) => {
  const m = await fixture(t);
  await setGoal(m.dbPath, { filing_id: 1 }, "Goal: obtain the award.");
  await setGoal(m.dbPath, { filing_id: 3 }, "Goal: defeat the counterclaim.");

  const result = await merge(m.dbPath, [{ filing_id: 3 }, { filing_id: 1 }]);

  assert.deepEqual(result.survivor, { filing_id: 1, proceeding_id: 1 });
  assert.deepEqual(result.absorbed, { filing_id: 3, proceeding_id: 2 });
  assert.equal(result.goals, 2);
  assert.deepEqual(metaRows(m.dbPath, "board_member:*"), [{ key: "board_member:filing:3", value: JSON.stringify({ filing_id: 1, proceeding_id: 1 }) }]);
  assert.deepEqual(metaRows(m.dbPath, "board_goal:*").map((r) => r.key), ["board_goal:filing:1"], "the absorbed board's row moved into the survivor's");
  const stored = JSON.parse(metaRows(m.dbPath, "board_goal:*")[0].value);
  assert.equal(stored.statement, "Goal: obtain the award.");
  assert.deepEqual(stored.merged.map((g) => [g.from, g.statement, g.status]), [["board_goal:filing:3", "Goal: defeat the counterclaim.", "inferred"]]);
  assert.equal(query(m.dbPath, "SELECT COUNT(*) AS n FROM tickets WHERE filing_id = 3")[0].n, 1, "no job is rewritten");

  // Either section reads the board's goals.
  for (const filingId of [1, 3]) {
    const { card } = submissionFormsBoardCard({ db_path: m.dbPath, filing_id: filingId, lanes: ["goals"] }, ASHBOURNE, NOW);
    assert.match(card, /## Goal \(inferred\)\n[^\n]*\nGoal: obtain the award\.\n### Merged 1 \(inferred\)\nGoal: defeat the counterclaim\./, `filing ${filingId}`);
  }
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
  await assert.rejects(merge(m.dbPath, [{ filing_id: 2 }, { filing_id: 3 }]), code("board_merged", /Job Board 3 is already merged into Job Board 1/));
  await assert.rejects(merge(m.dbPath, [{ filing_id: 1 }, { filing_id: 3 }]), code("board_merged"));
  await submissionDataExecute(m.dbPath, "UPDATE filings SET retired_on = '2026-10-19', retirement_reason = 'abandoned' WHERE id = 2;");
  await assert.rejects(merge(m.dbPath, [{ filing_id: 1 }, { filing_id: 2 }]), code("board_retired"));
});

test("a Writing's board survives a Job Board with no Writing of lower id, and a pre-filing board; a board's absorbed boards follow it", async (t) => {
  const m = await fixture(t);
  await submissionDataExecute(
    m.dbPath,
    `INSERT INTO filings (id, proceeding_id, kind, title, needs_forum_parts) VALUES (4, 1, 'task-board', 'Paper originals', 0);
     INSERT INTO filings (id, proceeding_id, kind, round, title) VALUES (5, 2, 'submissions_package', 'reply', 'Counterclaim Reply');`
  );
  // The Job Board with no Writing absorbs the pre-filing board, then Writing 5's board, of higher id, absorbs both.
  assert.deepEqual((await merge(m.dbPath, [{ proceeding_id: 3 }, { filing_id: 4 }])).survivor, { filing_id: 4, proceeding_id: 1 });
  assert.deepEqual((await merge(m.dbPath, [{ filing_id: 4 }, { filing_id: 5 }])).survivor, { filing_id: 5, proceeding_id: 2 });
  assert.deepEqual(
    metaRows(m.dbPath, "board_member:*").map((r) => [r.key, JSON.parse(r.value).filing_id]),
    [["board_member:filing:4", 5], ["board_member:proceeding:3", 5]]
  );
});

test("one page draws every section on the board, each job once, with one set of view pages; the absorbed pages go to TRASH", async (t) => {
  const m = await fixture(t);
  render(m, 1);
  assert.deepEqual(jobBoardPages(m.draft), ["Job Board - proceeding 3.html", "Job Board 1.html", "Job Board 2.html", "Job Board 3.html"]);

  await merge(m.dbPath, [{ filing_id: 1 }, { filing_id: 3 }]);
  const result = render(m, 3);

  assert.deepEqual(jobBoardPages(m.draft), ["Job Board - proceeding 3.html", "Job Board 1.html", "Job Board 2.html"]);
  const moved = result.moved_to_trash.map((x) => x.from.toLowerCase()).sort();
  assert.deepEqual(moved, ["Arguments", "Job Board 3", "Loose Threads", "Provable Facts", "Raw Research"].map((n) => join(m.draft, n === "Job Board 3" ? "Job Board 3.html" : `${n} - Job Board 3.html`).toLowerCase()).sort());
  const board = result.documents.find((d) => d.document_type === "Work_board");
  assert.equal(board.path, join(m.draft, "Job Board 1.html"), "the absorbed Writing's render returns its survivor's page");

  const page = readBoardData(join(m.draft, "Job Board 1.html"));
  assert.deepEqual(page.board, { filing_id: 1, proceeding_id: 1 });
  assert.deepEqual(page.sections.map((s) => s.meta.filing_id), [1, 3], "the survivor's section first");
  assert.deepEqual(page.sections.map((s) => s.tickets.map((x) => x.id)), [[1, 3], [2]], "each job once");
  assert.deepEqual(page.views.map((v) => v.file), ["Provable Facts", "Raw Research", "Arguments", "Loose Threads"].map((n) => `${n} - Job Board 1.html`));
  assert.equal(readBoardData(join(m.draft, "Job Board 2.html")).board, undefined, "an unmerged page carries no board key");

  const views = result.view_page_paths.filter((v) => v.path.includes("Job Board 1.html"));
  assert.deepEqual([...new Set(views.map((v) => v.filing_id))].sort(), [1, 3], "each Writing on the board points at the board's view pages");
  assert.ok(readdirSync(m.draft).every((n) => !/- Job Board 3\.html$/.test(n)));
});

test("a survivor that is retired keeps its page's id while an absorbed Writing is live", async (t) => {
  const m = await fixture(t);
  await merge(m.dbPath, [{ filing_id: 1 }, { filing_id: 3 }]);
  await submissionDataExecute(m.dbPath, "UPDATE filings SET retired_on = '2026-10-19', retirement_reason = 'abandoned' WHERE id = 1;");

  render(m, 3);

  const page = readBoardData(join(m.draft, "Job Board 1.html"));
  assert.deepEqual(page.board, { filing_id: 1, proceeding_id: 1 }, "the page is named by its retired survivor");
  assert.deepEqual(page.sections.map((s) => s.meta.filing_id), [3]);
  assert.ok(readdirSync(m.draft).includes("Provable Facts - Job Board 1.html"));
});

test("a merged pre-filing board's first Writing joins the survivor, and later Writings get their own boards", async (t) => {
  const m = await fixture(t);
  await merge(m.dbPath, [{ proceeding_id: 3 }, { filing_id: 2 }]);
  render(m, 2);
  assert.deepEqual(readBoardData(join(m.draft, "Job Board 2.html")).sections.map((s) => [s.meta.filing_id, s.meta.proceeding_id]), [[2, 1], [null, 3]]);

  await submissionDataExecute(
    m.dbPath,
    `UPDATE proceedings SET forum = 'CAN/BC/Vancouver-International-Arbitration-Centre' WHERE id = 3;
     INSERT INTO filings (id, proceeding_id, kind, round, title) VALUES (6, 3, 'submissions_package', 'opening', 'Third Opening'),
                                                                        (7, 3, 'submissions_package', 'reply', 'Third Reply');`
  );
  render(m, 2);
  assert.deepEqual(readBoardData(join(m.draft, "Job Board 2.html")).sections.map((s) => s.meta.filing_id), [2, 6]);
  assert.ok(jobBoardPages(m.draft).includes("Job Board 7.html"));
  assert.equal(jobBoardPages(m.draft).includes("Job Board 6.html"), false);
});

test("two pre-filing boards merge onto the lower proceeding's page", async (t) => {
  const m = await fixture(t);
  await submissionDataExecute(m.dbPath, "INSERT INTO proceedings (id, matter_reference, forum) VALUES (4, 'L9999 - Test', NULL);");
  assert.deepEqual((await merge(m.dbPath, [{ proceeding_id: 4 }, { proceeding_id: 3 }])).survivor, { filing_id: null, proceeding_id: 3 });
  render(m, 1);
  assert.deepEqual(readBoardData(join(m.draft, "Job Board - proceeding 3.html")).sections.map((s) => s.meta.proceeding_id), [3, 4]);
  assert.equal(jobBoardPages(m.draft).includes("Job Board - proceeding 4.html"), false);
});

test("set_board_goal refuses an absorbed board, writes a merged statement by index and keeps the merged ones on an own write", async (t) => {
  const m = await fixture(t);
  await setGoal(m.dbPath, { filing_id: 3 }, "Goal: defeat the counterclaim.");
  await merge(m.dbPath, [{ filing_id: 1 }, { filing_id: 3 }]);

  await assert.rejects(setGoal(m.dbPath, { filing_id: 3 }, "Goal: anything."), code("board_merged", /merged into Job Board 1/));
  await assert.rejects(setGoal(m.dbPath, { filing_id: 1 }, "Goal: x.", { merged_index: 2 }), code("invalid_merged_index"));

  const written = await setGoal(m.dbPath, { filing_id: 1 }, "Goal: defeat the counterclaim in full.", { merged_index: 1 });
  assert.equal(written.statement, "Goal: defeat the counterclaim in full.");
  await setGoal(m.dbPath, { filing_id: 1 }, "Goal: obtain the award.");
  const stored = JSON.parse(metaRows(m.dbPath, "board_goal:*")[0].value);
  assert.equal(stored.statement, "Goal: obtain the award.");
  assert.deepEqual(stored.merged.map((g) => [g.from, g.statement]), [["board_goal:filing:3", "Goal: defeat the counterclaim in full."]]);
});

test("the merged view pages read every Writing: Provable Facts Writing by Writing, each fact once; loose threads per proceeding", async (t) => {
  const m = await fixture(t);
  const filings = query(m.dbPath, "SELECT * FROM filings ORDER BY id");
  const proceedings = query(m.dbPath, "SELECT * FROM proceedings ORDER BY id");
  const w = (id) => ({ filing: filings.find((f) => f.id === id), proceeding: proceedings.find((p) => p.id === filings.find((f) => f.id === id).proceeding_id) });

  const facts = provableFactsData({ dbPath: m.dbPath, ...w(1), writings: [w(1), w(2)], now: NOW, revision: 1 }).facts;
  assert.deepEqual(facts.map((f) => [f.position, f.text]), [[1, "The order was served."], [2, "The respondent did not appear."]]);

  const ideas = buildLooseIdeasData(m.dbPath, [filings[0], filings[2]], { ...process.env });
  assert.deepEqual(ideas.ideas.map((i) => [i.id, i.proceeding_id]), [[1, 1], [2, 2]]);
  assert.deepEqual(Object.keys(ideas.api.tokens), ["1", "2"]);
  assert.equal(ideas.ideas[1].origin, null, "a thread captured on one of the board's Writings names no other filing");
});

test("the Litigation Strategy draws a merged board as one heading over its sections", async (t) => {
  const m = await fixture(t);
  await merge(m.dbPath, [{ filing_id: 1 }, { filing_id: 3 }]);
  render(m, 1);
  const data = matterBoard(join(m.draft, "Litigation Strategy.html"));
  assert.deepEqual(data.boards, [{ name: "Job Board 1", filing_ids: [1, 3], proceeding_ids: [] }]);
  assert.ok(readFileSync(join(m.draft, "Litigation Strategy.html"), "utf-8").includes('"Merged Job Boards"'));
});
