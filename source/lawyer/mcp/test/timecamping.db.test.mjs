import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { resolveTimecampingDbPath, timecampingDataQuery, timecampingDataExecute, timecampingDataBulkUpsert } =
  await import("../build/timecamping/backend.js");
const { timecampingDataMigrate } = await import("../build/timecamping/migrate.js");
const { timecampingDataMigrateScriptsDir } = await import("../build/repo-root.js");

function fixture(t) {
  const scratch = mkdtempSync(join(tmpdir(), "coclerk-timecamping-"));
  t.after(() => rmSync(scratch, { recursive: true, force: true }));
  const appData = join(scratch, "appdata");
  const configDir = join(appData, "Coclerk");
  mkdirSync(configDir, { recursive: true });
  const root = join(scratch, "0. CASE DATA");
  // _practice already exists in any real deployment (practice.db/time_pipeline.db
  // already live there) -- migrate_engine.py, like drafting-data's, does not
  // create its database's parent directory itself.
  mkdirSync(join(root, "_practice"), { recursive: true });
  writeFileSync(join(configDir, "coclerk.json"), JSON.stringify({ case_data_root: root }));
  return { env: { ...process.env, APPDATA: appData }, root };
}

test("resolveTimecampingDbPath sits alongside practice.db under _practice, and COCLERK_TIMECAMPING_DB_PATH overrides it", (t) => {
  const f = fixture(t);
  assert.equal(
    resolveTimecampingDbPath(f.env),
    join(f.root, "_practice", "timecamping.db"),
  );
  assert.equal(
    resolveTimecampingDbPath({ ...f.env, COCLERK_TIMECAMPING_DB_PATH: "X:\\test\\tc.db" }),
    "X:\\test\\tc.db",
  );
});

test("query against a missing database fails clearly, telling the caller to migrate first", async (t) => {
  const f = fixture(t);
  await assert.rejects(
    async () => timecampingDataQuery("SELECT 1", undefined, f.env),
    /No timecamping database found.*migrate/
  );
});

test("migrate creates the database fresh at schema_version 6 with the 12 tables", async (t) => {
  const f = fixture(t);
  const result = await timecampingDataMigrate(f.env);
  assert.deepEqual(result.applied, [
    { from: 0, to: 1 }, { from: 1, to: 2 }, { from: 2, to: 3 }, { from: 3, to: 4 }, { from: 4, to: 5 }, { from: 5, to: 6 },
  ]);
  assert.equal(result.schema_version, 6);

  const tables = timecampingDataQuery(
    "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    undefined,
    f.env
  );
  assert.deepEqual(
    tables.rows.map((r) => r.name),
    [
      "db_meta",
      "determinations",
      "gcal_events",
      "icloud_events",
      "presumptions",
      "proposals",
      "sent_mail",
      "source_fetch_log",
      "syncopaid_captures",
      "telus_calls",
      "timecamp_computer_activities",
      "timecamp_time_entries",
    ]
  );
});

test("migrate is idempotent -- a second call against an already-current database applies nothing", async (t) => {
  const f = fixture(t);
  await timecampingDataMigrate(f.env);
  const second = await timecampingDataMigrate(f.env);
  assert.deepEqual(second.applied, []);
  assert.equal(second.schema_version, 6);
});

test("migrate 2 -> 3 rewrites every evidence_chain entry to a source_row_ids list, superseded proposals included", async (t) => {
  const f = fixture(t);
  // A real v2 database: the migration engine stopped at version 2.
  const res = spawnSync(
    process.env.COCLERK_PYTHON || "python",
    ["-c", "import sys, migrate_engine as m; m.migrate(sys.argv[1], 2)", resolveTimecampingDbPath(f.env)],
    { encoding: "utf-8", env: { ...f.env, PYTHONPATH: timecampingDataMigrateScriptsDir(f.env) } }
  );
  assert.equal(res.status, 0, res.stderr);

  const v2Chains = [
    [
      { source_table: "telus_calls", source_row_id: 7, role: "direct" },
      { source_table: "telus_calls", source_row_id: null, role: "standing_fact" },
      { source_table: "syncopaid_captures", source_row_id: 12, role: "corroborating", note: "kept" },
    ],
    [{ source_table: "timecamp_time_entries", source_row_id: 3, role: "indirect" }],
    [],
  ];
  const statuses = ["pending", "superseded", "pending"];
  const values = v2Chains
    .map(
      (chain, i) =>
        `('2026-08-27', '2026-08-27T16:00:00Z', '2026-08-27T16:10:00Z', 'Review file', '${JSON.stringify(chain)}', ` +
        `'${chain.length ? "direct_carries" : "empty"}', 0, '${statuses[i]}', '2026-08-28T00:00:00Z')`
    )
    .join(",\n");
  await timecampingDataExecute(
    `INSERT INTO proposals
       (local_date, start_ts, end_ts, proposed_description, evidence_chain, corroboration, needs_ceremony, status, proposed_at)
     VALUES ${values};`,
    f.env
  );

  const result = await timecampingDataMigrate(f.env);
  assert.deepEqual(result.applied, [{ from: 2, to: 3 }, { from: 3, to: 4 }, { from: 4, to: 5 }, { from: 5, to: 6 }]);
  assert.equal(result.schema_version, 6);

  const rows = timecampingDataQuery("SELECT status, evidence_chain FROM proposals ORDER BY id", undefined, f.env).rows;
  assert.deepEqual(
    rows.map((r) => ({ status: r.status, chain: JSON.parse(r.evidence_chain) })),
    [
      {
        status: "pending",
        chain: [
          { source_table: "telus_calls", source_row_ids: [7], role: "direct" },
          { source_table: "telus_calls", source_row_ids: null, role: "standing_fact" },
          { source_table: "syncopaid_captures", source_row_ids: [12], role: "corroborating", note: "kept" },
        ],
      },
      { status: "superseded", chain: [{ source_table: "timecamp_time_entries", source_row_ids: [3], role: "indirect" }] },
      { status: "pending", chain: [] },
    ]
  );
});

test("migrate 3 -> 4 adds proposals.entered_by_hand_at, NULL on every existing proposal", async (t) => {
  const f = fixture(t);
  const res = spawnSync(
    process.env.COCLERK_PYTHON || "python",
    ["-c", "import sys, migrate_engine as m; m.migrate(sys.argv[1], 3)", resolveTimecampingDbPath(f.env)],
    { encoding: "utf-8", env: { ...f.env, PYTHONPATH: timecampingDataMigrateScriptsDir(f.env) } }
  );
  assert.equal(res.status, 0, res.stderr);
  await timecampingDataExecute(
    `INSERT INTO proposals
       (local_date, start_ts, end_ts, proposed_description, evidence_chain, corroboration, needs_ceremony, status, proposed_at)
     VALUES ('2026-08-27', '2026-08-27T16:00:00Z', '2026-08-27T16:10:00Z', 'Review file', '[]', 'empty', 0, 'pending', '2026-08-28T00:00:00Z');`,
    f.env
  );

  const result = await timecampingDataMigrate(f.env);
  assert.deepEqual(result.applied, [{ from: 3, to: 4 }, { from: 4, to: 5 }, { from: 5, to: 6 }]);
  assert.equal(result.schema_version, 6);
  const rows = timecampingDataQuery("SELECT status, written_back, entered_by_hand_at FROM proposals", undefined, f.env).rows;
  assert.deepEqual(rows, [{ status: "pending", written_back: 0, entered_by_hand_at: null }]);
});

test("migrate 4 -> 5 adds icloud_events and leaves a v4 database's rows intact", async (t) => {
  const f = fixture(t);
  const res = spawnSync(
    process.env.COCLERK_PYTHON || "python",
    ["-c", "import sys, migrate_engine as m; m.migrate(sys.argv[1], 4)", resolveTimecampingDbPath(f.env)],
    { encoding: "utf-8", env: { ...f.env, PYTHONPATH: timecampingDataMigrateScriptsDir(f.env) } }
  );
  assert.equal(res.status, 0, res.stderr);
  await timecampingDataExecute(
    `INSERT INTO source_fetch_log (source_name, local_date, status, row_count, fetched_at)
     VALUES ('gcal_events', '2026-09-01', 'empty', 0, '2026-09-02T00:00:00Z');`,
    f.env
  );

  const result = await timecampingDataMigrate(f.env);
  assert.deepEqual(result.applied, [{ from: 4, to: 5 }, { from: 5, to: 6 }]);
  assert.equal(result.schema_version, 6);
  const rows = timecampingDataQuery(
    `SELECT source_name, status FROM source_fetch_log
     UNION ALL SELECT 'icloud_events rows', COUNT(*) FROM icloud_events`,
    undefined,
    f.env
  ).rows;
  assert.deepEqual(rows, [
    { source_name: "gcal_events", status: "empty" },
    { source_name: "icloud_events rows", status: 0 },
  ]);
});

test("migrate 5 -> 6 adds sent_mail and leaves a v5 database's rows intact", async (t) => {
  const f = fixture(t);
  const res = spawnSync(
    process.env.COCLERK_PYTHON || "python",
    ["-c", "import sys, migrate_engine as m; m.migrate(sys.argv[1], 5)", resolveTimecampingDbPath(f.env)],
    { encoding: "utf-8", env: { ...f.env, PYTHONPATH: timecampingDataMigrateScriptsDir(f.env) } }
  );
  assert.equal(res.status, 0, res.stderr);
  await timecampingDataExecute(
    `INSERT INTO source_fetch_log (source_name, local_date, status, row_count, fetched_at)
     VALUES ('icloud_events', '2026-09-01', 'empty', 0, '2026-09-02T00:00:00Z');
     INSERT INTO icloud_events
       (native_id, calendar, start_ts, end_ts, local_date, all_day, busy, title, uid, fetched_at)
     VALUES ('E1_2026-09-01', 'Work', '2026-09-01T17:00:00Z', '2026-09-01T17:30:00Z', '2026-09-01', 0, 1,
             'Call with Jesse', 'E1', '2026-09-02T00:00:00Z');`,
    f.env
  );

  const result = await timecampingDataMigrate(f.env);
  assert.deepEqual(result.applied, [{ from: 5, to: 6 }]);
  assert.equal(result.schema_version, 6);
  const rows = timecampingDataQuery(
    `SELECT source_name AS k, status AS v FROM source_fetch_log
     UNION ALL SELECT native_id, title FROM icloud_events
     UNION ALL SELECT 'sent_mail rows', COUNT(*) FROM sent_mail`,
    undefined,
    f.env
  ).rows;
  assert.deepEqual(rows, [
    { k: "icloud_events", v: "empty" },
    { k: "E1_2026-09-01", v: "Call with Jesse" },
    { k: "sent_mail rows", v: 0 },
  ]);
});

test("a successful migrate keeps only the copy taken before its first hop, never a labelled one", async (t) => {
  const f = fixture(t);
  const dbPath = resolveTimecampingDbPath(f.env);
  const res = spawnSync(
    process.env.COCLERK_PYTHON || "python",
    ["-c", "import sys, migrate_engine as m; m.migrate(sys.argv[1], 5)", dbPath],
    { encoding: "utf-8", env: { ...f.env, PYTHONPATH: timecampingDataMigrateScriptsDir(f.env) } }
  );
  assert.equal(res.status, 0, res.stderr);
  const dir = join(f.root, "_practice");
  for (const name of ["timecamping.db.bak-20260101T000000Z", "timecamping.db.pre-chrometa.bak"]) writeFileSync(join(dir, name), "");

  const result = await timecampingDataMigrate(f.env);

  assert.deepEqual(result.applied, [{ from: 5, to: 6 }]);
  assert.equal(result.warnings, undefined);
  const left = readdirSync(dir).filter((n) => n.startsWith("timecamping.db.")).sort();
  assert.equal(left.length, 2, `left: ${left}`);
  assert.ok(left.includes("timecamping.db.pre-chrometa.bak"));
  const kept = left.find((n) => /^timecamping\.db\.bak-\d{8}T\d{6}Z(-\d+)?$/.test(n));
  assert.notEqual(kept, "timecamping.db.bak-20260101T000000Z");
  const version = spawnSync(
    process.env.COCLERK_PYTHON || "python",
    ["-c", "import sqlite3, sys; print(sqlite3.connect(sys.argv[1]).execute(\"SELECT value FROM db_meta WHERE key = 'schema_version'\").fetchone()[0])", join(dir, kept)],
    { encoding: "utf-8" }
  );
  assert.equal(version.stdout.trim(), "5", "the kept copy is the pre-migration database");
});

