// drafting_forms__draft_harness step scrutiny_review (ADR 0036): the review package for one statement
// of law, run against a synthetic matter. The authority is a reportlab PDF in 6. LAW, recorded in a
// matter-data law database built from the canonical schema; the RTF test calls Microsoft Word and is
// skipped where Word is not installed. Temp directories only; never a live matter.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { codeOf } from "./helpers/housekeeping-fixture.mjs";

const { freshSubmissionDb } = await import("./helpers/template-db.mjs");
const { writeCaseDataStores } = await import("./helpers/matter-data-fixture.mjs");
const { submissionDataExecute } = await import("../build/submission/backend.js");
const { draftHarness } = await import("../build/submission/draft-harness.js");

const PYTHON = process.env.COCLERK_PYTHON || "python";
const WORD = join(process.env.ProgramFiles || "C:\\Program Files", "Microsoft Office", "root", "Office16", "WINWORD.EXE");
const WORD_X86 = join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Microsoft Office", "root", "Office16", "WINWORD.EXE");
const NO_WORD = existsSync(WORD) || existsSync(WORD_X86) ? false : "Word not installed";

// Three pages of numbered paragraphs; [5] crosses from page 2 to page 3.
const PAGES = [
  [
    "[1] The appellant appeals an order granting summary judgment",
    "against her claims for breach of contract and negligence.",
    "[2] A judge may grant summary judgment where there is no",
    "genuine issue requiring a trial, having regard to the evidence.",
    "[3] The chambers judge found the claim was bound to fail",
    "because the limitation period had expired before filing.",
  ],
  [
    "[4] The appellant says the judge erred in finding that the",
    "limitation period began when the losses were first reported.",
    "[5] Discoverability turns on when the plaintiff knew or ought",
    "reasonably to have known that the loss had occurred and that",
  ],
  ["it was caused by the act or omission of the defendant.", "[6] The appeal is dismissed with costs to the respondent."],
];
const EXCERPT = "A judge may grant summary judgment where there is no genuine issue requiring a trial";
const STITCHED = "A judge may grant summary judgment where there is no [...] The chambers judge found the claim was bound to fail";
const ACROSS = "Discoverability turns on when the plaintiff knew or ought reasonably to have known";
const FOREIGN = "Fiduciary duties bind trustees whose discretion reaches beneficiaries under express trusts";
const MARKED_FOREIGN = `A judge may grant summary judgment where there is no [...] ${FOREIGN}`;
const SPAN_TEXT ="The chambers judge found the claim was bound to fail because the limitation period had expired before filing.";
const RTF = "{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Times New Roman;}}\\f0\\fs24 [1] The appeal is dismissed with costs to the respondent in this court.\\par [2] Each party bears its own costs below.\\par }";
const RTF_EXCERPT = "The appeal is dismissed with costs to the respondent in this court.";
const ANSWER = "6. LAW\\research-lawyer answer v1.md";
const FINDING = `Scrutiny failed 2026-10-02: para 2 states the test only. Answer: ${ANSWER}.`;
const UNFILED_FINDING = "Scrutiny failed 2026-10-02: para 2 states the test only.";
const TWO_PARAS_FINDING = `Scrutiny failed 2026-10-02: paras 2 and 4 together state the test. Answer: ${ANSWER}.`;
const OTHER_CASE_FINDING = `Scrutiny failed 2026-10-02: the test is stated in another case at para 99. Answer: ${ANSWER}.`;
const NO_PARA_FINDING = `Scrutiny failed 2026-10-02: the excerpt states the test only. Answer: ${ANSWER}.`;
// Westlaw-like: a Held line repeating EXCERPT, a table of authorities, then bare-numbered paragraphs.
const WESTLAW_PAGES = [
  [
    "Westlaw v Sample, 2026 BCCA 999",
    "Held: A judge may grant summary judgment where there is no",
    "genuine issue requiring a trial, the headnote says.",
    "Table of Authorities",
    "1 The appellant appeals an order granting summary judgment.",
    "2 A judge may grant summary judgment where there is no",
    "genuine issue requiring a trial, having regard to the evidence.",
    "3 The chambers judge found the claim was bound to fail.",
  ],
  ["4 The appellant says the judge erred.", "5 The appeal is dismissed with costs to the respondent."],
];

