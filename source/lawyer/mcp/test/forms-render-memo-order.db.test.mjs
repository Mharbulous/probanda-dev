// Golden-fixture tests for the submission form renderers (build ticket #297): render memoisation by stamp, and bootstrap's filing order.
// Split out of the former forms-render.test.mjs; shared seeds live in fixtures/forms-render-seeds.mjs,
// which also documents regenerating the golden fixtures.

import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { seededDbFixture, seedVaniacProceeding, seedTickets, boardDataOf, ASHBOURNE, draftFolder, CONSENT_ORDER_CASE_DATA } from "./fixtures/forms-render-seeds.mjs";
const { freshSubmissionDb } = await import("./helpers/template-db.mjs");
const { writePartiesOfRecord } = await import("./helpers/matter-data-fixture.mjs");
const { submissionDataExecute } = await import("../build/submission/backend.js");
const { submissionFormsRender, submissionFormsBootstrap } = await import("../build/submission/forms.js");
const { proposalKey } = await import("../build/submission/forms/proposal-inventory.js");
const { submissionFormsBoardCard } = await import("../build/submission/matter-pages.js");

// ---------------------------------------------------------------------------
// Memoisation by stamp (#582, brief §1). The stamp's inputs and the acceptance below
// are #581's, which replaced the brief's own wording. The clock is pinned rather than
// the `Rendered:` lines normalised (#581 §4), so "the same minute", "a later minute"
// and "the next day" are each expressible as an ordinary argument.
// ---------------------------------------------------------------------------

const PINNED = "2026-09-15 10:00";

const LATER_MINUTE = "2026-09-15 10:07";

const NEXT_DAY = "2026-09-16 09:00";

function renderAt(dbPath, now, client = ASHBOURNE) {
  return submissionFormsRender(dbPath, 1, client, "mockup", undefined, undefined, undefined, now);
}

/** Everything but the Job Board, which sits outside the stamp and is rewritten every call. */

function advocacyOf(result) {
  return result.documents.filter((d) => d.document_type !== "Work_board");
}

/** The board's lanes as a session reads them after a render: board_card's live lane, built from the
 * inventory the render saved and the current job rows, at a pinned minute. */
function boardOf(dbPath, now) {
  return submissionFormsBoardCard({ db_path: dbPath, filing_id: 1, lanes: ["live"] }, ASHBOURNE, now).card;
}

function mtimesOf(baseDir, names) {
  return names.map((name) => statSync(join(baseDir, name)).mtimeMs);
}

function manifestOf(baseDir) {
  return JSON.parse(readFileSync(join(baseDir, "render-manifest.json"), "utf-8"));
}

async function vaniacFixture() {
  const f = seededDbFixture();
  await freshSubmissionDb(f.dbPath);
  await seedVaniacProceeding(f.dbPath);
  return f;
}

test("memoisation: two renders at one pinned clock give identical bytes, board data and stamp", async () => {
  const f = await vaniacFixture();
  try {
    const first = renderAt(f.dbPath, PINNED);
    const baseDir = dirname(advocacyOf(first)[0].path);
    const names = advocacyOf(first).map((d) => d.file_name);
    const bytesBefore = names.map((n) => readFileSync(join(baseDir, n), "utf-8"));
    const stampBefore = manifestOf(baseDir).stamp;
    const boardBefore = boardOf(f.dbPath, PINNED);

    renderAt(f.dbPath, PINNED);

    assert.deepEqual(
      names.map((n) => readFileSync(join(baseDir, n), "utf-8")),
      bytesBefore,
      "advocacy mockups must be byte-identical"
    );
    assert.deepEqual(manifestOf(baseDir).stamp, stampBefore, "the stamp must not move when no input moved");
    assert.equal(boardOf(f.dbPath, PINNED), boardBefore, "the board must match at the same clock");
  } finally {
    f.cleanup();
  }
});

test("memoisation: a later minute on the same day writes no advocacy document and keeps its Rendered minute", async () => {
  const f = await vaniacFixture();
  try {
    const first = renderAt(f.dbPath, PINNED);
    const baseDir = dirname(advocacyOf(first)[0].path);
    const names = advocacyOf(first).map((d) => d.file_name);
    const before = mtimesOf(baseDir, names);

    const second = renderAt(f.dbPath, LATER_MINUTE);

    assert.deepEqual(mtimesOf(baseDir, names), before, "a stamp hit must perform zero advocacy-document writes");
    assert.equal(second.rendered_at, PINNED, "rendered_at is the minute the files on disk still carry");
    assert.ok(second.timings.some((p) => p.phase === "board_section"), "the board's section is rebuilt on a hit");
    for (const doc of advocacyOf(second)) {
      assert.equal(doc.markdown, readFileSync(join(baseDir, doc.file_name), "utf-8"), "a hit returns the canonical copy's text");
    }
  } finally {
    f.cleanup();
  }
});

