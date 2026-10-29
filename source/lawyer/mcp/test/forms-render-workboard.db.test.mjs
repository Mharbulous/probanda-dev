// Golden-fixture tests for the submission form renderers (build ticket #297): the Milestone: its data, code and ticket rendering.
// Since ADR 0033's 2026-10-05 amendment a filing's board is the one section of its own Milestone
// page, and a render returns it as board_summary; boardDataOf builds the section exactly as the page does.
// Split out of the former forms-render.test.mjs; shared seeds live in fixtures/forms-render-seeds.mjs,
// which also documents regenerating the golden fixtures.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { seededDbFixture, seedVaniacProceeding, seedBcscDefaultJudgment, seedApplicationResponse, assertMatchesGolden, goldenPath, seedTickets, seedProposalCases, boardDataOf, DATA_LINE_PREFIX, boardDataLines, readBoardData, ASHBOURNE, draftFolder } from "./fixtures/forms-render-seeds.mjs";
import { BCSC_TREE, generalWritingFixture, LETTER_BLOCK, MEMO_BLOCK, MEMO_FILE, NO_VENUE_TREE } from "./helpers/general-writing-fixture.mjs";
import { knowledgeFile } from "./helpers/knowledge-fixture.mjs";
const { freshSubmissionDb, partiesSnapshotSql, seedSql } = await import("./helpers/template-db.mjs");
const { writePartiesOfRecord } = await import("./helpers/matter-data-fixture.mjs");
const { submissionDataMigrate } = await import("../build/submission/migrate.js");
const { hopsFrom } = await import("./helpers/schema-hops.mjs");
const { submissionDataMigrateScriptsDir } = await import("../build/repo-root.js");
const { submissionDataRecordSent } = await import("../build/submission/forms/sent-write.js");
const { submissionDataExecute, submissionDataQuery, submissionDataWrite } = await import("../build/submission/backend.js");
const { submissionFormsRender, submissionFormsBootstrap } = await import("../build/submission/forms.js");
const { buildWorkBoardData, INELIGIBLE_REASONS, RESERVE_INVENTORY_DOC, STOCK_TITLES } = await import("../build/submission/forms/render-work-board.js");
const { ALL_MARKER_GLYPHS } = await import("../build/submission/forms/markers.js");
const { GLYPH_SLUGS } = await import("../build/submission/forms/proposal-inventory.js");
const { WORKBOARD_CSS, WORKBOARD_JS } = await import("../build/submission/forms/workboard-assets.js");
const { renderWorkBoardHtml } = await import("../build/submission/forms/workboard-shell.js");
const { filingBoardData, renderBoardSummary, renderLiveLanes, submissionFormsBoardCard, TODOS_NOT_READ } = await import("../build/submission/matter-pages.js");
const { fetchFiling, fetchProceeding, fetchRevision } = await import("../build/submission/forms/query.js");

// 2026-09-14 local-only design: the hosted Work Board artifact is retired. Bootstrap reports a URL a
// matter still records from that design, so a session can offer to delete the artifact and clear it.
test("bootstrap reports no legacy Work Board artifact on a matter that never had one", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedVaniacProceeding(f.dbPath);

    const result = submissionFormsBootstrap(f.dbPath, { clientName: "Ashbourne", clientNo: "2417", matterNo: "L4801" });
    assert.equal(result.filings.length, 1, "the matter still renders");
    assert.equal(result.legacy_workboard_artifact_url, null);
    for (const retired of ["workboard_artifact_url", "workboard_template_version", "current_workboard_template_version"]) {
      assert.equal(retired in result, false, `expected no ${retired} field`);
    }
  } finally {
    f.cleanup();
  }
});

test("bootstrap reports the legacy Work Board artifact URL a matter still records, and still renders", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedVaniacProceeding(f.dbPath);
    await submissionDataExecute(
      f.dbPath,
      `INSERT OR REPLACE INTO db_meta (key, value) VALUES ('workboard_artifact_url', 'https://claude.ai/code/artifact/abc123');
       INSERT OR REPLACE INTO db_meta (key, value) VALUES ('workboard_template_version', '2');`
    );

    const result = submissionFormsBootstrap(f.dbPath, { clientName: "Ashbourne", clientNo: "2417", matterNo: "L4801" });
    assert.equal(result.legacy_workboard_artifact_url, "https://claude.ai/code/artifact/abc123");
    assert.equal(result.filings.length, 1);
    // Bootstrap renders nothing (#584), so the check is that the legacy key does not stop it
    // listing the filing at all -- an empty `paths` here would pass `.every()` vacuously.
    assert.equal(result.filings[0].render_state, "never", "the legacy key does not stop the filing being listed");
  } finally {
    f.cleanup();
  }
});

// Goal card design §5.4 (plan decision 4): an unattended run's entry mints a token of its own class.
test("bootstrap mints sess-<hex>, and sess-unattended-<hex> when asked for an unattended run", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedVaniacProceeding(f.dbPath);
    assert.match(submissionFormsBootstrap(f.dbPath, ASHBOURNE).session_token, /^sess-[0-9a-f]{18}$/);
    assert.match(submissionFormsBootstrap(f.dbPath, ASHBOURNE, undefined, undefined, undefined, true).session_token, /^sess-unattended-[0-9a-f]{18}$/);
  } finally {
    f.cleanup();
  }
});

/** The one section of a Writing's own Milestone page, `<Writing folder>Milestone.html` (spec 2026-10-22). */
function writingSection(folder) {
  const page = readBoardData(join(folder, "Milestone.html"));
  assert.equal(page.sections.length, 1, `the Milestone page in ${folder} holds one section`);
  return page.sections[0];
}

function boardCode(html) {
  return html.split("\n").filter((line) => !line.startsWith(DATA_LINE_PREFIX)).join("\n");
}

function idsIn(data, category) {
  return data.tickets.filter((t) => t.category === category).map((t) => t.id);
}

function ticketIn(data, id) {
  const ticket = data.tickets.find((t) => t.id === id);
  assert.ok(ticket, `expected ticket ${id} on the board`);
  return ticket;
}

/** The four derived fields a Proposal's lane assignment turns on (design §7). */
function laneOf(data, key) {
  const proposal = data.proposals.find((p) => p.key === key);
  assert.ok(proposal, `expected a ${key} Proposal on the board`);
  return { key: proposal.key, marker: proposal.marker, lane: proposal.lane, holder: proposal.holder };
}

// The Rendered stamp is wall-clock; pin it so the golden fixture does not churn.
function goldenBoardData(data) {
  return JSON.stringify({ ...data, meta: { ...data.meta, rendered: "0000-00-00 00:00" } }, null, 2) + "\n";
}

// seedProposalCases runs here and nowhere else, so its substance rows move no advocacy golden.
// Ladders it still leaves without fixture coverage, deliberately rather than by oversight:
//   * 🧵 loose-thread -- emitted only from the Notice of Application / Application Response
//     pointer rows, which no VanIAC filing has.
//   * ✒️ swear-it -- the seed's only instruments are witness statements; no affidavit.
//   * 📌 on the `facts` table (the court-record locator) -- no fact here is court-record linked.
//   * ⬜ unchosen and choose-template -- requisition checklists and Form 8 only, covered by
//     proposal-inventory.db.test.mjs's BCSC default-judgment tests.
test("renders the Milestone's data", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedVaniacProceeding(f.dbPath);
    await seedTickets(f.dbPath);
    await seedProposalCases(f.dbPath);

    const { draft, leaf } = draftFolder(f);
    const result = submissionFormsRender(f.dbPath, 1, { clientName: "Ashbourne", clientNo: "2417", matterNo: "L4801" }, "mockup", undefined, undefined, undefined, "2026-09-20 10:00", undefined, draft);
    const board = result.documents.find((d) => d.document_type === "Work_board");
    const data = boardDataOf(f.dbPath, 1, { clientName: "Ashbourne", clientNo: "2417", matterNo: "L4801" }, "2026-09-20 10:00");
    assert.equal(board.markdown, undefined, "the board returns no markup");
    assert.equal(board.path, join(leaf, "Milestone.html"));
    assert.deepEqual(writingSection(leaf), data, "the filing's page carries exactly the board data");

    // Ordered priority DESC, then id, within each category.
    assert.deepEqual(idsIn(data, "ready"), [2, 7, 8], "ticket 2 (blocker completed), the proceeding-scoped ticket, the charting ticket");
    assert.deepEqual(idsIn(data, "wip"), [4]);
    assert.deepEqual(
      idsIn(data, "waiting"),
      [3, 6, 9, 10, 11, 14],
      "ticket 11's blocker outside this proceeding reads as unresolved, never as Ready; ticket 6, blocked by a superseded ticket, and ticket 14, blocked by a rejected one, are Blocked too"
    );
    assert.deepEqual(idsIn(data, "superseded"), [5]);
    assert.deepEqual(idsIn(data, "completed"), [1]);
    assert.deepEqual(idsIn(data, "rejected"), [13], "the rejected ticket sits in its own lane, not in ready");

    const wip = ticketIn(data, 4);
    assert.equal(wip.status, "wip");
    assert.equal(wip.locked_by, "sess-a1", "the session token as stored, never a display identity");
    assert.equal(wip.locked_at, "2026-09-02T10:05");
    assert.equal("plan" in wip, false, "a job's plan is its steps");
    assert.deepEqual(wip.steps, [
      { ordinal: 1, text: "Audit the exhibit list", done_at: "2026-09-02T10:10", status: null, wait_until: null, status_note: null },
      { ordinal: 2, text: "Reconcile against the disclosure log", done_at: null, status: null, wait_until: null, status_note: null },
    ]);

    assert.equal(ticketIn(data, 9).circular, true, "the mutual-block pair is labelled circular");
    assert.equal(ticketIn(data, 10).circular, true);
    assert.equal(ticketIn(data, 3).circular, false);
    assert.deepEqual(ticketIn(data, 11).blocked_by, [{ id: 99, status: null, rejected: false }], "the cross-proceeding blocker is named, not dropped; its rejection is unreadable, so false");
    assert.deepEqual(ticketIn(data, 6).blocked_by, [{ id: 5, status: "superseded", rejected: false }]);
    assert.deepEqual(ticketIn(data, 14).blocked_by, [{ id: 13, status: "queued", rejected: true }], "a queued blocker carries its own rejection, which is why 14 needs re-charting");
    assert.deepEqual(ticketIn(data, 5).superseded_by, { id: 1, status: "completed", rejected: false });
    assert.deepEqual(ticketIn(data, 5).conflicts, [{ id: 1, status: "completed", rejected: false }], "conflict edges read from both sides");
    assert.deepEqual(ticketIn(data, 1).conflicts, [{ id: 5, status: "superseded", rejected: false }]);
    assert.deepEqual(ticketIn(data, 2).scope, ["facts", "statements_of_law:12"]);
    assert.deepEqual(ticketIn(data, 7).steps, []);
    assert.deepEqual(ticketIn(data, 2).proposal_keys, ["factual-basis:submissions:1"], "an ordinary ticket names the Proposal it was outlined from");
    assert.deepEqual(ticketIn(data, 7).proposal_keys, []);
    assert.deepEqual(
      ticketIn(data, 2).proposal_items,
      { "factual-basis:submissions:1": "The Respondent owes $150,000 under the plain words of the Asset Purchase Agreement." },
      "each held key carries the item its ticket_proposals row stored"
    );
    assert.deepEqual(ticketIn(data, 7).proposal_items, {}, "a ticket with no keys carries an empty object");

    assert.deepEqual(data.seeds.map((s) => s.id), [1], "the already-charted seed is excluded");
    assert.equal(data.seeds[0].origin_ticket_id, 4);

    assert.equal(data.meta.revision, result.revision);
    assert.equal(data.meta.rendered, result.rendered_at);
    assert.equal(data.meta.matter, "L4801");
    assert.equal(data.meta.client, "Ashbourne");
    assert.equal(data.meta.filing_id, 1);
    assert.deepEqual([data.meta.state, data.meta.state_label, data.meta.state_since, data.meta.ready_to_retire], ["drafting", "Drafting", null, false]);

    // One Proposal per ladder, each at the rung the render actually printed (design §5).
    assert.deepEqual(laneOf(data, "authority-excerpt:statements_of_law:7"), { key: "authority-excerpt:statements_of_law:7", marker: "📜", lane: "proposed", holder: null });
    assert.deepEqual(laneOf(data, "authority-pinpoint:statements_of_law:9"), { key: "authority-pinpoint:statements_of_law:9", marker: "📍", lane: "proposed", holder: null });
    assert.deepEqual(laneOf(data, "note-up:authorities:6"), { key: "note-up:authorities:6", marker: "📇", lane: "proposed", holder: null });
    assert.deepEqual(
      data.proposals.filter((p) => p.slug === "note-up").map((p) => p.key),
      ["note-up:authorities:6"],
      "📇 is the one positive rung: authorities 2 and 5 print it, but no statement of either has cleared 📜 📍 🔬"
    );
    assert.deepEqual(laneOf(data, "testimony-excerpt:statements_of_fact:8"), { key: "testimony-excerpt:statements_of_fact:8", marker: "💬", lane: "proposed", holder: null });
    assert.deepEqual(laneOf(data, "testimony-pinpoint:statements_of_fact:8"), { key: "testimony-pinpoint:statements_of_fact:8", marker: "🧷", lane: "proposed", holder: null });

    // Held: by a ticket on another filing, which the holder names; and by one on this board's own
    // filing, whose ticketed_on stays null so the page prints nothing (plan A2).
    assert.deepEqual(laneOf(data, "not-recorded:documents:2"), {
      key: "not-recorded:documents:2",
      marker: "🏷️",
      lane: "held",
      holder: { ticket_id: 12, ticketed_on: "Reply Submissions Package" },
    });
    assert.deepEqual(laneOf(data, "factual-basis:submissions:1"), {
      key: "factual-basis:submissions:1",
      marker: "🧾",
      lane: "held",
      holder: { ticket_id: 2, ticketed_on: null },
    });

    // Rejected: a direct row (ticket_id null) opens a Rejected angle; a snapshot row (ticket 13's)
    // only hides its Proposal, and the rejected ticket itself holds nothing (design §7).
    assert.deepEqual(laneOf(data, "unserved-petitum:order_sought:2"), { key: "unserved-petitum:order_sought:2", marker: "🦵", lane: "rejected", holder: null });
    assert.equal(
      data.proposals.some((p) => p.key === "serve-it:documents:10"),
      false,
      "a snapshot rejection hides the Proposal behind its ticket rather than showing it rejected"
    );

    // Lapsed: the stored item no longer matches the derived one, so the row hides nothing and the
    // key is reported for the next Opening to delete (assumption A5).
    assert.deepEqual(laneOf(data, "doctrinal-basis:law_assertions:4"), { key: "doctrinal-basis:law_assertions:4", marker: "📖", lane: "proposed", holder: null });
    assert.deepEqual(data.lapsed_keys, ["doctrinal-basis:law_assertions:4"]);

    // The board prints marker glyphs in its Proposals and nowhere else (design §13): it holds no
    // predicate of its own, so every glyph on it came from the render's inventory.
    const { proposals, ...withoutProposals } = data;
    for (const glyph of ALL_MARKER_GLYPHS) {
      assert.doesNotMatch(JSON.stringify(withoutProposals), new RegExp(glyph), `expected no work-marker glyph ${glyph} outside the board's Proposals`);
    }
    for (const proposal of proposals) {
      assert.ok(GLYPH_SLUGS.has(proposal.marker), `expected ${proposal.key}'s marker ${proposal.marker} to be a generating glyph`);
    }

    assertMatchesGolden("work-board-data.json", goldenBoardData(data));
  } finally {
    f.cleanup();
  }
});

test("renders an empty Milestone's data", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedVaniacProceeding(f.dbPath);

    submissionFormsRender(f.dbPath, 1, { clientName: "Ashbourne", clientNo: "2417", matterNo: "L4801" });
    const data = boardDataOf(f.dbPath, 1, { clientName: "Ashbourne", clientNo: "2417", matterNo: "L4801" });

    assert.deepEqual(data.tickets, []);
    assert.deepEqual(data.seeds, []);
    assertMatchesGolden("work-board-data-empty.json", goldenBoardData(data));
  } finally {
    f.cleanup();
  }
});

// ADR 0024 D11: seeds do not strand. Every filing's board shows every open seed in its proceeding,
// a sibling filing's seed labelled with that filing's title, and rendering moves no seed.
test("every filing's Milestone shows every open seed in its proceeding (#1107)", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedVaniacProceeding(f.dbPath);
    await submissionDataExecute(
      f.dbPath,
      `INSERT INTO filings (id, proceeding_id, kind, subkind, round, title) VALUES (2, 1, 'submissions_package', NULL, 'reply', 'Reply Submissions Package');
       INSERT INTO tickets (id, proceeding_id, filing_id, title, intent, status, priority, kind, billing_anchor, created)
         VALUES (1, 1, 2, 'Outlined from seed 13', 'Holds the charted seed.', 'queued', 0, 'work', 'L4801|seeds', '2026-09-02T09:00');
       INSERT INTO seeds (id, proceeding_id, filing_id, created, surfaced_by, idea)
         VALUES (10, 1, 1, '2026-09-02T10:00', 'noticed', 'An idea from the first filing.'),
                (11, 1, 2, '2026-09-02T10:01', 'noticed', 'An idea from the reply.'),
                (12, 1, NULL, '2026-09-02T10:02', 'noticed', 'An idea for the whole proceeding.');
       INSERT INTO seeds (id, proceeding_id, filing_id, created, surfaced_by, idea, charted_into)
         VALUES (13, 1, 2, '2026-09-02T10:03', 'noticed', 'An idea already outlined.', 1);`
    );
    const seedsOn = (filingId) => {
      submissionFormsRender(f.dbPath, filingId, { clientName: "Ashbourne", clientNo: "2417", matterNo: "L4801" });
      return boardDataOf(f.dbPath, filingId, { clientName: "Ashbourne", clientNo: "2417", matterNo: "L4801" }).seeds.map((s) => [s.id, s.from_filing]);
    };

    assert.deepEqual(seedsOn(1), [[10, null], [11, "Reply Submissions Package"], [12, null]], "the sibling's seed shows, labelled; the outlined seed shows nowhere");
    assert.deepEqual(seedsOn(2), [[10, "Opening Submissions Package"], [11, null], [12, null]]);

    await submissionDataExecute(f.dbPath, "UPDATE filings SET decided_on = '2026-09-02', retired_on = '2026-09-10', retirement_reason = 'decided' WHERE id = 2;");
    assert.deepEqual(seedsOn(1), [[10, null], [11, "Reply Submissions Package"], [12, null]], "retiring a filing leaves its open seeds on its siblings' boards");
    assert.deepEqual(seedsOn(2), [[10, "Opening Submissions Package"], [11, null], [12, null]], "and on its own board");

    assert.deepEqual(
      submissionDataQuery(f.dbPath, "SELECT id, filing_id FROM seeds ORDER BY id").rows.map((r) => [r.id, r.filing_id]),
      [[10, 1], [11, 2], [12, null], [13, 2]],
      "rendering reassigns no seed's filing"
    );
  } finally {
    f.cleanup();
  }
});

// Design §13: the Shelved lane is read-only, so no line carries a checkbox,
// a red X, a Go button or any other control. The shell draws step state as list classes, so an
// empty box would be the only box on the board and would read as one.
test("the Milestone's page carries no control -- no input, no button, no click handler", () => {
  const html = renderWorkBoardHtml({ meta: { revision: 1, matter: "", client: "", rendered: "" }, sections: [JSON.parse(readFileSync(goldenPath("work-board-data.json"), "utf-8"))] });

  for (const control of ["<input", "<button", "onclick"]) {
    assert.equal(html.includes(control), false, `expected no ${control} anywhere on the board`);
  }
  // The open-one-card / centring behaviour is not a control and must survive this check.
  assert.ok(html.includes('addEventListener("toggle"'), "expected the open-one-card behaviour intact");
});

test("the Milestone's code is identical across matters once the data line is removed, and carries no matter data", async () => {
  const a = seededDbFixture();
  const b = seededDbFixture();
  try {
    await freshSubmissionDb(a.dbPath);
    await seedVaniacProceeding(a.dbPath);
    await seedTickets(a.dbPath);
    await freshSubmissionDb(b.dbPath);
    await seedBcscDefaultJudgment(b.dbPath);

    const { draft: draftA, leaf: leafA } = draftFolder(a);
    const draftB = draftFolder(b).draft;
    submissionFormsRender(a.dbPath, 1, { clientName: "Ashbourne", clientNo: "2417", matterNo: "L4801" }, "mockup", undefined, undefined, undefined, undefined, undefined, draftA);
    const resultB = submissionFormsRender(b.dbPath, 1, { clientName: "Halloway", clientNo: "9002", matterNo: "L9002" }, "mockup", undefined, undefined, undefined, undefined, undefined, draftB);
    const pageA = join(leafA, "Milestone.html");
    const pageB = resultB.documents.find((d) => d.document_type === "Work_board").path;
    const dataA = writingSection(leafA);
    const codeA = boardCode(readFileSync(pageA, "utf-8"));
    assert.equal(codeA, boardCode(readFileSync(pageB, "utf-8")), "expected identical code across two matters");

    const needles = ["Ashbourne", "Northridge", "L4801", "2417", "Halloway", "Vasey", "L9002", "S-901433", dataA.meta.filing, writingSection(dirname(pageB)).meta.filing];
    for (const ticket of dataA.tickets) needles.push(ticket.title);
    for (const proposal of dataA.proposals) {
      needles.push(proposal.item, proposal.title);
      if (proposal.holder !== null && proposal.holder.ticketed_on !== null) needles.push(proposal.holder.ticketed_on);
    }
    for (const needle of needles) assert.ok(!codeA.includes(needle), `expected no matter data in the board's code, found "${needle}"`);
    assert.notDeepEqual(readBoardData(pageA).meta, readBoardData(pageB).meta, "the per-matter data lines differ");
  } finally {
    a.cleanup();
    b.cleanup();
  }
});

test("a filing with entered_on reads Entered on the board, with no ready-to-retire notice", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedVaniacProceeding(f.dbPath);
    // Decided, then entered (schema v19). No appeal deadline is supplied and the
    // filing is not retired, so "entered" is the state the derivation must reach.
    await submissionDataExecute(
      f.dbPath,
      "UPDATE filings SET decided_on = '2026-09-02', entered_on = '2026-09-19' WHERE id = 1;"
    );

    submissionFormsRender(f.dbPath, 1, { clientName: "Ashbourne", clientNo: "2417", matterNo: "L4801" });
    const { meta } = boardDataOf(f.dbPath, 1, { clientName: "Ashbourne", clientNo: "2417", matterNo: "L4801" });

    assert.deepEqual(
      [meta.state, meta.state_label, meta.state_since],
      ["entered", "Entered", "2026-09-19"],
      "expected the board's state to read Entered, dated by the entry rather than the decision"
    );
    // readyToRetire is exclusive to appeal_expired: entry neither starts nor
    // stands in for the appeal period running out.
    assert.equal(meta.ready_to_retire, false, "expected no ready-to-retire notice on an entered filing");
  } finally {
    f.cleanup();
  }
});

