// drafting_forms__publish_general, publish_bcca_factum and publish_vaniac_package (#1268, ADR 0026):
// /publish's fills run host-side for a Cowork session. Each happy path runs the real fill script
// against a synthetic matter and matter-data folder. Temp directories only; never a live matter.

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import test from "node:test";

import { codeOf } from "./helpers/housekeeping-fixture.mjs";
import { generalWritingFixture, NO_VENUE_TREE } from "./helpers/general-writing-fixture.mjs";
import { knowledgeFile } from "./helpers/knowledge-fixture.mjs";
import { seedVaniacProceeding } from "./fixtures/forms-render-seeds.mjs";
import { FACTUM_CASE_DATA, FACTUM_SEED } from "./fixtures/bcca-factum-seed.mjs";

const { freshSubmissionDb } = await import("./helpers/template-db.mjs");
const { writePartiesOfRecord } = await import("./helpers/matter-data-fixture.mjs");
const { submissionDataExecute } = await import("../build/submission/backend.js");
const { publishBccaFactum, publishGeneral, publishVaniacPackage } = await import("../build/submission/publish-tools.js");
const { callTool } = await import("../build/dispatch.js");

const FORMAT_PATH = "publish/CAN/FX/_NoVenue/format.md";
const FORMAT_FRONT = "items:\n  - rule_ref: F-paper\n    passage: Use letter-size paper.\n    source: practitioner";
const FORMAT_BLOCK = { format: { paper: { value: "letter", rule_ref: "F-paper" } } };

/** A matter folder with one 0. DRAFT folder, whose coclerk.json names `caseData` (the folder holding the database). */
function matterOver(t, caseData) {
  const base = mkdtempSync(join(tmpdir(), "coclerk-publish-"));
  t.after(() => rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));
  const root = join(base, "L0000 Matter");
  mkdirSync(join(root, "0. DRAFT"), { recursive: true });
  if (!existsSync(join(caseData, "main.sqlite"))) writeFileSync(join(caseData, "main.sqlite"), "");
  writeFileSync(join(root, "coclerk.json"), JSON.stringify({ schema_version: 5, matter_root: root, case_data_dir: caseData }));
  const outside = mkdtempSync(join(tmpdir(), "coclerk-outside-"));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  return { base, root: realpathSync.native(root), draft: realpathSync.native(join(root, "0. DRAFT")), caseData: realpathSync.native(caseData), outside };
}

/** A database seeded by `seed`, in a fresh matter-data folder. */
async function seededCaseData(t, seed) {
  const caseData = mkdtempSync(join(tmpdir(), "coclerk-publish-cd-"));
  t.after(() => rmSync(caseData, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));
  const dbPath = join(caseData, "submission.sqlite");
  await freshSubmissionDb(dbPath);
  await seed(dbPath);
  return { caseData, dbPath };
}

/** A vetted party letter with its prose written, and the venue's format file in the overlay. */
async function generalFixture(t) {
  const g = await generalWritingFixture(t);
  g.f.local(FORMAT_PATH, knowledgeFile(FORMAT_FRONT, FORMAT_BLOCK));
  const { filing_id } = await g.create({ proceeding_id: 1, tree: NO_VENUE_TREE, kind: "letter_to_opposing_party", recipient: "opposing-party", title: "Letter to Bert" });
  await g.confirm(filing_id);
  await g.prose(filing_id, "addressee", "Bert Other\n1 Main Street");
  await g.prose(filing_id, "body", "Please pay the invoice.");
  await g.recipient(filing_id, 2, "to");
  const m = matterOver(t, g.f.scratch);
  const args = { matter_root: m.root, db_path: g.dbPath, filing_id, output_name: "2026-10-01 LT Bert re INV#7413 & costs", format_path: FORMAT_PATH };
  return { ...m, g, args, subfolder: join(m.caseData, "publish-general"), run: (extra = {}) => publishGeneral({ ...args, ...extra }) };
}

async function factumFixture(t) {
  const { caseData, dbPath } = await seededCaseData(t, (db) => {
    writePartiesOfRecord(dirname(db), FACTUM_CASE_DATA);
    return submissionDataExecute(db, FACTUM_SEED);
  });
  const m = matterOver(t, caseData);
  const args = { matter_root: m.root, db_path: dbPath, filing_id: 1, output_name: "2026-09-16 FACTUM re respondents", dated_on: "2026-09-16" };
  return { ...m, args, subfolder: join(m.caseData, "bcca-factum-substance"), run: (extra = {}) => publishBccaFactum({ ...args, ...extra }) };
}