const BUILD_PDF = `
import json, sys
from reportlab.pdfgen import canvas
c = canvas.Canvas(sys.argv[1], pagesize=(612, 792))
for lines in json.loads(sys.argv[2]):
    c.setFont("Helvetica", 12)
    for row, text in enumerate(lines):
        c.drawString(72, 700 - row * 24, text)
    c.showPage()
c.save()
`;

const LAW_ROWS = `
import json, sqlite3, sys
con = sqlite3.connect(sys.argv[1])
for title, citation, path, sha in json.loads(sys.argv[2]):
    con.execute("INSERT INTO authorities (title, citation, authority_type, file_path, file_hash) VALUES (?, ?, 'case_law', ?, ?)", (title, citation, path, sha))
con.commit()
con.close()
`;

const lit = (s) => `'${s.replace(/'/g, "''")}'`;
const SEED = `
INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L0000', 'CAN/BC/BCCA');
INSERT INTO authorities (id, proceeding_id, style_of_cause_or_title, citation, kind) VALUES
  (1, 1, 'Bockhold v CIBC Wood Gundy', '2026 BCCA 74', 'case'),
  (2, 1, 'Gone v Missing', '2020 BCSC 9', 'case'),
  (3, 1, 'Rtf v Word', '2024 BCCA 5', 'case'),
  (4, 1, 'Westlaw v Sample', '2026 BCCA 999', 'case');
INSERT INTO law_assertions (id, proceeding_id, proposition) VALUES (1, 1, 'Summary judgment needs no genuine issue for trial.');
INSERT INTO statements_of_law (id, proceeding_id, law_assertion_id, authority_id, pinpoint, excerpt, doubt, verification) VALUES
  (1, 1, 1, 1, 'para 2', ${lit(EXCERPT)}, ${lit(FINDING)}, 'failed'),
  (2, 1, 1, 1, 'para 2', ${lit(STITCHED)}, ${lit(FINDING)}, 'failed'),
  (3, 1, 1, 1, 'para 5', ${lit(ACROSS)}, ${lit(FINDING)}, 'failed'),
  (4, 1, 1, 2, 'para 1', 'Anything stored here.', ${lit(FINDING)}, 'failed'),
  (5, 1, 1, 3, 'para 1', ${lit(RTF_EXCERPT)}, ${lit(FINDING)}, 'failed'),
  (6, 1, 1, 1, 'para 2', ${lit(FOREIGN)}, ${lit(FINDING)}, 'failed'),
  (7, 1, 1, 1, 'para 2', ${lit(MARKED_FOREIGN)}, ${lit(FINDING)}, 'failed'),
  (8, 1, 1, 1, 'para 2', ${lit(EXCERPT)}, ${lit(UNFILED_FINDING)}, 'failed'),
  (9, 1, 1, 1, 'para 2', ${lit(EXCERPT)}, ${lit(TWO_PARAS_FINDING)}, 'failed'),
  (10, 1, 1, 1, 'para 2', ${lit(EXCERPT)}, ${lit(OTHER_CASE_FINDING)}, 'failed'),
  (11, 1, 1, 1, 'para 7', ${lit(EXCERPT)}, ${lit(NO_PARA_FINDING)}, 'failed'),
  (12, 1, 1, 1, 'para 7', ${lit(EXCERPT)}, ${lit(OTHER_CASE_FINDING)}, 'failed'),
  (13, 1, 1, 4, 'para 2', ${lit(EXCERPT)}, ${lit(NO_PARA_FINDING)}, 'failed'),
  (14, 1, 1, 1, 'para 7', ${lit(FOREIGN)}, ${lit(NO_PARA_FINDING)}, 'failed');
`;

