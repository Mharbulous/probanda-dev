// The Milestone's thumbnails, most recently viewed first (forms/board-viewed.ts): drafting_data__record_viewed
// records the pages a session presented, one db_meta row per board, and the next page write draws the
// viewed thumbnails first and a view page's tile dashed only while it has never been viewed. The write
// moves no revision and touches no job, page or state file.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import test, { after } from "node:test";

process.env.COCLERK_SUBMISSION_LOCK_ROOT = mkdtempSync(join(tmpdir(), "coclerk-board-viewed-locks-"));
after(() => rmSync(process.env.COCLERK_SUBMISSION_LOCK_ROOT, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));

const { freshSubmissionDb } = await import("./helpers/template-db.mjs");
const { submissionDataExecute, submissionDataQuery } = await import("../build/submission/backend.js");
const { submissionFormsRender } = await import("../build/submission/forms.js");
const { PAGES_STATE_FILE } = await import("../build/submission/matter-pages.js");
const { RECORDS_FOLDER } = await import("../build/submission/render-manifest.js");
const { VIEW_PAGES } = await import("../build/submission/view-pages.js");
const { callTool } = await import("../build/dispatch.js");
const { awaitBackgroundJobs } = await import("../build/submission/render-job.js");
const { readBoardData, ASHBOURNE } = await import("./fixtures/forms-render-seeds.mjs");

const NOW = "2026-10-22 09:00";
const TOKEN = "tok-viewed";
const REGISTRY = VIEW_PAGES.map((p) => p.name);
const code = (expected) => (err) => err.code === expected;
const query = (dbPath, sql, params = []) => submissionDataQuery(dbPath, sql, params).rows;
const viewedRows = (dbPath) => query(dbPath, "SELECT key, value FROM db_meta WHERE key GLOB 'board_viewed:*' ORDER BY key");
const recordViewed = (dbPath, paths) => callTool({}, "drafting_data__record_viewed", { db_path: dbPath, paths });
const render = (m, filingId) => submissionFormsRender(m.dbPath, filingId, ASHBOURNE, "mockup", undefined, undefined, undefined, NOW, TOKEN, m.draft);
const workBoard = (result) => result.documents.find((d) => d.document_type === "practice_board");
const viewPath = (result, name, filingId) => result.view_page_paths.find((v) => v.name === name && v.filing_id === filingId).path;
const docPaths = (result) => result.documents.filter((d) => d.document_type !== "practice_board" && d.path !== undefined).map((d) => d.path);

