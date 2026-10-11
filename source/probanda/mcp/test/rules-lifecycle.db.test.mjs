// rules__lifecycle: each node rule's stage read off the serve log in the matter's drafting database
// (Engineering/1. Spec/2026-10-09_rules-dag-spec.md §4.8, plan phase 4). fixtures/rules-dag/lifecycle/
// is skill `rlife`: a root rule, a session node whose first rule replaces a SKILL.md atom, a job
// node and an out-of-bounds node.

import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const { freshSubmissionDb, submissionDbAt } = await import("./helpers/template-db.mjs");
const { submissionDataExecute, submissionDataQuery } = await import("../build/submission/backend.js");
const { callTool, dispatchTool } = await import("../build/dispatch.js");

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "rules-dag", "lifecycle");

// No step reads the practitioner's coclerk.json: a scratch config for the whole file.
const scratch = mkdtempSync(join(tmpdir(), "coclerk-rules-lifecycle-config-"));
writeFileSync(join(scratch, "coclerk.json"), JSON.stringify({ case_data_root: scratch }));
process.env.COCLERK_CONFIG_PATH = join(scratch, "coclerk.json");
test.after(() => rmSync(scratch, { recursive: true, force: true }));

/** A checkout holding skill `rlife`, for this test only, set after the database exists. */
function checkout(t) {
  const root = mkdtempSync(join(tmpdir(), "coclerk-rules-lifecycle-"));
  const skill = join(root, ".claude", "skills", "rlife");
  const nodes = join(skill, "rules", "nodes");
  mkdirSync(nodes, { recursive: true });
  copyFileSync(join(FIXTURE, "SKILL.md"), join(skill, "SKILL.md"));
  for (const name of readdirSync(join(FIXTURE, "nodes"))) copyFileSync(join(FIXTURE, "nodes", name), join(nodes, name));
  const before = process.env.COCLERK_REPO_ROOT;
  process.env.COCLERK_REPO_ROOT = root;
  t.after(() => {
    if (before === undefined) delete process.env.COCLERK_REPO_ROOT;
    else process.env.COCLERK_REPO_ROOT = before;
    rmSync(root, { recursive: true, force: true });
  });
}

async function matter(t) {
  const dir = mkdtempSync(join(tmpdir(), "coclerk-rules-lifecycle-db-"));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
  const dbPath = join(dir, "submission.sqlite");
  await freshSubmissionDb(dbPath);
  checkout(t);
  return dbPath;
}

const query = (dbPath, sql, params = []) => submissionDataQuery(dbPath, sql, params).rows;
const move = (dbPath, token, to) => callTool({}, "rules__move", { db_path: dbPath, session_token: token, to });
const lifecycle = (dbPath, since) => callTool({}, "rules__lifecycle", { db_path: dbPath, ...(since ? { since } : {}) });
const tag = (xml, name, id) => new RegExp(`<${name} [^>]*id="${id.replace(/\./g, "\\.")}"[^>]*/>`).exec(xml)?.[0];
const attr = (line, name) => new RegExp(` ${name}="([^"]*)"`).exec(line ?? "")?.[1];
const refused = (pattern, code) => (err) => {
  assert.match(err.message, pattern);
  if (code) assert.equal(err.code, code);
  return true;
};
const STAMP = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d$/;

test("moves log each rule sent, and a rule is migrated after one session and verified after a second", async (t) => {
  const dbPath = await matter(t);
  assert.equal(await lifecycle(dbPath), "<lifecycle>\n</lifecycle>");

  await move(dbPath, "sess-a", "rlife/session");
  await move(dbPath, "sess-a", "rlife/session"); // a stay resends the path: a second serving, same session
  assert.deepEqual(
    query(dbPath, "SELECT rule_id, node, path, session_token FROM rule_served ORDER BY id"),
    [
      { rule_id: "rlife.session.release", node: "rlife/session", path: "rlife rlife/session", session_token: "sess-a" },
      { rule_id: "rlife.session.s", node: "rlife/session", path: "rlife rlife/session", session_token: "sess-a" },
      { rule_id: "rlife.session.release", node: "rlife/session", path: "rlife rlife/session", session_token: "sess-a" },
      { rule_id: "rlife.session.s", node: "rlife/session", path: "rlife rlife/session", session_token: "sess-a" },
    ]
  );

  let xml = await lifecycle(dbPath);
  let rule = tag(xml, "rule", "rlife.session.release");
  assert.equal(attr(rule, "node"), "rlife/session");
  assert.equal(attr(rule, "stage"), "migrated");
  assert.equal(attr(rule, "sessions"), "1");
  assert.equal(attr(rule, "served"), "2");
  assert.equal(attr(rule, "replaces"), "rlife.release.never-offer");
  assert.match(attr(rule, "first_served"), STAMP);
  assert.match(attr(rule, "last_served"), STAMP);
  // Never served: migrated, with no times. A root rule is never served, by design.
  assert.equal(tag(xml, "rule", "rlife.job.j"), '<rule id="rlife.job.j" node="rlife/job" stage="migrated" sessions="0" served="0"/>');
  assert.equal(tag(xml, "rule", "rlife.root.r"), '<rule id="rlife.root.r" node="rlife" stage="root" sessions="0" served="0"/>');
  assert.match(xml, /<skill name="rlife" root="1" migrated="4" verified="0">/);

  await move(dbPath, "sess-b", "rlife/session");
  xml = await lifecycle(dbPath);
  rule = tag(xml, "rule", "rlife.session.release");
  assert.equal(attr(rule, "stage"), "verified");
  assert.equal(attr(rule, "sessions"), "2");
  assert.equal(attr(rule, "served"), "3");
  assert.equal(attr(tag(xml, "rule", "rlife.session.s"), "stage"), "verified");
  assert.equal(attr(tag(xml, "rule", "rlife.job.j"), "stage"), "migrated");
  assert.match(xml, /<skill name="rlife" root="1" migrated="2" verified="2">/);
  // Rules come in node-file order, root first here, and every map rule is listed.
  assert.deepEqual(
    [...xml.matchAll(/<rule id="([^"]+)"/g)].map((m) => m[1]),
    ["rlife.job.j", "rlife.oob.x", "rlife.root.r", "rlife.session.release", "rlife.session.s"]
  );
});

