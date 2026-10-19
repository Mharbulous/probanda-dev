// drafting_forms__bcsc_form_harness (#1267, ADR 0025): publish-bcsc-form's harness run host-side.
// Most tests drive a stub harness.py placed in a throwaway install root, so they check what the
// server passes and returns, not the harness. One test runs the real harness against a synthetic
// matter. Temp directories only; never a live matter.

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { codeOf, matterFixture } from "./helpers/housekeeping-fixture.mjs";

const { bcscFormHarness, bcscFormHarnessPath } = await import("../build/submission/bcsc-form-harness.js");
const { callTool } = await import("../build/dispatch.js");

// Echoes what it was given, or prints STUB_ACTION verbatim; STUB_SLEEP delays it, and STUB_NOISE is
// printed first, as fill_plain.py's "Written: <path>" is during a fill step.
const STUB = `import json, os, sys, time
if os.environ.get("STUB_SLEEP"):
    time.sleep(float(os.environ["STUB_SLEEP"]))
if os.environ.get("STUB_NOISE"):
    print(os.environ["STUB_NOISE"])
    print()
if os.environ.get("STUB_ACTION"):
    print(os.environ["STUB_ACTION"])
else:
    print(json.dumps({"action": "spawn_subagent", "argv": sys.argv[1:], "sessions_dir": os.environ.get("DRAFT_BCSC_SESSIONS_DIR")}))
sys.exit(0)
`;

/** A synthetic matter plus an install root holding the stub harness. */
function fixture() {
  const m = matterFixture();
  const install = join(m.base, "install");
  const scripts = join(install, "skills", "publish", "subskills", "publish-bcsc-form", "scripts");
  mkdirSync(scripts, { recursive: true });
  mkdirSync(join(install, "skills", "shared"), { recursive: true });
  writeFileSync(join(scripts, "harness.py"), STUB);
  const root = realpathSync.native(m.root);
  const caseData = realpathSync.native(m.caseData);
  const sessions = join(caseData, "form-sessions");
  const run = (args, env = {}) => bcscFormHarness({ matter_root: m.root, ...args }, { ...process.env, ...env }, install);
  /** A session folder as the harness would leave it, with `ctx` over this matter's own paths. */
  const session = (id, ctx = {}) => {
    mkdirSync(join(sessions, id), { recursive: true });
    writeFileSync(join(sessions, id, "ctx.json"), JSON.stringify({ session_id: id, matter_path: root, case_data_folder: caseData, writing_folder: "NOA Stay", ...ctx }));
  };
  return { ...m, install, scripts, root, caseData, sessions, run, session };
}

test("init derives the matter-data folder from coclerk.json and passes only resolved paths, with session state in form-sessions", () => {
  const f = fixture();
  try {
    const action = f.run({ command: "init", user_request: "generate a blank Notice of Application", writing_folder: "NOA Stay" });
    assert.deepEqual(action, {
      action: "spawn_subagent",
      argv: ["init", "--matter-path", f.root, "--matter-data-folder", f.caseData, "--writing-folder", "NOA Stay", "--", "generate a blank Notice of Application"],
      sessions_dir: f.sessions,
    });
  } finally {
    f.cleanup();
  }
});

test("init takes out_name in place of writing_folder for an individual form, and exactly one of the two", async () => {
  const f = fixture();
  try {
    const stem = "2026-10-01 REQ re default judgment";
    const action = f.run({ command: "init", user_request: "generate a requisition", out_name: stem });
    assert.deepEqual(action.argv, ["init", "--matter-path", f.root, "--matter-data-folder", f.caseData, "--out-name", stem, "--", "generate a requisition"]);
    const one = /exactly one of writing_folder \(a package\) and out_name \(an individual form\)/;
    assert.throws(() => f.run({ command: "init", user_request: "x" }), one);
    assert.throws(() => f.run({ command: "init", user_request: "x", writing_folder: "", out_name: "" }), one);
    // Through the tool surface: out_name is a known field, so the refusal is the exactly-one rule's.
    await assert.rejects(
      callTool({}, "drafting_forms__bcsc_form_harness", { matter_root: f.root, command: "init", user_request: "x", writing_folder: "NOA Stay", out_name: stem }),
      one
    );
  } finally {
    f.cleanup();
  }
});

