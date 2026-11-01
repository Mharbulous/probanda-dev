// A case brief from its Writing to the file the practitioner is shown: create_writing, the template's
// items, render, save_answer from_render, then the matter's pages. A live /case-brief run needs
// Westlaw and agents, so this covers the server's half of it. Also, a memo's saved copy, where it
// shares the path: no party's line leads either, and a memo keeps the marks a note-up reads. Every
// name is synthetic.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

process.env.COCLERK_SUBMISSION_LOCK_ROOT = mkdtempSync(join(tmpdir(), "coclerk-saved-brief-locks-"));
process.env.COCLERK_REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
after(() => rmSync(process.env.COCLERK_SUBMISSION_LOCK_ROOT, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));

const { freshSubmissionDb } = await import("./helpers/template-db.mjs");
const { submissionDataExecute, submissionDataQuery } = await import("../build/submission/backend.js");
const { submissionFormsRender } = await import("../build/submission/forms.js");
const { submissionDataCreateWriting } = await import("../build/submission/forms/layout-snapshot.js");
const { lawFolderText, saveAnswer } = await import("../build/files/research-filing.js");
const { awaitBackgroundJobs } = await import("../build/submission/render-job.js");

const NOW = "2026-11-01 09:00";
const FORUM = "CAN/BC/Vancouver-International-Arbitration-Centre";
const STEM = "2026-11-01 case brief Alpha v Beta, 2020 BCCA 1";
const TREE = { country: "CAN", jurisdiction: "BC", venue: "_NoVenue" };
const QUOTE = "The court held  the thing (quoting Gamma v Delta)";

/** A matter whose one proceeding has a party linked to nothing in case data, so it drifts. */
async function matter(t, sql = "") {
  const base = mkdtempSync(join(tmpdir(), "coclerk-saved-brief-"));
  t.after(async () => {
    await awaitBackgroundJobs();
    rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });
  const root = join(base, "L9999 Test Matter");
  const caseData = join(root, "0. CASE DATA");
  mkdirSync(join(root, "0. DRAFT"), { recursive: true });
  mkdirSync(join(root, "6. LAW", "Sale of goods"), { recursive: true });
  mkdirSync(caseData, { recursive: true });
  writeFileSync(join(root, "coclerk.json"), JSON.stringify({ schema_version: 5, matter_root: root, case_data_dir: "0. CASE DATA", evidence_sql_path: "x.sql" }), "utf-8");
  const dbPath = join(caseData, "submission.sqlite");
  await freshSubmissionDb(dbPath);
  await submissionDataExecute(
    dbPath,
    `INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L9999', '${FORUM}');
     INSERT INTO parties (id, proceeding_id, name, role, ordinal) VALUES (1, 1, 'Working Matter Client Ltd', 'claimant', 1);
     ${sql}`
  );
  return { root, dbPath, law: join(root, "6. LAW", "Sale of goods"), draft: join(root, "0. DRAFT") };
}

const prose = (id, slot, text) => `INSERT INTO filing_prose (filing_id, slot, text) VALUES (${id}, '${slot}', '${text.replace(/'/g, "''")}');`;

