// drafting_forms__draft_harness (#1453, ADR 0031): /draft's host steps for a Cowork session. Step
// write_email runs the real write_eml.py against a synthetic matter and firm roster. The script
// reads this PC's Outlook profile, which has no account for the fixture's address, so the draft is
// plain text here; elsewhere it may carry a signature. Temp directories only; never a live matter.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { codeOf } from "./helpers/housekeeping-fixture.mjs";

const { draftHarness } = await import("../build/submission/draft-harness.js");
const { buildToolDefinitions } = await import("../build/schema-gen.js");
const { callTool } = await import("../build/dispatch.js");

const PYTHON = process.env.COCLERK_PYTHON || "python";
const TOOL = "drafting_forms__draft_harness";
const NAME = "2026-10-02 EM Bert re invoice";
const BODY = "Dear Bert,\n\nPlease pay the invoice.\n\nThank you";

const ENTRY = { key: "pe", name: "Pat Example", designation: "Lawyer", role: "lawyer", email: "pat@example.com", direct_line: "555-0100", closing: "Yours truly,", initials: "PE" };

/** A matter with one 0. DRAFT folder, a firm roster, and a config naming `person`. */
function fixture(t, { person = "pe", entry = ENTRY } = {}) {
  const base = mkdtempSync(join(tmpdir(), "coclerk-draft-harness-"));
  t.after(() => rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));
  const root = join(base, "L0000 Matter");
  mkdirSync(join(root, "0. DRAFT"), { recursive: true });
  mkdirSync(join(root, "3. CORRESPONDENCE"));
  writeFileSync(join(root, "3. CORRESPONDENCE", "invoice.pdf"), "%PDF-1.4");
  writeFileSync(join(root, "coclerk.json"), JSON.stringify({ schema_version: 5, matter_root: root, case_data_dir: join(base, "case data") }));
  const caseDataRoot = join(base, "0. CASE DATA");
  mkdirSync(join(caseDataRoot, "_practice", "firm"), { recursive: true });
  writeFileSync(join(caseDataRoot, "_practice", "firm", "firm.json"), JSON.stringify({ firm_name: "Fixture Law LLP", roster: [entry] }));
  const config = join(base, "coclerk.json");
  writeFileSync(config, JSON.stringify({ case_data_root: caseDataRoot, ...(person ? { person } : {}) }));
  const outside = join(base, "Elsewhere");
  mkdirSync(outside);
  const env = { ...process.env, COCLERK_CONFIG_PATH: config };
  const canon = realpathSync.native(root);
  const args = { step: "write_email", matter_root: canon, output_name: NAME, to: ["Bert Other <bert@example.org>"], subject: "Invoice 7413", body: BODY };
  return {
    root: canon,
    draft: join(canon, "0. DRAFT"),
    practice: join(realpathSync.native(caseDataRoot), "_practice"),
    outside: realpathSync.native(outside),
    env,
    args,
    run: (extra = {}) => draftHarness({ ...args, ...extra }, env),
    runNoMatter: (extra = {}) => draftHarness({ ...args, matter_root: undefined, ...extra }, env),
  };
}

/** The draft's headers, body and attachment names, as Python's email parser reads them. */
function parsed(path) {
  const code = `import json, sys
from email import policy
from email.parser import BytesParser
with open(sys.argv[1], "rb") as f:
    m = BytesParser(policy=policy.default).parse(f)
print(json.dumps({k: m[k] for k in ("X-Unsent", "From", "To", "Cc", "Subject", "Date")} | {"body": m.get_body(("plain",)).get_content(), "attachments": [a.get_filename() for a in m.iter_attachments()]}))`;
  const res = spawnSync(PYTHON, ["-c", code, path], { encoding: "utf-8" });
  assert.equal(res.status, 0, res.stderr);
  return JSON.parse(res.stdout);
}

test("draft_harness: registered after publish_general, taking a step and that step's arguments", async (t) => {
  const tools = buildToolDefinitions();
  const at = tools.findIndex((d) => d.name === TOOL);
  assert.ok(at > 0, "not in buildToolDefinitions()");
  assert.equal(tools[at - 1].name, "drafting_forms__publish_general");
  assert.deepEqual(Object.keys(tools[at].inputSchema.properties), [
    "step", "matter_root", "output_name", "folder", "to", "cc", "to_service_list", "proceeding_id", "filing_id", "subject", "body", "attachments",
    "db_path", "statement_id", "context_paras", "source_path", "proposed",
  ]);
  assert.deepEqual(tools[at].inputSchema.required, ["step"]);
  const f = fixture(t);
  await assert.rejects(callTool({}, TOOL, { ...f.args, bcc: ["x@example.org"] }), /unknown field "bcc"/);
});

