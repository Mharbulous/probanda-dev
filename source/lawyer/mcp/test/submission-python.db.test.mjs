// Issue #517: bootstrap on a two-filing matter started ~123 host Python processes and ran past
// the Cowork bridge's 60s limit, and no Python call had a timeout. These pin the process budget
// and the named timeout on every drafting-data Python path.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

const { submissionDataExecute, submissionDataQuery } = await import("../build/submission/backend.js");
const { pythonStarts } = await import("../build/python-spawn.js");
const { withTempDir } = await import("./helpers/temp-dir.mjs");
const { currentSchemaVersion, submissionDataMigrate } = await import("../build/submission/migrate.js");
const { submissionFormsBootstrap } = await import("../build/submission/forms.js");
const { resolveRepoRoot } = await import("../build/repo-root.js");

const TIMEOUT_VAR = "COCLERK_SUBMISSION_PYTHON_TIMEOUT_MS";

async function migratedDb() {
  const dir = mkdtempSync(join(tmpdir(), "coclerk-submission-python-"));
  const dbPath = join(dir, "submission.sqlite");
  await submissionDataMigrate(dbPath);
  return { dbPath, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

async function withTimeoutOverride(ms, fn) {
  process.env[TIMEOUT_VAR] = String(ms);
  try {
    return await fn();
  } finally {
    delete process.env[TIMEOUT_VAR];
  }
}

function isPythonTimeout(err) {
  assert.equal(err.name, "PythonTimeoutError");
  assert.equal(err.code, "python_timeout");
  assert.match(err.message, /did not (answer a query|finish) within 1ms and was killed/);
  return true;
}

// Runs first, so the query sidecar has not started yet and its start is counted.
test("bootstrap on a two-filing matter starts a bounded number of Python processes", async () => {
  const f = await migratedDb();
  try {
    await submissionDataExecute(
      f.dbPath,
      `
      INSERT INTO proceedings (id, matter_reference, forum, court_or_centre, registry, file_number, style_of_cause, courthouse_address)
        VALUES (1, 'L8470 - Larchmont', 'CAN/BC/BCSC', 'BC Supreme Court', 'Vancouver', 'S-290002', 'Larchmont v. Example', NULL);
      INSERT INTO parties (id, proceeding_id, name, role, ordinal, is_client, is_applicant, to_be_served)
        VALUES
          (1, 1, 'Larchmont (B.C.) Inc.', 'Plaintiff', 1, 1, 1, 0),
          (2, 1, 'Example Defendant Ltd.', 'Defendant', 2, 0, 0, 1);
      INSERT INTO order_sought (id, proceeding_id, wording)
        VALUES (1, 1, 'the style of cause is corrected as set out above'), (2, 1, 'the time for service is extended');
      INSERT INTO filings (id, proceeding_id, kind, subkind, round, title)
        VALUES (1, 1, 'requisition_consent', 'consent', NULL, 'Consent Order Requisition'),
               (2, 1, 'requisition_consent', 'consent', NULL, 'Second Consent Order Requisition');
      INSERT INTO filing_orders (filing_id, order_sought_id, document, ordinal) VALUES (1, 1, 'form', 1), (2, 2, 'form', 1);

      -- Revision reset LAST: schema v21 triggers move db_meta.revision on every seeded row (#607).
      UPDATE db_meta SET value = '1' WHERE key = 'revision';
      `.trim()
    );

    const before = pythonStarts.count;
    const result = submissionFormsBootstrap(f.dbPath);
    const started = pythonStarts.count - before;

    assert.equal(result.filings.length, 2);
    // #584: bootstrap renders nothing, so neither filing has a mockup on disk yet.
    assert.ok(result.filings.every((filing) => filing.paths.length === 0), "expected no filing rendered");
    assert.ok(result.filings.every((filing) => filing.render_state === "never"), "expected both filings to report never");
    // One query sidecar plus one schema-version driver. The per-render drivers are gone with the
    // renders (#584); a process per query would still be dozens.
    assert.ok(started <= 2, `expected at most 2 Python processes, got ${started}`);
  } finally {
    f.cleanup();
  }
});

test("a query that outlives its budget fails with a named timeout, and the next query recovers", async () => {
  const f = await migratedDb();
  try {
    // A warm sidecar can answer a trivial query inside 1ms, so the query itself must take real time.
    const slow = "WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c WHERE x < 5000000) SELECT count(*) AS n FROM c";
    await withTimeoutOverride(1, () => assert.throws(() => submissionDataQuery(f.dbPath, slow), isPythonTimeout));
    assert.deepEqual(submissionDataQuery(f.dbPath, "SELECT 1 AS ok").rows, [{ ok: 1 }]);
  } finally {
    f.cleanup();
  }
});

test("an execute that outlives its budget fails with a named timeout", async () => {
  const f = await migratedDb();
  try {
    await withTimeoutOverride(1, () =>
      assert.rejects(() => submissionDataExecute(f.dbPath, "UPDATE db_meta SET value = '7' WHERE key = 'revision';"), isPythonTimeout)
    );
  } finally {
    f.cleanup();
  }
});

// #604: the UPDATE runs first and the CTE never finishes in budget, so the kill lands inside Python before COMMIT.
// Not covered: a kill after the rename that replaces db_path, and a Cowork bridge that gives
// up at 60s while WRITE_TIMEOUT_MS runs on. Both tell the caller "failed" after a change, hence the re-read rule.
test("an execute killed mid-script leaves the database untouched", async () => {
  const f = await migratedDb();
  const never = "WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c WHERE x < 1000000000) SELECT count(*) FROM c;";
  try {
    await withTimeoutOverride(3000, () =>
      withTempDir(dirname(f.dbPath), () =>
        assert.rejects(
          () => submissionDataExecute(f.dbPath, `UPDATE db_meta SET value = '7' WHERE key = 'revision';\n${never}`),
          { name: "PythonTimeoutError" }
        )
      )
    );
    assert.deepEqual(submissionDataQuery(f.dbPath, "SELECT value FROM db_meta WHERE key = 'revision'").rows, [{ value: "0" }]);
    // #703: the killed helper's staging copy does not outlive it.
    assert.deepEqual(readdirSync(dirname(f.dbPath)).filter((name) => name.startsWith("coclerk_")), []);
  } finally {
    f.cleanup();
  }
});

test("an execute replaces the live file and leaves no staged sibling beside it", async () => {
  const f = await migratedDb();
  try {
    await submissionDataExecute(f.dbPath, "UPDATE db_meta SET value = '7' WHERE key = 'revision';");
    assert.deepEqual(submissionDataQuery(f.dbPath, "SELECT value FROM db_meta WHERE key = 'revision'").rows, [{ value: "7" }]);
    assert.deepEqual(readdirSync(dirname(f.dbPath)).filter((name) => name.startsWith("coclerk_")), []);
  } finally {
    f.cleanup();
  }
});

test("the schema-version driver fails with a named timeout when it outlives its budget", () => {
  assert.throws(() => currentSchemaVersion({ ...process.env, [TIMEOUT_VAR]: "1" }), isPythonTimeout);
});

// #580: bootstrap spent 3.7 s + ~2 s per filing re-asking Python the same number.
test("the schema version is read once while the engine file is unchanged", () => {
  const first = currentSchemaVersion();
  const before = pythonStarts.count;
  assert.equal(currentSchemaVersion(), first);
  assert.equal(pythonStarts.count - before, 0);
});

test("a schema bump in the engine file is read on the next call", () => {
  const root = mkdtempSync(join(tmpdir(), "coclerk-schema-version-"));
  const rel = join(".claude", "skills", "drafting-data", "references", "scripts");
  const engine = join(root, rel, "migrate_engine.py");
  try {
    mkdirSync(join(root, rel), { recursive: true });
    const repoRoot = resolveRepoRoot(process.env, { code: "repo_root_missing", subject: "the drafting-data scripts" });
    const source = readFileSync(join(repoRoot, rel, "migrate_engine.py"), "utf-8");
    const env = { ...process.env, COCLERK_REPO_ROOT: root };
    writeFileSync(engine, source);
    const current = currentSchemaVersion(env);
    writeFileSync(engine, source.replace(/^TARGET_SCHEMA_VERSION = \d+/m, `TARGET_SCHEMA_VERSION = ${current + 1000}`));
    assert.equal(currentSchemaVersion(env), current + 1000);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
