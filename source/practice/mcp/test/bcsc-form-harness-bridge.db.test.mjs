// The Cowork remote-devices bridge strips session_id, trigger_id and ccr_card_approval from every
// tool call's arguments before the call reaches this server (#1367). These tests drive the harness
// tool through callTool, the tool surface a Cowork call reaches, rather than bcscFormHarness.

import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { matterFixture } from "./helpers/housekeeping-fixture.mjs";

const { callTool } = await import("../build/dispatch.js");
const { buildToolDefinitions } = await import("../build/schema-gen.js");

const BRIDGE_RESERVED = ["session_id", "trigger_id", "ccr_card_approval"];
const TOOL = "drafting_forms__bcsc_form_harness";
// The classifier result a Cowork session passed to classify (docs/E2E-tests/2026-10-02-1511, Exhibit 3).
const CLASSIFIED = JSON.stringify({
  kind: "step_result",
  data: { mode: "regular", form_id: "affidavit", form_name: "Affidavit (Form 109, Rule 22-2)", registered: true, op_id: "draft", confidence: 1.0, ambiguous: false },
});

test("no tool schema has a property the Cowork bridge strips from the call", () => {
  for (const tool of buildToolDefinitions()) {
    const names = Object.keys(tool.inputSchema.properties ?? {});
    assert.deepEqual(names.filter((n) => BRIDGE_RESERVED.includes(n)), [], tool.name);
  }
});

test("init, classify, resume and abandon through the tool surface each reach the harness with harness_session", async () => {
  const f = matterFixture();
  try {
    const call = (args) => callTool({}, TOOL, { matter_root: f.root, ...args });
    const init = await call({ command: "init", user_request: "draft an affidavit", writing_folder: "Affidavit" });
    assert.equal(init.route_to, "classify", JSON.stringify(init));
    // Classification renames the session, so each call passes the id the harness last returned.
    let harness_session = init.session_id;
    const classified = await call({ harness_session, command: "classify", result_json: CLASSIFIED });
    assert.equal(classified.step_id, "gen.matter_profile", JSON.stringify(classified));
    harness_session = classified.session_id;
    assert.equal((await call({ harness_session, command: "resume" })).step_id, "gen.matter_profile");
    assert.deepEqual(await call({ command: "abandon", harness_session }), { action: "abandoned", session_id: harness_session });
    assert.deepEqual(readdirSync(join(f.caseData, "form-sessions")), []);
  } finally {
    f.cleanup();
  }
});

test("a session-scoped command needs harness_session, and the old session_id is an unknown field", async () => {
  const f = matterFixture();
  try {
    for (const command of ["classify", "step", "resume", "abandon", "reset", "clarify", "rewind"]) {
      await assert.rejects(callTool({}, TOOL, { matter_root: f.root, command }), new RegExp(`harness_session is required for command ${command}$`));
    }
    await assert.rejects(callTool({}, TOOL, { matter_root: f.root, command: "abandon", session_id: "s1" }), /unknown field "session_id"/);
  } finally {
    f.cleanup();
  }
});