test("memoisation: the next local date is a miss and re-renders", async () => {
  const f = await vaniacFixture();
  try {
    const first = renderAt(f.dbPath, PINNED);
    const baseDir = dirname(advocacyOf(first)[0].path);
    assert.equal(manifestOf(baseDir).stamp.date, "2026-09-15");

    const second = renderAt(f.dbPath, NEXT_DAY);

    assert.equal(second.rendered_at, NEXT_DAY, "a new day re-renders, so rendered_at moves");
    assert.equal(manifestOf(baseDir).stamp.date, "2026-09-16", "the manifest re-stamps at the new date");
  } finally {
    f.cleanup();
  }
});

test("memoisation: an exempt ticket write leaves advocacy documents alone but changes the board", async () => {
  const f = await vaniacFixture();
  try {
    const first = renderAt(f.dbPath, PINNED);
    const baseDir = dirname(advocacyOf(first)[0].path);
    const names = advocacyOf(first).map((d) => d.file_name);
    const before = mtimesOf(baseDir, names);
    const boardBefore = boardOf(f.dbPath, PINNED);

    await seedTickets(f.dbPath);
    const second = renderAt(f.dbPath, PINNED);

    assert.equal(second.revision, first.revision, "ticket tables are exempt from the revision trigger");
    assert.deepEqual(mtimesOf(baseDir, names), before, "an exempt write must not rewrite an advocacy document");
    assert.notEqual(boardOf(f.dbPath, PINNED), boardBefore, "the board must show the new tickets");
  } finally {
    f.cleanup();
  }
});

test("memoisation: a substance write moves the revision by trigger, so the render misses and archives", async () => {
  const f = await vaniacFixture();
  try {
    const first = renderAt(f.dbPath, PINNED);
    const baseDir = dirname(advocacyOf(first)[0].path);

    await submissionDataExecute(f.dbPath, "UPDATE proceedings SET style_of_cause = 'Ashbourne v. Northridge (amended)' WHERE id = 1");
    const second = renderAt(f.dbPath, PINNED);

    assert.notEqual(second.revision, first.revision, "a v21 trigger must have moved db_meta.revision");
    assert.equal(manifestOf(baseDir).stamp.revision, second.revision, "the manifest re-stamps at the new revision");
    assert.ok(existsSync(join(baseDir, "archive")), "a revision move archives the superseded copy, as it always has");
  } finally {
    f.cleanup();
  }
});

test("memoisation: a different resolved client field is a miss", async () => {
  const f = await vaniacFixture();
  try {
    const first = renderAt(f.dbPath, PINNED);
    const baseDir = dirname(advocacyOf(first)[0].path);
    assert.equal(manifestOf(baseDir).stamp.matter_no, "L4801");

    renderAt(f.dbPath, PINNED, { clientName: "Ashbourne", clientNo: "2417", matterNo: "L9999" });

    assert.equal(manifestOf(baseDir).stamp.matter_no, "L9999", "a hit writes no manifest, so a re-stamp proves the miss");
  } finally {
    f.cleanup();
  }
});

test("memoisation: a mockup edited on disk is rewritten, without archiving", async () => {
  const f = await vaniacFixture();
  try {
    const first = renderAt(f.dbPath, PINNED);
    const baseDir = dirname(advocacyOf(first)[0].path);
    const name = advocacyOf(first)[0].file_name;
    writeFileSync(join(baseDir, name), "tampered\n", "utf-8");

    renderAt(f.dbPath, PINNED);

    assert.notEqual(readFileSync(join(baseDir, name), "utf-8"), "tampered\n", "a sha256 mismatch must rewrite the file");
    assert.ok(!existsSync(join(baseDir, "archive")), "the revision has not moved, so nothing is archived");
  } finally {
    f.cleanup();
  }
});

