// A deleted job (schema v54, jobs-closeout.md §10a): the row and every row pointing at it stay, every
// reader skips it, and restore returns the exact prior state. The delete, restore, unshelve and holder
// read run here as the gatekeeper's own SQL, read out of jobs-closeout.md, and the intake guard out of
// jobs-create.md §3e, so a script that stops working there turns this red.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { freshSubmissionDb } = await import("./helpers/template-db.mjs");
const { submissionDataExecute, submissionDataQuery, submissionDataWrite } = await import("../build/submission/backend.js");
const { CARD_LANES, TODOS_NOT_READ, renderBoardSummary, submissionFormsBoardCard } = await import("../build/submission/matter-pages.js");
const { submissionDataAssignJob } = await import("../build/submission/forms/assign-job.js");
const { submissionDataCompleteJob } = await import("../build/submission/forms/complete-job.js");
const { mockupDir, writeManifest } = await import("../build/submission/render-manifest.js");
const { boardDataOf } = await import("./fixtures/forms-render-seeds.mjs");

const CLIENT = { clientName: "Ashgrove Holdings", clientNo: "7001", matterNo: "L7001" };
const NOW = "2026-10-05 10:00";
const KEY = "note-up:authorities:5";
const ITEM = "Smith v. Jones, 2023 BCCA 182";
const DELETED_TITLE = "Note up the Smith authority";

const REFERENCES = new URL("../../../../.claude/skills/", import.meta.url);
const doc = (rel) => readFileSync(new URL(rel, REFERENCES), "utf-8").replace(/\r\n/g, "\n");
const CLOSEOUT = doc("drafting-data/references/jobs-closeout.md");
const CREATE = doc("drafting-data/references/jobs-create.md");

/** The `nth` sql block after `anchor` in `text`. */
function sqlAfter(text, anchor, nth) {
  const from = text.indexOf(anchor);
  assert.notEqual(from, -1, `no ${anchor} in the reference`);
  const block = [...text.slice(from).matchAll(/^```sql\n([\s\S]*?)\n```$/gm)][nth];
  assert.ok(block, `no sql block ${nth} after ${anchor}`);
  return block[1];
}
/** The reference writes job 42; these scripts run on `id`. */
const forJob = (sql, id) => sql.replace(/\b42\b/g, String(id));

const DELETE = sqlAfter(CLOSEOUT, "**Deleting a mistaken job**", 0);
const STATE_READ = sqlAfter(CLOSEOUT, "**Restoring a deleted job**", 0);
const RESTORE = sqlAfter(CLOSEOUT, "**Restoring a deleted job**", 1);
const HOLDER_READ = sqlAfter(CLOSEOUT, "**Restoring a deleted job**", 2);
const UNSHELVE = sqlAfter(CLOSEOUT, "**Restoring a job**", 0);
const INTAKE = sqlAfter(CREATE, "## 3e. Intake", 0);

/** The stored layout the v30 backfill writes on a BCSC Writing: the shipped type and venue blocks. */
function shippedBlock(rel) {
  const text = doc(`draft/references/CAN/BC/BCSC/${rel}`);
  return JSON.parse(/^```json\n([\s\S]*?)\n```$/m.exec(text)[1]);
}

const query = (dbPath, sql, params = []) => submissionDataQuery(dbPath, sql.replace(/;\s*$/, ""), params).rows;
const job = (dbPath, id) => query(dbPath, STATE_READ.replace(/\b42\b/g, "?"), [id])[0];
const run = async (dbPath, sql, id) => (await submissionDataExecute(dbPath, forJob(sql, id))).changes;
const board = (dbPath) => boardDataOf(dbPath, 1, CLIENT, NOW);
// The attached and court file lanes read the matter's 0. DRAFT folder, so every lane needs draft_dir.
const card = (dbPath, draft) => submissionFormsBoardCard({ db_path: dbPath, filing_id: 1, lanes: [...CARD_LANES], draft_dir: draft }, CLIENT, NOW).card;
const ticketIds = (data) => data.tickets.map((t) => t.id);
const ticketOf = (data, id) => data.tickets.find((t) => t.id === id);
const proposalOf = (data) => data.proposals.find((p) => p.key === KEY);