async function vaniacFixture(t) {
  const { caseData, dbPath } = await seededCaseData(t, seedVaniacProceeding);
  const m = matterOver(t, caseData);
  const args = { matter_root: m.root, db_path: dbPath, filing_id: 1, writing_folder: "SUB Opening Submissions Package", round: "opening" };
  const pkg = join(m.draft, args.writing_folder, "Package");
  return { ...m, args, pkg, subfolder: join(m.caseData, "vaniac-submissions"), run: (extra = {}) => publishVaniacPackage({ ...args, ...extra }) };
}

const FIXTURES = { general: generalFixture, factum: factumFixture, vaniac: vaniacFixture };

/** Every file under each of `dirs`, with its bytes. */
function snapshot(...dirs) {
  const files = new Map();
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.isFile()) files.set(p, readFileSync(p));
    }
  };
  for (const dir of dirs) walk(dir);
  return files;
}

/** The files added or changed since `before`, which must all sit under one of `allowed`. */
function assertWritesOnlyUnder(before, after, allowed, ignored = []) {
  const touched = [...after].filter(([p, bytes]) => !before.has(p) || !before.get(p).equals(bytes)).map(([p]) => p);
  const inside = (p, dir) => p === dir || p.toLowerCase().startsWith((dir + sep).toLowerCase());
  const stray = touched.filter((p) => !allowed.some((dir) => inside(p, dir)) && !ignored.some((dir) => inside(p, dir)));
  assert.deepEqual(stray, [], `written outside ${allowed.join(" and ")}`);
  assert.deepEqual([...before.keys()].filter((p) => !after.has(p)), [], "a file was removed");
  return touched;
}

for (const [tool, fixture] of Object.entries(FIXTURES)) {
  // publish_general and publish_bcca_factum take output_name, a file name stem at the top of the 0. DRAFT folder, in place of writing_folder.
  const key = tool === "vaniac" ? "writing_folder" : "output_name";
  test(`${tool}: refuses a ${key} that is a path, "..", or resolves outside the 0. DRAFT folder, before writing anything`, async (t) => {
    const f = await fixture(t);
    for (const value of ["..", ".", "a\\b", "a/b", "C:x", "..\\SUB x"]) {
      assert.equal(codeOf(() => f.run({ [key]: value })), "path_out_of_scope", value);
    }
    if (tool !== "vaniac") {
      assert.deepEqual(readdirSync(f.draft), []);
      assert.equal(existsSync(f.subfolder), false);
      return;
    }
    const linked = "SUB Linked";
    symlinkSync(f.outside, join(f.draft, linked), "junction");
    assert.equal(codeOf(() => f.run({ writing_folder: linked })), "path_out_of_scope");
    assert.deepEqual(readdirSync(f.outside), []);
    assert.equal(existsSync(f.subfolder), false);
  });

  test(`${tool}: refuses a matter-data subfolder that is a link elsewhere, and a database outside the matter-data folder`, async (t) => {
    const f = await fixture(t);
    symlinkSync(f.outside, f.subfolder, "junction");
    assert.equal(codeOf(() => f.run()), "path_out_of_scope");
    assert.deepEqual(readdirSync(f.outside), []);
    rmSync(f.subfolder);

    writeFileSync(join(f.outside, "submission.sqlite"), "");
    assert.equal(codeOf(() => f.run({ db_path: join(f.outside, "submission.sqlite") })), "path_out_of_scope");
    assert.equal(existsSync(f.subfolder), false);
  });

  test(`${tool}: refuses a matter with no 0. DRAFT folder, or with two, creating none and writing nothing`, async (t) => {
    const f = await fixture(t);
    mkdirSync(join(f.root, "0. DRAFT old"));
    assert.equal(codeOf(() => f.run()), "draft_dir_ambiguous");
    rmSync(join(f.root, "0. DRAFT old"), { recursive: true });
    rmSync(f.draft, { recursive: true });
    assert.equal(codeOf(() => f.run()), "draft_dir_missing");
    assert.deepEqual(readdirSync(f.root).filter((name) => /^0\. DRAFT/i.test(name)), []);
    assert.equal(existsSync(f.subfolder), false);
  });

  test(`${tool}: the tool is registered and takes no matter-data path from the caller`, async (t) => {
    const f = await fixture(t);
    const name = { general: "drafting_forms__publish_general", factum: "drafting_forms__publish_bcca_factum", vaniac: "drafting_forms__publish_vaniac_package" }[tool];
    await assert.rejects(callTool({}, name, { ...f.args, case_data_folder: f.caseData }), /unknown field "case_data_folder"/);
  });
}

