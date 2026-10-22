// Merged Job Boards (docs/ADRs/0010-job-boards-organized-by-goals.md): drafting_data__merge_job_boards
// joins two boards on the practitioner's yes. The survivor is a Writing's board over a Job Board with
// no Writing over a pre-filing board, then the lower id. One page per survivor draws every board on
// it as one board, one set of view pages spans its Writings, the absorbed pages go to TRASH, the statements of
// goals are kept side by side, and the Litigation Strategy groups the merged sections under one heading.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import test, { after } from "node:test";

process.env.COCLERK_SUBMISSION_LOCK_ROOT = mkdtempSync(join(tmpdir(), "coclerk-merge-boards-locks-"));
after(() => rmSync(process.env.COCLERK_SUBMISSION_LOCK_ROOT, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));

const { freshSubmissionDb } = await import("./helpers/template-db.mjs");
const { submissionDataExecute, submissionDataQuery } = await import("../build/submission/backend.js");
const { submissionFormsRender } = await import("../build/submission/forms.js");
const { submissionFormsBoardCard } = await import("../build/submission/matter-pages.js");
const { callTool } = await import("../build/dispatch.js");
const { awaitBackgroundJobs } = await import("../build/submission/render-job.js");
const { materialFactsData, proceduralHistoryData } = await import("../build/submission/forms/facts-pages.js");
const { buildLooseIdeasData } = await import("../build/submission/forms/loose-ideas-page.js");
const { readBoardData, jobBoardPages, ASHBOURNE } = await import("./fixtures/forms-render-seeds.mjs");
const { combineSections } = await import("../build/submission/forms/combined-board.js");

const NOW = "2026-10-19 09:00";
const TOKEN = "tok-merge";
const code = (expected, message) => (err) => err.code === expected && (message === undefined || message.test(err.message));
const query = (dbPath, sql, params = []) => submissionDataQuery(dbPath, sql, params).rows;
const metaRows = (dbPath, glob) => query(dbPath, "SELECT key, value FROM db_meta WHERE key GLOB ? ORDER BY key", [glob]);
const merge = (dbPath, boards, confirmed = true) => callTool({}, "drafting_data__merge_job_boards", { db_path: dbPath, boards, confirmed, session_token: TOKEN });
const setGoal = (dbPath, board, statement, extra = {}) =>
  callTool({}, "drafting_data__set_board_goal", { db_path: dbPath, ...board, statement, status: "inferred", session_token: TOKEN, ...extra });
