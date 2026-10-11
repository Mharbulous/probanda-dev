// knowledge__read (spec §3.2, plan Phase 7): roots and confinement, the folder grammar,
// the layout and format validators failing hard (shared/declared-layout.md,
// shared/declared-format.md), and provenance on every result.

import assert from "node:assert/strict";
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import test from "node:test";

import { errorOf, knowledgeFile, knowledgeFixture, matterFixture, passageHash, useProcessEnv } from "./helpers/knowledge-fixture.mjs";

const { knowledgeList, knowledgeRead } = await import("../build/knowledge/tools.js");
const { buildToolDefinitions } = await import("../build/schema-gen.js");
const { callTool } = await import("../build/dispatch.js");

const VENUE_BLOCK = {
  caption_lines: ["IN THE SUPREME COURT OF BRITISH COLUMBIA"],
  file_number_label: "No.",
  registry_label: null,
  party_roles: { applicant: "Applicant", respondent: "Respondent" },
  display_label: "BCSC",
};
const TYPE_BLOCK = {
  renderer: "bespoke",
  needs_forum_parts: true,
  folder_code: "NOA",
  title: "Notice of Application",
  exhibit_numbering: "writing",
  goal_criteria: ["orders-sought", "counsel-review"],
  companions: ["written-arguments"],
  page_limit: 10,
};

function readError(f, path) {
  return errorOf(() => knowledgeRead(path, f.seams));
}

test("a vetted shipped type file reads with its validated layout and full provenance", (t) => {
  const f = knowledgeFixture(t);
  f.shipped("draft/CAN/BC/BCSC/Documents/notice-of-application.md", knowledgeFile("kind: notice_of_application", TYPE_BLOCK));
  const result = knowledgeRead("draft\\CAN\\BC\\BCSC\\Documents\\notice-of-application.md", f.seams);
  assert.equal(result.path, "draft/CAN/BC/BCSC/Documents/notice-of-application.md");
  assert.equal(result.layer, "shipped");
  assert.equal(result.learned, false);
  assert.deepEqual(result.items, []);
  assert.deepEqual(result.layout, TYPE_BLOCK);
  assert.deepEqual(result.header, { kind: "notice_of_application" });
  assert.deepEqual([result.shipped_from, result.plugin_version, result.build_stamp], ["install", "9.9.9", null]);
});

test("paths are relative, start with a tree-owning skill or a reserved entry, and pass the Windows and OneDrive name rules", (t) => {
  const f = knowledgeFixture(t);
  for (const bad of [
    "../draft/CAN/BC/venues.json",
    "C:\\Windows\\win.ini",
    "\\\\server\\share\\x.md",
    "/draft/CAN/BC/venues.json",
    "case-data/CAN/BC/venues.json",
    "Draft/CAN/BC/venues.json",
    "draft/CAN/BC/BCSC/Documents/CON.md",
    "draft/CAN/BC/BCSC/Documents/a?b.md",
    "draft/CAN/BC/BCSC/Documents/trailing.md ",
    "draft/CAN/BC/BCSC/Documents/~$lock.md",
    "draft/CAN/BC/BCSC/Documents/x_vti_y.md",
  ]) {
    assert.equal(readError(f, bad).code, "path_out_of_scope", bad);
  }
  const long = `draft/CAN/BC/BCSC/Documents/${"x".repeat(240)}.md`;
  assert.equal(readError(f, long).code, "path_too_long");
});