test("general: writes <output_name>.docx at the top of the 0. DRAFT folder and its working files into publish-general", async (t) => {
  const f = await generalFixture(t);
  const before = snapshot(f.base, f.caseData);
  const result = f.run();
  assert.equal(result.success, true, JSON.stringify(result));
  assert.equal(result.deliverable, join(f.draft, `${f.args.output_name}.docx`));
  assert.equal("versioned_from" in result, false);
  assert.ok(statSync(result.deliverable).size > 0);
  assert.deepEqual(readdirSync(f.draft), [`${f.args.output_name}.docx`]);
  assert.deepEqual(readdirSync(f.subfolder).sort(), ["filed.json", "format.json"]);
  assert.equal(JSON.parse(readFileSync(join(f.subfolder, "format.json"), "utf-8")).path, FORMAT_PATH);
  assertWritesOnlyUnder(before, snapshot(f.base, f.caseData), [result.deliverable, f.subfolder]);
});

test("general: a second call versions to v2, reports versioned_from, and leaves the first copy untouched", async (t) => {
  const f = await generalFixture(t);
  const first = f.run();
  assert.equal(first.success, true, JSON.stringify(first));
  const bytes = readFileSync(first.deliverable);
  const again = f.run({ tokens: { "{{FILE_NUMBER}}": "L0000" } });
  assert.equal(again.success, true, JSON.stringify(again));
  assert.equal(again.deliverable, join(f.draft, `${f.args.output_name} v2.docx`));
  assert.equal(again.versioned_from, first.deliverable);
  assert.ok(readFileSync(first.deliverable).equals(bytes));
  assert.deepEqual(readdirSync(f.draft).sort(), [`${f.args.output_name} v2.docx`, `${f.args.output_name}.docx`]);
  assert.deepEqual(JSON.parse(readFileSync(join(f.subfolder, "tokens.json"), "utf-8")), { "{{FILE_NUMBER}}": "L0000" });
});

test("general: a 0. DRAFT folder that is a link elsewhere is refused, and nothing is written", async (t) => {
  const f = await generalFixture(t);
  rmSync(f.draft, { recursive: true });
  symlinkSync(f.outside, f.draft, "junction");
  assert.equal(codeOf(() => f.run()), "path_out_of_scope");
  assert.deepEqual(readdirSync(f.outside), []);
  assert.equal(existsSync(f.subfolder), false);
});

test("general: a render refusal comes back as a refusal, and nothing is written or run", async (t) => {
  const f = await generalFixture(t);
  // The counsel letter's learned layout cites items no roster lawyer has confirmed.
  const { filing_id } = await f.g.createLetter();
  await f.g.prose(filing_id, "addressee", "Cara Counsel");
  await f.g.prose(filing_id, "body", "Body.");
  await f.g.prose(filing_id, "sender", "Fixture Law LLP");
  await f.g.recipient(filing_id, 1, "to");
  const result = f.run({ filing_id });
  assert.equal(result.success, false);
  assert.equal(result.error, "confirmation_gate_failed");
  assert.deepEqual(result.render.unconfirmed, ["R-title", "R-body"]);
  assert.equal(existsSync(f.subfolder), false);
  assert.deepEqual(readdirSync(f.draft), []);
});

test("factum: writes bcca-factum.md verbatim, validates and fills <output_name>.docx at the top of the 0. DRAFT folder", async (t) => {
  const f = await factumFixture(t);
  const before = snapshot(f.base, f.caseData);
  const result = f.run();
  assert.equal(result.success, true, JSON.stringify(result));
  assert.equal(result.document, "factum");
  assert.equal(result.path, join(f.draft, `${f.args.output_name}.docx`));
  assert.equal("versioned_from" in result, false);
  assert.deepEqual(readdirSync(f.draft), [`${f.args.output_name}.docx`]);
  assert.deepEqual(readdirSync(f.subfolder), ["bcca-factum.md"]);
  assertWritesOnlyUnder(before, snapshot(f.base, f.caseData), [result.path, f.subfolder]);
});

