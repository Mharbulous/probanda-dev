// knowledge__write confirm and correct: the confirmation sidecar's write half
// (shared/knowledge-tree.md section 10, plan Phase 8). `by` is this machine's `person`,
// a lawyer on the firm roster; rows are upserted under a lock file, so concurrent
// confirmations from separate processes all land; a correction is validated by
// substitution into the merged file.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { knowledgeFile, knowledgeFixture, passageHash } from "./helpers/knowledge-fixture.mjs";

const TOOLS_URL = new URL("../build/knowledge/tools.js", import.meta.url).href;
const { knowledgeRead, knowledgeWrite } = await import(TOOLS_URL);

const CURRENCY = "September 1, 2020";
const PASSAGES = {
  "R-title": "Alpha: the registry copy governs.",
  "R-addr": "Bravo: address the registrar.",
  "R-echo": "Echo stays put.",
};
const RECORD = `---
page_url: https://fixture.test/rules
accessed: 2026-09-20
checked: 2026-09-20
currency_marker_pattern: 'Fixture Rules \\(as amended ([A-Z][a-z]+ \\d{1,2}, \\d{4})\\)'
currency_marker: ${CURRENCY}
fetch_note: fixture
items:
  - rule_ref: R-title
    passage: "${PASSAGES["R-title"]}"
  - rule_ref: R-addr
    passage: "${PASSAGES["R-addr"]}"
  - rule_ref: R-echo
    passage: ${PASSAGES["R-echo"]}
---
# Fixture rules excerpt
`;
const BLOCK = {
  renderer: "general",
  needs_forum_parts: true,
  folder_code: "LTR",
  title: { value: "Letter to the registry", rule_ref: "R-title" },
  exhibit_numbering: "writing",
  parts: [
    { heading: null, heading_numbering: "none", paragraph_numbering: "none", source: "addressee", rule_ref: "R-addr" },
    { heading: null, heading_numbering: "none", paragraph_numbering: "none", source: "slot:body" },
  ],
};
const FRONT = "learned_by: agent\naccessed: 2026-09-20\nmatter: L8443\nsources:\n  - ../Sources/rules.md";
const FILE = "draft/CAN/BC/BCSC/Documents/letter.md";
const SIDECAR = `${FILE}.confirmations.local.json`;
const ROSTER = [
  { key: "pe", name: "Pat Example", designation: "Barrister", role: "lawyer", email: "pe@example.com", direct_line: "1", closing: "Yours truly,", initials: "PE", active: true },
  { key: "st", name: "Sam Staff", designation: "Paralegal", role: "staff", email: "st@example.com", direct_line: "2", closing: "Regards,", initials: "SS", active: true },
  { key: "fl", name: "Fran Leaver", designation: "Barrister", role: "lawyer", email: "fl@example.com", direct_line: "3", closing: "Yours truly,", initials: "FL", active: false },
];

function fixture(t, person = "pe") {
  const f = knowledgeFixture(t);
  f.local(FILE, knowledgeFile(FRONT, BLOCK));
  f.local("draft/CAN/BC/BCSC/Sources/rules.md", RECORD);
  const firmDir = join(f.caseRoot, "_practice", "firm");
  mkdirSync(firmDir, { recursive: true });
  writeFileSync(join(firmDir, "firm.json"), JSON.stringify({ firm_name: "Example LLP", roster: ROSTER }));
  setPerson(f, person);
  return f;
}

function setPerson(f, person) {
  const config = { case_data_root: f.caseRoot, ...(person === null ? {} : { person }) };
  writeFileSync(join(f.seams.env.APPDATA, "Probanda", "probanda.json"), JSON.stringify(config));
}

const write = (f, args) => knowledgeWrite({ path: FILE, matter: "L8443", ...args }, f.seams);
const sidecarOf = (f) => JSON.parse(readFileSync(f.localPath(SIDECAR), "utf-8"));

async function rejection(promise) {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error("expected a rejection, got none");
}

function today() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

