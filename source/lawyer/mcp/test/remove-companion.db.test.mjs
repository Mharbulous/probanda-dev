// drafting_data__resnapshot_writing with remove_companion (docs/Specs/2026-11-05_unlink-written-
// arguments-from-work-board-spec.md): one companion leaves one drafting Writing's stored layout, every
// other field kept; the next mockup render writes no Written Arguments file and archives the old one;
// another Writing on the same board keeps its own; a sent or retired Writing refuses, writing nothing.

import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";

import { seedBcscConsentOrder, seededDbFixture } from "./fixtures/forms-render-seeds.mjs";

const { freshSubmissionDb, partiesSnapshotSql, seedSql } = await import("./helpers/template-db.mjs");
const { submissionDataExecute, submissionDataQuery } = await import("../build/submission/backend.js");
const { submissionFormsRender } = await import("../build/submission/forms.js");
const { composeLayoutSnapshot } = await import("../build/submission/writing-snapshot.js");
const { callTool } = await import("../build/dispatch.js");

const TOOL = "drafting_data__resnapshot_writing";
const CLIENT = { clientName: "Ada Client", clientNo: "0001", matterNo: "L0000" };
const WA = "Written Arguments.md";

/** The consent requisition's stored layout, naming Written Arguments as a Writing created before
 * the type stopped declaring it stores it. */
function layoutWithWrittenArguments() {
  const stored = JSON.parse(
    composeLayoutSnapshot({ country: "CAN", jurisdiction: "BC", venue: "BCSC", kind: "requisition_consent" }).layout_snapshot
  );
  stored.layout.companions = ["written-arguments"];
  return JSON.stringify(stored);
}

/** Filing 1 (the seed's) and filing 2, a second Writing on the same proceeding, both storing the layout. */
async function board(t, { filed_on = null, retired_on = null } = {}) {
  const f = seededDbFixture();
  // An empty firm overlay, which composing the layout reads.
  const saved = process.env.APPDATA;
  t.after(() => {
    if (saved === undefined) delete process.env.APPDATA;
    else process.env.APPDATA = saved;
    f.cleanup();
  });
  mkdirSync(join(f.dir, "case"));
  mkdirSync(join(f.dir, "appdata", "Probanda"), { recursive: true });
  writeFileSync(join(f.dir, "appdata", "Probanda", "probanda.json"), JSON.stringify({ case_data_root: join(f.dir, "case") }));
  process.env.APPDATA = join(f.dir, "appdata");
  await freshSubmissionDb(f.dbPath);
  await seedBcscConsentOrder(f.dbPath);
  const layout = layoutWithWrittenArguments().replace(/'/g, "''");
  await submissionDataExecute(
    f.dbPath,
    "INSERT INTO filings (id, proceeding_id, kind, subkind, title) VALUES (2, 1, 'requisition_consent', 'consent', 'Second Requisition');" +
      `UPDATE filings SET layout_snapshot = '${layout}';` +
      (retired_on ? `UPDATE filings SET retired_on = '${retired_on}' WHERE id = 1;` : "")
  );
  // execute refuses a sent date: record_filed owns that act.
  if (filed_on) seedSql(f.dbPath, `${partiesSnapshotSql(f.dbPath, 1)} UPDATE filings SET filed_on = '${filed_on}' WHERE id = 1;`);
  return f.dbPath;
}

const snapshotOf = (dbPath, id) => submissionDataQuery(dbPath, "SELECT layout_snapshot FROM filings WHERE id = ?", [id]).rows[0].layout_snapshot;
const revision = (dbPath) => Number(submissionDataQuery(dbPath, "SELECT value FROM db_meta WHERE key = 'revision'").rows[0].value);
const render = (dbPath, id) => submissionFormsRender(dbPath, id, CLIENT, "mockup");
const fileNames = (result) => result.documents.map((doc) => doc.file_name);
const code = (expected, message) => (err) => {
  assert.equal(err.code, expected, err.message);
  if (message) assert.match(err.message, message);
  return true;
};

test("removing Written Arguments from a drafting Writing keeps the rest of its layout, archives the file, and leaves the other Writing alone", async (t) => {
  const dbPath = await board(t);
  const first = render(dbPath, 1);
  assert.ok(fileNames(first).includes(WA));
  const dir = dirname(first.documents[0].path);
  const before = JSON.parse(snapshotOf(dbPath, 1));
  const other = snapshotOf(dbPath, 2);
  const rev = revision(dbPath);

  const result = await callTool({}, TOOL, { db_path: dbPath, filing_id: 1, remove_companion: "written-arguments" });
  assert.deepEqual(result, { filing_id: 1, needs_forum_parts: 1, type_file: "requisition-consent", revision: rev + 1 });
  const { companions, ...layoutRest } = before.layout;
  assert.deepEqual(companions, ["written-arguments"]);
  assert.deepEqual(JSON.parse(snapshotOf(dbPath, 1)), { ...before, layout: layoutRest });
  assert.equal(snapshotOf(dbPath, 2), other);

  const second = render(dbPath, 1);
  assert.equal(fileNames(second).includes(WA), false);
  assert.equal(existsSync(join(dir, WA)), false);
  assert.equal(readdirSync(join(dir, "archive")).filter((name) => name.startsWith("Written Arguments @rev")).length, 1);
  assert.ok(fileNames(render(dbPath, 2)).includes(WA), "the other Writing still renders its own");

  await assert.rejects(callTool({}, TOOL, { db_path: dbPath, filing_id: 1, remove_companion: "written-arguments" }), code("companion_absent", /has no written-arguments to remove/));
});

for (const [state, dates, said] of [
  ["sent", { filed_on: "2026-11-01" }, /was sent on 2026-11-01/],
  ["retired", { retired_on: "2026-11-02" }, /was retired on 2026-11-02/],
]) {
  test(`a ${state} Writing refuses, and its stored layout and the revision are untouched`, async (t) => {
    const dbPath = await board(t, dates);
    const before = snapshotOf(dbPath, 1);
    const rev = revision(dbPath);
    await assert.rejects(callTool({}, TOOL, { db_path: dbPath, filing_id: 1, remove_companion: "written-arguments" }), code("writing_not_drafting", said));
    assert.equal(snapshotOf(dbPath, 1), before);
    assert.equal(revision(dbPath), rev);
  });
}