function python(args) {
  const res = spawnSync(PYTHON, args, { encoding: "utf-8" });
  assert.equal(res.status, 0, res.stderr);
}

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** A matter with 0. DRAFT and 6. LAW, its matter-data folder holding the drafting and law databases. */
async function fixture(t) {
  const base = mkdtempSync(join(tmpdir(), "coclerk-scrutiny-test-"));
  t.after(() => rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));
  const root = join(base, "L0000 Matter");
  const caseData = join(base, "case data");
  for (const dir of [join(root, "0. DRAFT"), join(root, "6. LAW"), caseData]) mkdirSync(dir, { recursive: true });
  writeFileSync(join(root, "coclerk.json"), JSON.stringify({ schema_version: 5, matter_root: root, case_data_dir: caseData }));
  writeFileSync(join(root, ANSWER), "# answer\n");

  const pdf = join(root, "6. LAW", "Bockhold.pdf");
  python(["-c", BUILD_PDF, pdf, JSON.stringify(PAGES)]);
  const westlaw = join(root, "6. LAW", "Westlaw.pdf");
  python(["-c", BUILD_PDF, westlaw, JSON.stringify(WESTLAW_PAGES)]);
  writeFileSync(join(root, "6. LAW", "Rtf.doc"), RTF);
  writeCaseDataStores(caseData);
  python([
    "-c",
    LAW_ROWS,
    join(caseData, "law.sqlite"),
    JSON.stringify([
      ["Bockhold v CIBC Wood Gundy", "2026 BCCA 74", "6. LAW\\Bockhold.pdf", sha256(readFileSync(pdf))],
      ["Gone v Missing", "2020 BCSC 9", "6. LAW\\Gone.pdf", sha256("bytes no file holds")],
      ["Rtf v Word", "2024 BCCA 5", "6. LAW\\Rtf.doc", sha256(RTF)],
      ["Westlaw v Sample", "2026 BCCA 999", "6. LAW\\Westlaw.pdf", sha256(readFileSync(westlaw))],
    ]),
  ]);

  const dbPath = join(caseData, "submission.sqlite");
  await freshSubmissionDb(dbPath);
  await submissionDataExecute(dbPath, SEED);

  const canon = realpathSync.native(root);
  const env = { ...process.env, LOCALAPPDATA: join(base, "local app data") };
  const dbHash = () => sha256(readFileSync(dbPath));
  const before = dbHash();
  const run = (extra = {}) => {
    const result = draftHarness({ step: "scrutiny_review", matter_root: canon, db_path: dbPath, statement_id: 1, ...extra }, env);
    assert.equal(dbHash(), before, "the step changed the drafting database");
    return result;
  };
  const folder = (id = 1) => join(canon, "0. DRAFT", "Scrutiny review", `statement ${id}`);
  return { base, root: canon, caseData, dbPath, pdf, env, run, folder };
}

