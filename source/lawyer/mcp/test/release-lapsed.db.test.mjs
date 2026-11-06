// A lapsed lock is written back as released whenever a board page is written (job-activity.ts
// releaseLapsedLocks, ADR 0015's 2026-11-06 note), and a page drawn before the lapse switches the job
// by its own clock once the lapse minute it was given passes (ticket-category.ts lapsesAt).

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import test, { after } from "node:test";

process.env.COCLERK_SUBMISSION_LOCK_ROOT = mkdtempSync(join(tmpdir(), "coclerk-release-lapsed-locks-"));
after(() => rmSync(process.env.COCLERK_SUBMISSION_LOCK_ROOT, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));

const { freshSubmissionDb } = await import("./helpers/template-db.mjs");
const { submissionDataExecute, submissionDataQuery } = await import("../build/submission/backend.js");
const { releaseLapsedLocks } = await import("../build/submission/forms/job-activity.js");
const { buildProceedingBoard } = await import("../build/submission/forms/build-proceeding-board.js");
const { submissionFormsRender } = await import("../build/submission/forms.js");
const { callTool } = await import("../build/dispatch.js");
const { awaitBackgroundJobs } = await import("../build/submission/render-job.js");
const { readBoardData, ASHBOURNE } = await import("./fixtures/forms-render-seeds.mjs");

