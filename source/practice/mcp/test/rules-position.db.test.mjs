// rules__move and rules__branch: a session's position on its skill's rules map, stored in the
// matter's drafting database (Engineering/1. Spec/2026-10-09_rules-dag-spec.md §4.4-§4.8, schema
// v73). fixtures/rules-dag/position/ is skill `rpos`: its own SKILL.md, with all six /draft facts,
// and a small map with a job, a side node and an out-of-bounds node.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const { freshSubmissionDb, submissionDbAt } = await import("./helpers/template-db.mjs");
const { submissionDataExecute, submissionDataQuery } = await import("../build/submission/backend.js");
const { callTool, dispatchTool } = await import("../build/dispatch.js");
const { hostLocalPath } = await import("../build/submission/lock.js");

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "rules-dag", "position");

// No step reads the practitioner's coclerk.json: a scratch config for the whole file.
const scratch = mkdtempSync(join(tmpdir(), "coclerk-rules-position-config-"));
writeFileSync(join(scratch, "coclerk.json"), JSON.stringify({ case_data_root: scratch }));
process.env.COCLERK_CONFIG_PATH = join(scratch, "coclerk.json");
test.after(() => rmSync(scratch, { recursive: true, force: true }));

/** A checkout holding skill `rpos`, for this test only. Set after the database exists, because the
 * migration scripts resolve through the real checkout. */
function checkout(t) {
  const root = mkdtempSync(join(tmpdir(), "coclerk-rules-position-"));
  const skill = join(root, ".claude", "skills", "rpos");
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

/** A migrated drafting database with three queued jobs, and the fixture skill. */
async function matter(t) {
  const dir = mkdtempSync(join(tmpdir(), "coclerk-rules-position-db-"));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
  const dbPath = join(dir, "submission.sqlite");
  await freshSubmissionDb(dbPath);
  await submissionDataExecute(
    dbPath,
    `INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L8470 - Larchmont', 'CAN/BC/BCSC');
     INSERT INTO tickets (id, proceeding_id, title, intent, status, kind, billing_anchor, created) VALUES (1, 1, 'Job one', 'Do it.', 'queued', 'work', 'L8470|x', '2026-10-01T09:00');
     INSERT INTO tickets (id, proceeding_id, title, intent, status, kind, billing_anchor, created) VALUES (2, 1, 'Job two', 'Do it.', 'queued', 'work', 'L8470|x', '2026-10-01T09:00');
     INSERT INTO tickets (id, proceeding_id, title, intent, status, kind, billing_anchor, created) VALUES (3, 1, 'Job three', 'Do it.', 'queued', 'work', 'L8470|x', '2026-10-01T09:00');`
  );
  checkout(t);
  return dbPath;
}

const query = (dbPath, sql, params = []) => submissionDataQuery(dbPath, sql, params).rows;
const hold = (dbPath, job, token) =>
  submissionDataExecute(dbPath, `UPDATE tickets SET status = 'wip', locked_by = '${token}', locked_at = '2026-10-09T10:00' WHERE id = ${job};`);
const steps = (dbPath, job, n) =>
  submissionDataExecute(dbPath, Array.from({ length: n }, (_, i) => `INSERT INTO ticket_steps (ticket_id, ordinal, text) VALUES (${job}, ${i + 1}, 'Step ${i + 1}');`).join("\n"));
const move = (dbPath, token, to, facts) => callTool({}, "rules__move", { db_path: dbPath, session_token: token, to, ...(facts ? { facts } : {}) });
const branch = (dbPath, token, action, label) => callTool({}, "rules__branch", { db_path: dbPath, session_token: token, action, label });
const position = (dbPath, token, name = "main") =>
  query(dbPath, "SELECT path, session_facts, in_force, updated_at FROM session_position WHERE session_token = ? AND branch = ?", [token, name])[0];
const served = (dbPath, token) => query(dbPath, "SELECT rule_id, node, path, served_at FROM rule_served WHERE session_token = ? ORDER BY id", [token]);
const sent = (xml) => [...xml.matchAll(/<rule id="([^"]+)"/g)].map((m) => m[1]);
const attr = (xml, tag, name) => new RegExp(`<${tag}[^>]* ${name}="([^"]*)"`).exec(xml)?.[1];
const refused = (pattern, code = "data_error") => (err) => {
  assert.match(err.message, pattern);
  if (code !== "data_error") assert.equal(err.code, code);
  return true;
};
const STAMP = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d$/;

test("a v72 database is refused naming drafting_data__migrate, and the v73 hop adds only the four tables", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "coclerk-rules-position-v72-"));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
  const dbPath = join(dir, "submission.sqlite");
  submissionDbAt(dbPath, 72);
  const master = () => query(dbPath, "SELECT type, name, sql FROM sqlite_master ORDER BY type, name");
  const before = master();

  await assert.rejects(move(dbPath, "sess-a", "rpos/session"), refused(/schema version 72.*needs version 73\. Run drafting_data__migrate on it first/, "schema_behind"));
  await assert.rejects(branch(dbPath, "sess-a", "open", "q1"), refused(/Run drafting_data__migrate/, "schema_behind"));

  // drafting_data__migrate runs every pending hop, so the v73 hop is applied alone to read what it adds.
  submissionDbAt(dbPath, 73);
  const after = master();
  const key = (r) => `${r.type} ${r.name}`;
  assert.deepEqual(after.filter((r) => !before.some((b) => key(b) === key(r))).map(key).sort(), [
    "index idx_rule_served_rule",
    "index sqlite_autoindex_session_position_1",
    "table job_position",
    "table out_of_bounds_visit",
    "table rule_served",
    "table session_position",
  ]);
  // Nothing else changed: every v72 entry is still there, with the same SQL.
  for (const b of before) assert.deepEqual(after.find((r) => key(r) === key(b)), b);
  assert.equal(query(dbPath, "SELECT value FROM db_meta WHERE key = 'schema_version'")[0].value, "73");

  // The tool the refusal names brings a v72 database to the current schema, the v73 hop first.
  const behind = join(dir, "behind.sqlite");
  submissionDbAt(behind, 72);
  const result = await callTool({}, "drafting_data__migrate", { db_path: behind });
  assert.deepEqual(result.applied[0], { from: 72, to: 73 });
});