test("factum: a second call versions to v2, reports versioned_from, and leaves the first copy untouched", async (t) => {
  const f = await factumFixture(t);
  const first = f.run();
  assert.equal(first.success, true, JSON.stringify(first));
  const bytes = readFileSync(first.path);
  const again = f.run();
  assert.equal(again.success, true, JSON.stringify(again));
  assert.equal(again.path, join(f.draft, `${f.args.output_name} v2.docx`));
  assert.equal(again.versioned_from, first.path);
  assert.ok(readFileSync(first.path).equals(bytes));
  assert.deepEqual(readdirSync(f.draft).sort(), [`${f.args.output_name} v2.docx`, `${f.args.output_name}.docx`]);
});

test("factum: an emitter refusal is the tool's error, before anything is written", async (t) => {
  const f = await factumFixture(t);
  assert.throws(() => f.run({ dated_on: "16 September 2026" }), /dated_on must be YYYY-MM-DD/);
  assert.equal(existsSync(f.subfolder), false);
  assert.deepEqual(readdirSync(f.draft), []);
});

test("vaniac: writes the source files into the filing's data folder and the package's .docx files into Package, and never overwrites", async (t) => {
  const f = await vaniacFixture(t);
  const writing = join(f.draft, f.args.writing_folder);
  const data = join(f.subfolder, "Opening Submissions Package");
  const before = snapshot(f.base, f.caseData);
  const result = f.run();
  assert.equal(result.success, true, JSON.stringify(result));
  const sources = readdirSync(data).sort();
  assert.ok(sources.includes("Written Arguments.md") && sources.includes("Evidence Index.md") && sources.includes("Package index.json"), sources.join(", "));
  const witnesses = sources.filter((name) => name.startsWith("Witness Statement - ")).map((name) => name.slice("Witness Statement - ".length, -3));
  assert.ok(witnesses.length > 0);
  assert.deepEqual(JSON.parse(readFileSync(join(data, "Package index.json"), "utf-8")).witnesses, witnesses);
  const docs = readdirSync(f.pkg).sort();
  assert.ok(docs.includes("Index.docx") && docs.some((name) => name.startsWith("Written Argument of the ")), docs.join(", "));
  for (const name of witnesses) assert.ok(docs.includes(`Witness Statement of ${name}.docx`), name);
  assertWritesOnlyUnder(before, snapshot(f.base, f.caseData), [writing, data]);

  const index = readFileSync(join(f.pkg, "Index.docx"));
  const again = f.run();
  assert.deepEqual([again.success, again.error], [false, "output_exists"]);
  assert.ok(readFileSync(join(f.pkg, "Index.docx")).equals(index));
});

test("vaniac: a stale signed witness statement in Package is refused before anything is written", async (t) => {
  const f = await vaniacFixture(t);
  mkdirSync(f.pkg, { recursive: true });
  writeFileSync(join(f.pkg, "Witness Statement of X - signed.pdf"), "%PDF-stale");
  writeFileSync(join(f.pkg, "Expert Report of Y.pdf"), "%PDF-kept");
  const result = f.run();
  assert.deepEqual([result.success, result.error], [false, "output_exists"]);
  assert.match(result.detail, /Witness Statement of X - signed\.pdf/);
  assert.doesNotMatch(result.detail, /Expert Report/);
  assert.equal(existsSync(f.subfolder), false);
  assert.deepEqual(readdirSync(f.pkg).sort(), ["Expert Report of Y.pdf", "Witness Statement of X - signed.pdf"]);
});

test("vaniac: a writing_folder without the SUB code is refused, and a Package folder that is a link elsewhere", async (t) => {
  const f = await vaniacFixture(t);
  assert.throws(() => f.run({ writing_folder: "Opening Submissions Package" }), /SUB <filing folder>/);
  for (const writing_folder of ["SUB ..", "SUB .", "2026-09-30 SUB .."]) {
    assert.equal(codeOf(() => f.run({ writing_folder })), "path_out_of_scope", writing_folder);
  }
  assert.equal(existsSync(f.subfolder), false);
  assert.deepEqual(readdirSync(f.draft), []);
  mkdirSync(join(f.draft, f.args.writing_folder));
  symlinkSync(f.outside, f.pkg, "junction");
  assert.equal(codeOf(() => f.run()), "path_out_of_scope");
  assert.deepEqual(readdirSync(f.outside), []);
  assert.equal(existsSync(f.subfolder), false);
});
