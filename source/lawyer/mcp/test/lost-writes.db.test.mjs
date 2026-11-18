// Spec 2026-11-17 drafting-records sync safety, slice S5: section 3.2 (the lost-write check), the write-record
// sign of section 3.1 and decision D2 (accept_current_file), criteria 4 and 6. Each test runs the tool against a
// temp matter folder and asserts on the files on disk. Two computers are simulated by two host-local roots.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

import { startFakeCloud } from "./helpers/fake-cloud.mjs";

const ROOTS = { A: mkdtempSync(join(tmpdir(), "coclerk-lost-writes-A-")), B: mkdtempSync(join(tmpdir(), "coclerk-lost-writes-B-")) };
process.env.COCLERK_SUBMISSION_LOCK_ROOT = ROOTS.A;
after(() => Object.values(ROOTS).forEach((dir) => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })));

const { callTool, createDispatchContext } = await import("../build/index.js");
const { awaitBackgroundJobs } = await import("../build/submission/render-job.js");
const { freshSubmissionDb } = await import("./helpers/template-db.mjs");
const { submissionDataExecute, submissionDataQuery } = await import("../build/submission/backend.js");
const { closePageServer } = await import("../build/housekeeping/server.js");
after(() => closePageServer());

/** The environment of computer A or B: its own host-local root. */
const computer = (name) => ({ ...process.env, COCLERK_SUBMISSION_LOCK_ROOT: ROOTS[name] });

/** Makes `name` the computer the tool calls below run on (they read process.env). */
function on(name) {
  process.env.COCLERK_SUBMISSION_LOCK_ROOT = ROOTS[name];
}

function matterFixture(t) {
  // The long form of the temp path, as session entry resolves it, so both key the same host-local record.
  const base = realpathSync.native(mkdtempSync(join(tmpdir(), "coclerk-lost-writes-")));
  t.after(async () => {
    await awaitBackgroundJobs();
    on("A");
    rmSync(base, { recursive: true, force: true });
  });
  const matterRoot = join(base, "L9999 Test Matter");
  const caseDataDir = join(matterRoot, "0. CASE DATA");
  const draftDir = join(matterRoot, "0. DRAFT");
  mkdirSync(caseDataDir, { recursive: true });
  mkdirSync(draftDir);
  mkdirSync(join(base, "0. CASE DATA"));
  writeFileSync(
    join(matterRoot, "coclerk.json"),
    JSON.stringify({ schema_version: 5, matter_root: matterRoot, case_data_dir: "0. CASE DATA", evidence_sql_path: "4. LAWYER BRIEF\\CoWork\\evidence.sql" }),
    "utf-8"
  );
  return { base, matterRoot, caseDataDir, draftDir, dbPath: join(caseDataDir, "submission.sqlite") };
}

async function practiceContext(t) {
  const practicePath = join(tmpdir(), `coclerk-lost-writes-practice-${randomUUID()}.db`);
  t.after(() => rmSync(practicePath, { recursive: true, force: true }));
  return createDispatchContext({ ...process.env, ...(await startFakeCloud(t)).env, COCLERK_DB_PATH: practicePath });
}

async function rejection(promise) {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error("expected a rejection, got none");
}

const tree = (dir) => readdirSync(dir, { recursive: true }).map(String).sort();
const note = (key) => `INSERT INTO db_meta (key, value) VALUES ('${key}', '1');`;
const writeCounts = (dbPath) =>
  Object.fromEntries(submissionDataQuery(dbPath, "SELECT key, value FROM db_meta WHERE key LIKE 'writes:%'").rows.map((r) => [r.key, Number(r.value)]));
const openSession = async (t, m, extra = {}) => callTool(await practiceContext(t), "drafting_forms__open_session", { matter_root: m.matterRoot, ...extra });
const migrate = (m, extra = {}) => callTool({}, "drafting_data__migrate", { db_path: m.dbPath, ...extra });

/** Computer A writes twice; the live file is then replaced by the copy taken between the two writes. */
async function replacedByOlderCopy(t) {
  const m = matterFixture(t);
  await freshSubmissionDb(m.dbPath);
  await submissionDataExecute(m.dbPath, note("first"), computer("A"));
  const older = readFileSync(m.dbPath);
  await submissionDataExecute(m.dbPath, note("second"), computer("A"));
  writeFileSync(m.dbPath, older);
  return m;
}

