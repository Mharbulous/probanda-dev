import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const { timecampingDataQuery, timecampingDataExecute, timecampingDataBulkUpsert } =
  await import("../build/timecamping/backend.js");
const { timecampingDataMigrate } = await import("../build/timecamping/migrate.js");
const { buildToolDefinitions } = await import("../build/schema-gen.js");
const { callTool } = await import("../build/dispatch.js");
const { ValidationError } = await import("../build/errors.js");

// Same fixture as timecamping.db.test.mjs: a scratch case_data_root with
// _practice already present, migrated once per test.
async function fixture(t) {
  const scratch = mkdtempSync(join(tmpdir(), "coclerk-timecamping-bulk-"));
  t.after(() => rmSync(scratch, { recursive: true, force: true }));
  const appData = join(scratch, "appdata");
  const configDir = join(appData, "Coclerk");
  mkdirSync(configDir, { recursive: true });
  const root = join(scratch, "0. CASE DATA");
  mkdirSync(join(root, "_practice"), { recursive: true });
  writeFileSync(join(configDir, "coclerk.json"), JSON.stringify({ case_data_root: root }));
  const env = { ...process.env, APPDATA: appData };
  await timecampingDataMigrate(env);
  return { env, scratch };
}

let fileCounter = 0;
function jsonlFile(f, lines) {
  const path = join(f.scratch, `ingest-${++fileCounter}.jsonl`);
  writeFileSync(path, lines.map((l) => (typeof l === "string" ? l : JSON.stringify(l))).join("\n") + "\n", "utf-8");
  return path;
}

const DAY = "2026-09-01";
const FETCHED = "2026-09-02T01:00:00Z";
const SOURCES = [
  "timecamp_time_entries",
  "timecamp_computer_activities",
  "syncopaid_captures",
  "telus_calls",
  "gcal_events",
  "icloud_events",
  "sent_mail",
];

function fetchLog(source, status, rowCount, fetchedAt = FETCHED) {
  return {
    table: "source_fetch_log",
    key: ["source_name", "local_date"],
    row: { source_name: source, local_date: DAY, status, row_count: rowCount, error_detail: null, fetched_at: fetchedAt },
  };
}

function dayLines({ fetchedAt = FETCHED, windowTitle = "Smith v Jones - LEAP" } = {}) {
  return [
    {
      table: "timecamp_time_entries",
      key: ["native_id"],
      row: {
        native_id: "282918696", start_ts: "2026-09-01T16:00:00Z", end_ts: "2026-09-01T16:30:00Z", local_date: DAY,
        duration_seconds: 1800, timecamp_task_id: "115517729", task_display: "Phone calls (to be sorted)",
        task_color: "#E5C947", description: "", billable: 1, locked: 0,
        raw_payload: JSON.stringify({ id: "282918696", user_id: "1" }), fetched_at: fetchedAt,
      },
    },
    {
      table: "timecamp_computer_activities",
      key: ["native_id"],
      row: {
        native_id: "48291", start_ts: "2026-09-01T16:05:00Z", end_ts: "2026-09-01T16:10:00Z", local_date: DAY,
        application: "LEAP", window_title: windowTitle, timecamp_task_id: "0",
        raw_payload: JSON.stringify({ application: "LEAP" }), fetched_at: fetchedAt,
      },
    },
    {
      table: "syncopaid_captures",
      key: ["native_id"],
      row: {
        native_id: "2026-09-01T16:06:00Z", captured_at: "2026-09-01T16:06:00Z", end_ts: null, local_date: DAY,
        process_name: "OUTLOOK", window_title: "Inbox", mouse_clicks: 2, keyboard_events: 0,
        screenshot_ref: "shot-1", ocr_text: null, syncopaid_matter_id: null, syncopaid_matter_display: null,
        raw_payload: JSON.stringify({ id: "cap-1" }), fetched_at: fetchedAt,
      },
    },
    {
      table: "telus_calls",
      key: ["native_id"],
      row: {
        native_id: "c2026-09-01T09:20+16045551234", start_ts: "2026-09-01T16:20:00Z", end_ts: "2026-09-01T16:21:00Z",
        local_date: DAY, phone_number: "+16045551234", contact_name: "Jesse Marlowe", action: "VoIP Call",
        action_result: "Call connected", result_description: "", duration_seconds: 60, raw_type: "phone_call",
        is_internal: false, raw_payload: JSON.stringify({ format: "portal" }), fetched_at: fetchedAt,
      },
    },
    {
      table: "gcal_events",
      key: ["native_id"],
      row: {
        native_id: "gcal:abc", calendar_id: "lawyer@example.com", start_ts: "2026-09-01T18:00:00Z",
        end_ts: "2026-09-01T18:30:00Z", local_date: DAY, all_day: 0, title: "Meeting with Jesse",
        description: null, location: null, transparency: null, attendees: "[]", created: null, updated: null,
        raw_payload: JSON.stringify({ summary: "Meeting with Jesse" }), fetched_at: fetchedAt,
      },
    },
    {
      table: "icloud_events",
      key: ["native_id"],
      row: {
        native_id: "E1_2026-09-01", calendar: "Work",
        calendar_url: "https://caldav.icloud.com/131943092/calendars/F627AFCE-6CEC-4E54-ABA3-8304E5B7127B/",
        start_ts: "2026-09-01T19:00:00Z", end_ts: "2026-09-01T19:30:00Z", local_date: DAY, all_day: 0, busy: 1,
        title: "Call with Jesse", location: null, notes: null, uid: "E1",
        raw_payload: JSON.stringify({ calendar: "Work", title: "Call with Jesse" }), fetched_at: fetchedAt,
      },
    },
    {
      table: "sent_mail",
      key: ["native_id"],
      row: {
        native_id: "CAF1a2b3@mail.example.com", sent_ts: "2026-09-01T20:05:00Z", local_date: DAY,
        folder: "Sent Items", from_address: "lawyer@example.com", subject: "Re: Smith v Jones",
        to_recipients: JSON.stringify(["jesse@example.com"]), cc_recipients: "[]", uid: 4812,
        raw_payload: JSON.stringify({ folder: "Sent Items", subject: "Re: Smith v Jones" }), fetched_at: fetchedAt,
      },
    },
    ...SOURCES.map((s) => fetchLog(s, "fetched", 1, fetchedAt)),
  ];
}

