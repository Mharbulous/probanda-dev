// The preview tools (map #125; contract #138, built #142) with the practitioner's real data: a
// preview is built as the page write builds the page, with the overrides composed in, written beside
// the page it previews, and nothing else is written. A real Loose Threads preview's buttons carry port
// 0 and no token. The page write's sweep leaves a preview where it is. Each preview is checked by its
// data line and its override, the way the matter-pages tests check a page.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import test, { after } from "node:test";

import { startFakeCloud } from "./helpers/fake-cloud.mjs";
import { matterFixture as housekeepingMatter, proposalFor, row, runDir, writeApproval } from "./helpers/housekeeping-fixture.mjs";

process.env.COCLERK_SUBMISSION_LOCK_ROOT = mkdtempSync(join(tmpdir(), "coclerk-pages-preview-locks-"));
after(() => rmSync(process.env.COCLERK_SUBMISSION_LOCK_ROOT, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));

const { freshSubmissionDb } = await import("./helpers/template-db.mjs");
const { submissionDataExecute } = await import("../build/submission/backend.js");
const { callTool, createDispatchContext } = await import("../build/index.js");
const { awaitBackgroundJobs } = await import("../build/submission/render-job.js");
const { pagesTemplate } = await import("../build/pages/preview.js");
const { callFileManagerTool } = await import("../build/file-manager-dispatch.js");
const { mintRunId } = await import("../build/housekeeping/run-dir.js");
const { writeRunFile } = await import("../build/housekeeping/run-files.js");
const writes = await import("../build/tools/practice/writes.js");

const MARK = "/* preview override */";

/** The page's first .css file with MARK appended. */
function cssOverride(page) {
  const { files } = pagesTemplate(page);
  const file = Object.keys(files).find((f) => f.endsWith(".css"));
  return { [file]: `${files[file]}\n${MARK}` };
}

/** The JSON a page's one data line assigns to `name`. */
function dataLine(html, name) {
  const line = html.split("\n").find((l) => l.startsWith(`window.${name} = `));
  assert.ok(line, `the page has its window.${name} line`);
  return JSON.parse(line.slice(`window.${name} = `.length, -1));
}

// <tmp>/L9999 Test Matter/coclerk.json -> <tmp>/L9999 Test Matter/0. CASE DATA/submission.sqlite, beside its 0. DRAFT, as matter-pages.db.test.mjs.
function matterFixture(t) {
  const base = mkdtempSync(join(tmpdir(), "coclerk-pages-preview-"));
  t.after(async () => {
    await awaitBackgroundJobs();
    rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });
  const matterRoot = join(base, "L9999 Test Matter");
  const caseDataDir = join(matterRoot, "0. CASE DATA");
  mkdirSync(join(matterRoot, "0. DRAFT"), { recursive: true });
  mkdirSync(caseDataDir, { recursive: true });
  writeFileSync(join(matterRoot, "coclerk.json"), JSON.stringify({ schema_version: 5, matter_root: matterRoot, case_data_dir: "0. CASE DATA", evidence_sql_path: "x.sql" }), "utf-8");
  return { matterRoot, draft: join(matterRoot, "0. DRAFT"), dbPath: join(caseDataDir, "submission.sqlite") };
}

async function seedOneFiling(dbPath) {
  await freshSubmissionDb(dbPath);
  await submissionDataExecute(
    dbPath,
    `INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L9999 - Test', 'CAN/BC/Vancouver-International-Arbitration-Centre');
     INSERT INTO filings (id, proceeding_id, kind, round, title) VALUES (1, 1, 'submissions_package', 'opening', 'Opening Submissions Package');`
  );
}

async function practiceContext(t) {
  const dir = mkdtempSync(join(tmpdir(), "coclerk-pages-preview-practice-"));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
  const practicePath = join(dir, `practice-${randomUUID()}.db`);
  const context = await createDispatchContext({ ...process.env, ...(await startFakeCloud(t)).env, COCLERK_DB_PATH: practicePath });
  await writes.upsert_client_matter(context.practiceDb, { client_num: "C-9999", name: "Lookup Client Ltd.", matt_num: "L9999", file_number: "F-9999" });
  return { context, practicePath };
}