test("the first move sends the whole path but no root rule, stores the position and logs each rule sent", async (t) => {
  const dbPath = await matter(t);
  const xml = await move(dbPath, "sess-a", "rpos/session", { host: "code" });
  assert.equal(
    xml,
    [
      '<rules position="rpos/session" branch="main" serve="full">',
      '  <position path="rpos rpos/session"/>',
      '  <rule id="rpos.session.s" node="rpos/session">',
      "Session rule S.",
      "  </rule>",
      '  <rule id="rpos.session.unattended" node="rpos/session" conditional_on="unattended">',
      "Unattended rule U.",
      "  </rule>",
      "  <likely_next>",
      '    <node id="rpos/job" weight="0.6" when="A job is being got"/>',
      '    <node id="rpos/side" weight="0.2" when="A read-only question outside the held job"/>',
      '    <node id="rpos/outline" weight="0.2" when="New work is described"/>',
      "  </likely_next>",
      "</rules>",
    ].join("\n")
  );
  const row = position(dbPath, "sess-a");
  assert.equal(row.path, "rpos rpos/session");
  assert.equal(row.session_facts, '{"host":"code"}');
  assert.deepEqual(JSON.parse(row.in_force), [["rpos.session.s", []], ["rpos.session.unattended", ["unattended"]]]);
  assert.match(row.updated_at, STAMP);
  const log = served(dbPath, "sess-a");
  assert.deepEqual(log.map((r) => [r.rule_id, r.node, r.path]), [
    ["rpos.session.s", "rpos/session", "rpos rpos/session"],
    ["rpos.session.unattended", "rpos/session", "rpos rpos/session"],
  ]);
  assert.match(log[0].served_at, STAMP);
});

