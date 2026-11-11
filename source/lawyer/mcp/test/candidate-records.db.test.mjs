// `candidate_date` and `candidate_coverage` records (billing redesign, slice 4): in namespace `item`,
// keys `candidate_date:<matter>:<date>` and `candidate_coverage:<matter>`, written through the existing
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
  const scratch = mkdtempSync(join(tmpdir(), "coclerk-candidate-"));
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

const candidate = (matter, day, strength) =>
  JSON.stringify({ kind: "candidate_date", matter, date: day, strength, who: "Lawyer", flags: [], evidence: ["document:d1"] });
const coverage = (matter, through) =>
  JSON.stringify({ kind: "candidate_coverage", matter, covered_through: through, open_leads: [] });

test("a candidate date saved twice is refused the second time, and the first record stays", (t) => {
  const env = fixture(t);
  const key = "candidate_date:m-1:2030-01-10";
  const first = candidate("m-1", "2030-01-10", "Strong");
  assert.deepEqual(timePipelineSet("item", key, first, { expect_absent: true }, env), { ok: true, sha256: sha256(first) });
  assert.throws(
    () => timePipelineSet("item", key, candidate("m-1", "2030-01-10", "Weak"), { expect_absent: true }, env),
    refusedWith("stale_write"),
  );
  assert.equal(timePipelineGet("item", key, env).value, first);
});

test("a matter's candidate dates list by prefix and never include another matter's", (t) => {
  const env = fixture(t);
  timePipelineSet("item", "candidate_date:m-1:2030-01-10", candidate("m-1", "2030-01-10", "Strong"), { expect_absent: true }, env);
  timePipelineSet("item", "candidate_date:m-1:2030-01-11", candidate("m-1", "2030-01-11", "Weak"), { expect_absent: true }, env);
  timePipelineSet("item", "candidate_date:m-2:2030-01-10", candidate("m-2", "2030-01-10", "Strong"), { expect_absent: true }, env);
  assert.deepEqual(
    timePipelineList("item", "candidate_date:m-1:", env).items.map((i) => i.key),
    ["candidate_date:m-1:2030-01-10", "candidate_date:m-1:2030-01-11"],
  );
});

test("the coverage record advances with expect_sha256, and a stale advance is refused", (t) => {
  const env = fixture(t);
  const key = "candidate_coverage:m-1";
  timePipelineSet("item", key, coverage("m-1", "2030-01-31"), { expect_absent: true }, env);
  const read = timePipelineGet("item", key, env);
  timePipelineSet("item", key, coverage("m-1", "2030-02-10"), { expect_sha256: read.sha256 }, env);
  assert.equal(JSON.parse(timePipelineGet("item", key, env).value).covered_through, "2030-02-10");
  assert.throws(
    () => timePipelineSet("item", key, coverage("m-1", "2030-02-05"), { expect_sha256: read.sha256 }, env),
    refusedWith("stale_write"),
  );
  assert.equal(JSON.parse(timePipelineGet("item", key, env).value).covered_through, "2030-02-10");
});

test("a save of a candidate record that names nothing it read is refused with expectation_required", (t) => {
  const env = fixture(t);
  assert.throws(
    () => timePipelineSet("item", "candidate_coverage:m-1", coverage("m-1", "2030-01-31"), {}, env),
    refusedWith("expectation_required"),
  );
});
