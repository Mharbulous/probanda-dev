import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const {
  resolveTimePipelineDbPath,
  timePipelineGet,
  timePipelineSet,
  timePipelineList,
  timePipelineDelete,
  timePipelineBulkApply,
  timePipelineExport,
} = await import("../build/time-pipeline/backend.js");

function fixture(t) {
  const scratch = mkdtempSync(join(tmpdir(), "coclerk-time-pipeline-"));
  t.after(() => rmSync(scratch, { recursive: true, force: true }));
  const appData = join(scratch, "appdata");
  const configDir = join(appData, "Coclerk");
  mkdirSync(configDir, { recursive: true });
  const root = join(scratch, "0. CASE DATA");
  mkdirSync(root, { recursive: true });
  writeFileSync(join(configDir, "coclerk.json"), JSON.stringify({ case_data_root: root }));
  // LOCALAPPDATA and COCLERK_PYTHON reach the Python helper: without LOCALAPPDATA the `python` alias
  // (Python install manager) sees no runtime, installs one under the cwd and registers it in HKCU.
  return {
    env: {
      APPDATA: appData,
      LOCALAPPDATA: process.env.LOCALAPPDATA,
      COCLERK_PYTHON: process.env.COCLERK_PYTHON,
    },
    root,
  };
}

test("resolveTimePipelineDbPath sits alongside practice.db under _practice, and COCLERK_TIME_PIPELINE_DB_PATH overrides it", (t) => {
  const f = fixture(t);
  assert.equal(
    resolveTimePipelineDbPath(f.env),
    join(f.root, "_practice", "time_pipeline.db"),
  );
  assert.equal(
    resolveTimePipelineDbPath({ ...f.env, COCLERK_TIME_PIPELINE_DB_PATH: "X:\\test\\tp.db" }),
    "X:\\test\\tp.db",
  );
});

test("get on an absent key returns { value: null }", (t) => {
  const f = fixture(t);
  assert.deepEqual(timePipelineGet("timeline", "activity:missing", f.env), { value: null });
});

test("set then get round-trips the value verbatim, and set overwrites in place", (t) => {
  const f = fixture(t);
  timePipelineSet("timeline", "activity:a1", '{"id":"a1"}', f.env);
  assert.deepEqual(timePipelineGet("timeline", "activity:a1", f.env), { value: '{"id":"a1"}' });

  timePipelineSet("timeline", "activity:a1", '{"id":"a1","fixed":true}', f.env);
  assert.deepEqual(timePipelineGet("timeline", "activity:a1", f.env), { value: '{"id":"a1","fixed":true}' });
});

test("list does a prefix scan within one namespace, sorted by key, and never crosses namespaces", (t) => {
  const f = fixture(t);
  timePipelineSet("timeline", "index:activity:by-date:2026-04-15", "[\"a2\"]", f.env);
  timePipelineSet("timeline", "index:activity:by-date:2026-04-01", "[\"a1\"]", f.env);
  timePipelineSet("timeline", "config:timecamp_token", "secret", f.env);
  timePipelineSet("timesort", "index:activity:by-date:2026-04-15", "[\"other-namespace\"]", f.env);

  const result = timePipelineList("timeline", "index:activity:by-date:", f.env);
  assert.deepEqual(result.items, [
    { key: "index:activity:by-date:2026-04-01", value: "[\"a1\"]" },
    { key: "index:activity:by-date:2026-04-15", value: "[\"a2\"]" },
  ]);
});

test("list with no prefix returns the whole namespace", (t) => {
  const f = fixture(t);
  timePipelineSet("tedraft", "config:billing_increment", "0.1", f.env);
  timePipelineSet("tedraft", "config:minimum_entry", "0.1", f.env);
  const result = timePipelineList("tedraft", undefined, f.env);
  assert.equal(result.items.length, 2);
});

test("a literal underscore or percent in a prefix is matched literally, not as a SQL wildcard", (t) => {
  const f = fixture(t);
  timePipelineSet("timeline", "source:timecamp_%:ranges", "[]", f.env);
  timePipelineSet("timeline", "source:timecampXX:ranges", "should-not-match", f.env);
  const result = timePipelineList("timeline", "source:timecamp_%:", f.env);
  assert.deepEqual(result.items, [{ key: "source:timecamp_%:ranges", value: "[]" }]);
});