test("memoisation: bootstrap reports render_state from the manifest and file existence", async () => {
  const f = await vaniacFixture();
  try {
    const cold = submissionFormsBootstrap(f.dbPath, ASHBOURNE, PINNED);
    assert.equal(cold.filings[0].render_state, "never", "no manifest exists before any render");
    assert.equal(
      submissionFormsBootstrap(f.dbPath, ASHBOURNE, PINNED).filings[0].render_state,
      "never",
      "bootstrap renders nothing (#584), so a second call cannot have made the filing fresh"
    );

    renderAt(f.dbPath, PINNED);

    const warm = submissionFormsBootstrap(f.dbPath, ASHBOURNE, PINNED);
    assert.equal(warm.filings[0].render_state, "fresh", "the render left a matching stamp");

    const nextDay = submissionFormsBootstrap(f.dbPath, ASHBOURNE, NEXT_DAY);
    assert.equal(nextDay.filings[0].render_state, "stale", "a new local date stales every live filing");

    // Existence, not content: deleting a listed file is enough to stale the filing, which is
    // what lets bootstrap answer without opening a OneDrive placeholder (#581 §5).
    const baseDir = dirname(warm.filings[0].paths[0]);
    const listed = manifestOf(baseDir).files[0].file_name;
    rmSync(join(baseDir, listed));
    const afterDelete = submissionFormsBootstrap(f.dbPath, ASHBOURNE, PINNED);
    assert.equal(afterDelete.filings[0].render_state, "stale", "a missing listed file is stale even when the stamp matches");
  } finally {
    f.cleanup();
  }
});

// A presentation copy is disposable (ADR 0012) and can be deleted at any moment, so its
// absence must never force a re-render of the canonical mockups. A stamp hit re-projects
// every copy from the canonical text it just verified, which is what makes a missing copy
// a copy rather than a render (#581 §1).
test("memoisation: a deleted presentation copy is re-copied on a stamp hit, with no canonical write", async () => {
  const f = await vaniacFixture();
  try {
    const { leaf } = draftFolder(f);
    const first = submissionFormsRender(f.dbPath, 1, ASHBOURNE, "mockup", undefined, undefined, leaf, PINNED);
    const baseDir = dirname(advocacyOf(first)[0].path);
    const names = advocacyOf(first).map((d) => d.file_name);
    const before = mtimesOf(baseDir, names);

    const copy = advocacyOf(first)[0].presentation_path;
    assert.ok(copy && existsSync(copy), "expected a presentation copy from the first render");
    rmSync(copy);

    const second = submissionFormsRender(f.dbPath, 1, ASHBOURNE, "mockup", undefined, undefined, leaf, LATER_MINUTE);

    assert.ok(existsSync(copy), "the missing copy must be written again");
    assert.deepEqual(mtimesOf(baseDir, names), before, "re-copying must not rewrite a canonical mockup");
    assert.equal(second.rendered_at, PINNED, "the canonical files keep the minute they were rendered with");
    assert.equal(readFileSync(copy, "utf-8"), readFileSync(join(baseDir, names[0]), "utf-8"), "the copy must match its canonical mockup");
  } finally {
    f.cleanup();
  }
});

// ---------------------------------------------------------------------------
// The inventory's round trip through render-manifest.json (Work Board Proposals design §8, Phase D
// step 5). A stamp hit re-renders nothing, so the board's Proposals have to come from the
// inventory the miss saved -- with their lanes still read live out of SQLite. The exact key set
// that inventory carries is proposal-inventory.db.test.mjs's, which owns it.
// ---------------------------------------------------------------------------

const DOCTRINAL_KEY = "doctrinal-basis:law_assertions:4";

test("proposals: a stamp hit derives the same Proposals from the inventory the miss saved", async () => {
  const f = await vaniacFixture();
  try {
    const first = renderAt(f.dbPath, PINNED);
    const firstProposals = boardDataOf(f.dbPath, 1, ASHBOURNE, PINNED).proposals;
    const baseDir = dirname(advocacyOf(first)[0].path);
    const names = advocacyOf(first).map((d) => d.file_name);
    const before = mtimesOf(baseDir, names);
    const { inventory } = manifestOf(baseDir);
    assert.ok(Array.isArray(inventory) && inventory.length > 0, "the miss saves the render's inventory");
    const boardBefore = boardOf(f.dbPath, PINNED);

    renderAt(f.dbPath, LATER_MINUTE);

    assert.deepEqual(mtimesOf(baseDir, names), before, "a hit re-renders nothing, so it recollects nothing");
    assert.equal(boardOf(f.dbPath, PINNED), boardBefore, "the hit's board is the miss's");
    const proposals = boardDataOf(f.dbPath, 1, ASHBOURNE, LATER_MINUTE).proposals;
    assert.ok(proposals.length > 0, "the hit still derives Proposals");
    assert.deepEqual(proposals, firstProposals, "the hit's Proposals are the render's own");
    const keys = new Set(inventory.map(proposalKey));
    for (const p of proposals) assert.ok(keys.has(p.key), `${p.key} came from somewhere other than the saved inventory`);
  } finally {
    f.cleanup();
  }
});