test("scrutiny_review: a PDF at its recorded path gives the full package, with no passage text in the response", async (t) => {
  const f = await fixture(t);
  const result = f.run();
  assert.equal(result.success, true, JSON.stringify(result));
  assert.deepEqual(result.statement, {
    id: 1,
    proposition: "Summary judgment needs no genuine issue for trial.",
    authority: { id: 1, title: "Bockhold v CIBC Wood Gundy", citation: "2026 BCCA 74", kind: "case" },
    pinpoint: "para 2",
    verification: "failed",
    pinpoint_paragraph: 2,
  });
  assert.deepEqual(result.finding, { text: FINDING, answer_file: { named: ANSWER, path: join(f.root, ANSWER), exists: true } });
  assert.equal(result.source.arm, "recorded_path");
  assert.equal(result.source.path, join(f.root, "6. LAW", "Bockhold.pdf"));
  assert.equal(result.source.hash_identity, true);
  assert.deepEqual([result.source.source_format, result.source.converter], ["pdf", null]);
  assert.equal(result.verbatim.exit, 0, JSON.stringify(result.verbatim));
  assert.equal(result.verbatim.identical, true);

  const { folder, cited, context } = result.extracts;
  assert.equal(folder, f.folder());
  assert.equal(cited.pdf, join(folder, "1 cited - Bockhold v CIBC Wood Gundy - p1 para 2.pdf"));
  assert.deepEqual(cited.pngs, [join(folder, "1 cited - Bockhold v CIBC Wood Gundy - p1 para 2-p1.png")]);
  assert.deepEqual(cited.pages, [1]);
  assert.deepEqual(cited.painted.map((p) => p.spec), ["para 2 yellow", "excerpt"]);
  assert.equal(cited.crossed_page_break, false);
  assert.equal("excerpt_not_painted" in cited, false);
  assert.equal(context.pdf, join(folder, "2 context - Bockhold v CIBC Wood Gundy - pp1-2.pdf"));
  assert.deepEqual(context.pages, [1, 2]);
  assert.equal(context.pngs.length, 2);
  assert.equal("widened" in context, false);
  assert.deepEqual(readdirSync(folder).sort(), [cited.pdf, ...cited.pngs, context.pdf, ...context.pngs].map((p) => p.slice(folder.length + 1)).sort());
  for (const file of [cited.pdf, context.pdf]) assert.equal(readFileSync(file).subarray(0, 4).toString(), "%PDF");

  const text = JSON.stringify(result);
  assert.equal(text.includes("source_window"), false);
  assert.equal(text.includes(EXCERPT), false);
  assert.equal("proposed" in result, false);
  assert.equal("foreign_files" in result, false);
  assert.equal(typeof result.elapsed_ms, "number");
});

test("scrutiny_review: a finding that names no answer file is written to its own text file in the statement folder", async (t) => {
  const f = await fixture(t);
  const result = f.run({ statement_id: 8 });
  assert.equal(result.success, true, JSON.stringify(result));
  const file = join(f.folder(8), "3 finding - Bockhold v CIBC Wood Gundy - p1 para 2.txt");
  assert.deepEqual(result.finding, { text: UNFILED_FINDING, answer_file: null, file });
  assert.equal(readFileSync(file, "utf-8"), UNFILED_FINDING);

  // A later call replaces it, and never lists it as a file the step did not write.
  const again = f.run({ statement_id: 8 });
  assert.equal(again.success, true, JSON.stringify(again));
  assert.equal("foreign_files" in again, false, JSON.stringify(again.foreign_files));
  assert.equal(readFileSync(file, "utf-8"), UNFILED_FINDING);
});

test("scrutiny_review: a renamed authority file is found by hash, the stale path tried first", async (t) => {
  const f = await fixture(t);
  mkdirSync(join(f.root, "6. LAW", "Summary Judgment"));
  const moved = join(f.root, "6. LAW", "Summary Judgment", "2026 BCCA 74 Bockhold.pdf");
  renameSync(join(f.root, "6. LAW", "Bockhold.pdf"), moved);
  const result = f.run();
  assert.equal(result.success, true, JSON.stringify(result));
  assert.equal(result.source.arm, "hash_search");
  assert.equal(result.source.path, moved);
  assert.deepEqual([result.source.skipped_cloud_only, result.source.unreadable], [0, []]);
  assert.deepEqual(result.source.tried, [{ path: join(f.root, "6. LAW", "Bockhold.pdf"), reason: "missing" }]);
});

test("scrutiny_review: an unresolvable authority refuses source_unresolved with the statement, finding and search", async (t) => {
  const f = await fixture(t);
  const result = f.run({ statement_id: 4 });
  assert.deepEqual([result.success, result.error], [false, "source_unresolved"], JSON.stringify(result));
  assert.equal(result.partial.statement.id, 4);
  assert.equal(result.partial.finding.text, FINDING);
  assert.deepEqual(result.partial.source.tried, [{ path: join(f.root, "6. LAW", "Gone.pdf"), reason: "missing" }]);
  assert.deepEqual(result.partial.source.searched, [join(f.root, "6. LAW"), f.root]);
  assert.deepEqual([result.partial.source.skipped_cloud_only, result.partial.source.unreadable], [0, []]);
  assert.equal(existsSync(f.folder(4)), false);
});