// Proceeding 1 (VanIAC): Writing 1. Proceeding 2 (VanIAC): Writing 2. Each is its own board.
async function fixture(t) {
  const base = mkdtempSync(join(tmpdir(), "coclerk-board-viewed-"));
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
                                                                 (2, 'L9999 - Test', 'CAN/BC/Vancouver-International-Arbitration-Centre');
     INSERT INTO filings (id, proceeding_id, kind, round, title) VALUES (1, 1, 'submissions_package', 'opening', 'Opening Submissions Package'),
                                                                        (2, 2, 'submissions_package', 'opening', 'Counterclaim Submissions');
     INSERT INTO tickets (id, proceeding_id, filing_id, title, intent, status, priority, kind, billing_anchor, created)
       VALUES (1, 1, 1, 'Settle the opening', 'Settle it.', 'queued', 0, 'work', 'L9999', '2026-10-22 08:00');`
  );
  return m;
}

/** A Writing's Milestone page, in its own folder (spec 2026-10-22 §9). */
const page1 = (m) => join(m.draft, "Opening Submissions Package", "Milestone.html");
const page2 = (m) => join(m.draft, "Counterclaim Submissions", "Milestone.html");

/** The strip as the page draws it: each tile's class and label. */
function drawnStrip(file) {
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
  const strip = main.all().find((n) => n.tag === "ol" && n.className === "writings");
  return strip.children.map((li) => [li.className, li.querySelector(".label").textContent]);
}

test("a fresh board draws its Writings, then every view page dashed, in registry order", async (t) => {
  const m = await fixture(t);
  render(m, 1);
  const strip = drawnStrip(page1(m));
  const writings = strip.filter(([cls]) => cls === "writing");
  assert.ok(writings.length > 0, "the render's documents are on the strip");
  assert.deepEqual(strip.slice(0, writings.length), writings, "the Writings come first");
  assert.deepEqual(strip.slice(writings.length), REGISTRY.map((n) => ["writing view unviewed", n]));
  assert.ok(readBoardData(page1(m)).strip.every((i) => i.viewed === false));
});

test("a recorded view page loses its dash and comes first; a Writing recorded after it comes before it", async (t) => {
  const m = await fixture(t);
  const first = render(m, 1);
  const writings = drawnStrip(page1(m)).filter(([cls]) => cls === "writing");

  await recordViewed(m.dbPath, [viewPath(first, "Material Facts", 1)]);
  render(m, 1);
  let strip = drawnStrip(page1(m));
  assert.deepEqual(strip[0], ["writing view", "Material Facts"], "viewed: first and not dashed");
  assert.deepEqual(strip.slice(1, 1 + writings.length), writings, "the never-viewed keep their order");
  assert.deepEqual(strip.slice(1 + writings.length), REGISTRY.filter((n) => n !== "Material Facts").map((n) => ["writing view unviewed", n]));

  const [doc] = docPaths(first);
  await recordViewed(m.dbPath, [doc]);
  render(m, 1);
  strip = drawnStrip(page1(m));
  const data = readBoardData(page1(m)).strip;
  assert.equal(data[0].kind, "writing", "the document is first");
  assert.equal(data[0].key, `doc:1:${doc.split(/[\\/]/).pop()}`);
  assert.deepEqual(strip[1], ["writing view", "Material Facts"], "the view page second");
  assert.deepEqual(data.map((i) => i.viewed), data.map((_, i) => i < 2), "only the two recorded are viewed");
  assert.deepEqual(JSON.parse(viewedRows(m.dbPath)[0].value), [data[0].key, "view:Material Facts"]);

  // Several paths in one call: the last ends up first.
  await recordViewed(m.dbPath, [viewPath(first, "Arguments", 1), viewPath(first, "Legal Research", 1)]);
  assert.deepEqual(JSON.parse(viewedRows(m.dbPath)[0].value), ["view:Legal Research", "view:Arguments", data[0].key, "view:Material Facts"]);
});

test("record_viewed moves no revision and touches no job or state file; the next render reports no board change, and keeps the order", async (t) => {
  const m = await fixture(t);
  const first = render(m, 1);
  const state = join(m.draft, RECORDS_FOLDER, PAGES_STATE_FILE);
  const revision = query(m.dbPath, "SELECT value FROM db_meta WHERE key = 'revision'");
  const tickets = query(m.dbPath, "SELECT * FROM tickets ORDER BY id");
  const stateBytes = readFileSync(state);
  const page = readFileSync(page1(m), "utf-8");

  const result = await recordViewed(m.dbPath, [viewPath(first, "Procedural History", 1)]);
  assert.deepEqual(result.keys, ["board_viewed:filing:1"]);
  assert.deepEqual(query(m.dbPath, "SELECT value FROM db_meta WHERE key = 'revision'"), revision, "no revision moves");
  assert.deepEqual(query(m.dbPath, "SELECT * FROM tickets ORDER BY id"), tickets, "no job or lock column changes");
  assert.deepEqual(readFileSync(state), stateBytes, "the state file is untouched");
  assert.equal(readFileSync(page1(m), "utf-8"), page, "the page is not rewritten");

  const next = workBoard(render(m, 1));
  assert.equal(next.board_changed, false, "the order is outside the compared section");
  assert.deepEqual(next.board_moves, []);
  const drawn = drawnStrip(page1(m));
  render(m, 1);
  assert.deepEqual(drawnStrip(page1(m)), drawn, "a re-render keeps the order and the classes");
  assert.deepEqual(drawn[0], ["writing view", "Procedural History"]);
});

test("a view on one board leaves another board's thumbnails never viewed", async (t) => {
  const m = await fixture(t);
  const first = render(m, 1);
  await recordViewed(m.dbPath, [viewPath(first, "Arguments", 1)]);
  render(m, 2);
  assert.deepEqual(viewedRows(m.dbPath).map((r) => r.key), ["board_viewed:filing:1"]);
  assert.ok(readBoardData(page2(m)).strip.every((i) => i.viewed === false), "board 2 all never viewed");
  assert.deepEqual(drawnStrip(page2(m)).filter(([cls]) => cls !== "writing"), REGISTRY.map((n) => ["writing view unviewed", n]));
  assert.deepEqual(drawnStrip(page1(m))[0], ["writing view", "Arguments"]);
});

test("on a merged board a record by the absorbed Writing's paths lands on the survivor's row", async (t) => {
  const m = await fixture(t);
  await callTool({}, "drafting_data__merge_milestones", { db_path: m.dbPath, boards: [{ filing_id: 1 }, { filing_id: 2 }], confirmed: true, session_token: TOKEN });
  render(m, 1);
  const absorbed = render(m, 2);
  const [doc] = docPaths(absorbed);
  await recordViewed(m.dbPath, [viewPath(absorbed, "Arguments", 2), doc]);
  assert.deepEqual(viewedRows(m.dbPath).map((r) => r.key), ["board_viewed:filing:1"]);
  assert.deepEqual(JSON.parse(viewedRows(m.dbPath)[0].value), [`doc:2:${doc.split(/[\\/]/).pop()}`, "view:Arguments"]);
  render(m, 1);
  const strip = readBoardData(page1(m)).strip;
  assert.deepEqual(strip.slice(0, 2).map((i) => i.key), [`doc:2:${doc.split(/[\\/]/).pop()}`, "view:Arguments"]);
});

test("a stored key no strip shows, such as a Writing's Loose Threads page before 2026-10-29, is passed over", async (t) => {
  const m = await fixture(t);
  await submissionDataExecute(m.dbPath, `INSERT INTO db_meta (key, value) VALUES ('board_viewed:filing:1', '["view:Loose Threads","view:Arguments"]');`);
  render(m, 1);
  assert.deepEqual(drawnStrip(page1(m))[0], ["writing view", "Arguments"]);
  assert.equal(readBoardData(page1(m)).strip.some((i) => i.key === "view:Loose Threads"), false);
});

test("a path that is no thumbnail, or a document name two Writings share outside their folders, is refused and nothing is written", async (t) => {
  const m = await fixture(t);
  const first = render(m, 1);
  await assert.rejects(recordViewed(m.dbPath, [viewPath(first, "Arguments", 1), page1(m)]), code("not_a_strip_item"));
  await assert.rejects(recordViewed(m.dbPath, [join(m.draft, "Litigation Strategy.html")]), code("not_a_strip_item"));
  await assert.rejects(recordViewed(m.dbPath, [join(m.draft, "Loose Threads.html")]), code("not_a_strip_item"));
  await assert.rejects(recordViewed(m.dbPath, []), code("invalid_paths"));
  const second = render(m, 2);
  const name = docPaths(first)[0].split(/[\\/]/).pop();
  assert.ok(docPaths(second).some((p) => p.endsWith(name)), "both Writings have a document of that name");
  await assert.rejects(recordViewed(m.dbPath, [join(m.matterRoot, "elsewhere", name)]), code("ambiguous_path"));
  assert.deepEqual(viewedRows(m.dbPath), []);
  await recordViewed(m.dbPath, docPaths(second).filter((p) => p.endsWith(name)));
  assert.deepEqual(JSON.parse(viewedRows(m.dbPath)[0].value), [`doc:2:${name}`], "its presentation folder names the Writing");
});