test("draft_harness: an unknown step is refused, through the tool surface and directly, writing nothing", async (t) => {
  const f = fixture(t);
  await assert.rejects(callTool({}, TOOL, { ...f.args, step: "send_email" }), /step must be one of: write_email, scrutiny_review$/);
  assert.throws(() => f.run({ step: "send_email" }), /step must be one of: write_email, scrutiny_review \(got "send_email"\)/);
  assert.deepEqual(readdirSync(f.draft), []);
});

test("write_email: writes <output_name>.eml at the top of the 0. DRAFT folder, From the roster, with a relative attachment", (t) => {
  const f = fixture(t);
  const result = f.run({ cc: ["cara@example.net"], attachments: ["3. CORRESPONDENCE\\invoice.pdf"] });
  assert.equal(result.success, true, JSON.stringify(result));
  assert.equal(result.path, join(f.draft, `${NAME}.eml`));
  assert.equal("versioned_from" in result, false);
  assert.ok(result.signature === null || typeof result.signature === "string", JSON.stringify(result));
  assert.deepEqual(result.attachments, [{ name: "invoice.pdf", size: 8 }]);
  assert.deepEqual(readdirSync(f.draft), [`${NAME}.eml`]);
  const eml = parsed(result.path);
  assert.equal(eml["X-Unsent"], "1");
  assert.equal(eml.From, "Pat Example <pat@example.com>");
  assert.equal(eml.To, "Bert Other <bert@example.org>");
  assert.equal(eml.Cc, "cara@example.net");
  assert.equal(eml.Subject, "Invoice 7413");
  assert.equal(eml.Date, null);
  assert.ok(eml.body.startsWith(BODY), eml.body);
  assert.deepEqual(eml.attachments, ["invoice.pdf"]);
});

test("write_email: refuses from_unresolved with no person, or no email on its entry, before writing anything", (t) => {
  for (const options of [{ person: null }, { entry: { ...ENTRY, email: "" } }]) {
    const f = fixture(t, options);
    const result = f.run({ folder: "Bert letters" });
    assert.deepEqual([result.success, result.error], [false, "from_unresolved"], JSON.stringify(result));
    assert.match(result.detail, /practice_data__upsert_firm_profile/);
    assert.deepEqual(readdirSync(f.draft), []);
  }
});

test("write_email: folder is one name under 0. DRAFT, created when absent; a path, '..' or a link elsewhere is refused", (t) => {
  const f = fixture(t);
  const result = f.run({ folder: "Bert letters" });
  assert.equal(result.success, true, JSON.stringify(result));
  assert.equal(result.path, join(f.draft, "Bert letters", `${NAME}.eml`));
  assert.deepEqual(readdirSync(join(f.draft, "Bert letters")), [`${NAME}.eml`]);

  for (const folder of ["..", ".", "a\\b", "a/b", "C:x"]) {
    assert.equal(codeOf(() => f.run({ folder })), "path_out_of_scope", folder);
  }
  for (const output_name of ["..", "a\\b", "..\\x"]) {
    assert.equal(codeOf(() => f.run({ output_name })), "path_out_of_scope", output_name);
  }
  symlinkSync(f.outside, join(f.draft, "Linked"), "junction");
  assert.equal(codeOf(() => f.run({ folder: "Linked" })), "path_out_of_scope");
  assert.deepEqual(readdirSync(f.outside), []);
  assert.deepEqual(readdirSync(f.draft).sort(), ["Bert letters", "Linked"]);
});

test("write_email: refuses a matter with no 0. DRAFT folder, or with two, creating none", (t) => {
  const f = fixture(t);
  mkdirSync(join(f.root, "0. DRAFT old"));
  assert.equal(codeOf(() => f.run()), "draft_dir_ambiguous");
  rmSync(join(f.root, "0. DRAFT old"), { recursive: true });
  rmSync(f.draft, { recursive: true });
  assert.equal(codeOf(() => f.run()), "draft_dir_missing");
  assert.equal(codeOf(() => f.run({ folder: "Bert letters" })), "draft_dir_missing");
  assert.deepEqual(readdirSync(f.root).filter((name) => /^0\. DRAFT/i.test(name)), []);
});

test("write_email: attachment_unresolved names every missing attachment, and nothing is written", (t) => {
  const f = fixture(t);
  const missing = [join(f.outside, "gone.pdf"), "3. CORRESPONDENCE\\also gone.docx"];
  const result = f.run({ attachments: ["3. CORRESPONDENCE\\invoice.pdf", ...missing] });
  assert.deepEqual([result.success, result.error], [false, "attachment_unresolved"], JSON.stringify(result));
  assert.ok(result.detail.includes(missing[0]), result.detail);
  assert.ok(result.detail.includes(join(f.root, missing[1])), result.detail);
  assert.ok(!result.detail.includes("invoice.pdf"), result.detail);
  assert.deepEqual(readdirSync(f.draft), []);
  const inFolder = f.run({ folder: "Bert letters", attachments: missing });
  assert.equal(inFolder.error, "attachment_unresolved", JSON.stringify(inFolder));
  assert.deepEqual(readdirSync(f.draft), [], "a refused call leaves no new folder behind");
});