test("scrutiny_review: an RTF .doc is converted by Word, and a second call reuses the cached PDF", { skip: NO_WORD }, async (t) => {
  const f = await fixture(t);
  const first = f.run({ statement_id: 5 });
  assert.equal(first.success, true, JSON.stringify(first));
  assert.deepEqual([first.source.source_format, first.source.converter, first.source.cached], ["rtf", "word", false]);
  assert.equal(first.verbatim.exit, 0, JSON.stringify(first.verbatim));
  const cache = join(f.env.LOCALAPPDATA, "Coclerk", "scrutiny-review", `${sha256(RTF)}.pdf`);
  const mtime = statSync(cache).mtimeMs;
  const second = f.run({ statement_id: 5 });
  assert.equal(second.success, true, JSON.stringify(second));
  assert.equal(second.source.cached, true);
  assert.equal(statSync(cache).mtimeMs, mtime);
});

test("scrutiny_review: a [...] excerpt checks as marked stitching and paints two yellow runs", async (t) => {
  const f = await fixture(t);
  const result = f.run({ statement_id: 2 });
  assert.equal(result.success, true, JSON.stringify(result));
  assert.equal(result.verbatim.stitching, "marked");
  assert.equal(result.verbatim.exit, 0, JSON.stringify(result.verbatim));
  assert.ok(result.verbatim.parts.every((part) => !("source_window" in part)));
  const excerpt = result.extracts.cited.painted.find((p) => p.spec === "excerpt");
  assert.equal(excerpt.yellow_runs, 2, JSON.stringify(excerpt));
  assert.ok(excerpt.orange > 0, "the omitted text is painted orange");
});

test("scrutiny_review: a paragraph crossing a page break writes both pages and says so", async (t) => {
  const f = await fixture(t);
  const result = f.run({ statement_id: 3 });
  assert.equal(result.success, true, JSON.stringify(result));
  assert.deepEqual(result.extracts.cited.pages, [2, 3]);
  assert.equal(result.extracts.cited.crossed_page_break, true);
  assert.equal(result.extracts.cited.pngs.length, 2);
  assert.deepEqual(result.extracts.context.pages, [1, 2, 3]);
});

test("scrutiny_review: a proposed span is cut, checked and returned for the gatekeeper write only", async (t) => {
  const f = await fixture(t);
  const result = f.run({ proposed: { pinpoint: "para 3", span: { start: "The chambers judge found", end: "before filing." } } });
  assert.equal(result.success, true, JSON.stringify(result));
  assert.equal(result.proposed.verbatim.exit, 0, JSON.stringify(result.proposed.verbatim));
  assert.equal(result.proposed.model_only.proposed_excerpt, SPAN_TEXT);
  assert.match(result.proposed.model_only.note, /never paste into chat/);
  assert.equal(result.proposed.extracts.cited.pdf, join(f.folder(), "proposed 1 cited - Bockhold v CIBC Wood Gundy - p1 para 3.pdf"));
  const names = readdirSync(f.folder());
  assert.ok(names.includes("1 cited - Bockhold v CIBC Wood Gundy - p1 para 2.pdf"), names.join(", "));
  assert.ok(names.some((name) => name.startsWith("proposed 2 context - ")), names.join(", "));
  assert.equal(JSON.stringify(result).includes(EXCERPT), false);

  // A later call without a proposal clears the proposed files.
  assert.equal(f.run().success, true);
  assert.equal(readdirSync(f.folder()).some((name) => name.startsWith("proposed ")), false);
});

