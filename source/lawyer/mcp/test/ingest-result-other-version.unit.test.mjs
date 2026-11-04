// matter_data__ingest_result accepts the answer to its own other_version ask (#237): the tool
// tells the caller to repeat the call with answers.other_version, so its schema must allow it.

import assert from "node:assert/strict";
import test from "node:test";

const { validateToolInput } = await import("../build/validate.js");
const { caseDataToolDefinitions } = await import("../build/schema/case-data.js");

const tool = caseDataToolDefinitions().find((d) => d.name.endsWith("ingest_result"));
const call = (other_version) => ({
  matter_root: "C:/matters/demo",
  run_id: "r1",
  document: { ref: "f1", store: "main" },
  contract: "facts",
  result_ids: ["x1"],
  answers: { other_version },
});

test("answers.other_version superseded and not_version pass ingest_result's validation", () => {
  for (const v of ["superseded", "not_version"]) {
    assert.doesNotThrow(() => validateToolInput(tool, call(v)), `other_version ${v} is refused`);
  }
});

test("any other answers.other_version is refused", () => {
  assert.throws(() => validateToolInput(tool, call("maybe")));
});
