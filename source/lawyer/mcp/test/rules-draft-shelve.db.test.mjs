// SUBSTITUTE for the pilot's acceptance tests 2 and 3 (contextual-rule-injection spec §16), as
// rules-DAG plan step 6.4 runs them without a Cowork session, against the real /draft map after the
// shelve/release cluster (`draft.shelve.*`, `draft.obstacle.spin-off`) moved onto its nodes (6.3).
// The repoint (rules-DAG spec §9.3): each `skill_rules__applicable` call becomes a `rules__move` to
// the node, and the spin-off release is the override edge on draft/job/obstacle. Pass conditions are
// unchanged: test 2's response carries never-offer and not the spin-off; test 3's carries the
// spin-off and not never-offer. Two session tokens serve every migrated rule, so `rules__lifecycle`
// reports each one verified, which is what retires its pilot atom (spec §5).

import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const { freshSubmissionDb } = await import("./helpers/template-db.mjs");
const { submissionDataExecute } = await import("../build/submission/backend.js");
const { callTool } = await import("../build/dispatch.js");
const { skillRulesApplicable } = await import("../build/files/skill-rules.js");

const DRAFT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", ".claude", "skills", "draft");
const WORK = join(DRAFT, "..", "work");
const NEVER_OFFER = "draft.shelve.never-offer";
const SPIN_OFF = "draft.obstacle.spin-off";
const JOB_RULES = ["draft.shelve.own-job", NEVER_OFFER, "draft.shelve.taken-over"];
const HOUSEKEEPING_RULES = [
  "draft.shelve.intro", "draft.shelve.what", "draft.shelve.suppress", "draft.shelve.unsuppress", "draft.shelve.where",
  "draft.shelve.release-own", "draft.shelve.matching", "draft.shelve.proposal", "draft.shelve.no-confirm", "draft.shelve.after",
];
const UNATTENDED_RULE = "draft.shelve.suppress-unattended";
const CLUSTER = [...JOB_RULES, SPIN_OFF, ...HOUSEKEEPING_RULES, UNATTENDED_RULE];
// Each atom's pilot operations, as tagged at d71a06216 before the move.
const PILOT_OPS = {
  "draft.shelve.intro": ["shelve", "restore"],
  "draft.shelve.what": ["shelve"],
  "draft.shelve.suppress": ["shelve", "suppress"],
  "draft.shelve.unsuppress": ["suppress", "restore"],
  "draft.shelve.suppress-unattended": ["suppress", "unattended_run"],
  "draft.shelve.where": ["shelve", "restore"],
  "draft.shelve.own-job": ["shelve", "release"],
  [NEVER_OFFER]: ["shelve", "release", "obstacle", "change"],
  "draft.shelve.taken-over": ["shelve", "release"],
  "draft.shelve.release-own": ["release"],
  "draft.shelve.matching": ["shelve", "restore"],
  "draft.shelve.proposal": ["shelve"],
  "draft.shelve.no-confirm": ["shelve", "restore"],
  "draft.shelve.after": ["shelve", "restore", "release"],
  [SPIN_OFF]: ["obstacle", "release"],
};

// No step reads the practitioner's coclerk.json: a scratch config for the whole file.
const scratch = mkdtempSync(join(tmpdir(), "coclerk-rules-shelve-config-"));
writeFileSync(join(scratch, "coclerk.json"), JSON.stringify({ case_data_root: scratch }));
process.env.COCLERK_CONFIG_PATH = join(scratch, "coclerk.json");
test.after(() => rmSync(scratch, { recursive: true, force: true }));

/** A checkout holding a copy of the real /draft skill (SKILL.md, references and node map) and of /work (SKILL.md and references). */
function checkout(t) {
  const root = mkdtempSync(join(tmpdir(), "coclerk-rules-shelve-"));
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
  const work = join(root, ".claude", "skills", "work");
  mkdirSync(join(work, "references"), { recursive: true });
  copyFileSync(join(WORK, "SKILL.md"), join(work, "SKILL.md"));
  for (const e of readdirSync(join(WORK, "references"), { withFileTypes: true })) {
    if (e.isFile() && e.name.endsWith(".md")) copyFileSync(join(WORK, "references", e.name), join(work, "references", e.name));
  }
  const before = process.env.COCLERK_REPO_ROOT;
  process.env.COCLERK_REPO_ROOT = root;
  t.after(() => {
    if (before === undefined) delete process.env.COCLERK_REPO_ROOT;
    else process.env.COCLERK_REPO_ROOT = before;
    rmSync(root, { recursive: true, force: true });
  });
}