test("render refuses mockup mode on a retired filing, writing nothing but returning the board's real state as its summary", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedVaniacProceeding(f.dbPath);
    await submissionDataExecute(
      f.dbPath,
      "UPDATE filings SET decided_on = '2026-09-02', retired_on = '2026-09-10', retirement_reason = 'decided' WHERE id = 1;"
    );

    const result = submissionFormsRender(f.dbPath, 1, { clientName: "Ashbourne", clientNo: "2417", matterNo: "L4801" });

    assert.equal(result.filing_retired, true, "expected filing_retired: true");
    assert.equal(result.documents.length, 1, "expected exactly the Milestone document");
    const board = result.documents[0];
    assert.equal(board.document_type, "Work_board");
    assert.equal(board.path, undefined, "expected no path -- nothing was written to disk");
    // The whole point of returning the board here is so the retire flow can confirm
    // the state actually reads Retired.
    // Goal card design §2.9: a retired filing's card names the retirement and carries no criteria,
    // so the summary prints the State line in place of the two criteria lists.
    const [header, todo, goal, state, ...rest] = board.board_summary.split("\n");
    assert.match(header, /^# Milestone — Matter L4801 · Client Ashbourne \(2417\) · Rev \d+$/);
    assert.equal(todo, "To Do: This matter's to-dos were not read.");
    assert.equal(goal, "Goal: Goal not set (none)", "no statement of goals is stored, so the board's default reads none");
    assert.equal(state, "State: Retired 2026-09-10 — Retired on 2026-09-10 — decided", "expected the board's own state to read Retired");
    assert.deepEqual(rest, [], "no criteria and no lane");
    assert.equal(board.board_summary.includes("🎯"), false);
    assert.equal(board.markdown, undefined, "the board returns no markup");
  } finally {
    f.cleanup();
  }
});

test("render writes the board as one self-contained file, with no sibling support files", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedVaniacProceeding(f.dbPath);

    const { draft } = draftFolder(f);
    const result = submissionFormsRender(f.dbPath, 1, { clientName: "Ashbourne", clientNo: "2417", matterNo: "L4801" }, "mockup", undefined, undefined, undefined, undefined, undefined, draft);

    const board = result.documents.find((d) => d.document_type === "Work_board");
    assert.equal(board.file_name, "Milestone.html");
    assert.ok(!existsSync(join(dirname(board.path), "workboard-data.js")), "expected no data script beside the board");
    for (const doc of result.documents) assert.equal("assets" in doc, false, `the board has no support files to return (${doc.document_type})`);

    // Design section 7 (2026-09-08): system fonts (the pane may be offline, and
    // a fetch would leak), and both dark selectors kept. Since 2026-09-15 one vertical list at every
    // width: no width breakpoint, and the card stack is never a grid.
    assert.doesNotMatch(WORKBOARD_CSS, /@import|fonts\.googleapis/, "expected no web-font fetch in the stylesheet");
    assert.match(WORKBOARD_CSS, /@media \(prefers-color-scheme: dark\)\{:root:not\(\[data-theme="light"\]\)\{/);
    assert.match(WORKBOARD_CSS, /:root\[data-theme="dark"\]\{/);
    assert.doesNotMatch(WORKBOARD_CSS, /min-width|max-width:\s*\d+px\)/, "expected no width breakpoint");
    assert.doesNotMatch(WORKBOARD_CSS, /\.stack\{[^}]*grid|\.board\{[^}]*grid/, "expected cards and sections never laid out as a grid");
    assert.match(WORKBOARD_CSS, /@media print/);
    // A chat file card is a lone copy (#551): the page loads nothing, so nothing can fail to resolve.
    const html = readFileSync(board.path, "utf-8");
    assert.doesNotMatch(html, /fetch\(|XMLHttpRequest/);
    assert.doesNotMatch(html, /<script src=|<link /, "expected no external script or stylesheet");
    assert.ok(html.includes(`<style>\n${WORKBOARD_CSS}</style>`), "expected the stylesheet inline");
    assert.ok(html.includes(`<script>\n${WORKBOARD_JS}</script>`), "expected the behaviour script inline");

    for (const name of ["workboard.css", "workboard.js"]) assert.ok(!existsSync(join(draft, name)), `expected no ${name} in the draft folder`);
  } finally {
    f.cleanup();
  }
});

test("the print block's display rule names the Goal card's criteria and item lists beside the ticket and seed bodies (#911)", () => {
  const print = WORKBOARD_CSS.slice(WORKBOARD_CSS.indexOf("@media print{"));
  const rule = print.match(/([^{}]*)\{[^{}]*display:flex[^{}]*\}/);
  assert.ok(rule, "expected a display:flex rule in the print block");
  const selectors = rule[1].split(",").map((s) => s.trim());
  for (const s of ["details.ticket>.body", "details.seed>.body", "details.goal>ul.criteria", "details.items>ul.items"]) assert.ok(selectors.includes(s), `expected print to open ${s}`);
});

test("the print block keeps the Goal card whole across a page break (#916)", () => {
  const print = WORKBOARD_CSS.slice(WORKBOARD_CSS.indexOf("@media print{"));
  const rule = [...print.matchAll(/([^{}]*)\{[^{}]*break-inside:avoid[^{}]*\}/g)].find((m) => m[1].includes("details.ticket"));
  assert.ok(rule, "expected the card rule with break-inside:avoid in the print block");
  const selectors = rule[1].split(",").map((s) => s.trim());
  for (const s of ["details.ticket", "details.seed", "details.goal"]) assert.ok(selectors.includes(s), `expected ${s} kept whole in print`);
});

// A closed <details> hides its body from print whatever the CSS says, so the script opens every card
// for printing and puts each back afterwards (#916). Runs WORKBOARD_JS against stand-in elements.
test("printing opens every ticket, seed and Goal card and every criterion's item list, and afterprint restores each one's state (#916)", async () => {
  const { runInNewContext } = await import("node:vm");
  // Like the browser, opening a card closes every other open card sharing its name attribute.
  const all = [];
  const card = (cls, open, name) => {
    let isOpen = open;
    const attrs = name ? { name } : {};
    const d = {
      cls, attrs, listeners: {},
      get open() { return isOpen; },
      set open(v) {
        if (v && attrs.name) for (const o of all) if (o !== d && o.attrs.name === attrs.name) o.close();
        isOpen = v;
      },
      close: () => { isOpen = false; },
      getAttribute: (k) => (k in attrs ? attrs[k] : null),
      setAttribute: (k, v) => { attrs[k] = v; },
      removeAttribute: (k) => { delete attrs[k]; },
      addEventListener: (type, fn) => { d.listeners[type] = fn; }, matches: () => true, scrollIntoView: () => {},
    };
    all.push(d);
    return d;
  };
  for (const [cls, open, name] of [["ticket", true, "board"], ["ticket", false, "board"], ["seed", false, "board"], ["goal", false, null], ["items", false, null], ["items", true, null]]) card(cls, open, name);
  const windowListeners = {};
  const byClass = (sel) => all.filter((d) => sel.split(",").some((s) => s.trim() === `details.${d.cls}`));
  runInNewContext(WORKBOARD_JS, {
    document: { querySelectorAll: byClass, querySelector: () => null },
    matchMedia: () => ({ matches: false }),
    requestAnimationFrame: (fn) => fn(),
    location: { hash: "" },
    addEventListener: (type, fn) => { windowListeners[type] = fn; },
  });
  assert.equal(typeof windowListeners.beforeprint, "function", "expected a beforeprint listener");
  assert.equal(typeof windowListeners.afterprint, "function", "expected an afterprint listener");

  const before = all.map((d) => d.open);
  windowListeners.beforeprint();
  assert.deepEqual(all.map((d) => d.open), all.map(() => true), "expected every card open for print");
  // The browser fires toggle for each card the script opened; the accordion must not close the rest.
  for (const d of all) d.listeners.toggle?.();
  assert.deepEqual(all.map((d) => d.open), all.map(() => true), "expected the accordion to stand aside while printing");
  windowListeners.afterprint();
  assert.deepEqual(all.map((d) => d.open), before, "expected each card back in its pre-print state");
  assert.deepEqual(all.map((d) => d.getAttribute("name")), ["board", "board", "board", null, null, null], "expected each card's name restored");
});

test("the pill ink meets WCAG AA text contrast on the pill in every theme block (#911)", () => {
  const luminance = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const blocks = [...WORKBOARD_CSS.matchAll(/--pill-bg:(#[0-9A-Fa-f]{6});--pill-ink:(#[0-9A-Fa-f]{6})/g)];
  assert.equal(blocks.length, 3, "expected the pill pair in the light, prefers-dark and data-theme dark blocks");
  for (const [, bg, ink] of blocks) {
    assert.equal(bg, "#BA802B", "the pill background stays the shared amber");
    const [hi, lo] = [luminance(bg), luminance(ink)].sort((a, b) => b - a);
    const ratio = (hi + 0.05) / (lo + 0.05);
    assert.ok(ratio >= 4.5, `expected ${ink} on ${bg} at least 4.5:1, got ${ratio.toFixed(2)}:1`);
  }
});

test("ticket text containing a closing script tag cannot break out of the board's data block", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedVaniacProceeding(f.dbPath);
    await seedTickets(f.dbPath);
    const title = "Reply </script><script>window.PWNED = 1</script> <!-- on attornment";
    await submissionDataExecute(f.dbPath, `UPDATE tickets SET title = '${title}' WHERE id = 2;`);

    const { draft, leaf } = draftFolder(f);
    submissionFormsRender(f.dbPath, 1, { clientName: "Ashbourne", clientNo: "2417", matterNo: "L4801" }, "mockup", undefined, undefined, undefined, undefined, undefined, draft);
    const html = readFileSync(join(leaf, "Milestone.html"), "utf-8");

    const [dataLine] = boardDataLines(html);
    assert.ok(!dataLine.includes("<"), "expected every < on the data line escaped");
    assert.equal(ticketIn(writingSection(leaf), 2).title, title, "the title survives the escape intact");
    assert.equal(boardCode(html), boardCode(renderWorkBoardHtml({ meta: {}, sections: [] })), "the code around the data line is unchanged");
  } finally {
    f.cleanup();
  }
});

test("render's documents filter trims the response without changing what is written to disk", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedVaniacProceeding(f.dbPath);

    const full = submissionFormsRender(f.dbPath, 1, {}, "mockup");
    const boardOnly = submissionFormsRender(f.dbPath, 1, {}, "mockup", ["Work_board"]);

    assert.ok(full.documents.length > 1, "fixture should render several documents");
    assert.deepEqual(boardOnly.documents.map((d) => d.document_type), ["Work_board"]);
    assert.equal(boardOnly.rendered_at !== undefined, true, "a filtered render is still a mockup render");

    // Every document is still rendered and still written to its canonical path -- only the
    // response shrinks, so the unrequested mockups never go stale at an old revision.
    for (const doc of full.documents.filter((d) => d.document_type !== "Work_board")) assert.ok(existsSync(doc.path), `expected ${doc.path} to exist`);

    assert.throws(
      () => submissionFormsRender(f.dbPath, 1, {}, "mockup", ["Nonexistent_doc"]),
      /no Nonexistent_doc/,
      "an unrecognised document_type must fail loudly, not return nothing"
    );
  } finally {
    f.cleanup();
  }
});

test("render discards a stale Markdown Work Board left by an older bundle", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedVaniacProceeding(f.dbPath);

    const first = submissionFormsRender(f.dbPath, 1, { clientName: "Ashbourne", clientNo: "2417", matterNo: "L4801" });
    const baseDir = dirname(first.documents[0].path);
    const stale = join(baseDir, "Work Board.md");
    writeFileSync(stale, "Revision: 1\n\n# Work Board\n", "utf-8");

    submissionFormsRender(f.dbPath, 1, { clientName: "Ashbourne", clientNo: "2417", matterNo: "L4801" });
    assert.equal(existsSync(stale), false, "expected the superseded Markdown board discarded");
    assert.equal(readdirSync(baseDir).some((name) => name.endsWith(".html")), false, "no board is written beside the database (#1365)");
  } finally {
    f.cleanup();
  }
});

// #966: the presentation folder holds the same leftover. Only a stamped one is the renderer's own there.
test("render discards a stamped Markdown Work Board from the presentation folder and keeps an unstamped one", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedVaniacProceeding(f.dbPath);
    const { leaf } = draftFolder(f);
    submissionFormsRender(f.dbPath, 1, ASHBOURNE, "mockup", undefined, undefined, leaf);
    const stale = join(leaf, "Work Board.md");
    writeFileSync(stale, "Revision: 1\n\n# Work Board\n", "utf-8");

    submissionFormsRender(f.dbPath, 1, ASHBOURNE, "mockup", undefined, undefined, leaf);
    assert.equal(existsSync(stale), false, "expected the superseded Markdown board discarded from the presentation folder");
    assert.equal(existsSync(join(leaf, "Milestone.html")), true, "the filing's Milestone page is written beside it, in its Writing folder");

    const own = "the practitioner's own notes\n";
    writeFileSync(stale, own, "utf-8");
    submissionFormsRender(f.dbPath, 1, ASHBOURNE, "mockup", undefined, undefined, leaf);
    assert.equal(readFileSync(stale, "utf-8"), own, "expected an unstamped Work Board.md kept as the practitioner's");
  } finally {
    f.cleanup();
  }
});

// Decision 3 (2026-09-15): renders delete the files the split board left behind -- fixed names only,
// never inside archive/. Since spec 2026-10-22 the Writing's folder holds its own Milestone page and no other board.
test("render deletes leftover board support files and data scripts, leaving archive/ untouched, and writes only the Writing's own page in its folder", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedVaniacProceeding(f.dbPath);
    const { draft, leaf } = draftFolder(f);

    const first = submissionFormsRender(f.dbPath, 1, ASHBOURNE, "mockup", undefined, undefined, leaf);
    const baseDir = dirname(first.documents[0].path);
    const archivedPair = join(baseDir, "archive", "Work_board @rev0 2026-09-14-10-00");
    mkdirSync(archivedPair, { recursive: true });
    const keep = [join(archivedPair, "Work Board.html"), join(archivedPair, "workboard-data.js"), join(baseDir, "archive", "workboard.css")];
    for (const file of keep) writeFileSync(file, "archived\n", "utf-8");
    const stale = [
      join(draft, "workboard.css"),
      join(draft, "workboard.js"),
      join(leaf, "workboard-data.js"),
    ];
    for (const file of stale) writeFileSync(file, "/* stale */\n", "utf-8");

    submissionFormsRender(f.dbPath, 1, ASHBOURNE, "mockup", undefined, undefined, leaf);

    for (const file of stale) assert.ok(!existsSync(file), `expected ${file} deleted`);
    for (const file of keep) assert.equal(readFileSync(file, "utf-8"), "archived\n", `expected ${file} untouched`);
    assert.deepEqual(readdirSync(join(baseDir, "archive")).sort(), ["Work_board @rev0 2026-09-14-10-00", "workboard.css"], "nothing archived at an unchanged revision");
    assert.ok(readdirSync(leaf).includes("Milestone.html"), "the Writing's folder holds its own Milestone page");
    assert.equal(readdirSync(leaf).some((name) => /^Work Board/.test(name)), false, "and no other board");
  } finally {
    f.cleanup();
  }
});

test("ticket writes do not move the mockup revision or archive the mockup", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedVaniacProceeding(f.dbPath);

    const first = submissionFormsRender(f.dbPath, 1, { clientName: "Ashbourne", clientNo: "2417", matterNo: "L4801" });
    const baseDir = dirname(first.documents[0].path);

    await seedTickets(f.dbPath);

    const second = submissionFormsRender(f.dbPath, 1, { clientName: "Ashbourne", clientNo: "2417", matterNo: "L4801" });
    assert.equal(second.revision, first.revision, "expected ticket writes to leave db_meta.revision untouched");
    assert.ok(!existsSync(join(baseDir, "archive")), "expected no archive directory -- ticket writes must not trigger mockup archiving");
  } finally {
    f.cleanup();
  }
});

// Goal card design §2.2, §2.7 and §4.4 (Phase 2 of planning/2. Plan/2026-09-21_goal-card-and-
// prepare-implementation-plan.md): the collector names each entry's document, records the glyphs a
// criterion counts although they never generate, and derives the unrated-authority Proposal.

/** Filing `filingId`'s render manifest, in its matter's `0. DRAFT\Drafting records\` (spec 2026-10-22 §9). */
function manifestFileOf(dbPath, filingId) {
  return join(dirname(dirname(dbPath)), "0. DRAFT", "Drafting records", `render-manifest-${filingId}.json`);
}

/** The inventory the render saved in the filing's render manifest, as proposal-inventory.db.test.mjs
 * reads it. */
function inventoryOf(result) {
  const advocacy = result.documents.find((d) => d.document_type !== "Work_board");
  return JSON.parse(readFileSync(join(dirname(dirname(advocacy.path)), "Drafting records", `render-manifest-${result.filing_id}.json`), "utf-8")).inventory;
}

/** seedBcscDefaultJudgment's proceeding as a Notice of Application with no hearing_details row, so
 * the form prints its time estimate as 🧩 and its associate-judge sentence as ⬜. Its stored layout
 * is the one the v30 backfill writes, unless `snapshot` is false (a database not yet at v30). */
async function seedNoticeOfApplication(dbPath, { snapshot = true } = {}) {
  // A database not yet at v30 has no case_party_id either; the v30 test links after migrating.
  await seedBcscDefaultJudgment(dbPath, { link: snapshot });
  await submissionDataExecute(dbPath, "UPDATE filings SET kind = 'notice_of_application', subkind = NULL, title = 'Notice of Application' WHERE id = 1;");
  if (snapshot) await snapshotFromShipped(dbPath, 1, "notice-of-application");
}

const SHIPPED_BC = new URL("../../../../.claude/skills/draft/references/CAN/BC/", import.meta.url);

/** The layout block of a shipped /draft file under CAN/BC. */
function shippedBlock(rel) {
  const text = readFileSync(new URL(rel, SHIPPED_BC), "utf-8").replace(/\r\n/g, "\n");
  return JSON.parse(/^```json\n([\s\S]*?)\n```$/m.exec(text)[1]);
}

/** The stored layout the v30 backfill writes on a BCSC Writing (filing-checklists.md §13): the
 * shipped type block and venue block, verbatim, citing nothing. The Milestone reads its criteria
 * from it, never from the kind. */
async function snapshotFromShipped(dbPath, filingId, typeFile) {
  const stored = { layout: shippedBlock(`BCSC/Documents/${typeFile}.md`), venue: shippedBlock("BCSC/venue.md"), passage_hashes: {} };
  await submissionDataWrite(dbPath, "UPDATE filings SET layout_snapshot = ? WHERE id = ?", [JSON.stringify(stored), filingId]);
}

// The reserve inventory's entries carry a never-delivered doc tag of their own, which no rendered
// document carries (render-work-board.ts RESERVE_INVENTORY_DOC).
test("every inventory entry names the rendered document that emitted it, or the reserve inventory", async () => {
  for (const seed of [seedVaniacProceeding, seedNoticeOfApplication]) {
    const f = seededDbFixture();
    try {
      await freshSubmissionDb(f.dbPath);
      await seed(f.dbPath);
      const result = submissionFormsRender(f.dbPath, 1, ASHBOURNE);
      const inventory = inventoryOf(result);
      const rendered = new Set(result.documents.map((d) => d.document_type).filter((t) => t !== "Work_board"));

      assert.ok(inventory.length > 0, `${seed.name}: expected the render to record entries`);
      for (const e of inventory) {
        assert.ok(typeof e.doc === "string" && e.doc !== "", `${seed.name}: expected a document on ${JSON.stringify(e)}`);
        assert.ok(rendered.has(e.doc) || e.doc === RESERVE_INVENTORY_DOC, `${seed.name}: ${e.doc} is not a document this render produced`);
      }
      assert.ok(new Set(inventory.map((e) => e.doc)).size > 1, `${seed.name}: expected entries from more than one document`);
    } finally {
      f.cleanup();
    }
  }
});

test("a line printing 🧩 records a non-generating entry and derives no Proposal", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedNoticeOfApplication(f.dbPath);

    const result = submissionFormsRender(f.dbPath, 1, ASHBOURNE);
    const noa = result.documents.find((d) => d.document_type === "Notice_of_application");
    assert.match(noa.markdown, /^The applicant estimates that the application will take: 🧩$/m, "the fixture line prints 🧩");

    const inventory = inventoryOf(result);
    assert.deepEqual(
      inventory.filter((e) => e.marker === "🧩"),
      [{ generating: false, marker: "🧩", table: "form_fields", id: 2, item: "Time estimate", doc: "Notice_of_application" }]
    );
    // ⬜ carries its instance, which is how the Orders criterion tells it from the other ⬜s.
    assert.deepEqual(
      inventory.filter((e) => e.marker === "⬜"),
      [{ generating: false, marker: "⬜", instance: "associate-judge", table: "filings", id: 1, item: "Associate judge jurisdiction", doc: "Notice_of_application" }]
    );

    const { proposals } = boardDataOf(f.dbPath, 1, ASHBOURNE);
    assert.ok(proposals.length > 0, "the render still derives its other Proposals");
    for (const glyph of ["🧩", "⬜"]) assert.ok(!proposals.some((p) => p.marker === glyph), `${glyph} derives no Proposal`);
  } finally {
    f.cleanup();
  }
});

// #1219: every blank field on one bespoke form is its own open item, as #1213 made each general
// Writing's gap its own. Keyed on the filing alone, the Work Board merged them into one.
const NOA_GAPS = ["Name of applicant", "Parties to be served", "Time estimate"];
const AR_GAPS = [
  "Name of application respondent",
  "Name of applicant",
  "Date of the notice of application",
  "Time estimate",
  "Whether the application respondent agrees with the applicant's hearing date",
];

/** The open-items criterion of the filing just rendered, with its items narrowed to the form's own blank fields. */
function openGaps(dbPath, gaps) {
  const openItems = criterionOf(boardDataOf(dbPath, 1, ASHBOURNE), "open-items");
  assert.equal(openItems.outstanding, openItems.items.length, "outstanding counts every open item");
  return { ...openItems, gaps: openItems.items.filter((item) => gaps.includes(item)) };
}

