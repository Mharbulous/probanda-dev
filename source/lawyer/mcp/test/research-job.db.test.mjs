// A legal research job, marked by its title's prefix, cannot leave the form by any job tool or script,
// runs under no other title, and completes only with a saved memo. rewrite_job's migrate mode changes only
// the title and intent.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { freshSubmissionDb } = await import("./helpers/template-db.mjs");
const { submissionDataExecute, submissionDataQuery } = await import("../build/submission/backend.js");
const { submissionDataCompleteJob } = await import("../build/submission/forms/complete-job.js");
const { callTool } = await import("../build/dispatch.js");

const TOKEN = "session-aaaa1111";
const ISSUE = "A commercial tenant holds over. Does accepting rent renew the lease?";
const TITLE = `Legal research: ${ISSUE}`;
const ticket = (id, title, intent, extra = "", values = "") =>
  `INSERT INTO tickets (id, proceeding_id, title, intent, status, kind, billing_anchor, created${extra}) VALUES (${id}, 1, '${title}', '${intent}', 'queued', 'work', 'L8470|x', '2026-10-01T09:00'${values});`;
const SEED = `INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L8470 - Larchmont', 'CAN/BC/BCSC');
  ${ticket(1, TITLE, ISSUE)}
  ${ticket(2, "research the holdover", "does rent renew it")}
  ${ticket(3, "Brief the case: Hunt v. Carey, 1990 SCC 1", "Brief it.")}
  ${ticket(4, "Note up all cited authorities", "Note them up.")}
  ${ticket(5, "Scrutinize the statement", "Check it.")}
  ${ticket(6, "old question", "old words", ", plan_approved_at", ", '2026-10-01T09:10'")}
  ${ticket(7, "Shelved question", "old words", ", rejected_at", ", '2026-10-01T09:10'")}
  INSERT INTO ticket_proposals (ticket_id, proposal_key, item) VALUES (5, 'scrutinize:statements_of_law:1', 'The statement');
  INSERT INTO ticket_steps (ticket_id, ordinal, text, done_at) VALUES
    (1, 1, 'Run the research', NULL), (2, 1, 'Run the research', NULL), (3, 1, 'Get the decision', NULL), (4, 1, 'Note up the case', NULL),
    (5, 1, 'Check the excerpt', NULL), (6, 1, 'Read the lease', '2026-10-01T09:20'), (6, 2, 'Write it up', NULL), (7, 1, 'Old', NULL);
  INSERT INTO ticket_answers (ticket_id, file_path, saved_at) VALUES (6, '6. LAW\\Lease\\old answer.md', '2026-10-01T09:30');`;

async function seeded(t) {
  const dir = mkdtempSync(join(tmpdir(), "coclerk-research-job-"));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
  const dbPath = join(dir, "submission.sqlite");
  await freshSubmissionDb(dbPath);
  await submissionDataExecute(dbPath, SEED);
  const law = join(dir, "6. LAW", "Lease");
  mkdirSync(law, { recursive: true });
  mkdirSync(join(dir, "0. DRAFT"));
  return { dir, dbPath, law, draft: join(dir, "0. DRAFT") };
}

const query = (dbPath, sql, params = []) => submissionDataQuery(dbPath, sql, params).rows;
const code = (expected) => (err) => {
  assert.equal(err.code, expected, err.message);
  return true;
};
const assign = (dbPath, id) => callTool({}, "drafting_data__assign_job", { db_path: dbPath, ticket_id: id, session_token: TOKEN });
const create = (dbPath, args) =>
  callTool({}, "drafting_data__create_job", { db_path: dbPath, proceeding_id: 1, filing_id: null, kind: "work", priority: "bottom", billing_anchor: "L8470|x", steps: ["Run the research"], guard: "none", ...args });
const rewrite = (dbPath, args) => callTool({}, "drafting_data__rewrite_job", { db_path: dbPath, ...args });
const execute = (dbPath, sql_script) => callTool({}, "drafting_data__execute", { db_path: dbPath, sql_script });

