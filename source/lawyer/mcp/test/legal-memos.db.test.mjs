// The Legal Memos view page (forms/legal-memos-page.ts), which replaced Raw Research on 2026-10-31: which
// memos a board lists (the "linked" rule), versions collapsed into one memo, a memo no job saved, a board
// with none, the board_card memos lane reading the same list, and the rename: an old Raw Research page
// moves to TRASH on the next write and its thumbnail keeps its viewed place. Every name is synthetic.

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

process.env.COCLERK_SUBMISSION_LOCK_ROOT = mkdtempSync(join(tmpdir(), "coclerk-legal-memos-locks-"));
after(() => rmSync(process.env.COCLERK_SUBMISSION_LOCK_ROOT, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));

const { freshSubmissionDb } = await import("./helpers/template-db.mjs");
const { submissionDataExecute } = await import("../build/submission/backend.js");
const { submissionFormsRender } = await import("../build/submission/forms.js");
const { boardSection } = await import("../build/submission/board-card.js");
const { DATES_NOT_READ } = await import("../build/submission/matter-board-section.js");
const { buildLegalMemosData, memoSourceOf, versionOf } = await import("../build/submission/forms/legal-memos-page.js");
const { readViewed } = await import("../build/submission/forms/board-viewed.js");
const { callTool } = await import("../build/dispatch.js");
const { awaitBackgroundJobs } = await import("../build/submission/render-job.js");
const { ASHBOURNE } = await import("./fixtures/forms-render-seeds.mjs");

/** One clock for the whole file: job 1's lock is this minute, so neither the reader nor board_card,
 * which reads the clock, reads it as lapsed. */
const LOCKED_AT = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
const NOW = LOCKED_AT.replace("T", " ");

// Proceeding 1: Writings 1, 2 and 4 (4 retired). Proceeding 2: Writing 3.
const FILES = [
  "Set off/2026-10-01 research-lawyer answer.md", // A v1, job 1 (Writing 1, held)
  "Set off/2026-10-01 research-lawyer answer v2.md", // A v2, job 1
  "Costs/2026-10-02 ML re costs of the application.md", // B, job 2 (General, proceeding 1, completed)
  "Other/2026-10-03 ML re a point for the counterclaim.md", // C, job 3 (Writing 3, completed)
  "Set off/2026-10-04 ML re pleading set-off.md", // D, job 4 (Writing 2, queued)
  "Set off/2026-10-04 ML re an abandoned angle.md", // E, job 5 (Writing 1, shelved)
  "Other/2026-10-04 ML re a superseded question.md", // F, job 6 (Writing 3, superseded)
  "Costs/2026-10-04 ML re a retired filing's point.md", // G, job 7 (Writing 4, retired)
  "Costs/2026-10-04 ML re a deleted job's point.md", // H, job 8 (Writing 1, deleted)
  "Shared/2026-10-05 ML re a shared point.md", // S v1, job 9 (Writing 1)
  "Shared/2026-10-05 ML re a shared point v2.md", // S v2, job 10 (Writing 3)
  "Set off/2026-10-06 Limitation analysis.md", // L, job 11 (Writing 1): a name no kind matches
  "2026-07-08 Westlaw set-off against a promissory note.docx", // no job
  "Costs/2026-10-26 note-up Sample v Example, 2019 BCSC 1.md", // no job, v1
  "Costs/2026-10-26 note-up Sample v Example, 2019 BCSC 1 v2.md", // no job, v2
  "Costs/Sample v Example note-up.md", // no job, keyword before the extension
  "Set off/2019 BCSC 1 Sample v Example.docx", // a decision: not a memo
  "Set off/Interpretation Act, RSBC 1996, c 238.md", // a statute: not a memo
];
const A = "research-lawyer answer";
const B = "ML re costs of the application";
const C = "ML re a point for the counterclaim";
const D = "ML re pleading set-off";
const E = "ML re an abandoned angle";
const F = "ML re a superseded question";
const G = "ML re a retired filing's point";
const H = "ML re a deleted job's point";
const S = "ML re a shared point";
const L = "Limitation analysis";
const WESTLAW = "Westlaw set-off against a promissory note";
const NOTE_UP = "note-up Sample v Example, 2019 BCSC 1";
const NOTE_UP_END = "Sample v Example note-up";
const NO_JOB = [WESTLAW, NOTE_UP, NOTE_UP_END, G, H];

