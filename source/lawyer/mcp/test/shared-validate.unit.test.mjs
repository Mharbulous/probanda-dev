// The one input validator lawyer and commons share (mcp-shared/validate.js): it enforces what a
// tool's inputSchema publishes, at any depth.

import assert from "node:assert/strict";
import test from "node:test";

const { validateToolInput } = await import("../../../mcp-shared/validate.js");

const tool = (properties, extra = {}) => ({ name: "demo__tool", inputSchema: { type: "object", properties, ...extra } });

function check(name, properties, good, bad, message) {
  test(name, () => {
    const t = tool(properties);
    assert.deepEqual(validateToolInput(t, good), good);
    assert.throws(() => validateToolInput(t, bad), message);
  });
}

check("items", { ids: { type: "array", items: { type: "integer" } } }, { ids: [1, 2] }, { ids: [1, "2"] }, /demo__tool\.ids\[1\] must be an integer/);
check("items of strings keep the wording the hand checks used", { ids: { type: "array", items: { type: "string" } } }, { ids: ["1"] }, { ids: ["1", 2] }, /demo__tool\.ids must be an array of strings/);
check("a null array item is refused", { ids: { type: "array", items: { type: "string" } } }, { ids: ["1"] }, { ids: [null] }, /demo__tool\.ids must be an array of strings/);
check("pattern", { day: { type: "string", pattern: "^\\d{4}$" } }, { day: "2026" }, { day: "26" }, /demo__tool\.day must match/);
check("minimum", { n: { type: "number", minimum: 1 } }, { n: 1 }, { n: 0 }, /demo__tool\.n must be at least 1/);
check("maximum", { n: { type: "number", maximum: 5 } }, { n: 5 }, { n: 6 }, /demo__tool\.n must be at most 5/);
check("integer", { n: { type: "integer" } }, { n: 3 }, { n: 3.5 }, /demo__tool\.n must be an integer/);
check("a list of types", { n: { type: ["number", "null"] } }, { n: 3 }, { n: "3" }, /demo__tool\.n must be a number or null/);
check(
  "nested properties",
  { a: { type: "object", properties: { b: { type: "object", properties: { c: { type: "integer", minimum: 1 } } } } } },
  { a: { b: { c: 1 } } },
  { a: { b: { c: 0 } } },
  /demo__tool\.a\.b\.c must be at least 1/
);
check(
  "nested required needs the field present, and a null one passes",
  { a: { type: "object", properties: { b: { anyOf: [{ type: "string" }, { type: "null" }] } }, required: ["b"] } },
  { a: { b: null } },
  { a: {} },
  /demo__tool\.a\.b is required/
);
check(
  "additionalProperties: false",
  { a: { type: "object", properties: { b: { type: "string" } }, additionalProperties: false } },
  { a: { b: "x" } },
  { a: { b: "x", c: "y" } },
  /demo__tool\.a received unknown field "c" \(allowed: b\)/
);
check("x-encrypted", { secret: { "x-encrypted": true } }, { secret: "abc" }, { secret: 1 }, /demo__tool\.secret is encrypted and must be a string/);
check("enum", { kind: { type: "string", enum: ["a", "b"] } }, { kind: "a" }, { kind: "c" }, /demo__tool\.kind must be one of: a, b/);

test("a nested object with no additionalProperties rule keeps its other fields", () => {
  const input = { a: { b: "x", other: 1 } };
  assert.deepEqual(validateToolInput(tool({ a: { type: "object", properties: { b: { type: "string" } } } }), input), input);
});

test("a field named pattern is a field, not a rule", () => {
  const t = tool({ pattern: { type: "string", description: "A regex." }, minimum: { type: "string" }, items: { type: "string" } });
  const input = { pattern: "[", minimum: "low", items: "x" };
  assert.deepEqual(validateToolInput(t, input), input);
  assert.throws(() => validateToolInput(t, { pattern: 1 }), /demo__tool\.pattern must be a string/);
});

test("the top level refuses an unknown field and lists the allowed ones, with or without additionalProperties", () => {
  assert.throws(() => validateToolInput(tool({ a: { type: "string" } }), { b: 1 }), /demo__tool received unknown field "b" \(allowed: a\)/);
});

test("null, undefined and an empty required string keep today's handling", () => {
  const t = tool({ a: { type: "string", pattern: "^x$" }, n: { type: "integer", minimum: 1 } }, { required: ["a"] });
  assert.deepEqual(validateToolInput(t, null), {});
  assert.deepEqual(validateToolInput(t, undefined), {});
  assert.deepEqual(validateToolInput(t, { a: "x", n: null }), { a: "x", n: null });
  assert.deepEqual(validateToolInput(t, { a: "x", n: undefined }), { a: "x" });
  assert.throws(() => validateToolInput(t, { a: "" }), /demo__tool\.a is required/);
  assert.throws(() => validateToolInput(t, { a: null }), /demo__tool\.a is required/);
  assert.throws(() => validateToolInput(t, []), /demo__tool input must be an object/);
});
