// A research Writing (a research memo or case brief) has no board of its own, whatever order it was created
// in and whatever its id. Session entry, the board index, the Goal card, take_job, complete_job,
// create_writing's attachments, merge_milestones, set_board_goal and create_milestone each read it so.
// legal-research.db.test.mjs holds the pages it is left off. Every name is synthetic.

import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { after } from "node:test";

process.env.COCLERK_SUBMISSION_LOCK_ROOT = mkdtempSync(join(tmpdir(), "coclerk-research-boards-locks-"));
after(() => rmSync(process.env.COCLERK_SUBMISSION_LOCK_ROOT, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));

const { generalWritingFixture } = await import("./helpers/general-writing-fixture.mjs");
const { callTool } = await import("../build/dispatch.js");
const { boardSection } = await import("../build/submission/board-card.js");
const { submissionFormsRender, submissionFormsRenderProceedingBoard } = await import("../build/submission/forms.js");
const { DATES_NOT_READ } = await import("../build/submission/matter-board-section.js");
const { BoardIndex } = await import("../build/submission/forms/board-members.js");
const { submissionDataSetBoardGoal } = await import("../build/submission/forms/board-goals.js");
const { submissionDataCompleteJob } = await import("../build/submission/forms/complete-job.js");
const { submissionDataCreateMilestone } = await import("../build/submission/forms/create-milestone.js");
const { submissionDataMergeMilestones } = await import("../build/submission/forms/merge-milestones.js");
const { submissionDataTakeJob } = await import("../build/submission/forms/take-job.js");
const { awaitBackgroundJobs } = await import("../build/submission/render-job.js");

const NOW = "2026-11-01 09:00";
const TREE = { country: "CAN", jurisdiction: "BC", venue: "_NoVenue" };
const BRIEF_FOLDER = "2026-11-01 case brief A v B";

async function fixture(t) {
  const g = await generalWritingFixture(t);
  t.after(awaitBackgroundJobs);
  const matterRoot = dirname(g.draft);
  writeFileSync(join(matterRoot, "coclerk.json"), JSON.stringify({ schema_version: 5, matter_root: matterRoot, case_data_dir: "0. CASE DATA", evidence_sql_path: "x.sql" }), "utf-8");
  return g;
}
const brief = (g, proceedingId = 1) => g.create({ proceeding_id: proceedingId, tree: TREE, kind: "case_brief", recipient: "internal", title: `${BRIEF_FOLDER}, 2020 BCCA 1` });
const section = (g, board) => boardSection(g.dbPath, board, {}, NOW, DATES_NOT_READ);
const render = (g, id) => submissionFormsRender(g.dbPath, id, {}, "mockup", ["Work_board"], undefined, undefined, NOW, "tok", g.draft);
const job = (g, id, filingId, title) =>
  g.execute(
    `INSERT INTO tickets (id, proceeding_id, filing_id, title, intent, status, priority, kind, billing_anchor, created)
       VALUES (${id}, 1, ${filingId ?? "NULL"}, '${title}', 'Do the work it names', 'queued', 0, 'work', 'L0000', '2026-11-01 08:00');
     INSERT INTO ticket_steps (ticket_id, ordinal, text) VALUES (${id}, 1, 'A first piece of work');`
  );
const htmlFiles = (dir, rel = "") =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? htmlFiles(join(dir, e.name), join(rel, e.name)) : e.name.endsWith(".html") ? [join(rel, e.name)] : []));
const openSession = (g, args = {}) => callTool({}, "drafting_forms__open_session", { matter_root: dirname(g.draft), ...args });

test("session entry never opens a research Writing by default: a memo-only proceeding opens its own board", async (t) => {
  const g = await fixture(t);
  const { filing_id: id } = await brief(g);
  const result = await openSession(g);
  assert.equal(result.opened.filing_id, undefined);
  assert.equal(result.opened.proceeding_id, 1);
  assert.equal(result.milestone_path, join(g.draft, "Milestone - proceeding 1.html"));
  assert.deepEqual(result.filings.map((f) => [f.filing_id, f.research_writing]), [[id, true]], "still findable in the list");
  assert.ok(result.pre_filing_proceedings.some((p) => p.proceeding_id === 1));
});

test("session entry opens the Writing, not the memo the list puts first, and opens the memo when filing_id names it", async (t) => {
  const g = await fixture(t);
  const { filing_id: memo } = await brief(g);
  const { filing_id: letter } = await g.createLetter();
  const result = await openSession(g);
  assert.equal(result.opened.filing_id, letter);
  assert.equal(result.filings.find((f) => f.filing_id === letter).research_writing, undefined);
  const named = await openSession(g, { filing_id: memo });
  assert.equal(named.opened.filing_id, memo);
});

