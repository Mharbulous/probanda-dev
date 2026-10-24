// validateToolInput refuses a non-array for a field the schema declares `type: "array"`,
// so a string never reaches a handler that calls array methods on it.

import assert from "node:assert/strict";
import test from "node:test";

const { validateToolInput } = await import("../build/validate.js");

const tool = { name: "demo__tool", inputSchema: { type: "object", properties: { documents: { type: "array", items: { type: "string" } } } } };

test("a string for an array field is refused", () => {
  assert.throws(() => validateToolInput(tool, { documents: "Notice of Application" }), /demo__tool\.documents must be an array/);
});

test("an array for an array field passes", () => {
  assert.deepEqual(validateToolInput(tool, { documents: ["Notice of Application"] }), { documents: ["Notice of Application"] });
});