test("manual completion: a confirmed uncovered proposal leaves the report and survives a re-run; an unconfirmed one stays pending", async (t) => {
  const f = fixture(t);
  await timecampingDataMigrate(f.env);
  // 1 = uncovered, never confirmed; 2 = uncovered, past Step 6, entered by hand; 3 = uncovered, still pending.
  await timecampingDataExecute(
    `INSERT INTO proposals
       (local_date, start_ts, end_ts, proposed_matter_ref, proposed_description, evidence_chain, rationale, corroboration, needs_ceremony, status, proposed_at)
     VALUES
       ('2026-09-01', '2026-09-01T17:00:00Z', '2026-09-01T17:20:00Z', 'L8212', 'Draft letter', '[{"source_table":"syncopaid_captures","source_row_ids":[5],"role":"direct"}]', 'UNCOVERED — no TimeCamp entry; 20 min', 'direct_carries', 0, 'committed_silent', '2026-09-02T00:00:00Z'),
       ('2026-09-01', '2026-09-01T18:00:00Z', '2026-09-01T18:12:00Z', 'L8145', 'Phone to client', '[{"source_table":"telus_calls","source_row_ids":[9],"role":"direct"}]', 'UNCOVERED — no TimeCamp entry; 12 min', 'direct_leap', 1, 'committed_after_ceremony', '2026-09-02T00:00:00Z'),
       ('2026-09-01', '2026-09-01T19:00:00Z', '2026-09-01T19:05:00Z', 'L8145', 'Review email', '[{"source_table":"syncopaid_captures","source_row_ids":[7],"role":"direct"}]', 'UNCOVERED — no TimeCamp entry; 5 min', 'direct_leap', 1, 'pending', '2026-09-02T00:00:00Z');`,
    f.env
  );

  // The practitioner's confirmation, as the timecamping-data CRUD guidance states it.
  const confirm = (id) =>
    timecampingDataExecute(
      `UPDATE proposals SET entered_by_hand_at = '2026-09-02T01:00:00Z'
       WHERE id = ${id} AND entered_by_hand_at IS NULL AND written_back = 0
         AND status IN ('committed_silent','committed_after_ceremony');`,
      f.env
    );
  await confirm(2);
  await confirm(3); // pending: has not passed Step 6, so the guard leaves it untouched
  await confirm(2); // a retry is a no-op

  const report = () =>
    timecampingDataQuery(
      `SELECT id FROM proposals
       WHERE local_date = '2026-09-01' AND status IN ('committed_silent','committed_after_ceremony')
         AND written_back = 0 AND entered_by_hand_at IS NULL ORDER BY id`,
      undefined,
      f.env
    ).rows.map((r) => r.id);
  assert.deepEqual(report(), [1]);

  // A re-run supersedes the day's prior proposals, exempting terminal ones.
  await timecampingDataExecute(
    `UPDATE proposals SET status = 'superseded'
     WHERE local_date = '2026-09-01' AND written_back = 0 AND entered_by_hand_at IS NULL;`,
    f.env
  );
  const rows = timecampingDataQuery(
    "SELECT id, status, written_back, entered_by_hand_at, evidence_chain FROM proposals ORDER BY id",
    undefined,
    f.env
  ).rows;
  assert.deepEqual(
    rows.map((r) => [r.id, r.status, r.written_back, r.entered_by_hand_at]),
    [
      [1, "superseded", 0, null],
      [2, "committed_after_ceremony", 0, "2026-09-02T01:00:00Z"],
      [3, "superseded", 0, null],
    ]
  );
  assert.deepEqual(JSON.parse(rows[1].evidence_chain), [{ source_table: "telus_calls", source_row_ids: [9], role: "direct" }]);

  // The re-run's inference pass treats the terminal spans as covered.
  const covered = timecampingDataQuery(
    `SELECT id, start_ts, end_ts, proposed_matter_ref FROM proposals
     WHERE local_date = ? AND status <> 'superseded' AND (written_back = 1 OR entered_by_hand_at IS NOT NULL)`,
    ["2026-09-01"],
    f.env
  ).rows;
  assert.deepEqual(covered, [
    { id: 2, start_ts: "2026-09-01T18:00:00Z", end_ts: "2026-09-01T18:12:00Z", proposed_matter_ref: "L8145" },
  ]);
});

test("execute writes rows in one transaction, and query only accepts read-only statements", async (t) => {
  const f = fixture(t);
  await timecampingDataMigrate(f.env);

  await timecampingDataExecute(
    `INSERT INTO source_fetch_log (source_name, local_date, status, row_count, fetched_at)
     VALUES ('timecamp_time_entries', '2026-08-27', 'fetched', 3, '2026-08-28T00:00:00Z');`,
    f.env
  );

  const rows = timecampingDataQuery(
    "SELECT source_name, status, row_count FROM source_fetch_log WHERE local_date = ?",
    ["2026-08-27"],
    f.env
  );
  assert.deepEqual(rows.rows, [{ source_name: "timecamp_time_entries", status: "fetched", row_count: 3 }]);

  await assert.rejects(
    async () => timecampingDataQuery("DELETE FROM source_fetch_log", undefined, f.env),
    /only accepts SELECT\/WITH\/PRAGMA/
  );
});

test("execute and bulk_upsert replace the live file and leave no staged sibling beside it", async (t) => {
  const f = fixture(t);
  await timecampingDataMigrate(f.env);
  const dir = join(f.root, "_practice");

  await timecampingDataExecute(
    `INSERT INTO source_fetch_log (source_name, local_date, status, row_count, fetched_at)
     VALUES ('timecamp_time_entries', '2026-08-27', 'fetched', 3, '2026-08-28T00:00:00Z');`,
    f.env
  );
  const path = join(f.root, "upsert.jsonl");
  writeFileSync(path, JSON.stringify({
    table: "source_fetch_log",
    key: ["source_name", "local_date"],
    row: { source_name: "sent_mail", local_date: "2026-08-27", status: "fetched", row_count: 1, fetched_at: "2026-08-28T00:00:00Z" },
  }) + "\n", "utf-8");
  await timecampingDataBulkUpsert(path, f.env);

  assert.deepEqual(
    timecampingDataQuery("SELECT source_name FROM source_fetch_log WHERE local_date = ? ORDER BY source_name", ["2026-08-27"], f.env).rows,
    [{ source_name: "sent_mail" }, { source_name: "timecamp_time_entries" }]
  );
  assert.deepEqual(readdirSync(dir).filter((name) => name.startsWith("coclerk_")), []);
});

test("splice.sql returns only the gate-violation line, and no evidence, for a partially-fetched day", async (t) => {
  const f = fixture(t);
  await timecampingDataMigrate(f.env);

  const spliceSql = await readSplice();

  // No source_fetch_log rows at all for this date -- every source is missing.
  const violation = timecampingDataQuery(spliceSql, ["2026-08-27"], f.env);
  assert.deepEqual(violationSources(violation), [
    "gcal_events",
    "icloud_events",
    "sent_mail",
    "syncopaid_captures",
    "telus_calls",
    "timecamp_computer_activities",
    "timecamp_time_entries",
  ]);

  // Mark only two of seven sources terminal, with a row already loaded for one
  // of them -- still a violation, naming just the rest, and nothing else.
  await timecampingDataExecute(
    `INSERT INTO source_fetch_log (source_name, local_date, status, row_count, fetched_at) VALUES
       ('timecamp_time_entries', '2026-08-27', 'fetched', 1, '2026-08-28T00:00:00Z'),
       ('telus_calls', '2026-08-27', 'skipped', 0, '2026-08-28T00:00:00Z');

     INSERT INTO timecamp_time_entries
       (native_id, start_ts, end_ts, local_date, duration_seconds, timecamp_task_id, task_display, task_color, description, billable, locked, fetched_at)
     VALUES
       ('1', '2026-08-27T16:00:00Z', '2026-08-27T16:10:00Z', '2026-08-27', 600, '1', 'MS Teams (uncategorized)', '#E5C947', '', 1, 0, '2026-08-28T00:00:00Z');`,
    f.env
  );
  const partial = timecampingDataQuery(spliceSql, ["2026-08-27"], f.env);
  assert.deepEqual(violationSources(partial), [
    "gcal_events",
    "icloud_events",
    "sent_mail",
    "syncopaid_captures",
    "timecamp_computer_activities",
  ]);
});

test("splice.sql returns evidence rows, time-ordered with boundary continuity flagged, once every source is terminal", async (t) => {
  const f = fixture(t);
  await timecampingDataMigrate(f.env);
  const spliceSql = await readSplice();

  await timecampingDataExecute(
    `INSERT INTO source_fetch_log (source_name, local_date, status, row_count, fetched_at) VALUES
       ('timecamp_time_entries', '2026-08-27', 'fetched', 1, '2026-08-28T00:00:00Z'),
       ('timecamp_computer_activities', '2026-08-27', 'empty', 0, '2026-08-28T00:00:00Z'),
       ('syncopaid_captures', '2026-08-27', 'empty', 0, '2026-08-28T00:00:00Z'),
       ('telus_calls', '2026-08-27', 'fetched', 1, '2026-08-28T00:00:00Z'),
       ('gcal_events', '2026-08-27', 'empty', 0, '2026-08-28T00:00:00Z'),
       ('icloud_events', '2026-08-27', 'empty', 0, '2026-08-28T00:00:00Z'),
       ('sent_mail', '2026-08-27', 'empty', 0, '2026-08-28T00:00:00Z');

     INSERT INTO timecamp_time_entries
       (native_id, start_ts, end_ts, local_date, duration_seconds, timecamp_task_id, task_display, task_color, description, billable, locked, fetched_at)
     VALUES
       ('282918696', '2026-08-27T22:14:17Z', '2026-08-27T22:22:07Z', '2026-08-27', 470, '115517729', 'MS Teams (uncategorized)', '#E5C947', '', 1, 0, '2026-08-28T00:00:00Z');

     INSERT INTO telus_calls
       (native_id, start_ts, end_ts, local_date, phone_number, contact_name, action, action_result, duration_seconds, raw_type, fetched_at)
     VALUES
       ('c2026-08-27T22:22:07+15551234567', '2026-08-27T22:22:07Z', '2026-08-27T22:22:25Z', '2026-08-27', '+15551234567', '', 'Voice', 'Call connected', 18, 'phone_call', '2026-08-28T00:00:00Z');`,
    f.env
  );

  const day = readDay(timecampingDataQuery(spliceSql, ["2026-08-27"], f.env));
  assert.equal(day.date, "2026-08-27");
  assert.equal(day.facts.length, 0);
  // The call starts exactly when the Teams entry ends -- boundary continuity
  // must be flagged both directions (the telus-call-boundary fixture's rule):
  // '>' on the entry, '<' on the call.
  assert.deepEqual(
    day.evidence.map((e) => e.line),
    [
      "tte\t[1]\t1\t2026-08-27T22:14:17Z\t22:22:07\t->\tMS Teams (uncategorized) [amber/work-queue] [tracked 470s]",
      "tc\t[1]\t1\t2026-08-27T22:22:07Z\t22:22:25\t<-\t (Call connected, 18s)",
    ]
  );
  assert.deepEqual(day.evidence.map((e) => e.source_table), ["timecamp_time_entries", "telus_calls"]);
});

