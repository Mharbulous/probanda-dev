// dispatchFrom (#183): a server's tool list is paired with its definitions by name, input is
// validated against the definition before the handler runs, and every failure becomes an
// isError reply carrying the error's code.

import assert from "node:assert/strict";
import test from "node:test";

const { defineTool, dispatchFrom } = await import("../build/tool-list.js");
const { DataServerError } = await import("../build/errors.js");

const definitions = () => [
  { name: "demo__echo", description: "", inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] } },
  { name: "demo__fail", description: "", inputSchema: { type: "object", properties: {} } },
];
const tools = [
  defineTool("demo__echo", (args, context) => ({ echoed: args.text, context })),
  defineTool("demo__fail", () => {
    throw new DataServerError("refused", "demo_code");
  }),
];
const reply = (r) => JSON.parse(r.content[0].text);

test("a listed tool runs with validated args and its context, and replies in indented JSON", async () => {
  const server = dispatchFrom(definitions, tools);
  assert.deepEqual(await server.call("ctx", "demo__echo", { text: "hi" }), { echoed: "hi", context: "ctx" });
  const r = await server.dispatch("ctx", "demo__echo", { text: "hi" });
  assert.equal(r.isError, undefined);
  assert.equal(r.content[0].text, JSON.stringify({ echoed: "hi", context: "ctx" }, null, 2));
});

test("input is validated against the definition before the handler runs", async () => {
  const server = dispatchFrom(definitions, tools);
  await assert.rejects(server.call(undefined, "demo__echo", {}), /demo__echo\.text is required/);
  await assert.rejects(server.call(undefined, "demo__echo", { other: 1 }), /received unknown field "other"/);
});

test("an unknown tool is refused with the same text as before", async () => {
  const r = await dispatchFrom(definitions, tools).dispatch(undefined, "demo__nope", {});
  assert.equal(r.isError, true);
  assert.deepEqual(reply(r), { error: { code: "data_error", message: 'Unknown tool "demo__nope"' } });
});

test("a handler's DataServerError keeps its code; any other error is data_error", async () => {
  assert.deepEqual(reply(await dispatchFrom(definitions, tools).dispatch(undefined, "demo__fail", {})), {
    error: { code: "demo_code", message: "refused" },
  });
  const plain = [tools[0], defineTool("demo__fail", () => { throw new Error("boom"); })];
  assert.deepEqual(reply(await dispatchFrom(definitions, plain).dispatch(undefined, "demo__fail", {})), {
    error: { code: "data_error", message: "boom" },
  });
});

test("a definition with no handler, a handler with no definition, or a repeated name fails every call", async () => {
  const cases = {
    "no handler for demo__fail": [tools[0]],
    "no definition for demo__extra": [...tools, defineTool("demo__extra", () => null)],
    "demo__echo is listed twice": [...tools, tools[0]],
  };
  for (const [message, list] of Object.entries(cases)) {
    const r = await dispatchFrom(definitions, list).dispatch(undefined, "demo__echo", { text: "hi" });
    assert.equal(r.isError, true);
    assert.equal(reply(r).error.code, "internal_error");
    assert.match(reply(r).error.message, new RegExp(message));
  }
});

test("each real server's tool list pairs with its definitions", async () => {
  // Pairing runs before the name lookup, so a mismatch answers internal_error, not "Unknown tool".
  const { callFileManagerTool } = await import("../build/file-manager-dispatch.js");
  const { callContactsCalendarsEmailTool } = await import("../build/contacts-calendars-email-dispatch.js");
  await assert.rejects(callFileManagerTool("demo__nope", {}), /^ValidationError: Unknown tool "demo__nope"$/);
  await assert.rejects(callContactsCalendarsEmailTool({}, "demo__nope", {}), /^ValidationError: Unknown tool "demo__nope"$/);
});

test("a server's replyText shapes the success reply, and an error it throws becomes an isError reply", async () => {
  const replyText = (name, result) => {
    if (result.echoed === "bad") throw new DataServerError("not text", "internal_error");
    return `${name}:${result.echoed}`;
  };
  const server = dispatchFrom(definitions, tools, replyText);
  assert.equal((await server.dispatch(undefined, "demo__echo", { text: "hi" })).content[0].text, "demo__echo:hi");
  const r = await server.dispatch(undefined, "demo__echo", { text: "bad" });
  assert.equal(r.isError, true);
  assert.deepEqual(reply(r), { error: { code: "internal_error", message: "not text" } });
});