test("each blank field on a Notice of Application and an Application Response is its own open item, and filling one removes only it (#1219)", async () => {
  const cases = [
    {
      seed: seedNoticeOfApplication,
      gaps: NOA_GAPS,
      blank: "UPDATE parties SET is_applicant = 0, is_client = 0, to_be_served = 0;",
      fill: ["UPDATE parties SET to_be_served = 1 WHERE id = (SELECT MIN(id) FROM parties);", "Parties to be served"],
      fillRest: "UPDATE parties SET is_applicant = 1 WHERE id = (SELECT MIN(id) FROM parties); INSERT INTO hearing_details (filing_id, time_estimate_minutes) VALUES (1, 30);",
    },
    {
      seed: async (dbPath) => {
        await seedApplicationResponse(dbPath);
        await snapshotFromShipped(dbPath, 1, "application-response");
      },
      gaps: AR_GAPS,
      blank:
        "UPDATE parties SET is_client = 0, is_applicant = 0; DELETE FROM hearing_details WHERE filing_id = 1;" +
        " UPDATE documents SET document_date = NULL WHERE id IN (SELECT document_id FROM opposing_orders);",
      fill: ["INSERT INTO hearing_details (filing_id, time_estimate_minutes) VALUES (1, 30);", "Time estimate"],
      fillRest:
        "UPDATE parties SET is_client = 1 WHERE id = (SELECT MIN(id) FROM parties); UPDATE parties SET is_applicant = 1 WHERE id = (SELECT MAX(id) FROM parties);" +
        " UPDATE documents SET document_date = '2026-09-01' WHERE id IN (SELECT document_id FROM opposing_orders);" +
        " UPDATE hearing_details SET hearing_date_position = 'none_proposed' WHERE filing_id = 1;",
    },
  ];
  for (const { seed, gaps, blank, fill: [fillSql, filled], fillRest } of cases) {
    const f = seededDbFixture();
    try {
      await freshSubmissionDb(f.dbPath);
      await seed(f.dbPath);
      await submissionDataExecute(f.dbPath, blank);

      const blankRender = submissionFormsRender(f.dbPath, 1, ASHBOURNE);
      const gapEntries = inventoryOf(blankRender).filter((e) => e.marker === "🧩");
      const all = openGaps(f.dbPath, gaps);
      assert.deepEqual(all.gaps, gaps, `${seed.name}: every blank field is its own item`);
      assert.equal(all.state, "unmet");

      await submissionDataExecute(f.dbPath, fillSql);
      submissionFormsRender(f.dbPath, 1, ASHBOURNE);
      const one = openGaps(f.dbPath, gaps);
      assert.deepEqual(one.gaps, gaps.filter((g) => g !== filled), `${seed.name}: filling ${filled} removes only its item`);
      assert.equal(one.outstanding, all.outstanding - 1);
      assert.equal(one.state, "unmet");

      await submissionDataExecute(f.dbPath, fillRest);
      submissionFormsRender(f.dbPath, 1, ASHBOURNE);
      const none = openGaps(f.dbPath, gaps);
      assert.deepEqual(none.gaps, [], `${seed.name}: no blank field is left`);
      assert.equal(none.outstanding, all.outstanding - gaps.length);
      assert.deepEqual(none.items, all.items.filter((item) => !gaps.includes(item)), `${seed.name}: only the non-gap items remain`);
      assert.equal(none.state, "unmet", `${seed.name}: the fixture's other open items keep it unmet`);

      // The fixtures carry other open items, so the gap entries alone decide the state here.
      const onlyGaps = criterionOf(boardWithInventory(f.dbPath, gapEntries), "open-items");
      assert.deepEqual([onlyGaps.state, onlyGaps.outstanding, onlyGaps.items], ["unmet", gaps.length, gaps]);
      const noGaps = criterionOf(boardWithInventory(f.dbPath, []), "open-items");
      assert.deepEqual([noGaps.state, noGaps.outstanding], ["met", 0]);
    } finally {
      f.cleanup();
    }
  }
});

// Schema v48: a contention counsel has recorded as needing no stated fact raises no 🧾, so it leaves
// no open item. The fixture carries other open items, so the submission's own entries alone decide
// the state here, as in the #1219 test above.
test("a submission counsel has recorded as needing no stated fact leaves the open-items criterion met (v48)", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedNoticeOfApplication(f.dbPath);
    await submissionDataExecute(
      f.dbPath,
      `INSERT INTO submissions (id, proceeding_id, contention, ordinal) VALUES (1, 1, 'The court has jurisdiction to make the order.', 1);
       INSERT INTO filing_submissions (filing_id, submission_id, document, ordinal) VALUES (1, 1, 'form', 1), (1, 1, 'written_argument', 1);
       INSERT INTO law_assertions (id, proceeding_id, proposition, dead_end) VALUES (1, 1, 'The statute confers the jurisdiction.', 0);
       INSERT INTO submission_law (submission_id, law_assertion_id) VALUES (1, 1);`
    );
    const ownEntries = () => inventoryOf(submissionFormsRender(f.dbPath, 1, ASHBOURNE)).filter((e) => e.table === "submissions" && e.id === 1);

    const undecided = criterionOf(boardWithInventory(f.dbPath, ownEntries()), "open-items");
    assert.deepEqual([undecided.state, undecided.items], ["unmet", ["The court has jurisdiction to make the order."]]);

    await submissionDataExecute(
      f.dbPath,
      `UPDATE submissions SET no_facts_needed_on = '2026-10-04', no_facts_needed_note = 'Jurisdiction is a question of law on the statute''s face.',
                              no_facts_needed_contention = contention WHERE id = 1;`
    );
    const entries = ownEntries();
    assert.ok(!entries.some((e) => e.marker === "🧾"), JSON.stringify(entries));
    const decided = criterionOf(boardWithInventory(f.dbPath, entries), "open-items");
    assert.deepEqual([decided.state, decided.outstanding], ["met", 0]);
  } finally {
    f.cleanup();
  }
});

// Schema v60: 📚, the law-side twin of 🧾, counts toward open-items until a proposition is linked or
// counsel records that the contention needs no stated law.
test("a submission with no linked proposition counts as one open item until a proposition is linked or counsel records none is needed (v60)", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedNoticeOfApplication(f.dbPath);
    await submissionDataExecute(
      f.dbPath,
      `INSERT INTO submissions (id, proceeding_id, contention, ordinal) VALUES (1, 1, 'The respondent breached the agreement.', 1);
       INSERT INTO filing_submissions (filing_id, submission_id, document, ordinal) VALUES (1, 1, 'form', 1), (1, 1, 'written_argument', 1);
       INSERT INTO facts (id, proceeding_id, postulate) VALUES (1, 1, 'The respondent did not deliver the goods.');
       INSERT INTO submission_facts (submission_id, fact_id) VALUES (1, 1);`
    );
    const ownEntries = () => inventoryOf(submissionFormsRender(f.dbPath, 1, ASHBOURNE)).filter((e) => e.table === "submissions" && e.id === 1);

    const open = ownEntries();
    assert.deepEqual(
      open.filter((e) => e.slug === "proposition" && e.marker === "📚").map((e) => e.doc),
      ["Notice_of_application", "Written_arguments", "Counsel_brief"],
      JSON.stringify(open)
    );
    const unlinked = criterionOf(boardWithInventory(f.dbPath, open), "open-items");
    assert.deepEqual([unlinked.state, unlinked.items], ["unmet", ["The respondent breached the agreement."]]);

    await submissionDataExecute(
      f.dbPath,
      `UPDATE submissions SET no_law_needed_on = '2026-10-06', no_law_needed_note = 'The breach is admitted on the pleadings.',
                              no_law_needed_contention = contention WHERE id = 1;`
    );
    const recorded = ownEntries();
    assert.ok(!recorded.some((e) => e.marker === "📚"), JSON.stringify(recorded));
    assert.deepEqual(criterionOf(boardWithInventory(f.dbPath, recorded), "open-items").state, "met");

    await submissionDataExecute(
      f.dbPath,
      `UPDATE submissions SET no_law_needed_on = NULL, no_law_needed_note = NULL, no_law_needed_contention = NULL WHERE id = 1;
       INSERT INTO law_assertions (id, proceeding_id, proposition, dead_end) VALUES (1, 1, 'A party who fails to perform is in breach.', 0);
       INSERT INTO submission_law (submission_id, law_assertion_id) VALUES (1, 1);`
    );
    const linked = ownEntries();
    assert.ok(!linked.some((e) => e.marker === "📚"), JSON.stringify(linked));
    assert.deepEqual(criterionOf(boardWithInventory(f.dbPath, linked), "open-items").state, "met");
  } finally {
    f.cleanup();
  }
});

// The two senses of "loose thread" stay apart: the 🧵 work marker on the mockup counts toward open
// items, and a captured idea in the Loose Threads lane counts toward no criterion.
test("a 🧵 marker counts as one open item and a captured loose thread counts as none, listed in the loose threads lane", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedNoticeOfApplication(f.dbPath);
    await submissionDataExecute(
      f.dbPath,
      "INSERT INTO seeds (id, proceeding_id, filing_id, created, surfaced_by, idea) VALUES (1, 1, 1, '2026-09-20 09:30', 'noticed', 'Is the guarantor a party?');"
    );
    const thread = inventoryOf(submissionFormsRender(f.dbPath, 1, ASHBOURNE)).find((e) => e.slug === "loose-thread" && e.marker === "🧵");
    assert.ok(thread, "the Notice of Application prints a 🧵");

    const data = boardWithInventory(f.dbPath, [thread]);
    const openItems = criterionOf(data, "open-items");
    assert.deepEqual([openItems.state, openItems.outstanding, openItems.items.length], ["unmet", 1, 1]);
    assert.equal(data.seeds.length, 1, "the captured idea is on the board");

    const card = submissionFormsBoardCard({ db_path: f.dbPath, filing_id: 1, lanes: ["criteria", "loose_threads"] }, ASHBOURNE, GOAL_NOW).card;
    assert.match(card, /^- \S+ open-items: .*\(unmet 1, met 0, total 1\)/m);
    assert.match(card, /^## Loose Threads \(1\)\n- loose thread 1: "Is the guarantor a party\?" \(noticed\) · unranked$/m);
  } finally {
    f.cleanup();
  }
});

test("one unrated authority with two statements yields exactly one authority-rating Proposal", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedNoticeOfApplication(f.dbPath);
    await submissionDataExecute(
      f.dbPath,
      `INSERT INTO authorities (id, proceeding_id, style_of_cause_or_title, citation, kind, treatment)
         VALUES (1, 1, 'Unrated Authority v. Example', '2020 BCSC 1', 'case', 'good_law');
       INSERT INTO law_assertions (id, proceeding_id, proposition, dead_end)
         VALUES (1, 1, 'a proposition resting on one unrated authority', 0);
       -- Both statements are captured and verified, with no source rating, so each statement line
       -- prints 🏅 alone and the proposition line rolls them up to 🏅.
       INSERT INTO statements_of_law (id, proceeding_id, law_assertion_id, authority_id, pinpoint, excerpt, source, verification)
         VALUES
           (1, 1, 1, 1, 'para 3', 'The first passage.', NULL, 'verified'),
           (2, 1, 1, 1, 'para 9', 'The second passage.', NULL, 'verified');
       INSERT INTO submissions (id, proceeding_id, contention, ordinal) VALUES (1, 1, 'The applicant is entitled to the order.', 1);
       INSERT INTO submission_law (submission_id, law_assertion_id) VALUES (1, 1);
       INSERT INTO filing_submissions (filing_id, submission_id, document, ordinal) VALUES (1, 1, 'form', 1);`
    );

    const result = submissionFormsRender(f.dbPath, 1, ASHBOURNE);
    const inventory = inventoryOf(result);
    const onForm = inventory.filter((e) => e.slug === "authority-rating" && e.doc === "Notice_of_application");
    assert.equal(onForm.length, 2, "each statement line on the form records its own 🏅");
    assert.ok(onForm.every((e) => e.generating === true && e.table === "authorities" && e.id === 1));

    const ratings = boardDataOf(f.dbPath, 1, ASHBOURNE).proposals.filter((p) => p.slug === "authority-rating");
    assert.deepEqual(
      ratings.map((p) => ({ key: p.key, marker: p.marker, item: p.item, title: p.title, lane: p.lane })),
      [
        {
          key: "authority-rating:authorities:1",
          marker: "🏅",
          item: "Unrated Authority v. Example, 2020 BCSC 1",
          title: "Rate the authority: Unrated Authority v. Example, 2020 BCSC 1",
          lane: "proposed",
        },
      ]
    );
    // The proposition line's roll-up 🏅 is recorded for the Primary authority criterion, and never generates.
    assert.deepEqual(
      inventory.filter((e) => e.marker === "🏅" && e.table === "law_assertions" && e.doc === "Notice_of_application"),
      [{ generating: false, marker: "🏅", instance: "proposition", table: "law_assertions", id: 1, item: "a proposition resting on one unrated authority", doc: "Notice_of_application" }]
    );
  } finally {
    f.cleanup();
  }
});

// Goal card design §2 (Phase 3 of planning/2. Plan/2026-09-21_goal-card-and-prepare-implementation-
// plan.md): the board's goal and criteria, derived in the render call that derives the Proposals.

const GOAL_NOW = "2026-09-20 10:00";
// The rows of a card are the stored layout's goal_criteria, in their declared order, then the one
// universal row no type declares, `gate`, then `hearing-date` where the type declares it. The plan's
// Verify counts ("eight" for the Notice of Application, "nine" for the Application Response) are the
// declared criteria above the gate plus the gate row; the Notice of Application's `hearing-date`
// makes its card nine rows.
const NOA_DECLARED = ["primary-authority", "excerpts", "noting-up", "evidence", "counsel-review", "open-items", "orders-sought"];
const AR_DECLARED = ["orders-positioned", "primary-authority", "excerpts", "noting-up", "evidence", "open-items", "opposing-points", "counsel-review"];
const UNIVERSAL = ["gate"];
const NOA_CRITERIA = [...NOA_DECLARED, ...UNIVERSAL, "hearing-date"];
const NOA_SENTENCE = "Completion Criteria";

function criterionOf(data, id) {
  const criterion = data.criteria.find((c) => c.id === id);
  assert.ok(criterion, `expected a ${id} criterion`);
  return criterion;
}

/** Every criterion's state by id, so one assertion shows the whole card. */
function statesOf(data) {
  return Object.fromEntries(data.criteria.map((c) => [c.id, c.state]));
}

/** Every NOA_CRITERIA id met, bar the ones `overrides` names. */
function allMetBut(overrides) {
  return { ...Object.fromEntries(NOA_CRITERIA.map((id) => [id, "met"])), ...overrides };
}

/** The Notice of Application's board as a stamp hit derives it: a full render saves its inventory,
 * that saved inventory is replaced by `inventory`, and the next render reads it back. This is how a
 * case reaches a glyph no renderer prints yet (🧐), or a card whose every inventory criterion is met. */
function boardWithInventory(dbPath, inventory) {
  const render = () => submissionFormsRender(dbPath, 1, ASHBOURNE, "mockup", undefined, undefined, undefined, GOAL_NOW);
  render();
  const manifestFile = manifestFileOf(dbPath, 1);
  writeFileSync(manifestFile, JSON.stringify({ ...JSON.parse(readFileSync(manifestFile, "utf-8")), inventory }), "utf-8");
  render();
  return boardDataOf(dbPath, 1, ASHBOURNE, GOAL_NOW);
}

/** Inventory entries as the collector records them, on the Notice of Application unless `extra.doc` says otherwise. */
function generatingEntry(slug, marker, table, id, item, extra = {}) {
  return { generating: true, slug, marker, table, id, item, doc: "Notice_of_application", ...extra };
}
function countedEntry(marker, table, id, item, extra = {}) {
  return { generating: false, marker, table, id, item, doc: "Notice_of_application", ...extra };
}

test("goal: an Excerpts criterion is unmet when its only entry is a proposition line's 🔬", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedNoticeOfApplication(f.dbPath);
    // The only statement is an unverified lead, so only the reserve inventory records its own line and
    // the form's proposition line rolls it up to 🔬.
    await submissionDataExecute(
      f.dbPath,
      `INSERT INTO authorities (id, proceeding_id, style_of_cause_or_title, citation, kind, treatment)
         VALUES (1, 1, 'Lead Authority v. Example', '2021 BCSC 2', 'case', 'good_law');
       INSERT INTO law_assertions (id, proceeding_id, proposition, dead_end) VALUES (1, 1, 'a proposition resting only on an unverified lead', 0);
       INSERT INTO statements_of_law (id, proceeding_id, law_assertion_id, authority_id, pinpoint, excerpt, source, verification)
         VALUES (1, 1, 1, 1, 'para 4', 'The lead passage.', 'primary', 'lead');
       INSERT INTO submissions (id, proceeding_id, contention, ordinal) VALUES (1, 1, 'The applicant is entitled to the order.', 1);
       INSERT INTO submission_law (submission_id, law_assertion_id) VALUES (1, 1);
       INSERT INTO filing_submissions (filing_id, submission_id, document, ordinal) VALUES (1, 1, 'form', 1);`
    );

    const result = submissionFormsRender(f.dbPath, 1, ASHBOURNE);
    const inventory = inventoryOf(result);
    assert.deepEqual(
      inventory.filter((e) => e.marker === "🔬").map((e) => [e.generating, e.table, e.doc]),
      [
        [false, "law_assertions", "Notice_of_application"],
        [false, "law_assertions", "Counsel_brief"],
        [true, "statements_of_law", "Counsel_brief"],
      ],
      "the statement line's 🔬 is recorded by the reserve inventory only"
    );

    const data = boardDataOf(f.dbPath, 1, ASHBOURNE);
    assert.deepEqual(data.criteria.map((c) => c.id), NOA_CRITERIA);
    assert.deepEqual(criterionOf(data, "excerpts"), {
      id: "excerpts",
      text: "Every excerpt is quoted, pinpointed and checked",
      state: "unmet",
      outstanding: 1,
      items: ["a proposition resting only on an unverified lead"],
      source: "inventory",
    });
    assert.deepEqual([data.goal.sentence, data.goal.state], [NOA_SENTENCE, "unmet"]);
    assert.equal(data.goal.text, null, "no §2.9 row applies while a drafting criterion other than counsel's review is unmet");
  } finally {
    f.cleanup();
  }
});

// Schema v46: a proposition whose only statement the research lawyer failed reads 📖 again, but
// the next step is counsel's decision on the finding, not new research. Its 📖 is recorded as a
// non-generating proposition instance: no doctrinal-basis Proposal, while Primary authority still
// counts it.
test("goal: a proposition whose only statement failed scrutiny prints 📖, proposes no doctrinal basis, and keeps Primary authority unmet", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedNoticeOfApplication(f.dbPath);
    await submissionDataExecute(
      f.dbPath,
      `INSERT INTO authorities (id, proceeding_id, style_of_cause_or_title, citation, kind, treatment)
         VALUES (1, 1, 'Failed Authority v. Example', '2021 BCSC 3', 'case', 'good_law');
       INSERT INTO law_assertions (id, proceeding_id, proposition, dead_end) VALUES (1, 1, 'a proposition whose only statement failed scrutiny', 0);
       INSERT INTO statements_of_law (id, proceeding_id, law_assertion_id, authority_id, pinpoint, excerpt, source, doubt, verification)
         VALUES (1, 1, 1, 1, 'para 4', 'The failed passage.', 'primary', 'Scrutiny failed 2026-10-02: fit failed.', 'failed');
       INSERT INTO submissions (id, proceeding_id, contention, ordinal) VALUES (1, 1, 'The applicant is entitled to the order.', 1);
       INSERT INTO submission_law (submission_id, law_assertion_id) VALUES (1, 1);
       INSERT INTO filing_submissions (filing_id, submission_id, document, ordinal) VALUES (1, 1, 'form', 1);`
    );

    const result = submissionFormsRender(f.dbPath, 1, ASHBOURNE);
    assert.match(result.documents.find((d) => d.document_type === "Notice_of_application").markdown, /a proposition whose only statement failed scrutiny .*📖/);
    assert.deepEqual(
      inventoryOf(result).filter((e) => e.marker === "📖").map((e) => [e.generating, e.instance, e.table, e.id, e.doc]),
      [
        [false, "proposition", "law_assertions", 1, "Notice_of_application"],
        [false, "proposition", "law_assertions", 1, "Counsel_brief"],
      ],
      "📖 prints on both documents and generates on neither"
    );

    const data = boardDataOf(f.dbPath, 1, ASHBOURNE);
    assert.equal(data.proposals.some((p) => p.key === "doctrinal-basis:law_assertions:1"), false, "no doctrinal-basis Proposal while the finding awaits counsel");
    assert.deepEqual(criterionOf(data, "primary-authority"), {
      id: "primary-authority",
      text: "Every proposition of law rests on primary authority",
      state: "unmet",
      outstanding: 1,
      items: ["a proposition whose only statement failed scrutiny"],
      source: "inventory",
    });
  } finally {
    f.cleanup();
  }
});

test("goal: a statement printing 📜 📍 counts once, at its current rung, and shelving that rung meets Excerpts", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedNoticeOfApplication(f.dbPath);
    // A verified statement with neither excerpt nor pinpoint: its line prints 📜 📍. Since v61 it is
    // built as a row verified before v61 stands: verified with a pinpoint and a snapshot holding
    // none, then the pinpoint cleared, which reopens nothing.
    await submissionDataExecute(
      f.dbPath,
      `INSERT INTO authorities (id, proceeding_id, style_of_cause_or_title, citation, kind, treatment)
         VALUES (1, 1, 'Uncaptured Authority v. Example', '2022 BCSC 3', 'case', 'good_law');
       INSERT INTO law_assertions (id, proceeding_id, proposition, dead_end) VALUES (1, 1, 'a proposition whose passage is not captured', 0);
       INSERT INTO statements_of_law (id, proceeding_id, law_assertion_id, authority_id, pinpoint, excerpt, source, verification,
                                      scrutinized_authority_id, scrutinized_pinpoint, scrutinized_excerpt)
         VALUES (5, 1, 1, 1, 'para 1', NULL, 'primary', 'verified', 1, NULL, NULL);
       UPDATE statements_of_law SET pinpoint = NULL WHERE id = 5;
       INSERT INTO submissions (id, proceeding_id, contention, ordinal) VALUES (1, 1, 'The applicant is entitled to the order.', 1);
       INSERT INTO submission_law (submission_id, law_assertion_id) VALUES (1, 1);
       INSERT INTO filing_submissions (filing_id, submission_id, document, ordinal) VALUES (1, 1, 'form', 1);`
    );
    const ITEM = "Uncaptured Authority v. Example, 2022 BCSC 3";

    const result = submissionFormsRender(f.dbPath, 1, ASHBOURNE);
    assert.deepEqual(
      inventoryOf(result).filter((e) => e.table === "statements_of_law" && e.doc === "Notice_of_application").map((e) => e.marker),
      ["📜", "📍"],
      "the form's statement line records both rungs"
    );
    const excerpts = criterionOf(boardDataOf(f.dbPath, 1, ASHBOURNE), "excerpts");
    assert.deepEqual([excerpts.state, excerpts.outstanding, excerpts.items], ["unmet", 1, [ITEM]]);

    await submissionDataExecute(
      f.dbPath,
      `INSERT INTO proposal_rejections (proposal_key, ticket_id, marker, item, rejected_at)
         VALUES ('authority-excerpt:statements_of_law:5', NULL, '📜', '${ITEM}', '2026-09-19T11:00');`
    );
    const shelved = criterionOf((submissionFormsRender(f.dbPath, 1, ASHBOURNE), boardDataOf(f.dbPath, 1, ASHBOURNE)), "excerpts");
    assert.deepEqual([shelved.state, shelved.outstanding, shelved.items], ["met", 0, [`${ITEM} — shelved by you`]], "the 📍 rung behind it is not left open");
  } finally {
    f.cleanup();
  }
});

test("goal: a marker recorded only by the reserve inventory leaves its criterion met while its Proposal still derives", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedNoticeOfApplication(f.dbPath);
    // Deployed on no document, so only the reserve inventory records the submission and its proposition's 📖.
    await submissionDataExecute(
      f.dbPath,
      `INSERT INTO law_assertions (id, proceeding_id, proposition, dead_end) VALUES (1, 1, 'a proposition argued only in reserve', 0);
       INSERT INTO submissions (id, proceeding_id, contention, ordinal) VALUES (1, 1, 'A reserved fallback argument.', 1);
       INSERT INTO submission_law (submission_id, law_assertion_id) VALUES (1, 1);`
    );

    const result = submissionFormsRender(f.dbPath, 1, ASHBOURNE);
    assert.deepEqual(
      inventoryOf(result).filter((e) => e.marker === "📖").map((e) => e.doc),
      ["Counsel_brief"],
      "📖 is recorded by the reserve inventory and nowhere else"
    );
    const data = boardDataOf(f.dbPath, 1, ASHBOURNE);
    assert.equal(criterionOf(data, "primary-authority").state, "met", "a reserve inventory entry never reaches a criterion");
    assert.deepEqual(laneOf(data, "doctrinal-basis:law_assertions:1"), { key: "doctrinal-basis:law_assertions:1", marker: "📖", lane: "proposed", holder: null });
  } finally {
    f.cleanup();
  }
});