test("the tool takes no matter-data path from the caller", async () => {
  const f = fixture();
  try {
    await assert.rejects(
      callTool({}, "drafting_forms__bcsc_form_harness", { matter_root: f.root, command: "list", case_data_folder: f.base }),
      /unknown field "case_data_folder"/
    );
  } finally {
    f.cleanup();
  }
});

test("the harness's JSON action comes back unchanged", () => {
  const f = fixture();
  try {
    const raw = { action: "ask_user", session_id: "s1", question: "Which form?", options: ["Form 32", "Form 33"], route_to: "classify", extra: { nested: [1, null, "x"] } };
    assert.deepEqual(f.run({ command: "list" }, { STUB_ACTION: JSON.stringify(raw) }), raw);
    assert.deepEqual(f.run({ command: "list" }, { STUB_ACTION: "[]" }), []);
  } finally {
    f.cleanup();
  }
});

test("output printed before the harness's JSON goes to stderr, and the JSON still comes back", () => {
  const f = fixture();
  try {
    const raw = { action: "spawn_subagent", session_id: "s1", step_id: "shared.verify", prompt: "p" };
    assert.deepEqual(f.run({ command: "list" }, { STUB_NOISE: "Written: C:\\x\\Notice of Application.docx", STUB_ACTION: JSON.stringify(raw) }), raw);
  } finally {
    f.cleanup();
  }
});

test("at an asm32 or asm33 locate step, result_json paths outside the matter-data folder are refused", () => {
  const f = fixture();
  const outside = mkdtempSync(join(tmpdir(), "coclerk-outside-"));
  try {
    const substance = join(f.caseData, "bcsc-form-substance");
    mkdirSync(substance);
    writeFileSync(join(substance, "form-32.md"), "x");
    writeFileSync(join(substance, "context.json"), "{}");
    writeFileSync(join(outside, "form-32.md"), "x");
    f.session("s32", { current_step: "asm32.locate" });
    f.session("s33", { current_step: "asm33.locate" });
    const step = (harness_session, data, envelope = true) =>
      f.run({ command: "step", harness_session, result_json: JSON.stringify(envelope ? { kind: "step_result", data } : data) });

    const inside = { form32_path: join(substance, "form-32.md"), context_path: join(substance, "context.json") };
    assert.equal(step("s32", inside).action, "spawn_subagent");
    for (const bad of [
      { ...inside, form32_path: join(outside, "form-32.md") },
      { ...inside, context_path: join(outside, "context.json") },
      { ...inside, form32_path: "form-32.md" },
      { ...inside, form32_path: join(substance, "..", "..", "form-32.md") },
    ]) {
      assert.equal(codeOf(() => step("s32", bad)), "path_out_of_scope", JSON.stringify(bad));
      assert.equal(codeOf(() => step("s32", bad, false)), "path_out_of_scope", JSON.stringify(bad));
    }
    symlinkSync(outside, join(substance, "linked"), "junction");
    assert.equal(codeOf(() => step("s32", { ...inside, form32_path: join(substance, "linked", "form-32.md") })), "path_out_of_scope");
    assert.equal(codeOf(() => step("s33", { form33_path: join(outside, "form-33.md") })), "path_out_of_scope");

    // Any other step's result passes through as content.
    f.session("sv", { current_step: "asm32.validate" });
    assert.equal(step("sv", { form32_path: join(outside, "form-32.md") }).action, "spawn_subagent");
  } finally {
    f.cleanup();
    rmSync(outside, { recursive: true, force: true });
  }
});