test("servings count only on the rule's current node; a log row off the map is listed, never dropped", async (t) => {
  const dbPath = await matter(t);
  await submissionDataExecute(
    dbPath,
    `INSERT INTO rule_served (rule_id, node, path, session_token, served_at) VALUES
       ('rlife.job.j', 'rlife/session', 'rlife rlife/session', 'old-1', '2026-10-01T09:00:00'),
       ('rlife.job.j', 'rlife/session', 'rlife rlife/session', 'old-2', '2026-10-02T09:00:00'),
       ('rlife.gone', 'rlife/job', 'rlife rlife/session rlife/job', 'old-1', '2026-10-01T09:00:00');`
  );
  const xml = await lifecycle(dbPath);
  // Served twice from another node: on its own node it is still only migrated.
  assert.equal(tag(xml, "rule", "rlife.job.j"), '<rule id="rlife.job.j" node="rlife/job" stage="migrated" sessions="0" served="0"/>');
  assert.match(
    xml,
    /    <off_map>\n      <served rule_id="rlife\.gone" node="rlife\/job" sessions="1" served="1" first_served="2026-10-01T09:00:00" last_served="2026-10-01T09:00:00"\/>\n      <served rule_id="rlife\.job\.j" node="rlife\/session" sessions="2" served="2" first_served="2026-10-01T09:00:00" last_served="2026-10-02T09:00:00"\/>\n    <\/off_map>/
  );
});

test("out-of-bounds visits list from_path, visited_at and a summary where one exists, those since a date when given", async (t) => {
  const dbPath = await matter(t);
  await move(dbPath, "sess-a", "rlife/session");
  await move(dbPath, "sess-a", "out_of_bounds");
  let xml = await lifecycle(dbPath);
  const visit = /<visit [^>]*\/>/.exec(xml)[0];
  assert.equal(attr(visit, "session"), undefined, "no session token is served");
  assert.equal(attr(visit, "from_path"), "rlife rlife/session");
  assert.match(attr(visit, "visited_at"), STAMP);
  assert.equal(attr(visit, "summary"), undefined, "a NULL summary is an absent attribute");
  assert.equal(attr(visit, "rules"), undefined, "no rules recorded is an absent attribute");
  assert.equal(attr(tag(xml, "rule", "rlife.oob.x"), "sessions"), "1");

  await submissionDataExecute(
    dbPath,
    `INSERT INTO out_of_bounds_visit (session_token, from_path, turn_summary, visited_at)
     VALUES ('sess-old', 'rlife rlife/session rlife/job', 'Asked for a <costs> estimate & "a quote"', '2026-01-05T10:00:00');`
  );
  xml = await lifecycle(dbPath);
  assert.equal((xml.match(/<visit /g) ?? []).length, 2);
  assert.match(xml, / summary="Asked for a &lt;costs> estimate &amp; &quot;a quote&quot;"\/>/);

  xml = await lifecycle(dbPath, "2026-02-01");
  assert.match(xml, /^<lifecycle since="2026-02-01">/);
  assert.equal((xml.match(/<visit /g) ?? []).length, 1);
  assert.doesNotMatch(xml, /sess-old/);

  // rules__provisional records the summary and the rules, and the visit counts them, never quotes them.
  const rule = (id) => ({ id, door: "two-way", act: "look", text: `Rule text ${id}.` });
  await callTool({}, "rules__provisional", { db_path: dbPath, session_token: "sess-a", turn_summary: "Asked to look.", rules: [rule("oob.a"), rule("oob.b")] });
  const recorded = /<visit [^>]*from_path="rlife rlife\/session"[^>]*\/>/.exec(await lifecycle(dbPath))[0];
  assert.equal(attr(recorded, "summary"), "Asked to look.");
  assert.equal(attr(recorded, "rules"), "2");
  assert.doesNotMatch(await lifecycle(dbPath), /Rule text/);
  // since filters visits only: the servings are all-time.
  assert.equal(attr(tag(xml, "rule", "rlife.session.s"), "served"), "1");
});

test("a malformed or impossible since and a database below v73 are refused", async (t) => {
  // The v72 database first, because the migration scripts resolve through the real checkout.
  const dir = mkdtempSync(join(tmpdir(), "coclerk-rules-lifecycle-v72-"));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
  const old = join(dir, "submission.sqlite");
  submissionDbAt(old, 72);
  const dbPath = await matter(t);

  await assert.rejects(lifecycle(dbPath, "10/01/2026"), refused(/rules__lifecycle\.since must be a date, YYYY-MM-DD/));
  await assert.rejects(lifecycle(dbPath, "2026-13-45"), refused(/rules__lifecycle\.since must be a date, YYYY-MM-DD, not "2026-13-45"/));
  await assert.rejects(lifecycle(old), refused(/schema version 72.*needs version 73\. Run drafting_data__migrate/, "schema_behind"));
});

test("dispatchTool serves the report as raw XML, not JSON", async (t) => {
  const dbPath = await matter(t);
  await move(dbPath, "sess-a", "rlife/session");
  const result = await dispatchTool({}, "rules__lifecycle", { db_path: dbPath });
  assert.equal(result.isError, undefined);
  assert.match(result.content[0].text, /^<lifecycle>\n  <skill name="rlife"/);
});
