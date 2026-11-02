// The page API (page-api/server.ts): the localhost listener through which the Loose Threads page's
// status button writes a thread's deferred_at in the store. It answers /health, Chrome's preflight for a
// file:// page, refuses a missing or wrong token, writes only an open loose thread of the token's
// proceeding, and never throws when its port is busy: it retries, and takes the port when the
// holder lets go. The page's own script, run against stand-in elements, draws a deferred loose
// thread under Deferred and defers an open one through the real listener.

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";

const { freshSubmissionDb, submissionDbAt } = await import("./helpers/template-db.mjs");
const { submissionDataExecute, submissionDataQuery } = await import("../build/submission/backend.js");
const { startPageApi } = await import("../build/page-api/server.js");
const { pageApiToken } = await import("../build/page-api/token.js");
const { readThreads, writeThreads } = await import("../build/loose-threads/backend.js");
const { executeThenMove } = await import("./helpers/threads.mjs");
const { buildLooseIdeasData, LOOSE_IDEAS_PAGE } = await import("../build/submission/forms/loose-ideas-page.js");
const { fetchResolvedSeeds } = await import("../build/submission/forms/render-work-board.js");
const { renderViewPageHtml } = await import("../build/submission/view-pages.js");

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

/** A drafting database and a coclerk.json naming a free port, read through COCLERK_CONFIG_PATH. */
async function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "coclerk-page-api-"));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
  const port = await freePort();
  const configPath = join(dir, "coclerk.json");
  writeFileSync(configPath, JSON.stringify({ version: 1, page_api_port: port }));
  const env = { ...process.env, COCLERK_CONFIG_PATH: configPath };
  const dbPath = join(dir, "submission.sqlite");
  await freshSubmissionDb(dbPath);
  await executeThenMove(dbPath, SEED);
  return { dir, port, env, dbPath };
}

const SEED = `INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L8470 - Larchmont', NULL), (2, 'L8470 - Larchmont', NULL);
     INSERT INTO tickets (id, proceeding_id, title, intent, status, kind, billing_anchor, created) VALUES (10, 1, 'Live job', 'Do it.', 'queued', 'work', 'L8470|x', '2026-10-01T09:00');
     INSERT INTO tickets (id, proceeding_id, title, intent, status, kind, billing_anchor, created, deleted_at) VALUES (11, 1, 'Deleted job', 'Do it.', 'queued', 'work', 'L8470|x', '2026-10-01T09:00', '2026-10-02T09:00');
     INSERT INTO seeds (id, proceeding_id, created, surfaced_by, idea, charted_into) VALUES
       (1, 1, '2026-10-01T10:00', 'noticed', 'An open thread.', NULL),
       (2, 2, '2026-10-01T10:01', 'noticed', 'Another proceeding''s thread.', NULL),
       (3, 1, '2026-10-01T10:02', 'noticed', 'Outlined into a live job.', 10),
       (4, 1, '2026-10-01T10:03', 'noticed', 'Outlined into a deleted job.', 11);`;

async function listening(t, f, options = {}) {
  const lines = [];
  const api = await startPageApi(f.env, { log: (line) => lines.push(line), ...options });
  t.after(() => api.close());
  return { api, lines };
}

/** One HTTP exchange with the listener, with any headers (fetch drops Origin). */
function exchange(port, method, path, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, method, path, headers }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf-8");
        resolve({ status: res.statusCode, headers: res.headers, body: text ? JSON.parse(text) : null });
      });
    });
    req.on("error", reject);
    if (body !== undefined) req.write(JSON.stringify(body));
    req.end();
  });
}

const post = (f, seedId, action, body) => exchange(f.port, "POST", `/seeds/${seedId}/${action}`, { headers: { "Content-Type": "application/json", Origin: "null" }, body });
const valid = (f, proceedingId = 1) => ({ db_path: f.dbPath, proceeding_id: proceedingId, token: pageApiToken(f.dbPath, proceedingId, f.env) });
const deferredAt = (f, id) => readThreads(f.dbPath).find((t) => t.id === id).deferred_at;
const setThread = (dbPath, id, fields) => writeThreads(dbPath, [{ ...readThreads(dbPath).find((t) => t.id === id), ...fields }]);
const revision = (f) => Number(submissionDataQuery(f.dbPath, "SELECT value FROM db_meta WHERE key = 'revision'").rows[0].value);