test("a memo with the proceeding's lowest id is no first Writing: the proceeding's page keeps its name and its goal, and a write keeps the goal's row", async (t) => {
  const g = await fixture(t);
  const { filing_id: id } = await brief(g);
  assert.equal(id, 1);
  await g.execute(
    `INSERT INTO db_meta (key, value) VALUES ('board_goal:proceeding:1', '{"description":"d","statement":"Win the stay","status":"confirmed","approved_at":null,"session_token":"s","updated_at":"2026-10-01T00:00"}');`
  );
  assert.deepEqual(new BoardIndex(g.dbPath).survivorOf({ filing_id: null, proceeding_id: 1 }), { filing_id: null, proceeding_id: 1 });
  assert.equal(section(g, { proceeding_id: 1 }).goals.statement, "Win the stay");

  const rendered = submissionFormsRenderProceedingBoard(g.dbPath, 1, {}, undefined, "tok", g.draft);
  assert.equal(rendered.milestone_path, join(g.draft, "Milestone - proceeding 1.html"));
  assert.equal(htmlFiles(g.draft).some((f) => f.includes(BRIEF_FOLDER)), false, "nothing in the memo's folder");

  const other = await submissionDataSetBoardGoal({ db_path: g.dbPath, proceeding_id: 2, statement: "Another", status: "confirmed", session_token: "s" });
  assert.deepEqual(other.stale_keys_removed, []);
  assert.equal(section(g, { proceeding_id: 1 }).goals.statement, "Win the stay");
  const own = await submissionDataSetBoardGoal({ db_path: g.dbPath, proceeding_id: 1, statement: "Win the appeal", status: "confirmed", session_token: "s" });
  assert.equal(own.key, "board_goal:proceeding:1");
  assert.equal(section(g, { proceeding_id: 1 }).goals.statement, "Win the appeal");
  await assert.rejects(submissionDataSetBoardGoal({ db_path: g.dbPath, filing_id: id, statement: "x", status: "confirmed", session_token: "s" }), (e) => e.code === "research_writing");

  // The first Writing after the memo takes the proceeding's board.
  const { filing_id: letter } = await g.createLetter();
  assert.deepEqual(new BoardIndex(g.dbPath).survivorOf({ filing_id: null, proceeding_id: 1 }), { filing_id: letter, proceeding_id: 1 });
  await assert.rejects(submissionDataSetBoardGoal({ db_path: g.dbPath, proceeding_id: 1, statement: "x", status: "confirmed", session_token: "s" }), (e) => e.code === "proceeding_has_writing");
});

test("a job on a memo is drawn on its proceeding's boards and holds no Writing's gate, live, retired or deleted", async (t) => {
  const g = await fixture(t);
  const { filing_id: memo } = await brief(g);
  const { filing_id: letter } = await g.createLetter();
  render(g, letter);
  await awaitBackgroundJobs();
  const card = () => section(g, { filing_id: letter });
  const gate = (s) => s.criteria.find((c) => c.id === "gate");
  const before = card();
  assert.ok(gate(before), "the letter has a gate row");

  await job(g, 30, memo, "Note up the propositions");
  const after = card();
  assert.deepEqual(gate(after), gate(before));
  assert.deepEqual(after.goal, before.goal);
  const drawn = after.tickets.find((x) => x.id === 30);
  assert.equal(drawn.general, true, "drawn with the General jobs");
  assert.equal(drawn.research_writing, memo);

  // The control: a General job on the same board still holds the gate, and is what the row names.
  await job(g, 31, null, "Check the pleading");
  assert.deepEqual(gate(card()).items, ["Check the pleading"]);
  assert.equal(card().tickets.find((x) => x.id === 31).research_writing, undefined);

  // Service work on a memo waits on no Writing's gate, here held by job 31; on the proceeding it does.
  await job(g, 32, memo, "File and serve");
  await job(g, 33, null, "File and serve");
  const skips = (id) => card().tickets.find((x) => x.id === id).dispatch_skips.map((s) => s.reason);
  assert.equal(skips(32).includes("before_gate"), false);
  assert.equal(skips(33).includes("before_gate"), true);
  await g.execute("DELETE FROM ticket_steps WHERE ticket_id IN (31, 32, 33); DELETE FROM tickets WHERE id IN (31, 32, 33);");

  await g.execute(`UPDATE filings SET retired_on = '2026-10-31', retirement_reason = 'abandoned' WHERE id = ${memo};`);
  const retired = card();
  assert.ok(retired.tickets.some((x) => x.id === 30), "a retired memo's open job stays visible");
  assert.deepEqual(gate(retired), gate(before));

  await g.execute(`UPDATE tickets SET deleted_at = '2026-11-01T09:00' WHERE id = 30;`);
  const deleted = card();
  assert.equal(deleted.tickets.some((x) => x.id === 30), false);
  assert.deepEqual(deleted.deleted.map((d) => d.id), [30], "a deleted job on a memo can be found to restore, as a General job's can");
});

