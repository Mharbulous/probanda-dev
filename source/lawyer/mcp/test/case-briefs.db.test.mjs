// The Case Briefs reader (forms/case-briefs.ts), the per-case guard on a brief job (forms/create-job.ts), and
// the Propositions tab's research-Writing filter (forms/research-propositions.ts). A missing or non-brief file,
// a case with no neutral citation, every saved file of one case on one row, a re-brief saved onto the same
// Writing, and Requested agreeing with the guard. legal-research.db.test.mjs holds the tab's plain cases. Every
// name is synthetic.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

process.env.COCLERK_SUBMISSION_LOCK_ROOT = mkdtempSync(join(tmpdir(), "coclerk-case-briefs-locks-"));
process.env.COCLERK_REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
after(() => rmSync(process.env.COCLERK_SUBMISSION_LOCK_ROOT, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));

const { freshSubmissionDb } = await import("./helpers/template-db.mjs");
const { submissionDataExecute, submissionDataQuery } = await import("../build/submission/backend.js");
const { submissionFormsRender } = await import("../build/submission/forms.js");
const { buildCaseBriefsData } = await import("../build/submission/forms/case-briefs.js");
const { citationKey, neutralKey } = await import("../build/submission/forms/brief-job.js");
const { isCaseBriefFile, memoSourceOf } = await import("../build/submission/forms/legal-memos.js");
const { buildPropositionsData } = await import("../build/submission/forms/research-propositions.js");
const { fetchFiling } = await import("../build/submission/forms/query.js");
const { submissionDataCreateJob } = await import("../build/submission/forms/create-job.js");
const { submissionDataCreateWriting } = await import("../build/submission/forms/layout-snapshot.js");
const { saveAnswer } = await import("../build/files/research-filing.js");
const { callTool } = await import("../build/dispatch.js");
const { awaitBackgroundJobs } = await import("../build/submission/render-job.js");
const { LEGAL_RESEARCH_FIXTURE } = await import("../build/board-fixtures/legal-research.js");

const JOB = "status, priority, kind, billing_anchor, created";
const NOW = "2026-11-01 09:00";
const FORUM = "CAN/BC/Vancouver-International-Arbitration-Centre";

/** Proceeding 1: Writing 1 relies on each case named in `authorities` ([id, style, citation]). Proceeding 2: Writing 2. */
async function matter(t, { authorities = [], files = [], sql = "" } = {}) {
  const base = mkdtempSync(join(tmpdir(), "coclerk-case-briefs-"));
  t.after(async () => {
    await awaitBackgroundJobs();
    rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });
  const matterRoot = join(base, "L9999 Test Matter");
  const caseData = join(matterRoot, "0. CASE DATA");
  const law = join(matterRoot, "6. LAW");
  mkdirSync(join(matterRoot, "0. DRAFT"), { recursive: true });
  mkdirSync(caseData, { recursive: true });
  mkdirSync(law, { recursive: true });
  writeFileSync(join(matterRoot, "coclerk.json"), JSON.stringify({ schema_version: 5, matter_root: matterRoot, case_data_dir: "0. CASE DATA", evidence_sql_path: "x.sql" }), "utf-8");
  for (const f of files) {
    mkdirSync(join(law, f, ".."), { recursive: true });
    writeFileSync(join(law, f), "brief", "utf-8");
  }
  const dbPath = join(caseData, "submission.sqlite");
  await freshSubmissionDb(dbPath);
  const quote = (v) => (v === null ? "NULL" : `'${v}'`);
  const rowsOf = (list) => list.join(", ");
  await submissionDataExecute(
    dbPath,
    `INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L9999', '${FORUM}'), (2, 'L9999', '${FORUM}');
     INSERT INTO filings (id, proceeding_id, kind, round, title) VALUES (1, 1, 'submissions_package', 'opening', 'W1'), (2, 2, 'submissions_package', 'opening', 'W2');
     ${
       authorities.length === 0
         ? ""
         : `INSERT INTO authorities (id, proceeding_id, style_of_cause_or_title, citation, kind) VALUES ${rowsOf(authorities.map(([id, style, citation]) => `(${id}, 1, ${quote(style)}, ${quote(citation)}, 'case')`))};
     INSERT INTO statements_of_law (id, proceeding_id, authority_id, pinpoint, excerpt, source, verification) VALUES ${rowsOf(authorities.map(([id]) => `(${id}, 1, ${id}, 'p', 'x', 'primary', 'lead')`))};
     INSERT INTO filing_law (filing_id, statement_id) VALUES ${rowsOf(authorities.map(([id]) => `(1, ${id})`))};`
     }
     ${sql}`
  );
  return { matterRoot, dbPath, law, draft: join(matterRoot, "0. DRAFT") };
}