test("delete removes the entry and reports whether it existed", (t) => {
  const f = fixture(t);
  timePipelineSet("timesort", "day:2026-04-15", "{}", f.env);
  assert.deepEqual(timePipelineDelete("timesort", "day:2026-04-15", f.env), { ok: true, deleted: true });
  assert.deepEqual(timePipelineGet("timesort", "day:2026-04-15", f.env), { value: null });
  assert.deepEqual(timePipelineDelete("timesort", "day:2026-04-15", f.env), { ok: true, deleted: false });
});

// --- bulk_apply -------------------------------------------------------------
// The Chrometa historical import is ~58k rows: too many for an agent loop of
// single-key `set` calls, too large for one call's arguments. bulk_apply reads
// a JSONL file host-side and applies every line in one transaction.

function jsonlFile(t, text) {
  const dir = mkdtempSync(join(tmpdir(), "coclerk-bulk-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const p = join(dir, "ops.jsonl");
  writeFileSync(p, text, "utf-8");
  return p;
}

function jsonl(t, lines) {
  return jsonlFile(t, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
}

test("bulk_apply writes every set line in one call, and blank lines are ignored", (t) => {
  const f = fixture(t);
  const p = jsonlFile(
    t,
    JSON.stringify({ op: "set", key: "activity:chrometa:a", value: '{"id":"a"}' }) +
      "\n\n" +
      JSON.stringify({ op: "set", key: "activity:chrometa:b", value: "2" }) +
      "\n",
  );

  const counts = timePipelineBulkApply("timeline", p, f.env);
  assert.deepEqual(counts, { lines: 2, sets: 2, deletes: 0, merges: 0, deleted_by_prefix: 0 });
  assert.deepEqual(timePipelineGet("timeline", "activity:chrometa:a", f.env), { value: '{"id":"a"}' });
  assert.deepEqual(timePipelineGet("timeline", "activity:chrometa:b", f.env), { value: "2" });
});

test("delete_prefix removes only matching keys, stays inside its namespace, and treats _ literally", (t) => {
  const f = fixture(t);
  timePipelineSet("timeline", "activity:chrometa:a", "1", f.env);
  timePipelineSet("timeline", "activity:chrometa:b", "2", f.env);
  timePipelineSet("timeline", "activity:timecamp:c", "3", f.env);
  timePipelineSet("timeline", "activity:chrometaXX:d", "4", f.env);
  timePipelineSet("timesort", "activity:chrometa:a", "other-namespace", f.env);

  const counts = timePipelineBulkApply(
    "timeline",
    jsonl(t, [{ op: "delete_prefix", prefix: "activity:chrometa:" }]),
    f.env,
  );
  assert.equal(counts.deleted_by_prefix, 2);
  assert.deepEqual(timePipelineGet("timeline", "activity:chrometa:a", f.env), { value: null });
  assert.deepEqual(timePipelineGet("timeline", "activity:timecamp:c", f.env), { value: "3" });
  assert.deepEqual(timePipelineGet("timeline", "activity:chrometaXX:d", f.env), { value: "4" });
  assert.deepEqual(timePipelineGet("timesort", "activity:chrometa:a", f.env), { value: "other-namespace" });

  // `_` is a SQL wildcard unless escaped: `activity:chrometa_` must not match
  // `activity:chrometaXX:d`.
  const literal = timePipelineBulkApply(
    "timeline",
    jsonl(t, [{ op: "delete_prefix", prefix: "activity:chrometa_" }]),
    f.env,
  );
  assert.equal(literal.deleted_by_prefix, 0);
  assert.deepEqual(timePipelineGet("timeline", "activity:chrometaXX:d", f.env), { value: "4" });
});

test("merge keeps another source's ids, drops its own, de-duplicates, and creates an absent key", (t) => {
  const f = fixture(t);
  timePipelineSet(
    "timeline",
    "index:activity:by-date:2019-07-02",
    '["timecamp:a1","chrometa:stale","telus:t9"]',
    f.env,
  );

  const counts = timePipelineBulkApply(
    "timeline",
    jsonl(t, [
      {
        op: "merge",
        key: "index:activity:by-date:2019-07-02",
        add: ["chrometa:new1", "chrometa:new2", "timecamp:a1"],
        drop_prefix: "chrometa:",
      },
      {
        op: "merge",
        key: "index:activity:by-date:2019-07-03",
        add: ["chrometa:new3"],
        drop_prefix: "chrometa:",
      },
    ]),
    f.env,
  );

  assert.equal(counts.merges, 2);
  assert.deepEqual(timePipelineGet("timeline", "index:activity:by-date:2019-07-02", f.env), {
    value: '["timecamp:a1","telus:t9","chrometa:new1","chrometa:new2"]',
  });
  assert.deepEqual(timePipelineGet("timeline", "index:activity:by-date:2019-07-03", f.env), {
    value: '["chrometa:new3"]',
  });
});

test("a merge that empties an index deletes the key rather than storing []", (t) => {
  const f = fixture(t);
  timePipelineSet("timeline", "index:activity:by-date:2019-01-05", '["chrometa:gone"]', f.env);

  timePipelineBulkApply(
    "timeline",
    jsonl(t, [
      { op: "merge", key: "index:activity:by-date:2019-01-05", add: [], drop_prefix: "chrometa:" },
      { op: "merge", key: "index:activity:by-date:2019-01-06", add: [], drop_prefix: "chrometa:" },
    ]),
    f.env,
  );

  assert.deepEqual(timePipelineGet("timeline", "index:activity:by-date:2019-01-05", f.env), { value: null });
  assert.deepEqual(timePipelineList("timeline", "index:activity:by-date:", f.env).items, []);
});

test("a malformed line rolls the whole file back and the error names the line number", (t) => {
  const f = fixture(t);
  timePipelineSet("timeline", "activity:chrometa:keep", "before", f.env);

  const p = jsonlFile(
    t,
    JSON.stringify({ op: "set", key: "activity:chrometa:x", value: "1" }) +
      "\n" +
      JSON.stringify({ op: "delete_prefix", prefix: "activity:chrometa:" }) +
      "\nnot json at all\n",
  );

  assert.throws(() => timePipelineBulkApply("timeline", p, f.env), /line 3/);
  assert.deepEqual(timePipelineGet("timeline", "activity:chrometa:x", f.env), { value: null });
  assert.deepEqual(timePipelineGet("timeline", "activity:chrometa:keep", f.env), { value: "before" });
});

test("an unknown op, a non-array merge target, and a missing file each fail clearly", (t) => {
  const f = fixture(t);
  assert.throws(
    () => timePipelineBulkApply("timeline", jsonl(t, [{ op: "upsert", key: "k", value: "v" }]), f.env),
    /unknown op/,
  );

  timePipelineSet("timeline", "index:activity:by-date:2019-07-02", '{"not":"an array"}', f.env);
  assert.throws(
    () =>
      timePipelineBulkApply(
        "timeline",
        jsonl(t, [{ op: "merge", key: "index:activity:by-date:2019-07-02", add: ["chrometa:a"] }]),
        f.env,
      ),
    /not a JSON array of strings/,
  );

  assert.throws(
    () => timePipelineBulkApply("timeline", join(tmpdir(), "coclerk-no-such-bulk-file.jsonl"), f.env),
    /file not found/,
  );
});

test("a value larger than a megabyte round-trips, the size index:activity:by-source:chrometa reaches", (t) => {
  const f = fixture(t);
  const ids = Array.from({ length: 60000 }, (_, i) => `chrometa:${String(i).padStart(16, "0")}`);
  const value = JSON.stringify(ids);
  assert.ok(value.length > 1024 * 1024, "fixture must exceed the old 1 MB buffer");

  timePipelineSet("timeline", "index:activity:by-source:chrometa", value, f.env);
  assert.equal(timePipelineGet("timeline", "index:activity:by-source:chrometa", f.env).value, value);
});

test("delete_prefix then set in one file is the Chrometa replace-and-insert shape", (t) => {
  const f = fixture(t);
  timePipelineSet("timeline", "activity:chrometa:old", "stale", f.env);
  timePipelineSet("timeline", "config:timecamp_token", "keep-me", f.env);

  const counts = timePipelineBulkApply(
    "timeline",
    jsonl(t, [
      { op: "delete_prefix", prefix: "activity:chrometa:" },
      { op: "set", key: "activity:chrometa:fresh", value: '{"id":"fresh"}' },
      { op: "delete", key: "activity:chrometa:never-existed" },
    ]),
    f.env,
  );

  assert.deepEqual(counts, { lines: 3, sets: 1, deletes: 1, merges: 0, deleted_by_prefix: 1 });
  assert.deepEqual(timePipelineGet("timeline", "activity:chrometa:old", f.env), { value: null });
  assert.deepEqual(timePipelineGet("timeline", "activity:chrometa:fresh", f.env), { value: '{"id":"fresh"}' });
  assert.deepEqual(timePipelineGet("timeline", "config:timecamp_token", f.env), { value: "keep-me" });
});

// --- export -----------------------------------------------------------------
// The read twin of bulk_apply: a whole prefix goes to a host-local file, never
// through tool output, so a consumer can build from a source's stored rows
// without those rows entering the caller's context.

function exportPath(t, ...parts) {
  const dir = mkdtempSync(join(tmpdir(), "coclerk-export-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return join(dir, ...parts);
}

function exportedLines(path) {
  return readFileSync(path, "utf-8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

test("export writes the prefix's rows as sorted bulk_apply set lines, inside one namespace, matching _ and % literally", (t) => {
  const f = fixture(t);
  timePipelineSet("timeline", "activity:timecamp:b", '{"id":"timecamp:b"}', f.env);
  timePipelineSet("timeline", "activity:timecamp:a", '{"id":"timecamp:a"}', f.env);
  timePipelineSet("timeline", "activity:telus:c", '{"id":"telus:c"}', f.env);
  timePipelineSet("timeline", "config:timecamp_token", "secret", f.env);
  timePipelineSet("timesort", "activity:timecamp:z", "other-namespace", f.env);
  timePipelineSet("timeline", "source:timecamp_%:ranges", "[]", f.env);
  timePipelineSet("timeline", "source:timecampXX:ranges", "should-not-match", f.env);

  const out = exportPath(t, "timecamp.jsonl");
  assert.deepEqual(timePipelineExport("timeline", "activity:timecamp:", out, f.env), { items: 2, path: out });
  assert.deepEqual(exportedLines(out), [
    { op: "set", key: "activity:timecamp:a", value: '{"id":"timecamp:a"}' },
    { op: "set", key: "activity:timecamp:b", value: '{"id":"timecamp:b"}' },
  ]);

  const literal = exportPath(t, "literal.jsonl");
  assert.equal(timePipelineExport("timeline", "source:timecamp_%:", literal, f.env).items, 1);
  assert.deepEqual(exportedLines(literal), [{ op: "set", key: "source:timecamp_%:ranges", value: "[]" }]);
});

test("export with an empty or omitted prefix writes the whole namespace", (t) => {
  const f = fixture(t);
  timePipelineSet("tedraft", "config:billing_increment", "0.1", f.env);
  timePipelineSet("tedraft", "config:minimum_entry", "0.1", f.env);
  timePipelineSet("timeline", "config:timecamp_token", "secret", f.env);

  const omitted = exportPath(t, "omitted.jsonl");
  assert.equal(timePipelineExport("tedraft", undefined, omitted, f.env).items, 2);
  const empty = exportPath(t, "empty.jsonl");
  assert.equal(timePipelineExport("tedraft", "", empty, f.env).items, 2);
  assert.equal(readFileSync(omitted, "utf-8"), readFileSync(empty, "utf-8"));
});

test("an exported file re-applies through bulk_apply into a fresh namespace byte-for-byte", (t) => {
  const f = fixture(t);
  const values = {
    "activity:gcal:a": JSON.stringify({ id: "gcal:a", raw_payload: { summary: "Meet — Zoë", description: "line 1\nline 2\t\"quoted\" \ back" } }),
    "activity:gcal:b": "plain text, not JSON",
    "activity:gcal:c": "",
  };
  for (const [key, value] of Object.entries(values)) timePipelineSet("timeline", key, value, f.env);

  const first = exportPath(t, "first.jsonl");
  assert.equal(timePipelineExport("timeline", "activity:gcal:", first, f.env).items, 3);
  const counts = timePipelineBulkApply("timesort", first, f.env);
  assert.deepEqual(counts, { lines: 3, sets: 3, deletes: 0, merges: 0, deleted_by_prefix: 0 });
  for (const [key, value] of Object.entries(values)) {
    assert.deepEqual(timePipelineGet("timesort", key, f.env), { value });
  }

  const second = exportPath(t, "second.jsonl");
  timePipelineExport("timesort", "activity:gcal:", second, f.env);
  assert.deepEqual(readFileSync(second), readFileSync(first));
});

test("export creates the file's parent directory", (t) => {
  const f = fixture(t);
  timePipelineSet("timeline", "activity:telus:a", "1", f.env);
  const out = exportPath(t, "nested", "deeper", "telus.jsonl");
  assert.equal(existsSync(join(out, "..")), false);
  assert.deepEqual(timePipelineExport("timeline", "activity:telus:", out, f.env), { items: 1, path: out });
  assert.deepEqual(exportedLines(out), [{ op: "set", key: "activity:telus:a", value: "1" }]);
});