test("a committed write records its count in the file, and a write that changes nothing does not", async (t) => {
  const m = matterFixture(t);
  await freshSubmissionDb(m.dbPath);
  await submissionDataExecute(m.dbPath, note("first"), computer("A"));
  await submissionDataExecute(m.dbPath, note("second"), computer("A"));
  const counts = writeCounts(m.dbPath);
  assert.deepEqual(Object.values(counts), [2], JSON.stringify(counts));
  const bytes = readFileSync(m.dbPath);

  const result = await submissionDataExecute(m.dbPath, "UPDATE db_meta SET value = value WHERE key = 'nothing';", computer("A"));

  assert.equal(result.ok, true);
  assert.equal(result.writer_writes, undefined, "the count stays out of the tool result");
  assert.deepEqual(readFileSync(m.dbPath), bytes, "a no-op write leaves the file alone");
});

// Criterion 6, first half.
test("a file replaced by an older copy of itself is refused lost_writes at session entry, and nothing is written", async (t) => {
  const m = await replacedByOlderCopy(t);
  const bytes = readFileSync(m.dbPath);
  const before = tree(m.matterRoot);

  const err = await rejection(openSession(t, m));

  assert.equal(err.code, "lost_writes", err.message);
  assert.match(err.message, /^lost_writes: /);
  assert.match(err.message, /\b1 change/, "names the count missing");
  assert.doesNotMatch(err.message, /writes:[0-9a-f]{8}|writer|db_meta/i, "no internals");
  assert.deepEqual(readFileSync(m.dbPath), bytes);
  assert.deepEqual(tree(m.matterRoot), before);
});

test("a file replaced by an older copy of itself is refused lost_writes at the next write, and nothing is written", async (t) => {
  const m = await replacedByOlderCopy(t);
  const bytes = readFileSync(m.dbPath);

  const err = await rejection(submissionDataExecute(m.dbPath, note("third"), computer("A")));

  assert.equal(err.code, "lost_writes", err.message);
  assert.match(err.message, /\b1 change/);
  assert.deepEqual(readFileSync(m.dbPath), bytes);
});

test("a file with this computer's count missing altogether is refused lost_writes", async (t) => {
  const m = matterFixture(t);
  await freshSubmissionDb(m.dbPath);
  const blank = readFileSync(m.dbPath);
  await submissionDataExecute(m.dbPath, note("first"), computer("A"));
  writeFileSync(m.dbPath, blank);

  const err = await rejection(submissionDataExecute(m.dbPath, note("second"), computer("A")));

  assert.equal(err.code, "lost_writes", err.message);
  assert.deepEqual(readFileSync(m.dbPath), blank);
});

test("the other computer's writes never trip this computer's check", async (t) => {
  const m = matterFixture(t);
  await freshSubmissionDb(m.dbPath);
  await submissionDataExecute(m.dbPath, note("a1"), computer("A"));
  await submissionDataExecute(m.dbPath, note("b1"), computer("B"));
  await submissionDataExecute(m.dbPath, note("a2"), computer("A"));
  await submissionDataExecute(m.dbPath, note("b2"), computer("B"));
  assert.deepEqual(Object.values(writeCounts(m.dbPath)).sort(), [2, 2]);
});