test("create_job refuses a research job out of the form, as lead or companion, writing nothing", async (t) => {
  const { dbPath } = await seeded(t);
  const before = query(dbPath, "SELECT COUNT(*) AS n FROM tickets")[0].n;
  const QUESTION = "Is it legal?";
  for (const args of [
    { title: "Legal research: Is it legal", intent: "Is it legal" },
    { title: "Legal research: Is it legal? Is it wise?", intent: "Is it legal? Is it wise?" },
    { title: "Legal research: One. Two. Three. Is it legal?", intent: "One. Two. Three. Is it legal?" },
    { title: `Legal research: ${QUESTION}`, intent: "Is it lawful?" },
  ]) {
    await assert.rejects(create(dbPath, args), code("research_form"), args.title);
  }
  await assert.rejects(
    create(dbPath, { title: "Counsel's review of the draft", intent: "Review it.", filing_id: 1, guard: "title_live_with_step", companions: [{ title: "Legal research: Is it legal", intent: "Is it legal", steps: ["Run it"] }] }),
    code("research_form")
  );
  assert.equal(query(dbPath, "SELECT COUNT(*) AS n FROM tickets")[0].n, before);
});

test("guard research_title writes a proceeding-scoped job once and needs the prefix", async (t) => {
  const { dbPath } = await seeded(t);
  const title = "Legal research: Is it legal?";
  const first = await create(dbPath, { title, intent: "Is it legal?", guard: "research_title" });
  assert.equal(first.outcome, "created");
  assert.equal(query(dbPath, "SELECT filing_id FROM tickets WHERE id = ?", [first.ticket_id])[0].filing_id, null);
  const again = await create(dbPath, { title, intent: "Is it legal?", guard: "research_title" });
  assert.equal(again.outcome, "guarded");
  assert.equal(again.holder_id, first.ticket_id);
  await assert.rejects(create(dbPath, { title: "research this", intent: "Is it legal?", guard: "research_title" }), code("invalid_title"));
});

test("rewrite_job sets a research title and intent together, in the form, and a research job keeps its prefix", async (t) => {
  const { dbPath } = await seeded(t);
  await assert.rejects(rewrite(dbPath, { ticket_id: 2, title: "Legal research: Is it legal?" }), code("research_form"));
  await assert.rejects(rewrite(dbPath, { ticket_id: 2, title: "Legal research: Is it legal", intent: "Is it legal" }), code("research_form"));
  await assert.rejects(rewrite(dbPath, { ticket_id: 1, title: "Plain title" }), code("research_form"));
  await assert.rejects(rewrite(dbPath, { ticket_id: 2, title: "Plain title", intent: "Words." }), code("invalid_intent"));
  await assert.rejects(rewrite(dbPath, { ticket_id: 2, intent: "Is it legal?" }), code("invalid_intent"));
  const result = await rewrite(dbPath, { ticket_id: 2, title: "Legal research: Is it legal?", intent: "Is it legal?" });
  assert.equal(result.outcome, "rewritten");
  assert.equal(result.intent, "Is it legal?");
});

test("migrate changes only the title and intent, keeping every step, stamp, approval and answer", async (t) => {
  const { dbPath } = await seeded(t);
  const rows = () => [query(dbPath, "SELECT * FROM ticket_steps WHERE ticket_id = 6 ORDER BY ordinal"), query(dbPath, "SELECT * FROM ticket_answers WHERE ticket_id = 6")];
  const before = rows();
  // Ready mode refuses this job: its plan is approved and a step is done.
  assert.equal((await rewrite(dbPath, { ticket_id: 6, title: "Legal research: Is it legal?", intent: "Is it legal?" })).outcome, "approved");
  const result = await rewrite(dbPath, { ticket_id: 6, migrate: true, title: "Legal research: Is it legal?", intent: "Is it legal?" });
  assert.equal(result.outcome, "rewritten", result.note);
  const [job] = query(dbPath, "SELECT title, intent, plan_approved_at, status FROM tickets WHERE id = 6");
  assert.deepEqual({ ...job }, { title: "Legal research: Is it legal?", intent: "Is it legal?", plan_approved_at: "2026-10-01T09:10", status: "queued" });
  assert.deepEqual(rows(), before);
});

