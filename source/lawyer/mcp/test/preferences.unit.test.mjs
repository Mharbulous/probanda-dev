// preferences__read/write: a person's preferences in
// `<case_data_root>\_practice\preferences\<person>.json`, retired in place, screened for
// identifying detail. The suggestion log moved to the suggestion store: suggestion-store.unit.test.mjs.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { preferencesRead, preferencesWrite } = await import("../build/preferences/tools.js");

function fixture(t, person = "bd") {
  const scratch = mkdtempSync(join(tmpdir(), "probanda-preferences-"));
  t.after(() => rmSync(scratch, { recursive: true, force: true }));
  const root = join(scratch, "0. CASE DATA");
  mkdirSync(root);
  const config = join(scratch, "device", "probanda.json");
  mkdirSync(join(scratch, "device"));
  writeFileSync(config, JSON.stringify({ case_data_root: root, ...(person ? { person } : {}) }));
  const installRoot = join(scratch, "install");
  mkdirSync(join(installRoot, ".claude-plugin"), { recursive: true });
  writeFileSync(join(installRoot, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "lawyer", version: "9.9.9" }));
  return {
    env: { COCLERK_CONFIG_PATH: config },
    seams: { installRoot },
    prefsFile: join(root, "_practice", "preferences", `${person}.json`),
  };
}

async function rejection(fn) {
  try {
    await fn();
  } catch (err) {
    return err;
  }
  throw new Error("expected a rejection, got none");
}

test("add then read returns the active entries, all or for one skill", async (t) => {
  const f = fixture(t);
  const a = await preferencesWrite({ op: "add", skill: "lawyer:draft", instruction: "Use short paragraphs." }, f.env, f.seams);
  await preferencesWrite({ op: "add", skill: "lawyer:show-me", instruction: "Show the page, not a quote." }, f.env, f.seams);
  assert.equal(a.status, "saved");
  const all = preferencesRead({}, f.env);
  assert.equal(all.person, "bd");
  assert.equal(all.entries.length, 2);
  const one = preferencesRead({ skill: "lawyer:draft" }, f.env);
  assert.equal(one.entries.length, 1);
  assert.equal(one.entries[0].id, a.id);
  assert.equal(one.entries[0].instruction, "Use short paragraphs.");
  assert.equal(one.entries[0].retired_on, null);
  assert.equal(one.entries[0].plugin_version, "9.9.9");
  assert.match(one.entries[0].created_on, /^\d{4}-\d{2}-\d{2}$/);
  const file = JSON.parse(readFileSync(f.prefsFile, "utf-8"));
  assert.equal(file.person, "bd");
});

test("a filtered read echoes the filter and counts the active entries it left out", async (t) => {
  const f = fixture(t);
  assert.deepEqual(preferencesRead({ skill: "lawyer:show-me" }, f.env), { person: "bd", entries: [], skill: "lawyer:show-me", excluded: 0 });
  await preferencesWrite({ op: "add", skill: "lawyer:show-me", instruction: "Show the page, not a quote." }, f.env, f.seams);
  await preferencesWrite({ op: "add", skill: "litigator:draft", instruction: "Use short paragraphs." }, f.env, f.seams);
  const match = preferencesRead({ skill: "lawyer:show-me" }, f.env);
  assert.equal(match.entries.length, 1);
  assert.equal(match.skill, "lawyer:show-me");
  assert.equal(match.excluded, 1);
  const miss = preferencesRead({ skill: "lawyer:draft" }, f.env);
  assert.deepEqual(miss.entries, []);
  assert.equal(miss.skill, "lawyer:draft");
  assert.equal(miss.excluded, 2);
  const all = preferencesRead({}, f.env);
  assert.equal(all.entries.length, 2);
  assert.equal("excluded" in all, false);
});

test("retire stamps retired_on inside the file and read no longer returns it", async (t) => {
  const f = fixture(t);
  const { id } = await preferencesWrite({ op: "add", skill: "lawyer:draft", instruction: "Use short paragraphs." }, f.env, f.seams);
  const retired = await preferencesWrite({ op: "retire", id }, f.env, f.seams);
  assert.equal(retired.status, "retired");
  assert.deepEqual(preferencesRead({}, f.env).entries, []);
  const file = JSON.parse(readFileSync(f.prefsFile, "utf-8"));
  assert.equal(file.entries.length, 1);
  assert.equal(file.entries[0].retired_on, retired.retired_on);
  assert.equal((await preferencesWrite({ op: "retire", id }, f.env, f.seams)).status, "already_retired");
  assert.equal((await rejection(() => preferencesWrite({ op: "retire", id: "nope" }, f.env, f.seams))).code, "not_found");
});

test("an instruction with identifying detail is refused with a question and nothing is saved", async (t) => {
  const f = fixture(t);
  for (const instruction of [
    "Always copy jane.doe@example.com on letters.",
    "Save drafts to C:\\Users\\jdoe\\Desktop first.",
    "File it under 0. CASE DATA\\Smith v Jones.",
    "x".repeat(2001),
  ]) {
    const err = await rejection(() => preferencesWrite({ op: "add", skill: "lawyer:draft", instruction }, f.env, f.seams));
    assert.equal(err.code, "identifying_detail");
    assert.match(err.message, /\?/);
    assert.doesNotMatch(err.message, /jane|jdoe|Smith/);
  }
  assert.deepEqual(preferencesRead({}, f.env).entries, []);
});

test("a malformed skill name is refused", async (t) => {
  const f = fixture(t);
  const err = await rejection(() => preferencesWrite({ op: "add", skill: "draft", instruction: "Use short paragraphs." }, f.env, f.seams));
  assert.equal(err.name, "ValidationError");
});

test("person unset is a hard error naming the key and the tool that sets it", async (t) => {
  const f = fixture(t, null);
  for (const call of [() => preferencesRead({}, f.env), () => preferencesWrite({ op: "add", skill: "lawyer:draft", instruction: "x" }, f.env, f.seams)]) {
    const err = await rejection(call);
    assert.equal(err.code, "person_unset");
    assert.match(err.message, /"person"/);
    assert.match(err.message, /practice_data__upsert_firm_profile/);
  }
});