test("goal: with no inventory every inventory criterion and the goal read pending, never met", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedNoticeOfApplication(f.dbPath);
    const [proceeding] = submissionDataQuery(f.dbPath, "SELECT * FROM proceedings WHERE id = 1").rows;
    const [filing] = submissionDataQuery(f.dbPath, "SELECT * FROM filings WHERE id = 1").rows;
    const ctx = {
      dbPath: f.dbPath,
      proceeding,
      filing,
      revision: 1,
      rendered: GOAL_NOW,
      clientName: "Ashbourne",
      clientNo: "2417",
      matterNo: "L4801",
      paragraphLedger: new Map(),
      lifecycle: { state: "drafting", since: null, readyToRetire: false },
    };

    const absent = buildWorkBoardData({ ...ctx, inventory: null });
    assert.deepEqual(absent.criteria.map((c) => c.id), NOA_CRITERIA);
    for (const c of absent.criteria.filter((c) => c.source === "inventory")) {
      assert.deepEqual([c.id, c.state, c.outstanding, c.items], [c.id, "pending", 0, []], `${c.id} reads pending`);
    }
    assert.deepEqual(absent.goal, { sentence: NOA_SENTENCE, state: "pending", text: null });

    // An empty inventory is a render that printed no marker, which is not the same thing.
    const empty = buildWorkBoardData({ ...ctx, inventory: [] });
    for (const c of empty.criteria.filter((c) => c.source === "inventory")) assert.equal(c.state, "met", `${c.id} reads met`);
  } finally {
    f.cleanup();
  }
});

test("goal: a shelved Proposal reads met and is named, but a shelved note-up keeps Noting up unmet", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedNoticeOfApplication(f.dbPath);
    // Two direct rejections, and a third Proposal hidden behind the rejected job it was outlined from.
    await submissionDataExecute(
      f.dbPath,
      `INSERT INTO tickets (id, proceeding_id, filing_id, title, intent, status, priority, kind, billing_anchor, created, rejected_at)
         VALUES (1, 1, 1, 'Find authority for the reserve point', 'Research it.', 'queued', 0, 'work', 'L9002|reserve point', '2026-09-19T09:00', '2026-09-19T10:00');
       INSERT INTO ticket_proposals (ticket_id, proposal_key, item) VALUES (1, 'doctrinal-basis:law_assertions:2', 'a proposition with no authority yet');
       INSERT INTO proposal_rejections (proposal_key, ticket_id, marker, item, rejected_at)
         VALUES
           ('primary-authority:law_assertions:1', NULL, '🥉', 'a proposition resting on a textbook', '2026-09-19T11:00'),
           ('note-up:authorities:1', NULL, '📇', 'Example v. Authority, 2020 BCSC 1', '2026-09-19T11:01'),
           ('doctrinal-basis:law_assertions:2', 1, '📖', 'a proposition with no authority yet', '2026-09-19T10:00');`
    );

    const data = boardWithInventory(f.dbPath, [
      generatingEntry("doctrinal-basis", "📖", "law_assertions", 2, "a proposition with no authority yet"),
      generatingEntry("primary-authority", "🥉", "law_assertions", 1, "a proposition resting on a textbook"),
      generatingEntry("note-up", "📇", "authorities", 1, "Example v. Authority, 2020 BCSC 1", { cleared: true }),
    ]);

    assert.deepEqual(
      data.proposals.map((p) => [p.key, p.lane]),
      [
        ["primary-authority:law_assertions:1", "rejected"],
        ["note-up:authorities:1", "rejected"],
      ],
      "both direct rejections sit in Shelved; the snapshot only hides its Proposal"
    );
    assert.deepEqual(criterionOf(data, "primary-authority"), {
      id: "primary-authority",
      text: "Every proposition of law rests on primary authority",
      state: "met",
      outstanding: 0,
      items: ["a proposition with no authority yet — shelved by you", "a proposition resting on a textbook — shelved by you"],
      source: "inventory",
    });
    assert.deepEqual(criterionOf(data, "noting-up"), {
      id: "noting-up",
      text: "Note up all cited authorities",
      state: "unmet",
      outstanding: 1,
      items: ["Example v. Authority, 2020 BCSC 1"],
      source: "inventory",
    });
    assert.deepEqual([criterionOf(data, "gate").outstanding, criterionOf(data, "gate").items], [0, []], "a rejected job is not counted");
  } finally {
    f.cleanup();
  }
});

test("goal: a queued stock bundle job names no job on the gate row, and an ordinary queued job does", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedNoticeOfApplication(f.dbPath);
    await submissionDataExecute(
      f.dbPath,
      `INSERT INTO tickets (id, proceeding_id, filing_id, title, intent, status, priority, kind, billing_anchor, created)
         VALUES
           (1, 1, 1, 'Availability letter', 'Ask the other side for hearing dates.', 'queued', 0, 'work', 'L9002|bundle', '2026-09-19T09:00'),
           (2, 1, 1, 'File and serve', 'File the application and serve it.', 'queued', 0, 'work', 'L9002|bundle', '2026-09-19T09:01'),
           (3, 1, NULL, 'Application book', 'Assemble the application record.', 'queued', 0, 'work', 'L9002|bundle', '2026-09-19T09:02');`
    );
    // Amended Rule 8-1's stock jobs, and hand-outlined service work under a Serve title.
    const more = [...STOCK_TITLES].filter((t) => !["Availability letter", "File and serve", "Application book"].includes(t));
    more.push("Serve the application on the new defendant", "Serve the response by email");
    await submissionDataExecute(
      f.dbPath,
      more
        .map((t, i) => `INSERT INTO tickets (id, proceeding_id, filing_id, title, intent, status, priority, kind, billing_anchor, created) VALUES (${20 + i}, 1, 1, '${t}', 'Stock work.', 'queued', 0, 'work', 'L9002|bundle', '2026-09-19T09:02');`)
        .join("\n")
    );
    const GATE = { id: "gate", text: "The pre-filing checks are passed or waived", source: "sqlite" };

    assert.deepEqual(criterionOf(boardWithInventory(f.dbPath, []), "gate"), { ...GATE, state: "unmet", outstanding: 0, items: [] });

    await submissionDataExecute(
      f.dbPath,
      `INSERT INTO tickets (id, proceeding_id, filing_id, title, intent, status, priority, kind, billing_anchor, created)
         VALUES (4, 1, 1, 'Draft the affidavit of service', 'Swear it before filing.', 'queued', 0, 'work', 'L9002|service', '2026-09-19T09:03');`
    );
    assert.deepEqual(criterionOf(boardWithInventory(f.dbPath, []), "gate"), { ...GATE, state: "unmet", outstanding: 1, items: ["Draft the affidavit of service"] });
  } finally {
    f.cleanup();
  }
});

// Design §2.5: the gate job's steps carry the revision each check ran against. With every drafting
// criterion met, the card string follows the gate.
const WAIVER_LINE = "para 12 WIP figures are being supplied by a corrected statement served separately";
const passStep = (rev) => [`C1 — Exhibit numbering cross-check: pass [rev ${rev}]`, "2026-09-20T09:30"];
const failStep = (rev) => [`C2 — Unresolved-placeholder scan: fail (4 findings) [rev ${rev}]`, null];
const waivedStep = (rev) => [`C2 — Unresolved-placeholder scan: fail (4 findings) [rev ${rev}] — WAIVED: ${WAIVER_LINE}`, "2026-09-21T08:00"];
const STALE = "The pre-filing checks ran before the latest changes.";

for (const c of [
  {
    label: "absent",
    steps: null,
    gate: ["unmet", 0, []],
    goal: ["unmet", "Every drafting condition holds. The next session assembles the package and runs the pre-filing checks."],
  },
  {
    label: "with an open step at the current revision",
    steps: [passStep(412), failStep(412)],
    gate: ["unmet", 1, [failStep(412)[0]]],
    goal: ["unmet", "Drafting conditions hold. Pre-filing checks: 1 open."],
  },
  {
    label: "closed at the current revision",
    steps: [passStep(412), waivedStep(412)],
    gate: ["met", 0, ["checks run on 2026-09-20", waivedStep(412)[0]]],
    goal: ["met", "Every condition holds. Awaiting your approval to serve."],
  },
  {
    label: "closed at a lower revision",
    steps: [passStep(411), waivedStep(411)],
    gate: ["unmet", 0, [STALE, "checks run on 2026-09-20"]],
    goal: ["unmet", `Drafting conditions hold. ${STALE}`],
  },
  {
    label: "closed at the current revision with every step waived",
    steps: [waivedStep(412)],
    gate: ["met", 0, [waivedStep(412)[0]]],
    goal: ["met", "Every condition holds. Awaiting your approval to serve."],
  },
  {
    label: "closed at a lower revision on a filing whose filed_on is set",
    filedOn: "2026-09-21",
    steps: [passStep(412), waivedStep(412)],
    gate: ["met", 0, ["checks run on 2026-09-20", waivedStep(412)[0]]],
    goal: ["met", "Filed on 2026-09-21"],
  },
]) {
  test(`goal: the gate job ${c.label}`, async () => {
    const f = seededDbFixture();
    try {
      await freshSubmissionDb(f.dbPath);
      await seedNoticeOfApplication(f.dbPath);
      // Setting filed_on moves the revision (its row carries the revision triggers), and so does each
      // parties_snapshot row written before it (schema v42), so on the filed case the steps'
      // [rev 412] sits below the current revision. The hearing date is recorded first, so only the gate
      // decides the card.
      seedSql(
        f.dbPath,
        `INSERT INTO hearing_details (filing_id, hearing_date) VALUES (1, '2026-10-15'); UPDATE db_meta SET value = '412' WHERE key = 'revision';` +
          (c.filedOn ? ` ${partiesSnapshotSql(f.dbPath, 1)} UPDATE filings SET filed_on = '${c.filedOn}' WHERE id = 1;` : "")
      );
      if (c.steps) {
        const closed = c.steps.every(([, doneAt]) => doneAt !== null);
        await submissionDataExecute(
          f.dbPath,
          `INSERT INTO tickets (id, proceeding_id, filing_id, title, intent, status, priority, kind, billing_anchor, created, completed_at)
             VALUES (9, 1, 1, 'Pre-filing consistency gate', 'Run the pre-filing checks on the assembled package.', '${closed ? "completed" : "queued"}', 9, 'work', 'L9002|gate', '2026-09-20T09:00', ${closed ? "'2026-09-21T08:05'" : "NULL"});` +
            c.steps.map(([text, doneAt], i) => `INSERT INTO ticket_steps (ticket_id, ordinal, text, done_at) VALUES (9, ${i + 1}, '${text}', ${doneAt ? `'${doneAt}'` : "NULL"});`).join("")
        );
      }

      const data = boardWithInventory(f.dbPath, []);
      const snapshotRows = submissionDataQuery(f.dbPath, "SELECT COUNT(*) AS n FROM parties_snapshot WHERE filing_id = 1", []).rows[0].n;
      assert.equal(data.meta.revision, c.filedOn ? 413 + snapshotRows : 412);
      const gate = criterionOf(data, "gate");
      assert.deepEqual([gate.state, gate.outstanding, gate.items], c.gate);
      assert.deepEqual(statesOf(data), allMetBut({ gate: c.gate[0] }), "every drafting criterion holds, and the gate job is not an open job of its own");
      assert.deepEqual([data.goal.state, data.goal.text], c.goal);
    } finally {
      f.cleanup();
    }
  });
}

// ADR 0013, second 2026-10-04 amendment: the deadlines of an anchor linked to the filing print after
// hearing-date, in date order within their anchor, each naming the ones at the previous date; equal
// dates share a rank, and no order runs across anchors. They hold no date and count toward the goal.
test("goal: linked deadlines follow hearing-date in their anchor's date order, and an unmet one leaves only the drafting conditions holding", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedNoticeOfApplication(f.dbPath);
    await submissionDataExecute(
      f.dbPath,
      `INSERT INTO hearing_details (filing_id, hearing_date) VALUES (1, '2026-10-15'); UPDATE db_meta SET value = '412' WHERE key = 'revision';
       INSERT INTO tickets (id, proceeding_id, filing_id, title, intent, status, priority, kind, billing_anchor, created, completed_at)
         VALUES (9, 1, 1, 'Pre-filing consistency gate', 'Run the pre-filing checks on the assembled package.', 'completed', 9, 'work', 'L9002|gate', '2026-09-20T09:00', '2026-09-21T08:05');
       INSERT INTO ticket_steps (ticket_id, ordinal, text, done_at) VALUES (9, 1, '${passStep(412)[0]}', '${passStep(412)[1]}');`
    );
    boardWithInventory(f.dbPath, []);
    const deadline = (deadline_type, deadline_date, status = "active", party_label = null) => ({ deadline_type, deadline_date, party_label, status, review_flag: null });
    const anchor = (anchor_type, filing_ref, deadlines) => ({ anchor_type, anchor_date: "2031-03-17", party_label: null, proceeding_label: null, status: "active", filing_ref, deadlines });
    const dates = (serviceStatus, rest) => ({
      anchors: [
        anchor("application_hearing_date", "filing:1", [
          deadline("application_record", "2031-03-10", rest),
          deadline("notice_of_application_service", "2031-02-24", serviceStatus),
          deadline("application_response", "2031-03-05", rest, "Corbin Vasey"),
          deadline("application_brief", "2031-03-05", rest),
          deadline("application_reply", "2031-03-12", "not_applicable"),
        ]),
        anchor("trial_date", "filing:1", [deadline("trial_brief", "2031-05-05", rest)]),
        anchor("application_service_date", "filing:2", [deadline("application_response", "2031-03-05")]),
        anchor("cpc_date", null, [deadline("case_plan_proposal", "2031-04-01")]),
      ],
    });
    const filing = fetchFiling(f.dbPath, 1);
    const boardFor = (matterDates) => filingBoardData(f.dbPath, filing, fetchProceeding(f.dbPath, 1), ASHBOURNE, GOAL_NOW, fetchRevision(f.dbPath), matterDates);

    const unmet = boardFor(dates("met", "active"));
    assert.deepEqual(
      unmet.criteria.slice(NOA_CRITERIA.length).map((c) => [c.id, c.text, c.state, c.follows ?? [], c.source]),
      [
        ["deadline:notice_of_application_service", "Notice of application service", "met", [], "practice"],
        ["deadline:application_response:corbin-vasey", "Application response — Corbin Vasey", "unmet", ["deadline:notice_of_application_service"], "practice"],
        ["deadline:application_brief", "Application brief", "unmet", ["deadline:notice_of_application_service"], "practice"],
        ["deadline:application_record", "Application record", "unmet", ["deadline:application_response:corbin-vasey", "deadline:application_brief"], "practice"],
        ["deadline:trial_brief", "Trial brief", "unmet", [], "practice"],
      ]
    );
    assert.deepEqual(unmet.criteria.slice(0, NOA_CRITERIA.length).map((c) => c.id), NOA_CRITERIA, "the deadlines print after gate and hearing-date");
    assert.deepEqual([unmet.goal.state, unmet.goal.text], ["unmet", "Every drafting condition holds. Awaiting your approval to serve."]);
    const summary = renderBoardSummary(unmet, ASHBOURNE, TODOS_NOT_READ);
    assert.ok(summary.includes("\n- ❌ deadline:application_record: Application record (after Application response — Corbin Vasey, Application brief)"), summary);
    assert.equal(JSON.stringify(unmet).includes("2031-"), false, "no deadline date reaches the section");

    const met = boardFor(dates("met", "met"));
    assert.deepEqual([met.goal.state, met.goal.text], ["met", "Every condition holds. Awaiting your approval to serve."]);
  } finally {
    f.cleanup();
  }
});

test("goal: one 🧐 on a forum document leaves only counsel's review, and the goal is not ready", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedNoticeOfApplication(f.dbPath);

    const data = boardWithInventory(f.dbPath, [countedEntry("🧐", "filings", 1, "Notice of Application")]);

    assert.deepEqual(statesOf(data), allMetBut({ "counsel-review": "unmet", gate: "unmet", "hearing-date": "unmet" }));
    assert.deepEqual(criterionOf(data, "counsel-review"), {
      id: "counsel-review",
      text: "Counsel has reviewed every paragraph",
      state: "unmet",
      outstanding: 1,
      items: ["Notice of Application"],
      source: "inventory",
    });
    assert.deepEqual(data.goal, { sentence: NOA_SENTENCE, state: "unmet", text: "Only your review remains. Every other drafting condition holds." });
  } finally {
    f.cleanup();
  }
});

test("goal: a queued Counsel's review job holds the gate row, which names it", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedNoticeOfApplication(f.dbPath);
    await submissionDataExecute(
      f.dbPath,
      `INSERT INTO tickets (id, proceeding_id, filing_id, title, intent, status, priority, kind, billing_anchor, created)
         VALUES (1, 1, 1, 'Counsel''s review of Notice of Application', 'Counsel reviews every paragraph of this filing, in document order, against its source pages.', 'queued', 0, 'work', 'L9002|review', '2026-09-20T09:00');`
    );

    const data = boardWithInventory(f.dbPath, []);

    assert.deepEqual(criterionOf(data, "gate"), {
      id: "gate",
      text: "The pre-filing checks are passed or waived",
      source: "sqlite",
      state: "unmet",
      outstanding: 1,
      items: ["Counsel's review of Notice of Application"],
    });
    assert.deepEqual(statesOf(data), allMetBut({ gate: "unmet", "hearing-date": "unmet" }));
  } finally {
    f.cleanup();
  }
});

test("goal: one keyed row counts once however many entries record its glyph", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedNoticeOfApplication(f.dbPath);

    // A dead-end order with two edges records 🚧 twice on the form and once more on the Written
    // Arguments; a 🏛️ printed on both forum documents is one Proposal's row.
    const deadEnd = countedEntry("🚧", "order_sought", 1, "damages to be assessed", { instance: "order" });
    const data = boardWithInventory(f.dbPath, [
      deadEnd,
      deadEnd,
      { ...deadEnd, doc: "Written_arguments" },
      generatingEntry("jurisdictional-basis", "🏛️", "order_sought", 2, "costs to be assessed"),
      generatingEntry("jurisdictional-basis", "🏛️", "order_sought", 2, "costs to be assessed", { doc: "Written_arguments" }),
    ]);

    const orders = criterionOf(data, "orders-sought");
    assert.deepEqual([orders.state, orders.outstanding, orders.items], ["unmet", 2, ["damages to be assessed", "costs to be assessed"]]);
  } finally {
    f.cleanup();
  }
});

test("goal: an Application Response carries its eight declared criteria, orders-positioned first, then the gate, with opposing points driven by ↩️", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedApplicationResponse(f.dbPath);
    await snapshotFromShipped(f.dbPath, 1, "application-response");
    await submissionDataExecute(
      f.dbPath,
      `INSERT INTO opposing_points (id, proceeding_id, component, pinpoint, verbatim_words, answered_by_submission_id, ordinal)
         VALUES (1, 1, 'Notice of Application Part 3', 'para 4', 'the defendant is a flight risk', NULL, 1);`
    );

    const result = submissionFormsRender(f.dbPath, 1, ASHBOURNE);
    assert.ok(
      inventoryOf(result).some((e) => e.marker === "↩️" && e.doc === "Written_arguments"),
      "the unanswered point prints ↩️ on a forum document"
    );
    const data = boardDataOf(f.dbPath, 1, ASHBOURNE);
    assert.equal(AR_DECLARED.length + ["gate"].length, 9, "the plan's nine: the declared criteria and the gate row");
    assert.deepEqual(data.criteria.map((c) => c.id), [...AR_DECLARED, ...UNIVERSAL]);
    assert.deepEqual(criterionOf(data, "orders-positioned").text, "Every order the applicant asks for has a position");
    assert.deepEqual(criterionOf(data, "opposing-points"), {
      id: "opposing-points",
      text: "Every opposing point is answered",
      state: "unmet",
      outstanding: 1,
      items: ['Notice of Application Part 3, para 4: "the defendant is a flight risk"'],
      source: "inventory",
    });
    assert.ok(!criterionOf(data, "open-items").items.some((item) => item.startsWith("Notice of Application Part 3")), "↩️ is not an open item on this kind");
    assert.equal(data.goal.sentence, "Completion Criteria");
  } finally {
    f.cleanup();
  }
});

test("goal: a requisition's type declares no goal criteria, so its card says so, carries no criteria and never reads met", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedBcscDefaultJudgment(f.dbPath);
    // Every shipped type now declares criteria, so the stored layout here declares none.
    const stored = { layout: { ...shippedBlock("BCSC/Documents/requisition-default-judgment.md"), goal_criteria: [] }, venue: shippedBlock("BCSC/venue.md"), passage_hashes: {} };
    await submissionDataWrite(f.dbPath, "UPDATE filings SET layout_snapshot = ? WHERE id = 1", [JSON.stringify(stored)]);

    const data = (submissionFormsRender(f.dbPath, 1, ASHBOURNE), boardDataOf(f.dbPath, 1, ASHBOURNE));
    assert.deepEqual(data.criteria, []);
    assert.deepEqual(data.goal, {
      sentence: "Completion Criteria",
      state: "pending",
      text: "No completion criteria are declared for this type of Writing.",
    });
  } finally {
    f.cleanup();
  }
});

test("goal: a stored layout declaring a name outside the vocabulary fails the render, naming the filing", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedNoticeOfApplication(f.dbPath);
    const stored = { layout: { ...shippedBlock("BCSC/Documents/notice-of-application.md"), goal_criteria: ["constructor"] }, venue: shippedBlock("BCSC/venue.md"), passage_hashes: {} };
    await submissionDataWrite(f.dbPath, "UPDATE filings SET layout_snapshot = ? WHERE id = 1", [JSON.stringify(stored)]);
    assert.throws(() => submissionFormsRender(f.dbPath, 1, ASHBOURNE), /its stored completion criteria names "constructor"/);
  } finally {
    f.cleanup();
  }
});

// Goal card design §4.7: the server sends each superseded ticket's finished reason, so the shell
// composes none. A superseded_by pointer wins, even on a retired filing, and a stale gate job not yet
// linked to its replacement (jobs.md §14) carries no reason.
test("tickets: each superseded cause gets its finished reason string, and a pointer or an unlinked gate job gets none", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedNoticeOfApplication(f.dbPath);
    await submissionDataExecute(
      f.dbPath,
      `INSERT INTO tickets (id, proceeding_id, filing_id, title, intent, status, priority, kind, billing_anchor, created, completed_at, superseded_by, superseded_marker_gone_at)
         VALUES
           (1, 1, 1, 'Revised approach', 'Replaces ticket 2.', 'completed', 0, 'work', 'L9002|order', '2026-09-19T09:00', '2026-09-19T10:00', NULL, NULL),
           (2, 1, 1, 'Old approach', 'Superseded by ticket 1.', 'superseded', 0, 'work', 'L9002|order', '2026-09-18T09:00', NULL, 1, NULL),
           (3, 1, 1, 'Capture the excerpt', 'Its marker stopped firing.', 'superseded', 0, 'work', 'L9002|order', '2026-09-18T09:01', NULL, NULL, '2026-09-21T10:00'),
           (4, 1, 1, 'Pre-filing consistency gate', 'Run the pre-filing checks.', 'superseded', 0, 'work', 'L9002|gate', '2026-09-18T09:02', NULL, NULL, NULL),
           (5, 1, 1, 'Draft the affidavit of service', 'Swear it before filing.', 'queued', 0, 'work', 'L9002|service', '2026-09-18T09:03', NULL, NULL, NULL);`
    );
    const reasons = (data) => Object.fromEntries(data.tickets.map((t) => [t.id, t.superseded_reason]));

    assert.deepEqual(reasons(boardWithInventory(f.dbPath, [])), {
      1: null,
      2: null,
      3: "Superseded: its marker no longer shows (2026-09-21)",
      4: null,
      5: null,
    });

    // jobs.md §9a: retiring the filing supersedes its queued jobs, with no pointer.
    await submissionDataExecute(
      f.dbPath,
      `UPDATE filings SET decided_on = '2026-09-02', retired_on = '2026-09-10', retirement_reason = 'decided' WHERE id = 1;
       UPDATE tickets SET status = 'superseded' WHERE filing_id = 1 AND status = 'queued';`
    );
    const retired = reasons((submissionFormsRender(f.dbPath, 1, ASHBOURNE), boardDataOf(f.dbPath, 1, ASHBOURNE)));
    assert.equal(retired[5], "Superseded by: retirement of this Writing (2026-09-10)");
    assert.equal(retired[2], null, "a superseded_by pointer wins over the retirement text");
    assert.equal(retired[3], "Superseded: its marker no longer shows (2026-09-21)", "the marker closure outranks a later retirement");
  } finally {
    f.cleanup();
  }
});