test("migrate runs on a job this session holds, refuses a shelved job and needs a research title and no steps", async (t) => {
  const { dbPath } = await seeded(t);
  const shelved = await rewrite(dbPath, { ticket_id: 7, migrate: true, title: "Legal research: Is it legal?", intent: "Is it legal?" });
  assert.equal(shelved.outcome, "shelved");
  assert.match(shelved.note, /migrated when it is restored/);
  await assert.rejects(rewrite(dbPath, { ticket_id: 2, migrate: true, title: "Plain title" }), code("invalid_migrate"));
  await assert.rejects(rewrite(dbPath, { ticket_id: 2, migrate: true, title: "Legal research: Is it?", intent: "Is it?", steps: ["New"] }), code("invalid_migrate"));
  const { claim_no } = await assign(dbPath, 2);
  const result = await rewrite(dbPath, { ticket_id: 2, migrate: true, held: true, session_token: TOKEN, claim_no, title: "Legal research: Is it legal?", intent: "Is it legal?" });
  assert.equal(result.outcome, "rewritten", result.note);
});

test("execute refuses a script that inserts a research job or changes one's title or intent, and leaves other jobs alone", async (t) => {
  const { dbPath } = await seeded(t);
  for (const script of [
    ticket(50, "Legal research: Is it?", "Is it?"),
    "UPDATE tickets SET title = 'Legal research: Is it?', intent = 'Is it?' WHERE id = 2;",
    "UPDATE tickets SET intent = 'Other words?' WHERE id = 1;",
    "UPDATE tickets SET title = 'Plain title' WHERE id = 1;",
  ]) {
    await assert.rejects(execute(dbPath, script), /research_write_refused/, script);
  }
  assert.equal(query(dbPath, "SELECT title FROM tickets WHERE id = 1")[0].title, TITLE);
  assert.equal(query(dbPath, "SELECT COUNT(*) AS n FROM tickets WHERE id = 50")[0].n, 0);
  await execute(dbPath, "UPDATE tickets SET title = 'research the point' WHERE id = 2; UPDATE tickets SET priority = 4 WHERE id = 1;");
  assert.equal(query(dbPath, "SELECT priority FROM tickets WHERE id = 1")[0].priority, 4);
});

test("save_answer refuses a free-label job before writing, and takes research, brief, note-up and keyed jobs", async (t) => {
  const { dbPath, law } = await seeded(t);
  const save = async (id) => {
    const { claim_no } = await assign(dbPath, id);
    return callTool({}, "research_filing__save_answer", { db_path: dbPath, ticket_id: id, session_token: TOKEN, claim_no, destination_dir: law, filename: "2026-10-01 ML re rent.md", text: "Answer.\n" });
  };
  await assert.rejects(save(2), code("not_research_job"));
  assert.equal(query(dbPath, "SELECT COUNT(*) AS n FROM ticket_answers WHERE ticket_id = 2")[0].n, 0);
  for (const id of [1, 3, 4, 5]) {
    assert.equal((await save(id)).job.recorded, true, `job ${id}`);
  }
});

test("complete_job refuses a research job with no memo or an INCOMPLETE one, and completes it with a finished memo", async (t) => {
  const { dir, dbPath, draft } = await seeded(t);
  const { claim_no } = await assign(dbPath, 1);
  const complete = () => submissionDataCompleteJob({ db_path: dbPath, ticket_id: 1, session_token: TOKEN, claim_no, draft_dir: draft });
  await submissionDataExecute(dbPath, "UPDATE ticket_steps SET done_at = '2026-10-01T09:40' WHERE ticket_id = 1;");

  assert.equal((await complete()).outcome, "no_memo");
  await submissionDataExecute(dbPath, "INSERT INTO ticket_answers (ticket_id, file_path, saved_at) VALUES (1, '6. LAW\\Lease\\2026-10-01 note-up Hunt.md', '2026-10-01T09:41');");
  assert.equal((await complete()).outcome, "no_memo", "a note-up record is no memo");

  const memo = (name, confidence) => {
    writeFileSync(join(dir, "6. LAW", "Lease", name), `---\nConfidence: ${confidence}\n---\n## Issue\n${ISSUE}\n`);
    return submissionDataExecute(dbPath, `INSERT INTO ticket_answers (ticket_id, file_path, saved_at) VALUES (1, '6. LAW\\Lease\\${name}', '2026-10-01T09:42');`);
  };
  await memo("2026-10-01 ML re rent.md", "INCOMPLETE: the citing cases");
  const incomplete = await complete();
  assert.equal(incomplete.outcome, "memo_incomplete");
  assert.equal(query(dbPath, "SELECT status FROM tickets WHERE id = 1")[0].status, "wip");

  await memo("2026-10-01 ML re rent v2.md", "Strong on the cases read.");
  assert.equal((await complete()).outcome, "completed");
});