/**
 * A Notice of Application with four jobs: #1, #2 and #3 queued, #2 holding the note-up key, blocking
 * #3, with one step and one scope row, a seed captured from it and a seed outlined into it; #4
 * completed. The filing's last render recorded the note-up's 📇, so its Proposal derives.
 */
async function matter(t) {
  const dir = mkdtempSync(join(tmpdir(), "coclerk-deleted-job-"));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
  const dbPath = join(dir, "submission.sqlite");
  await freshSubmissionDb(dbPath);
  await submissionDataExecute(
    dbPath,
    `INSERT INTO proceedings (id, matter_reference, forum, registry, file_number) VALUES (1, 'L7001 - Ashgrove', 'CAN/BC/BCSC', 'Vancouver', 'S-770011');
     INSERT INTO filings (id, proceeding_id, kind, title) VALUES (1, 1, 'notice_of_application', 'Notice of Application');
     INSERT INTO tickets (id, proceeding_id, filing_id, title, intent, status, priority, kind, billing_anchor, created)
       VALUES (1, 1, 1, 'Draft the orders sought', 'Write Part 1.', 'queued', 3, 'work', 'L7001|lease', '2026-10-01T09:00'),
              (2, 1, 1, '${DELETED_TITLE}', 'Note it up.', 'queued', 2, 'work', 'L7001|lease', '2026-10-01T09:05'),
              (3, 1, 1, 'Cite-check the orders', 'Check every rule.', 'queued', 1, 'work', 'L7001|lease', '2026-10-01T09:10');
     INSERT INTO tickets (id, proceeding_id, filing_id, title, intent, status, priority, kind, billing_anchor, created, completed_at)
       VALUES (4, 1, 1, 'Collect the lease', 'Get the lease.', 'completed', 0, 'work', 'L7001|lease', '2026-10-01T08:00', '2026-10-01T08:30');
     INSERT INTO ticket_steps (ticket_id, ordinal, text) VALUES (2, 1, 'Note up the authority');
     INSERT INTO ticket_scope (ticket_id, entity, entity_id) VALUES (2, 'authorities', 5);
     INSERT INTO ticket_blocks (blocker_id, blocked_id) VALUES (2, 3);
     INSERT INTO ticket_proposals (ticket_id, proposal_key, item) VALUES (2, '${KEY}', '${ITEM}');
     INSERT INTO seeds (id, proceeding_id, filing_id, origin_ticket_id, created, surfaced_by, idea)
       VALUES (1, 1, 1, 2, '2026-10-01T09:30', 'noticed while noting up', 'Ask whether the appeal is still pending.');
     INSERT INTO seeds (id, proceeding_id, filing_id, origin_ticket_id, created, surfaced_by, idea, charted_into)
       VALUES (2, 1, 1, NULL, '2026-10-01T08:45', 'outlining', 'Check whether Smith was appealed.', 2);`
  );
  const stored = { layout: shippedBlock("Documents/notice-of-application.md"), venue: shippedBlock("venue.md"), passage_hashes: {} };
  await submissionDataWrite(dbPath, "UPDATE filings SET layout_snapshot = ? WHERE id = 1", [JSON.stringify(stored)]);
  const mockups = mockupDir(dbPath, 1);
  mkdirSync(mockups, { recursive: true });
  writeManifest(mockups, {
    stamp: { filing_id: 1 },
    rendered_at: NOW,
    files: [],
    // A note-up Proposal derives once its statement has cleared the authority's other markers.
    inventory: [{ generating: true, slug: "note-up", marker: "📇", table: "authorities", id: 5, item: ITEM, doc: "Notice_of_application", cleared: true }],
  });
  return { dir, dbPath };
}

