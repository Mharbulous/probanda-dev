// drafting_forms__open_session (#591): one session-entry call from a matter folder. Runs the tool
// through callTool against a temp matter folder, its coclerk.json pointer, a real submission
// database and a real practice database. Every test reads coclerk.json's bytes before and after:
// the resolver is read-only (#590 decision 1), and that is proved here rather than asserted.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

import { startFakeCloud } from "./helpers/fake-cloud.mjs";

// open_session starts the background render job (#589): its locks and status mirrors stay out of the
// practitioner's %LOCALAPPDATA%, and each fixture waits for its job before deleting the matter.
process.env.COCLERK_SUBMISSION_LOCK_ROOT = mkdtempSync(join(tmpdir(), "coclerk-open-session-locks-"));
after(() => rmSync(process.env.COCLERK_SUBMISSION_LOCK_ROOT, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));

const { callTool, createDispatchContext } = await import("../build/index.js");
const { awaitBackgroundJobs } = await import("../build/submission/render-job.js");
const { freshSubmissionDb } = await import("./helpers/template-db.mjs");
const { submissionDataExecute } = await import("../build/submission/backend.js");
const writes = await import("../build/tools/practice/writes.js");
const { submissionDataMigrateScriptsDir } = await import("../build/repo-root.js");
const { matterToken } = await import("../build/submission/open-session.js");
const { formCurrency } = await import("../build/submission/form-currency.js");
const { nowStamp } = await import("../build/submission/forms.js");
const { closePageServer } = await import("../build/housekeeping/server.js");
const { writeCaseDataStores } = await import("./helpers/matter-data-fixture.mjs");
after(() => closePageServer());

/** A real database one schema version behind: the migration engine run to TARGET - 1. */
function oneVersionBehind(dbPath, version = "m.TARGET_SCHEMA_VERSION - 1") {
  const python = process.env.COCLERK_PYTHON || "python";
  const res = spawnSync(
    python,
    ["-c", `import sys, migrate_engine as m; m.migrate(sys.argv[1], ${version})`, dbPath],
    { encoding: "utf-8", env: { ...process.env, PYTHONPATH: submissionDataMigrateScriptsDir(process.env) } }
  );
  if (res.status !== 0) throw new Error(`fixture migrate failed: ${res.stderr}`);
}

/** <tmp>/L9999 Test Matter/coclerk.json -> <tmp>/L9999 Test Matter/0. CASE DATA/submission.sqlite, beside the
 * matter's 0. DRAFT when a test makes one (spec 2026-10-22 §9). */
function matterFixture(t, { folder = "L9999 Test Matter", pointer } = {}) {
  const base = mkdtempSync(join(tmpdir(), "coclerk-open-session-"));
  t.after(async () => {
    await awaitBackgroundJobs();
    rmSync(base, { recursive: true, force: true });
  });
  const matterRoot = join(base, folder);
  const caseDataDir = join(matterRoot, "0. CASE DATA");
  mkdirSync(matterRoot, { recursive: true });
  mkdirSync(caseDataDir, { recursive: true });
  // The firm's own 0. CASE DATA root beside the matter, which a session finds without the per-user file.
  mkdirSync(join(base, "0. CASE DATA"));
  const pointerText =
    typeof pointer === "string"
      ? pointer
      : JSON.stringify({ schema_version: 5, matter_root: matterRoot, case_data_dir: "0. CASE DATA", evidence_sql_path: "4. LAWYER BRIEF\\CoWork\\evidence.sql", ...pointer }, null, 2);
  writeFileSync(join(matterRoot, "coclerk.json"), pointerText, "utf-8");
  return { base, matterRoot, caseDataDir, dbPath: join(caseDataDir, "submission.sqlite"), pointerBytes: () => readFileSync(join(matterRoot, "coclerk.json")) };
}

async function seedOneFiling(dbPath) {
  await freshSubmissionDb(dbPath);
  await submissionDataExecute(
    dbPath,
    `INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L9999 - Test', 'CAN/BC/Vancouver-International-Arbitration-Centre');
     INSERT INTO filings (id, proceeding_id, kind, round, title) VALUES (1, 1, 'submissions_package', 'opening', 'Opening Submissions Package');`
  );
}

/** seedOneFiling's filing's Milestone page, in its Writing's own folder (spec 2026-10-22 §9). */
const OPENING_FOLDER = "Opening Submissions Package";
const OPENING_PAGE = join(OPENING_FOLDER, "Milestone.html");

async function practiceContext(t, { withMatter = true, dbPath } = {}) {
  const practicePath = dbPath ?? join(tmpdir(), `coclerk-open-session-practice-${randomUUID()}.db`);
  t.after(() => rmSync(practicePath, { recursive: true, force: true }));
  const context = await createDispatchContext({ ...process.env, ...(await startFakeCloud(t)).env, COCLERK_DB_PATH: practicePath });
  if (withMatter) {
    await writes.upsert_client_matter(context.practiceDb, {
      client_num: "C-9999",
      name: "Lookup Client Ltd.",
      matt_num: "L9999",
      file_number: "F-9999",
    });
  }
  return context;
}

test("resolves db_path from coclerk.json, folds in the matter lookup, and bootstraps", async (t) => {
  const m = matterFixture(t);
  await seedOneFiling(m.dbPath);
  const context = await practiceContext(t);
  const before = m.pointerBytes();

  const result = await callTool(context, "drafting_forms__open_session", { matter_root: m.matterRoot });

  assert.equal(result.db_path.toLowerCase(), m.dbPath.toLowerCase());
  assert.equal(result.migration_required, false);
  assert.equal(result.migrated, undefined);
  assert.equal(result.filings.length, 1);
  assert.equal(result.filings[0].title, "Opening Submissions Package");
  assert.match(result.session_token, /^sess-/);
  assert.deepEqual(result.matter_lookup, {
    matt_num: "L9999",
    found: true,
    client_name: "Lookup Client Ltd.",
    client_no: "C-9999",
    matter_no: "L9999",
  });
  assert.equal(result.timings.at(-1).phase, "total");
  assert.ok(result.timings.some((p) => p.phase === "bootstrap: total"));
  assert.deepEqual(m.pointerBytes(), before);
});

test("a relocated matter's relative pointer gives db_path under the matter's own 0. CASE DATA (ADR 0013)", async (t) => {
  const m = matterFixture(t, { pointer: { case_data_dir: "0. CASE DATA", evidence_sql_path: "0. CASE DATA\\evidence.sql" } });
  const dbPath = join(m.matterRoot, "0. CASE DATA", "submission.sqlite");
  mkdirSync(join(m.matterRoot, "0. CASE DATA"), { recursive: true });
  await seedOneFiling(dbPath);
  noPerUserConfig(t);
  const context = await practiceContext(t);
  const before = m.pointerBytes();

  const result = await callTool(context, "drafting_forms__open_session", { matter_root: m.matterRoot });

  assert.equal(result.db_path.toLowerCase(), dbPath.toLowerCase());
  assert.equal(result.filings.length, 1);
  assert.equal(result.blocking, undefined, "the firm root beside the matter is found without the per-user file");
  assert.deepEqual(m.pointerBytes(), before);
});