/** A matter whose job #N is held by the session token `A${N}`, one per session. */
async function matter(t) {
  const dir = mkdtempSync(join(tmpdir(), "coclerk-rules-shelve-db-"));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
  const dbPath = join(dir, "submission.sqlite");
  await freshSubmissionDb(dbPath);
  await submissionDataExecute(
    dbPath,
    `INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'MATTER', 'CAN/BC/BCSC');
     INSERT INTO tickets (id, proceeding_id, title, intent, status, kind, billing_anchor, created) VALUES (1, 1, 'Job one', 'Do it.', 'queued', 'work', 'MATTER|x', '2026-10-01T09:00');
     INSERT INTO tickets (id, proceeding_id, title, intent, status, kind, billing_anchor, created) VALUES (2, 1, 'Job two', 'Do it.', 'queued', 'work', 'MATTER|x', '2026-10-01T09:00');`
  );
  checkout(t);
  return dbPath;
}

const hold = (dbPath, job, token) =>
  submissionDataExecute(dbPath, `UPDATE tickets SET status = 'wip', locked_by = '${token}', locked_at = '2026-10-10T10:00' WHERE id = ${job};`);
const ATTENDED = { unattended: false, host: "cowork" };
const move = (dbPath, token, to, facts) => callTool({}, "rules__move", { db_path: dbPath, session_token: token, to, ...(facts ? { facts } : {}) });
const sent = (xml) => [...xml.matchAll(/<rule id="([^"]+)"/g)].map((m) => m[1]);
const ids = (xml, tag) => (new RegExp(`<${tag} ids="([^"]*)"/>`).exec(xml)?.[1] ?? "").split(" ").filter(Boolean);
const conditionalOn = (xml, id) => new RegExp(`<rule id="${id.replace(/\./g, "\\.")}"[^>]*conditional_on="([^"]*)"`).exec(xml)?.[1];
const at = (path, facts) => callTool({}, "rules__at", { skill: "draft", path, facts });

/** A session holding its job, walked to the job's work. */
async function toWork(dbPath, token, job) {
  await hold(dbPath, job, token);
  await move(dbPath, token, "draft/session", ATTENDED);
  const atJob = await move(dbPath, token, "draft/job");
  await move(dbPath, token, "draft/job/work");
  return atJob;
}

/** Test 2: the practitioner says the job's work is not needed, without asking to let it go. */
async function test2(dbPath, token, job) {
  const atJob = await toWork(dbPath, token, job);
  const change = await move(dbPath, token, "draft/job/change");
  await move(dbPath, token, "up");
  const inJob = await move(dbPath, token, "draft/job/obstacle", { obstacle: "in_job" });
  await move(dbPath, token, "up");
  const unassessed = await move(dbPath, token, "draft/job/obstacle");
  return { atJob, change, inJob, unassessed };
}

/** Test 3: a research return flags a discrepancy, separate work the job must wait on. */
async function test3(dbPath, token, job) {
  await toWork(dbPath, token, job);
  const delta = await move(dbPath, token, "draft/job/obstacle", { obstacle: "separate_work" });
  // A stay re-sends the whole path, the nearest form to the pilot's single answer.
  const full = await move(dbPath, token, "draft/job/obstacle", { obstacle: "separate_work" });
  return { delta, full };
}

/** A shelve, restore, suppression or another session's release, applied as bookkeeping mid-job. */
const housekeeping = async (dbPath, token) => {
  await move(dbPath, token, "up");
  return move(dbPath, token, "draft/housekeeping");
};

test("SUBSTITUTE acceptance test 2: letting go of a job is never offered", async (t) => {
  const dbPath = await matter(t);
  const { atJob, change, inJob, unassessed } = await test2(dbPath, "A1", 1);
  // never-offer is sent on reaching the job, and stays in force through change and an in-job obstacle.
  assert.match(atJob, /<rules position="draft\/job" branch="main" job="1" serve="delta">/);
  assert.ok(JOB_RULES.every((id) => sent(atJob).includes(id)), atJob);
  assert.ok(ids(change, "kept").includes(NEVER_OFFER) && !ids(change, "withdrawn").includes(NEVER_OFFER));
  assert.ok(ids(inJob, "kept").includes(NEVER_OFFER) && !ids(inJob, "withdrawn").includes(NEVER_OFFER));
  assert.ok(!sent(inJob).includes(SPIN_OFF) && !ids(inJob, "kept").includes(SPIN_OFF));
  // No obstacle fact yet: the spin-off comes back conditional on it and defeats nothing (pilot §13).
  assert.ok(ids(unassessed, "kept").includes(NEVER_OFFER));
  assert.equal(conditionalOn(unassessed, SPIN_OFF), "obstacle");
});