async function until(check, ms = 3000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out waiting");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

test("GET /health answers ok, this process's pid, the start time and the plugin version", async (t) => {
  const f = await fixture(t);
  await listening(t, f);
  const res = await exchange(f.port, "GET", "/health");
  assert.equal(res.status, 200);
  assert.deepEqual(Object.keys(res.body), ["ok", "pid", "started_at", "plugin_version"]);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.pid, process.pid);
  assert.ok(!Number.isNaN(Date.parse(res.body.started_at)));
  assert.ok(res.body.plugin_version === null || typeof res.body.plugin_version === "string");
  assert.equal(res.headers["access-control-allow-origin"], undefined, "no Origin, no Allow-Origin");
});

test("OPTIONS from a file:// page answers 204 with the CORS and Private Network Access headers", async (t) => {
  const f = await fixture(t);
  await listening(t, f);
  const res = await exchange(f.port, "OPTIONS", "/seeds/1/defer", {
    headers: { Origin: "null", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type", "Access-Control-Request-Private-Network": "true" },
  });
  assert.equal(res.status, 204);
  assert.equal(res.headers["access-control-allow-origin"], "null");
  assert.equal(res.headers["access-control-allow-methods"], "GET, POST");
  assert.equal(res.headers["access-control-allow-headers"], "Content-Type");
  assert.equal(res.headers["access-control-allow-private-network"], "true");
  assert.equal(res.headers.vary, "Origin");
  const health = await exchange(f.port, "GET", "/health", { headers: { Origin: "null" } });
  assert.equal(health.headers["access-control-allow-origin"], "null");
  assert.equal(health.headers["access-control-allow-private-network"], "true");
  const other = await exchange(f.port, "OPTIONS", "/health", { headers: { Origin: "https://example.com" } });
  assert.equal(other.headers["access-control-allow-origin"], undefined, "only Origin: null is echoed");
});

test("a missing or wrong token is refused 403, and a db_path that is not there 400, writing nothing", async (t) => {
  const f = await fixture(t);
  await listening(t, f);
  const before = revision(f);
  const { token, ...noToken } = valid(f);
  assert.equal((await post(f, 1, "defer", noToken)).status, 403);
  assert.equal((await post(f, 1, "defer", { ...noToken, token: "0".repeat(64) })).status, 403);
  assert.equal((await post(f, 1, "defer", { ...noToken, token: token.slice(0, 10) })).status, 403);
  assert.equal((await post(f, 1, "defer", { ...valid(f), proceeding_id: 2 })).status, 403, "a token is for one proceeding");
  const missing = join(f.dir, "missing.sqlite");
  assert.equal((await post(f, 1, "defer", { db_path: missing, proceeding_id: 1, token: pageApiToken(missing, 1, f.env) })).status, 400);
  assert.equal((await post(f, 1, "defer", { db_path: "submission.sqlite", proceeding_id: 1, token: pageApiToken("submission.sqlite", 1, f.env) })).status, 400);
  assert.equal(deferredAt(f, 1), null);
  assert.equal(revision(f), before);
});

test("a loose thread of another proceeding is 409, one outlined into a live job is 409, and no such thread is 404", async (t) => {
  const f = await fixture(t);
  await listening(t, f);
  const wrong = await post(f, 2, "defer", valid(f));
  assert.equal(wrong.status, 409);
  assert.equal(wrong.body.outcome, "wrong_proceeding");
  const outlined = await post(f, 3, "defer", valid(f));
  assert.equal(outlined.status, 409);
  assert.equal(outlined.body.outcome, "not_open");
  const none = await post(f, 99, "defer", valid(f));
  assert.equal(none.status, 404);
  assert.equal(none.body.outcome, "not_found");
  assert.equal(deferredAt(f, 2), null);
  assert.equal(deferredAt(f, 3), null);
});

test("defer then undefer round-trips deferred_at, a repeat is 409 already, and no revision moves", async (t) => {
  const f = await fixture(t);
  await listening(t, f);
  const before = revision(f);
  const deferred = await post(f, 1, "defer", valid(f));
  assert.equal(deferred.status, 200);
  assert.equal(deferred.body.outcome, "deferred");
  assert.match(deferredAt(f, 1), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  assert.equal(deferred.body.deferred_at, deferredAt(f, 1));
  assert.equal((await post(f, 1, "defer", valid(f))).body.outcome, "already");
  const undeferred = await post(f, 1, "undefer", valid(f));
  assert.equal(undeferred.status, 200);
  assert.equal(undeferred.body.outcome, "undeferred");
  assert.equal(deferredAt(f, 1), null);
  const again = await post(f, 1, "undefer", valid(f));
  assert.equal(again.status, 409);
  assert.equal(again.body.outcome, "already");
  assert.equal((await post(f, 4, "defer", valid(f))).status, 200, "a thread outlined into a deleted job is open");
  assert.equal(revision(f), before);
});

test("a busy port never throws: the second listener logs once, retries, and binds when the first closes", async (t) => {
  const f = await fixture(t);
  const first = await listening(t, f);
  assert.equal(first.api.listening(), true);
  const second = await listening(t, f, { retryMs: 50 });
  assert.equal(second.api.listening(), false);
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.deepEqual(second.lines, [`[page-api] port ${f.port} busy, retrying`], "one line however many tries");
  await first.api.close();
  await until(() => second.api.listening());
  assert.equal((await exchange(f.port, "GET", "/health")).body.ok, true);
  assert.deepEqual(first.lines, []);
});

/** Runs the Loose Threads page's own script from the rendered file against stand-in elements. */
function drawLooseThreads(html, fetchImpl) {
  class Node {
    constructor(tag) {
      Object.assign(this, { tag, children: [], attrs: {}, className: "", text: "", listeners: {}, parent: null, hidden: false });
      const node = this;
      this.classList = { add: (c) => { node.className = `${node.className} ${c}`.trim(); } };
    }
    set textContent(value) {
      this.text = String(value);
      this.children = [];
    }
    get textContent() {
      return this.text + this.children.map((c) => c.textContent).join("");
    }
    get childNodes() {
      return this.children;
    }
    appendChild(child) {
      child.parent = this;
      this.children.push(child);
      return child;
    }
    removeChild(child) {
      this.children = this.children.filter((c) => c !== child);
      return child;
    }
    setAttribute(key, value) {
      this.attrs[key] = String(value);
    }
    getAttribute(key) {
      return this.attrs[key] ?? null;
    }
    addEventListener(type, fn) {
      this.listeners[type] = fn;
    }
    all() {
      return this.children.flatMap((c) => [c, ...c.all()]);
    }
    querySelector(selector) {
      return this.all().find((n) => n.className.split(" ").includes(selector.slice(1))) ?? null;
    }
  }
  const header = new Node("header");
  const board = new Node("div");
  const document = {
    querySelector: (selector) => (selector === "header" ? header : selector === ".board" ? board : null),
    createElement: (tag) => new Node(tag),
    createTextNode: (text) => Object.assign(new Node("#text"), { text: String(text) }),
  };
  const line = /^window\.VIEW_PAGE = (.*);$/m.exec(html)[1];
  const script = html.split("<script>")[3].split("</script>")[0];
  runInNewContext(script, { window: { VIEW_PAGE: JSON.parse(line) }, document, fetch: fetchImpl, AbortController, setTimeout, clearTimeout, JSON, String });
  const cards = board.all().filter((n) => n.tag === "article");
  const card = (id) => cards.find((n) => n.all().some((c) => c.className === "where" && c.textContent.startsWith(`Loose thread ${id} `)));
  /** The heading of the section a card sits in. */
  const sectionOf = (id) => card(id).parent.parent.children[0].text;
  return { header, board, card, sectionOf };
}

test("the Loose Threads page carries deferred_at and the api block; a deferred thread draws under Deferred, an open one defers through the listener", async (t) => {
  const f = await fixture(t);
  setThread(f.dbPath, 4, { deferred_at: "2026-10-08T09:00" });
  const data = buildLooseIdeasData(f.dbPath, [1], f.env);
  assert.deepEqual(data.ideas.map((i) => [i.id, i.deferred_at]), [[1, null], [4, "2026-10-08T09:00"]]);
  assert.deepEqual(data.api, { port: f.port, db_path: f.dbPath, proceeding_id: 1, token: pageApiToken(f.dbPath, 1, f.env) });
  const html = renderViewPageHtml(LOOSE_IDEAS_PAGE, { filing: "", matter: "L8470", client: "", revision: 1, rendered: "2026-10-08 09:00" }, data);
  writeFileSync(join(f.dir, "Loose Threads.html"), html);

  // No listener: the buttons stay disabled and one line says why.
  const off = drawLooseThreads(html, () => Promise.reject(new Error("connection refused")));
  await until(() => off.header.all().some((n) => n.className === "api-off"));
  assert.equal(off.header.all().find((n) => n.className === "api-off").textContent, "Buttons need the Claude desktop app running.");
  assert.equal(off.card(1).all().find((n) => n.className === "status").disabled, true);

  // A listener: the open thread's button is enabled, and a click defers it in place.
  await listening(t, f);
  const on = drawLooseThreads(html, fetch);
  const status = (id) => on.card(id).all().find((n) => n.className === "status");
  assert.equal(on.sectionOf(4), "Deferred");
  assert.equal(status(4).textContent, "Deferred");
  assert.equal(status(4).title, "Click to bring back");
  const button = status(1);
  assert.equal(on.sectionOf(1), "Unranked");
  assert.equal(button.textContent, "Unranked");
  assert.equal(button.title, "Click to defer");
  await until(() => button.disabled === false);
  button.listeners.click();
  await until(() => on.sectionOf(1) === "Deferred");
  assert.equal(button.textContent, "Deferred");
  assert.equal(button.title, "Click to bring back");
  assert.match(deferredAt(f, 1), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  assert.equal(on.header.all().some((n) => n.className === "api-off"), false);
});

/** Added to the fixture: a discarded thread, a suggested one, one discarded after it was outlined, one
 * outlined into a later live job, created the minute thread 6 was suggested, and a discarded thread of
 * another proceeding. */
const RESOLVED = `INSERT INTO tickets (id, proceeding_id, title, intent, status, kind, billing_anchor, created) VALUES (12, 1, 'Later job', 'Do it.', 'queued', 'work', 'L8470|x', '2026-10-03T08:00');
  INSERT INTO seeds (id, proceeding_id, created, surfaced_by, idea, charted_into, discarded_at, suggested_at) VALUES
    (5, 1, '2026-10-01T10:04', 'noticed', 'Discarded.', NULL, '2026-10-05T12:00', NULL),
    (6, 1, '2026-10-01T10:05', 'noticed', 'Suggested.', NULL, NULL, '2026-10-03T08:00'),
    (7, 1, '2026-10-01T10:06', 'noticed', 'Discarded after outlining.', 10, '2026-10-04T10:00', NULL),
    (8, 1, '2026-10-01T10:07', 'noticed', 'Outlined into the later job.', 12, NULL, NULL),
    (9, 2, '2026-10-01T10:08', 'noticed', 'Another proceeding''s discarded thread.', NULL, '2026-10-06T09:00', NULL);`;

test("fetchResolvedSeeds lists the discarded, the suggested and the threads outlined into a live job, newest first, each once", async (t) => {
  const f = await fixture(t);
  await executeThenMove(f.dbPath, RESOLVED);
  // Absent: thread 1 is open, thread 4's job is deleted, and threads 2 and 9 are another proceeding's.
  assert.deepEqual(fetchResolvedSeeds(f.dbPath, 1), [
    { id: 5, kind: "idea", idea: "Discarded.", how: "discarded", at: "2026-10-05T12:00", job_id: null, job_title: null },
    { id: 7, kind: "idea", idea: "Discarded after outlining.", how: "discarded", at: "2026-10-04T10:00", job_id: null, job_title: null },
    { id: 6, kind: "idea", idea: "Suggested.", how: "suggested", at: "2026-10-03T08:00", job_id: null, job_title: null },
    { id: 8, kind: "idea", idea: "Outlined into the later job.", how: "job", at: "2026-10-03T08:00", job_id: 12, job_title: "Later job" },
    { id: 3, kind: "idea", idea: "Outlined into a live job.", how: "job", at: "2026-10-01T09:00", job_id: 10, job_title: "Live job" },
  ]);
  assert.deepEqual(fetchResolvedSeeds(f.dbPath, 2).map((s) => [s.id, s.how]), [[9, "discarded"]]);
});

test("on a database held at v74, fetchResolvedSeeds lists only the threads outlined into a live job", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "coclerk-page-api-v74-"));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
  const dbPath = join(dir, "submission.sqlite");
  submissionDbAt(dbPath, 74);
  await executeThenMove(dbPath, SEED);
  assert.deepEqual(fetchResolvedSeeds(dbPath, 1), [{ id: 3, kind: "idea", idea: "Outlined into a live job.", how: "job", at: "2026-10-01T09:00", job_id: 10, job_title: "Live job" }]);
});