const cases = (m, ids = [1]) => buildCaseBriefsData(m.dbPath, ids, m.matterRoot).cases;
const brief = (date, name, v = "") => `${date} case brief ${name}${v}.md`;

test("only a .md named as a brief is a brief, and any other file is no brief's and no memo's by that name", () => {
  assert.equal(isCaseBriefFile(brief("2026-10-01", "A v B, 2020 BCCA 1")), true);
  assert.equal(isCaseBriefFile(brief("2026-10-01", "A v B, 2020 BCCA 1", " v2")), true);
  assert.equal(isCaseBriefFile("case brief A v B.md"), true);
  assert.equal(isCaseBriefFile("Case Brief of the Appellant 2019.pdf"), false);
  assert.equal(isCaseBriefFile("2019-01-01 case brief for the appellant.pdf"), false);
  assert.equal(isCaseBriefFile("2026-10-01 ML re case brief practice.md"), false, "a memo that speaks of case briefs");
  assert.equal(memoSourceOf("2026-10-01 ML re case brief practice.md"), "research_memo");
  assert.equal(memoSourceOf("Case Brief of the Appellant 2019.pdf"), null);
});

test("a filing named Case Brief is not listed as a brief", async (t) => {
  const m = await matter(t, { files: ["Case Brief of the Appellant 2019.pdf", "2019-01-01 case brief for the appellant.pdf"] });
  assert.deepEqual(cases(m), []);
});

test("a recorded brief no longer on disk stays visible and marked, and does not stop a new request", async (t) => {
  const m = await matter(t, {
    authorities: [[2, "Gone v Away", "2021 BCSC 2"], [3, "Still v Asked", "2021 BCSC 3"]],
    sql: `INSERT INTO tickets (id, proceeding_id, filing_id, title, intent, ${JOB}) VALUES
            (9, 1, 1, 'Brief the case: Gone v Away, 2021 BCSC 2', 'x', 'superseded', 0, 'work', 'L', '2026-10-01 08:00'),
            (10, 1, 1, 'Brief the case: Still v Asked, 2021 BCSC 3', 'x', 'queued', 0, 'work', 'L', '2026-10-01 08:00');
          INSERT INTO ticket_scope (ticket_id, entity, entity_id) VALUES (9, 'authorities', 2), (10, 'authorities', 3);
          INSERT INTO ticket_answers (ticket_id, file_path, saved_at) VALUES
            (9, '6. LAW\\${brief("2026-10-01", "Gone v Away, 2021 BCSC 2")}', '2026-10-01T09:00'),
            (10, '6. LAW\\${brief("2026-10-02", "Still v Asked, 2021 BCSC 3")}', '2026-10-02T09:00');`,
  });
  const by = Object.fromEntries(cases(m).map((c) => [c.title, c]));
  assert.equal(by["Gone v Away"].status, "not_briefed", "jobs-stock.md 3n writes only for not briefed");
  assert.equal(by["Gone v Away"].brief.on_disk, false);
  assert.equal(by["Gone v Away"].brief.date, "2026-10-01");
  assert.equal(by["Still v Asked"].status, "requested", "a live job with its file gone");
  const { card } = await callTool({}, "drafting_forms__board_card", { db_path: m.dbPath, filing_id: 1, lanes: ["briefs"], draft_dir: m.draft });
  assert.match(card, /- Gone v Away, 2021 BCSC 2 · not briefed · relied on · 2026-10-01 · v1 · .* · not in the law folder/);
});