const law = (rel) => `6. LAW\\${rel.replace(/\//g, "\\")}`;

async function fixture(t, { files = FILES, jobs = true, lawName = "6. LAW" } = {}) {
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
    mkdirSync(join(matterRoot, lawName, f, ".."), { recursive: true });
    writeFileSync(join(matterRoot, lawName, f), "memo", "utf-8");
  }
  const m = { matterRoot, draft: join(matterRoot, "0. DRAFT"), dbPath: join(caseDataDir, "submission.sqlite") };
  await freshSubmissionDb(m.dbPath);
  const VANIAC = "CAN/BC/Vancouver-International-Arbitration-Centre";
  await submissionDataExecute(
    m.dbPath,
    `INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L9999 - Test', '${VANIAC}'), (2, 'L9999 - Test', '${VANIAC}');
     INSERT INTO filings (id, proceeding_id, kind, round, title) VALUES (1, 1, 'submissions_package', 'opening', 'Opening Submissions Package'),
                                                                        (2, 1, 'submissions_package', 'reply', 'Reply Submissions Package'),
                                                                        (3, 2, 'submissions_package', 'opening', 'Counterclaim Submissions'),
                                                                        (4, 1, 'submissions_package', 'opening', 'Earlier Submissions Package');
     UPDATE filings SET decided_on = '2026-09-02', retired_on = '2026-09-10', retirement_reason = 'decided' WHERE id = 4;
     INSERT INTO facts (id, proceeding_id, postulate) VALUES (1, 1, 'The note was signed on closing.'), (2, 1, 'An unrelated fact.');`
  );
  if (jobs) {
    const job = (id, proceeding, filing, title, intent, status, extra = {}) =>
      `(${id}, ${proceeding}, ${filing ?? "NULL"}, '${title}', '${intent}', '${status}', 0, 'work', 'L9999', '2026-10-01 08:00', ${extra.locked ? `'tok-${id}', '${LOCKED_AT}'` : "NULL, NULL"}, ${status === "completed" ? "'2026-10-02 10:00'" : "NULL"}, ${extra.rejected ? "'2026-10-04 10:00'" : "NULL"}, ${extra.deleted ? "'2026-10-04 11:00'" : "NULL"})`;
    const answers = [
      [1, FILES[0], "2026-10-01T09:00"], [1, FILES[1], "2026-10-01T11:00"], [2, FILES[2]], [3, FILES[3]], [4, FILES[4]], [5, FILES[5]], [6, FILES[6]],
      [7, FILES[7]], [8, FILES[8]], [9, FILES[9]], [10, FILES[10]], [11, FILES[11]],
    ];
    await submissionDataExecute(
      m.dbPath,
      `INSERT INTO tickets (id, proceeding_id, filing_id, title, intent, status, priority, kind, billing_anchor, created, locked_by, locked_at, completed_at, rejected_at, deleted_at) VALUES
         ${[
           job(1, 1, 1, "Research set-off", "Can set-off be raised against a promissory note?", "wip", { locked: true }),
           job(2, 1, null, "Research costs", "Who bears the costs of the application?", "completed"),
           job(3, 2, 3, "Research counterclaim", "A counterclaim question?", "completed"),
           job(4, 1, 2, "Research pleading", "How is set-off pleaded?", "queued"),
           job(5, 1, 1, "Research an angle", "An abandoned question?", "queued", { rejected: true }),
           job(6, 2, 3, "Research a superseded point", "A superseded question?", "superseded"),
           job(7, 1, 4, "Research for the earlier filing", "An earlier question?", "completed"),
           job(8, 1, 1, "Research a deleted point", "A deleted question?", "completed", { deleted: true }),
           job(9, 1, 1, "Research a shared point", "A shared question?", "completed"),
           job(10, 2, 3, "Research the shared point again", "The shared question, again?", "completed"),
           job(11, 1, 1, "Research limitation", "", "completed"),
         ].join(",\n")};
       INSERT INTO ticket_scope (ticket_id, entity, entity_id) VALUES (1, 'facts', 1);
       INSERT INTO ticket_answers (ticket_id, file_path, saved_at) VALUES
         ${answers.map(([id, f, at]) => `(${id}, '${law(f).replace(/'/g, "''")}', '${at ?? "2026-10-05T09:30"}')`).join(",\n")};`
    );
  }
  return m;
}