/** The template's "Saving it", to the render: a Writing, one Holding and one Ratio item, and None. for Obiter. */
async function writeBrief(m) {
  const { filing_id: id } = await submissionDataCreateWriting({ db_path: m.dbPath, proceeding_id: 1, tree: TREE, kind: "case_brief", recipient: "internal", title: STEM });
  await submissionDataExecute(
    m.dbPath,
    `INSERT INTO authorities (id, proceeding_id, style_of_cause_or_title, citation, kind) VALUES (60, 1, 'Alpha v Beta', '2020 BCCA 1', 'case');
     INSERT INTO statements_of_law (id, proceeding_id, authority_id, pinpoint, excerpt, source, verification) VALUES
       (5, 1, 60, 'para. 5', '${QUOTE}\nand a second line.', 'primary', 'lead'), (6, 1, 60, 'para. 9', 'The principle.', 'primary', 'lead');
     INSERT INTO filing_law (filing_id, statement_id) VALUES (${id}, 5), (${id}, 6);
     ${prose(id, "case", "Alpha v Beta, 2020 BCCA 1. BC Court of Appeal. Smith J.A. 2020-01-01.\nNot noted up by this brief.")}
     ${prose(id, "facts", "The buyer refused delivery.")}
     ${prose(id, "procedural-history", "Appeal from summary trial in 2019 BCSC 7.")}
     ${prose(id, "issues", "Did the refusal repudiate?")}
     ${prose(id, "holding", "Yes. <!-- statement_of_law_id 5 -->")}
     ${prose(id, "ratio", "A refusal repudiates. <!-- statement_of_law_id 6 -->")}
     ${prose(id, "obiter", "None.")}
     ${prose(id, "disposition", "Appeal dismissed with costs.")}`
  );
  return id;
}

function saveFromRender(m, id, filename) {
  const r = submissionFormsRender(m.dbPath, id, {}, "mockup", ["General_writing"], undefined, undefined, NOW, "tok");
  const path = r.documents.find((d) => d.document_type === "General_writing").path;
  return { render: r, saved: saveAnswer(m.law, filename, undefined, undefined, path) };
}

test("a case brief's saved file is the brief alone: no party, marker, trace comment, Legend or header", async (t) => {
  const m = await matter(t);
  const id = await writeBrief(m);
  const { render, saved } = saveFromRender(m, id, `${STEM}.md`);
  const text = readFileSync(saved.path, "utf-8");
  assert.equal(render.parties_drift[0].name, "Working Matter Client Ltd", "the session still sees the drift");
  assert.ok(text.startsWith("## Case\n"), text);
  assert.doesNotMatch(text, /Working Matter Client|L9999|Legend|research lawyer|drafter|statement_of_law_id|<!--|mockup-only|Authorities cited/);
  assert.doesNotMatch(text, /\p{Extended_Pictographic}/u, text);
  for (const part of ["Facts", "Procedural history", "Issues", "Holding", "Ratio decidendi", "Obiter dicta", "Disposition"]) assert.match(text, new RegExp(`^## ${part}$`, "m"));
  assert.match(text, /^> \*Alpha v Beta\*, 2020 BCCA 1, para\. 5$/m, text);
});

test("a saved brief keeps each passage character for character, though the filed face would change it", async (t) => {
  const m = await matter(t);
  const { saved } = saveFromRender(m, await writeBrief(m), `${STEM}.md`);
  assert.match(readFileSync(saved.path, "utf-8"), new RegExp(`^> ${QUOTE.replace(/[()]/g, "\\$&")}\n> and a second line\\.\n>\n> \\*Alpha`, "m"));
});

