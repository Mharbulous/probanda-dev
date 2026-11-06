// A case brief from its Writing to the file the practitioner is shown: create_writing, the template's
// items, render, save_answer from_render, then the matter's pages. A live /case-brief run needs
// Westlaw and agents, so this covers the server's half of it. Also, a memo's saved copy, where it
// shares the path: no party's line leads either, and a memo keeps the marks a note-up reads. Every
// name is synthetic.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

process.env.COCLERK_SUBMISSION_LOCK_ROOT = mkdtempSync(join(tmpdir(), "coclerk-saved-brief-locks-"));
process.env.COCLERK_REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
// create_writing reads the firm's knowledge overlay, which needs a device's case data root.
const device = mkdtempSync(join(tmpdir(), "coclerk-saved-brief-device-"));
const caseDataRoot = join(device, "case-data");
mkdirSync(caseDataRoot);
process.env.COCLERK_CONFIG_PATH = join(device, "probanda.json");
writeFileSync(process.env.COCLERK_CONFIG_PATH, JSON.stringify({ case_data_root: caseDataRoot }), "utf-8");
after(() => {
  rmSync(process.env.COCLERK_SUBMISSION_LOCK_ROOT, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  rmSync(device, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

const { freshSubmissionDb } = await import("./helpers/template-db.mjs");
const { submissionDataExecute, submissionDataQuery } = await import("../build/submission/backend.js");
const { submissionFormsRender } = await import("../build/submission/forms.js");
const { submissionDataCreateWriting } = await import("../build/submission/forms/layout-snapshot.js");
const { lawFolderText, saveAnswer, writeScratch } = await import("../build/files/research-filing.js");
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
  assert.equal("mockup_only_lines" in saved, false, "only a memo's result carries these");
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
  assert.match(readFileSync(saved.path, "utf-8"), new RegExp(`^\`\`\`\n${QUOTE.replace(/[()]/g, "\\$&")}\nand a second line\\.\n\`\`\`\n\n> \\*Alpha`, "m"));
});

test("a saved brief's passage keeps even the characters the save borrows as placeholders", async (t) => {
  const m = await matter(t);
  const id = await writeBrief(m);
  const passage = "Odd \uE002characters \uE003kept (here)";
  await submissionDataExecute(m.dbPath, `UPDATE statements_of_law SET excerpt = '${passage}\nand a second line.' WHERE id = 5;`);
  const text = readFileSync(saveFromRender(m, id, `${STEM}.md`).saved.path, "utf-8");
  assert.ok(text.includes(`\n\`\`\`\n${passage}\nand a second line.\n\`\`\`\n`), text);
});

test("None. is numbered with the items and has no passage, citation or stored statement", async (t) => {
  const m = await matter(t);
  const id = await writeBrief(m);
  const { saved } = saveFromRender(m, id, `${STEM}.md`);
  assert.match(readFileSync(saved.path, "utf-8"), /## Obiter dicta\n\n6\. None\.\n\n## Disposition\n\n7\. Appeal dismissed with costs\.\n/);
  const { rows } = submissionDataQuery(m.dbPath, `SELECT statement_id FROM filing_law WHERE filing_id = ${id} ORDER BY statement_id`);
  assert.deepEqual(rows.map((r) => r.statement_id), [5, 6]);
});

test("a saved brief keeps text of a tag's shape in its own sentences, and strips the tags on a citation line", async (t) => {
  const m = await matter(t);
  const id = await writeBrief(m);
  await submissionDataExecute(
    m.dbPath,
    `UPDATE filing_prose SET text = 'Seller refused (note-up: x) delivery [unverified: y], ending (quoting Z)' WHERE filing_id = ${id} AND slot = 'facts';
     UPDATE authorities SET treatment_note = 'still good' WHERE id = 60;`
  );
  const text = readFileSync(saveFromRender(m, id, `${STEM}.md`).saved.path, "utf-8");
  assert.match(text, /^1\. Seller refused \(note-up: x\) delivery \[unverified: y\], ending \(quoting Z\)$/m, text);
  assert.match(text, /^> \*Alpha v Beta\*, 2020 BCCA 1, para\. 5$/m, text);
  assert.doesNotMatch(text, /[\uE000-\uE003]/);
});

test("a Ratio item's Treatment block saves inside its item, with no new number and no refusal", async (t) => {
  const m = await matter(t);
  const id = await writeBrief(m);
  const block = [
    "A refusal repudiates.",
    "   Treatment, noted up 2026-11-06: followed or applied",
    "   Citators: KeyCite run; CanLII not run: no key",
    "   Read: Gamma v Delta, 2024 BCCA 12, para. 30",
    "   Not read: 4 other citing decisions the citators listed",
    "   > A refusal of that kind repudiates the contract. (Gamma v Delta, 2024 BCCA 12, para. 30)",
  ].join("\n");
  await submissionDataExecute(m.dbPath, `UPDATE filing_prose SET text = '${block} <!-- statement_of_law_id 6 -->' WHERE filing_id = ${id} AND slot = 'ratio';`);
  const text = readFileSync(saveFromRender(m, id, `${STEM}.md`).saved.path, "utf-8");
  assert.match(text, /^5\. A refusal repudiates\.\n {3}Treatment, noted up 2026-11-06: followed or applied$/m, text);
  assert.match(text, /^ {3}Not read: 4 other citing decisions the citators listed$/m, text);
  assert.match(text, /## Obiter dicta\n\n6\. None\./, text);
});

for (const [what, sql, named] of [
  ["a slot not written", (id) => `DELETE FROM filing_prose WHERE filing_id = ${id} AND slot = 'procedural-history';`, /procedural-history not written/],
  ["an item its Writing does not cite", (id) => `DELETE FROM filing_law WHERE filing_id = ${id} AND statement_id = 5;`, /statement_of_law 5 is not cited/],
  ["a Holding item with no trace comment", (id) => `UPDATE filing_prose SET text = 'Yes.' WHERE filing_id = ${id} AND slot = 'holding';`, /holding paragraph 1 does not end/],
  ["a Ratio item with text after its comment", (id) => `UPDATE filing_prose SET text = 'A refusal repudiates. <!-- statement_of_law_id 6 --> Always.' WHERE filing_id = ${id} AND slot = 'ratio';`, /ratio paragraph 1 does not end/],
  ["a Ratio item with a line after its comment", (id) => `UPDATE filing_prose SET text = 'A refusal repudiates. <!-- statement_of_law_id 6 -->\nAlways.' WHERE filing_id = ${id} AND slot = 'ratio';`, /ratio paragraph 1 does not end/],
  ["a Holding item with a comment before its closing one", (id) => `UPDATE filing_prose SET text = 'Yes. <!-- statement_of_law_id 6 --> Plainly. <!-- statement_of_law_id 5 -->' WHERE filing_id = ${id} AND slot = 'holding';`, /holding paragraph 1 does not end/],
  ["an Obiter item with no trace comment, beside a good one", (id) => `INSERT INTO statements_of_law (id, proceeding_id, authority_id, pinpoint, excerpt, source, verification) VALUES (7, 1, 60, 'para. 12', 'An aside.', 'primary', 'lead');
     INSERT INTO filing_law (filing_id, statement_id) VALUES (${id}, 7);
     UPDATE filing_prose SET text = 'An aside. <!-- statement_of_law_id 7 -->\n\nAnother aside.' WHERE filing_id = ${id} AND slot = 'obiter';`, /obiter paragraph 2 does not end/],
  ["an item whose statement has no pinpoint", () => "UPDATE statements_of_law SET pinpoint = NULL WHERE id = 5;", /statement_of_law 5 has no pinpoint/],
  ["an item whose statement has a blank pinpoint", () => "UPDATE statements_of_law SET pinpoint = '  ' WHERE id = 6;", /statement_of_law 6 has no pinpoint/],
  ["an item whose statement has no passage", () => "UPDATE statements_of_law SET excerpt = NULL WHERE id = 6;", /statement_of_law 6 has no passage/],
]) {
  test(`a saved brief is refused while the mockup shows ${what}, and nothing is written`, async (t) => {
    const m = await matter(t);
    const id = await writeBrief(m);
    await submissionDataExecute(m.dbPath, sql(id));
    assert.throws(
      () => saveFromRender(m, id, `${STEM}.md`),
      (err) => err.code === "brief_incomplete" && named.test(err.message)
    );
    assert.deepEqual(readdirSync(m.law), []);
  });
}

test("a stem cleaned by the template's rule is a name the scratch copy and the save accept; the raw one is refused", async (t) => {
  const m = await matter(t);
  assert.throws(() => writeScratch(m.root, "2026-11-01 case brief A/B v C, 2020 BCCA 1.md", "x"), (err) => err.code === "invalid_filename");
  const scratch = writeScratch(m.root, "2026-11-01 case brief A-B v C, 2020 BCCA 1.md", "File stem: x\n");
  assert.equal(saveAnswer(m.law, scratch.filename, undefined, scratch.path).filename, scratch.filename);
});

test("a stem keeping a colon or a question mark is refused in plain words, not written to a truncated name", async (t) => {
  const m = await matter(t);
  for (const name of ["2026-11-01 case brief Re: X, 2020 BCCA 1.md", "2026-11-01 case brief Who?, 2020 BCCA 1.md"]) {
    const plain = (err) => err.code === "invalid_filename" && /character a Windows file name cannot have/.test(err.message);
    assert.throws(() => writeScratch(m.root, name, "x"), plain);
    assert.throws(() => saveAnswer(m.law, name, "x"), plain);
  }
  assert.deepEqual(readdirSync(m.law), []);
  const usual = "2026-11-01 case brief O'Neil (Re), [2020] 1 SCR 5 é & Co.md";
  assert.equal(writeScratch(m.root, usual, "x").filename, usual);
  assert.equal(saveAnswer(m.law, usual, "x").filename, usual);
});

test("a decision the extractor refuses is a refusal the skill stops on, not a row", async (t) => {
  const m = await matter(t);
  writeFileSync(join(m.law, "Alpha v Beta 2020 BCCA 1.html"), "<p>x</p>", "utf-8");
  await assert.rejects(lawFolderText(m.root, m.law, { file: "Alpha v Beta 2020 BCCA 1.html" }), (err) => err.code === "html_page");
});

test("a memo's saved file opens with its own bare header even with an untracked citation and an unreviewed header", async (t) => {
  const m = await matter(t);
  const { filing_id: id } = await submissionDataCreateWriting({ db_path: m.dbPath, proceeding_id: 1, tree: TREE, kind: "research_memo", recipient: "internal", title: "2026-11-01 ML re citation" });
  await submissionDataExecute(
    m.dbPath,
    `${prose(id, "memo-header", "---\nDocument: MEMORANDUM OF LAW\n---")}
     ${prose(id, "issue", "Does 2018 BCSC 44 apply?")}
     ${prose(id, "conclusion", "Yes.")}
     ${prose(id, "rule", "R.")}
     ${prose(id, "application", "A.")}
     ${prose(id, "sources", "S.")}`
  );
  const { saved } = saveFromRender(m, id, "2026-11-01 ML re citation.md");
  const text = readFileSync(saved.path, "utf-8");
  assert.deepEqual(saved.mockup_only_lines, ["📇 Cited but not tracked: 2018 BCSC 44"], "the file leaves it out, so the result carries it");
  assert.ok(text.startsWith("---\nDocument: MEMORANDUM OF LAW\n---\n"), text);
  assert.doesNotMatch(text, /Cited but not tracked|# Memorandum of Law/);
  assert.match(text, /^Does 2018 BCSC 44 apply\? 🧐$/m, "a memo's markers stay");
  assert.match(text, /^## Legend$/m);
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
  assert.equal("mockup_only_lines" in saved, false, "a memo with nothing left out says nothing");
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

test("a matter holding only research results, a memo beside the brief, gets no Legal Research page until it holds other work", async (t) => {
  const m = await matter(t);
  const id = await writeBrief(m);
  await submissionDataCreateWriting({ db_path: m.dbPath, proceeding_id: 1, tree: TREE, kind: "research_memo", recipient: "internal", title: "2026-11-01 ML re repudiation" });
  saveFromRender(m, id, `${STEM}.md`);
  const page = () => submissionFormsRender(m.dbPath, id, {}, "mockup", ["Work_board"], undefined, undefined, NOW, "tok", m.draft);
  assert.equal(legalResearch(page()), undefined);
  await awaitBackgroundJobs();
  await submissionDataExecute(m.dbPath, "INSERT INTO filings (id, proceeding_id, kind, round, title) VALUES (20, 1, 'submissions_package', 'opening', 'Opening');");
  assert.ok(readFileSync(legalResearch(page()).path, "utf-8").includes(STEM));
});