// Design §4.7: a live ticket whose Proposal key the inventory no longer prints says so in its
// subtitle, and stays in the lane it had.
test("tickets: a two-key ticket with one dead key reads 1 of 2 in its subtitle and keeps its lane", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedNoticeOfApplication(f.dbPath);
    await submissionDataExecute(
      f.dbPath,
      `INSERT INTO tickets (id, proceeding_id, filing_id, title, intent, status, priority, kind, billing_anchor, created, completed_at)
         VALUES
           (1, 1, 1, 'Capture and note up', 'Two Proposals in one job.', 'queued', 0, 'work', 'L9002|law', '2026-09-19T09:00', NULL),
           (2, 1, 1, 'Noted up', 'Done already.', 'completed', 0, 'work', 'L9002|law', '2026-09-19T09:01', '2026-09-19T10:00');
       INSERT INTO ticket_proposals (ticket_id, proposal_key, item)
         VALUES
           (1, 'authority-excerpt:statements_of_law:5', 'Printing Authority v. Example, 2022 BCSC 3'),
           (1, 'note-up:authorities:6', 'Silent Authority v. Example, 2020 BCSC 1'),
           (2, 'note-up:authorities:7', 'Finished Authority v. Example, 2019 BCSC 9');`
    );
    const inventory = [generatingEntry("authority-excerpt", "📜", "statements_of_law", 5, "Printing Authority v. Example, 2022 BCSC 3")];

    const data = boardWithInventory(f.dbPath, inventory);
    assert.equal(ticketIn(data, 1).subtitle, "1 of 2 items no longer show their marker");
    assert.equal(ticketIn(data, 2).subtitle, null, "a completed ticket's keys are expected to be gone");
    assert.deepEqual(ticketIn(data, 1).dispatch_skips, [], "one live key keeps the job dispatchable");

    // Every key dead: Dispatch skips it whatever its step count.
    const allDead = boardWithInventory(f.dbPath, []);
    assert.equal(ticketIn(allDead, 1).subtitle, "2 of 2 items no longer show their marker");
    assert.deepEqual(ticketIn(allDead, 1).dispatch_skips, [{ reason: "all_keys_dead" }]);
    assert.ok(renderLiveLanes(allDead).find((l) => l.startsWith("- Job #1 ")).endsWith("dispatch: skip (all_keys_dead)"));

    await submissionDataExecute(f.dbPath, "DELETE FROM ticket_proposals WHERE ticket_id = 1;");
    const withoutKeys = ticketIn(boardWithInventory(f.dbPath, inventory), 1);
    assert.equal(withoutKeys.subtitle, null);
    assert.equal(ticketIn(data, 1).category, withoutKeys.category, "the dead key leaves the lane classify() gave");
  } finally {
    f.cleanup();
  }
});

// #954: the pre-claim changed-item check (Goal card design §4.6, §4.8) compares each key's stored item
// with the item its Proposal prints now, so both sides must be on the board's data.
test("tickets: each held key carries its stored item, beside the changed item its Proposal prints now, and a dead key keeps its own", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedNoticeOfApplication(f.dbPath);
    await submissionDataExecute(
      f.dbPath,
      `INSERT INTO tickets (id, proceeding_id, filing_id, title, intent, status, priority, kind, billing_anchor, created)
         VALUES (1, 1, 1, 'Capture and note up', 'Two Proposals in one job.', 'queued', 0, 'work', 'L9002|law', '2026-09-19T09:00');
       INSERT INTO ticket_proposals (ticket_id, proposal_key, item)
         VALUES
           (1, 'authority-excerpt:statements_of_law:5', 'Printing Authority v. Example, 2021 BCSC 3'),
           (1, 'note-up:authorities:6', 'Silent Authority v. Example, 2020 BCSC 1');`
    );
    const inventory = [generatingEntry("authority-excerpt", "📜", "statements_of_law", 5, "Printing Authority v. Example, 2022 BCSC 3")];

    const data = boardWithInventory(f.dbPath, inventory);
    const ticket = ticketIn(data, 1);
    assert.deepEqual(ticket.proposal_keys, ["authority-excerpt:statements_of_law:5", "note-up:authorities:6"], "proposal_keys keeps its shape");
    assert.deepEqual(ticket.proposal_items, {
      "authority-excerpt:statements_of_law:5": "Printing Authority v. Example, 2021 BCSC 3",
      "note-up:authorities:6": "Silent Authority v. Example, 2020 BCSC 1",
    });
    const current = data.proposals.find((p) => p.key === "authority-excerpt:statements_of_law:5");
    assert.ok(current, "the held key's Proposal still derives");
    assert.equal(current.item, "Printing Authority v. Example, 2022 BCSC 3", "the current side is the Proposal's item");
    assert.equal(data.proposals.some((p) => p.key === "note-up:authorities:6"), false, "the dead key's Proposal no longer derives");
  } finally {
    f.cleanup();
  }
});

// Goal card design §5.3 (plan Phase 8): each condition alone defeats eligibility; one ticket meets all
// six. Every ticket but 2, 10 and 11 is Ready, one-step and fixed-text unless its condition says not.
test("tickets: each eligibility condition alone defeats eligible, and the one meeting all six carries the subtitle", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedNoticeOfApplication(f.dbPath);
    const pin = (table, id) => `Locate the testimony pinpoint: A. Witness: fact ${table} ${id}`;
    const inventory = [
      generatingEntry("testimony-pinpoint", "🧷", "statements_of_fact", 1, "A. Witness: fact statements_of_fact 1"),
      generatingEntry("testimony-pinpoint", "🧷", "statements_of_fact", 2, "A. Witness: fact statements_of_fact 2"),
      generatingEntry("testimony-pinpoint", "🧷", "statements_of_fact", 3, "A. Witness: fact statements_of_fact 3"),
      generatingEntry("testimony-pinpoint", "🧷", "statements_of_fact", 6, "A. Witness: fact statements_of_fact 6"),
      generatingEntry("exhibit-excerpt", "📑", "statements_of_fact", 7, "A. Witness: fact statements_of_fact 7"),
      generatingEntry("exhibit-pinpoint", "📌", "facts", 8, "A fact on the court record"),
      generatingEntry("testimony-pinpoint", "🧷", "statements_of_fact", 9, "A. Witness: fact statements_of_fact 9"),
    ];
    const fixed = (id, text, status = "queued", lockedBy = null) =>
      `(${id}, 1, 1, '${text}', '${text}', '${status}', 0, 'work', 'L9002|facts', '2026-09-24T09:00', ${lockedBy === null ? "NULL" : `'${lockedBy}'`}, ${lockedBy === null ? "NULL" : "'2026-09-24T09:30'"})`;
    await submissionDataExecute(
      f.dbPath,
      `INSERT INTO tickets (id, proceeding_id, filing_id, title, intent, status, priority, kind, billing_anchor, created, locked_by, locked_at)
         VALUES
           ${fixed(1, pin("statements_of_fact", 1))},
           ${fixed(2, pin("statements_of_fact", 2), "wip", "sess-a1")},
           ${fixed(3, pin("statements_of_fact", 3))},
           ${fixed(4, "A hand-outlined job")},
           ${fixed(5, "Locate the testimony pinpoint: A. Witness: a fact no longer printed")},
           ${fixed(7, "Quote the exhibit: A. Witness: fact statements_of_fact 7")},
           ${fixed(8, "Locate the exhibit pinpoint: A fact on the court record")},
           ${fixed(9, pin("statements_of_fact", 9))},
           ${fixed(10, "The other way of doing it")},
           ${fixed(11, "A job an unattended run holds", "wip", "sess-unattended-0a1b2c")};
       INSERT INTO tickets (id, proceeding_id, filing_id, title, intent, status, priority, kind, billing_anchor, created)
         VALUES (6, 1, 1, 'Pinpoint the witness', '${pin("statements_of_fact", 6)}', 'queued', 0, 'work', 'L9002|facts', '2026-09-24T09:00');
       INSERT INTO ticket_steps (ticket_id, ordinal, text)
         VALUES
           (1, 1, '${pin("statements_of_fact", 1)}'),
           (2, 1, '${pin("statements_of_fact", 2)}'),
           (3, 1, '${pin("statements_of_fact", 3)}'),
           (3, 2, 'A second step'),
           (4, 1, 'A hand-outlined job'),
           (5, 1, 'Locate the testimony pinpoint: A. Witness: a fact no longer printed'),
           (6, 1, '${pin("statements_of_fact", 6)}'),
           (7, 1, 'Quote the exhibit: A. Witness: fact statements_of_fact 7'),
           (8, 1, 'Locate the exhibit pinpoint: A fact on the court record'),
           (9, 1, '${pin("statements_of_fact", 9)}'),
           (10, 1, 'The other way of doing it');
       INSERT INTO ticket_proposals (ticket_id, proposal_key, item)
         VALUES
           (1, 'testimony-pinpoint:statements_of_fact:1', 'A. Witness: fact statements_of_fact 1'),
           (2, 'testimony-pinpoint:statements_of_fact:2', 'A. Witness: fact statements_of_fact 2'),
           (3, 'testimony-pinpoint:statements_of_fact:3', 'A. Witness: fact statements_of_fact 3'),
           (5, 'testimony-pinpoint:statements_of_fact:5', 'A. Witness: a fact no longer printed'),
           (6, 'testimony-pinpoint:statements_of_fact:6', 'A. Witness: fact statements_of_fact 6'),
           (7, 'exhibit-excerpt:statements_of_fact:7', 'A. Witness: fact statements_of_fact 7'),
           (8, 'exhibit-pinpoint:facts:8', 'A fact on the court record'),
           (9, 'testimony-pinpoint:statements_of_fact:9', 'A. Witness: fact statements_of_fact 9');
       INSERT INTO ticket_conflicts (a_id, b_id) VALUES (9, 10);`
    );

    const data = boardWithInventory(f.dbPath, inventory);
    assert.deepEqual(
      data.tickets.filter((t) => t.eligible).map((t) => t.id),
      [1],
      "not Ready (2), two steps (3), no keys (4), a dead key (5), an edited title (6), a 📑 key (7), a court-record 📌 key (8) and a live either/or partner (9) each defeat it"
    );
    for (const t of data.tickets) assert.equal(t.eligible, t.ineligible_reasons.length === 0, `ticket ${t.id}: eligible is exactly no reasons`);
    const alone = [
      [1, []],
      [2, ["not_ready"]],
      [3, ["not_one_step"]],
      [4, ["no_proposal_keys"]],
      [5, ["dead_key"]],
      [6, ["reworded"]],
      [7, ["marker_not_eligible"]],
      [8, ["marker_not_eligible"]],
      [9, ["live_partner"]],
    ];
    for (const [id, reasons] of alone) assert.deepEqual(ticketIn(data, id).ineligible_reasons, reasons, `ticket ${id} carries its one code`);
    assert.deepEqual(ticketIn(data, 11).ineligible_reasons, ["not_ready", "not_one_step", "no_proposal_keys"], "several failures list in the fixed order");
    assert.equal(ticketIn(data, 1).subtitle, "can be picked up with nobody present");
    for (const id of [3, 4, 6, 7, 8, 9]) assert.equal(ticketIn(data, id).subtitle, null, `ticket ${id} carries no subtitle`);
    assert.equal(ticketIn(data, 5).subtitle, "1 of 1 items no longer show their marker", "a dead key keeps its own subtitle");

    assert.equal(ticketIn(data, 11).lock_note, "In progress with nobody present", "an unattended-class token reads as such");
    assert.equal(ticketIn(data, 2).lock_note, null, "an ordinary session's lock carries no note");
    assert.equal(ticketIn(data, 1).lock_note, null);

    seedSql(f.dbPath, `${partiesSnapshotSql(f.dbPath, 1)} UPDATE filings SET filed_on = '2026-09-24' WHERE id = 1;`);
    const filedBoard = boardWithInventory(f.dbPath, inventory);
    const filed = ticketIn(filedBoard, 1);
    assert.equal(filed.category, "ready", "filing moves no lane");
    assert.equal(filed.eligible, false, "a filed filing's ticket is never eligible");
    assert.deepEqual(filed.ineligible_reasons, ["filing_filed"], "the filed filing is the reason, not the marker");
    assert.deepEqual(ticketIn(filedBoard, 3).ineligible_reasons, ["filing_filed", "not_one_step"], "two failures list in the fixed order");
    assert.equal(filed.subtitle, null);

    const [proceeding] = submissionDataQuery(f.dbPath, "SELECT * FROM proceedings WHERE id = 1").rows;
    const [filing] = submissionDataQuery(f.dbPath, "SELECT * FROM filings WHERE id = 1").rows;
    const noInventory = buildWorkBoardData({
      dbPath: f.dbPath,
      proceeding,
      filing,
      revision: 1,
      rendered: GOAL_NOW,
      clientName: "Ashbourne",
      clientNo: "2417",
      matterNo: "L4801",
      paragraphLedger: new Map(),
      lifecycle: { state: "drafting", since: null, readyToRetire: false },
      inventory: null,
    });
    for (const t of noInventory.tickets) assert.ok(t.ineligible_reasons.includes("no_inventory"), `ticket ${t.id} carries the no-inventory code`);
  } finally {
    f.cleanup();
  }
});

// #1051: a Ready job whose scope shares an entry with any in-progress job in the proceeding is passed
// over, so a nightly run never works material another run holds. Tickets 1 to 7 are otherwise eligible.
test("tickets: a Ready job sharing scope with an in-progress job in the proceeding carries shared_material", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedNoticeOfApplication(f.dbPath);
    const pin = (id) => `Locate the testimony pinpoint: A. Witness: fact statements_of_fact ${id}`;
    const inventory = [1, 2, 3, 4, 5, 6, 7, 8].map((id) =>
      generatingEntry("testimony-pinpoint", "🧷", "statements_of_fact", id, `A. Witness: fact statements_of_fact ${id}`)
    );
    const ready = (id) => `(${id}, 1, 1, '${pin(id)}', '${pin(id)}', 'queued', 0, 'work', 'L9002|facts', '2026-09-24T09:00', NULL, NULL)`;
    const wip = (id, filingId) =>
      `(${id}, 1, ${filingId}, 'Held job ${id}', 'Held job ${id}', 'wip', 0, 'work', 'L9002|facts', '2026-09-24T09:00', 'sess-unattended-${id}', '2026-09-24T09:30')`;
    await submissionDataExecute(
      f.dbPath,
      `INSERT INTO filings (id, proceeding_id, kind, subkind, round, title) VALUES (2, 1, 'application_response', NULL, NULL, 'Sibling Filing');
       INSERT INTO tickets (id, proceeding_id, filing_id, title, intent, status, priority, kind, billing_anchor, created, locked_by, locked_at)
         VALUES ${[1, 2, 3, 4, 5, 6, 7, 8, 10].map(ready).join(", ")}, ${wip(20, 1)}, ${wip(21, 1)}, ${wip(22, 2)}, ${wip(23, 1)}, ${wip(24, 1)}, ${wip(25, 1)},
           (9, 1, 1, 'Counsel''s review of the application', 'Counsel''s review of the application', 'queued', 0, 'work', 'L9002|facts', '2026-09-24T09:00', NULL, NULL),
           (11, 1, 1, 'Review scrutiny finding: X (statement 3)', 'i', 'queued', 0, 'work', 'L9002|facts', '2026-09-24T09:00', NULL, NULL);
       UPDATE tickets SET rejected_at = '2026-09-24T10:00' WHERE id = 25;
       INSERT INTO ticket_steps (ticket_id, ordinal, text) VALUES ${[1, 2, 3, 4, 5, 6, 7, 8].map((id) => `(${id}, 1, '${pin(id)}')`).join(", ")};
       INSERT INTO ticket_proposals (ticket_id, proposal_key, item)
         VALUES ${[1, 2, 3, 4, 5, 6, 7, 8].map((id) => `(${id}, 'testimony-pinpoint:statements_of_fact:${id}', 'A. Witness: fact statements_of_fact ${id}')`).join(", ")};
       INSERT INTO ticket_scope (ticket_id, entity, entity_id)
         VALUES
           (1, 'statements_of_fact', 1), (20, 'statements_of_fact', 1),
           (2, 'admissions', 2), (21, 'admissions', NULL),
           (3, 'witnesses', NULL), (20, 'witnesses', 4),
           (4, 'statements_of_fact', 3), (22, 'statements_of_fact', 3),
           (6, 'statements_of_fact', 6), (6, 'documents', 6),
           (7, 'statements_of_fact', 1),
           (23, 'authorities', 9),
           (8, 'statements_of_fact', 8), (25, 'statements_of_fact', 8);
       INSERT INTO ticket_conflicts (a_id, b_id) VALUES (7, 10);`
    );

    const data = boardWithInventory(f.dbPath, inventory);
    assert.equal(data.tickets.some((t) => t.id === 22), false, "the sibling filing's job is not on this board");
    assert.deepEqual(
      [1, 2, 3, 4, 5, 6, 7].map((id) => [id, ticketIn(data, id).category]),
      [1, 2, 3, 4, 5, 6, 7].map((id) => [id, "ready"]),
      "sharing material moves no lane"
    );
    const reasons = [
      [1, ["shared_material"]],
      [2, ["shared_material"]],
      [3, ["shared_material"]],
      [4, ["shared_material"]],
      [5, []],
      [6, []],
      [7, ["live_partner", "shared_material"]],
      [8, ["shared_material"]],
    ];
    for (const [id, expected] of reasons) assert.deepEqual(ticketIn(data, id).ineligible_reasons, expected, `ticket ${id}`);
    assert.deepEqual(
      data.tickets.filter((t) => t.eligible).map((t) => t.id),
      [5, 6],
      "the same row (1), a whole table against its row (2 and 3), a job held on a sibling filing (4), one beside a live partner (7) and one held by a shelved job still in progress (8) are passed over; no scope (5) and other rows (6) are not"
    );
    for (const t of data.tickets) assert.equal(t.eligible, t.ineligible_reasons.length === 0, `ticket ${t.id}: eligible is exactly no reasons`);
    for (const id of [20, 23]) assert.equal(ticketIn(data, id).ineligible_reasons.includes("shared_material"), false, `job ${id} never shares with itself`);
    assert.equal(ticketIn(data, 24).ineligible_reasons.includes("shared_material"), false, "an in-progress job with no scope shares nothing");
    assert.equal(INELIGIBLE_REASONS.at(-1), "shared_material", "the code is last in the fixed order");

    // Section 14 Dispatch's walk: each Ready job's skip reasons, naming the job and the material.
    const skips = [
      [1, [{ reason: "shared_material", job: 20, material: ["statements_of_fact:1"] }]],
      [2, [{ reason: "shared_material", job: 21, material: ["admissions:2"] }]],
      [3, [{ reason: "shared_material", job: 20, material: ["witnesses"] }]],
      [4, [{ reason: "shared_material", job: 22, material: ["statements_of_fact:3"] }]],
      [5, []],
      [6, []],
      [7, [{ reason: "either_or", job: 10 }, { reason: "shared_material", job: 20, material: ["statements_of_fact:1"] }]],
      [8, [{ reason: "shared_material", job: 25, material: ["statements_of_fact:8"] }]],
      [9, [{ reason: "practitioner_own" }]],
      [10, [{ reason: "either_or", job: 7 }]],
      [11, []], // #1596: Dispatch may start a scrutiny review with the practitioner
      [20, []],
      [23, []],
      [24, []],
    ];
    for (const [id, expected] of skips) assert.deepEqual(ticketIn(data, id).dispatch_skips, expected, `ticket ${id} dispatch_skips`);
    const lines = renderLiveLanes(data);
    const headOf = (id) => lines.find((l) => l.startsWith(`- Job #${id} `));
    assert.ok(headOf(5).endsWith("eligible: yes · dispatch: ok"), headOf(5));
    assert.ok(headOf(7).endsWith("dispatch: skip (either/or with #10; shared material with #20: statements_of_fact:1)"), headOf(7));
    assert.ok(headOf(9).endsWith("dispatch: skip (practitioner's own)"), headOf(9));
    const choice = lines.indexOf(`dispatch choice: #5 ${pin(5)}`);
    const inProgress = lines.findIndex((l) => l.startsWith("## In Progress ("));
    assert.equal(choice, inProgress - 1, "the choice line closes the Ready lane");
    assert.ok(lines.indexOf(headOf(10)) < choice, "the choice line follows the last Ready job");
  } finally {
    f.cleanup();
  }
});

// E2E finding 4.1: a Ready job titled `File and serve ...` is skipped while the filing's gate row is
// unmet, and Dispatch then chooses nothing unless another Ready job is free.
test("tickets: a Ready File and serve job is skipped before the pre-filing gate, and another Ready job is not", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedNoticeOfApplication(f.dbPath);
    const FILE = "File and serve the Notice of Application";
    await submissionDataExecute(
      f.dbPath,
      `INSERT INTO tickets (id, proceeding_id, filing_id, title, intent, status, priority, kind, billing_anchor, created)
         VALUES (1, 1, 1, '${FILE}', 'File it and serve it.', 'queued', 0, 'work', 'L9002|bundle', '2026-09-24T09:00');
       INSERT INTO ticket_steps (ticket_id, ordinal, text) VALUES (1, 1, 'File in the registry');`
    );

    let data = boardWithInventory(f.dbPath, []);
    assert.equal(criterionOf(data, "gate").state, "unmet");
    assert.deepEqual(ticketIn(data, 1).dispatch_skips, [{ reason: "before_gate" }]);
    let lines = renderLiveLanes(data);
    assert.ok(lines.find((l) => l.startsWith("- Job #1 ")).endsWith("dispatch: skip (before the pre-filing gate)"));
    assert.ok(lines.includes("dispatch choice: none"), "the only Ready job is skipped, so Dispatch chooses nothing");

    await submissionDataExecute(
      f.dbPath,
      `INSERT INTO tickets (id, proceeding_id, filing_id, title, intent, status, priority, kind, billing_anchor, created)
         VALUES (2, 1, 1, 'Draft the affidavit of service', 'Swear it before filing.', 'queued', 0, 'work', 'L9002|service', '2026-09-24T09:01');
       INSERT INTO ticket_steps (ticket_id, ordinal, text) VALUES (2, 1, 'Draft the affidavit');`
    );
    data = boardWithInventory(f.dbPath, []);
    assert.deepEqual(ticketIn(data, 1).dispatch_skips, [{ reason: "before_gate" }]);
    assert.deepEqual(ticketIn(data, 2).dispatch_skips, [], "a job of another title is not held back by the gate");
    lines = renderLiveLanes(data);
    assert.ok(lines.find((l) => l.startsWith("- Job #2 ")).endsWith("dispatch: ok"));
    assert.ok(lines.includes("dispatch choice: #2 Draft the affidavit of service"));
  } finally {
    f.cleanup();
  }
});

