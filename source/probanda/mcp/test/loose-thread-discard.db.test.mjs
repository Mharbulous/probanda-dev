// A loose thread that left the board without being outlined (schema v75): seeds.discarded_at and
// seeds.suggested_at. A discarded or suggested thread is not open, so it is out of fetchOpenSeeds,
// the Defer write and the latest-activity read, and is listed by fetchDiscardedSeeds, which the Job
// Board draws: a discarded thread as a struck line with a Restore link, a suggested one as a plain
// line, neither in the Loose Threads count. A database held at v74 has neither column and still
// reads and draws, with none of either.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";

const { freshSubmissionDb, submissionDbAt } = await import("./helpers/template-db.mjs");
const { sectionOf } = await import("./fixtures/forms-render-seeds.mjs");
const { submissionDataExecute, submissionDataQuery } = await import("../build/submission/backend.js");
const { submissionFormsRender } = await import("../build/submission/forms.js");
const { fetchLatestActivity, fetchProceeding, liveSeedClause, seedClosedColumns } = await import("../build/submission/forms/query.js");
const { buildPreFilingBoardData, fetchDiscardedSeeds, fetchOpenSeeds, fetchResolvedSeeds, openSeedCondition } = await import("../build/submission/forms/render-work-board.js");
const { setSeedDeferral } = await import("../build/submission/forms/seed-deferral.js");
const { buildLooseIdeasData, LOOSE_IDEAS_PAGE } = await import("../build/submission/forms/loose-ideas-page.js");
const { renderWorkBoardHtml } = await import("../build/submission/forms/workboard-shell.js");
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
  const dbPath = join(dir, "submission.sqlite");
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

/** Runs a Job Board page's drawing script against stand-in elements and returns its main element. */
function drawBoard(html) {
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
      return child;
    }
    setAttribute(key, value) {
      this.attrs[key] = String(value);
    }
    addEventListener() {}
    all() {
      return this.children.flatMap((c) => [c, ...c.all()]);
    }
    querySelector(selector) {
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
  const line = html.split("\n").find((l) => l.startsWith("window.WORKBOARD = "));
  const script = html.split("<script>")[2].split("</script>")[0];
  runInNewContext(script, { window: { WORKBOARD: JSON.parse(line.slice("window.WORKBOARD = ".length, -1)) }, document });
  return main;
}

/** The Loose Threads section a drawn board holds: its count and each child of its stack. */
function threadsSection(main) {
  const section = main.all().find((n) => n.tag === "section" && n.id === "ideas");
  assert.ok(section, "expected a Loose Threads section");
  const stack = section.children.find((n) => n.className === "stack");
  return {
    count: section.querySelector(".count").textContent,
    lines: (stack?.children ?? []).map((n) => [n.tag, n.className, n.textContent]),
    cue: section.children.find((n) => n.className === "cue")?.textContent ?? null,
    empty: section.children.find((n) => n.className === "empty")?.textContent ?? null,
  };
}

const pageOf = (section) => ({ meta: { revision: 1, matter: "L8470", client: "Larchmont", rendered: section.meta.rendered }, sections: [section] });

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

test("fetchOpenSeeds hides a discarded and a suggested thread, and fetchDiscardedSeeds returns them", async (t) => {
  const { dbPath } = await current(t);
  assert.deepEqual(fetchOpenSeeds(dbPath, 1).map((s) => s.id), [1], "the discarded, the suggested and the outlined thread are not open");
  assert.deepEqual(fetchDiscardedSeeds(dbPath, 1), [
    { id: 2, idea: "A discarded thread.", filing_id: null, discarded_at: "2026-10-12T09:00", suggested_at: null },
    { id: 3, idea: "A suggested thread.", filing_id: null, discarded_at: null, suggested_at: "2026-10-13T09:00" },
  ]);
  assert.deepEqual(fetchDiscardedSeeds(dbPath, 2).map((s) => s.id), [5], "each proceeding's own");
  assert.deepEqual(fetchOpenSeeds(dbPath, 2), []);
});