test("TimeCamp lines carry tracked time and attribution, never the clock span as coverage (#1102)", async (t) => {
  const f = fixture(t);
  await timecampingDataMigrate(f.env);
  const spliceSql = await readSplice();

  // A green entry spans 16:00-16:10 but tracks 480 s: the Switching File
  // entry nested inside it owns 16:04-16:06 and tracks those 120 s itself.
  await timecampingDataExecute(
    `INSERT INTO source_fetch_log (source_name, local_date, status, row_count, fetched_at) VALUES
       ('timecamp_time_entries', '2026-08-27', 'fetched', 2, '2026-08-28T00:00:00Z'),
       ('timecamp_computer_activities', '2026-08-27', 'fetched', 4, '2026-08-28T00:00:00Z'),
       ('syncopaid_captures', '2026-08-27', 'empty', 0, '2026-08-28T00:00:00Z'),
       ('telus_calls', '2026-08-27', 'empty', 0, '2026-08-28T00:00:00Z'),
       ('gcal_events', '2026-08-27', 'empty', 0, '2026-08-28T00:00:00Z'),
       ('icloud_events', '2026-08-27', 'empty', 0, '2026-08-28T00:00:00Z'),
       ('sent_mail', '2026-08-27', 'empty', 0, '2026-08-28T00:00:00Z');

     INSERT INTO timecamp_time_entries
       (native_id, start_ts, end_ts, local_date, duration_seconds, timecamp_task_id, task_display, task_color, description, billable, locked, fetched_at)
     VALUES
       ('900', '2026-08-27T16:00:00Z', '2026-08-27T16:10:00Z', '2026-08-27', 480, '5', 'L1 Client', '#5CCB72', '', 1, 0, '2026-08-28T00:00:00Z'),
       ('901', '2026-08-27T16:04:00Z', '2026-08-27T16:06:00Z', '2026-08-27', 120, '80544222', 'Switching File', '#8B6A49', '', 0, 0, '2026-08-28T00:00:00Z');

     INSERT INTO timecamp_computer_activities
       (native_id, start_ts, end_ts, local_date, application, window_title, timecamp_task_id, raw_payload, fetched_at)
     VALUES
       ('a1', '2026-08-27T16:00:00Z', '2026-08-27T16:04:00Z', '2026-08-27', 'WINWORD', 'Letter', '5', '{"entry_id":"900","time_span":240}', '2026-08-28T00:00:00Z'),
       ('a2', '2026-08-27T16:04:00Z', '2026-08-27T16:06:00Z', '2026-08-27', 'WINWORD', 'Letter', '80544222', '{"entry_id":"901","time_span":120}', '2026-08-28T00:00:00Z'),
       ('a3', '2026-08-27T16:06:00Z', '2026-08-27T16:07:00Z', '2026-08-27', 'WINWORD', 'Letter', '0', '{"entry_id":"0","time_span":60}', '2026-08-28T00:00:00Z'),
       ('a4', '2026-08-27T16:07:00Z', '2026-08-27T16:08:00Z', '2026-08-27', 'WINWORD', 'Letter', '5', '{"entry_id":"777","time_span":60}', '2026-08-28T00:00:00Z');`,
    f.env
  );

  const day = readDay(timecampingDataQuery(spliceSql, ["2026-08-27"], f.env));
  const entryId = new Map(
    timecampingDataQuery("SELECT id, native_id FROM timecamp_time_entries", undefined, f.env).rows.map((r) => [r.native_id, r.id])
  );
  assert.deepEqual(
    day.evidence.map((e) => [e.source_table, e.summary]),
    [
      ["timecamp_time_entries", "L1 Client [tracked 480s]"],
      ["timecamp_computer_activities", `WINWORD: Letter [tte ${entryId.get("900")}]`],
      ["timecamp_time_entries", "Switching File [switching-file/work-queue] [tracked 120s]"],
      ["timecamp_computer_activities", `WINWORD: Letter [tte ${entryId.get("901")}]`],
      // Identical window, gapless, same source: the run breaks here and below
      // only because attribution changes.
      ["timecamp_computer_activities", "WINWORD: Letter [untracked]"],
      // An entry absent from the table is named, never read as untracked.
      ["timecamp_computer_activities", "WINWORD: Letter [tte ?777]"],
    ]
  );
});

test("boundary continuity survives an interleaved capture from another source sitting exactly in the gap", async (t) => {
  const f = fixture(t);
  await timecampingDataMigrate(f.env);
  const spliceSql = await readSplice();

  await timecampingDataExecute(
    `INSERT INTO source_fetch_log (source_name, local_date, status, row_count, fetched_at) VALUES
       ('timecamp_time_entries', '2026-08-27', 'fetched', 2, '2026-08-28T00:00:00Z'),
       ('timecamp_computer_activities', '2026-08-27', 'empty', 0, '2026-08-28T00:00:00Z'),
       ('syncopaid_captures', '2026-08-27', 'fetched', 1, '2026-08-28T00:00:00Z'),
       ('telus_calls', '2026-08-27', 'empty', 0, '2026-08-28T00:00:00Z'),
       ('gcal_events', '2026-08-27', 'empty', 0, '2026-08-28T00:00:00Z'),
       ('icloud_events', '2026-08-27', 'empty', 0, '2026-08-28T00:00:00Z'),
       ('sent_mail', '2026-08-27', 'empty', 0, '2026-08-28T00:00:00Z');

     -- Two adjacent TimeCamp entries, the second (the "orphan") an 18-second
     -- block -- exactly the telus-call-boundary fixture's shape.
     INSERT INTO timecamp_time_entries
       (native_id, start_ts, end_ts, local_date, duration_seconds, timecamp_task_id, task_display, task_color, description, billable, locked, fetched_at)
     VALUES
       ('1001', '2026-08-27T15:14:17Z', '2026-08-27T15:22:07Z', '2026-08-27', 470, '1', 'MS Teams (uncategorized)', '#E5C947', '', 1, 0, '2026-08-28T00:00:00Z'),
       ('1002', '2026-08-27T15:22:07Z', '2026-08-27T15:22:25Z', '2026-08-27', 18, '2', 'Phone calls (to be sorted)', '#E5C947', '', 1, 0, '2026-08-28T00:00:00Z');

     -- A zero-duration SyncoPaid capture from a DIFFERENT source, timestamped
     -- to sit exactly in the boundary gap -- this is the row that defeated a
     -- naive LAG/LEAD-over-global-order check (it becomes "the nearest prior
     -- row by start_ts" and its own end_ts does not match the boundary).
     INSERT INTO syncopaid_captures
       (native_id, captured_at, end_ts, local_date, process_name, window_title, fetched_at)
     VALUES
       ('cap-1', '2026-08-27T15:22:06Z', '2026-08-27T15:22:06Z', '2026-08-27', 'Explorer', '', '2026-08-28T00:00:00Z');`,
    f.env
  );

  const day = readDay(timecampingDataQuery(spliceSql, ["2026-08-27"], f.env));
  // Member ids are the table's own internal ids (auto-assigned), not the
  // native_ids supplied above -- look these rows up by their summary text.
  const teams = day.evidence.find((e) => e.summary.includes("MS Teams"));
  const orphan = day.evidence.find((e) => e.summary.includes("Phone calls"));
  assert.equal(teams.abuts[1], ">", "the Teams entry must still show continuity into the orphan despite the interleaved capture");
  assert.equal(orphan.abuts[0], "<", "the orphan must still show continuity back into the Teams entry despite the interleaved capture");
  // The interleaved capture is a zero-duration row -- it must never flag
  // itself as its own boundary match.
  const capture = day.evidence.find((e) => e.source_table === "syncopaid_captures");
  assert.equal(capture.abuts, "--");
  // Time order: the capture sits between the two entries.
  assert.deepEqual(day.evidence.map((e) => e.source_table), [
    "timecamp_time_entries",
    "syncopaid_captures",
    "timecamp_time_entries",
  ]);
});

test("splice.sql exposes the Telus contact directory as standing facts, dateless and ahead of the evidence stream", async (t) => {
  const f = fixture(t);
  await timecampingDataMigrate(f.env);
  const spliceSql = await readSplice();

  // The cross-day-identity fixture's shape: telus_calls is `skipped` for the
  // target day (its export window ended days earlier) and contributes zero
  // evidence rows, yet its rows on OTHER days name the caller.
  await timecampingDataExecute(
    `INSERT INTO source_fetch_log (source_name, local_date, status, row_count, fetched_at) VALUES
       ('timecamp_time_entries', '2026-08-31', 'empty', 0, '2026-09-01T00:00:00Z'),
       ('timecamp_computer_activities', '2026-08-31', 'empty', 0, '2026-09-01T00:00:00Z'),
       ('syncopaid_captures', '2026-08-31', 'empty', 0, '2026-09-01T00:00:00Z'),
       ('telus_calls', '2026-08-31', 'skipped', 0, '2026-09-01T00:00:00Z'),
       ('gcal_events', '2026-08-31', 'fetched', 1, '2026-09-01T00:00:00Z'),
       ('icloud_events', '2026-08-31', 'empty', 0, '2026-09-01T00:00:00Z'),
       ('sent_mail', '2026-08-31', 'empty', 0, '2026-09-01T00:00:00Z');

     INSERT INTO telus_calls
       (native_id, start_ts, end_ts, local_date, phone_number, contact_name, action, action_result, duration_seconds, raw_type, fetched_at)
     VALUES
       ('c2026-08-26T19:29:00+16045550172', '2026-08-26T19:29:00Z', '2026-08-26T19:29:49Z', '2026-08-26', '+16045550172', 'Jesse Marlowe', 'Voice', 'Call connected', 49, 'phone_call', '2026-08-27T00:00:00Z'),
       ('c2026-08-28T19:41:00+16045550172', '2026-08-28T19:41:00Z', '2026-08-28T19:43:14Z', '2026-08-28', '+16045550172', 'Jesse Marlowe', 'Voice', 'Call connected', 134, 'phone_call', '2026-08-29T00:00:00Z'),
       ('c2026-08-28T20:53:00+16045550172', '2026-08-28T20:53:00Z', '2026-08-28T20:53:41Z', '2026-08-28', '+16045550172', 'Jesse Marlowe', 'Voice', 'Missed', 41, 'phone_call', '2026-08-29T00:00:00Z');

     INSERT INTO gcal_events
       (native_id, calendar_id, start_ts, end_ts, local_date, all_day, title, description, location, fetched_at)
     VALUES
       ('gcal:abc', 'lawyer@example.com', '2026-08-31T18:00:00Z', '2026-08-31T18:30:00Z', '2026-08-31', 0, 'Jesse Marlowe and Example Lawyer', 'best phone number to reach you.: +1 604-555-0172', '+1 604-555-0100', '2026-09-01T00:00:00Z');`,
    f.env
  );

  const day = readDay(timecampingDataQuery(spliceSql, ["2026-08-31"], f.env));

  // The directory leads, ahead of the day's evidence: legend, format, the one
  // fact, then the one calendar event.
  assert.equal(day.lines.length, 4);
  assert.match(day.lines[2], /^FACT\t/);
  assert.equal(day.facts.length, 1);
  assert.equal(day.evidence.length, 1);

  // Three rows, two dates, one pairing -- one directory line, not three.
  // Dateless: the line carries no timestamp, member id or abuts marker, so it
  // cannot be read as something that happened on the target day.
  assert.equal(day.lines[2], "FACT\ttc\tseen 2026-08-26 to 2026-08-28 (3 calls)\t+16045550172 = Jesse Marlowe");
  assert.deepEqual(day.facts[0], {
    source_table: "telus_calls",
    detail: "seen 2026-08-26 to 2026-08-28 (3 calls)",
    summary: "+16045550172 = Jesse Marlowe",
  });

  // No 08-26/08-28 call appears as an event on the 08-31 timeline.
  assert.deepEqual(day.evidence.map((e) => e.source_table), ["gcal_events"]);

  // The gate keeps its teeth: drop one terminal status and the standing facts
  // go with the evidence, leaving the violation line alone.
  await timecampingDataExecute(
    `DELETE FROM source_fetch_log WHERE source_name = 'syncopaid_captures' AND local_date = '2026-08-31';`,
    f.env
  );
  const gated = timecampingDataQuery(spliceSql, ["2026-08-31"], f.env);
  assert.deepEqual(violationSources(gated), ["syncopaid_captures"]);
});