test("moving to a child sends only its rules and names the rest kept; session facts stay with the position", async (t) => {
  const dbPath = await matter(t);
  await move(dbPath, "sess-a", "rpos/session", { unattended: true, host: "code" });
  const xml = await move(dbPath, "sess-a", "rpos/job");
  assert.equal(
    xml,
    [
      '<rules position="rpos/job" branch="main" serve="delta">',
      '  <position path="rpos rpos/session rpos/job"/>',
      '  <kept ids="rpos.session.s rpos.session.unattended"/>',
      '  <rule id="rpos.job.steps" node="rpos/job" conditional_on="job_steps">',
      "Job rule M: read the plan back step by step.",
      "  </rule>",
      "  <likely_next>",
      `    <node id="rpos/job/work" weight="0.7" when="The held job's plan is approved"/>`,
      "  </likely_next>",
      "</rules>",
    ].join("\n")
  );
  // unattended was given once, at the first move, and still applies: rule U is unconditional.
  assert.deepEqual(JSON.parse(position(dbPath, "sess-a").in_force), [
    ["rpos.session.s", []],
    ["rpos.session.unattended", []],
    ["rpos.job.steps", ["job_steps"]],
  ]);
  assert.equal(position(dbPath, "sess-a").session_facts, '{"host":"code","unattended":"true"}');
  assert.deepEqual(served(dbPath, "sess-a").map((r) => r.rule_id), ["rpos.session.s", "rpos.session.unattended", "rpos.job.steps"]);
});

test("an unknown node id is refused naming the current node's children, and nothing moves", async (t) => {
  const dbPath = await matter(t);
  await move(dbPath, "sess-a", "rpos/job");
  await assert.rejects(move(dbPath, "sess-a", "rpos/nowhere"), refused(/rules__move: unknown node 'rpos\/nowhere'; the children of rpos\/job are: rpos\/job\/work$/));
  await assert.rejects(move(dbPath, "sess-b", "rpos/nowhere"), refused(/the children of rpos are: rpos\/session, rpos\/out-of-bounds$/));
  assert.equal(position(dbPath, "sess-a").path, "rpos rpos/session rpos/job");
  assert.equal(position(dbPath, "sess-b"), undefined);
});

test("a keyword cannot be a session's first move", async (t) => {
  const dbPath = await matter(t);
  await assert.rejects(move(dbPath, "sess-a", "up"), refused(/no rules position yet, so its first move names a node id, not 'up'/));
  await assert.rejects(move(dbPath, "sess-a", "out_of_bounds"), refused(/not 'out_of_bounds'/));
});

test("job_held and job_steps are read from the database, never passed; a job with no steps leaves job_steps unknown", async (t) => {
  const dbPath = await matter(t);
  await move(dbPath, "sess-a", "rpos/session");
  await assert.rejects(move(dbPath, "sess-a", "rpos/job", { job_held: true }), refused(/facts\.job_held is read from the drafting database/));
  await assert.rejects(move(dbPath, "sess-a", "rpos/job", { job_steps: "many" }), refused(/facts\.job_steps is read from the drafting database/));

  await hold(dbPath, 1, "sess-a");
  const none = await move(dbPath, "sess-a", "rpos/job");
  assert.equal(attr(none, "rules", "job"), "1");
  assert.deepEqual(sent(none), ["rpos.job.hold", "rpos.job.steps"]);
  assert.match(none, /<rule id="rpos\.job\.hold" node="rpos\/job">/);
  assert.match(none, /<rule id="rpos\.job\.steps" node="rpos\/job" conditional_on="job_steps">/);

  // The fact changed in the database: the rule it settles is sent again, now unconditional.
  await steps(dbPath, 1, 2);
  const many = await move(dbPath, "sess-a", "rpos/job/work");
  assert.deepEqual(sent(many), ["rpos.job.steps", "rpos.work.w"]);
  assert.match(many, /<rule id="rpos\.job\.steps" node="rpos\/job">/);
  assert.equal(attr(many, "kept", "ids"), "rpos.session.s rpos.session.unattended rpos.job.hold");
});