test("a session's stored Writing folder or out_name is confined again on every call", () => {
  const f = fixture();
  const outside = mkdtempSync(join(tmpdir(), "coclerk-outside-"));
  try {
    symlinkSync(outside, join(f.root, "0. DRAFT", "Linked"), "junction");
    f.session("linked", { writing_folder: "Linked" });
    f.session("dotted", { writing_folder: "..\\x" });
    f.session("dotted-name", { writing_folder: "", out_name: "..\\x" });
    for (const harness_session of ["linked", "dotted", "dotted-name"]) {
      assert.equal(codeOf(() => f.run({ command: "resume", harness_session })), "path_out_of_scope", harness_session);
    }
  } finally {
    f.cleanup();
    rmSync(outside, { recursive: true, force: true });
  }
});

test("each session command passes its session id and text argument after --", () => {
  const f = fixture();
  try {
    f.session("m__form-32__1");
    const cases = [
      [{ command: "step", result_json: '{"kind":"step_result","data":{}}' }, ["step", "--", "m__form-32__1", '{"kind":"step_result","data":{}}']],
      [{ command: "classify", result_json: "{}" }, ["classify", "--", "m__form-32__1", "{}"]],
      [{ command: "resume" }, ["resume", "--", "m__form-32__1"]],
      [{ command: "reset", new_request: "-an NOCC instead" }, ["reset", "--", "m__form-32__1", "-an NOCC instead"]],
      [{ command: "clarify", answer: "personal" }, ["clarify", "--", "m__form-32__1", "personal"]],
      [{ command: "rewind", target_step_id: "gen.scalars" }, ["rewind", "--", "m__form-32__1", "gen.scalars"]],
      [{ command: "abandon" }, ["abandon", "--", "m__form-32__1"]],
    ];
    for (const [args, argv] of cases) {
      const action = f.run({ harness_session: "m__form-32__1", ...args });
      assert.deepEqual(action.argv, argv, args.command);
      assert.equal(action.sessions_dir, f.sessions);
    }
    assert.throws(() => f.run({ command: "step", harness_session: "m__form-32__1" }), /result_json is required for command step/);
    assert.throws(() => f.run({ command: "init", user_request: "x" }), /exactly one of writing_folder \(a package\) and out_name/);
  } finally {
    f.cleanup();
  }
});

test("refuses a writing folder, out_name or session id that is not one name, or that resolves outside the matter", () => {
  const f = fixture();
  const outside = mkdtempSync(join(tmpdir(), "coclerk-outside-"));
  try {
    for (const writing_folder of ["..", ".", "a\\b", "a/b", "C:x"]) {
      assert.equal(codeOf(() => f.run({ command: "init", user_request: "x", writing_folder })), "path_out_of_scope", writing_folder);
      assert.equal(codeOf(() => f.run({ command: "init", user_request: "x", out_name: writing_folder })), "path_out_of_scope", writing_folder);
    }
    symlinkSync(outside, join(f.root, "0. DRAFT", "Linked"), "junction");
    assert.equal(codeOf(() => f.run({ command: "init", user_request: "x", writing_folder: "Linked" })), "path_out_of_scope");
    for (const harness_session of ["..", "..\\x", "../x", "C:x"]) {
      assert.equal(codeOf(() => f.run({ command: "resume", harness_session })), "path_out_of_scope", harness_session);
      assert.equal(codeOf(() => f.run({ command: "abandon", harness_session })), "path_out_of_scope", harness_session);
    }
    mkdirSync(f.sessions);
    symlinkSync(outside, join(f.sessions, "linked"), "junction");
    assert.equal(codeOf(() => f.run({ command: "abandon", harness_session: "linked" })), "path_out_of_scope");
    assert.deepEqual(readdirSync(outside), []);
  } finally {
    f.cleanup();
    rmSync(outside, { recursive: true, force: true });
  }
});

test("refuses a form-sessions folder that is a link elsewhere", () => {
  const f = fixture();
  const outside = mkdtempSync(join(tmpdir(), "coclerk-outside-"));
  try {
    symlinkSync(outside, f.sessions, "junction");
    assert.equal(codeOf(() => f.run({ command: "list" })), "path_out_of_scope");
  } finally {
    f.cleanup();
    rmSync(outside, { recursive: true, force: true });
  }
});

