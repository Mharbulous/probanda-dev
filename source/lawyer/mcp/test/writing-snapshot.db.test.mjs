// The layout snapshot of a Writing (writing-snapshot.ts; spec section 5 "Layout snapshot" and
// "Re-snapshot"): composeLayoutSnapshot reads the type and venue blocks through knowledge__read and
// hashes each cited passage; resnapshotWriting writes it only while the Writing is drafting, and the
// v32 layout-freeze trigger refuses the same write at database level once it is sent or retired.

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { knowledgeFile, knowledgeFixture, passageHash } from "./helpers/knowledge-fixture.mjs";

const { freshSubmissionDb, seedSql } = await import("./helpers/template-db.mjs");
const { submissionDataExecute, submissionDataQuery } = await import("../build/submission/backend.js");
const { composeLayoutSnapshot, resnapshotWriting } = await import("../build/submission/writing-snapshot.js");

const PASSAGE = "An application must be brought by filing a notice of application in Form 32.";
const VENUE_BLOCK = {
  caption_lines: ["IN THE SUPREME COURT OF BRITISH COLUMBIA"],
  file_number_label: "No.",
  registry_label: null,
  party_roles: { applicant: "Applicant", respondent: "Respondent" },
  display_label: "BCSC",
};
const NOA_BLOCK = {
  renderer: "bespoke",
  needs_forum_parts: true,
  folder_code: "NOA",
  title: { value: "Notice of Application", rule_ref: "r1" },
  exhibit_numbering: "writing",
};
const LETTER_BLOCK = {
  renderer: "general",
  needs_forum_parts: false,
  folder_code: "LTR",
  title: "Letter to opposing counsel",
  exhibit_numbering: "writing",
  parts: [{ heading: null, heading_numbering: "none", paragraph_numbering: "none", source: "slot:body" }],
  letterhead: true,
};
const LETTER_PATH = "draft/CAN/BC/_NoVenue/Documents/letter-to-opposing-counsel.md";
const BCSC_KEY = { country: "CAN", jurisdiction: "BC", venue: "BCSC", kind: "notice_of_application" };
const BC = { country: "CAN", jurisdiction: "BC" };

function tree(t) {
  const f = knowledgeFixture(t);
  f.shipped("draft/CAN/BC/venues.json", {
    jurisdiction: "BC",
    name: "British Columbia",
    venues: [{ code: "BCSC", name: "Supreme Court of British Columbia", aliases: [] }],
  });
  f.shipped("draft/CAN/BC/BCSC/venue.md", knowledgeFile(null, VENUE_BLOCK));
  f.shipped("draft/CAN/BC/BCSC/Documents/kinds.json", {
    kinds: [{ file: "notice-of-application", name: "Notice of Application", aliases: [{ name: "notice_of_application" }] }],
  });
  f.shipped("draft/CAN/BC/BCSC/Documents/notice-of-application.md", knowledgeFile(`items:\n  - rule_ref: r1\n    passage: ${PASSAGE}`, NOA_BLOCK));
  f.shipped("draft/CAN/BC/_NoVenue/Documents/kinds.json", {
    kinds: [
      {
        file: "letter-to-opposing-counsel",
        name: "Letter to opposing counsel",
        aliases: [{ name: "letter_to_opposing_counsel" }],
        recipient: "opposing-counsel",
      },
    ],
  });
  f.shipped(LETTER_PATH, knowledgeFile(null, LETTER_BLOCK));
  return f;
}

