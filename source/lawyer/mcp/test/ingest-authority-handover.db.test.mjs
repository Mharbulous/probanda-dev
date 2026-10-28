// The extractor-to-host handover of matter_data__ingest_authority (/matter-data design-decisions.md
// #76, #194): the extractor stages its result with matter_data__stage_result, and the ingest reads it
// by result_id from the host's own folder, never by a path the caller names. Every name is invented.

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { callTool } = await import("../build/dispatch.js");
const { buildToolDefinitions } = await import("../build/schema-gen.js");
const { writeCaseDataStores } = await import("./helpers/matter-data-fixture.mjs");

const RESULT = {
  authority: { title: "Quillfeather v. Plumtree", citation: "2026 BCCA 999", authority_type: "case_law", jurisdiction: "BC" },
  authority_disposition: "Appeal dismissed.",
  concepts: [
    {
      name: "Invented reliance test",
      jurisdiction: "BC",
      concept_kind: "legal test",
      authority_role: "establishes",
      authority_proposition: "A party relying on a representation must show it was reasonable to rely on it.",
      criteria: [],
    },
  ],
  treats_prior: [],
};

function fixture(t) {
  const base = mkdtempSync(join(tmpdir(), "coclerk-ingest-handover-"));
  const appData = process.env.LOCALAPPDATA;
  process.env.LOCALAPPDATA = join(base, "AppData");
  t.after(() => {
    process.env.LOCALAPPDATA = appData;
    rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });
  const matterRoot = join(base, "T9999 Scratch Matter");
  const caseDataDir = join(base, "0. CASE DATA", "T9999 Scratch Matter");
  mkdirSync(matterRoot, { recursive: true });
  mkdirSync(caseDataDir, { recursive: true });
  writeFileSync(
    join(matterRoot, "coclerk.json"),
    JSON.stringify({ schema_version: 5, matter_root: matterRoot, case_data_dir: caseDataDir, evidence_sql_path: "4. LAWYER BRIEF\\CoWork\\evidence.sql" }),
    "utf-8"
  );
  writeCaseDataStores(caseDataDir);
  return { matterRoot, stagedDir: join(base, "AppData", "Coclerk", "extract-results") };
}

const ingest = (matterRoot, resultId) =>
  callTool({}, "matter_data__ingest_authority", {
    matter_root: matterRoot,
    result_id: resultId,
    file_path: "6. LAW\\quillfeather.pdf",
    file_hash: "a".repeat(64),
  });

const inserted = (out) => Object.values(out.counts).reduce((n, c) => n + c.inserted, 0);

test("stage_result takes only the result, and ingest_authority takes its id, not a path", () => {
  const defs = buildToolDefinitions();
  const stage = defs.find((d) => d.name === "matter_data__stage_result");
  assert.deepEqual(Object.keys(stage.inputSchema.properties), ["result"]);
  const ingestDef = defs.find((d) => d.name === "matter_data__ingest_authority");
  assert.ok(ingestDef.inputSchema.required.includes("result_id"));
  assert.ok(!("result_path" in ingestDef.inputSchema.properties));
});

test("a staged result is ingested by its id, and a second run inserts nothing", async (t) => {
  const { matterRoot, stagedDir } = fixture(t);
  const staged = await callTool({}, "matter_data__stage_result", { result: RESULT });
  assert.match(staged.result_id, /^[0-9a-f-]{36}$/);
  assert.equal(staged.bytes, Buffer.byteLength(JSON.stringify(RESULT)));
  assert.ok(existsSync(join(stagedDir, `${staged.result_id}.json`)));

  const first = await ingest(matterRoot, staged.result_id);
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.ok(inserted(first) > 0);

  const again = await ingest(matterRoot, staged.result_id);
  assert.equal(again.ok, true, JSON.stringify(again));
  assert.equal(again.authority_id, first.authority_id);
  assert.equal(inserted(again), 0);
});

test("ingest_authority refuses a result_id that is a path", async (t) => {
  const { matterRoot } = fixture(t);
  for (const resultId of ["..\\..\\secret", "C:\\x\\result.json", "/tmp/claude-0/result.json"]) {
    await assert.rejects(ingest(matterRoot, resultId), /result_id must be the id matter_data__stage_result returned/);
  }
});

test("staging deletes results staged more than 7 days ago and keeps newer ones", async (t) => {
  const { stagedDir } = fixture(t);
  mkdirSync(stagedDir, { recursive: true });
  const old = join(stagedDir, "00000000-0000-4000-8000-000000000001.json");
  const recent = join(stagedDir, "00000000-0000-4000-8000-000000000002.json");
  writeFileSync(old, "{}");
  writeFileSync(recent, "{}");
  const eightDaysAgo = (Date.now() - 8 * 24 * 60 * 60 * 1000) / 1000;
  utimesSync(old, eightDaysAgo, eightDaysAgo);
  await callTool({}, "matter_data__stage_result", { result: RESULT });
  assert.ok(!existsSync(old));
  assert.ok(existsSync(recent));
});
