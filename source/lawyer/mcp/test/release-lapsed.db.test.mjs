// A lapsed lock is released only by the assign_job that takes the job (ADR 0015's 2026-11-17 note,
// spec 2026-11-17 drafting-records-sync-safety criterion 8): session entry and page writes leave the
// row as it is, every board reads the job as Ready, and the skills' held test (drafting-data
// jobs-run.md §4a) lets a retirement through. A page drawn before the lapse switches the job by its own
// clock once the lapse minute it was given passes (ticket-category.ts lapsesAt).

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import test, { after } from "node:test";

import { startFakeCloud } from "./helpers/fake-cloud.mjs";

process.env.COCLERK_SUBMISSION_LOCK_ROOT = mkdtempSync(join(tmpdir(), "coclerk-release-lapsed-locks-"));
after(() => rmSync(process.env.COCLERK_SUBMISSION_LOCK_ROOT, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));

const { freshSubmissionDb } = await import("./helpers/template-db.mjs");
const { submissionDataExecute, submissionDataQuery } = await import("../build/submission/backend.js");
const { heldClause } = await import("../build/submission/forms/job-activity.js");
const { buildProceedingBoard } = await import("../build/submission/forms/build-proceeding-board.js");
const { submissionFormsRender } = await import("../build/submission/forms.js");
const { callTool, createDispatchContext } = await import("../build/index.js");
const writes = await import("../build/tools/practice/writes.js");
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

async function practiceContext(t) {
  const practicePath = join(tmpdir(), `coclerk-release-lapsed-practice-${randomUUID()}.db`);
  t.after(() => rmSync(practicePath, { recursive: true, force: true }));
  const context = await createDispatchContext({ ...process.env, ...(await startFakeCloud(t)).env, COCLERK_DB_PATH: practicePath });
  await writes.upsert_client_matter(context.practiceDb, { client_num: "C-9999", name: "Lookup Client Ltd.", matt_num: "L9999", file_number: "F-9999" });
  return context;
}

/** The SQL blocks of a drafting-data reference, in order, with jobs-run.md §4a's held test checked
 * to be copied exactly wherever the block carries its first line. */
const REFERENCES = join(dirname(fileURLToPath(import.meta.url)), "../../../skills/drafting-data/references");
const sqlBlocks = (name) => [...readFileSync(join(REFERENCES, name), "utf-8").matchAll(/```sql\r?\n([\s\S]*?)```/g)].map((m) => m[1]);
const flat = (text) => text.split(/\s+/).join(" ").trim();
const HELD = flat(sqlBlocks("jobs-run.md").find((b) => b.startsWith("t.status = 'wip' AND NOT (")));

test("every in-progress read in the drafting-data references carries jobs-run.md §4a's held test exactly", () => {
  let copies = 0;
  for (const name of ["jobs-closeout.md", "filing-checklists.md", "paragraph-revision.md"]) {
    for (const block of sqlBlocks(name).map(flat)) {
      for (let at = block.indexOf("t.status = 'wip' AND NOT ("); at !== -1; at = block.indexOf("t.status = 'wip' AND NOT (", at + 1)) {
        assert.equal(block.slice(at, at + HELD.length), HELD, name);
        copies += 1;
      }
    }
  }
  assert.equal(copies, 11, "jobs-closeout §9a and §10c: 3 each, filing-checklists: 2, paragraph-revision: 3");
});

test("session entry with another session's lock 61 minutes idle writes nothing, and the board shows the job Ready", async (t) => {
  const m = await fixture(t);
  await stamp(m.dbPath, 2, 61);
  await submissionDataExecute(m.dbPath, "UPDATE tickets SET status = 'queued', locked_by = NULL, locked_at = NULL WHERE id = 3");
  const context = await practiceContext(t);
  await callTool(context, "drafting_forms__open_session", { matter_root: m.matterRoot });
  const bytes = readFileSync(m.dbPath);
  const mtime = statSync(m.dbPath).mtimeMs;
  const opened = await callTool(context, "drafting_forms__open_session", { matter_root: m.matterRoot });
  assert.ok(!opened.timings.some((p) => p.phase === "lapsed_locks"));
  assert.ok(readFileSync(m.dbPath).equals(bytes), "the database's bytes are unchanged");
  assert.equal(statSync(m.dbPath).mtimeMs, mtime, "the database's modification time is unchanged");
  assert.deepEqual(row(m.dbPath, 2), { status: "wip", locked_by: "sess-other", locked_at: "2026-10-01 09:00", plan_approved_at: "2026-10-01 08:30" });
  assert.equal(kv(m.dbPath, "lock_lapsed", 2), undefined);
  assert.equal(drawnCards(pagePath(m)).cards.get(2), "ready");
});