test("up withdraws the node left and sends back whole a rule it had overridden", async (t) => {
  const dbPath = await matter(t);
  await hold(dbPath, 1, "sess-a");
  await move(dbPath, "sess-a", "rpos/job/work");
  const obstacle = await move(dbPath, "sess-a", "rpos/job/obstacle", { obstacle: "separate_work" });
  assert.equal(attr(obstacle, "rules", "serve"), "delta");
  assert.deepEqual(sent(obstacle), ["rpos.obstacle.spin-off"]);
  assert.equal(attr(obstacle, "withdrawn", "ids"), "rpos.job.hold");

  const up = await move(dbPath, "sess-a", "up");
  assert.equal(attr(up, "position", "path"), "rpos rpos/session rpos/job rpos/job/work");
  assert.equal(attr(up, "rules", "serve"), "delta");
  assert.deepEqual(sent(up), ["rpos.job.hold"]);
  assert.equal(attr(up, "withdrawn", "ids"), "rpos.obstacle.spin-off");
  assert.equal(attr(up, "kept", "ids"), "rpos.session.s rpos.session.unattended rpos.job.steps rpos.work.w");
});

test("a jump keeps the current path to its deepest node that reaches the target; sideways it sends the whole path and names the path left", async (t) => {
  const dbPath = await matter(t);
  await move(dbPath, "sess-a", "rpos/job/work");
  assert.equal(position(dbPath, "sess-a").path, "rpos rpos/session rpos/job rpos/job/work");

  // rpos/side is reached from rpos/job/work, so the path keeps the job.
  const side = await move(dbPath, "sess-a", "rpos/side");
  assert.equal(attr(side, "position", "path"), "rpos rpos/session rpos/job rpos/job/work rpos/side");
  assert.equal(attr(side, "rules", "serve"), "delta");

  const outline = await move(dbPath, "sess-a", "rpos/outline");
  assert.equal(attr(outline, "position", "path"), "rpos rpos/session rpos/outline");
  assert.equal(attr(outline, "position", "left"), "rpos rpos/session rpos/job rpos/job/work rpos/side");
  assert.equal(attr(outline, "rules", "serve"), "full");
  assert.deepEqual(sent(outline), ["rpos.session.s", "rpos.session.unattended", "rpos.outline.o"]);
  assert.doesNotMatch(outline, /<kept|<withdrawn/);
});

test("a move to the current node resends the whole path", async (t) => {
  const dbPath = await matter(t);
  await move(dbPath, "sess-a", "rpos/session");
  await move(dbPath, "sess-a", "rpos/job");
  const stay = await move(dbPath, "sess-a", "rpos/job");
  assert.equal(attr(stay, "rules", "serve"), "full");
  assert.equal(attr(stay, "position", "left"), undefined);
  assert.deepEqual(sent(stay), ["rpos.session.s", "rpos.session.unattended", "rpos.job.steps"]);
});

test("root rules are never sent and never in force, on a move or a branch", async (t) => {
  const dbPath = await matter(t);
  await hold(dbPath, 1, "sess-a");
  const outputs = [
    await move(dbPath, "sess-a", "rpos"),
    await move(dbPath, "sess-a", "rpos/job/work"),
    await branch(dbPath, "sess-a", "open", "q1"),
    await branch(dbPath, "sess-a", "close", "q1"),
    await move(dbPath, "sess-a", "rpos"),
  ];
  assert.equal(sent(outputs[0]).length, 0);
  for (const xml of outputs) assert.doesNotMatch(xml, /rpos\.root\.r|Root rule R/);
  assert.equal(position(dbPath, "sess-a").in_force, "[]");
  assert.equal(served(dbPath, "sess-a").filter((r) => r.rule_id === "rpos.root.r").length, 0);
  // Back at the root, every rule sent on the way is withdrawn.
  assert.equal(attr(outputs[4], "withdrawn", "ids"), "rpos.session.s rpos.session.unattended rpos.job.hold rpos.job.steps rpos.work.w");
});