test("a number carrying two different contact names yields both directory rows rather than one", async (t) => {
  const f = fixture(t);
  await timecampingDataMigrate(f.env);
  const spliceSql = await readSplice();

  await timecampingDataExecute(
    `INSERT INTO source_fetch_log (source_name, local_date, status, row_count, fetched_at) VALUES
       ('timecamp_time_entries', '2026-08-31', 'empty', 0, '2026-09-01T00:00:00Z'),
       ('timecamp_computer_activities', '2026-08-31', 'empty', 0, '2026-09-01T00:00:00Z'),
       ('syncopaid_captures', '2026-08-31', 'empty', 0, '2026-09-01T00:00:00Z'),
       ('telus_calls', '2026-08-31', 'skipped', 0, '2026-09-01T00:00:00Z'),
       ('gcal_events', '2026-08-31', 'empty', 0, '2026-09-01T00:00:00Z'),
       ('icloud_events', '2026-08-31', 'empty', 0, '2026-09-01T00:00:00Z'),
       ('sent_mail', '2026-08-31', 'empty', 0, '2026-09-01T00:00:00Z');

     INSERT INTO telus_calls
       (native_id, start_ts, end_ts, local_date, phone_number, contact_name, action, action_result, duration_seconds, raw_type, fetched_at)
     VALUES
       ('c1', '2026-08-26T19:29:00Z', '2026-08-26T19:29:49Z', '2026-08-26', '+16045551212', 'Jesse Marlowe', 'Voice', 'Call connected', 49, 'phone_call', '2026-08-27T00:00:00Z'),
       ('c2', '2026-08-27T19:29:00Z', '2026-08-27T19:29:49Z', '2026-08-27', '+16045551212', 'Marlowe, Jesse', 'Voice', 'Call connected', 49, 'phone_call', '2026-08-28T00:00:00Z'),
       ('c3', '2026-08-27T20:00:00Z', '2026-08-27T20:00:10Z', '2026-08-27', '+16045559999', '', 'Voice', 'Call connected', 10, 'phone_call', '2026-08-28T00:00:00Z');`,
    f.env
  );

  const day = readDay(timecampingDataQuery(spliceSql, ["2026-08-31"], f.env));
  // Two spellings, two lines -- the query never resolves the disagreement.
  // The unnamed number contributes nothing: the fact is the name.
  assert.deepEqual(
    day.facts.map((r) => r.summary),
    ["+16045551212 = Jesse Marlowe", "+16045551212 = Marlowe, Jesse"]
  );
  assert.equal(day.evidence.length, 0);
});

// ---------------------------------------------------------------------------
// iCloud calendar, the sixth source (#1199)
// ---------------------------------------------------------------------------

const ICLOUD_WORK_URL = "https://caldav.icloud.com/131943092/calendars/F627AFCE-6CEC-4E54-ABA3-8304E5B7127B/";
const ICLOUD_HOME_URL = "https://caldav.icloud.com/131943092/calendars/home/";

// Every source but iCloud terminal for the day, so the gate turns on iCloud alone.
const OTHERS_TERMINAL = (day) =>
  `INSERT INTO source_fetch_log (source_name, local_date, status, row_count, fetched_at) VALUES
     ('timecamp_time_entries', '${day}', 'empty', 0, '2026-09-02T00:00:00Z'),
     ('timecamp_computer_activities', '${day}', 'empty', 0, '2026-09-02T00:00:00Z'),
     ('syncopaid_captures', '${day}', 'skipped', 0, '2026-09-02T00:00:00Z'),
     ('telus_calls', '${day}', 'skipped', 0, '2026-09-02T00:00:00Z'),
     ('gcal_events', '${day}', 'empty', 0, '2026-09-02T00:00:00Z'),
     ('sent_mail', '${day}', 'empty', 0, '2026-09-02T00:00:00Z');`;