/** The board's memos, from the jobs board_card reads. */
const memosOf = (m, filingId) => buildLegalMemosData(m.dbPath, boardSection(m.dbPath, { filing_id: filingId }, {}, NOW, DATES_NOT_READ).tickets, m.matterRoot).memos;
const byTitle = (memos) => Object.fromEntries(memos.map((x) => [x.title, x]));

test("a memo's kind is read from its name, and decisions, statutes and manifests are not memos", () => {
  assert.equal(memoSourceOf("2026-10-21 ML re proof of service.md"), "research_memo");
  assert.equal(memoSourceOf("2026-10-04 research-lawyer answer v2.md"), "research_memo");
  assert.equal(memoSourceOf("2026-10-26 note-up Sample v Example, 2022 BCCA 1.md"), "note_up");
  assert.equal(memoSourceOf("Sample v Example note-up.md"), "note_up");
  assert.equal(memoSourceOf("Under Rule 1-1 what principles govern an example.docx"), "westlaw");
  assert.equal(memoSourceOf("2021 BCSC 1 Sample v Example.docx"), null);
  assert.equal(memoSourceOf("2003 BCSC 1 Sample v Example.doc"), null);
  assert.equal(memoSourceOf("Arbitration Act, SBC 2020, c 2.md"), null);
  assert.equal(memoSourceOf("case-download-manifest.json"), null);
  assert.equal(memoSourceOf("2026-08-06 Westlaw costs disposition.docx.txt"), null);
});

test("versions share one key; the bare name is version 1", () => {
  assert.deepEqual(versionOf("6. LAW\\Costs\\x answer v3.md"), { key: "6. law\\costs\\x answer.md", version: 3 });
  assert.deepEqual(versionOf("6. LAW\\Costs\\X Answer.md"), { key: "6. law\\costs\\x answer.md", version: 1 });
  assert.equal(versionOf("6. LAW\\note-up Sample v. Example, 2018 BCCA 1.md").version, 1);
});

test("a board lists its own jobs' memos, its proceeding's General jobs' memos and the memos no job saved, versions collapsed", async (t) => {
  const m = await fixture(t);
  const memos = byTitle(memosOf(m, 1));
  assert.deepEqual(Object.keys(memos).sort(), [A, B, E, L, S, ...NO_JOB].sort());
  const answer = memos[A];
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
  assert.equal(memos[B].status, "completed");
  const noteUp = memos[NOTE_UP];
  assert.equal(noteUp.source, "note_up");
  assert.equal(noteUp.version, 2);
  assert.deepEqual(noteUp.earlier, [1]);
});