test("refuses a session made for another matter or matter-data folder, but abandon clears it", () => {
  const f = fixture();
  try {
    f.session("sandbox", { matter_path: "/sessions/x/mnt/Matter", case_data_folder: "/sessions/x/mnt/case data" });
    f.session("other", { matter_path: f.base });
    for (const harness_session of ["sandbox", "other"]) {
      assert.throws(() => f.run({ command: "resume", harness_session }), (err) => err.code === "path_out_of_scope" && /abandon it/i.test(err.message));
      assert.deepEqual(f.run({ command: "abandon", harness_session }).argv, ["abandon", "--", harness_session]);
    }
    assert.equal(codeOf(() => f.run({ command: "resume", harness_session: "missing" })), "session_not_found");
  } finally {
    f.cleanup();
  }
});

test("refuses a matter with no coclerk.json and a matter whose matter-data folder does not exist", () => {
  const f = fixture();
  try {
    assert.equal(codeOf(() => bcscFormHarness({ matter_root: f.base, command: "list" }, process.env, f.install)), "invalid_root");
    rmSync(f.caseData, { recursive: true });
    assert.equal(codeOf(() => f.run({ command: "list" })), "case_data_missing");
    assert.equal(existsSync(f.caseData), false);
  } finally {
    f.cleanup();
  }
});

test("refuses the new-template operation, whether the harness routes to it or a session is already on it", () => {
  const f = fixture();
  try {
    f.session("s1");
    const missing = JSON.stringify({ action: "missing_template", session_id: "s1", form_id: "form-99", message: "not registered" });
    assert.throws(() => f.run({ command: "classify", harness_session: "s1", result_json: "{}" }, { STUB_ACTION: missing }), (err) => err.code === "new_template_refused" && /abandon and harness_session s1/.test(err.message));
    const inspect = JSON.stringify({ action: "spawn_subagent", session_id: "s1", step_id: "nt.inspect_tmpl", prompt: "p" });
    assert.equal(codeOf(() => f.run({ command: "classify", harness_session: "s1", result_json: "{}" }, { STUB_ACTION: inspect })), "new_template_refused");

    f.session("s2", { mode: "new-template", sequence: "new-template", current_step: "nt.configure" });
    // STUB_ACTION would pass: the refusal comes before the harness runs.
    assert.equal(codeOf(() => f.run({ command: "step", harness_session: "s2", result_json: "{}" }, { STUB_ACTION: "{}" })), "new_template_refused");
    assert.deepEqual(f.run({ command: "abandon", harness_session: "s2" }).argv, ["abandon", "--", "s2"]);
  } finally {
    f.cleanup();
  }
});

test("a call over its budget fails with python_timeout and says to resume the same session", () => {
  const f = fixture();
  try {
    f.session("s1");
    assert.throws(
      () => f.run({ command: "step", harness_session: "s1", result_json: "{}" }, { STUB_SLEEP: "10", COCLERK_BCSC_HARNESS_TIMEOUT_MS: "500" }),
      (err) => err.code === "python_timeout" && /Session s1 is normally not advanced/.test(err.message) && /command resume and the same harness_session/.test(err.message) && /Claude Code \(PC\) session/.test(err.message) && /writes a new " vN" copy/.test(err.message) && !/\(vN\)/.test(err.message)
    );
  } finally {
    f.cleanup();
  }
});

test("a timed-out classify, reset or clarify says the session may be renamed and to find it with list", () => {
  const f = fixture();
  try {
    f.session("s1");
    const slow = { STUB_SLEEP: "10", COCLERK_BCSC_HARNESS_TIMEOUT_MS: "500" };
    for (const args of [{ command: "classify", result_json: "{}" }, { command: "reset", new_request: "x" }, { command: "clarify", answer: "x" }]) {
      assert.throws(
        () => f.run({ harness_session: "s1", ...args }, slow),
        (err) => err.code === "python_timeout" && /may have been renamed/.test(err.message) && /command list/.test(err.message) && !/the same harness_session/.test(err.message) && !/is normally not advanced/.test(err.message),
        args.command
      );
    }
  } finally {
    f.cleanup();
  }
});