test("the gate releases on each terminal iCloud exit and blocks on failed or absent, naming icloud_events", async (t) => {
  const f = fixture(t);
  await timecampingDataMigrate(f.env);
  const spliceSql = await readSplice();
  const day = "2026-09-01";
  await timecampingDataExecute(OTHERS_TERMINAL(day), f.env);

  // Absent: build-timeline never recorded an outcome for the day.
  assert.deepEqual(violationSources(timecampingDataQuery(spliceSql, [day], f.env)), ["icloud_events"]);

  // Each exit path in build-timeline/reference/ICloudCalendar.md, as
  // build_ingest.py writes its status line.
  const exits = [
    { path: "events returned", status: "fetched", rows: 1, detail: null, releases: true },
    { path: "route qualified, zero events", status: "empty", rows: 0, detail: null, releases: true },
    { path: "registry entry absent or disabled", status: "skipped", rows: 0, detail: null, releases: true },
    {
      path: "calendar not configured",
      status: "failed",
      rows: 0,
      detail:
        "iCloud calendar not configured: run mail__configure_credential with the calendar fields, or set the " +
        "icloud source's enabled to false to record skipped",
      releases: false,
    },
    {
      path: "Work calendar missing",
      status: "failed",
      rows: 0,
      detail: `iCloud calendar list has no Work calendar (${ICLOUD_WORK_URL}); run mail__configure_credential again for that account, or update the identity table in ICloudCalendar.md`,
      releases: false,
    },
  ];
  for (const exit of exits) {
    await timecampingDataExecute(
      `INSERT INTO source_fetch_log (source_name, local_date, status, row_count, error_detail, fetched_at)
       VALUES ('icloud_events', '${day}', '${exit.status}', ${exit.rows},
               ${exit.detail === null ? "NULL" : `'${exit.detail.replace(/'/g, "''")}'`}, '2026-09-02T00:00:00Z')
       ON CONFLICT (source_name, local_date) DO UPDATE
         SET status = excluded.status, row_count = excluded.row_count, error_detail = excluded.error_detail;`,
      f.env
    );
    const result = timecampingDataQuery(spliceSql, [day], f.env);
    if (exit.releases) {
      assert.equal(readDay(result).date, day, exit.path);
    } else {
      assert.deepEqual(violationSources(result), ["icloud_events"], exit.path);
    }
  }
});

test("iCloud rows read under the ic alias with their calendar, all-day and free flags, stored as reported", async (t) => {
  const f = fixture(t);
  await timecampingDataMigrate(f.env);
  const day = "2026-09-01";
  await timecampingDataExecute(
    `${OTHERS_TERMINAL(day)}
     INSERT INTO source_fetch_log (source_name, local_date, status, row_count, fetched_at)
     VALUES ('icloud_events', '${day}', 'fetched', 2, '2026-09-02T00:00:00Z');

     INSERT INTO icloud_events
       (native_id, calendar, calendar_url, start_ts, end_ts, local_date, all_day, busy, title, location, notes, uid, fetched_at)
     VALUES
       ('E1_2026-09-01', 'Work', '${ICLOUD_WORK_URL}', '2026-09-01T17:00:00Z', '2026-09-01T17:30:00Z', '${day}', 0, 1,
        'Call with Jesse', 'Zoom', 'Dial-in in the invite', 'E1', '2026-09-02T00:00:00Z'),
       ('H1_2026-09-01', 'Home', '${ICLOUD_HOME_URL}', '2026-09-01T07:00:00Z', '2026-09-02T07:00:00Z', '${day}', 1, 0,
        'Dentist', NULL, NULL, 'H1', '2026-09-02T00:00:00Z');`,
    f.env
  );

  const result = readDay(timecampingDataQuery(await readSplice(), [day], f.env));
  assert.equal(
    result.lines[0],
    "SOURCES gc=gcal_events ic=icloud_events sc=syncopaid_captures sm=sent_mail tc=telus_calls tca=timecamp_computer_activities tte=timecamp_time_entries"
  );
  // Neither the all-day extent nor the free event is dropped or reinterpreted:
  // classification is /timecamping Step 5's.
  assert.deepEqual(
    result.evidence.map((e) => e.line),
    [
      "ic\t[2]\t1\t2026-09-01T07:00:00Z\t2026-09-02T07:00:00Z\t--\tDentist [calendar: Home] [all-day] [free]",
      "ic\t[1]\t1\t2026-09-01T17:00:00Z\t17:30:00\t--\tCall with Jesse [calendar: Work]",
    ]
  );
  assert.deepEqual(result.evidence.map((e) => e.source_table), ["icloud_events", "icloud_events"]);
});

// ---------------------------------------------------------------------------
// Sent mail, the seventh source (#1261)
// ---------------------------------------------------------------------------

// Every source but sent mail terminal for the day, so the gate turns on sent mail alone.
const ALL_BUT_SENT_MAIL_TERMINAL = (day) =>
  `INSERT INTO source_fetch_log (source_name, local_date, status, row_count, fetched_at) VALUES
     ('timecamp_time_entries', '${day}', 'empty', 0, '2026-09-02T00:00:00Z'),
     ('timecamp_computer_activities', '${day}', 'empty', 0, '2026-09-02T00:00:00Z'),
     ('syncopaid_captures', '${day}', 'skipped', 0, '2026-09-02T00:00:00Z'),
     ('telus_calls', '${day}', 'skipped', 0, '2026-09-02T00:00:00Z'),
     ('gcal_events', '${day}', 'empty', 0, '2026-09-02T00:00:00Z'),
     ('icloud_events', '${day}', 'empty', 0, '2026-09-02T00:00:00Z');`;

test("the gate releases on each terminal sent-mail exit and blocks on failed or absent, naming sent_mail", async (t) => {
  const f = fixture(t);
  await timecampingDataMigrate(f.env);
  const spliceSql = await readSplice();
  const day = "2026-09-01";
  await timecampingDataExecute(ALL_BUT_SENT_MAIL_TERMINAL(day), f.env);

  // Absent: build-timeline never recorded an outcome for the day.
  assert.deepEqual(violationSources(timecampingDataQuery(spliceSql, [day], f.env)), ["sent_mail"]);

  // Each exit path in build-timeline/reference/SentMail.md, as build_ingest.py
  // writes its status line.
  const exits = [
    { path: "messages kept", status: "fetched", rows: 1, detail: null, releases: true },
    { path: "qualified, covered read, zero kept messages", status: "empty", rows: 0, detail: null, releases: true },
    { path: "registry entry enabled: false", status: "skipped", rows: 0, detail: null, releases: true },
    {
      path: "no copy_confirmed",
      status: "failed",
      rows: 0,
      detail:
        "iCloud Sent Items copy not yet confirmed complete (#1262); set the sent_mail source's copy_confirmed " +
        "to the date its close check passes",
      releases: false,
    },
    {
      path: "truncated search",
      status: "failed",
      rows: 0,
      detail: "Sent Items search for 2026-09-01 truncated (returned 500 of 612); narrow the window",
      releases: false,
    },
  ];
  for (const exit of exits) {
    await timecampingDataExecute(
      `INSERT INTO source_fetch_log (source_name, local_date, status, row_count, error_detail, fetched_at)
       VALUES ('sent_mail', '${day}', '${exit.status}', ${exit.rows},
               ${exit.detail === null ? "NULL" : `'${exit.detail.replace(/'/g, "''")}'`}, '2026-09-02T00:00:00Z')
       ON CONFLICT (source_name, local_date) DO UPDATE
         SET status = excluded.status, row_count = excluded.row_count, error_detail = excluded.error_detail;`,
      f.env
    );
    const result = timecampingDataQuery(spliceSql, [day], f.env);
    if (exit.releases) {
      assert.equal(readDay(result).date, day, exit.path);
    } else {
      assert.deepEqual(violationSources(result), ["sent_mail"], exit.path);
    }
  }
});

test("sent-mail rows read under the sm alias as instants: subject, To list, and Cc only when there is one", async (t) => {
  const f = fixture(t);
  await timecampingDataMigrate(f.env);
  const day = "2026-09-01";
  await timecampingDataExecute(
    `${ALL_BUT_SENT_MAIL_TERMINAL(day)}
     INSERT INTO source_fetch_log (source_name, local_date, status, row_count, fetched_at)
     VALUES ('sent_mail', '${day}', 'fetched', 2, '2026-09-02T00:00:00Z');

     INSERT INTO sent_mail
       (native_id, sent_ts, local_date, folder, from_address, subject, to_recipients, cc_recipients, uid, fetched_at)
     VALUES
       ('M1@x', '2026-09-01T17:05:00Z', '${day}', 'Sent Items', 'lawyer@example.com',
        'Re: Smith v Jones (L8948) - Settlement Memo', '["jesse@example.com","opposing@example.com"]',
        '["assistant@example.com"]', '4812', '2026-09-02T00:00:00Z'),
       ('M2@x', '2026-09-02T02:56:00Z', '${day}', 'Sent Items/Outbound LEAP Matter Based Emails', 'lawyer@example.com',
        'Accepted: Case conference', '["registry@example.com"]', '[]', '77', '2026-09-02T00:00:00Z');`,
    f.env
  );

  const result = readDay(timecampingDataQuery(await readSplice(), [day], f.env));
  assert.match(result.lines[0], / sm=sent_mail /);
  // An instant: start and end are the same. A meeting response is stored as
  // sent; whether it is only a marker is /timecamping Step 5's call.
  assert.deepEqual(
    result.evidence.map((e) => e.line),
    [
      "sm\t[1]\t1\t2026-09-01T17:05:00Z\t17:05:00\t--\tRe: Smith v Jones (L8948) - Settlement Memo -> jesse@example.com, opposing@example.com [cc assistant@example.com]",
      "sm\t[2]\t1\t2026-09-02T02:56:00Z\t02:56:00\t--\tAccepted: Case conference -> registry@example.com",
    ]
  );
  assert.deepEqual(result.evidence.map((e) => e.source_table), ["sent_mail", "sent_mail"]);
});

// ---------------------------------------------------------------------------
// Merged lines (#938)
// ---------------------------------------------------------------------------

const ALL_TERMINAL = (day) =>
  `INSERT INTO source_fetch_log (source_name, local_date, status, row_count, fetched_at) VALUES
     ('timecamp_time_entries', '${day}', 'fetched', 1, '2026-09-30T00:00:00Z'),
     ('timecamp_computer_activities', '${day}', 'fetched', 1, '2026-09-30T00:00:00Z'),
     ('syncopaid_captures', '${day}', 'fetched', 1, '2026-09-30T00:00:00Z'),
     ('telus_calls', '${day}', 'fetched', 1, '2026-09-30T00:00:00Z'),
     ('gcal_events', '${day}', 'fetched', 1, '2026-09-30T00:00:00Z'),
     ('icloud_events', '${day}', 'empty', 0, '2026-09-30T00:00:00Z'),
     ('sent_mail', '${day}', 'empty', 0, '2026-09-30T00:00:00Z');`;

// Every run-breaking case beside one run that does merge. Captures carry
// explicit end_ts values so each gap is exact.
async function seedMergeDay(f) {
  const cap = (id, start, end, process, title, ocr = null) =>
    `('${id}', '2026-08-27T${start}Z', '2026-08-27T${end}Z', '2026-08-27', '${process}', '${title}', ${ocr ? `'${ocr}'` : "NULL"}, '2026-08-28T00:00:00Z')`;
  await timecampingDataExecute(
    `${ALL_TERMINAL("2026-08-27")}

     INSERT INTO syncopaid_captures
       (native_id, captured_at, end_ts, local_date, process_name, window_title, ocr_text, fetched_at)
     VALUES
       ${[
         cap("a1", "16:00:00", "16:00:10", "WINWORD.EXE", "Doc1"),
         cap("a2", "16:00:10", "16:00:20", "WINWORD.EXE", "Doc1"),
         cap("b1", "16:00:20", "16:00:30", "OUTLOOK.EXE", "Inbox"),
         cap("a3", "16:00:30", "16:00:40", "WINWORD.EXE", "Doc1"),
         cap("c1", "16:02:00", "16:02:10", "EXCEL.EXE", "Book1"),
         cap("c2", "16:02:10", "16:02:20", "EXCEL.EXE", "Book1"),
         cap("d1", "16:03:00", "16:03:10", "notepad", "a"),
         cap("d2", "16:03:11", "16:03:20", "notepad", "a"),
         cap("e1", "16:04:00", "16:04:10", "notepad", "b"),
         cap("e2", "16:04:10", "16:04:20", "notepad", "b", "some text"),
         cap("f1", "16:05:00", "16:05:10", "notepad", "c"),
         cap("f2", "16:05:10", "16:05:20", "notepad", "c"),
         cap("f3", "16:05:20", "16:05:30", "notepad", "c"),
       ].join(",\n       ")};

     -- Another source's row starting between c1 and c2.
     INSERT INTO timecamp_computer_activities
       (native_id, start_ts, end_ts, local_date, application, window_title, fetched_at)
     VALUES
       ('x1', '2026-08-27T16:02:05Z', '2026-08-27T16:02:06Z', '2026-08-27', 'explorer', '', '2026-08-28T00:00:00Z');

     -- Starts exactly when f3 ends.
     INSERT INTO timecamp_time_entries
       (native_id, start_ts, end_ts, local_date, duration_seconds, timecamp_task_id, task_display, task_color, description, billable, locked, fetched_at)
     VALUES
       ('t1', '2026-08-27T16:05:30Z', '2026-08-27T16:06:00Z', '2026-08-27', 30, '9', 'Write-off', '#8B5A2B', '', 0, 0, '2026-08-28T00:00:00Z');`,
    f.env
  );
}

function nativeIds(f, table) {
  const rows = timecampingDataQuery(`SELECT id, native_id FROM ${table}`, undefined, f.env).rows;
  return new Map(rows.map((r) => [r.id, r.native_id]));
}

test("a run merges only across identical, gapless, same-source neighbours: another row, a 1-second gap or a flag change breaks it", async (t) => {
  const f = fixture(t);
  await timecampingDataMigrate(f.env);
  await seedMergeDay(f);

  const day = readDay(timecampingDataQuery(await readSplice(), ["2026-08-27"], f.env));
  const names = {
    syncopaid_captures: nativeIds(f, "syncopaid_captures"),
    timecamp_computer_activities: nativeIds(f, "timecamp_computer_activities"),
    timecamp_time_entries: nativeIds(f, "timecamp_time_entries"),
  };
  assert.deepEqual(
    day.evidence.map((e) => [e.source_table, e.ids.map((id) => names[e.source_table].get(id)).join(","), e.count, e.abuts]),
    [
      ["syncopaid_captures", "a1,a2", 2, "->"],
      ["syncopaid_captures", "b1", 1, "<>"],
      // Same title as a1/a2, but a different row of the same source sits between.
      ["syncopaid_captures", "a3", 1, "<-"],
      ["syncopaid_captures", "c1", 1, "->"],
      ["timecamp_computer_activities", "x1", 1, "--"],
      // Same title as c1 and gapless, but another source's row sits between.
      ["syncopaid_captures", "c2", 1, "<-"],
      // A 1-second gap.
      ["syncopaid_captures", "d1", 1, "--"],
      ["syncopaid_captures", "d2", 1, "--"],
      // Identical titles, but e2 carries the OCR flag.
      ["syncopaid_captures", "e1", 1, "->"],
      ["syncopaid_captures", "e2", 1, "<-"],
      // The merged run takes '<' from f1 (nothing ends at 16:05:00) and '>'
      // from f3 (the entry starts when f3 ends) -- the middle members, which
      // abut each other, do not leak into it.
      ["syncopaid_captures", "f1,f2,f3", 3, "->"],
      ["timecamp_time_entries", "t1", 1, "<-"],
    ]
  );
  const e2 = day.evidence[9];
  assert.equal(e2.summary, "notepad: b [OCR available]");
  const run = day.evidence[10];
  assert.equal(run.start, "2026-08-27T16:05:00Z");
  assert.equal(run.end, "16:05:30");
  assert.equal(run.summary, "notepad: c");
});

test("an evidence_chain entry pasted from a merged line resolves back to every member row", async (t) => {
  const f = fixture(t);
  await timecampingDataMigrate(f.env);
  await seedMergeDay(f);

  const day = readDay(timecampingDataQuery(await readSplice(), ["2026-08-27"], f.env));
  const run = day.evidence.find((e) => e.count === 3);
  // The member list exactly as the line prints it.
  const pasted = run.line.split("\t")[1];
  const chain = [
    { source_table: run.source_table, source_row_ids: JSON.parse(pasted), role: "direct" },
    { source_table: "telus_calls", source_row_ids: null, role: "standing_fact" },
  ];
  await timecampingDataExecute(
    `INSERT INTO proposals
       (local_date, start_ts, end_ts, proposed_description, evidence_chain, rationale, corroboration, needs_ceremony, proposed_at)
     VALUES
       ('2026-08-27', '2026-08-27T16:05:00Z', '2026-08-27T16:05:30Z', 'Draft note', '${JSON.stringify(chain)}',
        'seen 2026-08-26 to 2026-08-28 (3 calls)', 'direct_carries', 0, '2026-08-28T00:00:00Z');`,
    f.env
  );

  const resolved = timecampingDataQuery(
    `SELECT s.native_id
     FROM proposals p
     JOIN json_each(p.evidence_chain) c
     JOIN json_each(c.value, '$.source_row_ids') r
     JOIN syncopaid_captures s ON s.id = r.value
     WHERE json_extract(c.value, '$.source_table') = 'syncopaid_captures'
     ORDER BY r.key`,
    undefined,
    f.env
  ).rows.map((r) => r.native_id);
  assert.deepEqual(resolved, ["f1", "f2", "f3"]);
});

// A working day at real volume: SyncoPaid captures every 3 seconds for four
// hours, interleaved with TimeCamp activity rows chunked at 60 seconds, over
// focus stretches from 3 seconds to 30 minutes long with titles that recur,
// an OCR flag on every 40th capture, and a few entries, calls and events --
// one calendar event crossing UTC midnight.
function volumeDaySql(day) {
  const titles = [
    ["WINWORD.EXE", "L8212 - Notice of Civil Claim - Draft 3.docx - Word"],
    ["OUTLOOK.EXE", "Inbox - lawyer@example.com - Outlook"],
    ["chrome.exe", "CanLII - 2024 BCSC 1234 - Google Chrome"],
    ["claude", "Claude"],
    ["Acrobat.exe", "2026-08-12 L8212 Affidavit #1 of J Marlowe.pdf - Adobe Acrobat"],
    ["OUTLOOK.EXE", "RE: L8212 settlement offer - Message (HTML)"],
    ["EXCEL.EXE", "Trust ledger 2026.xlsx - Excel"],
  ];
  const durations = [5, 40, 300, 12, 900, 60, 3, 120, 1800, 25, 600, 8];
  const t0 = Date.parse(`${day}T16:00:00Z`);
  const span = 4 * 3600;
  const iso = (sec) => new Date(t0 + sec * 1000).toISOString().replace(".000Z", "Z");
  const q = (s) => `'${s.replace(/'/g, "''")}'`;

  const stretches = [];
  for (let s = 0, i = 0; s < span; i++) {
    const end = Math.min(s + durations[i % durations.length], span);
    stretches.push({ start: s, end, title: titles[(i * 3) % titles.length] });
    s = end;
  }
  const titleAt = (sec) => stretches.find((st) => sec >= st.start && sec < st.end).title;

  const tca = [];
  for (const st of stretches) {
    for (let s = st.start; s < st.end; s += 60) {
      tca.push(`(${q(`a${tca.length}`)}, ${q(iso(s))}, ${q(iso(Math.min(s + 60, st.end)))}, ${q(day)}, ${q(st.title[0])}, ${q(st.title[1])}, '2026-09-30T00:00:00Z')`);
    }
  }
  const sc = [];
  for (let s = 0; s < span; s += 3) {
    const [processName, title] = titleAt(s);
    const end = s + 3 < span ? q(iso(s + 3)) : "NULL";
    const ocr = sc.length % 40 === 7 ? "'visible text'" : "NULL";
    sc.push(`(${q(iso(s))}, ${q(iso(s))}, ${end}, ${q(day)}, ${q(processName)}, ${q(title)}, ${ocr}, '2026-09-30T00:00:00Z')`);
  }
  const chunks = (rows, head) => {
    const out = [];
    for (let i = 0; i < rows.length; i += 400) out.push(`${head}\n VALUES ${rows.slice(i, i + 400).join(",\n ")};`);
    return out.join("\n");
  };
  return [
    ALL_TERMINAL(day),
    chunks(tca, "INSERT INTO timecamp_computer_activities (native_id, start_ts, end_ts, local_date, application, window_title, fetched_at)"),
    chunks(sc, "INSERT INTO syncopaid_captures (native_id, captured_at, end_ts, local_date, process_name, window_title, ocr_text, fetched_at)"),
    `INSERT INTO timecamp_time_entries
       (native_id, start_ts, end_ts, local_date, duration_seconds, timecamp_task_id, task_display, task_color, description, billable, locked, fetched_at)
     VALUES
       ('e1', ${q(iso(0))}, ${q(iso(3600))}, ${q(day)}, 3600, '1', 'Clio work queue', '#E5C947', '', 1, 0, '2026-09-30T00:00:00Z'),
       ('e2', ${q(iso(3600))}, ${q(iso(3700))}, ${q(day)}, 100, '80544222', 'Switching File', '#8B5A2B', '', 0, 0, '2026-09-30T00:00:00Z'),
       ('e3', ${q(iso(3700))}, ${q(iso(7200))}, ${q(day)}, 3500, '2', 'L8212 Debt Collection', '#5CCB72', 'Draft notice of claim', 1, 0, '2026-09-30T00:00:00Z');`,
    `INSERT INTO telus_calls
       (native_id, start_ts, end_ts, local_date, phone_number, contact_name, action, action_result, duration_seconds, raw_type, fetched_at)
     VALUES
       ('c1', ${q(iso(5000))}, ${q(iso(5134))}, ${q(day)}, '+16045550172', 'Jesse Marlowe', 'Voice', 'Call connected', 134, 'phone_call', '2026-09-30T00:00:00Z'),
       ('c2', ${q(iso(9000))}, ${q(iso(9041))}, ${q(day)}, '+16045550000', NULL, 'Voice', 'Missed', 41, 'phone_call', '2026-09-30T00:00:00Z');`,
    `INSERT INTO gcal_events
       (native_id, calendar_id, start_ts, end_ts, local_date, all_day, title, fetched_at)
     VALUES
       ('gcal:1', 'lawyer@example.com', '${day}T07:00:00Z', '2026-09-11T07:00:00Z', ${q(day)}, 1, 'L8212 reply due', '2026-09-30T00:00:00Z'),
       ('gcal:2', 'lawyer@example.com', '${day}T23:30:00Z', '2026-09-11T00:30:00Z', ${q(day)}, 0, 'Call with J Marlowe', '2026-09-30T00:00:00Z');`,
  ].join("\n\n");
}