test("a case whose latest version is gone is still briefed while an earlier one is on disk", async (t) => {
  const stem = "Kept v Copy, 2021 BCSC 4";
  const m = await matter(t, {
    authorities: [[4, "Kept v Copy", "2021 BCSC 4"]],
    files: [brief("2026-10-01", stem)],
    sql: `INSERT INTO tickets (id, proceeding_id, filing_id, title, intent, ${JOB}) VALUES (9, 1, 1, 'Brief the case: ${stem}', 'x', 'superseded', 0, 'work', 'L', '2026-10-01 08:00');
          INSERT INTO ticket_scope (ticket_id, entity, entity_id) VALUES (9, 'authorities', 4);
          INSERT INTO ticket_answers (ticket_id, file_path, saved_at) VALUES (9, '6. LAW\\${brief("2026-10-01", stem, " v2")}', '2026-10-02T09:00');`,
  });
  const [c] = cases(m);
  assert.equal(c.status, "briefed");
  assert.equal(c.brief.version, 2);
  assert.equal(c.brief.on_disk, false);
  assert.deepEqual(c.brief.earlier_files.map((f) => [f.version, f.on_disk]), [[1, true]]);
});

test("a job's answer that is not named as a brief makes the case no brief", async (t) => {
  const m = await matter(t, {
    authorities: [[2, "Pdf v Saved", "2021 BCSC 2"]],
    files: ["2021 BCSC 2 Pdf v Saved.pdf"],
    sql: `INSERT INTO tickets (id, proceeding_id, filing_id, title, intent, ${JOB}) VALUES (9, 1, 1, 'Brief the case: Pdf v Saved, 2021 BCSC 2', 'x', 'superseded', 0, 'work', 'L', '2026-10-01 08:00');
          INSERT INTO ticket_scope (ticket_id, entity, entity_id) VALUES (9, 'authorities', 2);
          INSERT INTO ticket_answers (ticket_id, file_path, saved_at) VALUES (9, '6. LAW\\2021 BCSC 2 Pdf v Saved.pdf', '2026-10-01T09:00');`,
  });
  const [c] = cases(m);
  assert.equal(c.status, "not_briefed");
  assert.equal(c.brief, null);
});

test("a jobless brief matches a case with no neutral citation by its citation text, then by style of cause", async (t) => {
  const m = await matter(t, {
    authorities: [
      [3, "Can v Lii", "2021 CanLII 3 (BC SC)"],
      [4, "Spaced v Differently", "2021  canlii  4 (BCSC)"],
      [5, "Hadley v Baxendale", "(1854) 9 Ex 341"],
      [6, "Foss v Harbottle", "[1843] 2 Hare 461"],
      [7, "No v Citation", null],
      [8, "Neighbour v Case", "2021 CanLII 31 (BC SC)"],
      [9, "Twin v Style", "[2001] 1 SCR 1"],
      [10, "Twin v Style", "[2002] 2 SCR 2"],
    ],
    files: [
      brief("2026-10-20", "Can v Lii, 2021 CanLII 3 (BC SC)"),
      brief("2026-10-20", "Spaced v Differently, 2021 CanLII 4 (BC SC)"),
      brief("2026-10-20", "Hadley v Baxendale, (1854) 9 Ex 341"),
      brief("2026-10-20", "FOSS  V HARBOTTLE, 2 Hare 461"),
      brief("2026-10-20", "No v Citation, 2005 BCCA 7"),
      brief("2026-10-20", "Twin v Style, 3 WWR 3"),
    ],
  });
  const all = cases(m);
  const relied = Object.fromEntries(all.filter((c) => c.relied_on && c.title !== "Twin v Style").map((c) => [c.title, c.status]));
  assert.deepEqual(relied, {
    "Can v Lii": "briefed",
    "Foss v Harbottle": "briefed",
    "Hadley v Baxendale": "briefed",
    "Neighbour v Case": "not_briefed",
    "No v Citation": "briefed",
    "Spaced v Differently": "briefed",
  });
  assert.equal(all.filter((c) => c.title === "Twin v Style" && c.relied_on).every((c) => c.status === "not_briefed"), true, "two cases of that style: neither is guessed");
  assert.deepEqual(all.filter((c) => !c.relied_on).map((c) => c.title), ["Twin v Style"], "no second row for any matched case");
});

test("a brief with a neutral citation never matches another decision of the same style by name", async (t) => {
  const m = await matter(t, {
    authorities: [[1, "Alpha v Beta", "2022 BCCA 3"]],
    files: [brief("2026-10-20", "Alpha v Beta, 2021 BCSC 9"), brief("2026-10-21", "Alpha v Beta, 2021 CanLII 9 (BC SC)")],
  });
  const all = cases(m);
  assert.equal(all.find((c) => c.relied_on).status, "not_briefed");
  assert.equal(all.filter((c) => !c.relied_on).length, 2);
});