test("take_job reads a memo's job on a real board and checks overlap only against that memo's jobs, and complete_job renders that board", async (t) => {
  const g = await fixture(t);
  const { filing_id: memo } = await brief(g);
  const { filing_id: letter } = await g.createLetter();
  render(g, letter);
  await awaitBackgroundJobs();
  await job(g, 30, memo, "Note up propositions carefully");
  await job(g, 31, null, "Note up propositions differently");
  await job(g, 32, memo, "Note up propositions again");
  const take = (id, extra = {}) => submissionDataTakeJob({ db_path: g.dbPath, ticket_id: id, session_token: "tok", matter_root: dirname(g.draft), ...extra });

  const refused = await take(30);
  assert.equal(refused.reason, "duplicates");
  assert.deepEqual(refused.duplicates.map((d) => d.ticket_id), [32], "not the General job");

  // A key is its memo's own: the letter's board does not derive it, and that is no dead key.
  await g.execute("INSERT INTO ticket_proposals (ticket_id, proposal_key, item) VALUES (30, 'memo-key', 'an item');");
  const taken = await take(30, { not_duplicates: [32] });
  assert.equal(taken.outcome, "assigned");
  assert.equal(taken.premise.state, "none");

  await g.execute("UPDATE ticket_steps SET done_at = '2026-11-01T09:00' WHERE ticket_id = 30;");
  const done = await submissionDataCompleteJob({ db_path: g.dbPath, ticket_id: 30, session_token: "tok", claim_no: taken.claim_no, draft_dir: g.draft });
  assert.equal(done.outcome, "completed");
  assert.equal(done.pages_written, true);
  assert.equal(done.milestone_path, join(dirname(render(g, letter).documents.find((d) => d.document_type === "Work_board").path), "Milestone.html"));
  assert.equal(done.milestone_path.includes(BRIEF_FOLDER), false);
  assert.equal(typeof done.board_changed, "boolean");
  await awaitBackgroundJobs();
  assert.equal(htmlFiles(g.draft).some((f) => f.includes(BRIEF_FOLDER)), false);
});

test("complete_job on a memo-only proceeding's job writes the proceeding's page", async (t) => {
  const g = await fixture(t);
  const { filing_id: memo } = await brief(g);
  await job(g, 30, memo, "Note up the propositions");
  const taken = await submissionDataTakeJob({ db_path: g.dbPath, ticket_id: 30, session_token: "tok", matter_root: dirname(g.draft) });
  assert.equal(taken.outcome, "assigned");
  await g.execute("UPDATE ticket_steps SET done_at = '2026-11-01T09:00' WHERE ticket_id = 30;");
  const done = await submissionDataCompleteJob({ db_path: g.dbPath, ticket_id: 30, session_token: "tok", claim_no: taken.claim_no, draft_dir: g.draft });
  assert.equal(done.pages_written, true);
  assert.equal(done.milestone_path, join(g.draft, "Milestone - proceeding 1.html"));
  assert.equal(done.pages_refused, undefined);
});

test("attached drafts: a memo takes none, a memo-only proceeding keeps them on its board, and the first real Writing takes them all", async (t) => {
  const g = await fixture(t);
  await g.execute(`INSERT INTO board_attachments (id, proceeding_id, filing_id, path, kind, attached_on) VALUES (1, 1, NULL, '0. DRAFT\\Reply one.eml', 'reply', '2026-10-01');`);
  const created = await brief(g);
  assert.equal(created.attachments_moved, 0);
  assert.deepEqual(g.query("SELECT id, filing_id FROM board_attachments"), [{ id: 1, filing_id: null }]);
  const onBoard = (board) => section(g, board).attachments.map((a) => a.id);
  assert.deepEqual(onBoard({ proceeding_id: 1 }), [1]);

  // The v67 trigger refuses a new row naming the proceeding; the refusal says what to do, and doing it works.
  await assert.rejects(
    g.execute(`INSERT INTO board_attachments (id, proceeding_id, filing_id, path, kind, attached_on) VALUES (2, 1, NULL, '0. DRAFT\\Reply two.eml', 'reply', '2026-10-02');`),
    /no board of its own.*filing_id set to one of them/s
  );
  await g.execute(`INSERT INTO board_attachments (id, proceeding_id, filing_id, path, kind, attached_on) VALUES (2, 1, ${created.filing_id}, '0. DRAFT\\Reply two.eml', 'reply', '2026-10-02');`);
  assert.deepEqual(onBoard({ proceeding_id: 1 }), [1, 2]);

  const letter = await g.createLetter();
  assert.equal(letter.attachments_moved, 2);
  assert.deepEqual(onBoard({ filing_id: letter.filing_id }), [1, 2]);
  assert.deepEqual(g.query("SELECT DISTINCT filing_id FROM board_attachments"), [{ filing_id: letter.filing_id }]);

  const second = await brief(g);
  assert.equal(second.attachments_moved, 0);
});

