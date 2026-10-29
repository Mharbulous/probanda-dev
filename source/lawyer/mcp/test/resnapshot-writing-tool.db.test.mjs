// drafting_data__resnapshot_writing (plan Phase 20): the dedicated re-snapshot write, reached
// through the dispatch path as /draft reaches it, against /draft's shipped tree with an empty firm
// overlay. A drafting Writing re-snapshots and moves the revision, a forum-less one under the
// jurisdiction the caller passes; a sent Writing is refused and its stored layout is untouched.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { freshSubmissionDb, seedSql } = await import("./helpers/template-db.mjs");
const { submissionDataQuery } = await import("../build/submission/backend.js");
const { composeLayoutSnapshot } = await import("../build/submission/writing-snapshot.js");
const { callTool } = await import("../build/dispatch.js");

const TOOL = "drafting_data__resnapshot_writing";

/** A seeded database, with APPDATA pointing at a case data root whose firm overlay is empty. */
async function db(t, seed) {
  const scratch = mkdtempSync(join(tmpdir(), "coclerk-resnapshot-tool-"));
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
  const dbPath = join(scratch, "submission.sqlite");
  await freshSubmissionDb(dbPath);
  seedSql(dbPath, seed);
  return dbPath;
}

const revision = (dbPath) => Number(submissionDataQuery(dbPath, "SELECT value FROM db_meta WHERE key = 'revision'").rows[0].value);
const snapshot = (dbPath) => submissionDataQuery(dbPath, "SELECT layout_snapshot FROM filings WHERE id = 1").rows[0].layout_snapshot;
const code = (expected, message) => (err) => {
  assert.equal(err.code, expected, err.message);
  if (message) assert.match(err.message, message);
  return true;
};

test("a drafting Writing re-snapshots through the tool and moves the revision", async (t) => {
  const dbPath = await db(
    t,
    "INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L0000', 'CAN/BC/BCSC');" +
      "INSERT INTO filings (id, proceeding_id, kind, title) VALUES (1, 1, 'notice_of_application', 'A');"
  );
  const before = revision(dbPath);
  assert.deepEqual(await callTool({}, TOOL, { db_path: dbPath, filing_id: 1 }), {
    filing_id: 1,
    needs_forum_parts: 1,
    type_file: "notice-of-application",
    revision: before + 1,
  });
  assert.equal(snapshot(dbPath), composeLayoutSnapshot({ country: "CAN", jurisdiction: "BC", venue: "BCSC", kind: "notice_of_application" }).layout_snapshot);
});

test("a forum-less letter re-snapshots under the jurisdiction the caller passes, and without it is refused", async (t) => {
  const dbPath = await db(
    t,
    "INSERT INTO proceedings (id, matter_reference) VALUES (1, 'L0000');" +
      "INSERT INTO filings (id, proceeding_id, kind, title, needs_forum_parts) VALUES (1, 1, 'letter_to_opposing_counsel', 'L', 0);"
  );
  await assert.rejects(callTool({}, TOOL, { db_path: dbPath, filing_id: 1 }), code("jurisdiction_required"));
  const result = await callTool({}, TOOL, { db_path: dbPath, filing_id: 1, jurisdiction: { country: "CAN", jurisdiction: "BC" } });
  assert.deepEqual([result.needs_forum_parts, result.type_file], [0, "letter-to-opposing-counsel"]);
  assert.equal(JSON.parse(snapshot(dbPath)).type_file, "draft/CAN/BC/_NoVenue/Documents/letter-to-opposing-counsel.md");
});

test("a sent Writing is refused and its stored layout is untouched", async (t) => {
  const dbPath = await db(
    t,
    "INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L0000', 'CAN/BC/BCSC');" +
      "INSERT INTO filings (id, proceeding_id, kind, title, filed_on) VALUES (1, 1, 'notice_of_application', 'A', '2026-09-24');"
  );
  const before = revision(dbPath);
  await assert.rejects(callTool({}, TOOL, { db_path: dbPath, filing_id: 1 }), code("writing_not_drafting", /was sent on 2026-09-24/));
  assert.equal(snapshot(dbPath), null);
  assert.equal(revision(dbPath), before);
});