test("migrates a database that is behind, reports the backup, then bootstraps", async (t) => {
  const m = matterFixture(t);
  oneVersionBehind(m.dbPath);
  // Older copies from earlier migrates, and one the practitioner labelled by hand.
  const older = ["submission.sqlite.bak-20260101T000000Z", "submission.sqlite.bak-20260102T000000Z-1"];
  for (const name of [...older, "submission.sqlite.bak-before-review-seed"]) writeFileSync(join(m.caseDataDir, name), "");
  const context = await practiceContext(t);
  const before = m.pointerBytes();

  const result = await callTool(context, "drafting_forms__open_session", { matter_root: m.matterRoot });

  assert.equal(result.migration_required, false);
  assert.equal(result.migrated.from, result.current_schema_version - 1);
  assert.equal(result.migrated.to, result.current_schema_version);
  assert.equal(result.schema_version, result.current_schema_version);
  assert.ok(result.migrated.backup, "the #353 copy-aside is reported");
  assert.ok(existsSync(result.migrated.backup));
  assert.equal(result.migrated.warnings, undefined);
  // Only this migrate's copy and the labelled one are left.
  const left = readdirSync(m.caseDataDir).filter((f) => f.startsWith("submission.sqlite.bak-")).sort();
  assert.deepEqual(left, [result.migrated.backup.split(/[\\/]/).at(-1),"submission.sqlite.bak-before-review-seed"].sort());
  assert.match(result.session_token, /^sess-/);
  assert.deepEqual(result.filings, []);
  assert.ok(result.timings.some((p) => p.phase === "migrate"));
  assert.deepEqual(m.pointerBytes(), before);
});

test("the plain bootstrap tool still refuses on migration_required", async (t) => {
  const m = matterFixture(t);
  // Below schema version 42, the oldest the runtime reads (forms.ts MIN_READABLE_SCHEMA_VERSION).
  oneVersionBehind(m.dbPath, "41");
  const context = await practiceContext(t, { withMatter: false });
  const result = await callTool(context, "drafting_forms__bootstrap", { db_path: m.dbPath });
  assert.equal(result.migration_required, true);
});

for (const [label, fixture, code] of [
  ["a non-JSON pointer", { pointer: "{not json" }, "pointer_unusable"],
  ["a pre-v5 pointer", { pointer: { schema_version: 4 } }, "pointer_unusable"],
  ["a pointer with no case_data_dir", { pointer: { case_data_dir: "" } }, "pointer_unusable"],
  ["a pointer at the legacy 9. AI folder", { pointer: { case_data_dir: "9. AI" } }, "pointer_unusable"],
]) {
  test(`refuses ${label} and leaves coclerk.json untouched`, async (t) => {
    const m = matterFixture(t, fixture);
    const context = await practiceContext(t, { withMatter: false });
    const before = m.pointerBytes();
    await assert.rejects(
      callTool(context, "drafting_forms__open_session", { matter_root: m.matterRoot }),
      (err) => err.code === code && /\/matter-data/.test(err.message)
    );
    assert.deepEqual(m.pointerBytes(), before);
  });
}