test("harness.py resolves install-first, and from the checkout when the install bundles no skill source", () => {
  const f = fixture();
  try {
    assert.equal(bcscFormHarnessPath(process.env, f.install), join(f.scripts, "harness.py"));
    const checkout = bcscFormHarnessPath(process.env, join(f.base, "no-install"));
    assert.match(checkout, /[\\/]\.claude[\\/]skills[\\/]publish[\\/]subskills[\\/]publish-bcsc-form[\\/]scripts[\\/]harness\.py$/);
  } finally {
    f.cleanup();
  }
});

test("the real harness completes a fill step, whose fill script prints to stdout, and moves on to verify", () => {
  const f = fixture();
  const real = (args) => bcscFormHarness({ matter_root: f.root, ...args }, process.env, join(f.base, "no-install"));
  try {
    // A Form 17 Generate session paused at gen.fill, as gen.scalars leaves it.
    f.session("m__form-17__1", {
      user_request: "generate a requisition", form_id: "form-17", form_name: "Requisition", form_registered: true, mode: "regular",
      operation: "generate", sequence: "generate", step_index: 2, current_step: "gen.fill", step_answers: [], profile: {},
      profile_confirmed: true, scalars: { title: "Requisition" }, output_path: null, stale_outputs: [], attempts: 0,
    });
    const action = real({ command: "step", harness_session: "m__form-17__1", result_json: '{"kind":"step_result","data":{"ready":true}}' });
    assert.equal(action.action, "spawn_subagent", JSON.stringify(action));
    assert.equal(action.step_id, "shared.verify");
    assert.ok(existsSync(join(f.root, "0. DRAFT", "NOA Stay", "Requisition.docx")));
    assert.ok(existsSync(join(f.caseData, "bcsc-form-substance", "context.json")));
    const ctx = JSON.parse(readFileSync(join(f.sessions, "m__form-17__1", "ctx.json"), "utf-8"));
    assert.equal(ctx.current_step, "shared.verify");
  } finally {
    f.cleanup();
  }
});

/** Why the real asm32 fill cannot render here, or null when it can. */
function rendererUnavailable() {
  const word = process.platform === "win32" && spawnSync("reg", ["query", "HKCR\\Word.Application"]).status === 0;
  const soffice = spawnSync("soffice", ["--version"]).status === 0;
  return word || soffice ? null : "neither Word nor LibreOffice is installed";
}

const FORM32 = [
  "---",
  "proposed_hearing: November 2, 2026",
  "hearing_place: 800 Smithe Street",
  "registry: Vancouver",
  "time_estimate: 45 minutes",
  "associate_judge: yes",
  'orders: [{"order": 1, "text": "costs", "against": ["Beta Company Ltd."]}]',
  "appendix_types: []",
  "---",
  "",
  "## Part 2",
  "",
  "1. A fact.",
  "",
  "## Part 3",
  "",
  "2. The rule in Bankes v. Jarvis, [1903] 1 K.B. 549 applies.",
  "",
  "## Part 4",
  "",
  "- A document",
  "",
].join("\n");

const FORM32_CONTEXT = {
  correction_required: [], title: "Stay Application", court_file_number: "S-123456", registry: "Vancouver",
  court_location: "800 Smithe Street", plaintiff_caption: "ALPHA COMPANY LTD.", plaintiff_role: "Plaintiff",
  defendant_caption: "BETA COMPANY LTD.", defendant_role: "Defendant", applicant_names: "Alpha Company Ltd.",
  to_affected_parties: "Beta Company Ltd.", client_name: "Alpha Company Ltd.", lawyer_name: "Alex Example",
};