test("scrutiny_review: an excerpt the source does not hold is reported by word count, never by its text", async (t) => {
  const f = await fixture(t);
  const words = FOREIGN.split(" ").length;

  const unmarked = f.run({ statement_id: 6 });
  assert.equal(unmarked.success, true, JSON.stringify(unmarked));
  assert.equal(unmarked.verbatim.exit, 2, JSON.stringify(unmarked.verbatim));
  assert.ok(unmarked.verbatim.opcodes.length > 0);
  for (const op of unmarked.verbatim.opcodes) assert.equal(op.ours, "", JSON.stringify(op));
  assert.equal(unmarked.verbatim.opcodes.reduce((sum, op) => sum + op.ours_words, 0), words);
  assert.equal(JSON.stringify(unmarked).includes(FOREIGN), false, JSON.stringify(unmarked));

  const marked = f.run({ statement_id: 7 });
  assert.equal(marked.success, true, JSON.stringify(marked));
  assert.equal(marked.verbatim.stitching, "marked");
  assert.deepEqual(marked.verbatim.opcodes, [{ op: "not_found", part: 1, ours: "", source: "", ours_words: words }]);
  assert.ok(marked.verbatim.parts[1].opcodes.every((op) => op.ours === ""), JSON.stringify(marked.verbatim.parts[1]));
  assert.equal(JSON.stringify(marked).includes(FOREIGN), false, JSON.stringify(marked));
});

test("scrutiny_review: a context paragraph two pages from the cited one widens the context extract", async (t) => {
  const f = await fixture(t);
  const result = f.run({ context_paras: [2, 6] });
  assert.equal(result.success, true, JSON.stringify(result));
  const { context } = result.extracts;
  assert.equal(context.widened, true);
  assert.deepEqual(context.pages, [1, 2, 3]);
  assert.equal(context.pdf, join(f.folder(), "2 context - Bockhold v CIBC Wood Gundy - pp1-3.pdf"));
  assert.deepEqual(context.painted.map((p) => p.spec), ["para 2 yellow", "para 6 yellow"]);
  assert.equal("context_paras_derived" in result, false);
});

test("scrutiny_review: without context_paras, the paragraphs the finding cites, less the pinpoint, are painted in context", async (t) => {
  const f = await fixture(t);
  const result = f.run({ statement_id: 9 });
  assert.equal(result.success, true, JSON.stringify(result));
  assert.deepEqual(result.context_paras_derived, [4]);
  assert.deepEqual(result.extracts.context.painted.map((p) => p.spec), ["para 4 yellow"]);
  assert.equal("context_paras_not_found" in result, false);
});

test("scrutiny_review: a derived paragraph the source lacks is dropped and reported, and the context falls back to the pinpoint", async (t) => {
  const f = await fixture(t);
  const result = f.run({ statement_id: 10 });
  assert.equal(result.success, true, JSON.stringify(result));
  assert.deepEqual(result.context_paras_derived, [99]);
  assert.deepEqual(result.context_paras_not_found, [99]);
  const { context } = result.extracts;
  assert.deepEqual(context.painted.map((p) => p.spec), ["para 2 yellow"]);
  assert.deepEqual(context.pages, [1, 2]);
  assert.equal("widened" in context, false);
});

test("scrutiny_review: an excerpt repeated in Westlaw front matter is located in the judgment on the first run", async (t) => {
  const f = await fixture(t);
  const result = f.run({ statement_id: 13 });
  assert.equal(result.success, true, JSON.stringify(result));
  assert.equal(result.verbatim.exit, 0, JSON.stringify(result.verbatim));
  const { cited, context } = result.extracts;
  assert.deepEqual(cited.painted.map((p) => p.spec), ["para 2 yellow", "excerpt"]);
  const excerpt = cited.painted.find((p) => p.spec === "excerpt");
  assert.deepEqual([excerpt.yellow, excerpt.yellow_runs, excerpt.orange, excerpt.pages], [15, 1, 0, "1"], JSON.stringify(excerpt));
  assert.equal("excerpt_not_painted" in cited, false);
  assert.equal("para_not_painted" in cited, false);
  assert.equal(cited.pdf, join(f.folder(13), "1 cited - Westlaw v Sample - p1 para 2.pdf"));
  assert.deepEqual(context.pages, [1, 2]);
  assert.equal("para_not_painted" in context, false);
});

