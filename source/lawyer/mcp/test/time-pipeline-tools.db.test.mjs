import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const {
  resolveTimePipelineDbPath,
  timePipelineGet: getWithHash,
  timePipelineSet: setWithExpectation,
  timePipelineList: listWithHash,
  timePipelineDelete,
  timePipelineBulkApply,
  timePipelineExport,
} = await import("../build/time-pipeline/backend.js");
const { callTool } = await import("../build/dispatch.js");
const { callTimekeepingTool } = await import("../build/timekeeping-dispatch.js");

// Most tests below are about what is stored, so these read values without their hashes and save
// unconditionally (in a namespace that allows it). The hashes and conditional saves are tested
// under "conditional saves" further down.
function timePipelineGet(namespace, key, env) {
  return { value: getWithHash(namespace, key, env).value };
}
function timePipelineSet(namespace, key, value, env) {
  return setWithExpectation(namespace, key, value, {}, env);
}
function timePipelineList(namespace, prefix, env) {
  return { items: listWithHash(namespace, prefix, env).items.map(({ key, value }) => ({ key, value })) };
}

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

function previewThenApply(namespace, path, env) {
  const { added, replaced, removed, file_sha256 } = timePipelineBulkApply(namespace, path, { preview: true }, env);
  return timePipelineBulkApply(namespace, path, { expect: { added, replaced, removed, file_sha256 } }, env);
}

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
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

  const counts = previewThenApply("timeline", p, f.env);
  assert.deepEqual(counts, {
    lines: 2, sets: 2, deletes: 0, merges: 0, deleted_by_prefix: 0,
    added: 2, replaced: 0, removed: 0, file_sha256: sha256(readFileSync(p)), applied: true,
  });
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

  const counts = previewThenApply(
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
  const literal = previewThenApply(
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

  const counts = previewThenApply(
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

  previewThenApply(
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

  assert.throws(() => previewThenApply("timeline", p, f.env), /line 3/);
  assert.deepEqual(timePipelineGet("timeline", "activity:chrometa:x", f.env), { value: null });
  assert.deepEqual(timePipelineGet("timeline", "activity:chrometa:keep", f.env), { value: "before" });
});

test("an unknown op, a non-array merge target, and a missing file each fail clearly", (t) => {
  const f = fixture(t);
  assert.throws(
    () => previewThenApply("timeline", jsonl(t, [{ op: "upsert", key: "k", value: "v" }]), f.env),
    /unknown op/,
  );

  timePipelineSet("timeline", "index:activity:by-date:2019-07-02", '{"not":"an array"}', f.env);
  assert.throws(
    () =>
      previewThenApply(
        "timeline",
        jsonl(t, [{ op: "merge", key: "index:activity:by-date:2019-07-02", add: ["chrometa:a"] }]),
        f.env,
      ),
    /not a JSON array of strings/,
  );

  assert.throws(
    () => previewThenApply("timeline", join(tmpdir(), "coclerk-no-such-bulk-file.jsonl"), f.env),
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

  const counts = previewThenApply(
    "timeline",
    jsonl(t, [
      { op: "delete_prefix", prefix: "activity:chrometa:" },
      { op: "set", key: "activity:chrometa:fresh", value: '{"id":"fresh"}' },
      { op: "delete", key: "activity:chrometa:never-existed" },
    ]),
    f.env,
  );

  assert.equal(counts.lines, 3);
  assert.equal(counts.sets, 1);
  assert.equal(counts.deletes, 1);
  assert.equal(counts.deleted_by_prefix, 1);
  assert.deepEqual(timePipelineGet("timeline", "activity:chrometa:old", f.env), { value: null });
  assert.deepEqual(timePipelineGet("timeline", "activity:chrometa:fresh", f.env), { value: '{"id":"fresh"}' });
  assert.deepEqual(timePipelineGet("timeline", "config:timecamp_token", f.env), { value: "keep-me" });
});

test("a preview reports the net effect, writes nothing, and the apply it describes does what it said", (t) => {
  const f = fixture(t);
  timePipelineSet("timeline", "same", "1", f.env);
  timePipelineSet("timeline", "changed", "old", f.env);
  timePipelineSet("timeline", "gone", "1", f.env);
  timePipelineSet("timeline", "prefix:a", "1", f.env);
  timePipelineSet("timeline", "prefix:b", "1", f.env);
  timePipelineSet("timeline", "index", '["x:1","y:1"]', f.env);
  timePipelineSet("timesort", "gone", "another namespace is not counted", f.env);
  const p = jsonl(t, [
    { op: "set", key: "same", value: "1" }, // an identical value loses nothing, so it is not a replacement
    { op: "set", key: "changed", value: "new" },
    { op: "set", key: "new", value: "1" },
    { op: "delete", key: "gone" },
    { op: "delete", key: "never-existed" },
    { op: "delete_prefix", prefix: "prefix:" },
    { op: "merge", key: "index", add: ["x:2"], drop_prefix: "x:" },
    { op: "set", key: "brief", value: "1" }, // added then removed in one file: no net effect
    { op: "delete", key: "brief" },
  ]);
  const before = timePipelineList("timeline", "", f.env).items;

  const preview = timePipelineBulkApply("timeline", p, { preview: true }, f.env);
  assert.equal(preview.added, 1);
  assert.equal(preview.replaced, 2);
  assert.equal(preview.removed, 3);
  assert.equal(preview.file_sha256, sha256(readFileSync(p)));
  assert.equal(preview.applied, false);
  assert.deepEqual(timePipelineList("timeline", "", f.env).items, before);

  const { added, replaced, removed, file_sha256 } = preview;
  const applied = timePipelineBulkApply("timeline", p, { expect: { added, replaced, removed, file_sha256 } }, f.env);
  assert.deepEqual({ ...applied, applied: false }, preview);
  assert.equal(applied.applied, true);
  assert.deepEqual(timePipelineGet("timeline", "changed", f.env), { value: "new" });
  assert.deepEqual(timePipelineGet("timeline", "gone", f.env), { value: null });
});

test("an apply whose counts or fingerprint differ from the file's writes nothing", (t) => {
  const f = fixture(t);
  timePipelineSet("timeline", "k", "old", f.env);
  const p = jsonl(t, [{ op: "set", key: "k", value: "new" }, { op: "delete_prefix", prefix: "other:" }]);
  const right = { added: 0, replaced: 1, removed: 0, file_sha256: sha256(readFileSync(p)) };
  for (const wrong of [{ added: 1 }, { replaced: 0 }, { removed: 1 }, { file_sha256: "0".repeat(64) }]) {
    assert.throws(
      () => timePipelineBulkApply("timeline", p, { expect: { ...right, ...wrong } }, f.env),
      /nothing was written/,
    );
    assert.deepEqual(timePipelineGet("timeline", "k", f.env), { value: "old" });
  }
  // The file changing after its preview is the same refusal.
  writeFileSync(p, JSON.stringify({ op: "delete", key: "k" }) + "\n", "utf-8");
  assert.throws(() => timePipelineBulkApply("timeline", p, { expect: right }, f.env), /nothing was written/);
  assert.deepEqual(timePipelineGet("timeline", "k", f.env), { value: "old" });
});

test("bulk_apply takes exactly one of preview and expect", (t) => {
  const f = fixture(t);
  const p = jsonl(t, [{ op: "set", key: "k", value: "1" }]);
  const expect = { added: 1, replaced: 0, removed: 0, file_sha256: sha256(readFileSync(p)) };
  assert.throws(() => timePipelineBulkApply("timeline", p, {}, f.env), /preview or expect/);
  assert.throws(() => timePipelineBulkApply("timeline", p, { preview: true, expect }, f.env), /preview or expect/);
  assert.deepEqual(timePipelineGet("timeline", "k", f.env), { value: null });
});

test("the tool takes preview then expect through the timekeeping server's dispatch", async (t) => {
  const f = fixture(t);
  const dbPath = join(f.root, "tool.db");
  process.env.COCLERK_TIME_PIPELINE_DB_PATH = dbPath;
  t.after(() => delete process.env.COCLERK_TIME_PIPELINE_DB_PATH);
  const path = jsonl(t, [{ op: "set", key: "k", value: "1" }]);
  const call = { namespace: "timeline", path };

  await assert.rejects(callTimekeepingTool("time_pipeline__bulk_apply", call), /preview or expect/);
  const { added, replaced, removed, file_sha256 } = await callTimekeepingTool("time_pipeline__bulk_apply", { ...call, preview: true });
  assert.equal(timePipelineGet("timeline", "k", { ...f.env, COCLERK_TIME_PIPELINE_DB_PATH: dbPath }).value, null);
  await callTimekeepingTool("time_pipeline__bulk_apply", { ...call, expect: { added, replaced, removed, file_sha256 } });
  assert.equal(timePipelineGet("timeline", "k", { ...f.env, COCLERK_TIME_PIPELINE_DB_PATH: dbPath }).value, "1");
});

test("the data server no longer serves any time_pipeline__ tool", async () => {
  await assert.rejects(callTool({}, "time_pipeline__get", { namespace: "timeline", key: "k" }), /Unknown tool/);
});

// --- conditional saves --------------------------------------------------------
// Issue 284: a read returns the stored value's SHA-256, and a save that names it is refused when
// the record changed since, so two bills sharing dates cannot overwrite each other's rows.

test("get and list return the SHA-256 of the stored value's UTF-8 text, and null for an absent key", (t) => {
  const f = fixture(t);
  const value = '{"note":"Zoë"}';
  setWithExpectation("timeline", "k", value, {}, f.env);
  assert.deepEqual(getWithHash("timeline", "k", f.env), { value, sha256: sha256(value) });
  assert.deepEqual(getWithHash("timeline", "absent", f.env), { value: null, sha256: null });
  assert.deepEqual(listWithHash("timeline", "", f.env).items, [{ key: "k", value, sha256: sha256(value) }]);
});

function refusedWith(code) {
  return (err) => err.code === code;
}

test("a save naming the hash it read lands, and one naming an older hash is refused with stale_write", (t) => {
  const f = fixture(t);
  assert.deepEqual(setWithExpectation("bill", "L1:b1", "v1", { expect_absent: true }, f.env), { ok: true, sha256: sha256("v1") });
  const read = getWithHash("bill", "L1:b1", f.env);
  setWithExpectation("bill", "L1:b1", "v2", { expect_sha256: read.sha256 }, f.env);
  assert.throws(() => setWithExpectation("bill", "L1:b1", "v3", { expect_sha256: read.sha256 }, f.env), refusedWith("stale_write"));
  assert.equal(getWithHash("bill", "L1:b1", f.env).value, "v2");
  assert.throws(() => setWithExpectation("bill", "L1:b1", "v4", { expect_absent: true }, f.env), refusedWith("stale_write"));
  assert.throws(() => setWithExpectation("bill", "L1:gone", "v", { expect_sha256: sha256("v") }, f.env), refusedWith("stale_write"));
  assert.equal(getWithHash("bill", "L1:gone", f.env).value, null);
});

test("in namespaces bill and item a save naming nothing is refused with expectation_required; elsewhere it overwrites", (t) => {
  const f = fixture(t);
  for (const namespace of ["bill", "item"]) {
    assert.throws(() => setWithExpectation(namespace, "x:1", "v", {}, f.env), refusedWith("expectation_required"));
    assert.equal(getWithHash(namespace, "x:1", f.env).value, null);
  }
  setWithExpectation("timesort", "day:1", "a", {}, f.env);
  setWithExpectation("timesort", "day:1", "b", {}, f.env);
  assert.equal(getWithHash("timesort", "day:1", f.env).value, "b");
  assert.throws(() => setWithExpectation("timesort", "day:1", "c", { expect_sha256: sha256("b"), expect_absent: true }, f.env), /not both/);
});

test("set, delete, bulk_apply and export refuse a review_date: key in namespace item", async (t) => {
  const f = fixture(t);
  const key = "review_date:2026-10-02";
  assert.throws(() => setWithExpectation("item", key, "{}", { expect_absent: true }, f.env), refusedWith("protected_key"));
  assert.throws(() => timePipelineDelete("item", key, f.env), refusedWith("protected_key"));

  // A record only the review_date__* tools write, put in place the way they do.
  process.env.COCLERK_TIME_PIPELINE_DB_PATH = resolveTimePipelineDbPath(f.env);
  t.after(() => delete process.env.COCLERK_TIME_PIPELINE_DB_PATH);
  await callTimekeepingTool("review_date__claim", { date: "2026-10-02", holder: "L1:b1" });
  const before = getWithHash("item", key, f.env).value;
  assert.ok(before);
  assert.throws(() => timePipelineDelete("item", key, f.env), refusedWith("protected_key"));
  for (const lines of [[{ op: "delete_prefix", prefix: "" }], [{ op: "set", key, value: "{}" }], [{ op: "delete", key }]]) {
    assert.throws(() => timePipelineBulkApply("item", jsonl(t, lines), { preview: true }, f.env), refusedWith("protected_key"));
  }
  assert.throws(() => timePipelineExport("item", "", join(f.root, "out.jsonl"), f.env), refusedWith("protected_key"));
  assert.equal(existsSync(join(f.root, "out.jsonl")), false);
  assert.equal(getWithHash("item", key, f.env).value, before);
  // Another kind in the same namespace is unaffected.
  setWithExpectation("item", "reading:1", "{}", { expect_absent: true }, f.env);
  assert.equal(timePipelineExport("item", "reading:", join(f.root, "ok.jsonl"), f.env).items, 1);
  // The same keys in another namespace are not protected.
  setWithExpectation("timesort", key, "{}", {}, f.env);
  assert.deepEqual(timePipelineDelete("timesort", key, f.env), { ok: true, deleted: true });
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
  const counts = previewThenApply("timesort", first, f.env);
  assert.equal(counts.sets, 3);
  assert.equal(counts.added, 3);
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
