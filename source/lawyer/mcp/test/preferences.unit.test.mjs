// preferences__read/write and suggestion_log__read/write: a person's preferences in
// `<case_data_root>\_practice\preferences\<person>.json`, retired in place, screened for
// identifying detail; and the device-local suggestion log beside probanda.json.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { preferencesRead, preferencesWrite, suggestionLogRead, suggestionLogWrite } = await import("../build/preferences/tools.js");

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
    logFile: join(scratch, "device", "suggestions.local.json"),
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

test("the suggestion log sits beside probanda.json: add, then seen sets both statuses", async (t) => {
  const f = fixture(t);
  assert.deepEqual(suggestionLogRead(f.env).suggestions, []);
  assert.equal((await suggestionLogWrite({ op: "add", suggestion_id: "s-1", title: "Shorter letters" }, f.env)).status, "added");
  assert.equal((await suggestionLogWrite({ op: "add", suggestion_id: "s-1", title: "Shorter letters" }, f.env)).status, "exists");
  let [entry] = suggestionLogRead(f.env).suggestions;
  assert.equal(entry.last_status, "new");
  assert.equal(entry.last_shown_status, null);
  assert.match(entry.posted_on, /^\d{4}-\d{2}-\d{2}$/);
  await suggestionLogWrite({ op: "seen", suggestion_id: "s-1", status: "approved in part" }, f.env);
  [entry] = suggestionLogRead(f.env).suggestions;
  assert.equal(entry.last_status, "approved in part");
  assert.equal(entry.last_shown_status, "approved in part");
  assert.equal(JSON.parse(readFileSync(f.logFile, "utf-8")).suggestions.length, 1);
  assert.equal((await rejection(() => suggestionLogWrite({ op: "seen", suggestion_id: "s-2", status: "new" }, f.env))).code, "not_found");
  assert.equal((await rejection(() => suggestionLogWrite({ op: "seen", suggestion_id: "s-1", status: "done" }, f.env))).name, "ValidationError");
});

test("a suggestion drafted with no key is held verbatim beside the posted log, then released", async (t) => {
  const f = fixture(t);
  assert.deepEqual(suggestionLogRead(f.env).held, []);
  const draft = { title: "Shorter letters", body: "Letters run long.", source: "user", items: [{ pain: "Too long", where: "draft", done_test: "One page", constraints: [], changes: [] }] };
  const { status, held_id } = await suggestionLogWrite({ op: "hold", draft }, f.env);
  assert.equal(status, "held");
  await suggestionLogWrite({ op: "add", suggestion_id: "s-1", title: "Another" }, f.env);
  const log = suggestionLogRead(f.env);
  assert.equal(log.suggestions.length, 1);
  assert.equal(log.held.length, 1);
  assert.deepEqual(log.held[0].draft, draft);
  assert.equal(log.held[0].held_id, held_id);
  assert.match(log.held[0].held_on, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal((await suggestionLogWrite({ op: "release", held_id }, f.env)).status, "released");
  assert.deepEqual(suggestionLogRead(f.env).held, []);
  assert.equal(suggestionLogRead(f.env).suggestions.length, 1);
  assert.equal((await rejection(() => suggestionLogWrite({ op: "release", held_id }, f.env))).code, "not_found");
  for (const bad of [undefined, "text", { title: "No body" }, { body: "No title" }]) {
    assert.equal((await rejection(() => suggestionLogWrite({ op: "hold", draft: bad }, f.env))).name, "ValidationError");
  }
});

test("a log written before held suggestions existed still reads", async (t) => {
  const f = fixture(t);
  writeFileSync(f.logFile, JSON.stringify({ suggestions: [] }));
  assert.deepEqual(suggestionLogRead(f.env), { suggestions: [], held: [] });
});
