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
  const { callTool } = await import("../build/dispatch.js");
  await assert.rejects(callTool({}, "demo__nope", {}), /^ValidationError: Unknown tool "demo__nope"$/);
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

test("practice: every definition pairs with one list entry, and a definition with none fails loudly", async () => {
  const { practiceTools } = await import("../build/tools/practice/index.js");
  const { practiceToolDefinitions } = await import("../build/schema/practice.js");
  const { pairTools } = await import("../build/tool-list.js");
  assert.equal(pairTools(practiceToolDefinitions(), practiceTools).size, practiceToolDefinitions().length);
  const [dropped, ...rest] = practiceTools;
  assert.throws(() => pairTools(practiceToolDefinitions(), rest), (err) => err.code === "internal_error" && err.message.includes(`no handler for ${dropped.name}`));
});

test("dispatch.ts: every tool pairs with its definition", async () => {
  const { dataTools } = await import("../build/dispatch.js");
  const { buildToolDefinitions } = await import("../build/schema-gen.js");
  const { pairTools } = await import("../build/tool-list.js");
  const definitions = buildToolDefinitions();
  assert.equal(pairTools(definitions, dataTools).size, definitions.length);
  for (const name of ["practice_data__matter_lookup", "matter_data__query", "drafting_data__complete_job", "drafting_forms__render", "drafting_forms__open_session", "rules__at", "knowledge__read", "suggestion_card__build", "key_request__submit"]) {
    assert.ok(definitions.some((tool) => tool.name === name), name);
  }
});

test("dispatch.ts: render refuses a filing's fields on a proceeding, and needs filing_id or proceeding_id", async () => {
  const { callTool } = await import("../build/dispatch.js");
  await assert.rejects(
    callTool({}, "drafting_forms__render", { db_path: "x", proceeding_id: 1, filing_id: 2 }),
    /drafting_forms__render\.proceeding_id takes no filing_id -- those are a filing's/
  );
  await assert.rejects(callTool({}, "drafting_forms__render", { db_path: "x" }), /drafting_forms__render needs filing_id, or proceeding_id/);
});

test("dispatch.ts: a listed tool's handler gets the validated args", async () => {
  const { callTool } = await import("../build/dispatch.js");
  await assert.rejects(callTool({}, "matter_data__migrate", { matter_root: "x", mode: "nope" }), /matter_data__migrate: unknown mode "nope"/);
});

test("practice: a file tool skips replay, a read tool runs after a failed replay, a write tool does not", async () => {
  const { callPracticeTool } = await import("../build/tools/practice/index.js");
  const store = () => ({
    replays: 0,
    env: {},
    items: () => [],
    pendingCount: () => 1,
    async replayPending() {
      this.replays++;
      throw new Error("cloud unreachable");
    },
  });
  const notReplay = (err) => !/cloud unreachable/.test(err.message);

  const file = store();
  await callPracticeTool(file, "practice_data__folder_map", {}).catch((err) => assert.ok(notReplay(err), err.message));
  assert.equal(file.replays, 0);

  const read = store();
  assert.deepEqual(await callPracticeTool(read, "practice_data__ar_data", {}), { rows: [] });
  assert.equal(read.replays, 1);

  const write = store();
  await assert.rejects(callPracticeTool(write, "practice_data__upsert_task", {}), /cloud unreachable/);
  assert.equal(write.replays, 1);
});