test("a day at real volume reads in full under 400,000 characters, and its merged lines account for every row exactly once", async (t) => {
  const f = fixture(t);
  await timecampingDataMigrate(f.env);
  const DAY = "2026-09-10";
  await timecampingDataExecute(volumeDaySql(DAY), f.env);

  // Every evidence row for the day, uncompacted, with its own span.
  const raw = timecampingDataQuery(
    `SELECT 'timecamp_time_entries' AS t, id, start_ts AS s, end_ts AS e FROM timecamp_time_entries WHERE local_date = ?1
     UNION ALL SELECT 'timecamp_computer_activities', id, start_ts, end_ts FROM timecamp_computer_activities WHERE local_date = ?1
     UNION ALL SELECT 'syncopaid_captures', id, captured_at, COALESCE(end_ts, captured_at) FROM syncopaid_captures WHERE local_date = ?1
     UNION ALL SELECT 'telus_calls', id, start_ts, end_ts FROM telus_calls WHERE local_date = ?1
     UNION ALL SELECT 'gcal_events', id, start_ts, end_ts FROM gcal_events WHERE local_date = ?1
     UNION ALL SELECT 'icloud_events', id, start_ts, end_ts FROM icloud_events WHERE local_date = ?1
     UNION ALL SELECT 'sent_mail', id, sent_ts, sent_ts FROM sent_mail WHERE local_date = ?1`,
    [DAY],
    f.env
  ).rows;
  const rows = {};
  for (const r of raw) (rows[r.t] ??= new Map()).set(r.id, r);
  const total = raw.length;
  assert.ok(total >= 4000, `seeded ${total} evidence rows`);

  const result = timecampingDataQuery(await readSplice(), [DAY], f.env);
  const day = readDay(result);
  t.diagnostic(
    `evidence rows ${total}; evidence lines ${day.evidence.length}; header chars ${day.chars}; ` +
      `served ${JSON.stringify(result, null, 2).length}`
  );
  assert.ok(day.chars <= 400000, `header chars ${day.chars}`);
  assert.ok(day.evidence.length < total / 2, "long runs merged");

  // Each line's count and span match its members; every row appears once.
  const seen = new Set();
  let members = 0;
  for (const e of day.evidence) {
    assert.equal(e.count, e.ids.length, e.line);
    members += e.count;
    const spans = e.ids.map((id) => {
      const key = `${e.source_table}:${id}`;
      assert.ok(!seen.has(key), `${key} appears on more than one line`);
      seen.add(key);
      const r = rows[e.source_table].get(id);
      assert.ok(r, `${key} is not a row of the day`);
      return r;
    });
    assert.equal(e.start, spans[0].s, e.line);
    assert.equal(e.start, spans.map((r) => r.s).sort()[0], e.line);
    assert.equal(fullEnd(e), spans.map((r) => r.e).sort().at(-1), e.line);
  }
  assert.equal(members, total);

  // The flags the inference pass reads survive, and so does an end on the next UTC date.
  const summaries = day.evidence.map((e) => e.summary).join("\n");
  for (const flag of ["[OCR available]", "[amber/work-queue]", "[switching-file/work-queue]", "[all-day]"]) {
    assert.ok(summaries.includes(flag), flag);
  }
  const allDay = day.evidence.find((e) => e.summary.includes("[all-day]"));
  assert.equal(allDay.end, "2026-09-11T07:00:00Z");
  assert.deepEqual(day.facts.map((x) => x.summary), ["+16045550172 = Jesse Marlowe"]);
});

// ---------------------------------------------------------------------------
// Backfill of a closed day (#1270)
// ---------------------------------------------------------------------------

test("backfill.sql is gated like splice.sql and overlays each sm/ic row on the non-superseded proposals and the TimeCamp entries its instant or span falls in", async (t) => {
  const f = fixture(t);
  await timecampingDataMigrate(f.env);
  const backfillSql = await readBackfill();
  const day = "2026-09-01";
  // 1 = committed_silent 17:00-17:30; 2 = superseded 18:00-19:00; 3 = committed_after_ceremony, written back, 18:30-19:30.
  // Entries: 1 = work queue 17:00-17:30 (proposal 1's); 2 = a green entry
  // 17:30-18:00 that never became a proposal; 3 = a green entry 19:10-19:40.
  await timecampingDataExecute(
    `${ALL_TERMINAL(day)}
     INSERT INTO timecamp_time_entries
       (native_id, start_ts, end_ts, local_date, duration_seconds, timecamp_task_id, task_display, task_color, description, billable, locked, fetched_at)
     VALUES
       ('T1', '2026-09-01T17:00:00Z', '2026-09-01T17:30:00Z', '${day}', 1800, '1', 'Clio work queue', '#E5C947', '', 1, 0, '2026-09-30T00:00:00Z'),
       ('T2', '2026-09-01T17:30:00Z', '2026-09-01T18:00:00Z', '${day}', 1800, '2', 'L8212 Debt Collection', '#5CCB72', '', 1, 0, '2026-09-30T00:00:00Z'),
       ('T3', '2026-09-01T19:10:00Z', '2026-09-01T19:40:00Z', '${day}', 1800, '3', 'L8145 Estate', '#5CCB72', '', 1, 0, '2026-09-30T00:00:00Z');

     INSERT INTO proposals
       (local_date, start_ts, end_ts, proposed_matter_ref, proposed_description, evidence_chain, corroboration, needs_ceremony, status, proposed_at, written_back, written_back_at)
     VALUES
       ('${day}', '2026-09-01T17:00:00Z', '2026-09-01T17:30:00Z', 'L8212', 'Draft letter', '[]', 'direct_carries', 0, 'committed_silent', '2026-09-02T00:00:00Z', 0, NULL),
       ('${day}', '2026-09-01T18:00:00Z', '2026-09-01T19:00:00Z', 'L8145', 'Review file', '[]', 'direct_leap', 1, 'superseded', '2026-09-02T00:00:00Z', 0, NULL),
       ('${day}', '2026-09-01T18:30:00Z', '2026-09-01T19:30:00Z', 'L8145', 'Review file', '[]', 'direct_leap', 1, 'committed_after_ceremony', '2026-09-02T00:00:00Z', 1, '2026-09-02T01:00:00Z');

     -- M1 falls inside proposal 1 and entry 1. M2 is sent the instant
     -- proposal 1 and entry 1 end; spans are half-open, so it falls in no
     -- proposal but in entry 2, which starts then: recorded work, not
     -- unrecorded. M3 is sent the instant entry 2 ends, inside proposal 2
     -- (superseded) only: no live proposal and no entry, so unrecorded.
     INSERT INTO sent_mail
       (native_id, sent_ts, local_date, folder, from_address, subject, to_recipients, cc_recipients, uid, fetched_at)
     VALUES
       ('M1@x', '2026-09-01T17:05:00Z', '${day}', 'Sent Items', 'lawyer@example.com',
        'Re: L8212 letter', '["jesse@example.com"]', '["assistant@example.com"]', '1', '2026-09-30T00:00:00Z'),
       ('M2@x', '2026-09-01T17:30:00Z', '${day}', 'Sent Items', 'lawyer@example.com',
        'Lunch', '["friend@example.com"]', '[]', '2', '2026-09-30T00:00:00Z'),
       ('M3@x', '2026-09-01T18:00:00Z', '${day}', 'Sent Items', 'lawyer@example.com',
        'Re: estate', '["stranger@example.com"]', '[]', '3', '2026-09-30T00:00:00Z');

     -- Overlaps the superseded proposal 2, the committed proposal 3, and entry 3.
     INSERT INTO icloud_events
       (native_id, calendar, start_ts, end_ts, local_date, all_day, busy, title, uid, fetched_at)
     VALUES
       ('E1_2026-09-01', 'Work', '2026-09-01T18:45:00Z', '2026-09-01T19:15:00Z', '${day}', 0, 1,
        'Call with Jesse', 'E1', '2026-09-30T00:00:00Z');`,
    f.env
  );

  const none = {
    proposal_id: null, proposal_status: null, proposed_matter_ref: null,
    proposal_start_ts: null, proposal_end_ts: null, written_back: null, entered_by_hand_at: null,
  };
  const entries = (...list) =>
    JSON.stringify(list.map(([id, task, name]) => ({ id, timecamp_task_id: task, task_display: name })));
  assert.deepEqual(timecampingDataQuery(backfillSql, [day], f.env).rows, [
    {
      source: "sm", source_row_id: 1, start_ts: "2026-09-01T17:05:00Z", end_ts: "2026-09-01T17:05:00Z",
      summary: "Re: L8212 letter -> jesse@example.com [cc assistant@example.com]",
      proposal_id: 1, proposal_status: "committed_silent", proposed_matter_ref: "L8212",
      proposal_start_ts: "2026-09-01T17:00:00Z", proposal_end_ts: "2026-09-01T17:30:00Z",
      written_back: 0, entered_by_hand_at: null,
      timecamp_entries: entries([1, "1", "Clio work queue"]),
    },
    {
      // No proposal, but a TimeCamp entry covers it: recorded work.
      source: "sm", source_row_id: 2, start_ts: "2026-09-01T17:30:00Z", end_ts: "2026-09-01T17:30:00Z",
      summary: "Lunch -> friend@example.com",
      ...none,
      timecamp_entries: entries([2, "2", "L8212 Debt Collection"]),
    },
    {
      // Neither a live proposal nor an entry: possible unrecorded work.
      source: "sm", source_row_id: 3, start_ts: "2026-09-01T18:00:00Z", end_ts: "2026-09-01T18:00:00Z",
      summary: "Re: estate -> stranger@example.com",
      ...none,
      timecamp_entries: null,
    },
    {
      source: "ic", source_row_id: 1, start_ts: "2026-09-01T18:45:00Z", end_ts: "2026-09-01T19:15:00Z",
      summary: "Call with Jesse [calendar: Work]",
      proposal_id: 3, proposal_status: "committed_after_ceremony", proposed_matter_ref: "L8145",
      proposal_start_ts: "2026-09-01T18:30:00Z", proposal_end_ts: "2026-09-01T19:30:00Z",
      written_back: 1, entered_by_hand_at: null,
      timecamp_entries: entries([3, "3", "L8145 Estate"]),
    },
  ]);

  // The gate keeps its teeth: one missing status leaves the GATE row alone.
  await timecampingDataExecute(
    `DELETE FROM source_fetch_log WHERE source_name = 'syncopaid_captures' AND local_date = '${day}';`,
    f.env
  );
  assert.deepEqual(timecampingDataQuery(backfillSql, [day], f.env).rows, [
    {
      source: "GATE", source_row_id: null, start_ts: null, end_ts: null,
      summary: "GATE VIOLATION: missing syncopaid_captures",
      ...none,
      timecamp_entries: null,
    },
  ]);
});