test("write_email: refuses from_unresolved when the firm profile itself is missing", (t) => {
  const f = fixture(t);
  rmSync(join(f.root, "..", "0. CASE DATA", "_practice", "firm", "firm.json"));
  const result = f.run();
  assert.deepEqual([result.success, result.error], [false, "from_unresolved"], JSON.stringify(result));
  assert.deepEqual(readdirSync(f.draft), []);
});

test("write_email: a taken name gets \" v2\", reports versioned_from, and leaves the first copy untouched", (t) => {
  const f = fixture(t);
  const first = f.run();
  assert.equal(first.success, true, JSON.stringify(first));
  const bytes = readFileSync(first.path);
  const again = f.run({ subject: "Invoice 7413, again" });
  assert.equal(again.success, true, JSON.stringify(again));
  assert.equal(again.path, join(f.draft, `${NAME} v2.eml`));
  assert.equal(again.versioned_from, first.path);
  assert.ok(readFileSync(first.path).equals(bytes));
  assert.deepEqual(readdirSync(f.draft).sort(), [`${NAME} v2.eml`, `${NAME}.eml`]);
  assert.equal(existsSync(join(f.draft, `${NAME} v3.eml`)), false);
});

test("write_email: with no matter_root, writes under <case_data_root>\\_practice\\drafts, created when absent, From the roster", (t) => {
  const f = fixture(t);
  const drafts = join(f.practice, "drafts");
  assert.equal(existsSync(drafts), false);
  const result = f.runNoMatter();
  assert.equal(result.success, true, JSON.stringify(result));
  assert.equal(result.path, join(drafts, `${NAME}.eml`));
  const eml = parsed(result.path);
  assert.equal(eml["X-Unsent"], "1");
  assert.equal(eml.From, "Pat Example <pat@example.com>");
  assert.ok(eml.body.startsWith(BODY), eml.body);
  const attached = f.runNoMatter({ attachments: [join(f.root, "3. CORRESPONDENCE", "invoice.pdf")] });
  assert.equal(attached.path, join(drafts, `${NAME} v2.eml`), JSON.stringify(attached));
  assert.deepEqual(attached.attachments, [{ name: "invoice.pdf", size: 8 }]);
  assert.deepEqual(readdirSync(f.draft), [], "the matter's 0. DRAFT is not touched");
});

test("write_email: with no matter_root, folder is one name under the firm drafts folder; a path or a link elsewhere is refused", (t) => {
  const f = fixture(t);
  const result = f.runNoMatter({ folder: "Bert letters" });
  assert.equal(result.success, true, JSON.stringify(result));
  assert.equal(result.path, join(f.practice, "drafts", "Bert letters", `${NAME}.eml`));
  for (const folder of ["..", "a\\b", "C:x"]) {
    assert.equal(codeOf(() => f.runNoMatter({ folder })), "path_out_of_scope", folder);
  }
  symlinkSync(f.outside, join(f.practice, "drafts", "Linked"), "junction");
  assert.equal(codeOf(() => f.runNoMatter({ folder: "Linked" })), "path_out_of_scope");
  rmSync(join(f.practice, "drafts"), { recursive: true });
  symlinkSync(f.outside, join(f.practice, "drafts"), "junction");
  assert.equal(codeOf(() => f.runNoMatter()), "path_out_of_scope");
  assert.deepEqual(readdirSync(f.outside), []);
});

test("write_email: with no matter_root, a relative attachment or no sender is refused, writing nothing", (t) => {
  const f = fixture(t);
  assert.throws(() => f.runNoMatter({ attachments: ["3. CORRESPONDENCE\\invoice.pdf"] }), /must be absolute paths when no matter_root/);
  const noPerson = fixture(t, { person: null });
  const result = noPerson.runNoMatter();
  assert.deepEqual([result.success, result.error], [false, "from_unresolved"], JSON.stringify(result));
  for (const each of [f, noPerson]) assert.equal(existsSync(join(each.practice, "drafts")), false);
});

test("scrutiny_review: still refuses with no matter_root", (t) => {
  const f = fixture(t);
  assert.equal(codeOf(() => draftHarness({ step: "scrutiny_review", db_path: join(f.root, "x.db"), statement_id: 1 }, f.env)), "invalid_root");
});