test("a deleted job stays in the database and is on no card, in no count and in no summary", async (t) => {
  const { dir, dbPath } = await matter(t);
  const draft = join(dir, "L7001 Ashgrove", "0. DRAFT");
  mkdirSync(draft, { recursive: true });
  const before = board(dbPath);
  const beforeCard = card(dbPath, draft);
  assert.equal(ticketOf(before, 3).category, "waiting", "#3 waits on #2");
  assert.deepEqual(proposalOf(before).lane, "held");

  assert.equal(await run(dbPath, DELETE, 2), 1);
  assert.notEqual(job(dbPath, 2).deleted_at, null, "the row stays, stamped");
  assert.equal(query(dbPath, "SELECT COUNT(*) AS n FROM ticket_steps WHERE ticket_id = 2")[0].n, 1, "its step stays");

  const after = board(dbPath);
  assert.deepEqual(ticketIds(after), [1, 3, 4]);
  assert.deepEqual(after.deleted, [{ id: 2, title: DELETED_TITLE }]);
  assert.equal(ticketOf(after, 3).category, "ready", "a job that waited on it no longer does");
  assert.deepEqual(ticketOf(after, 3).blocked_by, []);
  assert.equal(proposalOf(after).lane, "proposed", "its Proposal returns to Proposed");
  assert.deepEqual(after.seeds.map((s) => [s.id, s.origin_ticket_id]), [[1, null], [2, null]], "the captured seed names no origin job, and the outlined one shows again");

  const summary = renderBoardSummary(after, CLIENT, TODOS_NOT_READ);
  const afterCard = card(dbPath, draft);
  for (const text of [summary, afterCard]) {
    assert.doesNotMatch(text, /#2\b/);
    assert.equal(text.includes(DELETED_TITLE), false);
  }
  const completed = (text) => text.split("\n").find((line) => line.startsWith("## Completed ("));
  assert.equal(completed(afterCard), completed(beforeCard), "the Completed count is unchanged");
  assert.equal(completed(afterCard), "## Completed (1)");
});

test("restore returns the board exactly as it was before the delete", async (t) => {
  const { dbPath } = await matter(t);
  const before = board(dbPath);
  assert.equal(await run(dbPath, DELETE, 2), 1);
  assert.equal(await run(dbPath, RESTORE, 2), 1);
  assert.equal(job(dbPath, 2).deleted_at, null);
  assert.equal(JSON.stringify(board(dbPath)), JSON.stringify(before));
  assert.equal(ticketOf(board(dbPath), 3).category, "waiting");
});

test("a shelved job deleted and restored stays shelved, and the unshelve never touches a deleted job", async (t) => {
  const { dbPath } = await matter(t);
  const shelve = `UPDATE tickets SET rejected_at = '2026-10-05T09:00' WHERE id = 2;
    INSERT INTO proposal_rejections (proposal_key, ticket_id, marker, item, rejected_at) VALUES ('${KEY}', 2, '📇', '${ITEM}', '2026-10-05T09:00');`;
  await submissionDataExecute(dbPath, shelve);
  assert.equal(ticketOf(board(dbPath), 2).category, "rejected");
  assert.equal(proposalOf(board(dbPath)), undefined, "the shelved job's snapshot row hides its Proposal");

  assert.equal(await run(dbPath, DELETE, 2), 1, "a shelved queued job deletes");
  const deleted = board(dbPath);
  assert.equal(proposalOf(deleted).lane, "proposed", "a deleted job's snapshot row hides nothing");
  assert.deepEqual(deleted.lapsed_keys, [], "and never reads as lapsed");

  assert.equal(await run(dbPath, RESTORE, 2), 1);
  assert.equal(ticketOf(board(dbPath), 2).category, "rejected", "restored, it is shelved again");
  assert.equal(proposalOf(board(dbPath)), undefined, "and its Proposal is hidden again");

  // "Restoring a job" unshelves a shelved job that is not deleted: the stamp and its snapshot row.
  assert.equal(await run(dbPath, UNSHELVE, 2), 2);
  assert.equal(job(dbPath, 2).rejected_at, null);

  // On a deleted shelved job it writes nothing.
  await submissionDataExecute(dbPath, shelve);
  assert.equal(await run(dbPath, DELETE, 2), 1);
  assert.equal(await run(dbPath, UNSHELVE, 2), 0);
  assert.notEqual(job(dbPath, 2).rejected_at, null);
  assert.equal(query(dbPath, "SELECT COUNT(*) AS n FROM proposal_rejections WHERE ticket_id = 2")[0].n, 1);
});

test("a deleted job is never assigned, the gate row does not name it, and intake writes its key afresh", async (t) => {
  const { dbPath } = await matter(t);
  const gateItems = () => board(dbPath).criteria.find((c) => c.id === "gate").items;
  const intakeRows = () => query(dbPath, "SELECT COUNT(*) AS n FROM tickets WHERE title = 'Note up: Smith v. Jones, 2023 BCCA 182'")[0].n;
  assert.ok(gateItems().includes(DELETED_TITLE), "an open job is named on the gate row");
  await submissionDataExecute(dbPath, INTAKE);
  assert.equal(intakeRows(), 0, "intake writes no job for a key a live job holds");

  assert.equal(await run(dbPath, DELETE, 2), 1);
  const assigned = await submissionDataAssignJob({ db_path: dbPath, ticket_id: 2, session_token: "sess-a1" });
  assert.equal(assigned.outcome, "no_match");
  assert.match(assigned.note, /deleted/);
  assert.equal(job(dbPath, 2).status, "queued");
  assert.equal(gateItems().includes(DELETED_TITLE), false);

  await submissionDataExecute(dbPath, INTAKE);
  assert.equal(intakeRows(), 1, "a key held only by a deleted job is not held");
});

test("restore is refused while another live job holds the deleted job's key, and lands once it is shelved", async (t) => {
  const { dbPath } = await matter(t);
  assert.equal(await run(dbPath, DELETE, 2), 1);
  await submissionDataExecute(
    dbPath,
    `INSERT INTO tickets (id, proceeding_id, filing_id, title, intent, status, priority, kind, billing_anchor, created)
       VALUES (5, 1, NULL, 'Note up: ${ITEM}', 'Note up: ${ITEM}', 'queued', -1, 'work', 'L7001|lease', '2026-10-05T09:00');
     INSERT INTO ticket_proposals (ticket_id, proposal_key, item) VALUES (5, '${KEY}', '${ITEM}');`
  );
  assert.equal(await run(dbPath, RESTORE, 2), 0);
  assert.notEqual(job(dbPath, 2).deleted_at, null);
  assert.deepEqual(query(dbPath, forJob(HOLDER_READ, 2)), [{ id: 5, title: `Note up: ${ITEM}`, proposal_key: KEY }]);

  await submissionDataExecute(dbPath, "UPDATE tickets SET rejected_at = '2026-10-05T09:30' WHERE id = 5;");
  assert.equal(await run(dbPath, RESTORE, 2), 1);
  assert.equal(job(dbPath, 2).deleted_at, null);
});

test("completing a job leaves its deleted either/or partner queued", async (t) => {
  const { dir, dbPath } = await matter(t);
  await submissionDataExecute(
    dbPath,
    `UPDATE tickets SET status = 'wip', locked_by = 'sess-a1', locked_at = '2026-10-05T09:00' WHERE id = 1;
     INSERT INTO ticket_conflicts (a_id, b_id) VALUES (1, 3);`
  );
  assert.equal(await run(dbPath, DELETE, 3), 1);
  const draft = join(dir, "L7001 Ashgrove", "0. DRAFT");
  mkdirSync(draft, { recursive: true });
  const result = await submissionDataCompleteJob({ db_path: dbPath, ticket_id: 1, session_token: "sess-a1", draft_dir: draft }, CLIENT);
  assert.equal(result.outcome, "completed");
  assert.equal(result.superseded, 0);
  assert.deepEqual(query(dbPath, "SELECT status, superseded_by FROM tickets WHERE id = 3")[0], { status: "queued", superseded_by: null });
});