test("proposals: a stamp hit reads its lanes from live SQLite, not from the manifest", async () => {
  const f = await vaniacFixture();
  try {
    const first = renderAt(f.dbPath, PINNED);
    const baseDir = dirname(advocacyOf(first)[0].path);
    const names = advocacyOf(first).map((d) => d.file_name);
    const before = mtimesOf(baseDir, names);
    assert.equal(boardDataOf(f.dbPath, 1, ASHBOURNE).proposals.find((p) => p.key === DOCTRINAL_KEY).lane, "proposed");

    // Ticket writes are exempt from the revision trigger, so this leaves the stamp matching.
    await submissionDataExecute(
      f.dbPath,
      `INSERT INTO tickets (id, proceeding_id, filing_id, title, intent, status, priority, kind, billing_anchor, created)
         VALUES (1, 1, 1, 'Find authority for the fourth proposition', 'Research it and record a statement of law.', 'queued', 0, 'work', 'L4801|doctrinal basis', '2026-09-15 10:03');
       INSERT INTO ticket_proposals (ticket_id, proposal_key, item)
         VALUES (1, '${DOCTRINAL_KEY}', 'a second point of law also not yet researched');`
    );
    const second = renderAt(f.dbPath, LATER_MINUTE);

    assert.deepEqual(mtimesOf(baseDir, names), before, "the inventory came from the manifest, so nothing re-rendered");
    const held = boardDataOf(f.dbPath, 1, ASHBOURNE).proposals.find((p) => p.key === DOCTRINAL_KEY);
    assert.deepEqual([held.lane, held.holder], ["held", { ticket_id: 1, ticketed_on: null }], "the lane is read live");
  } finally {
    f.cleanup();
  }
});

// Decision b.4: a manifest with no usable `inventory` reads as no manifest at all, so the render
// misses and the collector fills the field again -- never a hit that derives an empty board.
for (const [label, broken] of [
  ["absent", undefined],
  ["malformed", [{ slug: "nonsense" }]],
]) {
  test(`proposals: a manifest whose inventory is ${label} misses, and the render writes the field back`, async () => {
    const f = await vaniacFixture();
    try {
      const first = renderAt(f.dbPath, PINNED);
      const baseDir = dirname(advocacyOf(first)[0].path);
      const names = advocacyOf(first).map((d) => d.file_name);
      const before = mtimesOf(baseDir, names);

      const manifest = manifestOf(baseDir);
      if (broken === undefined) delete manifest.inventory;
      else manifest.inventory = broken;
      writeFileSync(join(baseDir, "render-manifest.json"), JSON.stringify(manifest), "utf-8");

      const second = renderAt(f.dbPath, PINNED);

      const refilled = manifestOf(baseDir).inventory;
      assert.ok(Array.isArray(refilled) && refilled.length > 0, "the collector filled the field again");
      const after = mtimesOf(baseDir, names);
      names.forEach((name, i) => assert.notEqual(after[i], before[i], `expected ${name} re-rendered, not served from a hit`));
      assert.ok(boardDataOf(f.dbPath, 1, ASHBOURNE).proposals.length > 0, "the full render derives its Proposals as usual");
    } finally {
      f.cleanup();
    }
  });
}

// The ranking end to end (#584). filing-order.unit.test.mjs proves the rule; these prove the query
// that feeds it -- which filing each activity timestamp is attributed to, and that a
// proceeding-scoped row counts for every filing in its proceeding. With a one-filing fixture
// the order is trivially right however wrong the attribution, so it takes two.

async function seedTwoRequisitions(dbPath) {
  writePartiesOfRecord(dirname(dbPath), CONSENT_ORDER_CASE_DATA);
  await submissionDataExecute(
    dbPath,
    `
    INSERT INTO proceedings (id, matter_reference, forum, court_or_centre, registry, file_number, style_of_cause, courthouse_address)
      VALUES (1, 'L8470 - Larchmont', 'CAN/BC/BCSC', 'BC Supreme Court', 'Vancouver', 'S-290002', 'Larchmont v. Example', NULL);
    INSERT INTO parties (id, proceeding_id, name, role, ordinal, is_client, is_applicant, to_be_served, case_party_id)
      VALUES (1, 1, 'Larchmont (B.C.) Inc.', 'Plaintiff', 1, 1, 1, 0, 1),
             (2, 1, 'Example Defendant Ltd.', 'Defendant', 2, 0, 0, 1, 2);
    INSERT INTO order_sought (id, proceeding_id, wording)
      VALUES (1, 1, 'the style of cause is corrected'), (2, 1, 'the time for service is extended');
    INSERT INTO filings (id, proceeding_id, kind, subkind, round, title)
      VALUES (1, 1, 'requisition_consent', 'consent', NULL, 'First Consent Order Requisition'),
             (2, 1, 'requisition_consent', 'consent', NULL, 'Second Consent Order Requisition');
    INSERT INTO filing_orders (filing_id, order_sought_id, document, ordinal) VALUES (1, 1, 'form', 1), (2, 2, 'form', 1);
    `.trim()
  );
}

