// A database held below schema v82 has no `arguments` or `argument_rebuts` table, only `submissions`
// (issue #312). Its renders and its Arguments view page read those rows as our own arguments, as
// `argumentsTable` does, and find no opposing argument, instead of failing on the missing table.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fetchOpposingArguments } from "../build/submission/forms/opposing-points.js";
import { buildArgumentsData } from "../build/submission/forms/arguments-page.js";
import { seedSql, submissionDbAt } from "./helpers/template-db.mjs";

const dir = mkdtempSync(join(tmpdir(), "coclerk-opposing-held-"));
after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));

/** A drafting database migrated to v42 by the engine, holding one deployed submission. */
function heldDb(name) {
  const dbPath = join(dir, name);
  submissionDbAt(dbPath, 42);
  seedSql(dbPath, `
INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L9999 - Held', 'CAN/BC/Vancouver-International-Arbitration-Centre');
INSERT INTO filings (id, proceeding_id, kind, round, title) VALUES (1, 1, 'submissions_package', 'opening', 'An invented writing');
INSERT INTO submissions (id, proceeding_id, contention, ordinal) VALUES (1, 1, 'An invented contention.', 1);
INSERT INTO filing_submissions (filing_id, submission_id, document, ordinal) VALUES (1, 1, 'form', 1);
`);
  return dbPath;
}

test("a database with submissions but no arguments table has no opposing arguments", () => {
  const dbPath = heldDb("opposing.db");
  let points;
  assert.doesNotThrow(() => { points = fetchOpposingArguments(dbPath, 1); });
  assert.deepEqual(points, []);
});

test("the Arguments page of a database with no arguments table lists its submission as one of ours", () => {
  const dbPath = heldDb("page.db");
  let data;
  assert.doesNotThrow(() => { data = buildArgumentsData(dbPath, { id: 1, proceeding_id: 1 }); });
  assert.deepEqual(data.arguments.map((a) => [a.id, a.side]), [[1, "ours"]]);
  assert.deepEqual(data.rebuttals, []);
});
