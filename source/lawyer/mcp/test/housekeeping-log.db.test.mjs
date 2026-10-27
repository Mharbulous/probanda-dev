// matter_data__housekeeping_log end to end (/matter-data operations/housekeeping-log.md modes record and retry,
// design-decisions.md #75): the tool runs the operation's own fenced statements, each entry's values bound,
// in one transaction through matter_data__execute's path, against real case data built from the canonical
// schema. Every name is invented.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { callTool } = await import("../build/dispatch.js");
const { buildToolDefinitions } = await import("../build/schema-gen.js");
const { writeCaseDataStores } = await import("./helpers/matter-data-fixture.mjs");

const TOOL = "matter_data__housekeeping_log";
const H1 = "1".repeat(64);
const H2 = "2".repeat(64);
const H3 = "3".repeat(64);

function matterFixture(t, seed = "") {
  const base = mkdtempSync(join(tmpdir(), "coclerk-housekeeping-log-"));
  t.after(() => rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
  process.env.COCLERK_CASE_LOCK_ROOT = join(base, "locks");
  const matterRoot = join(base, "T9999 Scratch Matter");
  const caseDataDir = join(base, "0. CASE DATA", "T9999 Scratch Matter");
  mkdirSync(matterRoot, { recursive: true });
  mkdirSync(caseDataDir, { recursive: true });
  writeFileSync(
    join(matterRoot, "coclerk.json"),
    JSON.stringify({ schema_version: 5, matter_root: matterRoot, case_data_dir: caseDataDir, evidence_sql_path: "4. LAWYER BRIEF\\CoWork\\evidence.sql" }),
    "utf-8"
  );
  writeCaseDataStores(caseDataDir, seed);
  return { matterRoot, caseDataDir };
}

function reviews(caseDataDir) {
  const res = spawnSync(
    process.env.COCLERK_PYTHON || "python",
    [
      "-c",
      "import json,sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.row_factory=sqlite3.Row; " +
        "print(json.dumps([dict(r) for r in c.execute('SELECT file_hash, file_name, folder_type, outcome, reason, failure_class, retry_next_run FROM housekeeping_reviews ORDER BY file_hash, file_name')]))",
      join(caseDataDir, "main.sqlite"),
    ],
    { encoding: "utf-8" }
  );
  if (res.status !== 0) throw new Error(res.stderr);
  return JSON.parse(res.stdout);
}

const log = (matterRoot, args) => callTool({}, TOOL, { matter_root: matterRoot, ...args });

test("the tool writes, and takes a mode of record or retry", () => {
  const def = buildToolDefinitions().find((d) => d.name === TOOL);
  assert.ok(def, `${TOOL} is defined`);
  assert.deepEqual(def.annotations, { destructiveHint: true, openWorldHint: false });
  assert.deepEqual(def.inputSchema.required, ["matter_root", "mode"]);
  assert.deepEqual(def.inputSchema.properties.mode.enum, ["record", "retry"]);
  assert.match(def.description, /operations\/housekeeping-log\.md/);
});

test("record writes settled verdicts and ingest failures in one call, by the retry counting rule", async (t) => {
  const { matterRoot, caseDataDir } = matterFixture(t);
  const out = await log(matterRoot, {
    mode: "record",
    entries: [
      { file_name: "2026-01-05 LTR Smith re costs.pdf", file_hash: H1, folder_type: "Correspondence", outcome: "renamed" },
      { file_name: "scan.pdf", file_hash: H2, folder_type: null, outcome: "ingest_failed", reason: "The reader returned malformed output.", failure_class: "extractor" },
      { file_name: "old.doc", file_hash: H3, folder_type: "Law", outcome: "ingest_failed", reason: "A binary Word file cannot be read.", failure_class: "deterministic" },
    ],
  });
  assert.equal(out.ok, true);
  assert.equal(out.recorded, 3);
  assert.deepEqual(reviews(caseDataDir), [
    { file_hash: H1, file_name: "2026-01-05 LTR Smith re costs.pdf", folder_type: "Correspondence", outcome: "renamed", reason: null, failure_class: null, retry_next_run: null },
    { file_hash: H2, file_name: "scan.pdf", folder_type: null, outcome: "ingest_failed", reason: "The reader returned malformed output.", failure_class: "extractor", retry_next_run: 1 },
    { file_hash: H3, file_name: "old.doc", folder_type: "Law", outcome: "ingest_failed", reason: "A binary Word file cannot be read.", failure_class: "deterministic", retry_next_run: 0 },
  ]);

  // A later failure of the same bytes is never retried automatically, and a later verdict overwrites.
  await log(matterRoot, {
    mode: "record",
    entries: [{ file_name: "scan.pdf", file_hash: H2, folder_type: null, outcome: "ingest_failed", reason: "Again.", failure_class: "extractor" }],
  });
  assert.equal(reviews(caseDataDir)[1].retry_next_run, 0);
});

test("retry sets the next run's attempt on failed files and names a hash with no failure", async (t) => {
  const { matterRoot, caseDataDir } = matterFixture(t);
  await log(matterRoot, {
    mode: "record",
    entries: [{ file_name: "old.doc", file_hash: H3, folder_type: "Law", outcome: "ingest_failed", reason: "Unreadable.", failure_class: "deterministic" }],
  });
  const out = await log(matterRoot, { mode: "retry", hashes: [H3, H1] });
  assert.equal(out.ok, true);
  assert.equal(out.updated, 1);
  assert.deepEqual(out.unmatched, [H1]);
  assert.equal(reviews(caseDataDir)[0].retry_next_run, 1);
});

test("an entry that breaks the operation's input is refused and nothing is written", async (t) => {
  const { matterRoot, caseDataDir } = matterFixture(t);
  const out = await log(matterRoot, {
    mode: "record",
    entries: [
      { file_name: "a.pdf", file_hash: H1, folder_type: "Correspondence", outcome: "renamed" },
      { file_name: "b.pdf", file_hash: H2, folder_type: "Correspondence", outcome: "declined" },
      { file_name: "c.pdf", file_hash: H3, folder_type: null, outcome: "ingest_failed", reason: "x", failure_class: "reader" },
    ],
  });
  assert.equal(out.ok, false);
  assert.equal(out.problems.length, 2);
  assert.match(out.problems[0], /entries\[1\].*outcome/);
  assert.match(out.problems[1], /entries\[2\].*failure_class/);
  assert.deepEqual(reviews(caseDataDir), []);
});
