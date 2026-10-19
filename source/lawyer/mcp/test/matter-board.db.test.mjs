// The Litigation Strategy (ADR 0021, #871; the Matter Board of #583-#585, then the To Do List, renamed): bootstrap writes one
// self-contained Litigation Strategy.html into the matter's 0. DRAFT folder, and every render that writes
// presentation copies rewrites it. The matter's open to-dos lead it, read from the practice
// registry through practice_data__open_tasks; each filing below is one line. The browser check is
// in workboard-file-url.e2e.test.mjs.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { after } from "node:test";

import { startFakeCloud } from "./helpers/fake-cloud.mjs";

// Bootstrap through the dispatch starts the background render job (#589): its locks and status
// mirrors stay out of the practitioner's %LOCALAPPDATA%.
process.env.COCLERK_SUBMISSION_LOCK_ROOT = mkdtempSync(join(tmpdir(), "coclerk-todo-list-locks-"));
after(() => rmSync(process.env.COCLERK_SUBMISSION_LOCK_ROOT, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));

const { freshSubmissionDb } = await import("./helpers/template-db.mjs");
const { writePartiesOfRecord } = await import("./helpers/matter-data-fixture.mjs");
const { submissionDataExecute } = await import("../build/submission/backend.js");
const { submissionFormsBootstrap, submissionFormsRender } = await import("../build/submission/forms.js");
const { WORKBOARD_CSS } = await import("../build/submission/forms/workboard-assets.js");
const { callTool, createDispatchContext } = await import("../build/index.js");
const { awaitBackgroundJobs } = await import("../build/submission/render-job.js");
const writes = await import("../build/tools/practice/writes.js");
const { readBoardData } = await import("./fixtures/forms-render-seeds.mjs");

const PINNED = "2026-09-15 10:00";
const LARCHMONT = { clientName: "Larchmont", clientNo: "1", matterNo: "L8470" };
const DATA_PREFIX = "window.MATTER_BOARD = ";
const PAGE = "Litigation Strategy.html";
/** Each live filing's Job Board page (ADR 0033, 2026-10-05 amendment); filing 3 is retired and has none. */
const JOB_BOARD = {
  1: "Job Board 1.html",
  2: "Job Board 2.html",
  4: "Job Board 4.html",
};

async function fixture({ seed = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "coclerk-todo-list-"));
  const dbPath = join(dir, "submission.sqlite");
  await freshSubmissionDb(dbPath);
  if (seed) await seedMatter(dbPath);
  const draft = join(dir, "L8470 Matter", "0. DRAFT");
  mkdirSync(draft, { recursive: true });
  return { dir, dbPath, draft, cleanup: () => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) };
}

// Proceeding 1: filing 1 (busy), filing 2 (a stored hearing two days out), filing 3 (retired).
// Proceeding 2: filing 4, untouched. A proceeding-scoped ticket and seed in proceeding 1 sit on
// filings 1 and 2 and nowhere else. The hearing date must never reach the page (#583 §6).
// The case data both proceedings' parties are linked to, holding their counsel (party/counsel SSOT).
const MATTER_CASE_DATA = {
  proceedings: [
    { id: 1, file_number: "S-290002" },
    { id: 2, file_number: "S-240001" },
  ],
  parties: [
    { id: 1, name: "Larchmont (B.C.) Inc.", counsel_name: "C. Lawyer", of_record: [[1, "plaintiff"]] },
    { id: 2, name: "Example Defendant Ltd.", counsel_name: "D. Lawyer", of_record: [[1, "defendant"]] },
    { id: 3, name: "Larchmont (B.C.) Inc.", counsel_name: "C. Lawyer", of_record: [[2, "plaintiff"]] },
    { id: 4, name: "Other Defendant Ltd.", counsel_name: "E. Lawyer", of_record: [[2, "defendant"]] },
  ],
};