test("backfill.sql's expected_sources list is splice.sql's, so their gates cannot drift apart", async () => {
  const expected = (sql) => {
    const block = sql.match(/expected_sources\(source_name, alias\) AS \(\s*VALUES([\s\S]*?)\n\)/);
    assert.ok(block, "expected_sources CTE not found");
    return [...block[1].matchAll(/\('([^']+)', '([^']+)'\)/g)].map((m) => [m[1], m[2]]).sort();
  };
  const splice = expected(await readSplice());
  assert.equal(splice.length, 7);
  assert.deepEqual(expected(await readBackfill()), splice);
});

test("a backfill day file of only sent_mail and icloud_events lines leaves the other five sources' rows and statuses unchanged", async (t) => {
  const f = fixture(t);
  await timecampingDataMigrate(f.env);
  const day = "2026-09-01";
  const others = ["timecamp_time_entries", "timecamp_computer_activities", "syncopaid_captures", "telus_calls", "gcal_events"];
  // The closed day: the five other sources have rows and terminal statuses;
  // sent_mail and icloud_events were recorded empty before they were backfilled.
  await timecampingDataExecute(
    `${ALL_TERMINAL(day)}
     INSERT INTO timecamp_time_entries
       (native_id, start_ts, end_ts, local_date, duration_seconds, timecamp_task_id, task_display, task_color, description, billable, locked, fetched_at)
     VALUES ('T1', '2026-09-01T17:00:00Z', '2026-09-01T17:30:00Z', '${day}', 1800, '2', 'L8212 Debt Collection', '#5CCB72', 'Letter', 1, 0, '2026-09-02T00:00:00Z');
     INSERT INTO timecamp_computer_activities
       (native_id, start_ts, end_ts, local_date, application, window_title, fetched_at)
     VALUES ('A1', '2026-09-01T17:00:00Z', '2026-09-01T17:10:00Z', '${day}', 'WINWORD.EXE', 'L8212 letter', '2026-09-02T00:00:00Z');
     INSERT INTO syncopaid_captures
       (native_id, captured_at, end_ts, local_date, process_name, window_title, ocr_text, fetched_at)
     VALUES ('2026-09-01T17:01:00Z', '2026-09-01T17:01:00Z', '2026-09-01T17:01:03Z', '${day}', 'WINWORD.EXE', 'L8212 letter', NULL, '2026-09-02T00:00:00Z');
     INSERT INTO telus_calls
       (native_id, start_ts, end_ts, local_date, phone_number, contact_name, action, action_result, duration_seconds, raw_type, fetched_at)
     VALUES ('C1', '2026-09-01T17:20:00Z', '2026-09-01T17:22:00Z', '${day}', '+16045550172', 'Jesse Marlowe', 'Voice', 'Call connected', 120, 'phone_call', '2026-09-02T00:00:00Z');
     INSERT INTO gcal_events
       (native_id, calendar_id, start_ts, end_ts, local_date, all_day, title, fetched_at)
     VALUES ('gcal:1', 'lawyer@example.com', '2026-09-01T18:00:00Z', '2026-09-01T18:30:00Z', '${day}', 0, 'Meeting with Jesse', '2026-09-02T00:00:00Z');`,
    f.env
  );
  const snapshot = () => ({
    rows: Object.fromEntries(
      others.map((table) => [table, timecampingDataQuery(`SELECT * FROM ${table} ORDER BY id`, undefined, f.env).rows])
    ),
    statuses: timecampingDataQuery(
      `SELECT * FROM source_fetch_log WHERE source_name IN (${others.map((s) => `'${s}'`).join(", ")}) ORDER BY id`,
      undefined,
      f.env
    ).rows,
  });
  const before = snapshot();
  assert.deepEqual(Object.values(before.rows).map((r) => r.length), [1, 1, 1, 1, 1]);
  assert.equal(before.statuses.length, 5);

  const backfilledAt = "2026-10-01T00:00:00Z";
  const fetchLog = (source) => ({
    table: "source_fetch_log",
    key: ["source_name", "local_date"],
    row: { source_name: source, local_date: day, status: "fetched", row_count: 1, error_detail: null, fetched_at: backfilledAt },
  });
  const lines = [
    {
      table: "sent_mail",
      key: ["native_id"],
      row: {
        native_id: "M1@x", sent_ts: "2026-09-01T17:05:00Z", local_date: day, folder: "Sent Items",
        from_address: "lawyer@example.com", subject: "Re: L8212 letter", to_recipients: JSON.stringify(["jesse@example.com"]),
        cc_recipients: "[]", uid: 4812, raw_payload: JSON.stringify({ folder: "Sent Items" }), fetched_at: backfilledAt,
      },
    },
    {
      table: "icloud_events",
      key: ["native_id"],
      row: {
        native_id: "E1_2026-09-01", calendar: "Work",
        calendar_url: "https://caldav.icloud.com/131943092/calendars/F627AFCE-6CEC-4E54-ABA3-8304E5B7127B/",
        start_ts: "2026-09-01T19:00:00Z", end_ts: "2026-09-01T19:30:00Z", local_date: day, all_day: 0, busy: 1,
        title: "Call with Jesse", location: null, notes: null, uid: "E1",
        raw_payload: JSON.stringify({ calendar: "Work" }), fetched_at: backfilledAt,
      },
    },
    fetchLog("sent_mail"),
    fetchLog("icloud_events"),
  ];
  const path = join(f.root, "backfill-2026-09-01.jsonl");
  writeFileSync(path, lines.map((l) => JSON.stringify(l)).join("\n") + "\n", "utf-8");
  await timecampingDataBulkUpsert(path, f.env);

  assert.deepEqual(snapshot(), before);
  // The backfill itself landed.
  assert.deepEqual(
    timecampingDataQuery(
      `SELECT source_name, status, row_count FROM source_fetch_log
       WHERE local_date = ? AND source_name IN ('sent_mail', 'icloud_events') ORDER BY source_name`,
      [day],
      f.env
    ).rows,
    [
      { source_name: "icloud_events", status: "fetched", row_count: 1 },
      { source_name: "sent_mail", status: "fetched", row_count: 1 },
    ]
  );
  assert.deepEqual(
    timecampingDataQuery(
      "SELECT 'sm' AS s, native_id FROM sent_mail UNION ALL SELECT 'ic', native_id FROM icloud_events ORDER BY s",
      undefined,
      f.env
    ).rows,
    [{ s: "ic", native_id: "E1_2026-09-01" }, { s: "sm", native_id: "M1@x" }]
  );
});

