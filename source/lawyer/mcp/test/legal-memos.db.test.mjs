// The Legal Memos view page (forms/legal-memos-page.ts), which replaced Raw Research on 2026-10-31: which
// memos a board lists (the "linked" rule), versions collapsed into one memo, a memo no job saved, a board
// with none, the board_card memos lane reading the same list, and the rename: an old Raw Research page
// moves to TRASH on the next write and its thumbnail keeps its viewed place.

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

process.env.COCLERK_SUBMISSION_LOCK_ROOT = mkdtempSync(join(tmpdir(), "coclerk-legal-memos-locks-"));
after(() => rmSync(process.env.COCLERK_SUBMISSION_LOCK_ROOT, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));

const { freshSubmissionDb } = await import("./helpers/template-db.mjs");
const { submissionDataExecute } = await import("../build/submission/backend.js");
const { submissionFormsRender } = await import("../build/submission/forms.js");
const { fetchFiling } = await import("../build/submission/forms/query.js");
const { boardJobs, buildLegalMemosData, memoSourceOf, versionOf } = await import("../build/submission/forms/legal-memos-page.js");
const { readViewed } = await import("../build/submission/forms/board-viewed.js");
const { callTool } = await import("../build/dispatch.js");
const { awaitBackgroundJobs } = await import("../build/submission/render-job.js");
const { ASHBOURNE } = await import("./fixtures/forms-render-seeds.mjs");

const NOW = "2026-10-31 09:00";
/** Job 1's lock: this minute, so board_card, which reads the clock, does not read it as lapsed. */
const LOCKED_AT = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);

// Proceeding 1: Writings 1 and 2, each its own board. Proceeding 2: Writing 3.
// Job 1 (Writing 1, in progress) saved two versions of one answer and names fact 1.
// Job 2 (General, proceeding 1, completed) saved a memo both of proceeding 1's boards share.
// Job 3 (Writing 3, completed) saved a memo on proceeding 2's board only.
// Job 4 (Writing 2, queued) saved a memo: started.
// On disk too, saved by no job: a Westlaw report and two versions of a note-up. Not memos: a decision and a statute.
const FILES = [
  "Set off/2026-10-01 research-lawyer answer.md",
  "Set off/2026-10-01 research-lawyer answer v2.md",
  "Costs/2026-10-02 ML re costs of the application.md",
  "Other/2026-10-03 ML re a point for the counterclaim.md",
  "Set off/2026-10-04 ML re pleading set-off.md",
  "2026-07-08 Westlaw equitable set-off against a promissory note.docx",
  "Costs/2026-10-26 note-up Sample v Example, 2019 BCSC 1.md",
  "Costs/2026-10-26 note-up Sample v Example, 2019 BCSC 1 v2.md",
  "Set off/2019 BCSC 1 Sample v Example.docx",
  "Set off/Interpretation Act, RSBC 1996, c 238.md",
];