test("a brief saved by a job scoped to a case with no neutral citation sits on that case, whatever its name holds", async (t) => {
  const m = await matter(t, {
    authorities: [[5, "Parallel v Report", "[2015] 1 SCR 5"]],
    files: [brief("2026-10-20", "Parallel v Report, 2015 SCC 5")],
    sql: `INSERT INTO tickets (id, proceeding_id, filing_id, title, intent, ${JOB}) VALUES (9, 1, 1, 'Brief the case: Parallel v Report, [2015] 1 SCR 5', 'x', 'superseded', 0, 'work', 'L', '2026-10-01 08:00');
          INSERT INTO ticket_scope (ticket_id, entity, entity_id) VALUES (9, 'authorities', 5);
          INSERT INTO ticket_answers (ticket_id, file_path, saved_at) VALUES (9, '6. LAW\\${brief("2026-10-20", "Parallel v Report, 2015 SCC 5")}', '2026-10-20T09:00');`,
  });
  const all = cases(m);
  assert.equal(all.length, 1);
  assert.equal(all[0].status, "briefed");
});

test("every file of one case is one row, latest first, the rest listed as earlier versions", async (t) => {
  const name = "Alpha v Beta, 2020 BCCA 1";
  const m = await matter(t, {
    authorities: [[1, "Alpha v Beta", "2020 BCCA 1"]],
    files: [brief("2026-10-01", name), brief("2026-10-01", name, " v2"), brief("2026-10-20", name), `Other/${brief("2026-10-05", name)}`],
  });
  const all = cases(m);
  assert.equal(all.length, 1);
  const b = all[0].brief;
  assert.equal(b.file, `6. LAW\\${brief("2026-10-20", name)}`);
  assert.equal(b.date, "2026-10-20");
  assert.equal(b.version, 4);
  assert.deepEqual(b.earlier, [1, 2, 3]);
  assert.deepEqual(
    b.earlier_files.map((f) => [f.version, f.date, f.file, f.on_disk]),
    [
      [3, "2026-10-05", `6. LAW\\Other\\${brief("2026-10-05", name)}`, true],
      [2, "2026-10-01", `6. LAW\\${brief("2026-10-01", name, " v2")}`, true],
      [1, "2026-10-01", `6. LAW\\${brief("2026-10-01", name)}`, true],
    ]
  );
  assert.ok(b.earlier_files.every((f) => f.url.startsWith("file:")));
  const { card } = await callTool({}, "drafting_forms__board_card", { db_path: m.dbPath, filing_id: 1, lanes: ["briefs"], draft_dir: m.draft });
  assert.ok(card.includes(`2026-10-20 · v4 (earlier: v1, v2, v3) · 6. LAW\\${brief("2026-10-20", name)}`), card);
});

test("one stem's numbers stay the file's own, a gap included", async (t) => {
  const name = "Alpha v Beta, 2020 BCCA 1";
  const m = await matter(t, { authorities: [[1, "Alpha v Beta", "2020 BCCA 1"]], files: [brief("2026-10-01", name), brief("2026-10-01", name, " v3")] });
  const [c] = cases(m);
  assert.equal(c.brief.version, 3);
  assert.deepEqual(c.brief.earlier, [1]);
});

test("a brief with no authority row folds across its dates by its style and citation, and two decisions stay apart", async (t) => {
  const m = await matter(t, {
    files: [brief("2026-10-01", "Old v Reporter, (1854) 9 Ex 341"), brief("2026-10-20", "old v reporter, (1854) 9 Ex 341"), brief("2026-10-21", "Old v Reporter, (1860) 1 Ex 2")],
  });
  const all = cases(m);
  assert.equal(all.length, 2);
  assert.deepEqual(all.map((c) => [c.citation, c.brief.version]).sort(), [["(1854) 9 Ex 341", 2], ["(1860) 1 Ex 2", 1]]);
});