test("tickets: a Ready File and serve job reads dispatch: ok once the gate row is met", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedNoticeOfApplication(f.dbPath);
    // A hand-outlined title: like the stock `File and serve`, it is not counted as open drafting work.
    await submissionDataExecute(
      f.dbPath,
      `UPDATE db_meta SET value = '412' WHERE key = 'revision';
       INSERT INTO tickets (id, proceeding_id, filing_id, title, intent, status, priority, kind, billing_anchor, created, completed_at)
         VALUES (9, 1, 1, 'Pre-filing consistency gate', 'Run the pre-filing checks on the assembled package.', 'completed', 9, 'work', 'L9002|gate', '2026-09-20T09:00', '2026-09-21T08:05');
       INSERT INTO ticket_steps (ticket_id, ordinal, text, done_at) VALUES (9, 1, '${passStep(412)[0]}', '${passStep(412)[1]}');
       INSERT INTO tickets (id, proceeding_id, filing_id, title, intent, status, priority, kind, billing_anchor, created)
         VALUES (1, 1, 1, 'File and serve the Notice of Application', 'File it and serve it.', 'queued', 0, 'work', 'L9002|bundle', '2026-09-24T09:00');
       INSERT INTO ticket_steps (ticket_id, ordinal, text) VALUES (1, 1, 'File in the registry');`
    );

    const data = boardWithInventory(f.dbPath, []);
    assert.equal(criterionOf(data, "gate").state, "met");
    assert.deepEqual(ticketIn(data, 1).dispatch_skips, []);
    const lines = renderLiveLanes(data);
    assert.ok(lines.find((l) => l.startsWith("- Job #1 ")).endsWith("dispatch: ok"));
    assert.ok(lines.includes("dispatch choice: #1 File and serve the Notice of Application"));
  } finally {
    f.cleanup();
  }
});

// A wip job with at least one step and every step stamped renders in In Progress: it stays wip
// under its lock, holds no material for Dispatch, and the render writes nothing to close it.
test("tickets: a wip job with every step done stays In Progress, and shares no material", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedNoticeOfApplication(f.dbPath);
    const pin = (id) => `Locate the testimony pinpoint: A. Witness: fact statements_of_fact ${id}`;
    const inventory = [1, 2].map((id) => generatingEntry("testimony-pinpoint", "🧷", "statements_of_fact", id, `A. Witness: fact statements_of_fact ${id}`));
    const ready = (id) => `(${id}, 1, 1, '${pin(id)}', '${pin(id)}', 'queued', 0, 'work', 'L9002|facts', '2026-09-24T09:00', NULL, NULL)`;
    const wip = (id, lockedBy) =>
      `(${id}, 1, 1, 'Held job ${id}', 'Held job ${id}', 'wip', 0, 'work', 'L9002|facts', '2026-09-24T09:00', '${lockedBy}', '2026-09-24T09:30')`;
    await submissionDataExecute(
      f.dbPath,
      `INSERT INTO tickets (id, proceeding_id, filing_id, title, intent, status, priority, kind, billing_anchor, created, locked_by, locked_at)
         VALUES ${ready(1)}, ${ready(2)}, ${wip(20, "sess-dead")}, ${wip(21, "sess-a21")}, ${wip(22, "sess-a22")}, ${wip(23, "sess-a23")}, ${wip(24, "sess-unattended-24")};
       UPDATE tickets SET rejected_at = '2026-09-24T10:00' WHERE id = 23;
       INSERT INTO ticket_steps (ticket_id, ordinal, text, done_at)
         VALUES
           (1, 1, '${pin(1)}', NULL), (2, 1, '${pin(2)}', NULL),
           (20, 1, 'First', '2026-09-24T09:40'), (20, 2, 'Second', '2026-09-24T09:50'),
           (21, 1, 'First', '2026-09-24T09:40'), (21, 2, 'Second', NULL),
           (23, 1, 'First', '2026-09-24T09:40'), (23, 2, 'Second', '2026-09-24T09:50'),
           (24, 1, 'First', '2026-09-24T09:40'), (24, 2, 'Second', '2026-09-24T09:50');
       INSERT INTO ticket_proposals (ticket_id, proposal_key, item)
         VALUES ${[1, 2].map((id) => `(${id}, 'testimony-pinpoint:statements_of_fact:${id}', 'A. Witness: fact statements_of_fact ${id}')`).join(", ")};
       INSERT INTO ticket_scope (ticket_id, entity, entity_id)
         VALUES (1, 'statements_of_fact', 1), (20, 'statements_of_fact', 1), (2, 'admissions', 2), (21, 'admissions', 2);`
    );

    const data = boardWithInventory(f.dbPath, inventory);
    assert.deepEqual(idsIn(data, "wip"), [20, 21, 22, 24], "every step stamped under any lock, a step still open, or no steps at all: all In Progress");
    assert.equal(ticketIn(data, 23).category, "rejected", "a shelved job stays in Shelved");
    assert.deepEqual(ticketIn(data, 1).ineligible_reasons, [], "a done job holds no material");
    assert.equal(ticketIn(data, 1).eligible, true);
    assert.deepEqual(ticketIn(data, 2).ineligible_reasons, ["shared_material"], "an in-progress job with an open step still holds its material");
    assert.equal(ticketIn(data, 20).lock_note, null, "an ordinary session's lock carries no note");
    assert.equal(ticketIn(data, 24).lock_note, "In progress with nobody present", "an unattended run that stopped short of closing still says nobody is present");

    const [row] = submissionDataQuery(f.dbPath, "SELECT status, locked_by FROM tickets WHERE id = 20").rows;
    assert.deepEqual({ status: row.status, locked_by: row.locked_by }, { status: "wip", locked_by: "sess-dead" }, "the render closes nothing");

    const live = renderLiveLanes(data).join("\n");
    assert.match(live, /^## In Progress \(4\)\n- Job #20 Held job 20 · In Progress 2\/2( · .*)?$/m, live);
    const at = (heading) => live.indexOf(heading);
    assert.ok(at("## In Progress (") >= 0 && at("## In Progress (") < at("## Blocked ("), "In Progress sits before Blocked");
  } finally {
    f.cleanup();
  }
});

// Visible text is what a string literal or the page's HTML carries, never an identifier or a comment:
// ids, classes and data keys keep their internal names (design §2).
// The Litigation Strategy (the To Do List until 2026-10-08, the Matter Board until #871) names jobs in progress, so it is scanned too:
// its page is the template set in src/templates/matter-board/ (map #125).
test("the Milestone's page shows no Work Board, Matter Board, Rejected angles or claim wording", () => {
  const pages = [
    [["templates/milestone/milestone.html", "templates/milestone/milestone.css", "templates/milestone/milestone.js"], (literals, htmlText) => literals.includes("Shelved") && htmlText.includes("Milestone")],
    [["templates/matter-board/matter-board.html", "templates/matter-board/matter-board.js"], (literals, htmlText) => literals.includes(" jobs in progress") && htmlText.includes("Litigation Strategy")],
  ];
  for (const [files, sawOwnStrings] of pages) {
    const file = files.join(", ");
    const source = files.map((f) => readFileSync(new URL(`../src/${f}`, import.meta.url), "utf-8")).join("\n");
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const literals = [...code.matchAll(/"((?:[^"\\\n]|\\.)*)"/g)].map((m) => m[1]);
    const htmlText = [...code.matchAll(/>([^<>\n]+)</g)].map((m) => m[1]);
    assert.ok(sawOwnStrings(literals, htmlText), `expected the scan to see ${file}'s own strings`);
    for (const text of [...literals, ...htmlText]) {
      assert.doesNotMatch(text, /Work Board|Matter Board|Rejected angles|claim/i, `${file} visible text "${text}"`);
    }
  }
});

// Practitioner-review plan Phase 5 (work-markers.md row 🧐): the forum emit sites print 🧐 final
// review on a line no other 1a work marker holds, until an approval's snapshot matches the object's
// stored fields byte for byte.

const { reviewSnapshotSql } = await import("../build/submission/forms/markers.js");
const { assertFiledFaceDocumentsClean } = await import("./helpers/filed-face-scan.mjs");

const REVIEWED_ITEM = "Reviewed Authority v. Example, 2021 BCSC 2";

/** An approval of one object, its snapshot built by the same json_object the reference fixes (review.md). */
const approve = (dbPath, table, id) =>
  submissionDataExecute(
    dbPath,
    `INSERT INTO review_approvals (entity, entity_id, approved_at, session_token, practitioner, revision, snapshot)
       SELECT '${table}', id, '2026-09-22T10:00', 'sess-r1', 'B. Counsel', 1, ${reviewSnapshotSql(table)} FROM ${table} WHERE id = ${id};`
  );

/** seedNoticeOfApplication plus one submission whose every object prints a clean forum line once
 * its statement of law is verified. The statement is a lead here, so the proposition reads 🔬. The
 * submission and the fact are deployed on the Written Arguments as well, so no 🧵 holds 🧐 back on
 * the form. */
async function seedReviewCase(dbPath) {
  await seedNoticeOfApplication(dbPath);
  await submissionDataExecute(
    dbPath,
    `INSERT INTO authorities (id, proceeding_id, style_of_cause_or_title, citation, kind, treatment)
       VALUES (1, 1, 'Reviewed Authority v. Example', '2021 BCSC 2', 'case', 'good_law');
     INSERT INTO law_assertions (id, proceeding_id, proposition, dead_end) VALUES (1, 1, 'a proposition counsel reviews', 0);
     INSERT INTO statements_of_law (id, proceeding_id, law_assertion_id, authority_id, pinpoint, excerpt, source, verification)
       VALUES (1, 1, 1, 1, 'para 4', 'The passage.', 'primary', 'lead');
     INSERT INTO witnesses (id, proceeding_id, name) VALUES (1, 1, 'M. Reyes');
     -- An executed, best-copy affidavit, so the statement of fact owes no 🗣️ ✍️ ✒️ and carries no 🏆.
     INSERT INTO documents (id, proceeding_id, label, is_best_copy, instrument, deponent, execution)
       VALUES (2, 1, 'Affidavit #1 of M. Reyes', 1, 'affidavit', 1, '2026-09-01');
     INSERT INTO facts (id, proceeding_id, postulate) VALUES (1, 1, 'The defendant was served on 1 September.');
     INSERT INTO statements_of_fact (id, proceeding_id, fact_id, witness_id, instrument, pinpoint, interviewed, excerpt)
       VALUES (1, 1, 1, 1, 2, 'para 3', 1, 'I served the defendant.');
     INSERT INTO submissions (id, proceeding_id, contention, ordinal) VALUES (1, 1, 'The applicant is entitled to the order.', 1);
     INSERT INTO submission_law (submission_id, law_assertion_id) VALUES (1, 1);
     INSERT INTO submission_facts (submission_id, fact_id) VALUES (1, 1);
     -- Deploying the submission to the form places fact 1 in Part 2 and on the Written Arguments (schema v59).
     INSERT INTO filing_submissions (filing_id, submission_id, document, ordinal) VALUES (1, 1, 'form', 1), (1, 1, 'written_argument', 1);`
  );
}

/** seedReviewCase with its statement of law verified: every reviewed object on the form is clean. */
async function seedVerifiedReviewCase(dbPath) {
  await seedReviewCase(dbPath);
  await submissionDataExecute(dbPath, "UPDATE statements_of_law SET verification = 'verified' WHERE id = 1;");
}

function markdownOf(result, documentType) {
  const doc = result.documents.find((d) => d.document_type === documentType);
  assert.ok(doc, `expected a ${documentType} document`);
  return doc.markdown;
}

function lineWith(markdown, trace) {
  const line = markdown.split("\n").find((l) => l.includes(trace));
  assert.ok(line !== undefined, `expected a line carrying ${trace}`);
  return line;
}

/** The Notice of Application's Part 2 paragraph line itself -- its `<!-- fact N -->` trace rides the last citation line beneath it. */
function part2ParagraphLine(markdown, n) {
  const line = markdown.split("## PART 2: FACTUAL BASIS")[1].split("\n").find((l) => l.startsWith(`${n}. `));
  assert.ok(line !== undefined, `expected Part 2 paragraph ${n}`);
  return line;
}

const reviewEntries = (inventory, doc) => inventory.filter((e) => e.marker === "🧐" && e.doc === doc);

test("final review: a lead reads 🔬 with no 🧐, and once verified every clean forum line reads 🧐", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedReviewCase(f.dbPath);

    const lead = submissionFormsRender(f.dbPath, 1, ASHBOURNE);
    const leadProposition = lineWith(markdownOf(lead, "Notice_of_application"), "<!-- law_assertion_id 1 -->");
    assert.match(leadProposition, /🔬/);
    assert.doesNotMatch(leadProposition, /🧐/, "🔬 is a 1a work marker, so it holds 🧐 back");
    assert.ok(!inventoryOf(lead).some((e) => e.marker === "🧐" && e.table === "statements_of_law"), "the lead statement prints on no forum line");

    // A substance write: the revision moves.
    await submissionDataExecute(f.dbPath, "UPDATE statements_of_law SET verification = 'verified' WHERE id = 1;");
    const result = submissionFormsRender(f.dbPath, 1, ASHBOURNE);
    const noa = markdownOf(result, "Notice_of_application");
    assert.match(noa, /🧐 <!-- statement_of_law_id 1 -->$/m);
    const proposition = lineWith(noa, "<!-- law_assertion_id 1 -->");
    assert.match(proposition, /🧐/);
    assert.doesNotMatch(proposition, /🔬/);

    const inventory = inventoryOf(result);
    const onNoa = reviewEntries(inventory, "Notice_of_application");
    assert.deepEqual(
      onNoa.filter((e) => e.table === "statements_of_law"),
      [{ generating: false, marker: "🧐", table: "statements_of_law", id: 1, item: REVIEWED_ITEM, doc: "Notice_of_application" }],
      "never approved, so no changed flag"
    );
    for (const key of ["law_assertions:1", "submissions:1", "facts:1", "statements_of_fact:1"]) {
      assert.ok(onNoa.some((e) => `${e.table}:${e.id}` === key), `expected a 🧐 entry for ${key} on the Notice of Application`);
    }
    const review = criterionOf(boardDataOf(f.dbPath, 1, ASHBOURNE), "counsel-review");
    assert.equal(review.state, "unmet");
    assert.ok(review.items.includes(REVIEWED_ITEM), "the statement is one of counsel's outstanding items");

    // The Written Arguments companion prints the same statement line, and records it on its own document.
    assert.match(markdownOf(result, "Written_arguments"), /🧐 <!-- statement_of_law_id 1 -->$/m);
    assert.ok(reviewEntries(inventory, "Written_arguments").some((e) => e.table === "statements_of_law" && e.id === 1));

    // Part 2's merged line prints 🧐 once and records it on the fact and on its statement. Part 3
    // names fact 1 by its Part 2 paragraph number instead of re-printing it, so it records neither.
    assert.equal(part2ParagraphLine(noa, 1).match(/🧐/g)?.length, 1);
    assert.equal(onNoa.filter((e) => e.table === "facts" && e.id === 1).length, 1, "only Part 2 records the fact");
    assert.equal(onNoa.filter((e) => e.table === "statements_of_fact" && e.id === 1).length, 1, "only Part 2 records the statement");
  } finally {
    f.cleanup();
  }
});

// The predicate is scoped to the object's line (work-markers.md row 🧐): on Part 2's merged line a
// statement of fact's work marker holds the postulate's 🧐 back too, although the postulate owes
// nothing itself. 💬 never prints on that line (the excerpt is Part 3's), so the statement owes 🧷.
test("final review: on a merged Notice of Application fact line, a statement's work marker holds the postulate's 🧐 back", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedVerifiedReviewCase(f.dbPath);
    await submissionDataExecute(f.dbPath, "UPDATE statements_of_fact SET pinpoint = NULL WHERE id = 1;");
    const result = submissionFormsRender(f.dbPath, 1, ASHBOURNE);
    const noa = markdownOf(result, "Notice_of_application");

    const merged = part2ParagraphLine(noa, 1);
    assert.match(merged, /🧷/);
    assert.doesNotMatch(merged, /🧐/, "the statement's 🧷 is on the postulate's line, so the postulate prints no 🧐");

    // Part 3 no longer re-prints fact 1 on lines of its own: it names the Part 2 paragraph number on
    // the contention line. So the merged line is the postulate's only line on the form, and its 🧷
    // holds 🧐 back for both objects: the 🧐 Part 3 alone used to produce is gone, and with it that
    // object's counsel-review item on the Goal card.
    assert.ok(!noa.includes("<!-- fact_id 1 -->"), "expected no Part 3 line for a fact already in Part 2");
    assert.match(lineWith(noa, "<!-- submission_id 1 -->"), /<!-- supporting fact paragraphs: 1 -->/);
    const onNoa = reviewEntries(inventoryOf(result), "Notice_of_application");
    assert.equal(onNoa.filter((e) => e.table === "facts" && e.id === 1).length, 0, "the merged line's 🧷 holds the fact's 🧐 back");
    assert.equal(onNoa.filter((e) => e.table === "statements_of_fact" && e.id === 1).length, 0);
  } finally {
    f.cleanup();
  }
});

test("final review: an identical approval clears 🧐 with no revision write, and one byte re-raises it as changed", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedVerifiedReviewCase(f.dbPath);
    const before = submissionFormsRender(f.dbPath, 1, ASHBOURNE);

    await approve(f.dbPath, "statements_of_law", 1);
    const approved = submissionFormsRender(f.dbPath, 1, ASHBOURNE);
    const noa = markdownOf(approved, "Notice_of_application");
    assert.doesNotMatch(lineWith(noa, "<!-- statement_of_law_id 1 -->"), /🧐/, "the approval matches the stored fields");
    assert.match(lineWith(noa, "<!-- law_assertion_id 1 -->"), /🧐/, "the proposition is not approved");
    assert.equal(approved.revision, before.revision, "an approval moves no revision");

    // The edit snapshots the pair it leaves (v47), so the statement stays verified and reads 🧐, not 🔬.
    await submissionDataExecute(
      f.dbPath,
      "UPDATE statements_of_law SET excerpt = excerpt || '.', scrutinized_authority_id = authority_id, scrutinized_pinpoint = pinpoint, scrutinized_excerpt = excerpt || '.' WHERE id = 1;"
    );
    const edited = submissionFormsRender(f.dbPath, 1, ASHBOURNE);
    assert.match(markdownOf(edited, "Notice_of_application"), /🧐 <!-- statement_of_law_id 1 -->$/m);
    const onNoa = reviewEntries(inventoryOf(edited), "Notice_of_application");
    assert.deepEqual(
      onNoa.filter((e) => e.table === "statements_of_law"),
      [{ generating: false, marker: "🧐", table: "statements_of_law", id: 1, item: REVIEWED_ITEM, doc: "Notice_of_application", changed: true }]
    );
    const propositionEntry = onNoa.find((e) => e.table === "law_assertions" && e.id === 1);
    assert.ok(propositionEntry, "the proposition still reads 🧐");
    assert.equal("changed" in propositionEntry, false, "never approved, so never changed");
  } finally {
    f.cleanup();
  }
});

test("final review: a render change with no stored-field change raises nothing", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedVerifiedReviewCase(f.dbPath);
    await approve(f.dbPath, "statements_of_law", 1);

    // The frontmatter and the stamp change; the statement's stored fields do not.
    const other = submissionFormsRender(f.dbPath, 1, { clientName: "Other", clientNo: "0000", matterNo: "L0000" });
    assert.doesNotMatch(lineWith(markdownOf(other, "Notice_of_application"), "<!-- statement_of_law_id 1 -->"), /🧐/);
  } finally {
    f.cleanup();
  }
});

test("final review: a treatment change after approval re-raises 🧐 on the statement line (#1200)", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedVerifiedReviewCase(f.dbPath);
    await approve(f.dbPath, "statements_of_law", 1);
    const statementLine = () => lineWith(markdownOf(submissionFormsRender(f.dbPath, 1, ASHBOURNE), "Notice_of_application"), "<!-- statement_of_law_id 1 -->");
    assert.doesNotMatch(statementLine(), /🧐/, "approved as good law");

    await submissionDataExecute(f.dbPath, "UPDATE authorities SET treatment = 'distinguishable' WHERE id = 1;");
    assert.match(statementLine(), /⚠️🧐 <!-- statement_of_law_id 1 -->$/, "counsel has not reviewed the new treatment");
    await approve(f.dbPath, "statements_of_law", 1);
    assert.match(statementLine(), /⚠️ <!-- statement_of_law_id 1 -->$/, "approved with the treatment it now carries");

    await submissionDataExecute(f.dbPath, "UPDATE authorities SET treatment = 'negative' WHERE id = 1;");
    assert.match(statementLine(), /🚨🧐 <!-- statement_of_law_id 1 -->$/, "⚠️ to 🚨 is a new routing decision");
  } finally {
    f.cleanup();
  }
});

test("final review: a proposition with an overruled statement reads ⛔🧐 until approved, and a later overruling re-raises it (#1200)", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedVerifiedReviewCase(f.dbPath);
    await submissionDataExecute(
      f.dbPath,
      `INSERT INTO authorities (id, proceeding_id, style_of_cause_or_title, citation, kind, treatment)
         VALUES (2, 1, 'Second Authority v. Example', '2019 BCCA 9', 'case', 'good_law');
       INSERT INTO statements_of_law (id, proceeding_id, law_assertion_id, authority_id, pinpoint, excerpt, source, verification)
         VALUES (2, 1, 1, 2, 'para 9', 'A second passage.', 'primary', 'verified');`
    );
    await approve(f.dbPath, "law_assertions", 1);
    const noa = () => markdownOf(submissionFormsRender(f.dbPath, 1, ASHBOURNE), "Notice_of_application");
    const proposition = () => lineWith(noa(), "<!-- law_assertion_id 1 -->");
    assert.match(proposition(), /^\d+\. a proposition counsel reviews <!-- law_assertion_id 1 -->$/, "approved, both statements good law");

    await submissionDataExecute(f.dbPath, "UPDATE authorities SET treatment = 'overruled' WHERE id = 2;");
    assert.match(proposition(), /reviews \(overruled: Second Authority v\. Example, 2019 BCCA 9\) ⛔🧐 <!-- law_assertion_id 1 -->$/, "a counted statement survives, so the line asks counsel to confirm the overruling, naming the authority (#1202)");
    assert.doesNotMatch(noa(), /statement_of_law_id 2 -->/, "the overruled statement still rides the brief-only cap");

    await approve(f.dbPath, "law_assertions", 1);
    assert.match(proposition(), /reviews \(overruled: Second Authority v\. Example, 2019 BCCA 9\) ⛔ <!-- law_assertion_id 1 -->$/, "approved: the bare ⛔ names the routing decision left");

    await submissionDataExecute(f.dbPath, "UPDATE authorities SET killed_on = '2026-09-27' WHERE id = 2;");
    assert.match(proposition(), /reviews <!-- law_assertion_id 1 -->$/, "the kill is counsel's own act: no ⛔, and no 🧐 re-raised");
  } finally {
    f.cleanup();
  }
});