test("a side branch opens while a job is held, refuses moves until it closes, and closes back to the main path", async (t) => {
  const dbPath = await matter(t);
  await move(dbPath, "sess-c", "rpos/session");
  await assert.rejects(branch(dbPath, "sess-c", "open", "q1"), refused(/opens only while this session holds a job; outside a job, rules__move to rpos\/side/));
  await assert.rejects(branch(dbPath, "sess-n", "open", "q1"), refused(/no rules position yet; rules__move first/));

  await hold(dbPath, 2, "sess-b");
  await move(dbPath, "sess-b", "rpos/job/obstacle");
  const open = await branch(dbPath, "sess-b", "open", "q1");
  assert.equal(attr(open, "rules", "branch"), "q1");
  assert.equal(attr(open, "rules", "job"), "2");
  assert.equal(attr(open, "rules", "serve"), "delta");
  assert.equal(attr(open, "position", "path"), "rpos rpos/session rpos/job rpos/job/work rpos/side");
  assert.deepEqual(sent(open), ["rpos.side.q"]);
  assert.equal(attr(open, "withdrawn", "ids"), "rpos.obstacle.spin-off");
  assert.equal(position(dbPath, "sess-b", "q1").path, "rpos rpos/session rpos/job rpos/job/work rpos/side");

  await assert.rejects(move(dbPath, "sess-b", "rpos/job/work"), refused(/the side branch 'q1' is open; close the side branch first/));
  await assert.rejects(branch(dbPath, "sess-b", "open", "q2"), refused(/the side branch 'q1' is already open; close it first/));
  await assert.rejects(branch(dbPath, "sess-b", "close", "q2"), refused(/no side branch 'q2' is open; the open one is 'q1'/));
  await assert.rejects(branch(dbPath, "sess-b", "open", "main"), refused(/may not be "main"/));

  const close = await branch(dbPath, "sess-b", "close", "q1");
  assert.equal(attr(close, "rules", "branch"), "main");
  assert.equal(attr(close, "position", "path"), "rpos rpos/session rpos/job rpos/job/work rpos/job/obstacle");
  assert.deepEqual(sent(close), ["rpos.obstacle.spin-off"]);
  assert.equal(attr(close, "withdrawn", "ids"), "rpos.side.q");
  assert.equal(position(dbPath, "sess-b", "q1"), undefined);
  assert.equal(position(dbPath, "sess-b").path, "rpos rpos/session rpos/job rpos/job/work rpos/job/obstacle");
  // The branch moved nothing on the main path or the job's.
  assert.equal(query(dbPath, "SELECT last_in_bounds_path FROM job_position WHERE job_id = 2")[0].last_in_bounds_path, "rpos rpos/session rpos/job rpos/job/work rpos/job/obstacle");
  // A move works again once it is closed.
  assert.equal(attr(await move(dbPath, "sess-b", "up"), "position", "path"), "rpos rpos/session rpos/job rpos/job/work");
});

test("a takeover resumes at the job's last in-bounds path with a note on the detour, and never its rules", async (t) => {
  const dbPath = await matter(t);
  await hold(dbPath, 1, "sess-a");
  await move(dbPath, "sess-a", "rpos/job/work");
  const away = await move(dbPath, "sess-a", "out_of_bounds");
  assert.equal(attr(away, "position", "path"), "rpos rpos/out-of-bounds");
  assert.equal(attr(away, "position", "left"), "rpos rpos/session rpos/job rpos/job/work");
  assert.equal(attr(away, "rules", "serve"), "full");
  assert.deepEqual(sent(away), ["rpos.oob.x"]);
  const [visit] = query(dbPath, "SELECT id, session_token, from_path, turn_summary, provisional_rules, visited_at FROM out_of_bounds_visit");
  assert.equal(visit.session_token, "sess-a");
  assert.equal(visit.from_path, "rpos rpos/session rpos/job rpos/job/work");
  assert.equal(visit.turn_summary, null);
  assert.equal(visit.provisional_rules, null);
  assert.match(visit.visited_at, STAMP);
  const [job] = query(dbPath, "SELECT last_in_bounds_path, went_out_of_bounds_to, updated_at FROM job_position WHERE job_id = 1");
  assert.equal(job.last_in_bounds_path, "rpos rpos/session rpos/job rpos/job/work");
  assert.equal(job.went_out_of_bounds_to, visit.id);
  assert.match(job.updated_at, STAMP);
  // A stay out of bounds is not a second visit.
  await move(dbPath, "sess-a", "rpos/out-of-bounds");
  assert.equal(query(dbPath, "SELECT COUNT(*) AS n FROM out_of_bounds_visit")[0].n, 1);
  // Phase 7 will store improvised rules here; a takeover must never serve them.
  await submissionDataExecute(dbPath, `UPDATE out_of_bounds_visit SET provisional_rules = 'Improvised rule P.' WHERE id = ${visit.id};`);

  // sess-z enters (its first move) and then takes the job over, as /draft does.
  await move(dbPath, "sess-z", "rpos/session");
  await submissionDataExecute(dbPath, "UPDATE tickets SET locked_by = 'sess-z' WHERE id = 1;");
  const takeover = await move(dbPath, "sess-z", "takeover");
  assert.equal(attr(takeover, "position", "path"), "rpos rpos/session rpos/job rpos/job/work");
  assert.equal(attr(takeover, "rules", "serve"), "full");
  assert.equal(attr(takeover, "rules", "job"), "1");
  assert.equal(
    attr(takeover, "takeover", "note"),
    `The previous holder went out of bounds from rpos rpos/session rpos/job rpos/job/work at ${visit.visited_at}; the rules it improvised there are not served.`
  );
  assert.deepEqual(sent(takeover), ["rpos.session.s", "rpos.session.unattended", "rpos.job.hold", "rpos.job.steps", "rpos.work.w"]);
  assert.doesNotMatch(takeover, /Detour rule X|Improvised rule P/);
  // The new holder resumed in bounds, so the job no longer records a detour.
  assert.equal(query(dbPath, "SELECT went_out_of_bounds_to FROM job_position WHERE job_id = 1")[0].went_out_of_bounds_to, null);
});