test("the Loose Threads page draws its tabs and a status filter; Resolved shows under its status, and on All only while the checkbox is on", async (t) => {
  const f = await fixture(t);
  await executeThenMove(f.dbPath, RESOLVED);
  const draw = () => {
    const data = buildLooseIdeasData(f.dbPath, [1], f.env);
    const html = renderViewPageHtml(LOOSE_IDEAS_PAGE, { filing: "", matter: "L8470", client: "", revision: 1, rendered: "2026-10-08 09:00" }, data);
    const { board } = drawLooseThreads(html, () => Promise.reject(new Error("connection refused")));
    const nodes = board.all();
    return {
      extra: JSON.parse(/^window\.VIEW_PAGE = (.*);$/m.exec(html)[1]).extra,
      nodes,
      tablist: nodes.find((n) => n.attrs.role === "tablist"),
      tabs: nodes.filter((n) => n.attrs.role === "tab"),
      filters: nodes.filter((n) => n.className === "status-pick"),
      folder: nodes.find((n) => n.attrs.role === "tabpanel"),
      // Ranked, Unranked, Open, Deferred, Resolved, Left where they are.
      sections: nodes.filter((n) => n.tag === "section"),
      box: nodes.find((n) => n.className === "resolved-toggle"),
    };
  };
  const hidden = (p) => p.sections.map((s) => s.hidden);
  const pick = (p, status) => p.filters.find((b) => b.attrs["data-status"] === status).listeners.click();
  const tab = (p, filter) => p.tabs.find((b) => b.attrs["data-filter"] === filter).listeners.click();

  // Nothing ranked: the Ranked heading is hidden, so the checkbox ends the tab row.
  const unranked = draw();
  assert.deepEqual(unranked.extra, [["Threads", "2"], ["Ranked", "0"], ["Unranked", "2"], ["Deferred", "0"], ["Resolved", "5"]]);
  assert.deepEqual(unranked.tablist.children.map((n) => n.className || n.attrs["data-filter"]), ["all", "jobs", "ideas", "propositions", "memos", "correspondence", "arguments", "work_boards", "resolved-toggle"]);
  assert.equal(unranked.nodes.some((n) => n.className === "switch"), false, "no All groups switch with nothing ranked");
  assert.deepEqual(hidden(unranked), [true, false, true, true, true, true]);

  // One ranked: the checkbox sits in the Ranked heading, before the All groups switch.
  setThread(f.dbPath, 1, { rank: 1, rank_group: "tooling", rank_reason: "Blocks the others." });
  const p = draw();
  assert.deepEqual(p.extra, [["Threads", "2"], ["Ranked", "1"], ["Unranked", "1"], ["Deferred", "0"], ["Resolved", "5"]]);
  assert.deepEqual(p.tabs.map((b) => b.textContent), ["All", "Jobs", "Ideas", "Propositions", "Legal Memos", "Correspondence", "Arguments", "Work Boards"]);
  assert.deepEqual(p.filters.map((b) => b.textContent), ["All statuses", "Ranked", "Unranked", "Deferred", "Resolved"]);
  assert.equal(p.tablist.children.length, 8, "the tab row holds the tabs alone");
  assert.equal(p.box.parent.tag, "h2");
  assert.equal(p.box.parent.text, "Ranked");
  assert.deepEqual(p.box.parent.children.map((n) => n.className), ["resolved-toggle", "switch"]);
  assert.deepEqual(p.sections.map((s) => s.children[0].text), ["Ranked", "Unranked", "Open", "Deferred", "Resolved", "Left where they are"]);

  // All, the checkbox off: the resolved section is hidden until a click, and hidden again on the next.
  assert.equal(p.box.attrs.role, "checkbox");
  assert.equal(p.box.textContent, "☐ Show/Hide Resolved Threads");
  assert.equal(p.box.attrs["aria-checked"], "false");
  assert.equal(p.box.hidden, false);
  assert.deepEqual(hidden(p), [false, false, true, true, true, true]);
  p.box.listeners.click();
  assert.equal(p.box.textContent, "☑ Show/Hide Resolved Threads");
  assert.equal(p.box.attrs["aria-checked"], "true");
  assert.deepEqual(hidden(p), [false, false, true, true, false, true]);
  p.box.listeners.click();
  assert.equal(p.box.attrs["aria-checked"], "false");
  assert.deepEqual(hidden(p), [false, false, true, true, true, true]);

  // The status filter: each shows its section, none of them the checkbox.
  pick(p, "resolved");
  assert.deepEqual(hidden(p), [true, true, true, true, false, true]);
  assert.equal(p.filters.find((b) => b.attrs["data-status"] === "resolved").attrs["aria-pressed"], "true");
  assert.equal(p.box.hidden, true);
  pick(p, "ranked");
  assert.deepEqual(hidden(p), [false, true, true, true, true, true]);
  pick(p, "unranked");
  assert.deepEqual(hidden(p), [true, false, true, true, true, true]);
  pick(p, "all");
  assert.deepEqual(hidden(p), [false, false, true, true, true, true]);
  assert.equal(p.box.hidden, false);

  // A tab that holds no ideas offers neither Ranked nor Unranked, and drops a status it does not offer.
  pick(p, "ranked");
  tab(p, "jobs");
  assert.equal(p.filters.find((b) => b.attrs["data-status"] === "ranked").hidden, true);
  assert.equal(p.filters.find((b) => b.attrs["data-status"] === "all").attrs["aria-pressed"], "true");
  assert.deepEqual(hidden(p), [true, true, true, true, true, true]);
  tab(p, "ideas");
  assert.equal(p.filters.find((b) => b.attrs["data-status"] === "ranked").hidden, false);
  assert.deepEqual(hidden(p), [false, false, true, true, true, true]);
  tab(p, "all");

  // One inert line per resolved thread, newest first, each ending in its Resolved label.
  assert.deepEqual(p.sections[4].children[1].children.map((n) => n.textContent), [
    "Loose thread 5:  Discarded. *DISCARDED* Restore Discarded 2026-10-05Resolved",
    "Loose thread 7:  Discarded after outlining. *DISCARDED* Restore Discarded 2026-10-04Resolved",
    "Loose thread 6:  Suggested. *SUGGESTED* Suggested 2026-10-03Resolved",
    "Loose thread 8:  Outlined into the later job. Taken up by Job #12: Later jobResolved",
    "Loose thread 3:  Outlined into a live job. Taken up by Job #10: Live jobResolved",
  ]);

  // Nothing resolved: no checkbox is drawn, and the Resolved status says it holds nothing.
  writeThreads(f.dbPath, readThreads(f.dbPath).filter((x) => x.proceeding_id === 1).map((x) => ({ ...x, charted_into: null, discarded_at: null, suggested_at: null })));
  const none = draw();
  assert.equal(none.extra[4][1], "0");
  assert.equal(none.box, undefined);
  pick(none, "resolved");
  assert.deepEqual(hidden(none), [true, true, true, true, true, true]);
  assert.equal(none.folder.children.at(-1).textContent, "No loose thread under this tab.");
  assert.equal(none.folder.children.at(-1).hidden, false);
});