test("the proposition line names each overruled authority once, and the filed face never shows the tag (#1202)", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedVerifiedReviewCase(f.dbPath);
    // Authority 2 is cited twice, its title and citation both carry the delimiters a naive strip
    // would stop at; authority 3 has no citation and a line break in its title.
    await submissionDataExecute(
      f.dbPath,
      `INSERT INTO authorities (id, proceeding_id, style_of_cause_or_title, citation, kind, treatment)
         VALUES (2, 1, 'Re Smith (Bankrupt)', '[1990] 1 S.C.R. 1', 'case', 'overruled'),
                (3, 1, 'Jones
   v. Brown', NULL, 'case', 'overruled');
       INSERT INTO statements_of_law (id, proceeding_id, law_assertion_id, authority_id, pinpoint, excerpt, source, verification)
         VALUES (2, 1, 1, 2, 'p. 5', 'A second passage.', 'primary', 'verified'),
                (3, 1, 1, 3, 'para 2', 'A third passage.', 'primary', 'verified'),
                (4, 1, 1, 2, 'p. 9', 'A fourth passage.', 'primary', 'verified');`
    );
    // The filed face refuses while the associate-judge sentence is undetermined.
    await submissionDataExecute(f.dbPath, "INSERT INTO hearing_details (filing_id, associate_judge) VALUES (1, 1);");
    const tag = "(overruled: Re Smith (Bankrupt), [1990] 1 S.C.R. 1; Jones v. Brown)";
    const mockup = () => submissionFormsRender(f.dbPath, 1, ASHBOURNE);
    const proposition = () => lineWith(markdownOf(mockup(), "Notice_of_application"), "<!-- law_assertion_id 1 -->");
    assert.ok(proposition().endsWith(`reviews ${tag} ⛔🧐 <!-- law_assertion_id 1 -->`), proposition());

    await approve(f.dbPath, "law_assertions", 1);
    assert.ok(proposition().endsWith(`reviews ${tag} ⛔ <!-- law_assertion_id 1 -->`), proposition());
    await submissionDataExecute(f.dbPath, "UPDATE authorities SET style_of_cause_or_title = 'Re Smith (A Bankrupt)' WHERE id = 2;");
    assert.ok(proposition().endsWith("Jones v. Brown) ⛔ <!-- law_assertion_id 1 -->"), "a change to the tag's text re-raises no 🧐");

    const filed = submissionFormsRender(f.dbPath, 1, ASHBOURNE, "filed");
    assert.ok(filed.documents.length > 0, `expected the filed render to deliver: ${filed.note ?? ""}`);
    assertFiledFaceDocumentsClean(filed.documents);
    for (const doc of filed.documents) {
      const trace = doc.markdown.split("\n").find((l) => /overruled|\bSmith\b|Bankrupt|S\.C\.R\.|Jones/.test(l));
      assert.equal(trace, undefined, `expected no trace of the tag in ${doc.file_name}`);
    }
    assert.match(lineWith(markdownOf(filed, "Notice_of_application"), "a proposition counsel reviews"), /reviews$/);

    await submissionDataExecute(f.dbPath, "UPDATE law_assertions SET dead_end = 1 WHERE id = 1;");
    assert.doesNotMatch(proposition(), /overruled/, "🚧 owns the line, so no ⛔ prints and no tag beside it");
    await submissionDataExecute(f.dbPath, "UPDATE law_assertions SET dead_end = 0 WHERE id = 1;");

    await submissionDataExecute(f.dbPath, "UPDATE authorities SET killed_on = '2026-09-28' WHERE id IN (2, 3);");
    assert.match(proposition(), /reviews <!-- law_assertion_id 1 -->$/, "a killed overruled authority is named nowhere on the line");
  } finally {
    f.cleanup();
  }
});

test("final review: 🧐 never reaches a filed face or the reserve inventory", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedVerifiedReviewCase(f.dbPath);
    // The filed face refuses while the associate-judge sentence is undetermined.
    await submissionDataExecute(f.dbPath, "INSERT INTO hearing_details (filing_id, associate_judge) VALUES (1, 1);");

    const filed = submissionFormsRender(f.dbPath, 1, ASHBOURNE, "filed");
    assert.ok(filed.documents.length > 0, `expected the filed render to deliver: ${filed.note ?? ""}`);
    assertFiledFaceDocumentsClean(filed.documents);
    for (const doc of filed.documents) assert.ok(!doc.markdown.includes("🧐"), `expected no 🧐 in ${doc.file_name}`);

    const mockup = submissionFormsRender(f.dbPath, 1, ASHBOURNE);
    assert.ok(markdownOf(mockup, "Notice_of_application").includes("🧐"), "the mockup carries it");
    assert.ok(
      !inventoryOf(mockup).some((e) => e.marker === "🧐" && (e.doc === RESERVE_INVENTORY_DOC || e.doc === "Work_board")),
      "no 🧐 entry names a never-delivered document"
    );
  } finally {
    f.cleanup();
  }
});

test("final review: 🧐 derives no Proposal, and a stamp hit serves its changed entry back", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedVerifiedReviewCase(f.dbPath);
    await approve(f.dbPath, "statements_of_law", 1);
    // The edit snapshots the pair it leaves (v47), so the statement stays verified and reads 🧐, not 🔬.
    await submissionDataExecute(
      f.dbPath,
      "UPDATE statements_of_law SET excerpt = excerpt || '.', scrutinized_authority_id = authority_id, scrutinized_pinpoint = pinpoint, scrutinized_excerpt = excerpt || '.' WHERE id = 1;"
    );

    const first = submissionFormsRender(f.dbPath, 1, ASHBOURNE, "mockup", undefined, undefined, undefined, "2026-09-20 10:00");
    assert.equal(boardDataOf(f.dbPath, 1, ASHBOURNE).proposals.some((p) => p.marker === "🧐"), false);
    assert.ok(inventoryOf(first).some((e) => e.marker === "🧐" && e.changed === true), "the edited statement's entry is changed");

    // Same stamp, no writes: the manifest is read back, and it is a hit only if every entry passed isInventoryEntry.
    const second = submissionFormsRender(f.dbPath, 1, ASHBOURNE, "mockup", undefined, undefined, undefined, "2026-09-20 10:05");
    assert.equal(second.rendered_at, first.rendered_at, "the second render is a stamp hit");
    assert.deepEqual(inventoryOf(second), inventoryOf(first));
    assert.ok(criterionOf(boardDataOf(f.dbPath, 1, ASHBOURNE), "counsel-review").items.includes(REVIEWED_ITEM), "the hit's board reads the saved 🧐 entries");
  } finally {
    f.cleanup();
  }
});

const { STAY_RESPONSE_CASE_DATA, STAY_RESPONSE_SEED, STAY_RESPONSE_POSITIONS } = await import("./fixtures/bcca-stay-response-seed.mjs");
const { FACTUM_CASE_DATA, FACTUM_SEED } = await import("./fixtures/bcca-factum-seed.mjs");

test("final review: a BCCA Part 4 order line prints 🧐 and records it on the order", async () => {
  const cases = [
    { seed: STAY_RESPONSE_SEED + STAY_RESPONSE_POSITIONS, caseData: STAY_RESPONSE_CASE_DATA, doc: "Response_book", item: "The application is dismissed, with costs." },
    { seed: FACTUM_SEED, caseData: FACTUM_CASE_DATA, doc: "Factum", item: "that the appeal be dismissed, with costs to the respondents." },
  ];
  for (const { seed, caseData, doc, item } of cases) {
    const f = seededDbFixture();
    try {
      await freshSubmissionDb(f.dbPath);
      writePartiesOfRecord(dirname(f.dbPath), caseData);
      await submissionDataExecute(f.dbPath, seed);
      const result = submissionFormsRender(f.dbPath, 1, ASHBOURNE);
      assert.match(lineWith(markdownOf(result, doc), "<!-- order_sought_id 1 -->"), / 🧐 <!-- order_sought_id 1 -->$/, `${doc}: the order line reads 🧐`);
      assert.deepEqual(
        reviewEntries(inventoryOf(result), doc).filter((e) => e.table === "order_sought"),
        [{ generating: false, marker: "🧐", table: "order_sought", id: 1, item, doc }]
      );
    } finally {
      f.cleanup();
    }
  }
});

test("final review: a Notice of Application Part 1 order with a clean ladder prints 🧐", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedVerifiedReviewCase(f.dbPath);
    // Order 1 rests on the verified statement, is served by the submission and sits on the Written
    // Arguments, so no 🏛️ ladder glyph, 🦵 or 🧵 holds 🧐 back.
    await submissionDataExecute(
      f.dbPath,
      `INSERT INTO order_sought_requires (order_sought_id, law_assertion_id, excerpt_id, basis_state) VALUES (1, 1, 1, 'filled');
       INSERT INTO order_sought_served_by (order_sought_id, submission_id) VALUES (1, 1);
       INSERT INTO filing_orders (filing_id, order_sought_id, document, ordinal) VALUES (1, 1, 'written_argument', 1);`
    );
    const result = submissionFormsRender(f.dbPath, 1, ASHBOURNE);
    assert.match(lineWith(markdownOf(result, "Notice_of_application"), "<!-- order 1 -->"), /^1\. damages to be assessed 🧐 <!-- order 1 -->$/);
    assert.deepEqual(
      reviewEntries(inventoryOf(result), "Notice_of_application").filter((e) => e.table === "order_sought"),
      [{ generating: false, marker: "🧐", table: "order_sought", id: 1, item: "damages to be assessed", doc: "Notice_of_application" }]
    );
  } finally {
    f.cleanup();
  }
});

test("final review: a change to the order's basis after approval re-raises 🧐 on its line, on the Notice of Application and the Written Arguments (#1201)", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedVerifiedReviewCase(f.dbPath);
    await submissionDataExecute(
      f.dbPath,
      `INSERT INTO order_sought_requires (order_sought_id, law_assertion_id, excerpt_id, basis_state) VALUES (1, 1, 1, 'filled');
       INSERT INTO order_sought_served_by (order_sought_id, submission_id) VALUES (1, 1);
       INSERT INTO filing_orders (filing_id, order_sought_id, document, ordinal) VALUES (1, 1, 'written_argument', 1);`
    );
    const orderLines = () => {
      const result = submissionFormsRender(f.dbPath, 1, ASHBOURNE);
      return [lineWith(markdownOf(result, "Notice_of_application"), "<!-- order 1 -->"), lineWith(markdownOf(result, "Written_arguments"), "<!-- relief_item a -->")];
    };
    const expectBoth = (pattern, message) => {
      for (const line of orderLines()) assert.match(line, pattern, message);
    };
    await approve(f.dbPath, "order_sought", 1);
    expectBoth(/assessed <!-- (order 1|relief_item a) -->$/, "approved on a good-law basis");

    await submissionDataExecute(f.dbPath, "UPDATE authorities SET treatment = 'distinguishable' WHERE id = 1;");
    expectBoth(/assessed ⚠️🧐 <!--/, "counsel has not reviewed the basis's new treatment");
    await approve(f.dbPath, "order_sought", 1);
    expectBoth(/assessed ⚠️ <!--/, "approved with the treatment it now carries");
    await submissionDataExecute(f.dbPath, "UPDATE authorities SET treatment = 'negative' WHERE id = 1;");
    expectBoth(/assessed 🚨🧐 <!--/, "⚠️ to 🚨 is a new routing decision");
    await approve(f.dbPath, "order_sought", 1);

    await submissionDataExecute(f.dbPath, "UPDATE order_sought SET wording = wording || ' forthwith' WHERE id = 1;");
    expectBoth(/forthwith 🚨🧐 <!--/, "a wording change still re-raises it");
    await approve(f.dbPath, "order_sought", 1);

    await submissionDataExecute(f.dbPath, "UPDATE authorities SET treatment = 'overruled' WHERE id = 1;");
    expectBoth(/forthwith ⛔🏛️ <!--/, "an overruled basis reads exactly ⛔🏛️, the 🏛️ holding 🧐 back");
    // The research lawyer replaces the basis with an authority of the treatment the order was last
    // approved with (🚨). The order was approved on the old authority, so counsel reviews it again:
    // the key carries which statement fills the basis, not only its treatment.
    await submissionDataExecute(
      f.dbPath,
      `INSERT INTO authorities (id, proceeding_id, style_of_cause_or_title, citation, kind, treatment)
         VALUES (3, 1, 'Replacement Authority v. Example', '2024 BCCA 3', 'case', 'negative');
       INSERT INTO statements_of_law (id, proceeding_id, law_assertion_id, authority_id, pinpoint, excerpt, source, verification)
         VALUES (3, 1, 1, 3, 'para 7', 'The replacement passage.', 'primary', 'verified');
       UPDATE order_sought_requires SET excerpt_id = 3 WHERE order_sought_id = 1;`
    );
    expectBoth(/forthwith 🚨🧐 <!--/, "a replaced basis re-raises it, even with the treatment the order was approved with");

    await submissionDataExecute(f.dbPath, "UPDATE authorities SET killed_on = '2026-09-27' WHERE id = 3;");
    expectBoth(/forthwith 🏛️ <!--/, "a killed basis reads exactly 🏛️, with no 🧐");
  } finally {
    f.cleanup();
  }
});

test("final review: a NULL note-up note snapshots byte-identical to the pre-v51 keys, and a note re-raises 🧐 on the statement and order lines (schema v51)", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedVerifiedReviewCase(f.dbPath);
    await submissionDataExecute(
      f.dbPath,
      `INSERT INTO order_sought_requires (order_sought_id, law_assertion_id, excerpt_id, basis_state) VALUES (1, 1, 1, 'filled');
       INSERT INTO order_sought_served_by (order_sought_id, submission_id) VALUES (1, 1);
       INSERT INTO filing_orders (filing_id, order_sought_id, document, ordinal) VALUES (1, 1, 'written_argument', 1);`
    );
    const snapshots = (noteHeld) =>
      ["statements_of_law", "order_sought"].map((t) => submissionDataQuery(f.dbPath, `SELECT ${reviewSnapshotSql(t, noteHeld)} AS s FROM ${t} WHERE id = 1`).rows[0].s);
    assert.deepEqual(snapshots(true), snapshots(false), "a NULL note computes the pre-v51 bytes");
    assert.equal(snapshots(true)[0], '{"excerpt":"The passage.","pinpoint":"para 4","treatment":"good_law"}');
    assert.equal(JSON.parse(snapshots(true)[1]).basis_statements, "1:good_law");

    await approve(f.dbPath, "statements_of_law", 1);
    await approve(f.dbPath, "order_sought", 1);
    const lines = () => {
      const result = submissionFormsRender(f.dbPath, 1, ASHBOURNE);
      return [lineWith(markdownOf(result, "Notice_of_application"), "<!-- statement_of_law_id 1 -->"), lineWith(markdownOf(result, "Notice_of_application"), "<!-- order 1 -->")];
    };
    for (const line of lines()) assert.doesNotMatch(line, /🧐/, "approved with no note");

    await submissionDataExecute(f.dbPath, "UPDATE authorities SET treatment_note = 'CanLII: noted up (2021 BCSC 2: 2 citing decisions; 2 read)' WHERE id = 1;");
    const [statement, order] = snapshots(true);
    assert.notDeepEqual([statement, order], snapshots(false), "a note changes both snapshots");
    assert.equal(JSON.parse(statement).treatment, "good_law — CanLII: noted up (2021 BCSC 2: 2 citing decisions; 2 read)");
    assert.equal(JSON.parse(order).basis_statements, "1:good_law — CanLII: noted up (2021 BCSC 2: 2 citing decisions; 2 read)");
    for (const line of lines()) assert.match(line, /🧐 <!--/, "counsel has not reviewed the note");
  } finally {
    f.cleanup();
  }
});

test("final review: a Form 8 order printing ⬜ carries no 🧐, and a clean one beside it does", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedBcscDefaultJudgment(f.dbPath);
    // No 🦵 on a Form 8 (#960); order 1's template is unchosen, so its provision prints ⬜.
    await submissionDataExecute(
      f.dbPath,
      `INSERT INTO submissions (id, proceeding_id, contention, ordinal) VALUES (1, 1, 'The defendant is in default.', 1);
       INSERT INTO order_sought_served_by (order_sought_id, submission_id) VALUES (1, 1), (2, 1);
       UPDATE order_sought SET template_key = NULL WHERE id = 1;`
    );
    const result = submissionFormsRender(f.dbPath, 1, ASHBOURNE);
    const form8 = markdownOf(result, "Default_judgment");
    const unchosen = lineWith(form8, "<!-- order_sought_id 1 -->");
    assert.match(unchosen, /⬜/);
    assert.doesNotMatch(unchosen, /🧐/, "⬜ is a 1a work marker, so it holds 🧐 back");
    assert.match(lineWith(form8, "<!-- order_sought_id 2 -->"), / 🧐 <!-- order_sought_id 2 -->$/);
    const entries = reviewEntries(inventoryOf(result), "Default_judgment").filter((e) => e.table === "order_sought");
    // Order 3, the alternative, is clean too now that no 🦵 holds its 🧐 back (#960).
    assert.deepEqual(entries.map((e) => e.id), [2, 3]);
  } finally {
    f.cleanup();
  }
});

// Plan Phase 15: the card's criteria are the stored layout's goal_criteria (spec §5 "Milestone";
// shared/declared-layout.md sections 5-6), never the kind. Each count below is the declared list;
// `gate` follows on every card, and `hearing-date` after it where the type declares it.

test("goal: the Notice of Application's stored layout gives primary-authority first and its seven declared criteria above the gate, then the gate and hearing-date", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedNoticeOfApplication(f.dbPath);
    const data = (submissionFormsRender(f.dbPath, 1, ASHBOURNE), boardDataOf(f.dbPath, 1, ASHBOURNE));
    assert.equal(NOA_DECLARED.length + ["gate"].length, 8, "the plan's eight: the declared criteria and the gate row");
    assert.deepEqual(data.criteria.map((c) => c.id), NOA_CRITERIA);
    assert.equal(criterionOf(data, "orders-sought").text, "Every order asked for has a legal basis and a submission behind it");
  } finally {
    f.cleanup();
  }
});

// The practitioner reads the completion criteria top to bottom as the order to work in. No `tickets`
// line: an open job holds the gate line instead.
test("goal: the Notice of Application's criteria lane prints its completion criteria in the work order, gate before hearing-date, with no tickets line", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedNoticeOfApplication(f.dbPath);
    submissionFormsRender(f.dbPath, 1, ASHBOURNE);
    const card = submissionFormsBoardCard({ db_path: f.dbPath, filing_id: 1, lanes: ["criteria"] }, ASHBOURNE).card;
    const [head, ...criterionLines] = card.split("\n");
    assert.ok(head.startsWith("🎯 Completion criteria: "), card);
    assert.deepEqual(
      criterionLines.map((line) => /^- \S+ ([a-z-]+)/.exec(line)[1]),
      ["primary-authority", "excerpts", "noting-up", "evidence", "counsel-review", "open-items", "orders-sought", "gate", "hearing-date"],
      card
    );
  } finally {
    f.cleanup();
  }
});

// board_card's criteria lane prints each criterion with its counts and its ` — items` tail. An
// inventory criterion counts unmet, met (shelved) and total (flagged or shelved) items; the gate its
// open steps or jobs. The summary lists the unmet criteria in the same lines without the items and
// names the met ones by id.
test("goal: board_card's criteria lane prints each criterion with its counts and items, the summary the unmet ones without items", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedNoticeOfApplication(f.dbPath);
    const summary = submissionFormsRender(f.dbPath, 1, ASHBOURNE, "mockup", ["Work_board"]).documents.find((d) => d.document_type === "Work_board").board_summary.split("\n");
    const card = submissionFormsBoardCard({ db_path: f.dbPath, filing_id: 1, lanes: ["criteria"] }, ASHBOURNE).card.split("\n");
    const { criteria } = boardDataOf(f.dbPath, 1, ASHBOURNE);
    const glyph = { met: "✅", unmet: "❌", pending: "⏳" };
    const counts = (c) =>
      c.id === "gate"
        ? c.outstanding > 0
          ? ` (${c.outstanding} open)`
          : ""
        : c.source === "inventory"
          ? ` (unmet ${c.outstanding}, met ${c.items.length - c.outstanding}, total ${c.items.length})`
          : "";
    const line = (c) => `- ${glyph[c.state]} ${c.id}: ${c.text}${counts(c)}`;

    assert.equal(criteria.length, 9);
    assert.ok(criteria.some((c) => c.items.length > 0), "the fixture has items to print");
    assert.ok(criteria.some((c) => c.source === "inventory" && c.id !== "gate"), "the fixture has inventory criteria to count");
    assert.equal(criteria.some((c) => c.state === "pending"), false, "a rendered filing has an inventory, so nothing is pending");
    assert.ok(card[0].startsWith("🎯 Completion criteria: "), card[0]);
    // Items with the same text print once, as `<item> ×<n> (at <locators>)`.
    const itemsText = (c) =>
      [...new Set(c.items)]
        .map((item) => {
          const at = c.items.flatMap((other, i) => (other === item ? [c.locators?.[i]] : []));
          return at.length === 1 ? item : `${item} ×${at.length} (at ${at.join(", ")})`;
        })
        .join("; ");
    assert.deepEqual(card.slice(1), criteria.map((c) => line(c) + (c.items.length === 0 ? "" : ` — ${itemsText(c)}`)));

    const unmet = criteria.filter((c) => c.state !== "met");
    assert.ok(unmet.length > 0, "the fixture has unmet criteria");
    const from = summary.indexOf("Unmet completion criteria:");
    assert.ok(from > 0, summary.join("\n"));
    assert.deepEqual(summary.slice(from + 1, from + 1 + unmet.length), unmet.map(line));
    const met = criteria.filter((c) => c.state === "met").map((c) => c.id);
    assert.equal(summary[from + 1 + unmet.length], `Met completion criteria: ${met.length === 0 ? "none" : met.join(", ")}`);
    assert.equal(summary.length, from + 2 + unmet.length, "nothing follows the met criteria");
  } finally {
    f.cleanup();
  }
});

// The criteria lane prints items with the same text once, with a count and the row of each; the
// counts still count every item, and the board data keeps every item for the page.
const OPEN_ITEMS_LINE = "open-items: Nothing is left open on the form";
function openItemsCardLine(dbPath) {
  const card = submissionFormsBoardCard({ db_path: dbPath, filing_id: 1, lanes: ["criteria"] }, ASHBOURNE, GOAL_NOW).card;
  const line = card.split("\n").find((l) => l.includes(OPEN_ITEMS_LINE));
  assert.ok(line, card);
  return line;
}

test("goal: two open items with the same text print once as ×2 with each row, the third in full after them, and the counts count all three", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedNoticeOfApplication(f.dbPath);
    const same = "Example section format: a long paragraph that repeats";
    const other = "Example section not written";
    const data = boardWithInventory(f.dbPath, [
      countedEntry("🧩", "filing_prose", 11, same),
      countedEntry("🧩", "filing_prose", 12, same),
      countedEntry("🧩", "filing_prose", 13, other),
    ]);
    assert.deepEqual(criterionOf(data, "open-items").items, [same, same, other], "the board data keeps every item");
    assert.equal(
      openItemsCardLine(f.dbPath),
      `- ❌ ${OPEN_ITEMS_LINE} (unmet 3, met 0, total 3) — ${same} ×2 (at 🧩:filing_prose:11, 🧩:filing_prose:12); ${other}`
    );
  } finally {
    f.cleanup();
  }
});

test("goal: open items with the same text on different documents print in full, in order", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedNoticeOfApplication(f.dbPath);
    const first = "Example Affidavit #1, paragraph 2: linked fact";
    const second = "Example Affidavit #2, paragraph 2: linked fact";
    const data = boardWithInventory(f.dbPath, [countedEntry("🧩", "statement_paragraphs", 21, first), countedEntry("🧩", "statement_paragraphs", 22, second)]);
    assert.equal(criterionOf(data, "open-items").locators, undefined, "no item repeats, so no locators");
    assert.equal(openItemsCardLine(f.dbPath), `- ❌ ${OPEN_ITEMS_LINE} (unmet 2, met 0, total 2) — ${first}; ${second}`);
  } finally {
    f.cleanup();
  }
});

