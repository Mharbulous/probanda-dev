// Spec 2026-11-17 drafting-records sync safety, slice S4: section 3.1 (never create over earlier work)
// and section 3.3 (the wider conflict-copy pattern), criteria 4, 5 and 7. Each test runs the tool
// against a temp matter folder and asserts on the files on disk.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test, { after } from "node:test";

import { startFakeCloud } from "./helpers/fake-cloud.mjs";

process.env.COCLERK_SUBMISSION_LOCK_ROOT = mkdtempSync(join(tmpdir(), "coclerk-earlier-work-locks-"));
after(() => rmSync(process.env.COCLERK_SUBMISSION_LOCK_ROOT, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));

const { callTool, createDispatchContext } = await import("../build/index.js");
const { awaitBackgroundJobs } = await import("../build/submission/render-job.js");
const { freshSubmissionDb } = await import("./helpers/template-db.mjs");
const { submissionDataExecute } = await import("../build/submission/backend.js");
const { closePageServer } = await import("../build/housekeeping/server.js");
after(() => closePageServer());

/** <tmp>/L9999 Test Matter/coclerk.json -> <tmp>/L9999 Test Matter/0. CASE DATA/submission.sqlite, with an empty 0. DRAFT. */
function matterFixture(t) {
  const base = mkdtempSync(join(tmpdir(), "coclerk-earlier-work-"));
  t.after(async () => {
    await awaitBackgroundJobs();
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
  return { matterRoot, caseDataDir, draftDir, dbPath: join(caseDataDir, "submission.sqlite") };
}

async function practiceContext(t) {
  const practicePath = join(tmpdir(), `coclerk-earlier-work-practice-${randomUUID()}.db`);
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

/** Every file and folder under dir, relative, sorted. */
function tree(dir) {
  return readdirSync(dir, { recursive: true }).map(String).sort();
}

// Each sign of earlier work, as the folder holds it when the database file is missing.
const SIGNS = {
  "a backup copy beside the database": (m) => {
    const file = join(m.caseDataDir, "submission.sqlite.bak-20261117T101500Z");
    writeFileSync(file, "backup bytes");
    return file;
  },
  "a generator-marked Work Board page": (m) => {
    mkdirSync(join(m.draftDir, "Opening Submissions Package"));
    const file = join(m.draftDir, "Opening Submissions Package", "Work Board.html");
    writeFileSync(file, '<html data-workboard-shell="1"></html>');
    return file;
  },
  "the pages' state file": (m) => {
    mkdirSync(join(m.draftDir, "Drafting records"));
    const file = join(m.draftDir, "Drafting records", "matter-pages-state.json");
    writeFileSync(file, '{"sections":{}}');
    return file;
  },
};

const ENTRY_POINTS = {
  "session entry": async (t, m) => callTool(await practiceContext(t), "drafting_forms__open_session", { matter_root: m.matterRoot }),
  "drafting_data__migrate": async (t, m) => callTool({}, "drafting_data__migrate", { db_path: m.dbPath }),
};

for (const [entry, call] of Object.entries(ENTRY_POINTS)) {
  for (const [sign, plant] of Object.entries(SIGNS)) {
    test(`${entry} with submission.sqlite missing and ${sign} refuses earlier_work_missing and creates nothing`, async (t) => {
      const m = matterFixture(t);
      const file = plant(m);
      const bytes = readFileSync(file);
      const before = tree(m.matterRoot);

      const err = await rejection(call(t, m));

      assert.equal(err.code, "earlier_work_missing", err.message);
      assert.match(err.message, /^earlier_work_missing: /);
      assert.ok(err.message.includes(basename(file)), `names the sign: ${err.message}`);
      assert.match(err.message, /sync/i);
      assert.match(err.message, /version history/);
      assert.match(err.message, /sync-split\.md/);
      assert.equal(existsSync(m.dbPath), false, "no database created");
      assert.deepEqual(tree(m.matterRoot), before, "nothing created, written or swept");
      assert.deepEqual(readFileSync(file), bytes);
    });
  }

  test(`${entry} with no sign of earlier work creates the database as today, even beside a file another tool left`, async (t) => {
    const m = matterFixture(t);
    writeFileSync(join(m.draftDir, "Work Board notes.html"), "<html>my own notes</html>");
    writeFileSync(join(m.caseDataDir, "evidence.sql"), "-- not a drafting file");

    await call(t, m);

    assert.equal(existsSync(m.dbPath), true, "the database is created");
  });
}

// Criterion 7: the copy names Windows and other sync services give a conflict's copy.
for (const name of ["submission (1).sqlite", "submission (conflicted copy 2026-11-17).sqlite", "submission (DESKTOP-4F2K9's conflicted copy 2026-11-17).sqlite", "submission - Copy.sqlite", "submission - Copy (2).sqlite"]) {
  test(`${name} beside the plain file triggers sync_conflict_copies`, async (t) => {
    const m = matterFixture(t);
    await freshSubmissionDb(m.dbPath);
    writeFileSync(join(m.caseDataDir, name), readFileSync(m.dbPath));
    const live = readFileSync(m.dbPath);

    const refusals = [
      await rejection(submissionDataExecute(m.dbPath, "UPDATE db_meta SET value = value;")),
      await rejection(callTool({}, "drafting_data__migrate", { db_path: m.dbPath })),
      await rejection(callTool(await practiceContext(t), "drafting_forms__open_session", { matter_root: m.matterRoot })),
    ];
    for (const err of refusals) assert.ok(err.message.includes("sync_conflict_copies: ") && err.message.includes(name), err.message);
    assert.deepEqual(readFileSync(m.dbPath), live);
  });
}

test("a .bak-* copy and the staging sibling beside the plain file are not conflict copies", async (t) => {
  const m = matterFixture(t);
  await freshSubmissionDb(m.dbPath);
  writeFileSync(join(m.caseDataDir, "submission.sqlite.bak-20261117T101500Z"), readFileSync(m.dbPath));
  writeFileSync(join(m.caseDataDir, "coclerk_submission_replace_abc123.sqlite"), readFileSync(m.dbPath));

  const result = await submissionDataExecute(m.dbPath, "UPDATE db_meta SET value = value WHERE key = 'schema_version';");

  assert.equal(result.ok, true);
});
