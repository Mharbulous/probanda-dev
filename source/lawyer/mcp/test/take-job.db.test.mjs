// drafting_data__take_job: every check before the assigning write that needs no judgement, in code,
// each refusal writing nothing; then assign_job's guarded write, the started entry in
// ProceduralHistory.md, and the claim number, Job header, card and premise line.

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { freshSubmissionDb } = await import("./helpers/template-db.mjs");
const { submissionDataExecute, submissionDataQuery } = await import("../build/submission/backend.js");
const { callTool } = await import("../build/dispatch.js");
const { premiseOf, restatingSteps } = await import("../build/submission/forms/take-job.js");

const TOOL = "drafting_data__take_job";
const job = (id, title, intent = "Answer the letter.", extra = "") =>
  `INSERT INTO tickets (id, proceeding_id, title, intent, status, kind, billing_anchor, created${extra ? ", " + extra.split("=")[0] : ""}) VALUES (${id}, 1, '${title}', '${intent}', 'queued', 'work', 'L8470|x', '2026-10-01T09:00'${extra ? ", " + extra.split("=")[1] : ""});`;
const SEED = `INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L8470 - Larchmont', 'CAN/BC/BCSC');
  ${job(1, "Reply to the costs letter")}
  ${job(2, "Plan me")}
  ${job(3, "Write the submissions on the hearing date and the adjournment and the witness list order")}
  ${job(4, "Restated", "Answer the letter.")}
  ${job(5, "Shelved", "Do it.", "rejected_at='2026-10-01T09:10'")}
  ${job(6, "Held for later", "Do it.", "bf_on='2999-01-01'")}
  ${job(7, "Summarise the expert report")}
  ${job(8, "Check the expert report for gaps")}
  INSERT INTO ticket_steps (ticket_id, ordinal, text, done_at) VALUES
    (1, 1, 'Read the letter of 3 May.', NULL), (1, 2, 'Draft the reply.', NULL),
    (2, 1, 'Create a plan for how to complete this job.', NULL),
    (3, 1, 'Draft it.', NULL),
    (4, 1, 'Read the file.', NULL), (4, 2, '  answer THE letter ', NULL),
    (5, 1, 'Old.', NULL), (6, 1, 'Old.', NULL),
    (7, 1, 'Read the report.', NULL), (8, 1, 'Read the report again.', NULL);`;

async function seeded(t) {
  const dir = mkdtempSync(join(tmpdir(), "coclerk-take-job-"));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
  const matterRoot = join(dir, "matter");
  mkdirSync(matterRoot);
  writeFileSync(join(matterRoot, "probanda.json"), JSON.stringify({ schema_version: 5, matter_root: matterRoot }));
  const dbPath = join(dir, "submission.sqlite");
  await freshSubmissionDb(dbPath);
  await submissionDataExecute(dbPath, SEED);
  return { dbPath, matterRoot };
}

const query = (dbPath, sql, params = []) => submissionDataQuery(dbPath, sql, params).rows;
const lock = (dbPath, id) => query(dbPath, "SELECT status, locked_by FROM tickets WHERE id = ?", [id])[0];
const take = ({ dbPath, matterRoot }, args) => callTool({}, TOOL, { db_path: dbPath, session_token: "sess-a1", matter_root: matterRoot, ...args });

