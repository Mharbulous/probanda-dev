// Pre-filing proceedings (ADR 0018, #692): a proceeding with no filing -- its forum possibly not yet
// chosen -- holds tickets and seeds. Bootstrap lists it, the Litigation Strategy gives it a line, and it has a
// Job Board page of its own (#1365, ADR 0033's 2026-10-05 amendment), whose section render returns
// as board_summary from proceeding_id, with no filing, lifecycle or Proposals.

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

const { freshSubmissionDb } = await import("./helpers/template-db.mjs");
const { submissionDataExecute } = await import("../build/submission/backend.js");
const { submissionFormsBootstrap, submissionFormsRenderProceedingBoard } = await import("../build/submission/forms.js");
const { readBoardData } = await import("./fixtures/forms-render-seeds.mjs");

const PINNED = "2026-09-19 10:00";
const CLIENT = { clientName: "Larchmont", clientNo: "1", matterNo: "L8470" };

// Proceeding 1: forum not chosen, no filing, three tickets and an open seed. Proceeding 2: BCSC with
// one filing. Proceeding 3: forum chosen, no filing yet.
async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "coclerk-pre-filing-"));
  mkdirSync(join(dir, "L8470 Matter", "0. CASE DATA"), { recursive: true });
  const dbPath = join(dir, "L8470 Matter", "0. CASE DATA", "submission.sqlite");
  await freshSubmissionDb(dbPath);
  await submissionDataExecute(
    dbPath,
    `
    INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L8470 - Larchmont', NULL);
    INSERT INTO proceedings (id, matter_reference, forum, court_or_centre, file_number) VALUES (2, 'L8470 - Larchmont', 'CAN/BC/BCSC', 'BC Supreme Court', 'S-1');
    INSERT INTO proceedings (id, matter_reference, forum) VALUES (3, 'L8470 - Larchmont', 'CAN/BC/Vancouver-International-Arbitration-Centre');
    INSERT INTO filings (id, proceeding_id, kind, subkind, title) VALUES (1, 2, 'requisition_consent', 'consent', 'Consent Order Requisition');
    INSERT INTO tickets (id, proceeding_id, filing_id, title, intent, status, priority, kind, billing_anchor, locked_by, locked_at, created)
      VALUES (1, 1, NULL, 'Choose the forum', 'Court or arbitration.', 'queued', 0, 'charting', NULL, NULL, NULL, '2026-09-19 09:00'),
             (2, 1, NULL, 'Review the arbitration clause', 'Read the contract.', 'wip', 0, 'work', 'L8470', 'sess-a', '2026-09-19 09:30', '2026-09-19 09:05'),
             (3, 1, NULL, 'Draft the demand', 'After the review.', 'queued', 0, 'work', 'L8470', NULL, NULL, '2026-09-19 09:10'),
             (4, 2, 1, 'Settle the requisition', 'Settle it.', 'queued', 0, 'work', 'L8470', NULL, NULL, '2026-09-19 09:15');
    INSERT INTO ticket_blocks (blocker_id, blocked_id) VALUES (2, 3);
    INSERT INTO seeds (id, proceeding_id, filing_id, created, surfaced_by, idea) VALUES (1, 1, NULL, '2026-09-19 09:20', 'noticed', 'Is the guarantor a party?');
    `.trim()
  );
  const draft = join(dir, "L8470 Matter", "0. DRAFT");
  mkdirSync(draft, { recursive: true });
  return { dir, dbPath, draft, cleanup: () => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) };
}

function matterBoard(path) {
  const prefix = "window.MATTER_BOARD = ";
  const line = readFileSync(path, "utf-8").split("\n").find((l) => l.startsWith(prefix));
  return JSON.parse(line.slice(prefix.length, -1));
}

test("bootstrap lists every proceeding with no filing, and the Litigation Strategy gives each a line", async () => {
  const f = await fixture();
  try {
    const todos = {
      rows: [
        { id: "t1", description: "Settle the forum", bf_date: "2026-09-20", filing_ref: "proceeding:1" },
        { id: "t2", description: "A proceeding with a filing", bf_date: "2026-09-21", filing_ref: "proceeding:2" },
      ],
    };
    const result = submissionFormsBootstrap(f.dbPath, CLIENT, PINNED, f.draft, todos);
    assert.deepEqual(result.pre_filing_proceedings, [
      { proceeding_id: 1, forum: null },
      { proceeding_id: 3, forum: "CAN/BC/Vancouver-International-Arbitration-Centre" },
    ]);
    assert.deepEqual(result.filings.map((x) => x.filing_id), [1]);

    const data = matterBoard(result.matter_board_path);
    assert.deepEqual(data.filings.map((x) => x.filing_id), [1]);
    assert.deepEqual(data.pre_filing, [
      { proceeding_id: 1, proceeding: { court_or_centre: null, file_number: null }, state_label: "Forum not yet chosen", in_progress: 1 },
      { proceeding_id: 3, proceeding: { court_or_centre: null, file_number: null }, state_label: "No filing yet", in_progress: 0 },
    ]);
    assert.equal(data.todos[0].proceeding_id, 1, "a to-do can point at a pre-filing proceeding");
    assert.equal(data.todos[1].proceeding_id, undefined, "a proceeding with a filing is not a pre-filing proceeding, so the pointer draws nothing");
  } finally {
    f.cleanup();
  }
});