test("goal: an open-items criterion with no items prints no items tail", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedNoticeOfApplication(f.dbPath);
    boardWithInventory(f.dbPath, []);
    assert.equal(openItemsCardLine(f.dbPath), `- ✅ ${OPEN_ITEMS_LINE} (unmet 0, met 0, total 0)`);
  } finally {
    f.cleanup();
  }
});

test("goal: an open job leaves the Notice of Application's gate line unmet, naming it, and a recorded hearing date meets hearing-date", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedNoticeOfApplication(f.dbPath);
    await submissionDataExecute(
      f.dbPath,
      `INSERT INTO tickets (id, proceeding_id, filing_id, title, intent, status, priority, kind, billing_anchor, created)
         VALUES (1, 1, 1, 'Draft the affidavit of service', 'Swear it before filing.', 'queued', 0, 'work', 'L9002|service', '2026-09-19T09:03');`
    );

    const open = boardWithInventory(f.dbPath, []);
    assert.deepEqual(criterionOf(open, "gate"), {
      id: "gate",
      text: "The pre-filing checks are passed or waived",
      state: "unmet",
      outstanding: 1,
      items: ["Draft the affidavit of service"],
      source: "sqlite",
    });
    assert.deepEqual(criterionOf(open, "hearing-date"), { id: "hearing-date", text: "The hearing date is recorded", state: "unmet", outstanding: 0, items: [], source: "sqlite" });
    const card = submissionFormsBoardCard({ db_path: f.dbPath, filing_id: 1, lanes: ["criteria"] }, ASHBOURNE, GOAL_NOW).card.split("\n");
    assert.equal(card.find((l) => l.startsWith("- ❌ gate: ")), "- ❌ gate: The pre-filing checks are passed or waived (1 open) — Draft the affidavit of service", "the gate counts the open job");
    assert.equal(card.find((l) => l.startsWith("- ❌ hearing-date: ")), "- ❌ hearing-date: The hearing date is recorded", "a criterion read off SQLite carries no count");
    assert.deepEqual(statesOf(open), allMetBut({ gate: "unmet", "hearing-date": "unmet" }));
    assert.deepEqual([open.goal.state, open.goal.text], ["unmet", null], "no card string applies while a job is open");

    await submissionDataExecute(f.dbPath, "INSERT INTO hearing_details (filing_id, hearing_date) VALUES (1, '2026-10-15');");
    assert.equal(criterionOf(boardWithInventory(f.dbPath, []), "hearing-date").state, "met");
  } finally {
    f.cleanup();
  }
});

test("goal: with every other row met, an unrecorded hearing date leaves the goal unmet, and an unserved notice of application is still ready to serve", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedNoticeOfApplication(f.dbPath);
    await submissionDataExecute(
      f.dbPath,
      `UPDATE db_meta SET value = '412' WHERE key = 'revision';
       INSERT INTO tickets (id, proceeding_id, filing_id, title, intent, status, priority, kind, billing_anchor, created, completed_at)
         VALUES (9, 1, 1, 'Pre-filing consistency gate', 'Run the pre-filing checks on the assembled package.', 'completed', 9, 'work', 'L9002|gate', '2026-09-20T09:00', '2026-09-21T08:05');
       INSERT INTO ticket_steps (ticket_id, ordinal, text, done_at) VALUES (9, 1, '${passStep(412)[0]}', '${passStep(412)[1]}');`
    );

    const data = boardWithInventory(f.dbPath, []);
    assert.deepEqual(statesOf(data), allMetBut({ "hearing-date": "unmet" }));
    // Amended Rule 8-1: the hearing date comes at set-down, after service, so it holds nothing back.
    assert.deepEqual([data.goal.state, data.goal.text], ["unmet", "Every drafting condition holds. Awaiting your approval to serve."]);
  } finally {
    f.cleanup();
  }
});

// E2E 2026-10-05 finding 4.3: a fact proved by a sworn affidavit's exhibits is re-checked against
// the exhibits the sworn version holds (documents.exhibit_letters, v56).
test("goal: a court-record fact citing Exhibits K-M of an affidavit sworn with A-J prints 📌 and leaves Evidence unmet, naming it", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedNoticeOfApplication(f.dbPath);
    const postulate = "The defendant received the Notice of Default on 2026-05-01.";
    await submissionDataExecute(
      f.dbPath,
      `INSERT INTO documents (id, proceeding_id, label, instrument, execution, affidavit_number, exhibit_letters)
         VALUES (2, 1, 'Affidavit #2 of S. Deponent', 'affidavit', '2026-08-12', '2', 'A-J');
       INSERT INTO facts (id, proceeding_id, postulate, court_record, court_record_pinpoint)
         VALUES (1, 1, '${postulate}', 2, 'Affidavit #2 of S. Deponent, Exhibits K-M');
       INSERT INTO filing_facts (filing_id, fact_id, document, part, ordinal) VALUES (1, 1, 'form', 'part2', 1);`
    );
    const factLine = () => {
      const noa = submissionFormsRender(f.dbPath, 1, ASHBOURNE).documents.find((d) => d.document_type === "Notice_of_application");
      const line = noa.markdown.split("\n").find((l) => l.startsWith(`1. ${postulate}`));
      assert.ok(line, noa.markdown);
      return line;
    };

    // The seed's own document owes an evidence item too, so the fact is checked by name.
    assert.match(factLine(), /📌/);
    const evidence = criterionOf(boardDataOf(f.dbPath, 1, ASHBOURNE), "evidence");
    assert.equal(evidence.state, "unmet");
    assert.ok(evidence.items.includes(postulate), JSON.stringify(evidence.items));

    await submissionDataExecute(f.dbPath, "UPDATE documents SET exhibit_letters = 'A-M' WHERE id = 2;");
    assert.doesNotMatch(factLine(), /📌/);
    const cleared = criterionOf(boardDataOf(f.dbPath, 1, ASHBOURNE), "evidence");
    assert.ok(!cleared.items.includes(postulate), JSON.stringify(cleared.items));
  } finally {
    f.cleanup();
  }
});

/** Migrates a fresh database to v29, the last version before the Writing model, through the engine. */
function migrateToV29(dbPath) {
  const done = spawnSync(
    process.env.COCLERK_PYTHON || "python",
    ["-c", "import sys; sys.path.insert(0, sys.argv[1]); import migrate_engine as e; e.migrate(sys.argv[2], target_version=29)", submissionDataMigrateScriptsDir(process.env), dbPath],
    { encoding: "utf-8" }
  );
  assert.equal(done.status, 0, done.stderr);
}

test("goal: an L8443-shaped Notice of Application migrated through the v30 backfill still renders its eight criteria (seven declared and the gate), then hearing-date", async () => {
  const f = seededDbFixture();
  try {
    migrateToV29(f.dbPath);
    await seedNoticeOfApplication(f.dbPath, { snapshot: false });
    // A database older than case_party_id is migrated to v42, where its parties can be linked, and the
    // drop of the counsel copy (v43) refuses until they are.
    await assert.rejects(submissionDataMigrate(f.dbPath), (err) => err.code === "counsel_not_reconciled" && /first migrated to schema version 42/.test(err.message));
    await submissionDataExecute(f.dbPath, "UPDATE parties SET case_party_id = id;");
    const migrated = await submissionDataMigrate(f.dbPath);
    assert.deepEqual(migrated.applied, hopsFrom(42), JSON.stringify(migrated));
    const [row] = submissionDataQuery(f.dbPath, "SELECT layout_snapshot FROM filings WHERE id = 1").rows;
    assert.deepEqual(Object.keys(JSON.parse(row.layout_snapshot)), ["layout", "venue", "passage_hashes"], "the v30 backfill's three-member snapshot");

    const data = (submissionFormsRender(f.dbPath, 1, ASHBOURNE), boardDataOf(f.dbPath, 1, ASHBOURNE));
    assert.deepEqual(data.criteria.map((c) => c.id), NOA_CRITERIA);
    assert.equal(data.criteria.filter((c) => c.id !== "hearing-date").length, 8);
    assert.equal(data.goal.sentence, "Completion Criteria");
  } finally {
    f.cleanup();
  }
});

const GENERAL_CLIENT = { clientName: "Ada Client", clientNo: "0001", matterNo: "L0000" };
const GENERAL_NOW = "2026-09-25 10:00";
const renderGeneral = (g, id) => {
  const result = submissionFormsRender(g.dbPath, id, GENERAL_CLIENT, "mockup", undefined, undefined, undefined, GENERAL_NOW);
  return { ...result, board: boardDataOf(g.dbPath, id, GENERAL_CLIENT, GENERAL_NOW) };
};

test("goal: an opposing-counsel letter carries the #951 note's four criteria and open-items, then the gate; unwritten it reads unmet, written, approved and citing nothing it reads met with the to-send text (#1213)", async (t) => {
  const g = await generalWritingFixture(t);
  const { filing_id } = await g.createLetter();
  const unwritten = renderGeneral(g, filing_id).board;
  assert.deepEqual(unwritten.criteria.map((c) => c.id), ["primary-authority", "excerpts", "noting-up", "open-items", "counsel-review", ...UNIVERSAL]);
  assert.equal(unwritten.criteria.find((c) => c.id === "gate").text, "The pre-send checks are passed or waived");
  assert.equal(criterionOf(unwritten, "open-items").state, "unmet");
  assert.equal(unwritten.goal.state, "unmet", "a freshly saved letter with no body is not ready to send");

  for (const [slot, text] of [["addressee", "Cara Counsel"], ["body", "We write about the late objection."], ["sender", "Fixture Law LLP"]]) await g.prose(filing_id, slot, text);
  for (const { id } of submissionDataQuery(g.dbPath, `SELECT id FROM filing_prose WHERE filing_id = ${filing_id}`).rows) await approve(g.dbPath, "filing_prose", id);
  const data = renderGeneral(g, filing_id).board;
  assert.deepEqual(statesOf(data), Object.fromEntries(data.criteria.map((c) => [c.id, "met"])), "a written, approved Writing that cites nothing reads met");
  assert.deepEqual(data.goal, { sentence: "Completion Criteria", state: "met", text: "Every condition holds. Awaiting your approval to send." });
});

test("goal: an internal memo carries its three declared criteria, then the gate", async (t) => {
  const g = await generalWritingFixture(t);
  g.f.local(MEMO_FILE, knowledgeFile(null, { ...MEMO_BLOCK, goal_criteria: ["primary-authority", "excerpts", "noting-up"] }));
  const { filing_id } = await g.create({ proceeding_id: 1, tree: NO_VENUE_TREE, kind: "internal_memo", recipient: "internal", title: "Memo" });
  const data = renderGeneral(g, filing_id).board;
  assert.deepEqual(data.criteria.map((c) => c.id), ["primary-authority", "excerpts", "noting-up", ...UNIVERSAL]);
});

test("goal: a release carries terms-traced and its three other declared criteria, then the gate", async (t) => {
  const g = await generalWritingFixture(t);
  const part = (source) => ({ heading: null, heading_numbering: "none", paragraph_numbering: "none", source });
  g.f.local("draft/CAN/FX/_NoVenue/Documents/kinds.local.json", {
    kinds: [{ file: "release", name: "Release", recipient: "opposing-party", aliases: [{ name: "release", source: "agent", ref: "L0000", recorded: "2026-09-20" }] }],
  });
  g.f.local(
    "draft/CAN/FX/_NoVenue/Documents/release.md",
    knowledgeFile(null, {
      renderer: "general",
      needs_forum_parts: false,
      folder_code: "REL",
      title: "Release",
      exhibit_numbering: "writing",
      signer: "party",
      goal_criteria: ["terms-traced", "primary-authority", "excerpts", "counsel-review"],
      parts: [part("slot:body"), part("signature-block")],
    })
  );
  const { filing_id } = await g.create({ proceeding_id: 1, tree: NO_VENUE_TREE, kind: "release", recipient: "opposing-party", title: "Release", signer_party_id: 1 });
  const data = renderGeneral(g, filing_id).board;
  assert.deepEqual(data.criteria.map((c) => c.id), ["terms-traced", "primary-authority", "excerpts", "counsel-review", ...UNIVERSAL]);
  assert.equal(criterionOf(data, "terms-traced").text, "Every clause traces to the offer or acceptance");
});

test("goal: a no-forum Writing with an unmet Excerpts shows its gate row reading the Pre-send gate job, and the card takes the to-send text", async (t) => {
  // Cites nothing, so the render writes a manifest whose inventory the Sent write reads.
  const vetted = { ...LETTER_BLOCK, title: "Letter to opposing counsel", parts: LETTER_BLOCK.parts.map(({ rule_ref, ...rest }) => rest) };
  const g = await generalWritingFixture(t, { front: null, block: vetted });
  const { filing_id } = await g.createLetter();
  await g.prose(filing_id, "body", "We write about the late objection.");
  await g.execute(
    `INSERT INTO tickets (proceeding_id, filing_id, title, intent, kind, priority, billing_anchor, created)
       VALUES (1, ${filing_id}, 'Deliver', 'Send this letter to its recipients and record it as sent.', 'work', 0, 'L0000|late objection', '2026-09-25T09:00');`
  );
  const withInventory = (inventory) => {
    renderGeneral(g, filing_id);
    const manifest = manifestFileOf(g.dbPath, filing_id);
    writeFileSync(manifest, JSON.stringify({ ...JSON.parse(readFileSync(manifest, "utf-8")), inventory }), "utf-8");
    return renderGeneral(g, filing_id).board;
  };
  const unquoted = { generating: false, marker: "👃", instance: "law", table: "statements_of_law", id: 1, item: "Example v. Authority, 2020 BCSC 1", doc: "General_writing" };

  const before = withInventory([unquoted]);
  assert.deepEqual([criterionOf(before, "excerpts").state, criterionOf(before, "gate").state], ["unmet", "unmet"]);
  assert.deepEqual(criterionOf(before, "gate").items, ["Every excerpt is quoted, pinpointed and checked"], "with no job, the gate row names the held criterion");

  await assert.rejects(
    submissionDataRecordSent({ db_path: g.dbPath, filing_id, sent_on: "2026-09-25", sent_copy_text: "We write about the late objection.", expect_revision: fetchRevision(g.dbPath) }, g.seams.env),
    (err) => err.code === "held"
  );
  const step = `excerpts — Every excerpt is quoted, pinpointed and checked: unmet (1 open) [rev ${g.revision()}]`;
  const held = renderGeneral(g, filing_id).board;
  assert.deepEqual(
    criterionOf(held, "gate"),
    { id: "gate", text: "The pre-send checks are passed or waived", state: "unmet", outstanding: 1, items: [step], source: "sqlite" },
    "Pre-send gate and Deliver are not drafting work, so the row names no open job"
  );
  assert.equal(held.goal.text, null);

  // Excerpts met on the next render; the job still records the check at this revision.
  const fixed = withInventory([]);
  assert.equal(criterionOf(fixed, "excerpts").state, "met");
  assert.deepEqual([criterionOf(fixed, "gate").state, fixed.goal.text], ["unmet", "Drafting conditions hold. Pre-send checks: 1 open."]);
});

test("goal: a venue's letter reads the Pre-send gate, never the pre-filing gate, and after the Sent write its card still reads Filed (#1236)", async (t) => {
  const vetted = { ...LETTER_BLOCK, title: "Letter to opposing counsel", parts: LETTER_BLOCK.parts.map(({ rule_ref, ...rest }) => rest) };
  const g = await generalWritingFixture(t, { front: null, block: vetted });
  const part = (source) => ({ heading: null, heading_numbering: "none", paragraph_numbering: "none", source });
  g.f.local("draft/CAN/BC/BCSC/Documents/kinds.local.json", {
    kinds: [{ file: "letter", name: "Letter to the court", aliases: [{ name: "letter", source: "agent", ref: "L0000", recorded: "2026-09-20" }] }],
  });
  g.f.local(
    "draft/CAN/BC/BCSC/Documents/letter.md",
    knowledgeFile(null, {
      renderer: "general",
      needs_forum_parts: true,
      folder_code: "LTR",
      title: "Letter to the court",
      exhibit_numbering: "writing",
      goal_criteria: ["primary-authority", "excerpts", "noting-up"],
      parts: [part("slot:body")],
    })
  );
  const { filing_id } = await g.create({ proceeding_id: 2, tree: BCSC_TREE, kind: "letter", title: "Letter to the registry" });
  await g.prose(filing_id, "body", "We write about the late objection.");
  await g.execute(
    `INSERT INTO tickets (proceeding_id, filing_id, title, intent, kind, priority, billing_anchor, created)
       VALUES (2, ${filing_id}, 'Deliver', 'Send this letter to its recipients and record it as sent.', 'work', 0, 'L0000|late objection', '2026-09-25T09:00');`
  );
  const unquoted = { generating: false, marker: "👃", instance: "law", table: "statements_of_law", id: 1, item: "Example v. Authority, 2020 BCSC 1", doc: "General_writing" };
  renderGeneral(g, filing_id);
  const manifest = manifestFileOf(g.dbPath, filing_id);
  writeFileSync(manifest, JSON.stringify({ ...JSON.parse(readFileSync(manifest, "utf-8")), inventory: [unquoted] }), "utf-8");

  const before = renderGeneral(g, filing_id).board;
  assert.deepEqual(criterionOf(before, "gate").text, "The pre-send checks are passed or waived");
  assert.deepEqual(criterionOf(before, "gate").items, ["Every excerpt is quoted, pinpointed and checked"]);

  await submissionDataRecordSent({ db_path: g.dbPath, filing_id, sent_on: "2026-09-25", sent_copy_text: "We write about the late objection.", send_anyway: "Sending today.", expect_revision: fetchRevision(g.dbPath) }, g.seams.env);
  const after = renderGeneral(g, filing_id).board;
  assert.equal(after.goal.text, "Filed on 2026-09-25");
});

test("goal: with no Pre-send gate job, a no-forum Writing's gate row reads unmet while the currency check withholds a clause, and met once the result is current (#1229)", async (t) => {
  const g = await generalWritingFixture(t);
  const part = (source) => ({ heading: null, heading_numbering: "none", paragraph_numbering: source === "terms" ? "restart" : "none", source });
  g.f.local("draft/CAN/FX/_NoVenue/Documents/kinds.local.json", {
    kinds: [{ file: "release", name: "Release", recipient: "opposing-party", aliases: [{ name: "release", source: "agent", ref: "L0000", recorded: "2026-09-20" }] }],
  });
  g.f.local(
    "draft/CAN/FX/_NoVenue/Documents/release.md",
    knowledgeFile(null, {
      renderer: "general", needs_forum_parts: false, folder_code: "REL", title: "Release", exhibit_numbering: "writing", signer: "party",
      goal_criteria: ["terms-traced"], parts: [part("terms"), part("signature-block")],
    })
  );
  const { filing_id } = await g.create({ proceeding_id: 1, tree: NO_VENUE_TREE, kind: "release", recipient: "opposing-party", title: "Release", signer_party_id: 1 });
  await g.execute(`
INSERT INTO authorities (id, proceeding_id, style_of_cause_or_title, citation, kind, currency_status) VALUES (80, 1, 'Limitation Act', 'SBC 2012, c 13', 'statute', 'repealed');
INSERT INTO statements_of_law (id, proceeding_id, authority_id, pinpoint, excerpt, verification) VALUES (81, 1, 80, 's 6', 'The statute passage.', 'verified');
INSERT INTO clauses (id, proceeding_id, wording, basis, document_id, pinpoint, excerpt, excerpt_id) VALUES
  (1, 1, 'The Releasor accepts that the Limitation Act governs every claim.', 'implied', NULL, NULL, NULL, 81);
INSERT INTO filing_clauses (filing_id, clause_id, ordinal, wording_override) VALUES (${filing_id}, 1, 1, NULL);
`);
  const currency = "No implied clause names an enactment whose statute-currency result is not current";

  const withheld = renderGeneral(g, filing_id).board;
  assert.deepEqual(criterionOf(withheld, "gate"), { id: "gate", text: "The pre-send checks are passed or waived", state: "unmet", outstanding: 1, items: [currency], source: "inventory" });
  assert.equal(withheld.criteria.some((c) => c.id === "currency"), false, "currency is no Goal-card row of its own");
  assert.notEqual(withheld.goal.text, "Every condition holds. Awaiting your approval to send.");

  await g.execute("UPDATE authorities SET currency_status = 'current' WHERE id = 80;");
  assert.equal(criterionOf(renderGeneral(g, filing_id).board, "gate").state, "unmet", "the cited provision has no current result");
  await g.execute("INSERT INTO provision_currency (authority_id, provision, currency_status, checked_on, current_to) VALUES (80, 's 6', 'current', '2026-10-04', '2026-09-01');");
  assert.equal(criterionOf(renderGeneral(g, filing_id).board, "gate").state, "met");
});

// Amended Rule 8-1 (B.C. Reg. 105/2026): a notice recorded by record_served reads "Served on", and
// one filed the old way, with no served copy, still reads "Filed on".
test("goal: a served notice of application reads Served on its service date, and one filed under the old rule reads Filed", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedNoticeOfApplication(f.dbPath);
    seedSql(
      f.dbPath,
      `INSERT INTO documents (id, proceeding_id, label, document_date) VALUES (90, 1, 'Served copy — NOA', '2026-10-05');
       ${partiesSnapshotSql(f.dbPath, 1)} UPDATE filings SET filed_on = '2026-10-05', sent_copy_id = 90 WHERE id = 1;`
    );
    const served = boardWithInventory(f.dbPath, []);
    assert.equal(served.goal.text, "Served on 2026-10-05");
    await submissionDataExecute(f.dbPath, "UPDATE filings SET sent_copy_id = NULL WHERE id = 1;");
    assert.equal(boardWithInventory(f.dbPath, []).goal.text, "Filed on 2026-10-05");
  } finally {
    f.cleanup();
  }
});

test("tickets: Ready Serve the application and Serve the response jobs are skipped before the pre-filing gate", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedNoticeOfApplication(f.dbPath);
    await submissionDataExecute(
      f.dbPath,
      `INSERT INTO tickets (id, proceeding_id, filing_id, title, intent, status, priority, kind, billing_anchor, created)
         VALUES (1, 1, 1, 'Serve the application', 'Serve it.', 'queued', 0, 'work', 'L9002|bundle', '2026-09-24T09:00'),
                (2, 1, 1, 'Serve the response', 'Serve it.', 'queued', 0, 'work', 'L9002|bundle', '2026-09-24T09:01');
       INSERT INTO ticket_steps (ticket_id, ordinal, text) VALUES (1, 1, 'Serve'), (2, 1, 'Serve');`
    );
    const data = boardWithInventory(f.dbPath, []);
    assert.equal(criterionOf(data, "gate").state, "unmet");
    assert.deepEqual(ticketIn(data, 1).dispatch_skips, [{ reason: "before_gate" }]);
    assert.deepEqual(ticketIn(data, 2).dispatch_skips, [{ reason: "before_gate" }]);
  } finally {
    f.cleanup();
  }
});

// jobs-stock.md §3b is the one list of the stock jobs' fixed titles: the board's STOCK_TITLES is it.
test("STOCK_TITLES is exactly the bold titles of jobs-stock.md §3b", () => {
  const md = readFileSync(join(import.meta.dirname, "../../../../.claude/skills/drafting-data/references/jobs-stock.md"), "utf-8");
  const section = md.slice(md.indexOf("## 3b."), md.indexOf("## 3c."));
  const titles = [...section.matchAll(/^\*\*`([^`]+)`/gm)].map((m) => m[1]);
  assert.deepEqual(new Set(titles), STOCK_TITLES);
  assert.equal(titles.length, STOCK_TITLES.size);
});