// Every query is its own Python spawn and a db test has a time budget, so one
// snapshot query carries every table's (id, native key) pairs, and so its count and MAX(id).
function snapshot(env) {
  const sql = [
    ...SOURCES.map((t) => `SELECT '${t}' AS source_table, id, native_id AS native_key FROM ${t}`),
    "SELECT 'source_fetch_log', id, source_name || '|' || local_date FROM source_fetch_log",
  ].join(" UNION ALL ") + " ORDER BY source_table, id";
  return timecampingDataQuery(sql, undefined, env).rows;
}

function perTable(rows) {
  const out = {};
  for (const r of rows) out[r.source_table] = (out[r.source_table] ?? 0) + 1;
  return out;
}

function readSplice() {
  const path = fileURLToPath(
    new URL("../../../../source/skills/timecamping-data/references/splice.sql", import.meta.url)
  );
  return readFileSync(path, "utf-8");
}

test("one file loads all seven source tables and the fetch log, and splice.sql then returns the day's evidence", async (t) => {
  const f = await fixture(t);
  const result = await timecampingDataBulkUpsert(jsonlFile(f, dayLines()), f.env);

  assert.deepEqual(result, {
    lines: 14,
    rows: {
      timecamp_time_entries: 1,
      timecamp_computer_activities: 1,
      syncopaid_captures: 1,
      telus_calls: 1,
      gcal_events: 1,
      icloud_events: 1,
      sent_mail: 1,
      source_fetch_log: 7,
    },
  });
  assert.deepEqual(perTable(snapshot(f.env)), {
    timecamp_time_entries: 1,
    timecamp_computer_activities: 1,
    syncopaid_captures: 1,
    telus_calls: 1,
    gcal_events: 1,
    icloud_events: 1,
    sent_mail: 1,
    source_fetch_log: 7,
  });

  const lines = timecampingDataQuery(readSplice(), [DAY], f.env).rows.map((r) => r.line);
  assert.equal(lines.filter((l) => l.startsWith("GATE VIOLATION")).length, 0);
  const aliases = Object.fromEntries(
    lines.find((l) => l.startsWith("SOURCES ")).slice("SOURCES ".length).split(" ").map((p) => p.split("=")),
  );
  const evidence = lines.filter((l) => l.split("\t")[0] in aliases);
  assert.deepEqual([...new Set(evidence.map((l) => aliases[l.split("\t")[0]]))].sort(), [...SOURCES].sort());
  assert.equal(evidence.length, 7);
});

test("a re-run upserts in place: counts and ids are unchanged, and changed columns are updated", async (t) => {
  const f = await fixture(t);
  const path = jsonlFile(f, dayLines());
  await timecampingDataBulkUpsert(path, f.env);
  const first = snapshot(f.env);
  assert.equal(first.length, 14);

  await timecampingDataBulkUpsert(path, f.env);
  assert.deepEqual(snapshot(f.env), first);

  const refetched = "2026-09-03T01:00:00Z";
  await timecampingDataBulkUpsert(jsonlFile(f, dayLines({ fetchedAt: refetched, windowTitle: "Smith v Jones - Retitled" })), f.env);
  assert.deepEqual(snapshot(f.env), first);
  const changed = timecampingDataQuery(
    `SELECT window_title, fetched_at,
            (SELECT group_concat(DISTINCT fetched_at) FROM source_fetch_log) AS log_fetched_at
     FROM timecamp_computer_activities WHERE native_id = '48291'`,
    undefined,
    f.env
  ).rows;
  assert.deepEqual(changed, [
    { window_title: "Smith v Jones - Retitled", fetched_at: refetched, log_fetched_at: refetched },
  ]);
});