const LARCHMONT = { clientName: "Larchmont", clientNo: "1", matterNo: "L8470" };

const orderOf = (dbPath, now) => submissionFormsBootstrap(dbPath, LARCHMONT, now).filings.map((f) => f.filing_id);

test("order: bootstrap ranks two filings by their own latest activity", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedTwoRequisitions(f.dbPath);
    // Filing 1 was touched first, filing 2 later, so filing 2 leads.
    await submissionDataExecute(
      f.dbPath,
      `INSERT INTO tickets (id, proceeding_id, filing_id, title, intent, status, priority, kind, billing_anchor, created)
         VALUES (1, 1, 1, 'Older', 'draft it', 'queued', 0, 'work', 'L8470', '2026-09-01 08:00'),
                (2, 1, 2, 'Newer', 'draft it', 'queued', 0, 'work', 'L8470', '2026-09-14 17:30');`
    );
    assert.deepEqual(orderOf(f.dbPath, PINNED), [2, 1]);

    // A later touch on filing 1 flips them -- proving the timestamp is attributed per filing
    // and not shared across the proceeding.
    await submissionDataExecute(f.dbPath, "UPDATE tickets SET completed_at = '2026-09-15 09:00', status = 'completed' WHERE id = 1");
    assert.deepEqual(orderOf(f.dbPath, PINNED), [1, 2]);
  } finally {
    f.cleanup();
  }
});

test("order: a proceeding-scoped ticket counts for every filing, so it cannot break the tie", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedTwoRequisitions(f.dbPath);
    await submissionDataExecute(
      f.dbPath,
      `INSERT INTO tickets (id, proceeding_id, filing_id, title, intent, status, priority, kind, billing_anchor, created)
         VALUES (1, 1, NULL, 'Proceeding-wide', 'chart it', 'queued', 0, 'charting', NULL, '2026-09-15 09:00'),
                (2, 1, 2, 'Filing two only', 'draft it', 'queued', 0, 'work', 'L8470', '2026-09-01 08:00');`
    );
    // Both filings inherit the proceeding-scoped 09:00, which is newer than filing 2's own row,
    // so neither leads on activity and the tie falls to filing id.
    assert.deepEqual(orderOf(f.dbPath, PINNED), [1, 2]);
  } finally {
    f.cleanup();
  }
});

// Bootstrap's list is by recency alone (#677): /draft reopens its first live filing, and a hearing
// that moved a filing up would let a session read hearing proximity off its position.
test("order: an imminent stored hearing does not lift a filing above a more recently touched one", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedTwoRequisitions(f.dbPath);
    await submissionDataExecute(
      f.dbPath,
      `INSERT INTO tickets (id, proceeding_id, filing_id, title, intent, status, priority, kind, billing_anchor, created)
         VALUES (1, 1, 2, 'Touched today', 'draft it', 'queued', 0, 'work', 'L8470', '2026-09-15 09:59');
       INSERT INTO hearing_details (id, filing_id, hearing_date) VALUES (1, 1, '2026-09-16');`
    );
    assert.deepEqual(orderOf(f.dbPath, PINNED), [2, 1], "today's activity leads, whatever the hearing");
  } finally {
    f.cleanup();
  }
});

test("order: a retired filing sits at the foot however recently it was touched", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedTwoRequisitions(f.dbPath);
    await submissionDataExecute(
      f.dbPath,
      `INSERT INTO tickets (id, proceeding_id, filing_id, title, intent, status, priority, kind, billing_anchor, created)
         VALUES (1, 1, 1, 'Touched today', 'draft it', 'queued', 0, 'work', 'L8470', '2026-09-15 09:59');
       UPDATE filings SET retired_on = '2026-09-15', retirement_reason = 'settled' WHERE id = 1;`
    );
    const filings = submissionFormsBootstrap(f.dbPath, LARCHMONT, PINNED).filings;
    assert.deepEqual(filings.map((x) => x.filing_id), [2, 1]);
    assert.equal(filings[1].lifecycle, "retired");
    assert.equal(filings[1].render_state, undefined, "a retired filing answers no render question");
    assert.deepEqual(filings[1].paths, []);
  } finally {
    f.cleanup();
  }
});