test("None. is numbered with the items and has no passage, citation or stored statement", async (t) => {
  const m = await matter(t);
  const id = await writeBrief(m);
  const { saved } = saveFromRender(m, id, `${STEM}.md`);
  assert.match(readFileSync(saved.path, "utf-8"), /## Obiter dicta\n\n6\. None\.\n\n## Disposition\n\n7\. Appeal dismissed with costs\.\n/);
  const { rows } = submissionDataQuery(m.dbPath, `SELECT statement_id FROM filing_law WHERE filing_id = ${id} ORDER BY statement_id`);
  assert.deepEqual(rows.map((r) => r.statement_id), [5, 6]);
});

test("a memo's saved file opens with its own header, with no party's line, and keeps its trace comments and Legend", async (t) => {
  const m = await matter(t);
  const { filing_id: id } = await submissionDataCreateWriting({ db_path: m.dbPath, proceeding_id: 1, tree: TREE, kind: "research_memo", recipient: "internal", title: "2026-11-01 ML re repudiation" });
  await submissionDataExecute(
    m.dbPath,
    `INSERT INTO authorities (id, proceeding_id, style_of_cause_or_title, citation, kind) VALUES (60, 1, 'Alpha v Beta', '2020 BCCA 1', 'case');
     INSERT INTO statements_of_law (id, proceeding_id, authority_id, pinpoint, excerpt, source, verification) VALUES (5, 1, 60, 'para. 5', 'The principle.', 'primary', 'lead');
     INSERT INTO filing_law (filing_id, statement_id) VALUES (${id}, 5);
     ${prose(id, "memo-header", "---\nDocument: MEMORANDUM OF LAW\n---")}
     ${prose(id, "issue", "Did the refusal repudiate?")}
     ${prose(id, "conclusion", "Yes.")}
     ${prose(id, "rule", "A refusal repudiates. <!-- statement_of_law_id 5 -->")}
     ${prose(id, "application", "It applied.")}
     ${prose(id, "sources", "The decision.")}`
  );
  const { saved } = saveFromRender(m, id, "2026-11-01 ML re repudiation.md");
  const text = readFileSync(saved.path, "utf-8");
  assert.ok(text.startsWith("---\nDocument: MEMORANDUM OF LAW\n---"), text);
  assert.doesNotMatch(text, /Working Matter Client|L9999/);
  assert.match(text, /<!-- statement_of_law_id 5 -->/, "a proposition-level note-up reads this");
  assert.match(text, /^## Legend$/m);
});

test("the mockup of any other Writing still leads with the drifted party", async (t) => {
  const m = await matter(t, "INSERT INTO filings (id, proceeding_id, kind, round, title) VALUES (2, 1, 'submissions_package', 'opening', 'Opening');");
  const r = submissionFormsRender(m.dbPath, 2, {}, "mockup", undefined, undefined, undefined, NOW, "tok");
  assert.ok(r.documents.some((d) => /^🏷️ Working Matter Client Ltd \(claimant\)/m.test(d.markdown ?? "")));
});

test("the skill's call extracts one decision from a subfolder of 6. LAW to a file the agents can read", async (t) => {
  const m = await matter(t);
  writeFileSync(join(m.law, "Alpha v Beta 2020 BCCA 1.txt"), "[5] The court held the thing.", "utf-8");
  writeFileSync(join(m.law, "another decision.txt"), "other", "utf-8");
  const { files } = await lawFolderText(m.root, m.law, { file: "Alpha v Beta 2020 BCCA 1.txt" });
  assert.equal(files.length, 1);
  assert.equal(files[0].status, "ok");
  assert.equal(readFileSync(files[0].text_path, "utf-8"), "[5] The court held the thing.");
});

const legalResearch = (render) => render.view_page_paths.find((v) => v.name === "Legal Research");

test("the render after the save lists the brief on the Legal Research page; the render before it could not", async (t) => {
  const m = await matter(t, "INSERT INTO filings (id, proceeding_id, kind, round, title) VALUES (2, 1, 'submissions_package', 'opening', 'Opening');");
  const id = await writeBrief(m);
  const page = () => submissionFormsRender(m.dbPath, id, {}, "mockup", ["Work_board"], undefined, undefined, NOW, "tok", m.draft);
  const before = readFileSync(legalResearch(page()).path, "utf-8");
  assert.equal(before.includes(STEM), false, "the file is not on disk yet");
  saveFromRender(m, id, `${STEM}.md`);
  await awaitBackgroundJobs();
  const after = readFileSync(legalResearch(page()).path, "utf-8");
  assert.ok(after.includes(STEM), "the saved brief is listed");
});

test("a matter holding only research results gets no Legal Research page, which the skill must say", async (t) => {
  const m = await matter(t);
  const id = await writeBrief(m);
  saveFromRender(m, id, `${STEM}.md`);
  const r = submissionFormsRender(m.dbPath, id, {}, "mockup", ["Work_board"], undefined, undefined, NOW, "tok", m.draft);
  assert.equal(legalResearch(r), undefined);
});