test("source_fetch_log upserts on (source_name, local_date): empty then fetched leaves one fetched row", async (t) => {
  const f = await fixture(t);
  await timecampingDataBulkUpsert(jsonlFile(f, [fetchLog("gcal_events", "empty", 0)]), f.env);
  await timecampingDataBulkUpsert(jsonlFile(f, [fetchLog("gcal_events", "fetched", 3)]), f.env);
  const rows = timecampingDataQuery(
    "SELECT source_name, local_date, status, row_count FROM source_fetch_log",
    undefined,
    f.env
  ).rows;
  assert.deepEqual(rows, [{ source_name: "gcal_events", local_date: DAY, status: "fetched", row_count: 3 }]);
});

test("a bad line rolls the whole file back, names the line, and leaves existing rows intact", async (t) => {
  const f = await fixture(t);
  await timecampingDataExecute(
    `INSERT INTO source_fetch_log (source_name, local_date, status, row_count, fetched_at)
     VALUES ('telus_calls', '2026-08-31', 'skipped', 0, '2026-09-01T00:00:00Z');`,
    f.env
  );
  const good = fetchLog("gcal_events", "empty", 0);
  const badSecondLines = [
    "not json",
    { table: "proposals", key: ["id"], row: { local_date: DAY } },
    { table: "gcal_events", key: ["native_id"], row: { native_id: "gcal:x", attendees: [{ email: "a@b" }] } },
    { table: "gcal_events", key: ["native_id"], row: { "native id": "gcal:x" } },
  ];

  for (const bad of badSecondLines) {
    await assert.rejects(timecampingDataBulkUpsert(jsonlFile(f, [good, bad]), f.env), /line 2/);
    const rows = timecampingDataQuery("SELECT source_name, local_date FROM source_fetch_log", undefined, f.env).rows;
    assert.deepEqual(rows, [{ source_name: "telus_calls", local_date: "2026-08-31" }], `after ${JSON.stringify(bad)}`);
  }
});

test("a line that is well-formed but fails in SQLite rolls the whole file back and names the line", async (t) => {
  const f = await fixture(t);
  await timecampingDataExecute(
    `INSERT INTO source_fetch_log (source_name, local_date, status, row_count, fetched_at)
     VALUES ('telus_calls', '2026-08-31', 'skipped', 0, '2026-09-01T00:00:00Z');`,
    f.env
  );
  const gcal = dayLines().find((l) => l.table === "gcal_events");
  // title carries no unique index, so the ON CONFLICT target is rejected by SQLite itself.
  const bad = { table: "gcal_events", key: ["title"], row: { ...gcal.row, title: "x" } };

  await assert.rejects(
    timecampingDataBulkUpsert(jsonlFile(f, [fetchLog("gcal_events", "empty", 0), bad]), f.env),
    /line 2/
  );
  const rows = timecampingDataQuery(
    "SELECT source_name, local_date FROM source_fetch_log UNION ALL SELECT 'gcal', native_id FROM gcal_events",
    undefined,
    f.env
  ).rows;
  assert.deepEqual(rows, [{ source_name: "telus_calls", local_date: "2026-08-31" }]);
});

test("a key element that is not a string is a line error, not a raw TypeError", async (t) => {
  const f = await fixture(t);
  const bad = { table: "gcal_events", key: [["native_id"]], row: { native_id: "gcal:x" } };
  await assert.rejects(
    timecampingDataBulkUpsert(jsonlFile(f, [fetchLog("gcal_events", "empty", 0), bad]), f.env),
    (err) => /line 2: key column .* is not a valid identifier/.test(err.message) && !/TypeError/.test(err.message)
  );
});

test("a missing file fails clearly", async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    timecampingDataBulkUpsert(join(f.scratch, "no-such-ingest.jsonl"), f.env),
    /file not found/
  );
});

test("both new tools are registered and validate their required arguments", async () => {
  const names = buildToolDefinitions().map((d) => d.name);
  assert.ok(names.includes("time_pipeline__export"));
  assert.ok(names.includes("timecamping_data__bulk_upsert"));

  await assert.rejects(
    callTool({}, "time_pipeline__export", { namespace: "timeline" }),
    (err) => err instanceof ValidationError && /time_pipeline__export\.path is required/.test(err.message)
  );
  await assert.rejects(
    callTool({}, "timecamping_data__bulk_upsert", {}),
    (err) => err instanceof ValidationError && /timecamping_data__bulk_upsert\.path is required/.test(err.message)
  );
});