async function fixture(t, { files = FILES, jobs = true } = {}) {
  const base = mkdtempSync(join(tmpdir(), "coclerk-legal-memos-"));
  t.after(async () => {
    await awaitBackgroundJobs();
    rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });
  const matterRoot = join(base, "L9999 Test Matter");
  const caseDataDir = join(matterRoot, "0. CASE DATA");
  mkdirSync(join(matterRoot, "0. DRAFT"), { recursive: true });
  mkdirSync(caseDataDir, { recursive: true });
  writeFileSync(join(matterRoot, "coclerk.json"), JSON.stringify({ schema_version: 5, matter_root: matterRoot, case_data_dir: "0. CASE DATA", evidence_sql_path: "x.sql" }), "utf-8");
  for (const f of files) {
    mkdirSync(join(matterRoot, "6. LAW", f, ".."), { recursive: true });
    writeFileSync(join(matterRoot, "6. LAW", f), "memo", "utf-8");
  }
  const m = { matterRoot, draft: join(matterRoot, "0. DRAFT"), law: join(matterRoot, "6. LAW"), dbPath: join(caseDataDir, "submission.sqlite") };
  await freshSubmissionDb(m.dbPath);
  const VANIAC = "CAN/BC/Vancouver-International-Arbitration-Centre";
  await submissionDataExecute(
    m.dbPath,
    `INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L9999 - Test', '${VANIAC}'), (2, 'L9999 - Test', '${VANIAC}');
     INSERT INTO filings (id, proceeding_id, kind, round, title) VALUES (1, 1, 'submissions_package', 'opening', 'Opening Submissions Package'),
                                                                        (2, 1, 'submissions_package', 'reply', 'Reply Submissions Package'),
                                                                        (3, 2, 'submissions_package', 'opening', 'Counterclaim Submissions');
     INSERT INTO facts (id, proceeding_id, postulate) VALUES (1, 1, 'The note was signed on closing.'), (2, 1, 'An unrelated fact.');`
  );
  if (jobs) {
    await submissionDataExecute(
      m.dbPath,
      `INSERT INTO tickets (id, proceeding_id, filing_id, title, intent, status, priority, kind, billing_anchor, created, locked_by, locked_at, completed_at) VALUES
         (1, 1, 1, 'Research set-off', 'Can set-off be raised against a promissory note?', 'wip', 0, 'work', 'L9999', '2026-10-01 08:00', 'tok-1', '${LOCKED_AT}', NULL),
         (2, 1, NULL, 'Research costs', 'Who bears the costs of the application?', 'completed', 0, 'work', 'L9999', '2026-10-02 08:00', NULL, NULL, '2026-10-02 10:00'),
         (3, 2, 3, 'Research counterclaim', 'A counterclaim question?', 'completed', 0, 'work', 'L9999', '2026-10-03 08:00', NULL, NULL, '2026-10-03 10:00'),
         (4, 1, 2, 'Research pleading', 'How is set-off pleaded?', 'queued', 0, 'work', 'L9999', '2026-10-04 08:00', NULL, NULL, NULL);
       INSERT INTO ticket_scope (ticket_id, entity, entity_id) VALUES (1, 'facts', 1);
       INSERT INTO ticket_answers (ticket_id, file_path, saved_at) VALUES
         (1, '6. LAW\\Set off\\2026-10-01 research-lawyer answer.md', '2026-10-01T09:00'),
         (1, '6. LAW\\Set off\\2026-10-01 research-lawyer answer v2.md', '2026-10-01T11:00'),
         (2, '6. LAW\\Costs\\2026-10-02 ML re costs of the application.md', '2026-10-02T09:30'),
         (3, '6. LAW\\Other\\2026-10-03 ML re a point for the counterclaim.md', '2026-10-03T09:30'),
         (4, '6. LAW\\Set off\\2026-10-04 ML re pleading set-off.md', '2026-10-04T09:30');`
    );
  }
  return m;
}

const memosOf = (m, filingIds) => buildLegalMemosData(m.dbPath, boardJobs(m.dbPath, filingIds.map((id) => ({ filing: fetchFiling(m.dbPath, id) })), NOW), m.law).memos;
const byTitle = (memos) => Object.fromEntries(memos.map((x) => [x.title, x]));

test("a memo's kind is read from its name, and decisions, statutes and manifests are not memos", () => {
  assert.equal(memoSourceOf("2026-10-21 ML re proof of service.md"), "research_memo");
  assert.equal(memoSourceOf("2026-10-04 research-lawyer answer v2.md"), "research_memo");
  assert.equal(memoSourceOf("2026-10-26 note-up Allen v. Khinda, 2022 BCCA 175.md"), "note_up");
  assert.equal(memoSourceOf("Under Rule 14-1 of the British Columbia Supreme Court Civil Rules what principles govern.docx"), "westlaw");
  assert.equal(memoSourceOf("2021 BCSC 2075 Tenshi Seafood v Ocean Run Seafood Canada.docx"), null);
  assert.equal(memoSourceOf("2003 BCSC 1575 Triathlon v Kirkpatrick.doc"), null);
  assert.equal(memoSourceOf("Arbitration Act, SBC 2020, c 2.md"), null);
  assert.equal(memoSourceOf("case-download-manifest.json"), null);
  assert.equal(memoSourceOf("2026-08-06 Westlaw costs disposition.docx.txt"), null);
});

