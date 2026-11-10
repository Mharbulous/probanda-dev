// A letter to the client is a structured Writing (ADR 0019): drafting_data__create_writing with
// recipient `client` resolves /draft's shipped letter-to-client type, and its stored layout carries
// the letterhead and the type's privilege marker, which publish-general passes to the renderer. A
// matter with no drafting records yet gets them at session entry, so the first client letter on a new
// matter can be created there.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

import { startFakeCloud } from "./helpers/fake-cloud.mjs";

// open_session starts the background render job: its locks stay out of the practitioner's %LOCALAPPDATA%.
process.env.COCLERK_SUBMISSION_LOCK_ROOT = mkdtempSync(join(tmpdir(), "coclerk-client-letter-locks-"));
after(() => rmSync(process.env.COCLERK_SUBMISSION_LOCK_ROOT, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));

const { callTool, createDispatchContext } = await import("../build/index.js");
const { awaitBackgroundJobs } = await import("../build/submission/render-job.js");
const { freshSubmissionDb } = await import("./helpers/template-db.mjs");
const { submissionDataExecute, submissionDataQuery } = await import("../build/submission/backend.js");
const { withMarker } = await import("../build/submission/publish-tools.js");
const { closePageServer } = await import("../build/housekeeping/server.js");
after(() => closePageServer());

const TREE = { country: "CAN", jurisdiction: "BC", venue: "_NoVenue" };
const MARKER = "SOLICITOR CLIENT PRIVILEGED";

/** APPDATA pointing at a case data root with an empty firm overlay, so create_writing reads /draft's shipped tree. */
function shippedTree(t) {
  const scratch = mkdtempSync(join(tmpdir(), "coclerk-client-letter-"));
  const saved = process.env.APPDATA;
  t.after(() => {
    if (saved === undefined) delete process.env.APPDATA;
    else process.env.APPDATA = saved;
    rmSync(scratch, { recursive: true, force: true });
  });
  mkdirSync(join(scratch, "case"));
  mkdirSync(join(scratch, "Coclerk"));
  writeFileSync(join(scratch, "Coclerk", "coclerk.json"), JSON.stringify({ case_data_root: join(scratch, "case") }));
  process.env.APPDATA = scratch;
  return scratch;
}

const createClientLetter = (context, dbPath, proceeding_id) =>
  callTool(context, "drafting_data__create_writing", { db_path: dbPath, proceeding_id, tree: TREE, kind: "client letter", recipient: "client", title: "Letter to client" });

function storedLayout(dbPath, filingId) {
  const [row] = submissionDataQuery(dbPath, "SELECT needs_forum_parts, layout_snapshot FROM filings WHERE id = ?", [filingId]).rows;
  return { needsForumParts: row.needs_forum_parts, snapshot: JSON.parse(row.layout_snapshot) };
}

test("a client-recipient Writing snapshots the letter-to-client type, its letterhead and its marker", async (t) => {
  const scratch = shippedTree(t);
  const dbPath = join(scratch, "submission.sqlite");
  await freshSubmissionDb(dbPath);
  await submissionDataExecute(dbPath, "INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L0000', NULL), (2, 'L0000', 'CAN/BC/BCSC');");
  for (const proceeding_id of [1, 2]) {
    const created = await createClientLetter({}, dbPath, proceeding_id);
    assert.equal(typeof created.filing_id, "number");
    const { needsForumParts, snapshot } = storedLayout(dbPath, created.filing_id);
    assert.equal(needsForumParts, 0);
    assert.equal(snapshot.type_file, "draft/CAN/BC/_NoVenue/Documents/letter-to-client.md");
    assert.equal(snapshot.layout.renderer, "general");
    assert.equal(snapshot.layout.letterhead, true);
    assert.equal(snapshot.layout.marker, MARKER);
  }
});

test("a client recipient is refused for a kind whose recipient is someone else", async (t) => {
  const scratch = shippedTree(t);
  const dbPath = join(scratch, "submission.sqlite");
  await freshSubmissionDb(dbPath);
  await submissionDataExecute(dbPath, "INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L0000', NULL);");
  await assert.rejects(
    callTool({}, "drafting_data__create_writing", { db_path: dbPath, proceeding_id: 1, tree: TREE, kind: "letter-to-non-party", recipient: "client", title: "Letter" }),
    /whose recipient is non-party, but recipient client was passed/
  );
});

test("publish-general's letter payload takes its marker from the stored layout, never from the caller", () => {
  const letter = { date: "2026-11-09", body: ["Text."], marker: "CALLER'S OWN" };
  assert.deepEqual(withMarker(letter, { letterhead: true, marker: MARKER }), { date: "2026-11-09", body: ["Text."], marker: MARKER });
  assert.deepEqual(withMarker(letter, { letterhead: true }), { date: "2026-11-09", body: ["Text."] }, "a type with no marker prints none");
  assert.deepEqual(withMarker(letter, { letterhead: false, marker: MARKER }), { date: "2026-11-09", body: ["Text."] }, "no letterhead, no marker");
  assert.equal(letter.marker, "CALLER'S OWN", "the caller's object is not changed");
});

test("a new matter with no drafting records: session entry sets them up and a client letter can be created", async (t) => {
  shippedTree(t);
  const base = mkdtempSync(join(tmpdir(), "coclerk-client-letter-matter-"));
  t.after(async () => {
    await awaitBackgroundJobs();
    rmSync(base, { recursive: true, force: true });
  });
  const matterRoot = join(base, "L9999 Test Matter");
  mkdirSync(matterRoot, { recursive: true });
  mkdirSync(join(base, "0. CASE DATA"));
  writeFileSync(
    join(matterRoot, "coclerk.json"),
    JSON.stringify({ schema_version: 5, matter_root: matterRoot, case_data_dir: "0. CASE DATA", evidence_sql_path: "4. LAWYER BRIEF\\CoWork\\evidence.sql" }, null, 2),
    "utf-8"
  );
  const practicePath = join(tmpdir(), `coclerk-client-letter-practice-${randomUUID()}.db`);
  t.after(() => rmSync(practicePath, { recursive: true, force: true }));
  const context = await createDispatchContext({ ...process.env, ...(await startFakeCloud(t)).env, COCLERK_DB_PATH: practicePath });

  const entry = await callTool(context, "drafting_forms__open_session", { matter_root: matterRoot });
  assert.equal(entry.migrated.from, 0, "entry created the drafting database");
  assert.deepEqual(entry.filings, []);

  // new-matter-setup.md: before the forum is chosen, the proceeding is the matter reference alone.
  await callTool(context, "drafting_data__execute", { db_path: entry.db_path, sql_script: "INSERT INTO proceedings (matter_reference, forum) VALUES ('L9999 Test Matter', NULL);" });
  const [{ id }] = submissionDataQuery(entry.db_path, "SELECT id FROM proceedings").rows;
  const created = await createClientLetter(context, entry.db_path, id);
  const { snapshot } = storedLayout(entry.db_path, created.filing_id);
  assert.equal(snapshot.layout.letterhead, true);
  assert.equal(snapshot.layout.marker, MARKER);
});