test("confirm writes one row with by, on, the passage hash, the currency marker and the writer's plugin version and shipped_from, and no value", async (t) => {
  const f = fixture(t);
  const result = await write(f, { operation: "confirm", rule_ref: "R-title" });
  assert.equal(result.sidecar, SIDECAR);
  const expected = {
    rule_ref: "R-title",
    status: "confirmed",
    by: "pe",
    on: today(),
    confirmed_against: { passage_hash: passageHash(PASSAGES["R-title"]), currency: CURRENCY },
    plugin_version: "9.9.9",
    shipped_from: "install",
  };
  assert.deepEqual(sidecarOf(f), { file: FILE, items: [expected] });
  const read = knowledgeRead(FILE, f.seams);
  assert.equal(read.items.find((item) => item.rule_ref === "R-title").status, "confirmed");
  assert.equal(read.items.find((item) => item.rule_ref === "R-addr").status, "unconfirmed");

  // A second confirmation of the same item replaces its row.
  await write(f, { operation: "confirm", rule_ref: "R-title" });
  assert.equal(sidecarOf(f).items.length, 1);
});

test("a staff key is refused, and an unset key is named", async (t) => {
  const f = fixture(t, "st");
  const staff = await rejection(write(f, { operation: "confirm", rule_ref: "R-title" }));
  assert.equal(staff.code, "not_a_lawyer");
  assert.match(staff.message, /person "st" is staff/);
  setPerson(f, null);
  const unset = await rejection(write(f, { operation: "confirm", rule_ref: "R-title" }));
  assert.equal(unset.code, "person_unset");
  assert.match(unset.message, /"person"/);
  assert.equal(existsSync(f.localPath(SIDECAR)), false);
});

test("an inactive roster lawyer is refused, named", async (t) => {
  const f = fixture(t, "fl");
  const err = await rejection(write(f, { operation: "confirm", rule_ref: "R-title" }));
  assert.equal(err.code, "not_active");
  assert.match(err.message, /person "fl" \(Fran Leaver\)/);
  assert.equal(existsSync(f.localPath(SIDECAR)), false);
});

test("correct on a /publish format.md succeeds; a tree file with no validator is not correctable", async (t) => {
  const f = fixture(t);
  const format = "publish/CAN/BC/BCSC/format.md";
  const front = "learned_by: agent\naccessed: 2026-09-20\nitems:\n  - rule_ref: F-paper\n    passage: Use letter-size paper.";
  f.local(format, knowledgeFile(front, { format: { paper: { value: "letter", rule_ref: "F-paper" } } }));
  const corrected = await write(f, { path: format, operation: "correct", rule_ref: "F-paper", value: "legal" });
  assert.equal(corrected.row.value, "legal");
  const stored = JSON.parse(readFileSync(f.localPath(`${format}.confirmations.local.json`), "utf-8")).items[0];
  assert.deepEqual([stored.plugin_version, stored.shipped_from], ["9.9.9", "install"], "a correction carries the writer's stamp");
  const read = knowledgeRead(format, f.seams);
  assert.deepEqual(read.format.paper, { value: "legal", rule_ref: "F-paper" });
  assert.deepEqual(read.corrections_substituted, ["F-paper"]);

  const assemble = "assemble/CAN/BC/BCSC/Documents/affidavit.md";
  f.local(assemble, knowledgeFile("learned_by: agent\naccessed: 2026-09-20\nitems:\n  - rule_ref: A-1\n    passage: Exhibits are stamped."));
  const err = await rejection(write(f, { path: assemble, operation: "correct", rule_ref: "A-1", value: "x" }));
  assert.equal(err.code, "not_correctable");
  assert.equal(existsSync(f.localPath(`${assemble}.confirmations.local.json`)), false);
});

test("a repo session's confirm and correct refuse", async (t) => {
  const f = fixture(t);
  for (const args of [{ operation: "confirm" }, { operation: "correct", value: "Letter" }]) {
    const err = await rejection(write(f, { ...args, rule_ref: "R-title", matter: "repo-run" }));
    assert.equal(err.code, "repo_session", args.operation);
  }
  assert.equal(existsSync(f.localPath(SIDECAR)), false);
});