test("SUBSTITUTE acceptance test 3: the spin-off exception defeats never-offer", async (t) => {
  const dbPath = await matter(t);
  const { delta, full } = await test3(dbPath, "A1", 1);
  assert.deepEqual(sent(delta), [SPIN_OFF]);
  assert.equal(conditionalOn(delta, SPIN_OFF), undefined);
  assert.deepEqual(ids(delta, "withdrawn"), [NEVER_OFFER]);
  assert.match(full, /serve="full"/);
  assert.ok(sent(full).includes(SPIN_OFF) && !sent(full).includes(NEVER_OFFER), full);
  // The pilot serves neither: the node rule has taken the atom's place (spec §5).
  for (const op of ["obstacle", "release"]) {
    const pilot = skillRulesApplicable("draft", op, { job_held: true, obstacle: "separate_work" });
    assert.ok(!pilot.rules.some((r) => CLUSTER.includes(r.id)), op);
  }
});

test("every operation that served a cluster atom reaches its node", async (t) => {
  checkout(t);
  const held = { job_held: true, unattended: false };
  const work = ["draft", "draft/session", "draft/job", "draft/job/work"];
  // Where each pilot operation now stands. A shelve or release of the session's own job is applied
  // where the job stands; any other shelve, restore, suppression or release moves to housekeeping.
  const positions = {
    shelve: [[[...work, "draft/housekeeping"], held], [["draft", "draft/session", "draft/housekeeping"], { job_held: false, unattended: false }], [work, held]],
    restore: [[[...work, "draft/housekeeping"], held]],
    suppress: [[[...work, "draft/housekeeping"], held], [["draft", "draft/session", "draft/housekeeping"], { job_held: false, unattended: true }]],
    release: [[[...work, "draft/housekeeping"], held], [work, held], [[...work, "draft/job/obstacle"], { ...held, obstacle: "separate_work" }]],
    obstacle: [[[...work, "draft/job/obstacle"], { ...held, obstacle: "in_job" }], [[...work, "draft/job/obstacle"], { ...held, obstacle: "separate_work" }]],
    change: [[[...work, "draft/job/change"], held]],
    unattended_run: [[["draft", "draft/session"], { job_held: false, unattended: true }]],
  };
  const served = {};
  for (const [op, list] of Object.entries(positions)) {
    served[op] = new Set((await Promise.all(list.map(([path, facts]) => at(path, facts)))).flatMap(sent));
  }
  for (const [atom, ops] of Object.entries(PILOT_OPS)) {
    for (const op of ops) assert.ok(served[op].has(atom), `${atom} is not reached by ${op}`);
  }
  // The pilot still serves the pointer that sends each of these operations to the map: /work's, since it moved there.
  for (const op of ["shelve", "release", "restore", "suppress"]) {
    assert.ok(skillRulesApplicable("work", op, { job_held: true }).rules.some((r) => r.id === "work.dispatch.shelve"), op);
  }
});

test("rules__lifecycle: a second session serving each migrated rule from its node verifies it", async (t) => {
  const dbPath = await matter(t);
  for (const [token, job] of [["A1", 1], ["A2", 2]]) {
    await toWork(dbPath, token, job);
    await move(dbPath, token, "draft/job/obstacle", { obstacle: "separate_work" });
    await housekeeping(dbPath, token);
  }
  for (const token of ["U1", "U2"]) await move(dbPath, token, "draft/session", { unattended: true, host: "cowork" });

  const xml = await callTool({}, "rules__lifecycle", { db_path: dbPath });
  const nodes = { [SPIN_OFF]: "draft/job/obstacle", [UNATTENDED_RULE]: "draft/session" };
  for (const id of JOB_RULES) nodes[id] = "draft/job";
  for (const id of HOUSEKEEPING_RULES) nodes[id] = "draft/housekeeping";
  for (const [id, node] of Object.entries(nodes)) {
    const line = new RegExp(`<rule id="${id.replace(/\./g, "\\.")}"[^>]*/>`).exec(xml)?.[0];
    assert.ok(line, `${id} is not in the lifecycle report`);
    assert.match(line, new RegExp(` node="${node.replace(/\//g, "\\/")}" stage="verified" sessions="2" `), line);
    // Retired (6.4): the pilot atom is deleted, so the rule replaces nothing.
    assert.doesNotMatch(line, / replaces=/, line);
  }
  assert.match(xml, /<off_map\/>/);
});