test("refuses a folder with no coclerk.json", async (t) => {
  const base = mkdtempSync(join(tmpdir(), "coclerk-open-session-bare-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const context = await practiceContext(t, { withMatter: false });
  await assert.rejects(
    callTool(context, "drafting_forms__open_session", { matter_root: base }),
    (err) => err.code === "invalid_root"
  );
  assert.equal(existsSync(join(base, "coclerk.json")), false);
});

test("refuses when the pointer resolves but no submission database exists there", async (t) => {
  const m = matterFixture(t);
  const context = await practiceContext(t, { withMatter: false });
  await assert.rejects(
    callTool(context, "drafting_forms__open_session", { matter_root: m.matterRoot }),
    /No drafting records found.*Set the matter.s drafting records up first/
  );
  assert.equal(existsSync(m.dbPath), false, "open_session never creates a database");
});

test("refuses a pointer written on another device as unusable, with no migrate hint", async (t) => {
  const elsewhere = join(tmpdir(), `coclerk-open-session-other-profile-${randomUUID()}`, "0. CASE DATA", "L9999 Test Matter");
  const m = matterFixture(t, { pointer: { case_data_dir: elsewhere } });
  const context = await practiceContext(t, { withMatter: false });
  const before = m.pointerBytes();
  await assert.rejects(
    callTool(context, "drafting_forms__open_session", { matter_root: m.matterRoot }),
    (err) => err.code === "pointer_unusable" && /\/matter-data/.test(err.message) && !/drafting_data__migrate/.test(err.message)
  );
  assert.deepEqual(m.pointerBytes(), before);
  assert.equal(existsSync(join(elsewhere, "submission.sqlite")), false, "open_session never creates a database");
});

test("a matter lookup that finds nothing is never fatal", async (t) => {
  const m = matterFixture(t);
  await seedOneFiling(m.dbPath);
  const context = await practiceContext(t, { withMatter: false });

  const result = await callTool(context, "drafting_forms__open_session", { matter_root: m.matterRoot });

  assert.equal(result.matter_lookup.found, false);
  assert.match(result.matter_lookup.note, /L9999/);
  assert.equal(result.filings.length, 1);
});

test("a matter lookup that throws is never fatal", async (t) => {
  const m = matterFixture(t);
  await seedOneFiling(m.dbPath);
  // A directory where the database file should be: SQLite cannot open it, so the lookup throws.
  const unopenable = mkdtempSync(join(tmpdir(), "coclerk-open-session-not-a-db-"));
  const context = await practiceContext(t, { withMatter: false, dbPath: unopenable });

  const result = await callTool(context, "drafting_forms__open_session", { matter_root: m.matterRoot });

  assert.equal(result.matter_lookup.found, false);
  assert.match(result.matter_lookup.note, /failed/);
  assert.equal(result.filings.length, 1);
});

test("a folder name with no matter number skips the lookup", async (t) => {
  const m = matterFixture(t, { folder: "No Token Here" });
  await seedOneFiling(m.dbPath);
  const context = await practiceContext(t, { withMatter: false });

  const result = await callTool(context, "drafting_forms__open_session", { matter_root: m.matterRoot });

  assert.equal(result.matter_lookup.matt_num, null);
  assert.equal(result.matter_lookup.found, false);
  assert.equal(result.filings.length, 1);
});

/** No per-user coclerk.json: APPDATA at an empty scratch folder, and neither override set. */
function noPerUserConfig(t) {
  const scratch = mkdtempSync(join(tmpdir(), "coclerk-open-session-no-config-"));
  const keys = ["APPDATA", "COCLERK_CONFIG_PATH", "COCLERK_CASE_DATA_ROOT"];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  t.after(() => {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    rmSync(scratch, { recursive: true, force: true });
  });
  delete process.env.COCLERK_CONFIG_PATH;
  delete process.env.COCLERK_CASE_DATA_ROOT;
  process.env.APPDATA = scratch;
}

test("no per-user coclerk.json, but a 0. CASE DATA matter: nothing blocks, and the lookup's note stands", async (t) => {
  const m = matterFixture(t);
  await seedOneFiling(m.dbPath);
  noPerUserConfig(t);
  // The practice database is unreachable too: no COCLERK_DB_PATH and no per-user file.
  const context = await createDispatchContext({ ...process.env, COCLERK_DB_PATH: "" });

  const result = await callTool(context, "drafting_forms__open_session", { matter_root: m.matterRoot });

  assert.equal(result.blocking, undefined);
  assert.equal(result.matter_lookup.found, false);
  assert.match(result.matter_lookup.note, /failed/);
  assert.ok(result.session_token);
});

test("no per-user coclerk.json and no 0. CASE DATA folder: practice_config_unreachable blocks, read-only entry still returned", async (t) => {
  const base = mkdtempSync(join(tmpdir(), "coclerk-open-session-elsewhere-"));
  t.after(async () => {
    await awaitBackgroundJobs();
    rmSync(base, { recursive: true, force: true });
  });
  const caseDataDir = join(base, "Somewhere Else", "L9999 Test Matter");
  mkdirSync(caseDataDir, { recursive: true });
  const m = matterFixture(t, { pointer: { case_data_dir: caseDataDir } });
  const dbPath = join(caseDataDir, "submission.sqlite");
  await seedOneFiling(dbPath);
  noPerUserConfig(t);
  const context = await practiceContext(t, { withMatter: false });
  const before = m.pointerBytes();

  const result = await callTool(context, "drafting_forms__open_session", { matter_root: m.matterRoot });

  assert.equal(result.blocking.length, 1);
  assert.equal(result.blocking[0].code, "practice_config_unreachable");
  assert.match(result.blocking[0].message, /Cannot locate the practice database/);
  assert.match(result.blocking[0].remedy, /case_data_root/);
  assert.match(result.blocking[0].remedy, /practice_data__config_status/, "the one repair path is /practice-data's");
  assert.ok(result.session_token);
  assert.equal(result.db_path, dbPath);
  assert.deepEqual(m.pointerBytes(), before, "open_session never rewrites the pointer");
  assert.equal(existsSync(join(process.env.APPDATA, "Coclerk")), false, "open_session never writes the per-user config");
});

test("a per-user coclerk.json with a reachable case_data_root: nothing blocks", async (t) => {
  const m = matterFixture(t);
  await seedOneFiling(m.dbPath);
  shippedTree(t);
  const context = await practiceContext(t);

  const result = await callTool(context, "drafting_forms__open_session", { matter_root: m.matterRoot });

  assert.equal(result.blocking, undefined);
});

// The opened filing's declared ingest inputs and Ready jobs, which the claim-time input check reads
// (/work job-session.md). Session entry itself checks no folder.

/** APPDATA pointing at a case data root with an empty firm overlay, so create_writing reads /draft's shipped tree.
 * With `map`, this machine names person "pe", whose folder map holds those entries. */
function shippedTree(t, { map } = {}) {
  const scratch = mkdtempSync(join(tmpdir(), "coclerk-open-session-tree-"));
  const saved = process.env.APPDATA;
  t.after(() => {
    if (saved === undefined) delete process.env.APPDATA;
    else process.env.APPDATA = saved;
    rmSync(scratch, { recursive: true, force: true });
  });
  mkdirSync(join(scratch, "case"));
  mkdirSync(join(scratch, "Coclerk"));
  writeFileSync(join(scratch, "Coclerk", "coclerk.json"), JSON.stringify({ case_data_root: join(scratch, "case"), ...(map ? { person: "pe" } : {}) }));
  if (map) {
    mkdirSync(join(scratch, "case", "_practice", "firm", "folder-maps"), { recursive: true });
    writeFileSync(join(scratch, "case", "_practice", "firm", "folder-maps", "pe.json"), JSON.stringify({ entries: map }));
  }
  process.env.APPDATA = scratch;
}

/** One practitioner's folders, as a folder map gives them. */
const CORRESPONDENCE_TYPES = ["opposing_counsel", "unrepresented_party", "witness", "expert", "court", "non_party"].map((k) => `correspondence_${k}`);
const MAP = [
  { type: "client_communications", folders: ["2. SOLICITOR CLIENT*"] },
  { type: "retainer_and_billing", folders: ["2. SOLICITOR CLIENT*"] },
  ...CORRESPONDENCE_TYPES.map((type) => ({ type, folders: ["3. CORRESPONDENCE*"] })),
  { type: "court_filings", folders: ["5. COURT*"] },
  { type: "documents_exchanged", folders: ["7. DISCOVERY*"] },
];
const LETTER_TYPES = ["client_communications", "retainer_and_billing", ...CORRESPONDENCE_TYPES, "court_filings"];

const LETTER = { forum: null, writing: { tree: { country: "CAN", jurisdiction: "BC", venue: "_NoVenue" }, kind: "letter-to-opposing-counsel", recipient: "opposing-counsel" } };

/** A matter with a 0. DRAFT folder and matter-data stores, whose one Writing is created from a shipped
 * type file; with `ready`, one queued job on that Writing. */
async function declaringFixture(t, context, { forum, writing }, { ready = true, map = MAP } = {}) {
  const m = matterFixture(t);
  shippedTree(t, { map });
  await freshSubmissionDb(m.dbPath);
  await submissionDataExecute(m.dbPath, `INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L9999 - Test', ${forum === null ? "NULL" : `'${forum}'`});`);
  const created = await callTool(context, "drafting_data__create_writing", { db_path: m.dbPath, proceeding_id: 1, ...writing, title: "Letter" });
  if (ready) {
    await submissionDataExecute(
      m.dbPath,
      `INSERT INTO tickets (id, proceeding_id, filing_id, title, intent, status, priority, kind, billing_anchor, created)
         VALUES (1, 1, ${created.filing_id}, 'Draft the letter', 'Draft the letter.', 'queued', 0, 'work', 'L9999|letter', '2026-09-23 10:00');`
    );
  }
  mkdirSync(join(m.matterRoot, "0. DRAFT"));
  writeCaseDataStores(m.caseDataDir);
  return m;
}

test("session entry returns the opened filing's declared inputs and Ready jobs, and runs no coverage check", async (t) => {
  const context = await practiceContext(t, { withMatter: false });
  const m = await declaringFixture(t, context, LETTER);
  mkdirSync(join(m.matterRoot, "3. CORRESPONDENCE"));
  writeFileSync(join(m.matterRoot, "3. CORRESPONDENCE", "a.pdf"), "a");

  const result = await callTool(context, "drafting_forms__open_session", { matter_root: m.matterRoot });

  assert.deepEqual(result.opened.ingest_inputs, { types: LETTER_TYPES, ready_jobs: [1] });
  assert.equal("ingest_coverage" in result, false, "the input check at the claim reads the folders itself");
  assert.equal(result.timings.some((p) => p.phase === "ingest_coverage"), false);
});

test("a declaring filing with no Ready job lists none", async (t) => {
  const context = await practiceContext(t, { withMatter: false });
  const m = await declaringFixture(t, context, LETTER, { ready: false });

  const result = await callTool(context, "drafting_forms__open_session", { matter_root: m.matterRoot });

  assert.deepEqual(result.opened.ingest_inputs, { types: LETTER_TYPES, ready_jobs: [] });
});

test("a caller-supplied client identity wins over the lookup's", async (t) => {
  const m = matterFixture(t);
  await seedOneFiling(m.dbPath);
  const context = await practiceContext(t);

  const result = await callTool(context, "drafting_forms__open_session", { matter_root: m.matterRoot, client_name: "Caller Name" });

  assert.equal(result.matter_lookup.client_name, "Caller Name");
  assert.equal(result.matter_lookup.client_no, "C-9999");
});

// #651: open_session finds the matter's 0. DRAFT folder itself and opens a board under it.
test("one 0. DRAFT folder: the Litigation Strategy and the Milestone page are written there and their paths returned", async (t) => {
  const m = matterFixture(t);
  await seedOneFiling(m.dbPath);
  const draftDir = join(m.matterRoot, "0. DRAFT");
  mkdirSync(draftDir);
  const context = await practiceContext(t, { withMatter: false });

  const result = await callTool(context, "drafting_forms__open_session", { matter_root: m.matterRoot });

  assert.equal(result.matter_board_path.toLowerCase(), join(draftDir, "Litigation Strategy.html").toLowerCase());
  assert.ok(existsSync(join(draftDir, "Litigation Strategy.html")));
  assert.equal(result.milestone_path.toLowerCase(), join(draftDir, OPENING_PAGE).toLowerCase());
  assert.ok(existsSync(join(draftDir, OPENING_PAGE)));
  assert.deepEqual(result.milestone_paths.map((p) => p.path), [result.milestone_path], "every page the opening wrote");
  assert.equal(result.matter_board_note, undefined);
  assert.equal(result.draft_dir.toLowerCase(), draftDir.toLowerCase(), "#689: returned for every later render");
  assert.equal(result.milestone_url, undefined, "2026-10-03: a session never holds a link to either page");
  assert.equal(result.matter_board_url, undefined);

  // The only work added is the one directory listing (draft_dir) and the opening, whose render writes the pages once.
  const bare = matterFixture(t);
  await seedOneFiling(bare.dbPath);
  const without = await callTool(context, "drafting_forms__open_session", { matter_root: bare.matterRoot });
  assert.ok(result.timings.some((p) => p.phase === "draft_dir"));
  assert.equal(result.timings.some((p) => p.phase === "bootstrap: matter_pages"), false, "bootstrap writes no page");
  assert.deepEqual(result.timings.map((p) => p.phase).filter((p) => p.endsWith("matter_pages")), ["open: matter_pages"]);
  assert.equal(without.timings.some((p) => p.phase.startsWith("open: ")), false, "no draft folder, no opening");
});

// Spec 2026-10-29 (open_session server time): the opening writes every page but the view pages, which
// the background job writes first, and one practice snapshot serves the lookup, the to-dos and the dates.
test("one practice snapshot serves the matter lookup, the to-dos and the dates", async (t) => {
  const m = matterFixture(t);
  await seedOneFiling(m.dbPath);
  mkdirSync(join(m.matterRoot, "0. DRAFT"));
  const context = await practiceContext(t);
  const snapshot = context.practiceDb.snapshot;
  let snapshots = 0;
  context.practiceDb.snapshot = function () {
    snapshots += 1;
    return snapshot.call(this);
  };

  const result = await callTool(context, "drafting_forms__open_session", { matter_root: m.matterRoot });

  assert.equal(result.matter_lookup.found, true);
  assert.ok(["matter_lookup", "todos", "dates"].every((phase) => result.timings.some((p) => p.phase === phase)));
  assert.equal(snapshots, 1);
});

test("session entry writes no view page, and the background job writes them with nothing to render", async (t) => {
  const m = matterFixture(t);
  await seedOneFiling(m.dbPath);
  mkdirSync(join(m.matterRoot, "0. DRAFT"));
  // No matter in the practice store, so the job queues nothing and only its settle writes pages.
  const context = await practiceContext(t, { withMatter: false });

  const result = await callTool(context, "drafting_forms__open_session", { matter_root: m.matterRoot });

  assert.equal(result.background_job.current, null, "nothing to render");
  assert.deepEqual(result.background_job.queued, []);
  assert.ok(existsSync(result.milestone_path));
  assert.ok(result.view_page_paths.length > 0, "the fixture's Writing has view pages");
  for (const { path } of result.view_page_paths) assert.equal(existsSync(path), false, `${path} is left to the job`);
  await awaitBackgroundJobs();
  for (const { path } of result.view_page_paths) assert.ok(existsSync(path), `${path} is written by the job`);
});

// The fast open in one call: with a draft folder, session entry opens the first live filing itself
// and returns its board, so the to-dos are read once and both pages written once.
test("one live filing: session entry opens it and returns its board as opened", async (t) => {
  const m = matterFixture(t);
  await seedOneFiling(m.dbPath);
  const draftDir = join(m.matterRoot, "0. DRAFT");
  mkdirSync(draftDir);
  const context = await practiceContext(t);
  await writes.upsert_client_matter(context.practiceDb, { client_num: "C-9999", name: "Lookup Client Ltd.", matt_num: "L9999", file_number: "F-9999", description: "Test v. Example" });
  await writes.upsert_task(context.practiceDb, { matt_num: "L9999", task_type: "client", description: "Settle the opening submissions", filing_ref: "filing:1" });

  const result = await callTool(context, "drafting_forms__open_session", { matter_root: m.matterRoot });

  assert.equal(result.opened.filing_id, 1);
  const summary = result.opened.board_summary;
  assert.ok(summary.startsWith("# Milestone — Matter"), summary);
  assert.ok(!summary.includes("## "), summary);
  const [header, todo] = summary.split("\n");
  assert.match(header, /^# Milestone — Matter L9999 Test v\. Example · Client Lookup Client Ltd\. \(C-9999\) · Rev \d+$/, "the matter's description from the lookup");
  assert.equal(todo, "To Do: Settle the opening submissions", "the open to-do linked to filing 1");
  assert.equal(result.opened.board_changed, true, "no section recorded yet");
  assert.equal(result.opened.board_moves, undefined);
  assert.equal(result.opened.ingest_inputs, undefined, "a filing with no stored layout declares no ingest inputs");
  assert.equal(result.form_currency, undefined, "a submissions package's venue document is no court form");
  assert.equal(result.open_refused, undefined);
  assert.equal(result.timings.filter((p) => p.phase === "todos").length, 1, "the to-dos are read once");
  assert.ok(existsSync(result.matter_board_path));
  assert.ok(existsSync(result.milestone_path));
  assert.equal(result.matter_board_path.toLowerCase(), join(draftDir, "Litigation Strategy.html").toLowerCase());
  assert.equal(result.loose_threads_path.toLowerCase(), join(draftDir, "Loose Threads.html").toLowerCase());
  assert.equal(result.milestone_path.toLowerCase(), join(draftDir, OPENING_PAGE).toLowerCase());
  assert.ok(result.background_job);
});

// ADR 0038: an opened Notice of Application carries Form 32's currency, read as of the local date.
test("an opened Notice of Application returns Form 32's form_currency", async (t) => {
  const m = matterFixture(t);
  await seedOneFiling(m.dbPath);
  await submissionDataExecute(m.dbPath, "UPDATE proceedings SET forum = 'CAN/BC/BCSC' WHERE id = 1; UPDATE filings SET kind = 'notice_of_application' WHERE id = 1;");
  mkdirSync(join(m.matterRoot, "0. DRAFT"));
  const context = await practiceContext(t);

  const result = await callTool(context, "drafting_forms__open_session", { matter_root: m.matterRoot });

  assert.equal(result.open_refused, undefined);
  assert.equal(result.opened.filing_id, 1);
  assert.equal(result.form_currency.form_key, "form-32");
  assert.deepEqual(result.form_currency, formCurrency("form-32", nowStamp().slice(0, 10)));
  assert.ok(result.timings.some((p) => p.phase === "form_currency"));
});

test("a second opening reports board_changed against the state sidecar, and a ticket write as a move", async (t) => {
  const m = matterFixture(t);
  await seedOneFiling(m.dbPath);
  mkdirSync(join(m.matterRoot, "0. DRAFT"));
  const context = await practiceContext(t);

  await callTool(context, "drafting_forms__open_session", { matter_root: m.matterRoot });
  const unchanged = await callTool(context, "drafting_forms__open_session", { matter_root: m.matterRoot });
  assert.equal(unchanged.opened.board_changed, false);
  assert.deepEqual(unchanged.opened.board_moves, []);

  await submissionDataExecute(
    m.dbPath,
    `INSERT INTO tickets (id, proceeding_id, filing_id, title, intent, status, priority, kind, billing_anchor, created)
       VALUES (1, 1, 1, 'Settle the opening', 'Draft the opening submission.', 'queued', 0, 'work', 'L9999|opening', '2026-09-23 10:00');`
  );
  const moved = await callTool(context, "drafting_forms__open_session", { matter_root: m.matterRoot });
  assert.equal(moved.opened.board_changed, true);
  assert.deepEqual(moved.opened.board_moves, [{ id: 1, title: "Settle the opening", from: null, to: "ready" }]);
});

test("filing_id naming a retired filing opens its board as retired, with no mockup copy written", async (t) => {
  const m = matterFixture(t);
  await seedOneFiling(m.dbPath);
  await submissionDataExecute(m.dbPath, "UPDATE filings SET retired_on = '2026-09-30' WHERE id = 1;");
  const draftDir = join(m.matterRoot, "0. DRAFT");
  mkdirSync(draftDir);
  const context = await practiceContext(t);

  const result = await callTool(context, "drafting_forms__open_session", { matter_root: m.matterRoot, filing_id: 1 });

  assert.equal(result.opened.filing_retired, true);
  assert.ok(result.opened.board_summary.startsWith("# Milestone — Matter"), result.opened.board_summary);
  assert.ok(!result.opened.board_summary.includes("## "), result.opened.board_summary);
  assert.match(result.opened.board_summary, /^State: Retired 2026-09-30/m);
  assert.equal(result.opened.rendered_at, undefined);
  assert.deepEqual(readdirSync(draftDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name), ["Drafting records"], "no Writing folder, only the records folder");
});

test("filing_id naming no filing is reported as open_refused, and the matter's pages are still written", async (t) => {
  const m = matterFixture(t);
  await seedOneFiling(m.dbPath);
  mkdirSync(join(m.matterRoot, "0. DRAFT"));
  const context = await practiceContext(t);

  const result = await callTool(context, "drafting_forms__open_session", { matter_root: m.matterRoot, filing_id: 99 });

  assert.match(result.open_refused.message, /No filing found with id/);
  assert.equal(result.open_refused.code, "data_error");
  assert.equal(result.opened, undefined);
  assert.ok(existsSync(result.matter_board_path));
  assert.equal(result.milestone_path, null, "filing 99 has no page");
  assert.deepEqual(result.milestone_paths.map((p) => p.filing_id), [1]);
  assert.ok(existsSync(result.milestone_paths[0].path));
});

test("a refused opening of a live filing returns that filing's page", async (t) => {
  const m = matterFixture(t);
  await seedOneFiling(m.dbPath);
  const draftDir = join(m.matterRoot, "0. DRAFT");
  mkdirSync(draftDir);
  // Two folders that could each be the Writing's, none recorded, refuse the render.
  mkdirSync(join(draftDir, OPENING_FOLDER));
  mkdirSync(join(draftDir, `2026-09-10 ${OPENING_FOLDER}`));
  const context = await practiceContext(t);

  const result = await callTool(context, "drafting_forms__open_session", { matter_root: m.matterRoot });

  assert.equal(result.open_refused.code, "presentation_dir_ambiguous");
  assert.equal(result.milestone_path.toLowerCase(), join(draftDir, OPENING_PAGE).toLowerCase());
  assert.ok(existsSync(result.milestone_path));
});

// A Milestone with no Writing (drafting_data__create_milestone) is listed, and is never the default opening.
async function seedMilestone(context, m) {
  const board = await callTool(context, "drafting_data__create_milestone", { db_path: m.dbPath, proceeding_id: 1, title: "Paper originals" });
  // Its job is the matter's latest activity, so the board leads bootstrap's list.
  await submissionDataExecute(
    m.dbPath,
    `INSERT INTO tickets (id, proceeding_id, filing_id, title, intent, status, priority, kind, billing_anchor, created)
       VALUES (1, 1, ${board.filing_id}, 'Find the paper original', 'Look in the vault.', 'queued', 0, 'work', 'L9999|originals', '2099-01-01 10:00');`
  );
  return board.filing_id;
}

test("a Milestone with no Writing leads the list and is not opened by default", async (t) => {
  const m = matterFixture(t);
  await seedOneFiling(m.dbPath);
  const draftDir = join(m.matterRoot, "0. DRAFT");
  mkdirSync(draftDir);
  const context = await practiceContext(t);
  const boardId = await seedMilestone(context, m);
  const boardPage = join(draftDir, `Milestone ${boardId}.html`);

  const result = await callTool(context, "drafting_forms__open_session", { matter_root: m.matterRoot });

  assert.deepEqual(result.filings.map((f) => f.filing_id), [boardId, 1], "the board is first in the list");
  assert.equal(result.filings[0].milestone_only, true);
  assert.deepEqual(result.filings[0].paths, []);
  assert.equal("render_state" in result.filings[0], false);
  assert.equal(result.opened.filing_id, 1, "the first live Writing opens, not the board ahead of it");
  assert.equal(result.milestone_path.toLowerCase(), join(draftDir, OPENING_PAGE).toLowerCase());
  assert.deepEqual(result.milestone_paths.map((p) => p.filing_id).sort(), [1, boardId].sort(), "both pages are written");
  assert.ok(existsSync(boardPage));
  const job = result.background_job;
  assert.equal([job.current, ...job.queued, ...job.done].includes(boardId), false, "the background job never queues the board");
});

// A General Job (no filing) counts for every Writing in its proceeding, so a newer one must not
// tie them all and hand the opening to the lowest id: the Writing with its own activity opens.
test("a newer General Job does not outrank a Writing's own older activity, and filing_id still wins", async (t) => {
  const m = matterFixture(t);
  await seedOneFiling(m.dbPath);
  await submissionDataExecute(
    m.dbPath,
    `INSERT INTO filings (id, proceeding_id, kind, round, title) VALUES (2, 1, 'submissions_package', 'reply', 'Reply Submissions Package');
     INSERT INTO tickets (id, proceeding_id, filing_id, title, intent, status, priority, kind, billing_anchor, created)
       VALUES (1, 1, 2, 'Draft the reply', 'Draft the reply submission.', 'queued', 0, 'work', 'L9999|reply', '2026-09-10 10:00'),
              (2, 1, NULL, 'Gather the record', 'Collect the record.', 'queued', 0, 'work', 'L9999|record', '2026-09-20 10:00');`
  );
  mkdirSync(join(m.matterRoot, "0. DRAFT"));
  const context = await practiceContext(t);

  const result = await callTool(context, "drafting_forms__open_session", { matter_root: m.matterRoot });
  assert.deepEqual(result.filings.map((f) => f.filing_id), [2, 1]);
  assert.equal(result.opened.filing_id, 2);

  const named = await callTool(context, "drafting_forms__open_session", { matter_root: m.matterRoot, filing_id: 1 });
  assert.equal(named.opened.filing_id, 1);
});

test("filing_id naming a Milestone with no Writing opens its board, with no folder of its own", async (t) => {
  const m = matterFixture(t);
  await seedOneFiling(m.dbPath);
  const draftDir = join(m.matterRoot, "0. DRAFT");
  mkdirSync(draftDir);
  const context = await practiceContext(t);
  const boardId = await seedMilestone(context, m);
  const boardPage = join(draftDir, `Milestone ${boardId}.html`);

  const named = await callTool(context, "drafting_forms__open_session", { matter_root: m.matterRoot, filing_id: boardId });

  assert.equal(named.open_refused, undefined);
  assert.equal(named.opened.filing_id, boardId);
  assert.match(named.opened.board_summary, /^State: Open$/m);
  assert.equal(named.opened.filing_retired, undefined);
  assert.equal(named.milestone_path.toLowerCase(), boardPage.toLowerCase());
  assert.equal(named.form_currency, undefined);
  const folders = () => readdirSync(draftDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  assert.deepEqual(folders(), ["Drafting records", OPENING_FOLDER], "no folder for the board: only the Writing's and the records folder");

  // The render a session then calls for it, through the dispatch.
  const rendered = await callTool(context, "drafting_forms__render", { db_path: m.dbPath, filing_id: boardId, draft_dir: named.draft_dir, session_token: named.session_token });
  assert.equal(rendered.milestone_only, true);
  assert.deepEqual(rendered.documents.map((d) => d.document_type), ["Work_board"]);
  assert.equal(rendered.documents[0].path.toLowerCase(), boardPage.toLowerCase());
  assert.equal(rendered.documents[0].board_changed, false);
  assert.deepEqual(folders(), ["Drafting records", OPENING_FOLDER]);
});

test("a live Milestone with no Writing beside a retired Writing: nothing is opened by default", async (t) => {
  const m = matterFixture(t);
  await seedOneFiling(m.dbPath);
  mkdirSync(join(m.matterRoot, "0. DRAFT"));
  const context = await practiceContext(t);
  const boardId = await seedMilestone(context, m);
  await submissionDataExecute(m.dbPath, "UPDATE filings SET retired_on = '2026-09-30', retirement_reason = 'abandoned' WHERE id = 1;");

  const result = await callTool(context, "drafting_forms__open_session", { matter_root: m.matterRoot });

  assert.equal(result.opened, undefined);
  assert.equal(result.open_refused, undefined);
  assert.equal(result.milestone_path, null);
  assert.deepEqual(result.milestone_paths.map((p) => p.filing_id), [boardId], "the board's page is still written");
  assert.ok(existsSync(result.matter_board_path));
});

test("a pre-filing proceeding alone: session entry opens its board", async (t) => {
  const m = matterFixture(t);
  await freshSubmissionDb(m.dbPath);
  await submissionDataExecute(m.dbPath, "INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L9999 - Test', NULL);");
  mkdirSync(join(m.matterRoot, "0. DRAFT"));
  const context = await practiceContext(t);

  const result = await callTool(context, "drafting_forms__open_session", { matter_root: m.matterRoot });

  assert.equal(result.opened.proceeding_id, 1);
  assert.equal(result.opened.filing_id, undefined);
  assert.ok(existsSync(result.matter_board_path));
  assert.ok(existsSync(result.loose_threads_path));
  assert.equal(result.milestone_path.toLowerCase(), join(m.matterRoot, "0. DRAFT", "Milestone - proceeding 1.html").toLowerCase());
  assert.ok(existsSync(result.milestone_path));
  assert.deepEqual(result.milestone_paths.map((p) => p.path), [result.milestone_path]);
});

test("no filing and no proceeding: the Litigation Strategy is written, no Milestone page, and nothing is opened", async (t) => {
  const m = matterFixture(t);
  await freshSubmissionDb(m.dbPath);
  mkdirSync(join(m.matterRoot, "0. DRAFT"));
  const context = await practiceContext(t);

  const result = await callTool(context, "drafting_forms__open_session", { matter_root: m.matterRoot });

  assert.equal(result.opened, undefined);
  assert.equal(result.open_refused, undefined);
  assert.ok(existsSync(result.matter_board_path));
  assert.ok(existsSync(result.loose_threads_path));
  assert.equal(result.milestone_path, null);
  assert.deepEqual(result.milestone_paths, []);
  assert.deepEqual(readdirSync(join(m.matterRoot, "0. DRAFT")).filter((name) => name.endsWith(".html")), ["Litigation Strategy.html", "Loose Threads.html"]);
});

// ADR 0021 D1, D2: open_session reads the looked-up matter's open to-dos for the page, and writes
// nothing to the registry doing it.
test("the Litigation Strategy open_session writes carries the matter's open to-dos, and leaves their nudge fields alone", async (t) => {
  const m = matterFixture(t);
  await seedOneFiling(m.dbPath);
  mkdirSync(join(m.matterRoot, "0. DRAFT"));
  const practicePath = join(tmpdir(), `coclerk-open-session-practice-${randomUUID()}.db`);
  const context = await practiceContext(t, { dbPath: practicePath });
  await writes.upsert_task(context.practiceDb, {
    matt_num: "L9999",
    task_type: "client",
    description: "Settle the submissions",
    deadline_date: "2026-10-15",
    next_nudge_date: "2026-09-01",
    nudge_interval_days: 7,
    last_nudged_at: "2026-08-25T10:00:00.000Z",
    filing_ref: "filing:1",
  });
  const snapshot = () => {
    const res = spawnSync(
      process.env.COCLERK_PYTHON || "python",
      ["-c", "import json, sqlite3, sys; print(json.dumps([list(r) for r in sqlite3.connect(sys.argv[1]).execute(\"SELECT key, value FROM kv_store WHERE namespace = 'item' ORDER BY key\")]))", practicePath],
      { encoding: "utf-8" }
    );
    assert.equal(res.status, 0, res.stderr);
    return res.stdout;
  };
  const before = snapshot();

  const result = await callTool(context, "drafting_forms__open_session", { matter_root: m.matterRoot });

  const html = readFileSync(result.matter_board_path, "utf-8");
  const line = html.split("\n").find((l) => l.startsWith("window.MATTER_BOARD = "));
  const data = JSON.parse(line.slice("window.MATTER_BOARD = ".length, -1));
  assert.deepEqual(data.todos.map(({ id, ...rest }) => rest), [{ description: "Settle the submissions", bf_date: "2026-09-01", filing_id: 1 }]);
  assert.ok(!html.includes("2026-10-15"), "the to-do's deadline never reaches the page");
  assert.ok(result.timings.some((p) => p.phase === "todos"), "the registry read is its own phase");
  assert.equal(snapshot(), before, "the nudge fields are byte-identical");
});

test("no 0. DRAFT folder: matter_board_path is null with a note, and the session still opens", async (t) => {
  const m = matterFixture(t);
  await seedOneFiling(m.dbPath);
  const context = await practiceContext(t, { withMatter: false });

  const result = await callTool(context, "drafting_forms__open_session", { matter_root: m.matterRoot });

  assert.equal(result.matter_board_path, null);
  assert.equal(result.loose_threads_path, null);
  assert.equal(result.milestone_paths, null);
  assert.equal(result.milestone_path, undefined);
  assert.match(result.matter_board_note, /no 0\. DRAFT folder/);
  assert.equal(result.draft_dir, undefined);
  assert.equal(result.milestone_url, undefined);
  assert.equal(result.matter_board_url, undefined);
  assert.equal(result.filings.length, 1);
  assert.equal(result.opened, undefined);
});

test("a Superseded subfolder of the one 0. DRAFT folder is not a second draft folder", async (t) => {
  const m = matterFixture(t);
  await seedOneFiling(m.dbPath);
  const draftDir = join(m.matterRoot, "0. DRAFT");
  mkdirSync(join(draftDir, "Superseded"), { recursive: true });
  writeFileSync(join(draftDir, "Superseded", "2024-04-20 AFF Smith DRAFT.pdf"), "%PDF-1.4 draft\n", "utf-8");
  const context = await practiceContext(t, { withMatter: false });

  const result = await callTool(context, "drafting_forms__open_session", { matter_root: m.matterRoot });

  assert.equal(result.draft_dir.toLowerCase(), draftDir.toLowerCase());
  assert.equal(result.matter_board_note, undefined);
  assert.deepEqual(readdirSync(join(draftDir, "Superseded")), ["2024-04-20 AFF Smith DRAFT.pdf"]);
});

test("two 0. DRAFT folders refuse, naming both", async (t) => {
  const m = matterFixture(t);
  await seedOneFiling(m.dbPath);
  mkdirSync(join(m.matterRoot, "0. DRAFT"));
  mkdirSync(join(m.matterRoot, "0. DRAFT (old)"));
  const context = await practiceContext(t, { withMatter: false });

  await assert.rejects(
    callTool(context, "drafting_forms__open_session", { matter_root: m.matterRoot }),
    (err) => err.code === "draft_dir_ambiguous" && err.message.includes('"0. DRAFT"') && err.message.includes('"0. DRAFT (old)"')
  );
});

/** The Litigation Strategy's page data, read back from the file the call wrote. */
function boardData(path) {
  const line = readFileSync(path, "utf-8").split("\n").find((l) => l.startsWith("window.MATTER_BOARD = "));
  return JSON.parse(line.slice("window.MATTER_BOARD = ".length, -1));
}

async function seedTask(context) {
  await writes.upsert_task(context.practiceDb, { matt_num: "L9999", task_type: "client", description: "Settle the submissions", next_nudge_date: "2026-09-01" });
}

// #883: the firm's `{client}.{matter}` reference names the same matter as the bare matter number.
test("a client-prefixed matter folder resolves the same matter, and the same to-dos, as the bare one", async (t) => {
  const context = await practiceContext(t);
  await seedTask(context);
  const opened = {};
  for (const folder of ["L9999 Test Matter", "2575.L9999 Test Matter"]) {
    const m = matterFixture(t, { folder });
    await seedOneFiling(m.dbPath);
    mkdirSync(join(m.matterRoot, "0. DRAFT"));
    opened[folder] = await callTool(context, "drafting_forms__open_session", { matter_root: m.matterRoot });
  }
  const [bare, prefixed] = Object.values(opened);
  const { matt_num: _bareToken, ...bareMatter } = bare.matter_lookup;
  const { matt_num: _prefixedToken, ...prefixedMatter } = prefixed.matter_lookup;
  assert.equal(prefixedMatter.found, true, prefixed.matter_lookup.note);
  assert.deepEqual(prefixedMatter, bareMatter);
  assert.deepEqual(boardData(prefixed.matter_board_path).todos, boardData(bare.matter_board_path).todos);
  assert.equal(boardData(prefixed.matter_board_path).todos.length, 1);
});

// #1087: the firm also names matter folders `<matter number>- <short name>`.
test("the matter number drops a trailing separator and keeps every other extraction", () => {
  const cases = {
    "L42- Whistler lawsuit": "L42",
    "L8403- Lease negotiations": "L8403",
    "L8212 Northfield v. Brightwater": "L8212",
    "2575.L9999 Test Matter": "2575.L9999",
    "8825.L8129 - Possible new matter": "8825.L8129",
    "L42-1- Whistler lawsuit": "L42-1",
    "L42.1 Whistler lawsuit": "L42.1",
  };
  for (const [folder, token] of Object.entries(cases)) assert.equal(matterToken(join(tmpdir(), folder)), token, folder);
});

test("a hyphen-suffixed matter folder resolves the same matter, and the same to-dos, as the bare one", async (t) => {
  const context = await practiceContext(t);
  await seedTask(context);
  const opened = {};
  for (const folder of ["L9999 Test Matter", "L9999- Test Matter"]) {
    const m = matterFixture(t, { folder });
    await seedOneFiling(m.dbPath);
    mkdirSync(join(m.matterRoot, "0. DRAFT"));
    opened[folder] = await callTool(context, "drafting_forms__open_session", { matter_root: m.matterRoot });
  }
  const [bare, hyphenated] = Object.values(opened);
  assert.equal(hyphenated.matter_lookup.found, true, hyphenated.matter_lookup.note);
  assert.deepEqual(hyphenated.matter_lookup, bare.matter_lookup);
  assert.deepEqual(boardData(hyphenated.matter_board_path).todos, boardData(bare.matter_board_path).todos);
  assert.equal(boardData(hyphenated.matter_board_path).todos.length, 1);
});

// #883: a later render that does not restate matter_no must not wipe a populated Litigation Strategy.
test("a render without matter_no keeps the Litigation Strategy's to-dos", async (t) => {
  const m = matterFixture(t, { folder: "2575.L9999 Test Matter" });
  await seedOneFiling(m.dbPath);
  mkdirSync(join(m.matterRoot, "0. DRAFT"));
  const context = await practiceContext(t);
  await seedTask(context);
  const opened = await callTool(context, "drafting_forms__open_session", { matter_root: m.matterRoot });
  assert.equal(boardData(opened.matter_board_path).todos.length, 1);

  const rendered = await callTool(context, "drafting_forms__render", { db_path: m.dbPath, filing_id: 1, draft_dir: opened.draft_dir, session_token: opened.session_token });
  assert.ok(
    rendered.documents.some((d) => d.document_type === "Work_board" && d.path === opened.milestone_path),
    "the render that rewrote the pages returns the filing's Milestone page"
  );
  assert.equal(rendered.milestone_url, undefined, "and no link to it");
  assert.equal(rendered.matter_board_url, undefined);
  const afterRender = boardData(opened.matter_board_path);
  assert.deepEqual(afterRender.todos.map((todo) => todo.description), ["Settle the submissions"]);
  assert.equal(afterRender.todos_note, undefined);

  const bootstrapped = await callTool(context, "drafting_forms__bootstrap", { db_path: m.dbPath, draft_dir: opened.draft_dir });
  assert.deepEqual(bootstrapped.milestone_paths, opened.milestone_paths, "bootstrap returns every page");
  assert.equal(bootstrapped.milestone_path, undefined, "bootstrap opens no section");
  assert.equal(bootstrapped.matter_board_path, opened.matter_board_path);
  assert.equal(bootstrapped.milestone_url, undefined);
  assert.equal(bootstrapped.matter_board_url, undefined);
  assert.deepEqual(boardData(opened.matter_board_path).todos.map((todo) => todo.description), ["Settle the submissions"]);

  // The Writing's folder the draft_dir render wrote into: its parent is the 0. DRAFT folder.
  const presentation = OPENING_FOLDER;
  const presented = await callTool(context, "drafting_forms__render", { db_path: m.dbPath, filing_id: 1, presentation_dir: join(opened.draft_dir, presentation), session_token: opened.session_token });
  assert.equal(presented.milestone_url, undefined);
  assert.equal(presented.matter_board_url, undefined);
  assert.deepEqual(boardData(opened.matter_board_path).todos.map((todo) => todo.description), ["Settle the submissions"]);
});

// #893: the header names the matter open_session resolved, not an empty matter field.
test("a render or bootstrap without matter_no writes the Litigation Strategy header open_session wrote", async (t) => {
  const m = matterFixture(t, { folder: "2575.L9999 Test Matter" });
  await seedOneFiling(m.dbPath);
  await submissionDataExecute(m.dbPath, "INSERT INTO proceedings (id, matter_reference, forum) VALUES (2, 'L9999 - Test', 'CAN/BC/Vancouver-International-Arbitration-Centre');");
  mkdirSync(join(m.matterRoot, "0. DRAFT"));
  const context = await practiceContext(t);
  const opened = await callTool(context, "drafting_forms__open_session", { matter_root: m.matterRoot });
  const header = () => {
    const { matter, client } = boardData(opened.matter_board_path).meta;
    return { matter, client };
  };
  assert.deepEqual(header(), { matter: "L9999", client: "Lookup Client Ltd." });

  await callTool(context, "drafting_forms__render", { db_path: m.dbPath, filing_id: 1, draft_dir: opened.draft_dir, session_token: opened.session_token });
  assert.deepEqual(header(), { matter: "L9999", client: "Lookup Client Ltd." }, "render with filing_id and draft_dir");

  const presentation = OPENING_FOLDER;
  rmSync(opened.matter_board_path);
  await callTool(context, "drafting_forms__render", { db_path: m.dbPath, filing_id: 1, presentation_dir: join(opened.draft_dir, presentation), session_token: opened.session_token });
  assert.deepEqual(header(), { matter: "L9999", client: "Lookup Client Ltd." }, "render with filing_id and presentation_dir");

  rmSync(opened.matter_board_path);
  await callTool(context, "drafting_forms__render", { db_path: m.dbPath, proceeding_id: 2, draft_dir: opened.draft_dir, session_token: opened.session_token });
  assert.deepEqual(header(), { matter: "L9999", client: "Lookup Client Ltd." }, "render with proceeding_id and draft_dir");

  rmSync(opened.matter_board_path);
  await callTool(context, "drafting_forms__bootstrap", { db_path: m.dbPath, draft_dir: opened.draft_dir });
  assert.deepEqual(header(), { matter: "L9999", client: "Lookup Client Ltd." }, "bootstrap with draft_dir");

  await callTool(context, "drafting_forms__render", { db_path: m.dbPath, filing_id: 1, draft_dir: opened.draft_dir, matter_no: "L1234", client_name: "Given Client", session_token: opened.session_token });
  assert.deepEqual(header(), { matter: "L1234", client: "Given Client" }, "the caller's own values win");
});

test("a render without matter_no whose folder matches no practice matter keeps the header's fallback", async (t) => {
  const m = matterFixture(t);
  await seedOneFiling(m.dbPath);
  mkdirSync(join(m.matterRoot, "0. DRAFT"));
  const context = await practiceContext(t, { withMatter: false });
  const opened = await callTool(context, "drafting_forms__open_session", { matter_root: m.matterRoot });
  assert.equal(opened.matter_lookup.found, false);

  await callTool(context, "drafting_forms__render", { db_path: m.dbPath, filing_id: 1, draft_dir: opened.draft_dir, session_token: opened.session_token });
  const { matter, client } = boardData(opened.matter_board_path).meta;
  assert.deepEqual({ matter, client }, { matter: "", client: "L9999 - Test" });
});

test("with no matter number anywhere, the Litigation Strategy still says its to-dos were not read", async (t) => {
  const m = matterFixture(t, { folder: "Unnumbered Matter" });
  await seedOneFiling(m.dbPath);
  mkdirSync(join(m.matterRoot, "0. DRAFT"));
  const context = await practiceContext(t);
  const opened = await callTool(context, "drafting_forms__open_session", { matter_root: m.matterRoot });
  assert.match(boardData(opened.matter_board_path).todos_note, /not read/);

  await callTool(context, "drafting_forms__render", { db_path: m.dbPath, filing_id: 1, draft_dir: opened.draft_dir, session_token: opened.session_token });
  const data = boardData(opened.matter_board_path);
  assert.deepEqual(data.todos, []);
  assert.match(data.todos_note, /not read/);
});