test("a real-data preview of a matter page is the page as the write builds it, overridden, written beside it and nothing else", async (t) => {
  const m = matterFixture(t);
  await seedOneFiling(m.dbPath);
  const { context } = await practiceContext(t);
  const preview = (args) => callTool(context, "pages__preview", { data: "real", matter_root: m.matterRoot, ...args });

  const strategy = await preview({ page: "Litigation Strategy", overrides: cssOverride("Litigation Strategy") });
  const milestone = await preview({ page: "Milestone", filing_id: 1, overrides: cssOverride("Milestone") });
  const threads = await preview({ page: "Loose Threads", filing_id: 1, overrides: cssOverride("Loose Threads") });
  const again = await preview({ page: "Milestone", filing_id: 1 });
  assert.deepEqual(Object.keys(strategy), ["path"], "the path only, never the HTML");
  // The Writing's pages are in its own folder (spec 2026-10-22 §9), so its previews are written there.
  const writing = join(m.draft, "Opening Submissions Package");
  assert.deepEqual(
    [strategy, milestone, threads, again].map((r) => [dirname(r.path).toLowerCase(), basename(r.path)]),
    [
      [m.draft.toLowerCase(), "Litigation Strategy preview 1.html"],
      [writing.toLowerCase(), "Milestone preview 1.html"],
      [writing.toLowerCase(), "Loose Threads preview 1.html"],
      [writing.toLowerCase(), "Milestone preview 2.html"],
    ]
  );
  assert.deepEqual(readdirSync(m.draft).sort(), [basename(strategy.path), basename(writing)].sort(), "no page and no other file was written");
  assert.deepEqual(readdirSync(writing).sort(), [milestone, threads, again].map((r) => basename(r.path)).sort(), "no page and no other file was written");

  const html = (r) => readFileSync(r.path, "utf-8");
  assert.equal(dataLine(html(strategy), "MATTER_BOARD").meta.matter, "L9999", "the matter's own data, looked up as session entry looks it up");
  assert.deepEqual(dataLine(html(milestone), "WORKBOARD").sections.map((s) => s.meta.filing_id), [1]);
  for (const r of [strategy, milestone, threads]) assert.ok(html(r).includes(MARK), `${basename(r.path)} carries its override`);
  assert.equal(html(again).includes(MARK), false, "no override: the board's own template");
  const { api } = dataLine(html(threads), "VIEW_PAGE").data;
  assert.equal(api.port, 0, "the buttons reach no listener");
  assert.equal(api.token, "");
  assert.equal(api.tokens, undefined);

  // The page write's sweep moves old page files to TRASH; a preview is not one.
  await callTool(context, "drafting_forms__open_session", { matter_root: m.matterRoot });
  for (const r of [strategy, milestone, threads, again]) assert.ok(readdirSync(dirname(r.path)).includes(basename(r.path)), `${basename(r.path)} stays after a page write`);

  await assert.rejects(preview({ page: "Arguments", filing_id: 9 }), /no Arguments page for Milestone 9/);
});

test("a real-data Work Board preview is written beside practice.db", async (t) => {
  const { context, practicePath } = await practiceContext(t);
  const saved = process.env.COCLERK_DB_PATH;
  process.env.COCLERK_DB_PATH = practicePath;
  t.after(() => (saved === undefined ? delete process.env.COCLERK_DB_PATH : (process.env.COCLERK_DB_PATH = saved)));
  const { path } = await callTool(context, "pages__preview", { page: "Work Board", data: "real", overrides: cssOverride("Work Board") });
  assert.equal(path, join(dirname(practicePath), "Work Board preview 1.html"));
  assert.ok(readFileSync(path, "utf-8").includes(MARK));
  assert.ok(dataLine(readFileSync(path, "utf-8"), "PRACTICE_BOARD").panels);
  await assert.rejects(callTool(context, "pages__preview", { page: "Work Board", data: "real", filing_id: 1 }), /whole practice/);
});

test("a real-data housekeeping preview draws the run's proposal and approval, in the run's folder", async (t) => {
  const m = housekeepingMatter({ "a.pdf": "a bytes" });
  t.after(() => m.cleanup());
  const runId = mintRunId();
  mkdirSync(runDir(m, runId), { recursive: true });
  const rows = [row(m, "a.pdf", { row_id: "r1", action: { kind: "move", folder: "3. CORRESPONDENCE" } })];
  writeRunFile(m.root, runId, "proposal.json", JSON.stringify(proposalFor(m, runId, rows)));
  writeApproval(m, runId, [{ row_id: "r1", approve: true }]);
  const { files } = pagesTemplate("Housekeeping approval");
  const { path } = await callFileManagerTool("housekeeping__preview", {
    data: "real",
    matter_root: m.root,
    run_id: runId,
    overrides: { "approval.css": `${files["approval.css"]}\n${MARK}` },
  });
  assert.equal(dirname(path).toLowerCase(), runDir(m, runId).toLowerCase());
  assert.equal(basename(path), "Housekeeping approval preview 1.html");
  const text = readFileSync(path, "utf-8");
  assert.ok(text.includes(MARK));
  assert.ok(text.includes(`"run_id":"${runId}"`), "the run's own proposal");
  assert.ok(text.includes(`"approved_at":"2026-09-24T21:00:00.000Z"`), "and its recorded approval");
});