test("a proceeding's Job Board page carries its tickets and seeds, and no filing", async () => {
  const f = await fixture();
  try {
    const result = submissionFormsRenderProceedingBoard(f.dbPath, 1, CLIENT, PINNED, "tok-1", f.draft);
    assert.equal(result.proceeding_id, 1);
    assert.equal(result.session_token, "tok-1");
    assert.equal(result.rendered_at, PINNED);
    assert.equal("documents" in result, false);
    assert.match(result.board_summary, /^# Job Board — Matter L8470 · Client Larchmont \(1\) · Rev \d+\nTo Do: This matter's to-dos were not read\.\nGoal: Goal not set \(none\)\nState: Forum not yet chosen$/);
    assert.equal(result.board_summary.includes("🎯"), false, "a pre-filing section has no completion criteria");
    assert.equal(result.board_summary.includes("## Proposed"), false, "and no Proposals");
    assert.equal(result.job_board_path, join(f.draft, "Job Board - proceeding 1.html"));
    assert.equal(result.matter_board_path, join(f.draft, "Litigation Strategy.html"));
    assert.deepEqual(
      result.job_board_paths.map((p) => [p.filing_id, p.proceeding_id, p.path]),
      [
        [1, 2, join(f.draft, "Consent Order Requisition", "Job Board.html")],
        [null, 1, join(f.draft, "Job Board - proceeding 1.html")],
        [null, 3, join(f.draft, "Job Board - proceeding 3.html")],
      ],
      "every live filing's page, then every pre-filing proceeding's, in id order"
    );
    assert.deepEqual(
      readdirSync(f.draft),
      ["Consent Order Requisition", "Drafting records", "Job Board - proceeding 1.html", "Job Board - proceeding 3.html", "Litigation Strategy.html"],
      "no Pre-filing proceeding folder, only the matter's pages, the filing's Writing folder and the records folder"
    );
    assert.deepEqual(
      readdirSync(join(f.draft, "Consent Order Requisition")),
      ["Arguments.html", "Job Board.html", "Loose Threads.html", "Material Facts.html", "Procedural History.html", "Raw Research.html"],
      "the filing's pages are in its Writing's folder"
    );
    assert.equal(existsSync(join(dirname(f.dbPath), "mockups", "Pre-filing proceeding 1")), false, "nothing beside the database");

    const page = readBoardData(result.job_board_path);
    assert.deepEqual(page.sections.map((s) => [s.meta.filing_id, s.meta.proceeding_id]), [[null, 1]], "the proceeding's own section alone");
    const section = page.sections[0];
    const { meta, tickets, seeds } = section;
    // Goal card design §2.1: no filing, so no goal to show.
    assert.equal("goal" in section, false, "a pre-filing section has no Goal card");
    assert.equal("criteria" in section, false);
    assert.equal(meta.filing_id, null);
    assert.equal(meta.filing, "");
    assert.equal(meta.state, null);
    assert.equal(meta.state_label, "Forum not yet chosen");
    assert.equal(meta.ready_to_retire, false);
    assert.deepEqual(
      tickets.map((t) => [t.id, t.category]),
      [
        [1, "ready"],
        [2, "wip"],
        [3, "waiting"],
      ]
    );
    assert.deepEqual(seeds.map((s) => s.id), [1]);
  } finally {
    f.cleanup();
  }
});

test("without draft_dir the proceeding render writes nothing and returns its summary", async () => {
  const f = await fixture();
  try {
    const result = submissionFormsRenderProceedingBoard(f.dbPath, 3, CLIENT, PINNED);
    assert.match(result.board_summary, /^State: No filing yet$/m);
    assert.equal(result.board_summary.includes("🎯"), false);
    assert.equal(result.job_board_path, undefined);
    assert.equal(result.job_board_paths, undefined);
    assert.equal(result.matter_board_path, undefined);
    assert.deepEqual(readdirSync(f.draft), []);
    assert.equal(existsSync(join(dirname(f.dbPath), "mockups")), false, "nothing beside the database");
  } finally {
    f.cleanup();
  }
});

test("a proceeding with a filing is refused: its jobs are on each filing's Job Board", async () => {
  const f = await fixture();
  try {
    assert.throws(() => submissionFormsRenderProceedingBoard(f.dbPath, 2, CLIENT, PINNED), /filing/);
  } finally {
    f.cleanup();
  }
});