test("correct records value on the corrected row only, validated by substitution into the merged file", async (t) => {
  const f = fixture(t);
  await write(f, { operation: "confirm", rule_ref: "R-addr" });
  const result = await write(f, { operation: "correct", rule_ref: "R-title", value: "Letter to the Registrar" });
  assert.equal(result.row.value, "Letter to the Registrar");
  const rows = sidecarOf(f).items;
  assert.equal(Object.hasOwn(rows.find((row) => row.rule_ref === "R-addr"), "value"), false);
  assert.equal(rows.find((row) => row.rule_ref === "R-title").status, "corrected");

  const read = knowledgeRead(FILE, f.seams);
  assert.deepEqual(read.layout.title, { value: "Letter to the Registrar", rule_ref: "R-title" });
  assert.deepEqual(read.corrections_substituted, ["R-title"]);

  // A value of the wrong shape fails the validator, and the sidecar is left as it was.
  const before = readFileSync(f.localPath(SIDECAR), "utf-8");
  const wrong = await rejection(write(f, { operation: "correct", rule_ref: "R-title", value: 42 }));
  assert.equal(wrong.code, "invalid_layout");
  const part = await rejection(write(f, { operation: "correct", rule_ref: "R-addr", value: "not a part object" }));
  assert.equal(part.code, "invalid_layout");
  assert.equal(readFileSync(f.localPath(SIDECAR), "utf-8"), before);
});

test("value is refused on confirm and required on correct; a rule_ref must be an item of the merged file", async (t) => {
  const f = fixture(t);
  assert.equal((await rejection(write(f, { operation: "confirm", rule_ref: "R-title", value: "x" }))).name, "ValidationError");
  assert.equal((await rejection(write(f, { operation: "correct", rule_ref: "R-title" }))).name, "ValidationError");
  const missing = await rejection(write(f, { operation: "confirm", rule_ref: "R-nowhere" }));
  assert.equal(missing.code, "rule_ref_not_found");
  assert.equal(existsSync(f.localPath(SIDECAR)), false);
});

test("a Sources excerpt may be confirmed but never corrected; a sidecar path is not a confirm target", async (t) => {
  const f = fixture(t);
  const path = "draft/CAN/BC/BCSC/Sources/rules.md";
  const err = await rejection(write(f, { path, operation: "correct", rule_ref: "R-echo", value: "Echo moved." }));
  assert.equal(err.code, "not_correctable");
  const confirmed = await write(f, { path, operation: "confirm", rule_ref: "R-echo" });
  assert.equal(confirmed.sidecar, `${path}.confirmations.local.json`);
  const sidecar = await rejection(write(f, { path: SIDECAR, operation: "confirm", rule_ref: "R-title" }));
  assert.equal(sidecar.code, "reserved_suffix");
});

test("a shipped file's confirmation lands in the overlay sidecar", async (t) => {
  const f = fixture(t);
  f.shipped(FILE, knowledgeFile(FRONT, BLOCK));
  f.shipped("draft/CAN/BC/BCSC/Sources/rules.md", RECORD);
  await write(f, { operation: "confirm", rule_ref: "R-echo" });
  assert.equal(sidecarOf(f).items[0].rule_ref, "R-echo");
  assert.equal(existsSync(join(f.installRoot, "skills", "draft", "references", "CAN", "BC", "BCSC", "Documents", "letter.md.confirmations.local.json")), false);
});

/** One confirmation, in its own process, as a second session's server would make it. */
function confirmInChild(f, ruleRef) {
  const args = { operation: "confirm", path: FILE, rule_ref: ruleRef, matter: "L8443" };
  const script = `const { knowledgeWrite } = await import(${JSON.stringify(TOOLS_URL)});\n` +
    `await knowledgeWrite(${JSON.stringify(args)}, ${JSON.stringify(f.seams)});\n`;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", script], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`confirm of ${ruleRef} exited ${code}: ${stderr}`))));
  });
}

test("concurrent confirmations of different items from separate processes all land", async (t) => {
  const f = fixture(t);
  await Promise.all(["R-title", "R-addr", "R-echo"].map((ref) => confirmInChild(f, ref)));
  const rows = sidecarOf(f).items;
  assert.deepEqual(rows.map((row) => row.rule_ref).sort(), ["R-addr", "R-echo", "R-title"]);
  assert.ok(rows.every((row) => row.by === "pe" && row.status === "confirmed"));
  assert.equal(existsSync(f.localPath(`${SIDECAR}.lock`)), false);
});