/** The local minute `minutes` before now, as the server stamps it. */
function ago(minutes, sep = "T") {
  const d = new Date(Date.now() - minutes * 60_000);
  const two = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}${sep}${two(d.getHours())}:${two(d.getMinutes())}`;
}

const query = (dbPath, sql, params = []) => submissionDataQuery(dbPath, sql, params).rows;
const row = (dbPath, id) => query(dbPath, "SELECT status, locked_by, locked_at, plan_approved_at FROM tickets WHERE id = ?", [id])[0];
const kv = (dbPath, ns, id) => query(dbPath, "SELECT value, updated_at FROM kv_store WHERE namespace = ? AND key = ?", [ns, `tickets:${id}`])[0];
const stamp = (dbPath, id, minutes) =>
  submissionDataExecute(dbPath, `INSERT OR REPLACE INTO kv_store (namespace, key, value, updated_at) VALUES ('last_activity', 'tickets:${id}', '"${ago(minutes)}"', '2026-10-01T00:00:00Z')`);

const TICKET = "INSERT INTO tickets (id, proceeding_id, filing_id, title, intent, status, priority, kind, billing_anchor, created";

/** A matter with Writing 1: job 1 queued, job 2 held by another session with a done step and an approved
 * plan, job 3 held by this session (`sess-own`). Every lock is stamped `lockedAt`. */
async function fixture(t, lockedAt = "2026-10-01 09:00") {
  const base = mkdtempSync(join(tmpdir(), "coclerk-release-lapsed-"));
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
    `INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L9999 - Test', 'CAN/BC/Vancouver-International-Arbitration-Centre');
     INSERT INTO filings (id, proceeding_id, kind, round, title) VALUES (1, 1, 'submissions_package', 'opening', 'Opening Submissions Package');
     ${TICKET}) VALUES (1, 1, 1, 'Ready job', 'Do it.', 'queued', 0, 'work', 'L9999', '2026-10-01 08:00');
     ${TICKET}, locked_by, locked_at, plan_approved_at) VALUES (2, 1, 1, 'Held elsewhere', 'Do it.', 'wip', 0, 'work', 'L9999', '2026-10-01 08:00', 'sess-other', '${lockedAt}', '2026-10-01 08:30');
     ${TICKET}, locked_by, locked_at) VALUES (3, 1, 1, 'Held here', 'Do it.', 'wip', 0, 'work', 'L9999', '2026-10-01 08:00', 'sess-own', '${lockedAt}');
     INSERT INTO ticket_steps (ticket_id, ordinal, text, done_at) VALUES (2, 1, 'First step', '2026-10-01 08:45'), (2, 2, 'Second step', NULL);
     INSERT INTO kv_store (namespace, key, value, updated_at) VALUES ('claim_no', 'tickets:2', 3, '2026-10-01T00:00:00Z');`
  );
  return m;
}

test("a lock idle 61 minutes is released with its plan and done steps kept and the lapse recorded; assign_job then takes it as a fresh claim", async (t) => {
  const m = await fixture(t);
  await stamp(m.dbPath, 2, 61);
  await stamp(m.dbPath, 3, 5);
  assert.equal(await releaseLapsedLocks(m.dbPath, "sess-own"), 1);
  assert.deepEqual(row(m.dbPath, 2), { status: "queued", locked_by: null, locked_at: null, plan_approved_at: "2026-10-01 08:30" });
  assert.deepEqual(query(m.dbPath, "SELECT ordinal, done_at FROM ticket_steps WHERE ticket_id = 2 ORDER BY ordinal"), [
    { ordinal: 1, done_at: "2026-10-01 08:45" },
    { ordinal: 2, done_at: null },
  ]);
  assert.equal(JSON.parse(kv(m.dbPath, "lock_lapsed", 2).value).from, "ss-other");
  const assigned = await callTool({}, "drafting_data__assign_job", { db_path: m.dbPath, ticket_id: 2, session_token: "sess-new" });
  assert.equal(assigned.outcome, "assigned");
  assert.equal(assigned.claim_no, 4);
});

test("a lock idle 59 minutes, and this session's own lapsed lock, are not touched", async (t) => {
  const m = await fixture(t);
  await stamp(m.dbPath, 2, 59);
  await stamp(m.dbPath, 3, 61);
  assert.equal(await releaseLapsedLocks(m.dbPath, "sess-own"), 0);
  assert.equal(row(m.dbPath, 2).locked_by, "sess-other");
  assert.equal(row(m.dbPath, 3).locked_by, "sess-own");
  assert.equal(kv(m.dbPath, "lock_lapsed", 2), undefined);
  assert.equal(kv(m.dbPath, "lock_lapsed", 3), undefined);
});

test("a second release writes nothing new", async (t) => {
  const m = await fixture(t);
  await stamp(m.dbPath, 3, 5);
  assert.equal(await releaseLapsedLocks(m.dbPath, undefined), 1);
  const first = kv(m.dbPath, "lock_lapsed", 2);
  assert.equal(await releaseLapsedLocks(m.dbPath, undefined), 0);
  assert.deepEqual(kv(m.dbPath, "lock_lapsed", 2), first);
});

test("board_card is read-only: a lapsed job shows in Ready and its row stays held", async (t) => {
  const m = await fixture(t);
  await stamp(m.dbPath, 3, 5);
  const { card } = await callTool({}, "drafting_forms__board_card", { db_path: m.dbPath, filing_id: 1, jobs: [2] });
  assert.match(card, /Ready/);
  assert.equal(row(m.dbPath, 2).status, "wip");
  assert.equal(row(m.dbPath, 2).locked_by, "sess-other");
});

test("a held job not yet lapsed carries its lapse minute and the category it falls to then", async (t) => {
  const m = await fixture(t);
  const rendered = ago(0);
  await stamp(m.dbPath, 2, 30);
  await stamp(m.dbPath, 3, 61);
  await submissionDataExecute(m.dbPath, "INSERT INTO ticket_blocks (blocker_id, blocked_id) VALUES (1, 2)");
  const byId = new Map(buildProceedingBoard(m.dbPath, 1, rendered).tickets.map(({ ticket }) => [ticket.id, ticket]));
  assert.equal(byId.get(2).category, "wip");
  assert.equal(byId.get(2).lapses_at, ago(-30));
  assert.equal(byId.get(2).category_after_lapse, "waiting", "its open blocker holds it in Blocked once released");
  for (const id of [1, 3]) {
    assert.equal(byId.get(id).lapses_at, undefined, `job ${id}: queued, or already lapsed`);
    assert.equal(byId.get(id).category_after_lapse, undefined);
  }
});

/** The Work Board page's job cards as drawn at this browser minute: id -> data-status, and the reload delay set, if any. */
function drawnCards(file) {
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
    append(...nodes) {
      for (const n of nodes) this.appendChild(n);
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
  const reloads = [];
  const script = readFileSync(file, "utf-8").split("<script>")[2].split("</script>")[0];
  runInNewContext(script, { window: { WORKBOARD: readBoardData(file) }, document, setTimeout: (_fn, ms) => reloads.push(ms), location: { reload() {} } });
  const cards = new Map(main.all().filter((n) => n.tag === "details" && n.id.startsWith("ticket-")).map((n) => [Number(n.id.slice(7)), n.attrs["data-status"]]));
  return { cards, reloads };
}

const pagePath = (m) => join(m.draft, "Opening Submissions Package", "Work Board.html");

test("a page drawn before the lapse switches the job to its after-lapse category once its clock passes the lapse minute", async (t) => {
  // Rendered 2 hours ago, job 2 then 10 minutes idle: its lock lapsed 70 minutes ago by this clock.
  const m = await fixture(t, ago(130, " "));
  await stamp(m.dbPath, 2, 130);
  await stamp(m.dbPath, 3, 125);
  submissionFormsRender(m.dbPath, 1, ASHBOURNE, "mockup", undefined, undefined, undefined, ago(120, " "), "sess-own", m.draft);
  const { cards, reloads } = drawnCards(pagePath(m));
  assert.equal(cards.get(2), "ready");
  assert.equal(cards.get(3), "ready");
  assert.deepEqual(reloads, [], "no lapse minute is still ahead");
});

test("a page drawn before a lapse still ahead keeps the job In Progress and reloads at its lapse minute", async (t) => {
  const m = await fixture(t, ago(10, " "));
  await stamp(m.dbPath, 2, 10);
  await stamp(m.dbPath, 3, 20);
  submissionFormsRender(m.dbPath, 1, ASHBOURNE, "mockup", undefined, undefined, undefined, ago(0, " "), "sess-own", m.draft);
  const { cards, reloads } = drawnCards(pagePath(m));
  assert.equal(cards.get(2), "wip");
  assert.equal(cards.get(3), "wip");
  assert.equal(reloads.length, 1);
  assert.ok(reloads[0] > 39 * 60_000 && reloads[0] <= 50 * 60_000, `reloads at job 3's lapse, 40 minutes on (got ${reloads[0]} ms)`);
});