test("scrutiny_review: a pinpoint paragraph the script cannot find gives para_not_painted on both extracts", async (t) => {
  const f = await fixture(t);
  const noMarker = /^no line-leading \[7\], 7\. or bare 7 marker/;

  const result = f.run({ statement_id: 11 });
  assert.equal(result.success, true, JSON.stringify(result));
  const { cited, context } = result.extracts;
  assert.match(cited.para_not_painted, noMarker);
  assert.equal(cited.pdf, join(f.folder(11), "1 cited - Bockhold v CIBC Wood Gundy - p1.pdf"));
  assert.deepEqual(cited.painted.map((p) => p.spec), ["excerpt"]);
  assert.equal("excerpt_not_painted" in cited, false);
  assert.match(context.para_not_painted, noMarker);
  assert.deepEqual(context.painted.map((p) => p.spec), ["excerpt"]);
  assert.deepEqual(context.pages, [1, 2]);
  assert.equal("widened" in context, false);
  assert.equal("context_paras_not_found" in result, false);

  const dropped = f.run({ statement_id: 12 });
  assert.equal(dropped.success, true, JSON.stringify(dropped));
  assert.deepEqual(dropped.context_paras_derived, [99]);
  assert.deepEqual(dropped.context_paras_not_found, [99]);
  assert.match(dropped.extracts.cited.para_not_painted, noMarker);
  assert.match(dropped.extracts.context.para_not_painted, noMarker);
  assert.deepEqual(dropped.extracts.context.painted.map((p) => p.spec), ["excerpt"]);
});

test("scrutiny_review: an excerpt the source lacks with a pinpoint it cannot find still refuses highlight_failed", async (t) => {
  const f = await fixture(t);
  const result = f.run({ statement_id: 14 });
  assert.deepEqual([result.success, result.error], [false, "highlight_failed"], JSON.stringify(result));
  assert.ok(result.detail.startsWith("cited extract:"), result.detail);
  assert.ok(result.detail.includes("para 7 yellow: FAILED"), result.detail);
});

test("scrutiny_review: a source_path in a TRASH folder at any depth is refused path_out_of_scope", async (t) => {
  const f = await fixture(t);
  mkdirSync(join(f.root, "6. LAW", "Old", "trash"), { recursive: true });
  writeFileSync(join(f.root, "6. LAW", "Old", "trash", "Bockhold.pdf"), readFileSync(f.pdf));
  assert.equal(codeOf(() => f.run({ statement_id: 4, source_path: "6. LAW\\Old\\trash\\Bockhold.pdf" })), "path_out_of_scope");
});

test("scrutiny_review: a file it did not write is left alone, listed, and never stops the review", async (t) => {
  const f = await fixture(t);
  mkdirSync(f.folder(), { recursive: true });
  const notes = join(f.folder(), "notes.pdf");
  const bytes = randomBytes(256);
  writeFileSync(notes, bytes);
  const stale = join(f.folder(), "1 cited - Stale - p9.pdf");
  writeFileSync(stale, "stale");

  const result = f.run();
  assert.equal(result.success, true, JSON.stringify(result));
  assert.deepEqual(result.foreign_files, ["notes.pdf"]);
  assert.ok(readFileSync(notes).equals(bytes), "the foreign file changed");
  assert.equal(existsSync(stale), false, "the stale own file was not replaced");
  assert.equal(existsSync(result.extracts.cited.pdf), true);

  const again = f.run();
  assert.equal(again.success, true, JSON.stringify(again));
  assert.deepEqual(again.foreign_files, ["notes.pdf"]);
  assert.ok(readFileSync(notes).equals(bytes), "the foreign file changed on the second call");
});

test("scrutiny_review: a db_path outside the matter's matter-data folder is refused path_out_of_scope", async (t) => {
  const f = await fixture(t);
  const elsewhere = join(f.base, "elsewhere");
  mkdirSync(elsewhere);
  const copy = join(elsewhere, "submission.sqlite");
  writeFileSync(copy, readFileSync(f.dbPath));
  assert.equal(codeOf(() => f.run({ db_path: copy })), "path_out_of_scope");
  assert.equal(existsSync(join(f.root, "0. DRAFT", "Scrutiny review")), false);
});