test("a memo shared by two boards: a General job's memo is on both of its proceeding's boards, and one memo two boards' jobs saved is on each with its own job", async (t) => {
  const m = await fixture(t);
  const first = byTitle(memosOf(m, 1));
  const second = byTitle(memosOf(m, 2));
  const third = byTitle(memosOf(m, 3));
  assert.ok(first[B] && second[B]);
  assert.equal(second[A], undefined, "Writing 1's job's memo is not on Writing 2's board");
  assert.equal(second[D].status, "started");
  assert.equal(first[D], undefined);
  assert.ok(third[C]);
  assert.equal(first[C], undefined, "a memo another board's job saved is not linked here");
  // S: Writing 1's job saved v1, Writing 3's job saved v2. Each board shows the memo at v2 with its own job.
  for (const [memos, id] of [[first, 9], [third, 10]]) {
    assert.equal(memos[S].version, 2);
    assert.deepEqual(memos[S].earlier, [1]);
    assert.deepEqual(memos[S].jobs.map((j) => j.id), [id]);
    assert.equal(memos[S].status, "completed");
  }
  assert.equal(second[S], undefined, "Writing 2's board has no job that saved it");
});

test("a memo no job saved is on every board, with no issue and no job", async (t) => {
  const m = await fixture(t);
  for (const id of [1, 2, 3]) {
    const westlaw = byTitle(memosOf(m, id))[WESTLAW];
    assert.equal(westlaw.status, "no_job");
    assert.equal(westlaw.source, "westlaw");
    assert.deepEqual(westlaw.issues, []);
    assert.deepEqual(westlaw.jobs, []);
    assert.equal(westlaw.folder, "");
    assert.equal(westlaw.date, "2026-07-08");
  }
});

test("a deleted job's memo, and a retired Writing's job's memo, are memos no job on a board saved", async (t) => {
  const m = await fixture(t);
  for (const id of [1, 2, 3]) {
    const memos = byTitle(memosOf(m, id));
    assert.equal(memos[G].status, "no_job", `board ${id}: the retired Writing's memo`);
    assert.equal(memos[H].status, "no_job", `board ${id}: the deleted job's memo`);
  }
});

test("a memo whose only jobs are shelved or superseded is Shelved", async (t) => {
  const m = await fixture(t);
  assert.equal(byTitle(memosOf(m, 1))[E].status, "shelved");
  assert.equal(byTitle(memosOf(m, 3))[F].status, "shelved");
});

test("a recorded answer is on disk whatever its name, and one no longer on disk is listed, marked", async (t) => {
  const m = await fixture(t, { files: FILES.filter((f) => !f.endsWith("answer v2.md")) });
  const memos = byTitle(memosOf(m, 1));
  assert.equal(memos[L].on_disk, true);
  assert.equal(memos[L].source, "research_memo");
  assert.deepEqual(memos[L].issues, [], "job 11 recorded no question");
  assert.equal(memos[A].version, 2);
  assert.equal(memos[A].on_disk, false);
});

test("the law folder is found whatever its case", async (t) => {
  const m = await fixture(t, { lawName: "6. Law" });
  const memos = byTitle(memosOf(m, 1));
  assert.equal(memos[WESTLAW].status, "no_job");
  assert.equal(memos[A].on_disk, true);
});

test("a board with no memos lists none, and so does board_card", async (t) => {
  const m = await fixture(t, { files: [], jobs: false });
  assert.deepEqual(memosOf(m, 1), []);
  const result = await callTool({}, "drafting_forms__board_card", { db_path: m.dbPath, filing_id: 1, lanes: ["memos"], draft_dir: m.draft });
  assert.equal(result.card, "## Legal Memos (0)");
});

