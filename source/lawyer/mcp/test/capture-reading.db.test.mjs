// `capture_reading` records (billing redesign, slice 3): one record per SyncoPaid capture in
// namespace `item`, key `capture_reading:<capture id>`, written through the existing
// time_pipeline__set. No new tool: these tests pin how the generic tool behaves for this kind.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { timePipelineGet, timePipelineSet, timePipelineList } = await import("../build/time-pipeline/backend.js");

const sha256 = (s) => createHash("sha256").update(s, "utf-8").digest("hex");
const refusedWith = (code) => (err) => err.code === code;

function fixture(t) {
  const scratch = mkdtempSync(join(tmpdir(), "coclerk-capture-reading-"));
  t.after(() => rmSync(scratch, { recursive: true, force: true }));
  const appData = join(scratch, "appdata");
  const configDir = join(appData, "Coclerk");
  mkdirSync(configDir, { recursive: true });
  const root = join(scratch, "0. CASE DATA");
  mkdirSync(root, { recursive: true });
  writeFileSync(join(configDir, "coclerk.json"), JSON.stringify({ case_data_root: root }));
  return {
    APPDATA: appData,
    LOCALAPPDATA: process.env.LOCALAPPDATA,
    COCLERK_PYTHON: process.env.COCLERK_PYTHON,
  };
}

const reading = (id, onScreen) =>
  JSON.stringify({
    kind: "capture_reading",
    capture_id: id,
    reading: { on_screen: onScreen, identifiers: "none", unchanged: "first", unreadable: "none" },
    answers: [],
  });

test("a capture's reading saved twice is refused the second time, and the first reading stays", (t) => {
  const env = fixture(t);
  const key = "capture_reading:c-101";
  const first = reading("c-101", "first reading");
  assert.deepEqual(timePipelineSet("item", key, first, { expect_absent: true }, env), { ok: true, sha256: sha256(first) });

  assert.throws(
    () => timePipelineSet("item", key, reading("c-101", "second reading"), { expect_absent: true }, env),
    refusedWith("stale_write"),
  );
  assert.equal(timePipelineGet("item", key, env).value, first);
});

test("the lookup finds a saved reading by capture id and reports an unread capture as absent", (t) => {
  const env = fixture(t);
  const first = reading("c-7", "seen");
  timePipelineSet("item", "capture_reading:c-7", first, { expect_absent: true }, env);
  assert.deepEqual(timePipelineGet("item", "capture_reading:c-7", env), { value: first, sha256: sha256(first) });
  assert.deepEqual(timePipelineGet("item", "capture_reading:c-8", env), { value: null, sha256: null });
  assert.deepEqual(
    timePipelineList("item", "capture_reading:", env).items.map((i) => i.key),
    ["capture_reading:c-7"],
  );
});

test("an appended answer saved with expect_sha256 keeps the first reading, and a stale append is refused", (t) => {
  const env = fixture(t);
  const key = "capture_reading:c-9";
  timePipelineSet("item", key, reading("c-9", "original"), { expect_absent: true }, env);

  const read = timePipelineGet("item", key, env);
  const record = JSON.parse(read.value);
  record.answers.push({ answer: "the practitioner's answer" });
  timePipelineSet("item", key, JSON.stringify(record), { expect_sha256: read.sha256 }, env);

  const after = JSON.parse(timePipelineGet("item", key, env).value);
  assert.equal(after.reading.on_screen, "original");
  assert.deepEqual(after.answers, [{ answer: "the practitioner's answer" }]);

  // A second writer holding the old hash is refused and loses nothing.
  record.answers.push({ answer: "lost update" });
  assert.throws(
    () => timePipelineSet("item", key, JSON.stringify(record), { expect_sha256: read.sha256 }, env),
    refusedWith("stale_write"),
  );
  assert.deepEqual(JSON.parse(timePipelineGet("item", key, env).value).answers, [{ answer: "the practitioner's answer" }]);
});

test("a save of a capture reading that names nothing it read is refused with expectation_required", (t) => {
  const env = fixture(t);
  assert.throws(
    () => timePipelineSet("item", "capture_reading:c-1", reading("c-1", "x"), {}, env),
    refusedWith("expectation_required"),
  );
  assert.equal(timePipelineGet("item", "capture_reading:c-1", env).value, null);
});