async function seedMatter(dbPath) {
  writePartiesOfRecord(dirname(dbPath), MATTER_CASE_DATA);
  await submissionDataExecute(
    dbPath,
    `
    INSERT INTO proceedings (id, matter_reference, forum, court_or_centre, registry, file_number, style_of_cause, courthouse_address)
      VALUES (1, 'L8470 - Larchmont', 'CAN/BC/BCSC', 'BC Supreme Court', 'Vancouver', 'S-290002', 'Larchmont v. Example', NULL),
             (2, 'L8470 - Larchmont', 'CAN/BC/BCSC', 'BC Supreme Court', 'Vancouver', 'S-240001', 'Larchmont v. Other', NULL);
    INSERT INTO parties (id, proceeding_id, name, role, ordinal, is_client, is_applicant, to_be_served, case_party_id)
      VALUES (1, 1, 'Larchmont (B.C.) Inc.', 'Plaintiff', 1, 1, 1, 0, 1),
             (2, 1, 'Example Defendant Ltd.', 'Defendant', 2, 0, 0, 1, 2),
             (3, 2, 'Larchmont (B.C.) Inc.', 'Plaintiff', 1, 1, 1, 0, 3),
             (4, 2, 'Other Defendant Ltd.', 'Defendant', 2, 0, 0, 1, 4);
    INSERT INTO order_sought (id, proceeding_id, wording)
      VALUES (1, 1, 'the style of cause is corrected'), (2, 1, 'the time for service is extended'),
             (3, 1, 'the claim is dismissed by consent'), (4, 2, 'the trial date is adjourned');
    INSERT INTO filings (id, proceeding_id, kind, subkind, round, title)
      VALUES (1, 1, 'requisition_consent', 'consent', NULL, 'First Consent Order Requisition'),
             (2, 1, 'requisition_consent', 'consent', NULL, 'Second Consent Order Requisition'),
             (3, 1, 'requisition_consent', 'consent', NULL, 'Withdrawn Consent Order Requisition'),
             (4, 2, 'requisition_consent', 'consent', NULL, 'Adjournment Consent Order Requisition');
    INSERT INTO filing_orders (filing_id, order_sought_id, document, ordinal) VALUES (1, 1, 'form', 1), (2, 2, 'form', 1), (3, 3, 'form', 1), (4, 4, 'form', 1);
    UPDATE filings SET retired_on = '2026-09-10', retirement_reason = 'settled' WHERE id = 3;
    INSERT INTO hearing_details (id, filing_id, hearing_date) VALUES (1, 2, '2026-09-17');

    INSERT INTO tickets (id, proceeding_id, filing_id, title, intent, status, priority, kind, billing_anchor, locked_by, locked_at, created, completed_at, superseded_by)
      VALUES (1, 1, 1, 'Draft the orders </script><b>sought</b>', 'Part 1.', 'queued', 0, 'work', 'L8470', NULL, NULL, '2026-09-14 09:00', NULL, NULL),
             (2, 1, 1, 'Settle the requisition', 'Settle it.', 'wip', 0, 'work', 'L8470', 'sess-a', '2026-09-15 08:30', '2026-09-14 09:05', NULL, NULL),
             (3, 1, 1, 'Collect the consent', 'Get it signed.', 'completed', 0, 'work', 'L8470', NULL, NULL, '2026-09-10 09:00', '2026-09-12 10:00', NULL),
             (4, 1, 1, 'File the requisition', 'File it.', 'queued', 0, 'work', 'L8470', NULL, NULL, '2026-09-14 09:10', NULL, NULL),
             (5, 1, NULL, 'Confirm the style of cause', 'Check the pleadings.', 'queued', 0, 'charting', NULL, NULL, NULL, '2026-09-13 09:00', NULL, NULL),
             (6, 1, 2, 'Old approach', 'Abandoned.', 'superseded', 0, 'work', 'L8470', NULL, NULL, '2026-09-11 09:00', NULL, NULL),
             (7, 1, 2, 'Follow the old approach', 'Depends on it.', 'queued', 0, 'work', 'L8470', NULL, NULL, '2026-09-11 09:05', NULL, NULL);
    INSERT INTO ticket_blocks (blocker_id, blocked_id) VALUES (2, 4), (6, 7);
    INSERT INTO seeds (id, proceeding_id, filing_id, origin_ticket_id, created, surfaced_by, idea, charted_into)
      VALUES (1, 1, 1, NULL, '2026-09-14 11:00', 'noticed', 'Serve the guarantor too?', NULL),
             (2, 1, NULL, NULL, '2026-09-13 11:00', 'noticed', 'Ask about costs.', NULL),
             (3, 1, 2, NULL, '2026-09-12 11:00', 'noticed', 'Already charted.', 5);

    UPDATE db_meta SET value = '1' WHERE key = 'revision';
    `.trim()
  );
}