test("a draft stranded on a memo before this rule, beside a live Writing, is drawn on one board and is marked proceeding-wide", async (t) => {
  const g = await fixture(t);
  const { filing_id: memo } = await brief(g);
  const { filing_id: first } = await g.createLetter();
  const { filing_id: later } = await g.createLetter({ title: "Letter two" });
  await g.execute(`INSERT INTO board_attachments (id, proceeding_id, filing_id, path, kind, attached_on) VALUES (5, 1, ${memo}, '0. DRAFT\\Stranded.eml', 'reply', '2026-10-01');`);
  assert.deepEqual(section(g, { filing_id: first }).attachments.map((a) => [a.id, a.filing_id]), [[5, null]]);
  assert.deepEqual(section(g, { filing_id: later }).attachments, []);
});

test("merge_milestones refuses a research Writing, and a memo-only board merges by proceeding_id", async (t) => {
  const g = await fixture(t);
  const { filing_id: memo } = await brief(g);
  const merge = (boards, extra = {}) => submissionDataMergeMilestones({ db_path: g.dbPath, boards, confirmed: true, session_token: "s", ...extra });
  await assert.rejects(merge([{ filing_id: memo }, { proceeding_id: 2 }]), (e) => e.code === "research_writing" && /research result/.test(e.message));
  assert.deepEqual(g.query("SELECT key FROM db_meta WHERE key GLOB 'board_member:*'"), []);
  const merged = await merge([{ proceeding_id: 1 }, { proceeding_id: 2 }]);
  assert.deepEqual(merged.survivor, { filing_id: null, proceeding_id: 1 });

  const { filing_id: letter } = await g.createLetter();
  await assert.rejects(merge([{ filing_id: memo }, { filing_id: letter }]), (e) => e.code === "research_writing");
  await assert.rejects(merge([{ proceeding_id: 1 }, { proceeding_id: 3 }]), (e) => e.code === "proceeding_has_writing");
});

test("a merge row made before the refusal, naming a memo, is read as no row: the Writing draws its own page, and can merge again", async (t) => {
  const g = await fixture(t);
  const { filing_id: memo } = await brief(g);
  const { filing_id: first } = await g.createLetter();
  const { filing_id: second } = await g.createLetter({ title: "Letter two" });
  await g.execute(
    `INSERT INTO db_meta (key, value) VALUES ('board_member:filing:${second}', '{"filing_id":${memo},"proceeding_id":1}'), ('board_member:filing:${memo}', '{"filing_id":${first},"proceeding_id":1}');`
  );
  const index = new BoardIndex(g.dbPath);
  assert.equal(index.absorbed({ filing_id: second, proceeding_id: 1 }), false);
  assert.deepEqual(index.survivorOf({ filing_id: second, proceeding_id: 1 }), { filing_id: second, proceeding_id: 1 });

  const rendered = render(g, second);
  await awaitBackgroundJobs();
  assert.equal(rendered.documents.find((d) => d.document_type === "Work_board").path.includes(BRIEF_FOLDER), false);
  assert.equal(htmlFiles(g.draft).some((f) => f.includes(BRIEF_FOLDER)), false);

  const merged = await submissionDataMergeMilestones({ db_path: g.dbPath, boards: [{ filing_id: first }, { filing_id: second }], confirmed: true, session_token: "s" });
  assert.deepEqual(merged.absorbed, { filing_id: second, proceeding_id: 1 });
  assert.deepEqual(new BoardIndex(g.dbPath).survivorOf({ filing_id: second, proceeding_id: 1 }), { filing_id: first, proceeding_id: 1 });
});

test("create_milestone is refused on a memo-only proceeding, which keeps its board, and allowed once it has a Writing", async (t) => {
  const g = await fixture(t);
  await brief(g);
  await job(g, 30, null, "Check the pleading");
  await assert.rejects(submissionDataCreateMilestone({ db_path: g.dbPath, proceeding_id: 1, title: "Paper originals" }), (e) => e.code === "no_writing");
  assert.ok(section(g, { proceeding_id: 1 }).tickets.some((x) => x.id === 30), "the General job stays on the proceeding's board");
  assert.ok(submissionFormsRenderProceedingBoard(g.dbPath, 1, {}, undefined, "tok", g.draft).milestone_path);
  await g.createLetter();
  assert.equal((await submissionDataCreateMilestone({ db_path: g.dbPath, proceeding_id: 1, title: "Paper originals" })).title, "Paper originals");
});