test("board_card's memos lane prints the page's list with every field", async (t) => {
  const m = await fixture(t);
  await assert.rejects(callTool({}, "drafting_forms__board_card", { db_path: m.dbPath, filing_id: 1, lanes: ["memos"] }), /memos lane needs draft_dir/);
  const { card } = await callTool({}, "drafting_forms__board_card", { db_path: m.dbPath, filing_id: 1, lanes: ["memos"], draft_dir: m.draft });
  const lines = card.split("\n");
  const memos = memosOf(m, 1);
  assert.equal(lines[0], `## Legal Memos (${memos.length})`);
  assert.ok(lines.includes(`- ${A} · research memo · in progress · 2026-10-01 · v2 (earlier: v1) · 6. LAW\\Set off\\2026-10-01 research-lawyer answer v2.md`), card);
  assert.ok(lines.includes('  issue: "Can set-off be raised against a promissory note?"'), card);
  assert.ok(lines.includes('  facts: "The note was signed on closing."'), card);
  assert.ok(lines.includes("  jobs: #1 Research set-off"), card);
  assert.ok(lines.includes("  issue: none (no job saved it)"), card);
  assert.ok(lines.includes("  issue: none recorded"), card);
  assert.ok(lines.some((l) => l.startsWith(`- ${E} · research memo · shelved ·`)), card);
  assert.deepEqual(lines.filter((l) => l.startsWith("- ")).map((l) => l.slice(2).split(" · ")[0]), memos.map((x) => x.title));
});

/** A rendered view page's data, from its data line. */
function pageData(file) {
  const line = readFileSync(file, "utf-8").split("\n").find((l) => l.startsWith("window.VIEW_PAGE = "));
  return JSON.parse(line.slice("window.VIEW_PAGE = ".length, -1)).data;
}

test("the next write moves every old Raw Research page and preview to TRASH, writes Legal Memos in its place, and the page lists what the card lists", async (t) => {
  const m = await fixture(t);
  const folder = join(m.draft, "Opening Submissions Package");
  mkdirSync(folder, { recursive: true });
  const marked = '<!doctype html><main data-view-page="1"></main>';
  const old = [
    join(folder, "Raw Research.html"),
    join(m.draft, "Raw Research - Milestone 1.html"),
    join(m.draft, "Raw Research - Milestone - proceeding 3.html"),
    join(m.draft, "Raw Research - Job Board 7.html"),
    join(folder, "Raw Research preview 2.html"),
    join(m.draft, "Raw Research - Milestone 1 preview 1.html"),
  ];
  for (const file of old) writeFileSync(file, marked, "utf-8");
  writeFileSync(join(folder, "Raw Research notes.html"), "the practitioner's own file", "utf-8");
  writeFileSync(join(folder, "Arguments preview 1.html"), marked, "utf-8");
  const result = await submissionFormsRender(m.dbPath, 1, ASHBOURNE, "mockup", undefined, undefined, undefined, NOW, "tok-memos", m.draft);
  await awaitBackgroundJobs();
  assert.ok(existsSync(join(folder, "Legal Memos.html")));
  for (const file of old) assert.equal(existsSync(file), false, `${file} moved`);
  assert.ok(existsSync(join(folder, "Raw Research notes.html")), "a file the generator did not write stays");
  assert.ok(existsSync(join(folder, "Arguments preview 1.html")), "a current page's preview stays");
  const trashed = readdirSync(join(m.matterRoot, "TRASH"), { recursive: true }).map(String);
  for (const file of old) assert.ok(trashed.some((f) => f.endsWith(file.split(/[\\/]/).pop())), `${file} in TRASH`);
  assert.ok(result.view_page_paths.some((v) => v.name === "Legal Memos" && v.filing_id === 1));
  assert.equal(result.view_page_paths.some((v) => v.name === "Raw Research"), false);
  // The page and board_card read the same jobs with the same reader.
  const page = pageData(join(folder, "Legal Memos.html")).memos;
  const card = memosOf(m, 1);
  assert.deepEqual(
    page.map((x) => [x.title, x.status, x.version, x.jobs]),
    card.map((x) => [x.title, x.status, x.version, x.jobs])
  );
});

test("a viewed Raw Research thumbnail keeps its place as Legal Memos", async (t) => {
  const m = await fixture(t);
  await submissionDataExecute(m.dbPath, `INSERT INTO db_meta (key, value) VALUES ('board_viewed:filing:1', '["view:Raw Research","view:Arguments"]')`);
  assert.deepEqual(readViewed(m.dbPath, { filing_id: 1, proceeding_id: 1 }), ["view:Legal Memos", "view:Arguments"]);
});