test("a Ready job passing every check is assigned, its started entry written, and its header, card and premise returned", async (t) => {
  const m = await seeded(t);
  const result = await take(m, { ticket_id: 1 });
  assert.equal(result.outcome, "assigned", result.note);
  assert.equal(result.claim_no, 1);
  assert.equal(result.header, "# Job 1: Reply to the costs letter");
  assert.match(result.card, /^- Job #1 Reply to the costs letter · In Progress 0\/2/);
  assert.match(result.card, /steps: 1 ☐ Read the letter of 3 May\. · 2 ☐ Draft the reply\./);
  assert.equal(result.premise.state, "none");
  assert.equal(result.history.added, "- Started Job 1: Reply to the costs letter.");
  assert.match(readFileSync(join(m.matterRoot, "ProceduralHistory.md"), "utf-8"), /- Started Job 1: Reply to the costs letter\./);
  assert.deepEqual(lock(m.dbPath, 1), { status: "wip", locked_by: "sess-a1" });
});

test("each refusal names its check and writes nothing", async (t) => {
  const m = await seeded(t);
  for (const [id, reason] of [[2, "needs_plan"], [3, "long_title"], [4, "restates"], [5, "not_ready"]]) {
    const result = await take(m, { ticket_id: id });
    assert.equal(result.outcome, "refused", `job ${id}`);
    assert.equal(result.reason, reason, `job ${id}: ${result.note}`);
    assert.equal(lock(m.dbPath, id).locked_by, null, `job ${id} is not assigned`);
  }
  assert.deepEqual((await take(m, { ticket_id: 4 })).steps, [2]);
  const bf = await take(m, { ticket_id: 6 });
  assert.equal(bf.outcome, "before_bf");
  assert.equal(bf.bf_on, "2999-01-01");
  assert.equal(existsSync(join(m.matterRoot, "ProceduralHistory.md")), false, "no history entry for a refusal");
  await assert.rejects(take(m, { ticket_id: 1, matter_root: join(m.matterRoot, "missing") }), (err) => err.code === "invalid_root");
  assert.equal(lock(m.dbPath, 1).locked_by, null, "a folder the entry cannot go to assigns nothing");
});

test("an overlapping live job refuses with its card until the session clears it in not_duplicates", async (t) => {
  const m = await seeded(t);
  const refused = await take(m, { ticket_id: 7 });
  assert.equal(refused.reason, "duplicates");
  assert.deepEqual(refused.duplicates.map((d) => d.ticket_id), [8]);
  assert.match(refused.duplicates[0].card, /^- Job #8 Check the expert report for gaps/);
  assert.equal(lock(m.dbPath, 7).locked_by, null);
  const assigned = await take(m, { ticket_id: 7, not_duplicates: [8] });
  assert.equal(assigned.outcome, "assigned", assigned.note);
});

test("a job another session holds is not Ready, and gets no history entry", async (t) => {
  const m = await seeded(t);
  await callTool({}, "drafting_data__assign_job", { db_path: m.dbPath, ticket_id: 1, session_token: "sess-other" });
  const result = await take(m, { ticket_id: 1 });
  assert.equal(result.outcome, "refused");
  assert.equal(result.reason, "not_ready");
  assert.equal(existsSync(join(m.matterRoot, "ProceduralHistory.md")), false);
});

test("restatingSteps ignores case, whitespace and trailing punctuation, done steps, the plan marker and fixed-text jobs", () => {
  const steps = (...texts) => texts.map((text, i) => ({ ordinal: i + 1, text, done_at: null }));
  assert.deepEqual(restatingSteps({ title: "Reply to Smith", intent: "Reply to the letter.", steps: steps("Read it.", "REPLY TO SMITH now", "reply to the  letter!") }), [2, 3]);
  assert.deepEqual(restatingSteps({ title: "Reply", intent: "Reply.", steps: [{ ordinal: 1, text: "Reply.", done_at: "2026-10-01T09:00" }] }), []);
  assert.deepEqual(restatingSteps({ title: "Deliver", intent: "Deliver this letter.", steps: steps("Deliver this letter.") }), []);
  assert.deepEqual(restatingSteps({ title: "Plan", intent: "Create a plan for how to complete this job.", steps: steps("Create a plan for how to complete this job.") }), []);
});

test("premiseOf reads what each key derives now", () => {
  const derived = new Map([["k1", { item: "Same item." }], ["k2", { item: "New wording." }]]);
  const t = (keys) => ({ proposal_keys: keys, proposal_items: { k1: "Same item.", k2: "Old wording.", k3: "Gone." } });
  assert.equal(premiseOf(t(["k1"]), derived).state, "holds");
  assert.equal(premiseOf(t(["k1"]), derived).line, "Each item's marker still fires.");
  assert.equal(premiseOf(t(["k2"]), derived).line, "Each item's marker still fires. The item now reads: New wording.");
  assert.deepEqual([premiseOf(t(["k1", "k3"]), derived).state, premiseOf(t(["k1", "k3"]), derived).line], ["failed", "The marker no longer fires on 1 of 2 items."]);
  assert.equal(premiseOf(t([]), derived).state, "none");
  assert.equal(premiseOf(t(["k1"]), null).state, "none");
});