test("restoring a discarded thread opens it again, and it leaves fetchDiscardedSeeds", async (t) => {
  const { dbPath } = await current(t);
  await submissionDataExecute(dbPath, "UPDATE seeds SET discarded_at = NULL WHERE id = 2 AND discarded_at IS NOT NULL;");
  assert.deepEqual(fetchOpenSeeds(dbPath, 1).map((s) => s.id), [1, 2]);
  assert.deepEqual(fetchDiscardedSeeds(dbPath, 1).map((s) => s.id), [3]);
});

test("a thread outlined into a deleted job and then discarded stays off the board", async (t) => {
  const { dbPath } = await current(t);
  await submissionDataExecute(dbPath, "UPDATE tickets SET deleted_at = '2026-10-10T09:00' WHERE id = 10;");
  assert.deepEqual(fetchOpenSeeds(dbPath, 1).map((s) => s.id), [1, 4], "outlined into a deleted job, thread 4 is open again");
  await submissionDataExecute(dbPath, "UPDATE seeds SET discarded_at = '2026-10-13T10:00' WHERE id = 4;");
  assert.deepEqual(fetchOpenSeeds(dbPath, 1).map((s) => s.id), [1]);
  assert.deepEqual(fetchDiscardedSeeds(dbPath, 1).map((s) => s.id), [2, 3, 4]);
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

test("a pre-filing board carries the discarded and suggested threads, in no count and in no summary", async (t) => {
  const { dbPath } = await current(t);
  const data = buildPreFilingBoardData(dbPath, fetchProceeding(dbPath, 1), META);
  assert.deepEqual(data.seeds.map((s) => s.id), [1]);
  assert.deepEqual(data.discardedSeeds, [
    { id: 2, idea: "A discarded thread.", discarded_at: "2026-10-12T09:00", suggested_at: null },
    { id: 3, idea: "A suggested thread.", discarded_at: null, suggested_at: "2026-10-13T09:00" },
  ]);

  const lanes = renderLiveLanes(data);
  assert.ok(lanes.includes("## Loose Threads (1)"), lanes.join("\n"));
  for (const text of [lanes.join("\n"), renderBoardSummary(data, CLIENT, TODOS_NOT_READ)]) {
    assert.equal(text.includes("A discarded thread."), false);
    assert.equal(text.includes("A suggested thread."), false);
  }

  // The page lists a pre-filing board's threads: the open one's card, then the two lines.
  const drawn = threadsSection(drawBoard(renderWorkBoardHtml(pageOf(data))));
  assert.equal(drawn.count, "1", "the count is the open threads'");
  assert.deepEqual(drawn.lines.slice(1), [
    ["p", "deleted", "Loose thread 2:  A discarded thread. *DISCARDED* Restore"],
    ["p", "suggested", "Loose thread 3:  A suggested thread. *SUGGESTED*"],
  ]);
  assert.equal(drawn.lines[0][1].split(" ").includes("seed"), true, "the open thread is a card");
});

test("the board draws a discarded thread struck with a Restore link, and a suggested one plain with none", async (t) => {
  const { dbPath } = await current(t);
  const data = buildPreFilingBoardData(dbPath, fetchProceeding(dbPath, 1), META);
  const main = drawBoard(renderWorkBoardHtml(pageOf(data)));
  const discarded = main.all().find((n) => n.className === "deleted");
  assert.deepEqual(discarded.children.map((n) => [n.tag, n.textContent]), [["s", "Loose thread 2:  A discarded thread."], ["#text", " *DISCARDED* "], ["a", "Restore"]]);
  assert.equal(discarded.children[2].href, "#", "the link navigates nowhere: it only copies the instruction");
  const suggested = main.all().find((n) => n.className === "suggested");
  assert.deepEqual(suggested.children, [], "no strike and no link");
  assert.equal(renderWorkBoardHtml(pageOf(data)).includes('"restore loose thread #"'), true, "the instruction a Restore link copies");
});

test("a pre-filing board with only discarded threads lists them under a count of 0", async (t) => {
  const { dbPath } = await current(t);
  await submissionDataExecute(dbPath, "UPDATE seeds SET discarded_at = '2026-10-13T10:00' WHERE id = 1;");
  const drawn = threadsSection(drawBoard(renderWorkBoardHtml(pageOf(buildPreFilingBoardData(dbPath, fetchProceeding(dbPath, 1), META)))));
  assert.equal(drawn.count, "0");
  assert.deepEqual(drawn.lines.map((l) => l[1]), ["deleted", "deleted", "suggested"]);
  assert.equal(drawn.empty, null);
});

test("a filing's board carries them and points at the Loose Threads page, even with no open thread", async (t) => {
  const { dir, dbPath } = await current(t);
  await submissionDataExecute(
    dbPath,
    `UPDATE proceedings SET forum = 'CAN/BC/BCSC', file_number = 'S-770011' WHERE id = 1;
     INSERT INTO filings (id, proceeding_id, kind, title) VALUES (1, 1, 'notice_of_application', 'Notice of Application');
     UPDATE seeds SET discarded_at = '2026-10-13T10:00' WHERE id = 1;`
  );
  const draft = join(dir, "L8470 Larchmont", "0. DRAFT");
  mkdirSync(draft, { recursive: true });
  const result = submissionFormsRender(dbPath, 1, CLIENT, "mockup", undefined, undefined, undefined, undefined, undefined, draft);
  const section = sectionOf(draft, 1);
  assert.deepEqual(section.seeds, []);
  assert.deepEqual(section.discardedSeeds.map((s) => [s.id, s.discarded_at !== null]), [[1, true], [2, true], [3, false]]);
  assert.equal(Object.keys(section.discardedSeeds[0]).join(), "id,idea,discarded_at,suggested_at", "no filing id on the page");

  // A filing's threads are on its Loose Threads page: the board counts the open ones and points there.
  const board = result.documents.find((d) => d.document_type === "Work_board");
  const drawn = threadsSection(drawBoard(readFileSync(board.path, "utf-8")));
  assert.equal(drawn.count, "0", "the count is the open threads'");
  assert.deepEqual(drawn.lines.map((l) => l[2]), ["To see them, ask a session to show the Loose Threads page."], "the pointer, and no thread drawn");
  assert.equal(drawn.empty, null, "not the empty line: the page has discarded threads to show");
});

test("the Loose Threads page lists a discarded, a suggested and an outlined thread as resolved, newest first", async (t) => {
  const { dbPath } = await current(t);
  const data = buildLooseIdeasData(dbPath, { id: 1, proceeding_id: 1 }, process.env);
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
  assert.deepEqual(page.extra, [["Threads", "1"], ["Ranked", "0"], ["Unranked", "1"], ["Resolved", "3"]], "the header counts the open threads apart from the resolved");
});

test("a database held at v74 has neither column and still reads, defers and draws", async (t) => {
  const { dbPath } = await heldAt74(t);
  assert.deepEqual(seedClosedColumns(dbPath), []);
  assert.equal(liveSeedClause(dbPath), "");
  assert.deepEqual(openSeedCondition(dbPath, new Set()), { sql: "(charted_into IS NULL)", params: [] });
  assert.deepEqual(fetchOpenSeeds(dbPath, 1).map((s) => s.id), [1, 2, 3], "every thread not outlined is open");
  assert.deepEqual(fetchDiscardedSeeds(dbPath, 1), []);
  assert.deepEqual(fetchResolvedSeeds(dbPath, 1).map((r) => [r.id, r.how]), [[4, "job"]], "it lists its outlined threads");
  assert.deepEqual(fetchLatestActivity(dbPath, 1), [{ filing_id: null, latest: "2026-10-01T10:02" }]);

  assert.equal((await setSeedDeferral({ db_path: dbPath, proceeding_id: 1, seed_id: 2, action: "defer" })).outcome, "deferred");
  assert.equal((await setSeedDeferral({ db_path: dbPath, proceeding_id: 1, seed_id: 4, action: "defer" })).outcome, "not_open", "outlined into a live job");

  const data = buildPreFilingBoardData(dbPath, fetchProceeding(dbPath, 1), META);
  assert.deepEqual(data.discardedSeeds, []);
  const drawn = threadsSection(drawBoard(renderWorkBoardHtml(pageOf(data))));
  assert.equal(drawn.count, "3");
  assert.equal(drawn.lines.length, 3, "three cards and no line");

  const ideas = buildLooseIdeasData(dbPath, { id: 1, proceeding_id: 1 }, process.env);
  assert.deepEqual(ideas.ideas.map((i) => i.id), [1, 2, 3]);
  assert.deepEqual(ideas.resolved.map((r) => r.id), [4]);
});
