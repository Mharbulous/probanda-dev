// Written Arguments is no default companion (docs/Specs/2026-11-05_written-arguments-not-a-default-
// companion-spec.md): a Writing created on any of the four BCSC types stores a layout naming no
// companion, so its render writes no Written Arguments file and raises no 🧵 for what its form deploys;
// a Writing whose stored layout names Written Arguments still renders it.

import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { seedApplicationResponse, seedBcscConsentOrder, seedBcscDefaultJudgment, seededDbFixture } from "./fixtures/forms-render-seeds.mjs";

const { freshSubmissionDb } = await import("./helpers/template-db.mjs");
const { submissionDataWrite } = await import("../build/submission/backend.js");
const { submissionFormsRender } = await import("../build/submission/forms.js");
const { composeLayoutSnapshot } = await import("../build/submission/writing-snapshot.js");

const CLIENT = { clientName: "Ada Client", clientNo: "0001", matterNo: "L0000" };
const WA = "Written Arguments.md";

/** Each type, and a seed that leaves filing 1 a Writing of it storing Written Arguments. */
const KINDS = {
  notice_of_application: async (dbPath) => {
    await seedBcscDefaultJudgment(dbPath);
    await submissionDataWrite(dbPath, "UPDATE filings SET kind = 'notice_of_application', subkind = NULL WHERE id = 1");
    await submissionDataWrite(dbPath, "INSERT INTO hearing_details (filing_id, associate_judge) VALUES (1, 1)");
  },
  application_response: seedApplicationResponse,
  requisition_consent: seedBcscConsentOrder,
  requisition_default_judgment: seedBcscDefaultJudgment,
};

const composed = (kind) => composeLayoutSnapshot({ country: "CAN", jurisdiction: "BC", venue: "BCSC", kind }).layout_snapshot;

/** A seeded database, with APPDATA pointing at a case data root whose firm overlay is empty. */
async function seeded(t, seed) {
  const f = seededDbFixture();
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
  await seed(f.dbPath);
  return f.dbPath;
}

const render = (dbPath) => submissionFormsRender(dbPath, 1, CLIENT, "mockup");
const fileNames = (result) => result.documents.map((doc) => doc.file_name);

for (const [kind, seed] of Object.entries(KINDS)) {
  test(`a new ${kind} Writing stores no companion and renders no Written Arguments`, async (t) => {
    const dbPath = await seeded(t, seed);
    const stored = composed(kind);
    assert.equal(Object.hasOwn(JSON.parse(stored).layout, "companions"), false);
    await submissionDataWrite(dbPath, "UPDATE filings SET layout_snapshot = ? WHERE id = 1", [stored]);
    const result = render(dbPath);
    assert.equal(fileNames(result).includes(WA), false, fileNames(result).join(", "));
    // The Work Board is HTML and carries no markdown; the Writing's own documents do.
    for (const doc of result.documents.filter((d) => d.markdown !== undefined)) assert.doesNotMatch(doc.markdown, /🧵/, doc.file_name);
  });

  test(`a ${kind} Writing whose stored layout names Written Arguments still renders it`, async (t) => {
    const dbPath = await seeded(t, seed);
    assert.ok(fileNames(render(dbPath)).includes(WA));
  });
}

test("on a Writing with Written Arguments, 🧵 still marks what the form deploys and they never argue", async (t) => {
  const dbPath = await seeded(t, seedApplicationResponse);
  const form = render(dbPath).documents[0];
  assert.match(form.markdown, /🧵/, form.file_name);
});