test("a thread that is no idea reads Open and defers under its tab; an in-place card is read-only and shows only with no status picked", async (t) => {
  const f = await fixture(t);
  setThread(f.dbPath, 1, { kind: "argument" });
  await submissionDataExecute(f.dbPath, "INSERT INTO tickets (id, proceeding_id, title, intent, status, kind, billing_anchor, created, rejected_at) VALUES (20, 1, 'Shelved job', 'Do it.', 'queued', 'work', 'L8470|x', '2026-10-01T09:00', '2026-10-02T09:00');");
  const data = buildLooseIdeasData(f.dbPath, [1], f.env);
  const html = renderViewPageHtml(LOOSE_IDEAS_PAGE, { filing: "", matter: "L8470", client: "", revision: 1, rendered: "2026-10-08 09:00" }, data);
  const { board } = drawLooseThreads(html, () => Promise.reject(new Error("connection refused")));
  const nodes = board.all();
  const sections = nodes.filter((n) => n.tag === "section");
  const open = sections[2];
  const place = sections[5];
  assert.equal(open.hidden, false);
  assert.match(open.textContent, /An open thread\./);
  assert.equal(open.all().find((n) => n.className === "status").textContent, "Open");
  assert.equal(open.all().some((n) => n.className === "tag rank"), false, "ranking applies to ideas only");
  assert.match(place.textContent, /Job #20: Shelved job · 2026-10-02Shelved/);
  assert.equal(place.all().some((n) => n.tag === "button"), false);

  const tab = (filter) => nodes.find((n) => n.attrs["data-filter"] === filter).listeners.click();
  tab("arguments");
  assert.equal(open.hidden, false);
  assert.equal(place.hidden, true, "the job is under Jobs");
  tab("jobs");
  assert.equal(open.hidden, true);
  assert.equal(place.hidden, false);
  nodes.find((n) => n.attrs["data-status"] === "deferred").listeners.click();
  assert.equal(place.hidden, true);
});