test("the reopen record supersedes once, inserts the successor and its determination idempotently, and presumption counting sees one determination per span", async (t) => {
  const f = fixture(t);
  await timecampingDataMigrate(f.env);
  // 1 = committed after a ceremony and written back, with its determination;
  // 2 = a silent commit written back, on another day.
  await timecampingDataExecute(
    `INSERT INTO proposals
       (local_date, start_ts, end_ts, proposed_timecamp_task_id, proposed_matter_ref, proposed_description, evidence_chain,
        rationale, corroboration, needs_ceremony, status, proposed_at, written_back, written_back_at)
     VALUES
       ('2026-09-01', '2026-09-01T17:00:00Z', '2026-09-01T17:30:00Z', '5', 'L8212', 'Draft letter',
        '[{"source_table":"syncopaid_captures","source_row_ids":[5],"role":"direct"}]', 'Window names L8212',
        'direct_leap', 1, 'committed_after_ceremony', '2026-09-02T00:00:00Z', 1, '2026-09-02T01:00:00Z'),
       ('2026-09-02', '2026-09-02T17:00:00Z', '2026-09-02T17:30:00Z', '5', 'L8212', 'Draft letter',
        '[{"source_table":"syncopaid_captures","source_row_ids":[9],"role":"direct"}]', 'Window names L8212',
        'direct_carries', 0, 'committed_silent', '2026-09-03T00:00:00Z', 1, '2026-09-03T01:00:00Z');
     INSERT INTO determinations (proposal_id, decided_at, decision, final_timecamp_task_id, final_matter_ref, ceremony_kind)
     VALUES (1, '2026-09-02T00:30:00Z', 'approved', '5', 'L8212', 'no_corroboration');`,
    f.env
  );

  // The reopen record exactly as timecamping-data SKILL.md states it, with the
  // caller's literals substituted.
  const chain = JSON.stringify([
    { source_table: "syncopaid_captures", source_row_ids: [5], role: "direct" },
    { source_table: "sent_mail", source_row_ids: [1], role: "conflict" },
  ]);
  const reopen = (old, decision, newStatus, task, matter, now) =>
    timecampingDataExecute(
      `UPDATE proposals SET status = 'superseded'
        WHERE id = ${old} AND status IN ('committed_silent','committed_after_ceremony');
       INSERT INTO proposals (local_date, start_ts, end_ts, proposed_timecamp_task_id, proposed_matter_ref,
           proposed_description, evidence_chain, rationale, corroboration, has_conflict, needs_ceremony,
           ceremony_grid_row, status, proposed_at, written_back, written_back_at, entered_by_hand_at)
       SELECT local_date, start_ts, end_ts, '${task}', '${matter}', 'Draft letter', '${chain}',
              'REOPENS proposal ' || id || ': ' || 'sent mail to L8145 counsel at 17:05', 'conflict', 1, 1, 7, '${newStatus}', '${now}',
              CASE WHEN '${decision}' = 'approved' THEN written_back ELSE 0 END,
              CASE WHEN '${decision}' = 'approved' THEN written_back_at END,
              CASE WHEN '${decision}' = 'approved' THEN entered_by_hand_at END
         FROM proposals WHERE id = ${old} AND status = 'superseded'
          AND NOT EXISTS (SELECT 1 FROM proposals r WHERE r.rationale LIKE 'REOPENS proposal ${old}:%');
       INSERT INTO determinations (proposal_id, decided_at, decision, final_timecamp_task_id, final_matter_ref,
           final_description, practitioner_note, ceremony_kind, corroborates)
       SELECT id, '${now}', '${decision}', '${task}', '${matter}', 'Draft letter', NULL, 'conflict', NULL
         FROM proposals WHERE rationale LIKE 'REOPENS proposal ${old}:%'
          AND NOT EXISTS (SELECT 1 FROM determinations d WHERE d.proposal_id = proposals.id);`,
      f.env
    );

  await reopen(1, "corrected", "committed_after_ceremony", "7", "L8145", "2026-10-01T00:00:00Z");
  await reopen(1, "corrected", "committed_after_ceremony", "7", "L8145", "2026-10-01T00:05:00Z"); // a retry is a no-op

  const proposalsOn = (day) =>
    timecampingDataQuery(
      "SELECT id, status, written_back, written_back_at, rationale FROM proposals WHERE local_date = ? ORDER BY id",
      [day],
      f.env
    ).rows;
  assert.deepEqual(proposalsOn("2026-09-01"), [
    { id: 1, status: "superseded", written_back: 1, written_back_at: "2026-09-02T01:00:00Z", rationale: "Window names L8212" },
    {
      id: 3, status: "committed_after_ceremony", written_back: 0, written_back_at: null,
      rationale: "REOPENS proposal 1: sent mail to L8145 counsel at 17:05",
    },
  ]);
  assert.deepEqual(
    timecampingDataQuery("SELECT proposal_id, decision, decided_at FROM determinations ORDER BY id", undefined, f.env).rows,
    [
      { proposal_id: 1, decision: "approved", decided_at: "2026-09-02T00:30:00Z" },
      { proposal_id: 3, decision: "corrected", decided_at: "2026-10-01T00:00:00Z" },
    ]
  );

  // Presumption counting: two determinations in the table, one per span.
  const counted = timecampingDataQuery(
    `SELECT d.proposal_id, d.final_matter_ref FROM determinations d JOIN proposals p ON p.id = d.proposal_id
     WHERE p.status <> 'superseded' AND p.local_date = ?`,
    ["2026-09-01"],
    f.env
  ).rows;
  assert.deepEqual(counted, [{ proposal_id: 3, final_matter_ref: "L8145" }]);

  // The terminal-span query: the superseded row is no longer covered, and the
  // corrected successor is not yet written back.
  const terminal = (day) =>
    timecampingDataQuery(
      `SELECT id, start_ts, end_ts, proposed_matter_ref FROM proposals
       WHERE local_date = ? AND status <> 'superseded' AND (written_back = 1 OR entered_by_hand_at IS NOT NULL)`,
      [day],
      f.env
    ).rows;
  assert.deepEqual(terminal("2026-09-01"), []);

  // "The old categorization stands": the successor carries the old write-back,
  // because TimeCamp already holds exactly that categorization.
  await reopen(2, "approved", "committed_after_ceremony", "5", "L8212", "2026-10-01T00:10:00Z");
  assert.deepEqual(proposalsOn("2026-09-02"), [
    { id: 2, status: "superseded", written_back: 1, written_back_at: "2026-09-03T01:00:00Z", rationale: "Window names L8212" },
    {
      id: 4, status: "committed_after_ceremony", written_back: 1, written_back_at: "2026-09-03T01:00:00Z",
      rationale: "REOPENS proposal 2: sent mail to L8145 counsel at 17:05",
    },
  ]);
  assert.deepEqual(terminal("2026-09-02"), [
    { id: 4, start_ts: "2026-09-02T17:00:00Z", end_ts: "2026-09-02T17:30:00Z", proposed_matter_ref: "L8212" },
  ]);
});

test("an email inside a green entry billed to a non-client task, with no proposal, is recorded once as possible unrecorded work, and a rerun is a no-op", async (t) => {
  const f = fixture(t);
  await timecampingDataMigrate(f.env);
  const backfillSql = await readBackfill();
  const day = "2026-09-01";
  // A green General admin entry that never became a proposal, and an email
  // to a client sent inside it.
  await timecampingDataExecute(
    `${ALL_TERMINAL(day)}
     INSERT INTO timecamp_time_entries
       (native_id, start_ts, end_ts, local_date, duration_seconds, timecamp_task_id, task_display, task_color, description, billable, locked, fetched_at)
     VALUES ('T1', '2026-09-01T17:00:00Z', '2026-09-01T18:00:00Z', '${day}', 3600, '9', 'General admin', '#5CCB72', '', 0, 0, '2026-09-30T00:00:00Z');
     INSERT INTO sent_mail
       (native_id, sent_ts, local_date, folder, from_address, subject, to_recipients, cc_recipients, uid, fetched_at)
     VALUES ('M1@x', '2026-09-01T17:20:00Z', '${day}', 'Sent Items', 'lawyer@example.com',
             'Re: L8212 letter', '["jesse@example.com"]', '[]', '1', '2026-09-30T00:00:00Z');`,
    f.env
  );

  // The overlay: no proposal overlaps the email, and the green entry covers it.
  assert.deepEqual(timecampingDataQuery(backfillSql, [day], f.env).rows, [
    {
      source: "sm", source_row_id: 1, start_ts: "2026-09-01T17:20:00Z", end_ts: "2026-09-01T17:20:00Z",
      summary: "Re: L8212 letter -> jesse@example.com",
      proposal_id: null, proposal_status: null, proposed_matter_ref: null,
      proposal_start_ts: null, proposal_end_ts: null, written_back: null, entered_by_hand_at: null,
      timecamp_entries: JSON.stringify([{ id: 1, timecamp_task_id: "9", task_display: "General admin" }]),
    },
  ]);

  // The possible-unrecorded-work record exactly as timecamping-data SKILL.md
  // states it, with the caller's literals substituted. An entry covers the
  // span, so <why> carries no UNCOVERED marker.
  const chain = JSON.stringify([
    { source_table: "sent_mail", source_row_ids: [1], role: "direct" },
    { source_table: "timecamp_time_entries", source_row_ids: [1], role: "conflict" },
  ]);
  const record = (now) =>
    timecampingDataExecute(
      `INSERT INTO proposals (local_date, start_ts, end_ts, proposed_timecamp_task_id, proposed_matter_ref,
           proposed_description, evidence_chain, rationale, corroboration, has_conflict, needs_ceremony,
           ceremony_grid_row, status, proposed_at)
       SELECT '${day}', '2026-09-01T17:10:00Z', '2026-09-01T17:30:00Z', '2', 'L8212', 'Letter to client', '${chain}',
              'BACKFILL sent_mail 1: ' || 'email to L8212 client inside General admin', 'direct_leap', 0, 1, 7,
              'committed_after_ceremony', '${now}'
        WHERE NOT EXISTS (SELECT 1 FROM proposals WHERE rationale LIKE 'BACKFILL sent_mail 1:%');
       INSERT INTO determinations (proposal_id, decided_at, decision, final_timecamp_task_id, final_matter_ref,
           final_description, practitioner_note, ceremony_kind, corroborates)
       SELECT id, '${now}', 'corrected', '2', 'L8212', 'Letter to client', '17:10-17:30 was L8212', 'elicitation', NULL
         FROM proposals WHERE rationale LIKE 'BACKFILL sent_mail 1:%'
          AND NOT EXISTS (SELECT 1 FROM determinations d WHERE d.proposal_id = proposals.id);`,
      f.env
    );

  await record("2026-10-01T00:00:00Z");
  await record("2026-10-01T00:05:00Z"); // a rerun is a no-op

  assert.deepEqual(
    timecampingDataQuery(
      "SELECT id, start_ts, end_ts, proposed_matter_ref, status, written_back, rationale FROM proposals ORDER BY id",
      undefined,
      f.env
    ).rows,
    [
      {
        id: 1, start_ts: "2026-09-01T17:10:00Z", end_ts: "2026-09-01T17:30:00Z", proposed_matter_ref: "L8212",
        status: "committed_after_ceremony", written_back: 0,
        rationale: "BACKFILL sent_mail 1: email to L8212 client inside General admin",
      },
    ]
  );
  assert.deepEqual(
    timecampingDataQuery("SELECT proposal_id, decision, decided_at FROM determinations ORDER BY id", undefined, f.env).rows,
    [{ proposal_id: 1, decision: "corrected", decided_at: "2026-10-01T00:00:00Z" }]
  );
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// A consolidated-day result that passed the gate: checks the DAY header's own
// counts against the lines that follow it, then splits them by the SOURCES
// legend and the FORMAT line's field order.
function readDay(result) {
  const lines = result.rows.map((r) => {
    assert.deepEqual(Object.keys(r), ["line"]);
    return r.line;
  });
  const header = /^DAY (\d{4}-\d{2}-\d{2}) \| lines (\d+) \| chars (\d+)$/.exec(lines[0]);
  assert.ok(header, `first line is the DAY header: ${lines[0]}`);
  const body = lines.slice(1);
  assert.equal(Number(header[2]), body.length, "header line count");
  // SQLite LENGTH counts characters; [...l] counts code points, not UTF-16 units.
  assert.equal(Number(header[3]), body.reduce((n, l) => n + [...l].length, 0), "header char count");
  assert.match(body[0], /^SOURCES /);
  assert.match(body[1], /^FORMAT /);
  const sources = Object.fromEntries(body[0].slice("SOURCES ".length).split(" ").map((p) => p.split("=")));
  const facts = [];
  const evidence = [];
  for (const line of body.slice(2)) {
    const f = line.split("\t");
    if (f[0] === "FACT") {
      assert.equal(evidence.length, 0, "every FACT line precedes the evidence lines");
      facts.push({ source_table: sources[f[1]], detail: f[2], summary: f.slice(3).join("\t") });
    } else {
      assert.ok(sources[f[0]], `unknown source alias in ${line}`);
      evidence.push({
        line,
        source_table: sources[f[0]],
        ids: JSON.parse(f[1]),
        count: Number(f[2]),
        start: f[3],
        end: f[4],
        abuts: f[5],
        summary: f.slice(6).join("\t"),
      });
    }
  }
  return { date: header[1], chars: Number(header[3]), lines: body, facts, evidence };
}

// An evidence line's end as a full timestamp: HH:MM:SS means start's UTC date.
function fullEnd(e) {
  return e.end.length === 8 ? `${e.start.slice(0, 11)}${e.end}Z` : e.end;
}

// A gated result: exactly one row, the violation line and nothing else.
// Returns the missing source names, sorted.
function violationSources(result) {
  assert.equal(result.rows.length, 1);
  assert.deepEqual(Object.keys(result.rows[0]), ["line"]);
  const m = /^GATE VIOLATION: missing (.+)$/.exec(result.rows[0].line);
  assert.ok(m, result.rows[0].line);
  return m[1].split(", ").sort();
}

async function readBackfill() {
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const path = fileURLToPath(
    new URL("../../../../.claude/skills/timecamping-data/references/backfill.sql", import.meta.url)
  );
  return readFileSync(path, "utf-8");
}

async function readSplice() {
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const path = fileURLToPath(
    new URL("../../../../.claude/skills/timecamping-data/references/splice.sql", import.meta.url)
  );
  return readFileSync(path, "utf-8");
}