test("versions share one key; the bare name is version 1", () => {
  assert.deepEqual(versionOf("6. LAW\\Costs\\x answer v3.md"), { key: "6. law\\costs\\x answer.md", version: 3 });
  assert.deepEqual(versionOf("6. LAW\\Costs\\X Answer.md"), { key: "6. law\\costs\\x answer.md", version: 1 });
  assert.deepEqual(versionOf("6. LAW\\note-up Bolin v. Lylick, 2018 BCCA 127.md").version, 1);
});

test("a board lists its own jobs' memos, its proceeding's General jobs' memos and the memos no job saved, versions collapsed", async (t) => {
  const m = await fixture(t);
  const memos = byTitle(memosOf(m, [1]));
  assert.deepEqual(Object.keys(memos).sort(), [
    "ML re costs of the application",
    "Westlaw equitable set-off against a promissory note",
    "note-up Sample v Example, 2019 BCSC 1",
    "research-lawyer answer",
  ]);
  const answer = memos["research-lawyer answer"];
  assert.equal(answer.version, 2);
  assert.deepEqual(answer.earlier, [1]);
  assert.equal(answer.status, "in_progress");
  assert.deepEqual(answer.issues, ["Can set-off be raised against a promissory note?"]);
  assert.deepEqual(answer.facts, ["The note was signed on closing."]);
  assert.deepEqual(answer.jobs, [{ id: 1, title: "Research set-off" }]);
  assert.equal(answer.file, "6. LAW\\Set off\\2026-10-01 research-lawyer answer v2.md");
  assert.equal(answer.folder, "Set off");
  assert.equal(answer.source, "research_memo");
  assert.ok(answer.url.startsWith("file:///") && answer.url.endsWith("research-lawyer%20answer%20v2.md"), answer.url);
  assert.equal(answer.on_disk, true);
  assert.equal(memos["ML re costs of the application"].status, "completed");
  const noteUp = memos["note-up Sample v Example, 2019 BCSC 1"];
  assert.equal(noteUp.source, "note_up");
  assert.equal(noteUp.version, 2);
  assert.deepEqual(noteUp.earlier, [1]);
});

test("a memo shared by two boards: a General job's memo is on both of its proceeding's boards, a Writing job's on its own", async (t) => {
  const m = await fixture(t);
  const first = byTitle(memosOf(m, [1]));
  const second = byTitle(memosOf(m, [2]));
  assert.ok(first["ML re costs of the application"] && second["ML re costs of the application"]);
  assert.equal(second["research-lawyer answer"], undefined, "Writing 1's job's memo is not on Writing 2's board");
  assert.equal(second["ML re pleading set-off"].status, "started");
  assert.equal(first["ML re pleading set-off"], undefined);
  const third = byTitle(memosOf(m, [3]));
  assert.ok(third["ML re a point for the counterclaim"]);
  assert.equal(first["ML re a point for the counterclaim"], undefined, "a memo another board's job saved is not linked here");
  // A merged board reads every Writing's jobs once.
  assert.equal(memosOf(m, [1, 2]).filter((x) => x.title === "ML re costs of the application").length, 1);
});

test("a memo no job saved is on every board, with no issue and no status of a job", async (t) => {
  const m = await fixture(t);
  for (const id of [1, 2, 3]) {
    const westlaw = byTitle(memosOf(m, [id]))["Westlaw equitable set-off against a promissory note"];
    assert.equal(westlaw.status, "no_job");
    assert.equal(westlaw.source, "westlaw");
    assert.deepEqual(westlaw.issues, []);
    assert.deepEqual(westlaw.jobs, []);
    assert.equal(westlaw.folder, "");
    assert.equal(westlaw.date, "2026-07-08");
  }
});