function readBoard(path) {
  const html = readFileSync(path, "utf-8");
  const line = html.split("\n").find((l) => l.startsWith(DATA_PREFIX));
  assert.ok(line, "expected a data line starting at column 0");
  const json = line.slice(DATA_PREFIX.length, -1);
  return { html, json, data: JSON.parse(json) };
}

function keysOf(value, out = []) {
  if (Array.isArray(value)) value.forEach((v) => keysOf(v, out));
  else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) out.push(k) && keysOf(v, out);
  return out;
}

const todo = (id, description, bf_date, filing_ref = null) => ({ id, description, bf_date, filing_ref });

/** A practice database with two matters, reached through the dispatch the way a session reaches it. */
async function practice(t) {
  const practicePath = join(tmpdir(), `coclerk-todo-list-practice-${randomUUID()}.db`);
  t.after(() => rmSync(practicePath, { force: true }));
  const context = await createDispatchContext({ ...process.env, ...(await startFakeCloud(t)).env, COCLERK_DB_PATH: practicePath });
  for (const [num, name] of [["L8470", "Larchmont"], ["L9999", "Other Client"]]) {
    await writes.upsert_client_matter(context.practiceDb, { client_num: `C-${num}`, name, matt_num: num, file_number: `F-${num}` });
  }
  const addTask = (args) => writes.upsert_task(context.practiceDb, { task_type: "client", ...args });
  return { context, practicePath, addTask };
}