test("assign_job takes the lapsed job, records lock_lapsed, and keeps its plan and done steps", async (t) => {
  const m = await fixture(t);
  await stamp(m.dbPath, 2, 61);
  const assigned = await callTool({}, "drafting_data__assign_job", { db_path: m.dbPath, ticket_id: 2, session_token: "sess-new" });
  assert.equal(assigned.outcome, "assigned");
  assert.equal(assigned.claim_no, 4);
  assert.equal(row(m.dbPath, 2).locked_by, "sess-new");
  assert.equal(row(m.dbPath, 2).plan_approved_at, "2026-10-01 08:30");
  assert.equal(JSON.parse(kv(m.dbPath, "lock_lapsed", 2).value).from, "ss-other");
  assert.deepEqual(query(m.dbPath, "SELECT ordinal, done_at FROM ticket_steps WHERE ticket_id = 2 ORDER BY ordinal"), [
    { ordinal: 1, done_at: "2026-10-01 08:45" },
    { ordinal: 2, done_at: null },
  ]);
});

/** jobs-closeout.md §9a's read-first and retirement script, as documented, for Writing 1. */
const retirement = () => {
  const blocks = sqlBlocks("jobs-closeout.md");
  const readFirst = blocks.find((b) => b.startsWith("SELECT t.id, t.title, t.locked_by, t.locked_at FROM tickets t WHERE t.filing_id = 7")).replaceAll("= 7", "= 1");
  const script = blocks.find((b) => b.startsWith("UPDATE filings SET retired_on")).replaceAll("= 7", "= 1");
  return { readFirst, script };
};

test("closing a Writing whose only wip job has lapsed is not blocked, and supersedes that job", async (t) => {
  const m = await fixture(t);
  await stamp(m.dbPath, 2, 61);
  await submissionDataExecute(m.dbPath, "UPDATE tickets SET status = 'queued', locked_by = NULL, locked_at = NULL WHERE id = 3");
  const { readFirst, script } = retirement();
  assert.deepEqual(query(m.dbPath, readFirst), []);
  await submissionDataExecute(m.dbPath, script);
  assert.equal(query(m.dbPath, "SELECT retired_on FROM filings WHERE id = 1")[0].retired_on, "2026-09-08");
  assert.deepEqual(row(m.dbPath, 2), { status: "superseded", locked_by: null, locked_at: null, plan_approved_at: "2026-10-01 08:30" });
});

test("a job held under 60 minutes still refuses the close", async (t) => {
  const m = await fixture(t);
  await stamp(m.dbPath, 2, 59);
  await stamp(m.dbPath, 3, 61);
  const { readFirst, script } = retirement();
  assert.deepEqual(query(m.dbPath, readFirst).map((r) => r.id), [2]);
  await submissionDataExecute(m.dbPath, script);
  assert.equal(query(m.dbPath, "SELECT retired_on FROM filings WHERE id = 1")[0].retired_on, null);
  assert.equal(row(m.dbPath, 2).status, "wip");
});

test("heldClause, the server's held test, reads a lock idle 59 minutes as held and one idle 61 minutes as not", async (t) => {
  const m = await fixture(t);
  await stamp(m.dbPath, 2, 59);
  await stamp(m.dbPath, 3, 61);
  assert.deepEqual(query(m.dbPath, `SELECT id FROM tickets WHERE ${heldClause(m.dbPath)} ORDER BY id`), [{ id: 2 }]);
  const { readFirst } = retirement();
  assert.deepEqual(query(m.dbPath, readFirst).map((r) => r.id), [2], "the skills' held test agrees");
});

test("a render that writes pages leaves another session's lapsed lock on its row", async (t) => {
  const m = await fixture(t);
  const context = await practiceContext(t);
  await callTool(context, "drafting_forms__render", { db_path: m.dbPath, filing_id: 1, draft_dir: m.draft, session_token: "sess-own", documents: ["Work_board"] });
  assert.equal(row(m.dbPath, 2).locked_by, "sess-other");
  assert.equal(kv(m.dbPath, "lock_lapsed", 2), undefined);
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