test("a takeover is refused without a held job, or for a job with no recorded position", async (t) => {
  const dbPath = await matter(t);
  await move(dbPath, "sess-z", "rpos/session");
  await assert.rejects(move(dbPath, "sess-z", "takeover"), refused(/holds no job to take over; assign it first/));
  // A job held before positions were recorded has no row.
  await hold(dbPath, 3, "sess-z");
  await assert.rejects(move(dbPath, "sess-z", "takeover"), refused(/job 3 has no recorded rules position .*; rules__move to rpos\/job instead/));
});

test("a job assigned and taken straight out of bounds records the path left, so a takeover resumes there", async (t) => {
  const dbPath = await matter(t);
  await move(dbPath, "sess-a", "rpos/session");
  await hold(dbPath, 1, "sess-a");
  assert.equal(query(dbPath, "SELECT COUNT(*) AS n FROM job_position")[0].n, 0);
  await move(dbPath, "sess-a", "out_of_bounds");
  const [visit] = query(dbPath, "SELECT id, visited_at FROM out_of_bounds_visit");
  const [job] = query(dbPath, "SELECT last_in_bounds_path, went_out_of_bounds_to, updated_at FROM job_position WHERE job_id = 1");
  assert.equal(job.last_in_bounds_path, "rpos rpos/session");
  assert.equal(job.went_out_of_bounds_to, visit.id);
  assert.match(job.updated_at, STAMP);

  await move(dbPath, "sess-z", "rpos/session");
  await submissionDataExecute(dbPath, "UPDATE tickets SET locked_by = 'sess-z' WHERE id = 1;");
  const takeover = await move(dbPath, "sess-z", "takeover");
  assert.equal(attr(takeover, "position", "path"), "rpos rpos/session");
  assert.equal(attr(takeover, "takeover", "note"), `The previous holder went out of bounds from rpos rpos/session at ${visit.visited_at}; the rules it improvised there are not served.`);
});