test("a row made from a file's name holds the case's name and citation apart", async (t) => {
  const m = await matter(t, {
    files: [
      brief("2026-10-20", "Elsewhere v Case, 2017 BCCA 8"),
      brief("2026-10-19", "Smith, Re, 2016 BCSC 12"),
      brief("2026-10-18", "Smith, 1234 Ltd v Jones, 2021 CanLII 3 (BC SC)"),
      brief("2026-10-17", "Foo v Bar, [1990] 1 SCR 5"),
      brief("2026-10-16", "No Citation v Here"),
    ],
  });
  assert.deepEqual(
    cases(m).map((c) => [c.title, c.citation]),
    [
      ["Elsewhere v Case", "2017 BCCA 8"],
      ["Smith, Re", "2016 BCSC 12"],
      ["Smith, 1234 Ltd v Jones", "2021 CanLII 3 (BC SC)"],
      ["Foo v Bar", "[1990] 1 SCR 5"],
      ["No Citation v Here", null],
    ]
  );
});

test("a case relied on with no citation recorded takes the citation its brief's name holds", async (t) => {
  const m = await matter(t, { authorities: [[7, "No v Citation", null]], files: [brief("2026-10-20", "No v Citation, 2005 BCCA 7")] });
  assert.equal(cases(m)[0].citation, "2005 BCCA 7");
});

const briefJob = (m, proceeding, filing, authority, title = "Brief the case: X") => ({
  db_path: m.dbPath,
  proceeding_id: proceeding,
  filing_id: filing,
  title,
  intent: title,
  kind: "work",
  priority: "bottom",
  billing_anchor: "L9999|case brief",
  steps: ["Get the decision"],
  scope: [{ entity: "authorities", entity_id: authority }],
  guard: "authority_brief",
});

test("citationKey folds a neutral citation, then a citation's text, and holds nothing without one", () => {
  assert.equal(citationKey("2019 BCSC 1, 10 BCLR 20"), neutralKey("2019 BCSC 1"));
  assert.equal(citationKey("2021 CanLII 3 (BC SC)"), citationKey("2021  canlii 3 (BCSC)"));
  assert.notEqual(citationKey("2021 CanLII 3"), citationKey("2021 CanLII 31"));
  assert.equal(citationKey(null), null);
  assert.equal(citationKey("  "), null);
});

test("the guard holds one live job per case, whichever parallel citation's authority it scopes", async (t) => {
  const m = await matter(t, {
    authorities: [[1, "Sample v Example", "2019 BCSC 1"], [2, "Sample v Example", "2019 BCSC 1, 10 BCLR 20"], [3, "Can v Lii", "2021 CanLII 3 (BC SC)"], [4, "Can v Lii", "2021 canlii 3 (BCSC)"], [5, "One v None", null], [6, "Two v None", null]],
  });
  const first = await submissionDataCreateJob(briefJob(m, 1, 1, 1));
  assert.equal(first.outcome, "created");
  const parallel = await submissionDataCreateJob(briefJob(m, 1, 1, 2));
  assert.equal(parallel.outcome, "guarded", "ids 1 and 2 are one case");
  assert.equal(parallel.holder_id, first.ticket_id);
  assert.equal((await submissionDataCreateJob(briefJob(m, 1, 1, 3))).outcome, "created");
  assert.equal((await submissionDataCreateJob(briefJob(m, 1, 1, 4))).outcome, "guarded", "one citation's text, spaced differently");
  assert.equal((await submissionDataCreateJob(briefJob(m, 1, 1, 5))).outcome, "created");
  assert.equal((await submissionDataCreateJob(briefJob(m, 1, 1, 6))).outcome, "created", "two authorities with no citation are two cases");
  const rows = cases(m);
  assert.equal(rows.length, 4, "the page folds the same cases the guard does");
  assert.ok(rows.every((c) => c.status === "requested"));
});

test("a request in another proceeding reads as no request, as the guard treats it", async (t) => {
  const m = await matter(t, {
    authorities: [[1, "Sample v Example", "2019 BCSC 1"]],
    sql: "INSERT INTO authorities (id, proceeding_id, style_of_cause_or_title, citation, kind) VALUES (50, 2, 'Sample v Example', '2019 BCSC 1', 'case');",
  });
  const there = await submissionDataCreateJob(briefJob(m, 2, 2, 50));
  assert.equal(there.outcome, "created");
  const [here] = cases(m, [1]);
  assert.equal(here.status, "not_briefed", "proceeding 1 holds no request");
  assert.deepEqual(here.jobs, []);
  assert.equal((await submissionDataCreateJob(briefJob(m, 1, 1, 1))).outcome, "created", "and the guard lets proceeding 1 ask");
  assert.equal(cases(m, [1])[0].status, "requested");
  assert.equal(cases(m, [1, 2])[0].jobs.length, 2, "a merged board reads both proceedings");
  assert.equal(cases(m, [2]).find((c) => c.jobs.length > 0).jobs[0].id, there.ticket_id);
});