test("complete_job reads a 2026-11-03 memo as INCOMPLETE by its open-issues paragraph, with no Confidence line", async (t) => {
  const { dir, dbPath, draft } = await seeded(t);
  const { claim_no } = await assign(dbPath, 1);
  const complete = () => submissionDataCompleteJob({ db_path: dbPath, ticket_id: 1, session_token: TOKEN, claim_no, draft_dir: draft });
  await submissionDataExecute(dbPath, "UPDATE ticket_steps SET done_at = '2026-10-01T09:40' WHERE ticket_id = 1;");
  const header = "---\nDate: 2026-11-03\nDocument: MEMORANDUM OF LAW for Job #1\nStatus: DRAFT\nFrom: model\nRe: \"Q?\"\n---\n";
  const memo = (name, conclusion) => {
    writeFileSync(join(dir, "6. LAW", "Lease", name), `${header}## Issue\n${ISSUE}\n\n## Conclusion\n\n${conclusion}\n`);
    return submissionDataExecute(dbPath, `INSERT INTO ticket_answers (ticket_id, file_path, saved_at) VALUES (1, '6. LAW\\Lease\\${name}', '2026-10-01T09:42');`);
  };
  await memo("2026-11-03 ML re rent.md", "Yes.\n\nMore research is needed on the following issues:\n1. The citing cases?");
  assert.equal((await complete()).outcome, "memo_incomplete");
  await memo("2026-11-03 ML re rent v2.md", "Yes.");
  assert.equal((await complete()).outcome, "completed");
});

test("complete_job takes an INCOMPLETE memo once the practitioner has dropped or put off a step", async (t) => {
  const { dir, dbPath, draft } = await seeded(t);
  const { claim_no } = await assign(dbPath, 1);
  writeFileSync(join(dir, "6. LAW", "Lease", "2026-10-01 ML re rent.md"), "Confidence: INCOMPLETE: the citing cases\n");
  await submissionDataExecute(
    dbPath,
    `INSERT INTO ticket_answers (ticket_id, file_path, saved_at) VALUES (1, '6. LAW\\Lease\\2026-10-01 ML re rent.md', '2026-10-01T09:42');
     UPDATE ticket_steps SET status = 'deferred', status_note = 'leave it' WHERE ticket_id = 1;`
  );
  assert.equal((await submissionDataCompleteJob({ db_path: dbPath, ticket_id: 1, session_token: TOKEN, claim_no, draft_dir: draft })).outcome, "completed");
});

test("take_job takes a research job with a long title, and two research jobs are not duplicates by their prefix", async (t) => {
  const { dir, dbPath } = await seeded(t);
  const matterRoot = join(dir, "matter");
  mkdirSync(matterRoot);
  writeFileSync(join(matterRoot, "probanda.json"), JSON.stringify({ schema_version: 5, matter_root: matterRoot }));
  const issue = "Under the statutes of this province, does a carrier who keeps delivering parcels after its contract ends still owe its old duties to every consignee?";
  await create(dbPath, { title: `Legal research: ${issue}`, intent: issue });
  await create(dbPath, { title: "Legal research: May a surety withdraw its guarantee?", intent: "May a surety withdraw its guarantee?" });
  const [{ id }] = query(dbPath, "SELECT id FROM tickets WHERE title = ?", [`Legal research: ${issue}`]);
  const taken = await callTool({}, "drafting_data__take_job", { db_path: dbPath, ticket_id: id, session_token: TOKEN, matter_root: matterRoot });
  assert.equal(taken.outcome, "assigned", JSON.stringify(taken));
});