test("a takeover whose recorded path is no longer on the map is refused", async (t) => {
  const dbPath = await matter(t);
  await hold(dbPath, 1, "sess-a");
  await move(dbPath, "sess-a", "rpos/job/work");
  // The map changed after the job's position was recorded: rpos/gone is no node of it.
  await submissionDataExecute(dbPath, "UPDATE job_position SET last_in_bounds_path = 'rpos rpos/session rpos/gone' WHERE job_id = 1;");
  await move(dbPath, "sess-z", "rpos/session");
  await submissionDataExecute(dbPath, "UPDATE tickets SET locked_by = 'sess-z' WHERE id = 1;");
  await assert.rejects(
    move(dbPath, "sess-z", "takeover"),
    refused(/job 1's recorded position 'rpos rpos\/session rpos\/gone' is no longer a path on the rpos map; rules__move to rpos\/job instead/)
  );
  assert.equal(position(dbPath, "sess-z").path, "rpos rpos/session");
});

test("up at the root is refused, and a node on another skill's map is refused", async (t) => {
  const dbPath = await matter(t);
  await move(dbPath, "sess-a", "rpos");
  await assert.rejects(move(dbPath, "sess-a", "up"), refused(/the position is already the root rpos; there is no up/));
  await assert.rejects(move(dbPath, "sess-a", "rdag/job"), refused(/'rdag\/job' is on the rdag map, but this session's position is on the rpos map/));
  assert.equal(position(dbPath, "sess-a").path, "rpos");
});

test("a fact given for one call does not persist: a stay without it brings its rule back conditional", async (t) => {
  const dbPath = await matter(t);
  await hold(dbPath, 1, "sess-a");
  await move(dbPath, "sess-a", "rpos/session", { host: "code" });
  const obstacle = await move(dbPath, "sess-a", "rpos/job/obstacle", { obstacle: "separate_work" });
  assert.match(obstacle, /<rule id="rpos\.obstacle\.spin-off" node="rpos\/job\/obstacle">/);
  const stay = await move(dbPath, "sess-a", "rpos/job/obstacle");
  assert.match(stay, /<rule id="rpos\.obstacle\.spin-off" node="rpos\/job\/obstacle" conditional_on="obstacle">/);
  // Conditional, the spin-off overrides nothing, so the rule it overrode is back.
  assert.ok(sent(stay).includes("rpos.job.hold"));
  assert.equal(position(dbPath, "sess-a").session_facts, '{"host":"code"}');
});

test("a stale write lock broken by the position write is reported as a warning", async (t) => {
  const dbPath = await matter(t);
  const locks = mkdtempSync(join(tmpdir(), "coclerk-rules-position-locks-"));
  const before = process.env.COCLERK_SUBMISSION_LOCK_ROOT;
  process.env.COCLERK_SUBMISSION_LOCK_ROOT = locks;
  t.after(() => {
    if (before === undefined) delete process.env.COCLERK_SUBMISSION_LOCK_ROOT;
    else process.env.COCLERK_SUBMISSION_LOCK_ROOT = before;
    rmSync(locks, { recursive: true, force: true });
  });
  const lock = hostLocalPath(dbPath, "lock");
  writeFileSync(lock, JSON.stringify({ pid: 1, ts: "2026-10-09T00:00:00.000Z", dbPath, token: randomUUID() }));
  const past = new Date(Date.now() - 20 * 60_000);
  utimesSync(lock, past, past);
  const xml = await move(dbPath, "sess-a", "rpos/session");
  assert.match(attr(xml, "warning", "message"), /^broke a stale drafting-data write lock \(>15 min old\) before writing/);
  assert.equal(attr(xml, "log_error", "message"), undefined);
  assert.equal(position(dbPath, "sess-a").path, "rpos rpos/session");
});

test("a serve log that cannot be written is reported as log_error and blocks neither the move nor its rules", async (t) => {
  const dbPath = await matter(t);
  await submissionDataExecute(dbPath, "DROP TABLE rule_served;");
  const xml = await move(dbPath, "sess-a", "rpos/session");
  assert.deepEqual(sent(xml), ["rpos.session.s", "rpos.session.unattended"]);
  assert.match(attr(xml, "log_error", "message"), /^the serve log was not written: .*no such table: rule_served/s);
  assert.equal(position(dbPath, "sess-a").path, "rpos rpos/session");
});

test("dispatchTool serves the move as raw XML, not JSON", async (t) => {
  const dbPath = await matter(t);
  const result = await dispatchTool({}, "rules__move", { db_path: dbPath, session_token: "sess-a", to: "rpos/session" });
  assert.equal(result.isError, undefined);
  assert.match(result.content[0].text, /^<rules position="rpos\/session" branch="main" serve="full">\n/);
});