// Criterion 6, second half.
test("a file produced by split_merge from two copies is refused on neither computer", async (t) => {
  const m = matterFixture(t);
  await freshSubmissionDb(m.dbPath);
  await submissionDataExecute(m.dbPath, note("shared"), computer("A"));
  await submissionDataExecute(m.dbPath, note("shared_b"), computer("B"));
  const start = readFileSync(m.dbPath);
  // The split: each computer goes on writing its own copy from the same start.
  await submissionDataExecute(m.dbPath, note("only_a"), computer("A"));
  const copyA = readFileSync(m.dbPath);
  writeFileSync(m.dbPath, start);
  await submissionDataExecute(m.dbPath, note("only_b"), computer("B"));
  await submissionDataExecute(m.dbPath, note("only_b2"), computer("B"));
  const copyB = readFileSync(m.dbPath);
  unlinkSync(m.dbPath);
  writeFileSync(join(m.caseDataDir, "submission-DEV_A.sqlite"), copyA);
  writeFileSync(join(m.caseDataDir, "submission-DEV_B.sqlite"), copyB);

  const d = await callTool({}, "drafting_data__split_merge", { matter_root: m.matterRoot, op: "diff" });
  assert.ok(d.differences.every((x) => x.table !== "db_meta" || !String(x.key.key).startsWith("writes:")), "the write counts are resolved, never asked");
  const decisions = Object.fromEntries(d.differences.map((x) => [x.id, x.kind === "only_b" ? "b" : "a"]));
  const merged = await callTool({}, "drafting_data__split_merge", { matter_root: m.matterRoot, op: "merge", sha256: d.inputs.map((i) => i.sha256), decisions });
  for (const side of ["A", "B"]) unlinkSync(join(m.caseDataDir, `submission-DEV_${side}.sqlite`));
  renameSync(merged.out, m.dbPath);
  assert.deepEqual(Object.values(writeCounts(m.dbPath)).sort(), [2, 3], "each count at the higher of the two copies");

  for (const name of ["A", "B"]) {
    on(name);
    await openSession(t, m);
    await awaitBackgroundJobs();
    const result = await submissionDataExecute(m.dbPath, note(`after_${name}`), computer(name));
    assert.equal(result.ok, true, `computer ${name}`);
  }
});

// Criterion 4, the third sign.
for (const [entry, call] of Object.entries({ "session entry": openSession, "drafting_data__migrate": (_t, m, extra) => migrate(m, extra) })) {
  test(`${entry} with submission.sqlite missing and this computer's write record present refuses earlier_work_missing`, async (t) => {
    const m = matterFixture(t);
    await freshSubmissionDb(m.dbPath);
    await submissionDataExecute(m.dbPath, note("first"), computer("A"));
    unlinkSync(m.dbPath);
    for (const name of readdirSync(m.caseDataDir)) rmSync(join(m.caseDataDir, name), { recursive: true });
    const before = tree(m.matterRoot);

    const err = await rejection(call(t, m));

    assert.equal(err.code, "earlier_work_missing", err.message);
    assert.equal(err.details.signs.length, 1, JSON.stringify(err.details.signs));
    assert.match(err.details.signs[0].what, /this computer/);
    assert.equal(existsSync(m.dbPath), false, "no database created");
    assert.deepEqual(tree(m.matterRoot), before);
  });

  // D2.
  test(`${entry} with accept_current_file creates the database over the write record and resets it`, async (t) => {
    const m = matterFixture(t);
    await freshSubmissionDb(m.dbPath);
    await submissionDataExecute(m.dbPath, note("first"), computer("A"));
    unlinkSync(m.dbPath);

    await call(t, m, { accept_current_file: true });
    await awaitBackgroundJobs();

    assert.equal(existsSync(m.dbPath), true, "the database is created");
    const result = await submissionDataExecute(m.dbPath, note("second"), computer("A"));
    assert.equal(result.ok, true, "the next write is not refused lost_writes");
    assert.deepEqual(Object.values(writeCounts(m.dbPath)), [1]);
  });

  test(`${entry} with accept_current_file accepts a file missing this computer's writes and resets the record`, async (t) => {
    const m = await replacedByOlderCopy(t);

    await call(t, m, { accept_current_file: true });
    await awaitBackgroundJobs();

    const result = await submissionDataExecute(m.dbPath, note("third"), computer("A"));
    assert.equal(result.ok, true);
    assert.deepEqual(Object.values(writeCounts(m.dbPath)), [2], "counting on from the file's own count");
  });
}

test("drafting_data__migrate refuses lost_writes on an existing file missing this computer's writes, writing nothing", async (t) => {
  const m = await replacedByOlderCopy(t);
  const before = tree(m.matterRoot);
  const bytes = readFileSync(m.dbPath);

  const err = await rejection(migrate(m));

  assert.equal(err.code, "lost_writes", err.message);
  assert.deepEqual(readFileSync(m.dbPath), bytes);
  assert.deepEqual(tree(m.matterRoot), before);
});