test("a path breaking the folder grammar is refused, naming the rule", (t) => {
  const f = knowledgeFixture(t);
  for (const [path, rule] of [
    ["draft/letters.md", /three-letter ISO country code/],
    ["draft/CAN/BC/_Bad/Documents/x.md", /_NoVenue is the only member/],
    ["draft/CAN/BC/_NoVenue/venue.md", /refused under _NoVenue/],
    ["draft/CAN/BC/_NoVenue/Locations/Vancouver/notes.md", /Locations\\ is refused under _NoVenue/],
    ["draft/CAN/BC/BCSC/format.md", /format\.md sits only in \/publish's tree/],
    ["publish/CAN/BC/BCSC/venue.md", /venue\.md sits only in \/draft's tree/],
    ["draft/CAN/BC/BCSC/Notes/x.md", /not a venue folder/],
    ["draft/CAN/BC/BCSC/Documents/x.txt", /holds \.md files only/],
    ["legal-research/CAN/BC/BCSC/Documents/x.md", /holds no Documents/],
  ]) {
    const err = readError(f, path);
    assert.equal(err.code, "grammar_violation", path);
    assert.match(err.message, rule, path);
  }
  assert.equal(readError(f, "draft/CAN/BC/BCSC/venue.md").code, "not_found");
});

test("a missing case data root fails hard rather than reading the shipped layer alone", (t) => {
  const f = knowledgeFixture(t);
  f.shipped("draft/CAN/BC/BCSC/venue.md", knowledgeFile(null, VENUE_BLOCK));
  rmSync(f.caseRoot, { recursive: true, force: true });
  const err = readError(f, "draft/CAN/BC/BCSC/venue.md");
  assert.match(err.message, /case_data_root does not exist/);
});

test("reserved overlay entries are served from the overlay as they are", (t) => {
  const f = knowledgeFixture(t);
  f.local("_hosts.json", [{ host: "example.test", category: "venue", page_url: "https://example.test/", added: "2026-09-20", approved_by: "practitioner" }]);
  const hosts = knowledgeRead("_hosts.json", f.seams);
  assert.equal(hosts.layer, "local");
  assert.equal(hosts.shipped_from, null);
  assert.match(hosts.content, /example\.test/);
  assert.equal(readError(f, "_hosts.json/x").code, "grammar_violation");
  mkdirSync(join(f.overlay, "_inbox"), { recursive: true });
  assert.equal(readError(f, "_inbox/saved.html").code, "not_found");
});

// ------------------------------------------------------------ layout validator --

test("the layout validator fails hard on every broken rule, naming file, field and rule", (t) => {
  const f = knowledgeFixture(t);
  const path = "draft/CAN/BC/BCSC/Documents/notice-of-application.md";
  const general = (parts) => ({ ...TYPE_BLOCK, renderer: "general", parts });
  const part = { heading: null, heading_numbering: "none", paragraph_numbering: "none", source: "slot:body" };
  for (const [block, field, rule] of [
    [{ ...TYPE_BLOCK, typeface: "Arial" }, "typeface", /typography is not in the layout contract/],
    [{ ...TYPE_BLOCK, folder_code: undefined }, "folder_code", /is required; a missing required field has no default/],
    [{ ...TYPE_BLOCK, renderer: "fancy" }, "renderer", /must be one of bespoke, general/],
    [{ ...TYPE_BLOCK, renderer: { value: "general", rule_ref: "R1" } }, "renderer", /never carries a rule_ref/],
    [{ ...TYPE_BLOCK, parts: [part] }, "parts", /a bespoke type declares no parts/],
    [{ ...TYPE_BLOCK, renderer: "general" }, "parts", /is required on a general type/],
    [general([{ ...part, source: "letterhead-logo" }]), "parts[0].source", /closed vocabulary/],
    [general([{ ...part, source: "literal" }]), "parts[0].text", /non-empty string/],
    [general([{ ...part, text: "stray" }]), "parts[0].text", /present only when source is literal/],
    [general([{ ...part, heading_numbering: "roman" }]), "parts[0].heading_numbering", /none, part-roman, part-arabic, letter/],
    [{ ...TYPE_BLOCK, goal_criteria: ["gate"] }, "goal_criteria[0]", /universal/],
    [{ ...TYPE_BLOCK, goal_criteria: ["tickets"] }, "goal_criteria[0]", /must be one of/],
    [{ ...TYPE_BLOCK, goal_criteria: ["page-count"] }, "goal_criteria[0]", /must be one of/],
    [{ ...TYPE_BLOCK, companions: ["counsel-brief"] }, "companions[0]", /must be one of written-arguments/],
    [{ ...TYPE_BLOCK, page_limit: 0 }, "page_limit", /positive integer/],
    [{ ...TYPE_BLOCK, letterhead: true }, "letterhead", /general types only/],
    [{ ...general([part]), letterhead: true, signer: "party" }, "signer", /letterhead render requires a roster lawyer/],
    [{ ...TYPE_BLOCK, title: { value: "Notice", rule_ref: "R-missing" } }, null, /cites rule_ref "R-missing", which no item/],
  ]) {
    f.shipped(path, knowledgeFile(null, JSON.parse(JSON.stringify(block))));
    const err = readError(f, path);
    assert.equal(err.code, "invalid_layout", `${field}: ${err.message}`);
    if (field) assert.ok(err.message.startsWith(`${path}: ${field}:`), err.message);
    assert.match(err.message, rule);
  }

  f.shipped("draft/CAN/BC/_NoVenue/Documents/internal-memo.md", knowledgeFile(null, general([part])));
  const noVenue = readError(f, "draft/CAN/BC/_NoVenue/Documents/internal-memo.md");
  assert.match(noVenue.message, /needs_forum_parts: a type declaring true cannot resolve under _NoVenue/);

  f.shipped(path, knowledgeFile(null, undefined));
  assert.match(readError(f, path).message, /has no fenced json block/);
  f.shipped(path, knowledgeFile(null, TYPE_BLOCK, "```json\n{}\n```\n"));
  assert.match(readError(f, path).message, /exactly one is allowed/);
});

test("a type file may declare hearing-date as a goal criterion", (t) => {
  const f = knowledgeFixture(t);
  const path = "draft/CAN/BC/BCSC/Documents/notice-of-application.md";
  const block = { ...TYPE_BLOCK, goal_criteria: ["orders-sought", "counsel-review", "hearing-date"] };
  f.shipped(path, knowledgeFile("kind: notice_of_application", block));
  assert.deepEqual(knowledgeRead(path, f.seams).layout, block);
});

test("a venue.md block needs every heading field and nothing else", (t) => {
  const f = knowledgeFixture(t);
  const path = "draft/CAN/BC/BCSC/venue.md";
  f.shipped(path, knowledgeFile(null, VENUE_BLOCK));
  assert.deepEqual(knowledgeRead(path, f.seams).layout, VENUE_BLOCK);
  for (const [block, rule] of [
    [{ ...VENUE_BLOCK, display_label: undefined }, /display_label: is required/],
    [{ ...VENUE_BLOCK, court_name: "x" }, /court_name: is not a venue\.md field/],
    [{ ...VENUE_BLOCK, party_roles: {} }, /party_roles: must map each role key/],
    [{ ...VENUE_BLOCK, caption_lines: [] }, /caption_lines: must name at least one line/],
  ]) {
    f.shipped(path, knowledgeFile(null, JSON.parse(JSON.stringify(block))));
    assert.match(readError(f, path).message, rule);
  }
});

// ------------------------------------------------------------ format validator --

const FORMAT_FRONT = `learned_by: agent
accessed: 2026-09-20
items:
  - rule_ref: F-paper
    passage: Documents must be on letter-size paper.
  - rule_ref: F-margins
    passage: Leave a margin of one inch on every side.
  - rule_ref: F-header
    passage: The firm's letterhead appears at the top.
    source: practitioner`;

const FORMAT_BLOCK = {
  format: {
    paper: { value: "letter", rule_ref: "F-paper" },
    margins: { value: { top: "1 in", bottom: "1 in", left: "1 in", right: "1 in" }, rule_ref: "F-margins" },
    header: { value: "{{AUTHOR_NAME}} | {{FILE_NUMBER}}", rule_ref: "F-header" },
  },
};

test("a format block validates, reports its defaulted properties, and a practitioner-sourced property reads confirmed", (t) => {
  const f = knowledgeFixture(t);
  const path = "publish/CAN/BC/BCSC/format.md";
  f.local(path, knowledgeFile(FORMAT_FRONT, FORMAT_BLOCK));
  const result = knowledgeRead(path, f.seams);
  assert.deepEqual(result.format, FORMAT_BLOCK.format);
  assert.deepEqual(result.defaulted, ["typeface", "font_size", "line_spacing", "page_numbering", "footer", "filing_stamp_reservation"]);
  assert.deepEqual(result.items.map((item) => [item.rule_ref, item.status]), [
    ["F-paper", "unconfirmed"],
    ["F-margins", "unconfirmed"],
    ["F-header", "confirmed"],
  ]);
  assert.equal(result.items[2].practitioner_sourced, true);
});

test("a corrected format property is substituted as the property's own value and revalidated", (t) => {
  const f = knowledgeFixture(t);
  const path = "publish/CAN/BC/BCSC/format.md";
  f.local(path, knowledgeFile(FORMAT_FRONT, FORMAT_BLOCK));
  const row = (value) => ({
    rule_ref: "F-margins",
    status: "corrected",
    by: "pe",
    on: "2026-09-21",
    confirmed_against: { passage_hash: passageHash("Leave a margin of one inch on every side."), currency: null },
    value,
  });
  const margins = { top: "25 mm", bottom: "25 mm", left: "30 mm", right: "25 mm" };
  f.local(`${path}.confirmations.local.json`, { file: path, items: [row(margins)] });
  const result = knowledgeRead(path, f.seams);
  assert.deepEqual(result.format.margins, { value: margins, rule_ref: "F-margins" });
  assert.deepEqual(result.corrections_substituted, ["F-margins"]);

  f.local(`${path}.confirmations.local.json`, { file: path, items: [row({ ...margins, left: "30mm" })] });
  const err = readError(f, path);
  assert.equal(err.code, "invalid_format");
  assert.match(err.message, /format\.margins\.value\.left: must be a length/);
});

test("the format validator fails hard on each broken rule, naming the property", (t) => {
  const f = knowledgeFixture(t);
  const path = "publish/CAN/BC/_NoVenue/format.md";
  const withProperty = (property, value) => ({ format: { [property]: { value, rule_ref: "F-x" } } });
  for (const [block, rule] of [
    [withProperty("signature", "keep"), /format\.signature: is not a settable property/],
    [withProperty("paper", "tabloid"), /format\.paper\.value: must be one of letter, legal, a4/],
    [withProperty("font_size", "12 mm"), /format\.font_size\.value: must be a length in pt/],
    [withProperty("font_size", "12pt"), /must be a length "<number> <unit>"/],
    [withProperty("font_size", "0 pt"), /format\.font_size\.value: must be greater than zero/],
    [withProperty("line_spacing", "1.5"), /format\.line_spacing\.value: must be a number/],
    [withProperty("line_spacing", 0), /format\.line_spacing\.value: must be greater than zero/],
    [withProperty("page_numbering", { position: "bottom" }), /format\.page_numbering\.value: must hold exactly position, format, first_page/],
    [withProperty("page_numbering", { position: "bottom", format: "arabic", first_page: true }), /format\.page_numbering\.value\.position: must be one of top-left, top-center, top-right, bottom-left, bottom-center, bottom-right/],
    [withProperty("page_numbering", { position: "bottom-center", format: "roman", first_page: true }), /format\.page_numbering\.value\.format: must be one of arabic, lower-roman, upper-roman/],
    [withProperty("page_numbering", { position: "bottom-center", format: "arabic", first_page: "no" }), /format\.page_numbering\.value\.first_page: must be true or false/],
    [withProperty("footer", "Page {{PAGE}} of {{AUTHOR_NAME}}"), /carries \{\{PAGE\}\}, outside the letterhead token set/],
    [{ format: { paper: { value: "letter" } } }, /format\.paper: must hold exactly value, rule_ref; missing rule_ref/],
    [{ format: {}, extra: 1 }, /extra: is not allowed/],
  ]) {
    f.shipped(path, knowledgeFile("items:\n  - rule_ref: F-x\n    passage: A rule.", block));
    const err = readError(f, path);
    assert.equal(err.code, "invalid_format", err.message);
    assert.ok(err.message.startsWith(`${path}: `), err.message);
    assert.match(err.message, rule);
  }
});

test("both tools are registered read-only, closed-world", () => {
  for (const name of ["knowledge__read", "knowledge__list"]) {
    const tool = buildToolDefinitions().find((definition) => definition.name === name);
    assert.ok(tool, name);
    assert.deepEqual(tool.annotations, { readOnlyHint: true, openWorldHint: false });
  }
  const check = buildToolDefinitions().find((definition) => definition.name === "sources__check");
  assert.deepEqual(check.inputSchema.properties.files.items.properties.tree.enum, ["skill_source", "knowledge"]);
});

// ------------------------------------------------------------ indirect paths keep the grammar --

test("a sources: entry that leaves the tree is refused with grammar_violation, as a direct read would be", (t) => {
  const f = knowledgeFixture(t);
  // draft/letters.md is a real file (draft/references/letters.md), beside the tree but not in it.
  f.shipped("draft/letters.md", "---\npage_url: https://example.test/letters\nitems:\n  - rule_ref: L-1\n    passage: A letter rule.\n---\n# Letters\n");
  f.shipped("draft/CAN/BC/BCSC/venue.md", knowledgeFile("sources:\n  - ../../../letters.md", VENUE_BLOCK));
  const err = readError(f, "draft/CAN/BC/BCSC/venue.md");
  assert.equal(err.code, "grammar_violation");
  assert.match(err.message, /"sources:" entry \.\.\/\.\.\/\.\.\/letters\.md/);
  assert.match(err.message, /draft\/letters\.md is not a knowledge-tree file: .*three-letter ISO country code/);
});

test("an index path under a folder breaking the grammar is refused with grammar_violation", (t) => {
  const f = knowledgeFixture(t);
  f.shipped("draft/CAN/BC/_Bad/Documents/kinds.json", { kinds: [] });
  const err = readError(f, "draft/CAN/BC/_Bad/Documents/kinds.json");
  assert.equal(err.code, "grammar_violation");
  assert.match(err.message, /_NoVenue is the only member/);
});

// ------------------------------------------------------------ fenced json inside another fence --

test("a json fence inside another fenced block in the prose is that block's text, not a second json block", (t) => {
  const f = knowledgeFixture(t);
  const path = "draft/CAN/BC/BCSC/Documents/notice-of-application.md";
  for (const prose of [
    "An example in prose:\n\n````text\n```json\n{\"renderer\": \"general\"}\n```\n````\n",
    "An example in prose:\n\n~~~text\n```json\n{}\n```\n~~~\n",
  ]) {
    f.shipped(path, knowledgeFile(null, TYPE_BLOCK, prose));
    assert.deepEqual(knowledgeRead(path, f.seams).layout, TYPE_BLOCK, prose);
  }
  f.shipped(path, knowledgeFile(null, TYPE_BLOCK, "Prose.\n\n```json\n{}\n```\n"));
  assert.match(readError(f, path).message, /exactly one is allowed/, "a second top-level json block is still refused");
});

// ------------------------------------------------------------ junctions --

test("an overlay skill folder that is a junction out of the case data root is refused", (t) => {
  const f = knowledgeFixture(t);
  const outside = join(f.scratch, "elsewhere", "draft");
  mkdirSync(join(outside, "CAN", "BC", "BCSC"), { recursive: true });
  writeFileSync(join(outside, "CAN", "BC", "BCSC", "venue.md"), knowledgeFile(null, VENUE_BLOCK));
  mkdirSync(f.overlay, { recursive: true });
  symlinkSync(outside, join(f.overlay, "draft"), "junction");
  const err = readError(f, "draft/CAN/BC/BCSC/venue.md");
  assert.equal(err.code, "path_out_of_scope");
  assert.match(err.message, /resolves outside its permitted root/);
});

test("a shipped folder that is a junction elsewhere in the skills tree, outside the skill's references, is refused", (t) => {
  const f = knowledgeFixture(t);
  const target = join(f.installRoot, "skills", "publish", "references", "CAN");
  mkdirSync(join(target, "BC", "BCSC"), { recursive: true });
  writeFileSync(join(target, "BC", "BCSC", "venue.md"), knowledgeFile(null, VENUE_BLOCK));
  symlinkSync(target, f.shippedPath("draft/CAN"), "junction");
  const err = readError(f, "draft/CAN/BC/BCSC/venue.md");
  assert.equal(err.code, "path_out_of_scope");
  assert.match(err.message, /resolves outside its permitted root/);
});

// ------------------------------------------------------------ no network --

test("knowledge__read and knowledge__list never touch the network", (t) => {
  const f = knowledgeFixture(t);
  const refuse = () => {
    throw new Error("the knowledge__* tools must never touch the network");
  };
  t.mock.method(https, "request", refuse);
  t.mock.method(https, "get", refuse);
  if (typeof globalThis.fetch === "function") t.mock.method(globalThis, "fetch", refuse);
  syncBuiltinESMExports();
  t.after(() => syncBuiltinESMExports());

  f.shipped("draft/CAN/BC/venues.json", { jurisdiction: "BC", name: "British Columbia", venues: [{ code: "BCSC", name: "Supreme Court of British Columbia", aliases: [] }] });
  f.shipped("draft/CAN/BC/BCSC/Sources/rules.md", "---\npage_url: https://example.test/rules\nitems:\n  - rule_ref: R-1\n    passage: A rule.\n---\n# Rules\n");
  f.local("draft/CAN/BC/BCSC/venue.md", knowledgeFile("learned_by: agent\nsources:\n  - Sources/rules.md", VENUE_BLOCK));
  f.local("draft/CAN/BC/BCSC/venue.md.confirmations.local.json", {
    file: "draft/CAN/BC/BCSC/venue.md",
    items: [{ rule_ref: "R-1", status: "confirmed", by: "pe", on: "2026-09-25", confirmed_against: { passage_hash: passageHash("A rule."), currency: null } }],
  });

  const document = knowledgeRead("draft/CAN/BC/BCSC/venue.md", f.seams);
  assert.deepEqual(document.items.map((item) => [item.rule_ref, item.status]), [["R-1", "confirmed"]]);
  assert.equal(knowledgeRead("draft/CAN/BC/venues.json", f.seams).index, "venues");
  assert.ok(knowledgeList({ dir: "draft/CAN/BC", recursive: true }, f.seams).entries.length > 0);
  const resolved = knowledgeList({ dir: "draft/CAN/BC", resolve: "BCSC" }, f.seams);
  assert.deepEqual([resolved.result, resolved.code], ["resolved", "BCSC"]);
});

// ------------------------------------------------------------ no per-user coclerk.json --
// Without %APPDATA%\Coclerk\coclerk.json the overlay's case data root comes from the matter
// pointer `matter_root` names: the parent `0. CASE DATA` folder of its case_data_dir. Through
// callTool, so the dispatch wiring is exercised; the shipped layer is the checkout's.

async function rejection(promise) {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error("expected a rejection, got none");
}

test("with no per-user coclerk.json, knowledge__read given matter_root serves the overlay under the matter pointer's 0. CASE DATA folder", async (t) => {
  const f = knowledgeFixture(t);
  useProcessEnv(t, f, { userFile: false });
  const { matterRoot } = matterFixture(f);
  f.local("_hosts.json", [{ host: "fixture.test", category: "venue", page_url: "https://fixture.test/", added: "2026-10-06", approved_by: "practitioner" }]);
  const result = await callTool({}, "knowledge__read", { path: "_hosts.json", matter_root: matterRoot });
  assert.equal(result.layer, "local");
  assert.match(result.content, /fixture\.test/);
});

test("a per-user coclerk.json wins: matter_root is never resolved, so a matter folder that does not exist is no error", async (t) => {
  const f = knowledgeFixture(t);
  useProcessEnv(t, f);
  f.local("_hosts.json", []);
  const missing = join(f.scratch, "No Such Matter");
  assert.equal((await callTool({}, "knowledge__read", { path: "_hosts.json", matter_root: missing })).layer, "local");
  const listed = await callTool({}, "knowledge__list", { dir: "draft/CAN/BC", matter_root: missing });
  assert.ok(listed.entries.length > 0);
});

test("with no per-user coclerk.json, an unusable matter pointer refuses with pointer_unusable and its /case-data repair text; a folder with no pointer with invalid_root", async (t) => {
  const f = knowledgeFixture(t);
  useProcessEnv(t, f, { userFile: false });
  for (const [name, pointer, why] of [
    ["L2 Empty", { case_data_dir: "" }, /has no case_data_dir/],
    ["L3 Garbled", "not json", /is not readable JSON/],
    ["L4 Old", { schema_version: 4 }, /is schema_version 4, expected 5/],
    ["L5 Legacy", { case_data_dir: "9. AI" }, /still points at the legacy "9\. AI" folder/],
  ]) {
    const { matterRoot } = matterFixture(f, pointer, name);
    const err = await rejection(callTool({}, "knowledge__read", { path: "_hosts.json", matter_root: matterRoot }));
    assert.equal(err.code, "pointer_unusable", name);
    assert.match(err.message, why, name);
    assert.match(err.message, /Run \/case-data on this matter to initialize or repair coclerk\.json; drafting_forms__open_session never rewrites it\./, name);
  }
  const { matterRoot } = matterFixture(f, null, "L6 Bare");
  const err = await rejection(callTool({}, "knowledge__list", { dir: "draft/CAN/BC", matter_root: matterRoot }));
  assert.equal(err.code, "invalid_root");
  assert.match(err.message, /has no coclerk\.json/);
  assert.equal((await rejection(callTool({}, "knowledge__read", { path: "_hosts.json", matter_root: 7 }))).name, "ValidationError");
});

test("overlay writes never fall back: knowledge__write takes no matter_root, and with no per-user coclerk.json still fails", async (t) => {
  const f = knowledgeFixture(t);
  useProcessEnv(t, f, { userFile: false });
  const { matterRoot } = matterFixture(f);
  const row = { host: "fixture.test", category: "venue", page_url: "https://fixture.test/" };
  const refused = await rejection(callTool({}, "knowledge__write", { operation: "create", path: "_hosts.json", matter: "L8443", row, matter_root: matterRoot }));
  assert.match(refused.message, /unknown field "matter_root"/);
  const err = await rejection(callTool({}, "knowledge__write", { operation: "create", path: "_hosts.json", matter: "L8443", row }));
  assert.match(err.message, /Cannot locate the practice database: .*coclerk\.json not found/);
});