async function db(t, seed) {
  const dir = mkdtempSync(join(tmpdir(), "coclerk-writing-snapshot-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const dbPath = join(dir, "submission.sqlite");
  await freshSubmissionDb(dbPath);
  seedSql(dbPath, seed);
  return dbPath;
}

const revision = (dbPath) => Number(submissionDataQuery(dbPath, "SELECT value FROM db_meta WHERE key = 'revision'").rows[0].value);
const filing = (dbPath) => submissionDataQuery(dbPath, "SELECT * FROM filings WHERE id = 1").rows[0];
const code = (expected, message) => (err) => {
  assert.equal(err.code, expected, err.message);
  if (message) assert.match(err.message, message);
  return true;
};

test("composes the snapshot from the tree: both blocks and each cited passage's hash", (t) => {
  const f = tree(t);
  const bcsc = composeLayoutSnapshot(BCSC_KEY, f.seams);
  assert.equal(bcsc.needs_forum_parts, 1);
  assert.equal(bcsc.type_file, "notice-of-application");
  const parsed = JSON.parse(bcsc.layout_snapshot);
  assert.deepEqual(parsed, {
    layout: NOA_BLOCK,
    venue: VENUE_BLOCK,
    passage_hashes: { r1: passageHash(PASSAGE) },
    type_file: "draft/CAN/BC/BCSC/Documents/notice-of-application.md",
    venue_file: "draft/CAN/BC/BCSC/venue.md",
  });
  assert.equal(parsed.venue.display_label, "BCSC");

  const letter = composeLayoutSnapshot({ ...BC, venue: "_NoVenue", kind: "letter_to_opposing_counsel" }, f.seams);
  assert.equal(letter.needs_forum_parts, 0);
  assert.equal(letter.type_file, "letter-to-opposing-counsel");
  assert.deepEqual(JSON.parse(letter.layout_snapshot), { layout: LETTER_BLOCK, venue: null, passage_hashes: {}, type_file: LETTER_PATH, venue_file: null });
});

test("under _NoVenue a type in /legal-research's tree resolves too, with or without /draft's tree", (t) => {
  const f = tree(t);
  const MEMO_PATH = "legal-research/CAN/BC/_NoVenue/Documents/research-memo.md";
  const { letterhead, folder_code, ...letter } = LETTER_BLOCK;
  const MEMO_BLOCK = { ...letter, title: "Memorandum of Law" };
  f.shipped("legal-research/CAN/BC/_NoVenue/Documents/kinds.json", {
    kinds: [{ file: "research-memo", name: "Research memo", aliases: [{ name: "research_memo" }], recipient: "internal" }],
  });
  f.shipped(MEMO_PATH, knowledgeFile(null, MEMO_BLOCK));
  const memo = composeLayoutSnapshot({ ...BC, venue: "_NoVenue", kind: "research_memo" }, f.seams);
  assert.equal(memo.type_file, "research-memo");
  assert.equal(memo.recipient, "internal");
  assert.equal(JSON.parse(memo.layout_snapshot).type_file, MEMO_PATH);
  // /draft's own kinds still resolve beside it.
  assert.equal(composeLayoutSnapshot({ ...BC, venue: "_NoVenue", kind: "letter_to_opposing_counsel" }, f.seams).type_file, "letter-to-opposing-counsel");
  // A venue never reads /legal-research's tree.
  assert.throws(() => composeLayoutSnapshot({ ...BCSC_KEY, kind: "research_memo" }, f.seams), code("kind_unresolved", /matches 0 rows of draft\/CAN\/BC\/BCSC/));
  // One kind in both trees is ambiguous.
  f.shipped("legal-research/CAN/BC/_NoVenue/Documents/kinds.json", {
    kinds: [{ file: "research-memo", name: "Research memo", aliases: [{ name: "letter_to_opposing_counsel" }], recipient: "internal" }],
  });
  assert.throws(() => composeLayoutSnapshot({ ...BC, venue: "_NoVenue", kind: "letter_to_opposing_counsel" }, f.seams), code("kind_unresolved", /matches 2 rows/));
  // Without litigator's /draft tree the research memo still resolves.
  rmSync(join(f.installRoot, "skills", "draft"), { recursive: true, force: true });
  assert.equal(composeLayoutSnapshot({ ...BC, venue: "_NoVenue", kind: "research-memo" }, f.seams).type_file, "research-memo");
});

test("an unresolved kind and a needs-forum type under _NoVenue fail hard", (t) => {
  const f = tree(t);
  assert.throws(() => composeLayoutSnapshot({ ...BCSC_KEY, kind: "notice" }, f.seams), code("kind_unresolved", /"notice" matches 0 rows of draft\/CAN\/BC\/BCSC/));
  f.shipped(LETTER_PATH, knowledgeFile(null, { ...LETTER_BLOCK, needs_forum_parts: true }));
  assert.throws(
    () => composeLayoutSnapshot({ ...BC, venue: "_NoVenue", kind: "letter_to_opposing_counsel" }, f.seams),
    code("invalid_layout", /cannot resolve under _NoVenue/)
  );
});

test("a drafting Writing re-snapshots, moving the revision", async (t) => {
  const f = tree(t);
  const dbPath = await db(
    t,
    "INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L0000', 'CAN/BC/BCSC');" +
      "INSERT INTO filings (id, proceeding_id, kind, title) VALUES (1, 1, 'notice_of_application', 'A');"
  );
  assert.equal(filing(dbPath).layout_snapshot, null);
  const before = revision(dbPath);
  assert.deepEqual(await resnapshotWriting(dbPath, 1, { seams: f.seams }), {
    filing_id: 1,
    needs_forum_parts: 1,
    type_file: "notice-of-application",
    revision: before + 1,
  });
  assert.equal(filing(dbPath).layout_snapshot, composeLayoutSnapshot(BCSC_KEY, f.seams).layout_snapshot);
});

test("a non-integer filing id is refused before any query", async () => {
  await assert.rejects(resnapshotWriting(join(tmpdir(), "no-such-submission.sqlite"), 1.5), code("invalid_filing_id", /1\.5/));
});

test("a sent or retired Writing refuses the re-snapshot, in the runtime and at database level", async (t) => {
  const f = tree(t);
  const dbPath = await db(
    t,
    "INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L0000', 'CAN/BC/BCSC');" +
      "INSERT INTO filings (id, proceeding_id, kind, title, filed_on) VALUES (1, 1, 'notice_of_application', 'A', '2026-09-24');"
  );
  const direct = "UPDATE filings SET layout_snapshot = '{}' WHERE id = 1;";
  await assert.rejects(resnapshotWriting(dbPath, 1, { seams: f.seams }), code("writing_not_drafting", /was sent on 2026-09-24/));
  await assert.rejects(submissionDataExecute(dbPath, direct), /does not change/);

  await submissionDataExecute(dbPath, "UPDATE filings SET filed_on = NULL, retired_on = '2026-09-25', retirement_reason = 'delivered' WHERE id = 1;");
  assert.equal(filing(dbPath).retirement_reason, "delivered");
  await assert.rejects(resnapshotWriting(dbPath, 1, { seams: f.seams }), code("writing_not_drafting", /was retired on 2026-09-25/));
  await assert.rejects(submissionDataExecute(dbPath, direct), /does not change/);
  assert.equal(filing(dbPath).layout_snapshot, null);
});

test("a forum-less Writing re-snapshots under the jurisdiction its caller passes", async (t) => {
  const f = tree(t);
  const dbPath = await db(
    t,
    "INSERT INTO proceedings (id, matter_reference) VALUES (1, 'L0000');" +
      "INSERT INTO filings (id, proceeding_id, kind, title, needs_forum_parts) VALUES (1, 1, 'letter_to_opposing_counsel', 'L', 0);"
  );
  await assert.rejects(resnapshotWriting(dbPath, 1, { seams: f.seams }), code("jurisdiction_required", /writer's jurisdiction/));

  const result = await resnapshotWriting(dbPath, 1, { jurisdiction: BC, seams: f.seams });
  assert.equal(result.needs_forum_parts, 0);
  assert.equal(filing(dbPath).needs_forum_parts, 0);
  assert.deepEqual(JSON.parse(filing(dbPath).layout_snapshot), { layout: LETTER_BLOCK, venue: null, passage_hashes: {}, type_file: LETTER_PATH, venue_file: null });

  // A type turned needs-forum is refused at validation, so the needs-forum guard is never reached.
  f.shipped(LETTER_PATH, knowledgeFile(null, { ...LETTER_BLOCK, needs_forum_parts: true }));
  await assert.rejects(resnapshotWriting(dbPath, 1, { jurisdiction: BC, seams: f.seams }), code("invalid_layout"));
  // The guard itself: a needs-forum kind cannot sit on the forum-less proceeding at all.
  await assert.rejects(
    submissionDataExecute(dbPath, "INSERT INTO filings (proceeding_id, kind, title) VALUES (1, 'notice_of_application', 'N');"),
    /needs forum parts/
  );
});