test("the template tells a re-brief to reuse the stem and the Writing", () => {
  const template = readFileSync(new URL("../../../../.claude/skills/shared/case-brief-template.md", import.meta.url), "utf-8");
  assert.match(template, /A re-brief of a case that already has a saved brief reuses that brief's file stem, date included, and saves onto the same Writing/);
  assert.match(template, /so the save is that brief's next version/);
  assert.doesNotMatch(template, /every saved version is the same brief/);
});

test("a re-brief by the template's steps is the same Writing's next version, one row, and leaves no stale item", async (t) => {
  const stem = "2026-10-01 case brief Alpha v Beta, 2020 BCCA 1";
  const m = await matter(t, { authorities: [[60, "Alpha v Beta", "2020 BCCA 1"]] });
  const { filing_id: id } = await submissionDataCreateWriting({ db_path: m.dbPath, proceeding_id: 1, tree: { country: "CAN", jurisdiction: "BC", venue: "_NoVenue" }, kind: "case_brief", recipient: "internal", title: stem });
  const prose = (slot, text) => `INSERT INTO filing_prose (filing_id, slot, text) VALUES (${id}, '${slot}', '${text}');`;
  const write = (statement, holding) =>
    submissionDataExecute(
      m.dbPath,
      `INSERT INTO statements_of_law (id, proceeding_id, authority_id, pinpoint, excerpt, source, verification) VALUES (${statement}, 1, 60, 'para. 5', '${holding}', 'primary', 'lead');
       INSERT INTO filing_law (filing_id, statement_id) VALUES (${id}, ${statement});
       ${prose("case", "Alpha v Beta, 2020 BCCA 1.\nNot noted up by this brief.")}${prose("facts", "A fact.")}${prose("procedural-history", "An appeal.")}${prose("issues", "An issue?")}
       ${prose("holding", `${holding} <!-- statement_of_law_id ${statement} -->`)}${prose("ratio", "None.")}${prose("obiter", "None.")}${prose("disposition", "Dismissed.")}`
    );
  const save = () => {
    const r = submissionFormsRender(m.dbPath, id, {}, "mockup", ["General_writing"], undefined, undefined, NOW, "tok");
    return saveAnswer(m.law, `${stem}.md`, undefined, undefined, r.documents.find((d) => d.document_type === "General_writing").path);
  };
  await write(100, "First holding.");
  save();
  // The template's re-brief: the Writing's rows replaced, then the same render and save.
  await submissionDataExecute(
    m.dbPath,
    `DELETE FROM filing_prose WHERE filing_id = ${id};
     CREATE TEMP TABLE old_items AS SELECT statement_id FROM filing_law WHERE filing_id = ${id};
     DELETE FROM filing_law WHERE filing_id = ${id};
     DELETE FROM statements_of_law WHERE id IN (SELECT statement_id FROM old_items) AND id NOT IN (SELECT statement_id FROM filing_law);
     DROP TABLE old_items;`
  );
  await write(101, "Second holding.");
  const saved = save();
  assert.match(saved.path, / v2\.md$/);
  assert.match(readFileSync(saved.path, "utf-8"), /Second holding\./);
  assert.doesNotMatch(readFileSync(saved.path, "utf-8"), /First holding\./);
  const { rows } = submissionDataQuery(m.dbPath, "SELECT COUNT(*) AS n FROM filings WHERE kind = 'case_brief'");
  assert.equal(rows[0].n, 1);
  const [c] = cases(m);
  assert.equal(c.status, "briefed");
  assert.equal(c.brief.version, 2);
  assert.deepEqual(c.brief.earlier, [1]);
  const ids = buildPropositionsData(m.dbPath, [fetchFiling(m.dbPath, 1)]).groups.flatMap((g) => g.propositions.flatMap((p) => p.statements.map((s) => s.statement_id)));
  assert.equal(ids.includes(100), false, "the first brief's item is gone");
  assert.equal(ids.includes(101), false, "the second is the brief's own item");
});

test("Propositions drops a statement with no proposition only when no other Writing and no order cites it", async (t) => {
  const m = await matter(t, {
    authorities: [[1, "Sample v Example", "2019 BCSC 1"]],
    sql: `INSERT INTO filings (id, proceeding_id, kind, round, title) VALUES (3, 1, 'submissions_package', 'reply', 'Sibling');
          INSERT INTO filings (id, proceeding_id, kind, title) VALUES (9, 1, 'research_memo', 'ML re a point');
          INSERT INTO statements_of_law (id, proceeding_id, authority_id, pinpoint, excerpt, source, verification) VALUES
            (20, 1, 1, 'a', 'the memo alone', 'primary', 'lead'),
            (21, 1, 1, 'b', 'the memo and a sibling', 'primary', 'lead'),
            (22, 1, 1, 'c', 'the memo and an order', 'primary', 'lead'),
            (23, 1, 1, 'd', 'nothing cites it', 'primary', 'lead');
          INSERT INTO filing_law (filing_id, statement_id) VALUES (9, 20), (9, 21), (3, 21), (9, 22);
          INSERT INTO order_sought (id, proceeding_id, wording) VALUES (1, 1, 'An order.');
          INSERT INTO order_sought_requires (order_sought_id, excerpt_id, basis_state) VALUES (1, 22, 'filled');`,
  });
  const ids = buildPropositionsData(m.dbPath, [fetchFiling(m.dbPath, 1)]).groups.flatMap((g) => g.propositions.flatMap((p) => p.statements.map((s) => s.statement_id)));
  assert.equal(ids.includes(20), false, "the memo's own item");
  assert.ok(ids.includes(21), "a sibling cites it too");
  assert.ok(ids.includes(22), "an order cites it too");
  assert.ok(ids.includes(23), "no research Writing cites it");
});

/** Just enough DOM to run the page's script: elements hold children and plain properties. */
function fakeDocument() {
  class Node {
    constructor(tag) {
      Object.assign(this, { tag, children: [], className: "", value: "", attrs: {}, classList: { add() {}, remove() {}, toggle() {} } });
    }
    appendChild(c) {
      this.children.push(c);
      return c;
    }
    setAttribute(k, v) {
      this.attrs[k] = v;
    }
    addEventListener() {}
    insertBefore(c) {
      return this.appendChild(c);
    }
    all() {
      return [this, ...this.children.flatMap((c) => (c.all ? c.all() : [c]))];
    }
    text() {
      return [this.textContent ?? "", ...this.children.map((c) => (c.text ? c.text() : c.data))].join("");
    }
  }
  const board = new Node("div");
  return { board, document: { createElement: (tag) => new Node(tag), createTextNode: (data) => ({ data }), querySelector: () => board } };
}

test("the page links each earlier version of a case, and marks one no longer on disk", () => {
  const { board, document } = fakeDocument();
  const entry = (version, name, on_disk) => ({ version, date: "2026-10-01", file: `6. LAW\\${name}`, url: `file:///m/${version}.md`, on_disk });
  const data = {
    ...LEGAL_RESEARCH_FIXTURE.data,
    briefs: {
      cases: [
        {
          title: "A v B",
          citation: "2020 BCCA 1",
          status: "briefed",
          relied_on: true,
          jobs: [],
          brief: { ...entry(3, "third.md", true), earlier: [1, 2], earlier_files: [entry(2, "second.md", false), entry(1, "first.md", true)] },
        },
      ],
    },
  };
  const page = readFileSync(new URL("../src/templates/view-pages/legal-research.js", import.meta.url), "utf-8");
  const localStorage = { getItem: () => JSON.stringify({ tab: "briefs" }), setItem() {} };
  vm.runInNewContext(page, { window: { VIEW_PAGE: { data } }, document, localStorage, JSON });
  const nodes = board.all();
  const dts = nodes.filter((n) => n.tag === "dt" && n.textContent === "Earlier versions");
  assert.ok(dts.length >= 1, "the row is drawn");
  const links = nodes.filter((n) => n.tag === "a").map((a) => [a.textContent, a.href]);
  assert.ok(links.some(([t, h]) => t === "first.md" && h === "file:///m/1.md"), JSON.stringify(links));
  assert.ok(links.some(([t, h]) => t === "third.md" && h === "file:///m/3.md"));
  assert.equal(links.some(([t]) => t === "second.md"), false, "a file that is gone has no link");
  assert.ok(board.text().includes("second.md (not in the law folder now)"));
});
