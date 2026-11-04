// The timecamp server's error replies: the same envelope as every other server, with data_error as
// the fallback code and a TimeCampError's own code kept.
import assert from "node:assert/strict";
import test from "node:test";

import { dispatchTimecampTool } from "../build/timecamp/tools.js";

async function callTasks(reply) {
  globalThis.fetch = async () => reply;
  const result = await dispatchTimecampTool({ token: "fake" }, "tasks", {});
  assert.equal(result.isError, true);
  return JSON.parse(result.content[0].text).error;
}

test("an unexpected error from a tool replies with code data_error", async () => {
  // A null task is not a TimeCampError: reading its id throws a TypeError.
  const error = await callTasks(new Response(JSON.stringify([null]), { status: 200 }));
  assert.equal(error.code, "data_error");
});

test("a TimeCampError with no code of its own replies with code data_error", async () => {
  const error = await callTasks(new Response("oops", { status: 500 }));
  assert.equal(error.code, "data_error");
  assert.match(error.message, /TimeCamp answered HTTP 500/);
});

test("a TimeCampError with its own code keeps that code", async () => {
  const error = await callTasks(new Response("no", { status: 401 }));
  assert.equal(error.code, "timecamp_auth");
});

test("a network failure keeps its code and wording", async () => {
  globalThis.fetch = async () => {
    throw new Error("boom");
  };
  const result = await dispatchTimecampTool({ token: "fake" }, "tasks", {});
  const { error } = JSON.parse(result.content[0].text);
  assert.equal(error.code, "timecamp_network");
  assert.equal(error.message, "network: TimeCamp could not be reached (boom)");
});
