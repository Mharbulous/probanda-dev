// SUBSTITUTE for the pilot's acceptance test 1 (contextual-rule-injection spec §16), as rules-DAG
// plan step 5.7 runs it without a Cowork session: the path a bare /draft open takes to a multi-step
// job's plan read-back, driven through the real /draft skill's map and pilot atoms. /draft's wiring
// (SKILL.md, "Rules for each step") reads `rules__at` at draft/enter before session entry, moves
// first to draft/session, then to draft/job for dispatch, premise check and plan read-back, and
// calls `skill_rules__applicable` for each operation as before. Between the two moves the session
// takes a Ready job of two steps (§16 test 1's board), so the job move reads `job_held` and
// `job_steps` from the database. On that path the real map holds only the shelve cluster's three
// job rules (rules-DAG 6.3), which the job move serves because a job is held, and none replaces an
// atom on the path. So a copy of the map gains two fixture rules, each replacing one atom on that
// path, the job one conditional on `job_steps: many`, to show the moves recorded in the serve log,
// `rules__lifecycle` reporting them, and the pilot leaving them out.

import assert from "node:assert/strict";
import { appendFileSync, copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const { freshSubmissionDb } = await import("./helpers/template-db.mjs");
const { submissionDataExecute, submissionDataQuery } = await import("../build/submission/backend.js");
const { callTool } = await import("../build/dispatch.js");
const { skillRulesApplicable } = await import("../build/files/skill-rules.js");
const { loadRulesDag } = await import("../build/files/rules-dag.js");

const DRAFT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", ".claude", "skills", "draft");
const OPEN_RULE = "draft.test.open-then";
const DISPATCH_RULE = "draft.test.dispatch-choose";
// The real map's rules on draft/job, in file order, served once a job is held.
const MAP_JOB_RULES = ["draft.shelve.own-job", "draft.shelve.never-offer", "draft.shelve.taken-over"];
const FIXTURE_RULES = {
  "session.md": `\n<!-- rule id=${OPEN_RULE} replaces=draft.open.then-opening -->\nFixture rule on draft/session.\n`,
  "job.md": `\n<!-- rule id=${DISPATCH_RULE} when=job_steps:many replaces=draft.dispatch.choose -->\nFixture rule on draft/job.\n`,
};

// No step reads the practitioner's coclerk.json: a scratch config for the whole file.
const scratch = mkdtempSync(join(tmpdir(), "coclerk-rules-draft-config-"));
writeFileSync(join(scratch, "coclerk.json"), JSON.stringify({ case_data_root: scratch }));
process.env.COCLERK_CONFIG_PATH = join(scratch, "coclerk.json");
test.after(() => rmSync(scratch, { recursive: true, force: true }));

/** A checkout holding a copy of the real /draft skill: SKILL.md, references and node map, plus `extra` node rules. */
function checkout(t, extra) {
  const root = mkdtempSync(join(tmpdir(), "coclerk-rules-draft-"));
  const skill = join(root, ".claude", "skills", "draft");
  mkdirSync(join(skill, "references"), { recursive: true });
  mkdirSync(join(skill, "rules", "nodes"), { recursive: true });
  copyFileSync(join(DRAFT, "SKILL.md"), join(skill, "SKILL.md"));
  for (const e of readdirSync(join(DRAFT, "references"), { withFileTypes: true })) {
    if (e.isFile() && e.name.endsWith(".md")) copyFileSync(join(DRAFT, "references", e.name), join(skill, "references", e.name));
  }
  for (const name of readdirSync(join(DRAFT, "rules", "nodes"))) {
    copyFileSync(join(DRAFT, "rules", "nodes", name), join(skill, "rules", "nodes", name));
  }
  for (const [name, text] of Object.entries(extra)) appendFileSync(join(skill, "rules", "nodes", name), text);
  const before = process.env.COCLERK_REPO_ROOT;
  process.env.COCLERK_REPO_ROOT = root;
  t.after(() => {
    if (before === undefined) delete process.env.COCLERK_REPO_ROOT;
    else process.env.COCLERK_REPO_ROOT = before;
    rmSync(root, { recursive: true, force: true });
  });
}

async function matter(t, extra) {
  const dir = mkdtempSync(join(tmpdir(), "coclerk-rules-draft-db-"));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
  const dbPath = join(dir, "submission.sqlite");
  await freshSubmissionDb(dbPath);
  checkout(t, extra);
  return dbPath;
}

const TOKEN = "accept-1";
const SESSION_FACTS = { unattended: false, host: "cowork" };
const served = (dbPath) =>
  submissionDataQuery(dbPath, "SELECT rule_id, node, path, session_token FROM rule_served ORDER BY id", []).rows;
const move = (dbPath, to, facts) => callTool({}, "rules__move", { db_path: dbPath, session_token: TOKEN, to, ...(facts ? { facts } : {}) });
const pilotIds = (operation, facts) => {
  const result = skillRulesApplicable("draft", operation, facts);
  return { ids: result.rules.map((r) => r.id), replaced: result.replaced ?? [] };
};
/** The session takes job 1, two steps, as assign_job would: in progress and locked to its token. */
const holdJob = (dbPath) =>
  submissionDataExecute(
    dbPath,
    `INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L8470 - Larchmont', 'CAN/BC/BCSC');
     INSERT INTO tickets (id, proceeding_id, title, intent, status, kind, billing_anchor, created, locked_by, locked_at)
       VALUES (1, 1, 'Job one', 'Do it.', 'wip', 'work', 'L8470|x', '2026-10-01T09:00', '${TOKEN}', '2026-10-09T10:00');
     INSERT INTO ticket_steps (ticket_id, ordinal, text) VALUES (1, 1, 'Step 1');
     INSERT INTO ticket_steps (ticket_id, ordinal, text) VALUES (1, 2, 'Step 2');`
  );
const tag = (xml, id) => new RegExp(`<rule id="${id.replace(/\./g, "\\.")}"[^>]*/>`).exec(xml)?.[0];

/** The acceptance path: entry, the opening, dispatch, premise check and plan read-back. */
async function walk(dbPath) {
  const enter = await callTool({}, "rules__at", { skill: "draft", path: ["draft", "draft/enter"], facts: SESSION_FACTS });
  const session = await move(dbPath, "draft/session", SESSION_FACTS);
  const opening = ["enter", "open"].map((op) => pilotIds(op, { job_held: false }));
  await holdJob(dbPath);
  const job = await move(dbPath, "draft/job");
  const jobOps = [
    pilotIds("dispatch", {}),
    pilotIds("premise_check", {}),
    pilotIds("plan_readback", { job_steps: "many", premise: "holds" }),
  ];
  return { enter, session, opening, job, jobOps };
}

test("SUBSTITUTE acceptance test 1: the real map's path serves and records only its own job rules, replacing nothing on the path", async (t) => {
  const dbPath = await matter(t, {});
  const { enter, session, job, jobOps } = await walk(dbPath);
  assert.equal(enter, '<rules position="draft/enter">\n  <position path="draft draft/enter"/>\n</rules>');
  assert.match(session, /^<rules position="draft\/session" branch="main" serve="full">\n {2}<position path="draft draft\/session"\/>\n/);
  assert.match(session, /<node id="draft\/outline" /);
  assert.match(job, /^<rules position="draft\/job" branch="main" job="1" serve="delta">\n {2}<position path="draft draft\/session draft\/job"\/>\n/);
  assert.deepEqual([...job.matchAll(/<rule id="([^"]+)"/g)].map((m) => m[1]), MAP_JOB_RULES);
  assert.deepEqual(served(dbPath), MAP_JOB_RULES.map((rule_id) => ({ rule_id, node: "draft/job", path: "draft draft/session draft/job", session_token: TOKEN })));
  assert.match(await callTool({}, "rules__lifecycle", { db_path: dbPath }), new RegExp(`<skill name="draft" root="0" migrated="${loadRulesDag("draft").rules.size}" verified="0">`));
  // The pilot still serves the whole path: nothing is replaced.
  assert.ok(jobOps[0].ids.includes("draft.dispatch.choose"));
  assert.ok(jobOps.every(({ replaced }) => replaced.length === 0));
});

test("SUBSTITUTE acceptance test 1: rules on the path are served by the moves, logged, reported, and left out of the pilot", async (t) => {
  const dbPath = await matter(t, FIXTURE_RULES);
  const { enter, session, opening, job, jobOps } = await walk(dbPath);

  // rules__at is read-only: it shows the position and logs nothing (spec §4.8).
  assert.doesNotMatch(enter, /<rule /);
  assert.match(session, new RegExp(`<rule id="${OPEN_RULE}" node="draft/session">\nFixture rule on draft/session\\.\n {2}</rule>`));
  assert.match(job, /serve="delta"/);
  assert.match(job, new RegExp(`<kept ids="${OPEN_RULE}"/>`));
  // The held job's two steps are read from the database: job_steps is many, so no conditional_on.
  assert.match(job, / job="1" /);
  assert.match(job, new RegExp(`<rule id="${DISPATCH_RULE}" node="draft/job">\nFixture rule on draft/job\\.\n {2}</rule>`));
  assert.doesNotMatch(job, new RegExp(`<rule id="${OPEN_RULE}"`));

  assert.deepEqual(served(dbPath), [
    { rule_id: OPEN_RULE, node: "draft/session", path: "draft draft/session", session_token: TOKEN },
    ...[...MAP_JOB_RULES, DISPATCH_RULE].map((rule_id) => ({ rule_id, node: "draft/job", path: "draft draft/session draft/job", session_token: TOKEN })),
  ]);

  const xml = await callTool({}, "rules__lifecycle", { db_path: dbPath });
  // The real map's own rules (rules-DAG 6.3 onwards) count too.
  assert.match(xml, new RegExp(`<skill name="draft" root="0" migrated="${loadRulesDag("draft").rules.size}" verified="0">`));
  for (const [id, node, atom] of [
    [OPEN_RULE, "draft/session", "draft.open.then-opening"],
    [DISPATCH_RULE, "draft/job", "draft.dispatch.choose"],
  ]) {
    const line = tag(xml, id);
    assert.match(line, new RegExp(` node="${node.replace("/", "\\/")}" stage="migrated" sessions="1" served="1" `));
    assert.match(line, new RegExp(` replaces="${atom.replace(/\./g, "\\.")}"`));
  }

  // Coexistence (spec §5): each replaced atom leaves the pilot's answer, and is named in `replaced`.
  assert.deepEqual(opening[1].replaced, ["draft.open.then-opening"]);
  assert.ok(!opening[1].ids.includes("draft.open.then-opening"));
  assert.deepEqual(jobOps[0].replaced, ["draft.dispatch.choose"]);
  assert.ok(!jobOps[0].ids.includes("draft.dispatch.choose") && jobOps[0].ids.includes("draft.dispatch"));
  assert.deepEqual([jobOps[1].replaced, jobOps[2].replaced], [[], []]);
  assert.ok(jobOps[1].ids.includes("draft.premise"));
  assert.ok(jobOps[2].ids.includes("draft.premise.holds") && jobOps[2].ids.includes("draft.steps"));
});
