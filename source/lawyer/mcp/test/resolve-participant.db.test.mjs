// matter_data__resolve_participant end to end (/matter-data design-decisions.md #65, #66): the tool
// resolves the matter's matter-data folder from its coclerk.json and spawns /matter-data's own
// resolve_participant.py against a real main.sqlite built from the canonical schema. The matching
// itself is pinned by the skill's test_resolve_participant.py; this pins the tool surface. Every
// name is invented.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { callTool } = await import("../build/dispatch.js");
const { buildToolDefinitions } = await import("../build/schema-gen.js");
const { writeCaseData } = await import("./helpers/matter-data-fixture.mjs");

const TOOL = "matter_data__resolve_participant";

const SEED = `
INSERT INTO parties (party_id, name, party_type) VALUES (1, 'Ada Plumtree', 'individual');
INSERT INTO tribunal_members (tribunal_member_id, name, capacity, tribunal_body)
VALUES (1, 'Moira Quillfeather', 'arbitrator', 'Example Arbitration Board');
INSERT INTO participant_aliases (tribunal_member_id, alias_text, alias_kind, approved_on)
VALUES (1, 'QuillfeatherM', 'file_code', '2026-10-06'), (1, 'Guillfeather', 'spelling', '2026-10-06');
`;

function matterFixture(t, seed = SEED) {
  const base = mkdtempSync(join(tmpdir(), "coclerk-resolve-participant-"));
  t.after(() => rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
  const matterRoot = join(base, "T9999 Scratch Matter");
  const caseDataDir = join(base, "0. CASE DATA", "T9999 Scratch Matter");
  mkdirSync(matterRoot, { recursive: true });
  mkdirSync(caseDataDir, { recursive: true });
  writeFileSync(
    join(matterRoot, "coclerk.json"),
    JSON.stringify({ schema_version: 5, matter_root: matterRoot, case_data_dir: caseDataDir, evidence_sql_path: "4. LAWYER BRIEF\\CoWork\\evidence.sql" }),
    "utf-8"
  );
  if (seed !== null) writeCaseData(caseDataDir, seed);
  return { matterRoot, caseDataDir };
}

const resolve = (matterRoot, name) => callTool({}, TOOL, { matter_root: matterRoot, name });

test("the tool is read-only and takes a matter root and a name", () => {
  const def = buildToolDefinitions().find((d) => d.name === TOOL);
  assert.ok(def, `${TOOL} is defined`);
  assert.deepEqual(def.annotations, { readOnlyHint: true, openWorldHint: false });
  assert.deepEqual(def.inputSchema.required, ["matter_root", "name"]);
  assert.match(def.description, /operations\/participants\.md/);
});

test("a misspelt surname resolves near to a tribunal member with every term on record", async (t) => {
  const { matterRoot, caseDataDir } = matterFixture(t);
  const before = readFileSync(join(caseDataDir, "main.sqlite"));
  const out = await resolve(matterRoot, "Quilfeather");
  assert.equal(out.status, "ok");
  assert.equal(out.matches.length, 1);
  const [m] = out.matches;
  assert.equal(m.role, "tribunal");
  assert.equal(m.capacity, "arbitrator");
  assert.equal(m.body, "Example Arbitration Board");
  assert.equal(m.match, "near");
  assert.equal(m.distance, 1);
  for (const term of ["Moira Quillfeather", "QuillfeatherM", "Guillfeather", "Quillfeather"]) {
    assert.ok(m.search_terms.includes(term), term);
  }
  assert.deepEqual(readFileSync(join(caseDataDir, "main.sqlite")), before, "the read writes nothing");
});

test("a file code resolves exactly", async (t) => {
  const { matterRoot } = matterFixture(t);
  const out = await resolve(matterRoot, "QuillfeatherM");
  assert.equal(out.matches[0].match, "exact");
  assert.equal(out.matches[0].matched, "QuillfeatherM");
});

test("an unknown name is not_found, and a matter with no case data is unavailable", async (t) => {
  const { matterRoot } = matterFixture(t);
  const out = await resolve(matterRoot, "Hargreaves");
  assert.equal(out.status, "not_found");
  assert.match(out.reason, /Hargreaves/);

  const bare = matterFixture(t, null);
  const none = await resolve(bare.matterRoot, "Quillfeather");
  assert.equal(none.status, "unavailable");
});