/** Every practice item as practice.db stores it, nudge fields and updated_at included. */
function nudgeSnapshot(practicePath) {
  const python = process.env.COCLERK_PYTHON || "python";
  const script =
    "import json, sqlite3, sys\n" +
    "db = sqlite3.connect(sys.argv[1])\n" +
    "print(json.dumps([list(r) for r in db.execute(\"SELECT key, value FROM kv_store WHERE namespace = 'item' ORDER BY key\")]))\n";
  const result = spawnSync(python, ["-c", script, practicePath], { encoding: "utf-8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

test("bootstrap without draft_dir writes no Litigation Strategy and reports null", async () => {
  const f = await fixture();
  try {
    const result = submissionFormsBootstrap(f.dbPath, LARCHMONT, PINNED);
    assert.equal(result.matter_board_path, null);
    assert.equal(result.job_board_paths, null);
    assert.deepEqual(readdirSync(f.draft), [], "no Litigation Strategy and no Job Board page");
  } finally {
    f.cleanup();
  }
});

test("bootstrap with draft_dir writes one self-contained Litigation Strategy, each filing one line in the page's own order", async () => {
  const f = await fixture();
  try {
    const result = submissionFormsBootstrap(f.dbPath, LARCHMONT, PINNED, f.draft, { rows: [] });
    assert.equal(result.matter_board_path, join(f.draft, PAGE));
    const { html, json, data } = readBoard(result.matter_board_path);

    assert.ok(html.includes("data-matter-board-shell"), "expected the page's marker");
    assert.match(html, /<title>Litigation Strategy<\/title>/);
    assert.match(html, /<h1>Litigation Strategy<\/h1>/);
    assert.ok(!/Matter Board/.test(html), "the old name is gone from the page");
    assert.ok(!/<link/i.test(html), "no stylesheet link");
    assert.ok(!/<script[^>]*\bsrc=/i.test(html), "no external script");
    assert.ok(html.includes(WORKBOARD_CSS), "the stylesheet is inline");
    assert.ok(!json.includes("<"), "every < in the data is escaped");

    assert.deepEqual(Object.keys(data), ["meta", "todos", "filings", "pre_filing"], "to-dos lead the page data");
    assert.equal(Object.keys(data.meta)[0], "revision", "revision is the data line's first key");
    assert.deepEqual(data.meta, { revision: 1, matter: "L8470", client: "Larchmont", rendered: PINNED });
    assert.deepEqual(data.todos, []);
    assert.deepEqual(data.filings.map((x) => x.filing_id), [2, 1, 4, 3], "the page puts the imminent hearing first");
    assert.deepEqual(result.filings.map((x) => x.filing_id), [1, 2, 4, 3], "bootstrap's list is by recency alone");

    // D3: name, lifecycle state, mockup status and jobs in progress -- no counts, titles or ideas.
    const [second, first, other, retired] = data.filings;
    assert.deepEqual(first, {
      filing_id: 1,
      title: "First Consent Order Requisition",
      state: "drafting",
      state_label: "Drafting",
      state_since: null,
      render_state: "never",
      in_progress: 1,
    });
    assert.equal(second.in_progress, 0, "a proceeding-scoped job in progress would count here; none is");
    assert.equal(second.state, "drafting");
    assert.equal(other.in_progress, 0);
    for (const key of ["counts", "wip", "ready", "ideas", "proceeding"]) {
      assert.ok(!keysOf(data).includes(key), `no "${key}" left in the page data`);
    }
    assert.ok(!/Loose Threads|Shelved \(|Job #/.test(html), "no job counts, job titles or loose threads on the page");

    assert.equal(retired.state, "retired");
    assert.equal(retired.retired_on, "2026-09-10");
    assert.equal(retired.retirement_reason, "settled");
    assert.equal(retired.in_progress, undefined, "a retired filing carries no job count");
    assert.equal(retired.render_state, null);

    // ADR 0033, 2026-10-05 amendment: a Job Board page per live filing is written beside it, in the
    // page's order, the retired filing with none.
    assert.deepEqual(
      result.job_board_paths,
      [
        { filing_id: 2, proceeding_id: 1, path: join(f.draft, JOB_BOARD[2]) },
        { filing_id: 1, proceeding_id: 1, path: join(f.draft, JOB_BOARD[1]) },
        { filing_id: 4, proceeding_id: 2, path: join(f.draft, JOB_BOARD[4]) },
      ],
      "the Litigation Strategy's order, the retired filing omitted"
    );
    for (const { filing_id, proceeding_id, path } of result.job_board_paths) {
      const board = readBoardData(path);
      const file_number = MATTER_CASE_DATA.proceedings.find((p) => p.id === proceeding_id).file_number;
      const style_of_cause = { 1: "Larchmont v. Example", 2: "Larchmont v. Other" }[proceeding_id];
      assert.deepEqual(board.meta, {
        revision: 1, matter: "L8470", client: "Larchmont", rendered: PINNED,
        client_no: "1", forum: "CAN/BC/BCSC", registry: "Vancouver", file_number, style_of_cause,
      });
      assert.deepEqual(board.sections.map((x) => x.meta.filing_id), [filing_id], "one section, the page's own filing's");
    }
  } finally {
    f.cleanup();
  }
});

// #583 §6: the order is the whole signal. Nothing on the page names a hearing, a deadline or why
// a filing sits where it does -- a session that could read that off the page would learn what
// deadline isolation withholds.
test("the Litigation Strategy is silent about why filings sit in their order", async () => {
  const f = await fixture();
  try {
    const { html, data } = readBoard(submissionFormsBootstrap(f.dbPath, LARCHMONT, PINNED, f.draft, { rows: [todo("t1", "Chase the consent", "2026-09-20")] }).matter_board_path);
    assert.ok(!html.includes("2026-09-17"), "the stored hearing date must not reach the page");
    for (const key of keysOf(data)) {
      assert.ok(!/hearing|deadline|activity|imminen|rank/i.test(key), `unexpected key "${key}"`);
    }
  } finally {
    f.cleanup();
  }
});

// ADR 0021 D1, D2: the registry rows lead, each with its BF date as a plain date. The page adds no
// day count, no overdue marking and no reason for a to-do's position, whatever the date.
test("to-dos lead the page, each with its description and a plain BF date, by BF date, undated last", async () => {
  const f = await fixture();
  try {
    const rows = [todo("t-late", "Report to the client", "2026-10-01"), todo("t-none", "Tidy the file", null), todo("t-past", "Chase the consent </script>", "2026-09-01")];
    const { html, json, data } = readBoard(submissionFormsBootstrap(f.dbPath, LARCHMONT, PINNED, f.draft, { rows }).matter_board_path);
    assert.deepEqual(data.todos, [
      { id: "t-past", description: "Chase the consent </script>", bf_date: "2026-09-01" },
      { id: "t-late", description: "Report to the client", bf_date: "2026-10-01" },
      { id: "t-none", description: "Tidy the file", bf_date: null },
    ]);
    assert.equal(data.todos_note, undefined);
    assert.ok(!json.includes("<"), "a description cannot close the script");
    assert.ok(!/overdue|days? (ago|left|remaining)|\bdue\b|today|tomorrow/i.test(html), "no relative or overdue wording anywhere on the page");
  } finally {
    f.cleanup();
  }
});

// ADR 0021 D5: the pointer shows that filing's one line under the to-do, and the filing stays in
// the list below. A pointer that no longer resolves draws no line and fails nothing.
test("a to-do's filing pointer resolves on the page, and one that no longer resolves draws nothing", async () => {
  const f = await fixture();
  try {
    const rows = [
      todo("t1", "Settle the first requisition", "2026-09-01", "filing:1"),
      todo("t2", "A filing since deleted", "2026-09-02", "filing:99"),
      todo("t3", "A proceeding that now has filings", "2026-09-03", "proceeding:1"),
      todo("t4", "The settled one", "2026-09-04", "filing:3"),
      todo("t5", "Unpointed", "2026-09-05"),
    ];
    const { data } = readBoard(submissionFormsBootstrap(f.dbPath, LARCHMONT, PINNED, f.draft, { rows }).matter_board_path);
    const byId = Object.fromEntries(data.todos.map((x) => [x.id, x]));
    assert.equal(byId.t1.filing_id, 1);
    assert.ok(data.filings.some((x) => x.filing_id === 1), "the filing is still listed among the filings");
    for (const id of ["t2", "t3", "t5"]) {
      assert.deepEqual(Object.keys(byId[id]), ["id", "description", "bf_date"], `${id} carries no pointer`);
    }
    assert.equal(byId.t4.filing_id, 3, "a retired filing still resolves: it is listed at the foot");
  } finally {
    f.cleanup();
  }
});

test("a matter with no filings still gets a page, with nothing on it", async () => {
  const f = await fixture({ seed: false });
  try {
    const { data } = readBoard(submissionFormsBootstrap(f.dbPath, LARCHMONT, PINNED, f.draft, { rows: [] }).matter_board_path);
    assert.deepEqual(data.filings, []);
    assert.deepEqual(data.todos, []);
  } finally {
    f.cleanup();
  }
});

test("bootstrap never overwrites a Litigation Strategy.html this server did not write", async () => {
  const f = await fixture();
  try {
    const target = join(f.draft, PAGE);
    writeFileSync(target, "<html><body>the practitioner's own notes</body></html>", "utf-8");
    assert.throws(() => submissionFormsBootstrap(f.dbPath, LARCHMONT, PINNED, f.draft), /refusing to overwrite.*Litigation Strategy's marker/);
    assert.equal(readFileSync(target, "utf-8"), "<html><body>the practitioner's own notes</body></html>");

    writeFileSync(target, '<html lang="en" data-matter-board-shell>an older page</html>', "utf-8");
    submissionFormsBootstrap(f.dbPath, LARCHMONT, PINNED, f.draft);
    assert.ok(readBoard(target).data.filings.length === 4, "the server's own page is replaced");
  } finally {
    f.cleanup();
  }
});

// The rename (#871), as #869 retired Work Board.html: a Matter Board.html goes once Litigation Strategy.html
// is written beside it, and only when its marker proves this renderer wrote it. Since #1365 (D3) it
// goes into the matter's TRASH, never deleted, which needs the matter's coclerk.json.
test("writing the Litigation Strategy moves a Matter Board.html this renderer wrote into TRASH, and nothing else", async () => {
  const f = await fixture();
  try {
    const matterRoot = dirname(f.draft);
    writeFileSync(join(matterRoot, "coclerk.json"), JSON.stringify({ schema_version: 5, matter_root: matterRoot, case_data_dir: f.dir, evidence_sql_path: "x.sql" }), "utf-8");
    const old = join(f.draft, "Matter Board.html");
    const ours = '<!doctype html>\n<html lang="en" data-matter-board-shell>\n<title>Matter Board</title>\n</html>\n';

    writeFileSync(old, ours, "utf-8");
    writeFileSync(join(f.draft, PAGE), "the practitioner's own notes", "utf-8");
    assert.throws(() => submissionFormsBootstrap(f.dbPath, LARCHMONT, PINNED, f.draft), /refusing to overwrite/);
    assert.ok(existsSync(old), "a failed write moves nothing");
    rmSync(join(f.draft, PAGE));

    const boot = submissionFormsBootstrap(f.dbPath, LARCHMONT, PINNED, f.draft);
    assert.ok(existsSync(join(f.draft, PAGE)));
    assert.equal(existsSync(old), false, "bootstrap moves the renderer's own Matter Board.html");
    assert.equal(readFileSync(join(matterRoot, "TRASH", "0. DRAFT", "Matter Board.html"), "utf-8"), ours, "into the matter's TRASH");
    assert.deepEqual(boot.moved_to_trash.map((x) => x.from.toLowerCase()), [old.toLowerCase()]);

    writeFileSync(old, ours, "utf-8");
    const rendered = submissionFormsRender(f.dbPath, 1, LARCHMONT, "mockup", undefined, undefined, join(f.draft, "REQ First Consent Order Requisition"), PINNED);
    assert.equal(existsSync(old), false, "so does a render that rewrites the page");
    assert.deepEqual(rendered.moved_to_trash.map((x) => x.from.toLowerCase()), [old.toLowerCase()]);

    writeFileSync(old, "<html><body>the practitioner's own Matter Board</body></html>", "utf-8");
    submissionFormsBootstrap(f.dbPath, LARCHMONT, PINNED, f.draft);
    assert.equal(readFileSync(old, "utf-8"), "<html><body>the practitioner's own Matter Board</body></html>", "one without the marker is left alone");
  } finally {
    f.cleanup();
  }
});

test("bootstrap refuses a draft_dir it cannot confine, writing nothing", async () => {
  const f = await fixture();
  try {
    const notDraft = join(f.dir, "L8470 Matter", "Drafts");
    const privileged = join(f.dir, "privileged", "0. DRAFT");
    mkdirSync(notDraft, { recursive: true });
    mkdirSync(privileged, { recursive: true });

    assert.throws(() => submissionFormsBootstrap(f.dbPath, LARCHMONT, PINNED, "0. DRAFT"), /absolute path/);
    assert.throws(() => submissionFormsBootstrap(f.dbPath, LARCHMONT, PINNED, notDraft), /0\. DRAFT folder/);
    assert.throws(() => submissionFormsBootstrap(f.dbPath, LARCHMONT, PINNED, privileged), /privileged or disclosed/);
    assert.throws(() => submissionFormsBootstrap(f.dbPath, LARCHMONT, PINNED, join(f.dir, "L8470 Matter", "0. DRAFT gone")), /does not exist/);
    for (const dir of [notDraft, privileged]) assert.equal(existsSync(join(dir, PAGE)), false);
  } finally {
    f.cleanup();
  }
});

test("the page write is its own bootstrap phase, and still renders nothing", async () => {
  const f = await fixture();
  try {
    const { timings } = submissionFormsBootstrap(f.dbPath, LARCHMONT, PINNED, f.draft);
    const phases = timings.map((t) => t.phase);
    assert.ok(phases.includes("matter_pages"), `expected a matter_pages phase in ${JSON.stringify(phases)}`);
    for (const phase of phases) assert.ok(!/^render |^write |board_write|^filing \d+:/.test(phase), `bootstrap must render nothing: found phase "${phase}"`);
  } finally {
    f.cleanup();
  }
});

// #583 §4: a page rewritten only at bootstrap would miss a job this session was just assigned.
// Every render that writes presentation copies rewrites the matter's pages -- the full render, the
// stamp hit, the retired filing's render, and a render given draft_dir.
test("every render with presentation_dir or draft_dir rewrites the Litigation Strategy and the Job Board pages beside the copies", async () => {
  const f = await fixture();
  try {
    const page = join(f.draft, PAGE);
    const jobBoard = join(f.draft, JOB_BOARD[1]);
    const otherBoard = join(f.draft, JOB_BOARD[4]);
    const lineOf = (id) => readBoard(page).data.filings.find((x) => x.filing_id === id);
    const leaf = join(f.draft, "2026-09-15 REQ First Consent Order Requisition");
    const rows = [todo("t1", "Settle the first requisition", "2026-09-01", "filing:1")];

    const full = submissionFormsRender(f.dbPath, 1, LARCHMONT, "mockup", undefined, undefined, leaf, PINNED, undefined, undefined, { rows });
    assert.ok(full.timings.some((t) => t.phase === "matter_pages"));
    assert.ok(existsSync(jobBoard), "the filing's Job Board page is written beside the Litigation Strategy");
    assert.ok(existsSync(otherBoard), "and every other live filing's");
    assert.equal(lineOf(1).in_progress, 1);
    assert.equal(lineOf(1).render_state, "fresh", "the render just wrote this filing's manifest");
    assert.deepEqual(readBoard(page).data.todos, [{ id: "t1", description: "Settle the first requisition", bf_date: "2026-09-01", filing_id: 1 }], "the render draws the to-dos it is given");

    // An assignment is a job write, exempt from the revision bump, so the next render is a stamp hit.
    await submissionDataExecute(f.dbPath, "UPDATE tickets SET status = 'wip', locked_by = 'sess-b', locked_at = '2026-09-15 10:05' WHERE id = 1");
    const hit = submissionFormsRender(f.dbPath, 1, LARCHMONT, "mockup", undefined, undefined, leaf, "2026-09-15 10:07");
    assert.equal(hit.rendered_at, full.rendered_at, "expected a stamp hit");
    assert.equal(lineOf(1).in_progress, 2);
    assert.equal(readBoardData(jobBoard).meta.rendered, "2026-09-15 10:07", "the stamp hit rewrites the Job Board pages too");

    rmSync(page);
    rmSync(jobBoard);
    const retired = submissionFormsRender(f.dbPath, 3, LARCHMONT, "mockup", undefined, undefined, join(f.draft, "2026-09-10 REQ Withdrawn Consent Order Requisition"), PINNED);
    assert.equal(retired.filing_retired, true);
    assert.ok(existsSync(page), "the retired filing's render rewrites the Litigation Strategy too");
    assert.ok(existsSync(jobBoard), "and the live filings' Job Board pages");
    assert.equal(existsSync(join(f.draft, "Job Board 3.html")), false, "the retired filing has none");

    rmSync(page);
    rmSync(otherBoard);
    const fromDraft = submissionFormsRender(f.dbPath, 4, LARCHMONT, "mockup", undefined, undefined, undefined, PINNED, undefined, f.draft);
    assert.ok(existsSync(page) && existsSync(otherBoard), "a render given draft_dir writes the matter's pages");
    assert.equal(fromDraft.documents.find((d) => d.document_type === "Work_board").path, otherBoard);

    rmSync(page);
    for (const name of Object.values(JOB_BOARD)) rmSync(join(f.draft, name));
    submissionFormsRender(f.dbPath, 1, LARCHMONT, "mockup", undefined, undefined, undefined, PINNED);
    assert.equal(existsSync(page), false, "a render without presentation_dir writes nothing in the draft folder");
    assert.equal(existsSync(jobBoard), false);
  } finally {
    f.cleanup();
  }
});

// D1: the to-dos are the matter's own open registry rows, read through the practice gatekeeper's
// open_tasks the way open_session looks the matter up.
test("through the dispatch, the page lists this matter's open to-dos and no other matter's or completed one", async (t) => {
  const f = await fixture();
  const p = await practice(t);
  try {
    await p.addTask({ matt_num: "L8470", description: "Settle the first requisition", next_nudge_date: "2026-09-20", filing_ref: "filing:1" });
    await p.addTask({ matt_num: "L8470", description: "Report to the client", next_nudge_date: "2026-09-10" });
    const done = await p.addTask({ matt_num: "L8470", description: "Collect the retainer" });
    await writes.complete_task(p.context.practiceDb, { id: done.id });
    await p.addTask({ matt_num: "L9999", description: "Another matter's to-do" });
    await p.addTask({ task_type: "admin", description: "CLE reporting" });

    const result = await callTool(p.context, "drafting_forms__bootstrap", { db_path: f.dbPath, matter_no: "L8470", draft_dir: f.draft });
    const { data } = readBoard(result.matter_board_path);
    assert.deepEqual(data.todos.map((x) => x.description), ["Report to the client", "Settle the first requisition"]);
    assert.equal(data.todos[1].filing_id, 1);
    assert.ok(result.timings.some((x) => x.phase === "todos"), "the registry read is its own phase");

    await callTool(p.context, "drafting_forms__render", { db_path: f.dbPath, filing_id: 2, matter_no: "L8470", draft_dir: f.draft });
    assert.deepEqual(readBoard(result.matter_board_path).data.todos.map((x) => x.description), ["Report to the client", "Settle the first requisition"], "a render rewrites the page with the same to-dos");
  } finally {
    await awaitBackgroundJobs();
    f.cleanup();
  }
});

// ADR 0013 and ADR 0021 D2: a to-do's deadline_date is withheld from drafting sessions, and the
// page is presented at /draft session entry. It stops at the registry read.
test("a to-do's deadline_date never reaches the page or its data", async (t) => {
  const f = await fixture();
  const p = await practice(t);
  try {
    await p.addTask({ matt_num: "L8470", description: "Settle the first requisition", deadline_date: "2026-10-15", next_nudge_date: "2026-09-20", time_estimate_hours: 2 });

    const boot = await callTool(p.context, "drafting_forms__bootstrap", { db_path: f.dbPath, matter_no: "L8470", draft_dir: f.draft });
    const checkPage = (when) => {
      const { html, data } = readBoard(boot.matter_board_path);
      assert.equal(data.todos.length, 1, `${when}: the to-do is on the page`);
      assert.deepEqual(Object.keys(data.todos[0]), ["id", "description", "bf_date"], `${when}: nothing else of the row`);
      assert.ok(!html.includes("2026-10-15"), `${when}: the deadline's value is not in the HTML or its data`);
      assert.ok(!/deadline|\bdue\b/i.test(html), `${when}: no deadline label anywhere on the page`);
    };
    checkPage("bootstrap");

    await callTool(p.context, "drafting_forms__render", { db_path: f.dbPath, filing_id: 1, matter_no: "L8470", draft_dir: f.draft });
    checkPage("render");
  } finally {
    await awaitBackgroundJobs();
    f.cleanup();
  }
});

// ADR 0021 D2: presenting the page writes nothing to the nudge fields; advancing them stays
// task-prioritization's briefing-mode job.
test("writing the page leaves every nudge field byte-identical", async (t) => {
  const f = await fixture();
  const p = await practice(t);
  try {
    await p.addTask({ matt_num: "L8470", description: "Chase the consent", next_nudge_date: "2026-09-01", nudge_interval_days: 7, last_nudged_at: "2026-08-25T10:00:00.000Z" });
    await p.addTask({ matt_num: "L8470", description: "One-shot", next_nudge_date: "2026-09-14" });
    const before = nudgeSnapshot(p.practicePath);

    await callTool(p.context, "drafting_forms__bootstrap", { db_path: f.dbPath, matter_no: "L8470", draft_dir: f.draft });
    await callTool(p.context, "drafting_forms__render", { db_path: f.dbPath, filing_id: 1, matter_no: "L8470", draft_dir: f.draft });

    assert.equal(nudgeSnapshot(p.practicePath), before);
  } finally {
    await awaitBackgroundJobs();
    f.cleanup();
  }
});

test("a page whose to-dos could not be read says why, and the session still opens", async (t) => {
  const f = await fixture();
  const p = await practice(t);
  try {
    // #883: with no matter_no, the matter folder's own number is read, so this one carries none.
    const unnumberedDraft = join(f.dir, "Unnumbered Matter", "0. DRAFT");
    mkdirSync(unnumberedDraft, { recursive: true });
    const unnumbered = await callTool(p.context, "drafting_forms__bootstrap", { db_path: f.dbPath, draft_dir: unnumberedDraft });
    let { data } = readBoard(unnumbered.matter_board_path);
    assert.deepEqual(data.todos, []);
    assert.match(data.todos_note, /No matter number/);

    const unknown = await callTool(p.context, "drafting_forms__bootstrap", { db_path: f.dbPath, matter_no: "L0000", draft_dir: f.draft });
    ({ data } = readBoard(unknown.matter_board_path));
    assert.deepEqual(data.todos, []);
    assert.match(data.todos_note, /could not be read.*No matter matched/);
    assert.equal(unknown.filings.length, 4, "the filings are listed all the same");
  } finally {
    await awaitBackgroundJobs();
    f.cleanup();
  }
});
