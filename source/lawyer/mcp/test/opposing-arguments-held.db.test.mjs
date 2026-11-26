// A database held below schema v82 has no `arguments` or `argument_rebuts` table, only `submissions`
// (issue #312). Its renders and its Arguments view page read those rows as our own arguments, as
// `argumentsTable` does, and find no opposing argument, instead of failing on the missing table.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fetchOpposingArguments } from "../build/submission/forms/opposing-points.js";
import { buildArgumentsData } from "../build/submission/forms/arguments-page.js";

const dir = mkdtempSync(join(tmpdir(), "coclerk-opposing-held-"));
after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));

function heldDb(name) {
  const dbPath = join(dir, name);
  const py = process.env.COCLERK_PYTHON || "python";
  execFileSync(py, ["-c", [
    "import sqlite3, sys",
    "con = sqlite3.connect(sys.argv[1])",
    "con.executescript('''",
    "CREATE TABLE filings (id INTEGER PRIMARY KEY, proceeding_id INTEGER, title TEXT, retired_on TEXT);",
    "CREATE TABLE submissions (id INTEGER PRIMARY KEY, proceeding_id INTEGER, contention TEXT, ordinal INTEGER, killed_on TEXT);",
    "CREATE TABLE filing_submissions (filing_id INTEGER, submission_id INTEGER);",
    "CREATE TABLE facts (id INTEGER PRIMARY KEY, proceeding_id INTEGER, postulate TEXT);",
    "CREATE TABLE submission_facts (submission_id INTEGER, fact_id INTEGER);",
    "CREATE TABLE law_assertions (id INTEGER PRIMARY KEY, proceeding_id INTEGER, proposition TEXT);",
    "CREATE TABLE submission_law (submission_id INTEGER, law_assertion_id INTEGER);",
    "INSERT INTO filings VALUES (1, 1, 'An invented writing', NULL);",
    "INSERT INTO submissions VALUES (1, 1, 'An invented contention.', 1, NULL);",
    "INSERT INTO filing_submissions VALUES (1, 1);",
    "''')",
    "con.commit()",
  ].join("\n"), dbPath]);
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