const render = (m, filingId) => submissionFormsRender(m.dbPath, filingId, ASHBOURNE, "mockup", undefined, undefined, undefined, NOW, TOKEN, m.draft);

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

  // The survivor's card reads the board's goals.
  const { card } = submissionFormsBoardCard({ db_path: m.dbPath, filing_id: 1, lanes: ["goals"] }, ASHBOURNE, NOW);
  assert.match(card, /## Goal \(inferred\)\n[^\n]*\nGoal: obtain the award\.\n### Merged 1 \(inferred\)\nGoal: defeat the counterclaim\./);
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

test("one page draws the merged boards as one board, each job once, with one set of view pages; the absorbed pages go to TRASH", async (t) => {
  const m = await fixture(t);
  render(m, 1);
  assert.deepEqual(jobBoardPages(m.draft), ["Job Board - proceeding 3.html", "Job Board 1.html", "Job Board 2.html", "Job Board 3.html"]);
  const rowsOf = () => ["tickets", "seeds", "board_attachments"].map((table) => JSON.stringify(query(m.dbPath, `SELECT * FROM ${table} ORDER BY id`)));
  const rowsBefore = rowsOf();

  await merge(m.dbPath, [{ filing_id: 1 }, { filing_id: 3 }]);
  const result = render(m, 3);

  assert.deepEqual(rowsOf(), rowsBefore, "no merge or render writes a job, loose thread or attachment row");
  assert.deepEqual(jobBoardPages(m.draft), ["Job Board - proceeding 3.html", "Job Board 1.html", "Job Board 2.html"]);
  assert.ok(result.view_page_paths.every((p) => !p.path.includes("Job Board 3")), "no view page path names the absorbed board");
  const moved = result.moved_to_trash.map((x) => x.from.toLowerCase()).sort();
  assert.deepEqual(moved, ["Arguments", "Job Board 3", "Loose Threads", "Material Facts", "Procedural History", "Raw Research"].map((n) => join(m.draft, n === "Job Board 3" ? "Job Board 3.html" : `${n} - Job Board 3.html`).toLowerCase()).sort());
  const board = result.documents.find((d) => d.document_type === "Work_board");
  assert.equal(board.path, join(m.draft, "Job Board 1.html"), "the absorbed Writing's render returns its survivor's page");

  const page = readBoardData(join(m.draft, "Job Board 1.html"));
  assert.deepEqual(page.board, { filing_id: 1, proceeding_id: 1 });
  assert.equal(page.sections.length, 1, "one board, not a section per merged board");
  assert.deepEqual(members(page).map((w) => w.filing_id), [1, 3], "the survivor's Writing first");
  assert.deepEqual(
    page.sections[0].tickets.map((x) => [x.id, x.writing]),
    [[1, "Opening Submissions Package"], [3, "Proceeding 1"], [2, "Counterclaim Submissions"]],
    "each job once, tagged with its Writing"
  );
  assert.deepEqual(page.views.map((v) => v.file), ["Procedural History", "Material Facts", "Raw Research", "Arguments", "Loose Threads"].map((n) => `${n} - Job Board 1.html`));
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
  assert.ok(readdirSync(m.draft).includes("Material Facts - Job Board 1.html"));
  const { card } = submissionFormsBoardCard({ db_path: m.dbPath, filing_id: 3, jobs: [2] }, ASHBOURNE, NOW);
  assert.match(card, /^- Job #2 /, "with its survivor retired, the absorbed board's card still reads the board");
});

test("a merged pre-filing board's first Writing joins the survivor, and later Writings get their own boards", async (t) => {
  const m = await fixture(t);
  await merge(m.dbPath, [{ proceeding_id: 3 }, { filing_id: 2 }]);
  render(m, 2);
  assert.deepEqual(members(readBoardData(join(m.draft, "Job Board 2.html"))).map((w) => [w.filing_id, w.proceeding_id]), [[2, 1], [null, 3]]);

  await submissionDataExecute(
    m.dbPath,
    `UPDATE proceedings SET forum = 'CAN/BC/Vancouver-International-Arbitration-Centre' WHERE id = 3;
     INSERT INTO filings (id, proceeding_id, kind, round, title) VALUES (6, 3, 'submissions_package', 'opening', 'Third Opening'),
                                                                        (7, 3, 'submissions_package', 'reply', 'Third Reply');`
  );
  render(m, 2);
  assert.deepEqual(members(readBoardData(join(m.draft, "Job Board 2.html"))).map((w) => w.filing_id), [2, 6]);
  assert.ok(jobBoardPages(m.draft).includes("Job Board 7.html"));
  assert.equal(jobBoardPages(m.draft).includes("Job Board 6.html"), false);
});

test("two pre-filing boards merge onto the lower proceeding's page", async (t) => {
  const m = await fixture(t);
  await submissionDataExecute(m.dbPath, "INSERT INTO proceedings (id, matter_reference, forum) VALUES (4, 'L9999 - Test', NULL);");
  assert.deepEqual((await merge(m.dbPath, [{ proceeding_id: 4 }, { proceeding_id: 3 }])).survivor, { filing_id: null, proceeding_id: 3 });
  render(m, 1);
  assert.deepEqual(members(readBoardData(join(m.draft, "Job Board - proceeding 3.html"))).map((w) => w.proceeding_id), [3, 4]);
  assert.equal(jobBoardPages(m.draft).includes("Job Board - proceeding 4.html"), false);
  const card = (proceedingId) => submissionFormsBoardCard({ db_path: m.dbPath, proceeding_id: proceedingId, lanes: ["live"] }, ASHBOURNE, NOW).card;
  assert.throws(() => card(4), code("board_merged", /proceeding 4's board is merged into proceeding 3's board; read the card by proceeding_id 3/));
  assert.match(card(3), /Job #4 /);
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

test("the merged view pages read every Writing: Material Facts and Procedural History Writing by Writing, each fact once; loose threads per proceeding", async (t) => {
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

// docs/ADRs/0010, 2026-10-21 amendment: a merged board is one board, not a section per merged board.

/** Runs the Job Board page's drawing script against stand-in elements and returns every node drawn. */
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
    discardedSeeds: [],
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

test("a merged page draws one board: one Criteria card, one panel per lane, no per-Writing heading, no repeated id", async (t) => {
  const m = await fixture(t);
  await merge(m.dbPath, [{ filing_id: 1 }, { filing_id: 3 }]);
  render(m, 1);
  const nodes = drawPage(join(m.draft, "Job Board 1.html"));
  const ids = nodes.map((n) => n.id).filter((id) => id !== "");
  assert.deepEqual(ids.filter((id, i) => ids.indexOf(id) !== i), [], "no element id repeats");
  for (const id of ["goals", "ready", "in-progress", "completed", "ideas"]) assert.equal(ids.filter((x) => x === id).length, 1, id);
  assert.equal(nodes.filter((n) => n.tag === "ol" && n.className === "writings").length, 1, "one thumbnail row");
  assert.equal(nodes.filter((n) => n.tag === "h2" && n.className === "writing-title").length, 0, "no per-Writing heading");
  assert.ok(nodes.find((n) => n.id === "ticket-2").textContent.includes("Counterclaim Submissions"), "a job card names its Writing");
});

test("board_card reads the merged board by its survivor and refuses the absorbed board; board_summary reads it by either Writing", async (t) => {
  const m = await fixture(t);
  await merge(m.dbPath, [{ filing_id: 1 }, { filing_id: 3 }]);
  const card = (filingId) => submissionFormsBoardCard({ db_path: m.dbPath, filing_id: filingId, lanes: ["live", "criteria"] }, ASHBOURNE, NOW).card;
  assert.throws(() => card(3), code("board_merged", /Job Board 3 is merged into Job Board 1; read the card by filing_id 1/));
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
  for (const file of ["Job Board 1.html", "Job Board 3.html"]) {
    const page = readBoardData(join(m.draft, file));
    assert.equal(page.sections.length, 1);
    assert.equal(page.sections[0].meta.writing_states, undefined, file);
    assert.ok(page.sections[0].tickets.every((x) => !("writing" in x)), file);
  }
});