test("a recorded answer no longer on disk is still listed, marked", async (t) => {
  const m = await fixture(t, { files: FILES.filter((f) => !f.endsWith("answer v2.md")) });
  const answer = byTitle(memosOf(m, [1]))["research-lawyer answer"];
  assert.equal(answer.version, 2);
  assert.equal(answer.on_disk, false);
});

test("a board with no memos lists none, and so does board_card", async (t) => {
  const m = await fixture(t, { files: [], jobs: false });
  assert.deepEqual(memosOf(m, [1]), []);
  const result = await callTool({}, "drafting_forms__board_card", { db_path: m.dbPath, filing_id: 1, lanes: ["memos"], draft_dir: m.draft });
  assert.equal(result.card, "## Legal Memos (0)");
});

test("board_card's memos lane prints the page's list with every field", async (t) => {
  const m = await fixture(t);
  await assert.rejects(callTool({}, "drafting_forms__board_card", { db_path: m.dbPath, filing_id: 1, lanes: ["memos"] }), /memos lane needs draft_dir/);
  const { card } = await callTool({}, "drafting_forms__board_card", { db_path: m.dbPath, filing_id: 1, lanes: ["memos"], draft_dir: m.draft });
  const lines = card.split("\n");
  assert.equal(lines[0], "## Legal Memos (4)");
  assert.ok(
    lines.includes("- research-lawyer answer · research memo · in progress · 2026-10-01 · v2 (earlier: v1) · 6. LAW\\Set off\\2026-10-01 research-lawyer answer v2.md"),
    card
  );
  assert.ok(lines.includes('  issue: "Can set-off be raised against a promissory note?"'), card);
  assert.ok(lines.includes('  facts: "The note was signed on closing."'), card);
  assert.ok(lines.includes("  jobs: #1 Research set-off"), card);
  assert.ok(lines.includes("  issue: none (no job saved it)"), card);
  assert.equal(lines.filter((l) => l.startsWith("- ")).length, memosOf(m, [1]).length);
});

test("the next write moves an old Raw Research page to TRASH and writes Legal Memos in its place", async (t) => {
  const m = await fixture(t);
  const folder = join(m.draft, "Opening Submissions Package");
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "Raw Research.html"), '<!doctype html><main data-view-page="1"></main>', "utf-8");
  writeFileSync(join(m.draft, "Raw Research - Milestone 1.html"), '<!doctype html><main data-view-page="1"></main>', "utf-8");
  writeFileSync(join(folder, "Raw Research notes.html"), "the practitioner's own file", "utf-8");
  const result = await submissionFormsRender(m.dbPath, 1, ASHBOURNE, "mockup", undefined, undefined, undefined, NOW, "tok-memos", m.draft);
  assert.ok(existsSync(join(folder, "Legal Memos.html")));
  assert.equal(existsSync(join(folder, "Raw Research.html")), false);
  assert.equal(existsSync(join(m.draft, "Raw Research - Milestone 1.html")), false);
  assert.ok(existsSync(join(folder, "Raw Research notes.html")), "a file the generator did not write stays");
  assert.ok(readdirSync(join(m.matterRoot, "TRASH"), { recursive: true }).some((f) => String(f).endsWith("Raw Research.html")));
  assert.ok(result.view_page_paths.some((v) => v.name === "Legal Memos" && v.filing_id === 1));
  assert.equal(result.view_page_paths.some((v) => v.name === "Raw Research"), false);
});

test("a viewed Raw Research thumbnail keeps its place as Legal Memos", async (t) => {
  const m = await fixture(t);
  await submissionDataExecute(m.dbPath, `INSERT INTO db_meta (key, value) VALUES ('board_viewed:filing:1', '["view:Raw Research","view:Arguments"]')`);
  assert.deepEqual(readViewed(m.dbPath, { filing_id: 1, proceeding_id: 1 }), ["view:Legal Memos", "view:Arguments"]);
});
