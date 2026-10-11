// The venue test sends any recipient that is not a venue to _NoVenue, so its audience keys must
// cover every such recipient: `public-body` (police, a ministry, a bylaw office) and the catch-all
// `non-party` each resolve and save as a _NoVenue Writing, through the dispatch path as /draft
// reaches it, against /draft's shipped tree with an empty firm overlay. The five earlier audiences
// resolve as before, and a client letter still never enters the tree.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { freshSubmissionDb } = await import("./helpers/template-db.mjs");
const { submissionDataExecute, submissionDataQuery } = await import("../build/submission/backend.js");
const { callTool } = await import("../build/dispatch.js");
const { AUDIENCES } = await import("../build/knowledge/index.js");
const { buildToolDefinitions } = await import("../build/schema-gen.js");

const DOCS = "draft/CAN/BC/_NoVenue/Documents";
const TREE = { country: "CAN", jurisdiction: "BC", venue: "_NoVenue" };

/** A seeded database, with APPDATA pointing at a case data root whose firm overlay is empty. */
async function db(t) {
  const scratch = mkdtempSync(join(tmpdir(), "coclerk-public-body-"));
  const saved = process.env.APPDATA;
  t.after(() => {
    if (saved === undefined) delete process.env.APPDATA;
    else process.env.APPDATA = saved;
    rmSync(scratch, { recursive: true, force: true });
  });
  mkdirSync(join(scratch, "case"));
  mkdirSync(join(scratch, "Coclerk"));
  writeFileSync(join(scratch, "Coclerk", "coclerk.json"), JSON.stringify({ case_data_root: join(scratch, "case") }));
  process.env.APPDATA = scratch;
  const dbPath = join(scratch, "submission.sqlite");
  await freshSubmissionDb(dbPath);
  await submissionDataExecute(dbPath, "INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L0000', NULL), (2, 'L0000', 'CAN/BC/BCSC');");
  return dbPath;
}

const resolve = (name, recipient) => callTool({}, "knowledge__list", { dir: DOCS, resolve: name, recipient });

const NEW = { "public-body": "letter-to-public-body", "non-party": "letter-to-non-party" };

test("a letter to a public body or a non-party resolves under its own recipient", async (t) => {
  await db(t);
  for (const [recipient, code] of Object.entries(NEW)) {
    for (const name of [code, code.replaceAll("-", "_"), code.replaceAll("-", " ")]) {
      const r = await resolve(name, recipient);
      assert.deepEqual([r.result, r.code], ["resolved", code], name);
    }
  }
});

test("the five earlier audiences resolve exactly as before", async (t) => {
  await db(t);
  const expected = {
    "opposing-counsel": ["letter_to_opposing_counsel", "letter-to-opposing-counsel"],
    "opposing-party": ["letter_to_opposing_party", "letter-to-opposing-party"],
    witness: ["letter_to_witness", "letter-to-witness"],
    expert: ["letter_to_expert", "letter-to-expert"],
    internal: ["internal_memo", "internal-memo"],
  };
  for (const [recipient, [name, code]] of Object.entries(expected)) {
    const r = await resolve(name, recipient);
    assert.deepEqual([r.result, r.code], ["resolved", code], recipient);
  }
  const release = await resolve("settlement release", "opposing-party");
  assert.deepEqual([release.result, release.code], ["resolved", "release"]);
});

test("a client letter still never resolves", async (t) => {
  await db(t);
  await assert.rejects(resolve("letter", "client"), /recipient must be one of/);
});

test("the Writing saves on a forum-less and a forum proceeding, with the general letter layout and letterhead", async (t) => {
  const dbPath = await db(t);
  for (const [recipient, code] of Object.entries(NEW)) for (const proceeding_id of [1, 2]) {
    const created = await callTool({}, "drafting_data__create_writing", {
      db_path: dbPath,
      proceeding_id,
      tree: TREE,
      kind: code,
      recipient,
      title: `Letter (${recipient})`,
    });
    assert.equal(typeof created.filing_id, "number");
    const [row] = submissionDataQuery(dbPath, "SELECT needs_forum_parts, layout_snapshot FROM filings WHERE id = ?", [created.filing_id]).rows;
    const snapshot = JSON.parse(row.layout_snapshot);
    assert.equal(row.needs_forum_parts, 0);
    assert.equal(snapshot.type_file, `${DOCS}/${code}.md`);
    assert.equal(snapshot.layout.renderer, "general");
    assert.equal(snapshot.layout.letterhead, true);
    assert.ok(snapshot.layout.goal_criteria.includes("recipients"));
  }
});

test("both tool schemas offer exactly the runtime's audiences", () => {
  const tools = Object.fromEntries(buildToolDefinitions().map((tool) => [tool.name, tool]));
  for (const name of ["knowledge__list", "drafting_data__create_writing"]) {
    assert.deepEqual(tools[name].inputSchema.properties.recipient.enum, [...AUDIENCES], name);
  }
  for (const recipient of Object.keys(NEW)) assert.ok(AUDIENCES.includes(recipient), recipient);
  assert.ok(!AUDIENCES.includes("client"), "a client letter never enters the tree");
});