// Every asm32 step's result is computed in-process, so init runs locate through verify in one call,
// inside the server's 55 s budget, and never stops for a subagent. A law-report year is not a placeholder.
// The caption comes from the emitter's publish sidecar, and the form-32.md meets every Form 32
// conformance check, so verify reports nothing.
test("the real harness runs asm32 from init to done in one call", { skip: rendererUnavailable() ?? false }, (t) => {
  const f = fixture();
  const real = (args) => bcscFormHarness({ matter_root: f.root, ...args }, process.env, join(f.base, "no-install"));
  try {
    const substance = join(f.caseData, "bcsc-form-substance");
    mkdirSync(substance, { recursive: true });
    writeFileSync(join(substance, "form-32.md"), FORM32);
    writeFileSync(join(substance, "form-32-publish.json"), JSON.stringify({ caption: FORM32_CONTEXT, warnings: [] }));
    const started = Date.now();
    const action = real({ command: "init", user_request: "asm32", writing_folder: "NOA Stay" });
    t.diagnostic(`asm32 init to done: ${Date.now() - started} ms`);
    assert.equal(action.action, "done", JSON.stringify(action));
    assert.equal(action.verify_passed, true, JSON.stringify(action));
    assert.deepEqual(action.verify_warnings, []);
    assert.ok(existsSync(join(f.root, "0. DRAFT", "NOA Stay", "Stay Application.docx")));
  } finally {
    f.cleanup();
  }
});

test("the real harness starts a session under the matter-data folder's form-sessions, with the resolved paths", () => {
  const f = fixture();
  const env = { ...process.env, PYTHONDONTWRITEBYTECODE: "1" };
  const real = (args) => bcscFormHarness({ matter_root: f.root, ...args }, env, join(f.base, "no-install"));
  try {
    const action = real({ command: "init", user_request: "generate a blank Notice of Application", writing_folder: "NOA Stay" });
    assert.equal(action.action, "spawn_subagent");
    assert.equal(action.route_to, "classify");
    const ctx = JSON.parse(readFileSync(join(f.sessions, action.session_id, "ctx.json"), "utf-8"));
    assert.equal(ctx.matter_path, f.root);
    assert.equal(ctx.case_data_folder, f.caseData);
    assert.equal(ctx.writing_folder, "NOA Stay");
    assert.deepEqual(real({ command: "list" }).map((s) => s.session_id), [action.session_id]);
    assert.deepEqual(real({ command: "abandon", harness_session: action.session_id }), { action: "abandoned", session_id: action.session_id });
    assert.deepEqual(readdirSync(f.sessions), []);
  } finally {
    f.cleanup();
  }
});

test("classify renames the session: the latest response's id drives resume and abandon, and the init id is gone", async () => {
  const f = fixture();
  const env = { ...process.env, PYTHONDONTWRITEBYTECODE: "1" };
  const real = (args) => bcscFormHarness({ matter_root: f.root, ...args }, env, join(f.base, "no-install"));
  try {
    const init = real({ command: "init", user_request: "generate a requisition", out_name: "2026-10-01 REQ re default judgment" });
    const data = { mode: "regular", form_id: "form-17", form_name: "Requisition", registered: true, op_id: "generate", confidence: 0.95, ambiguous: false };
    const classified = real({ command: "classify", harness_session: init.session_id, result_json: JSON.stringify({ kind: "step_result", data }) });
    assert.notEqual(classified.session_id, init.session_id);
    assert.match(classified.session_id, /__form-17__/);
    // Through the tool surface: the stale id is refused before the harness runs, so no install root is needed.
    await assert.rejects(
      callTool({}, "drafting_forms__bcsc_form_harness", { matter_root: f.root, command: "resume", harness_session: init.session_id }),
      (err) => err.code === "session_not_found"
    );
    const resumed = real({ command: "resume", harness_session: classified.session_id });
    assert.equal(resumed.session_id, classified.session_id);
    assert.deepEqual(real({ command: "abandon", harness_session: resumed.session_id }), { action: "abandoned", session_id: resumed.session_id });
    assert.deepEqual(readdirSync(f.sessions), []);
  } finally {
    f.cleanup();
  }
});
