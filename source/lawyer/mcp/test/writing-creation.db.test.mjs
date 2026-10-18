// Writing creation (plan Phase 14, spec §5 "Layout snapshot"): drafting_data__create_writing
// resolves the type file from a tree key, validates it, and writes the filings row with its stored
// layout, each cited passage hash and the type's needs_forum_parts in one INSERT. The _NoVenue
// letters live in a firm overlay; the BCSC kinds are /draft's shipped files.

import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";

import { knowledgeFile, passageHash } from "./helpers/knowledge-fixture.mjs";
import {
  BCSC_TREE,
  generalWritingFixture,
  installCaptionedNote,
  LEARNED_FRONT,
  LETTER_BLOCK,
  LETTER_FILE,
  MEMO_BLOCK,
  MEMO_FILE,
  NO_VENUE_TREE,
  PARTY_LETTER_FILE,
  PASSAGES,
} from "./helpers/general-writing-fixture.mjs";

const { extractJsonBlock } = await import("../build/knowledge/declared-layout.js");
const { resolveShippedRoot } = await import("../build/repo-root.js");
const { NotFoundError } = await import("../build/errors.js");
const { submissionDataQuery, submissionDataWrite } = await import("../build/submission/backend.js");
const { callTool } = await import("../build/dispatch.js");

async function refusal(promise) {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error("expected a refusal, got none");
}

function snapshotOf(g, filingId) {
  const [row] = g.query("SELECT needs_forum_parts, layout_snapshot, signer_key, signer_party_id FROM filings WHERE id = ?", [filingId]);
  return { ...row, snapshot: JSON.parse(row.layout_snapshot) };
}

test("a _NoVenue letter on a forum-less proceeding stores its layout, both passage hashes, needs_forum_parts 0 and this machine's lawyer, in one revision", async (t) => {
  const g = await generalWritingFixture(t);
  const before = g.revision();

  // Unconfirmed: the fixture's own confirming write would be a second revision (#1231).
  const result = await g.createLetter({ unconfirmed: true });

  const row = snapshotOf(g, result.filing_id);
  assert.equal(row.needs_forum_parts, 0);
  assert.deepEqual(row.snapshot.layout, LETTER_BLOCK);
  assert.equal(row.snapshot.venue, null);
  assert.deepEqual(row.snapshot.passage_hashes, { "R-title": passageHash(PASSAGES["R-title"]), "R-body": passageHash(PASSAGES["R-body"]) });
  assert.equal(row.snapshot.type_file, LETTER_FILE);
  assert.equal(row.snapshot.venue_file, null);
  assert.equal(row.signer_key, "pe");
  assert.equal(row.signer_party_id, null);
  assert.equal(result.learned, true);
  assert.equal(result.type_file, LETTER_FILE);
  assert.equal(g.revision(), before + 1, "one INSERT moves the revision once");
});

test("the same letter on a proceeding with a forum still stores needs_forum_parts 0, not the column default", async (t) => {
  const g = await generalWritingFixture(t);
  const result = await g.createLetter({ proceeding_id: 2 });
  assert.equal(snapshotOf(g, result.filing_id).needs_forum_parts, 0);
});

test("the stored kind must match one row by itself: a shared _NoVenue alias refuses even with recipient, and recipient must be the matched row's", async (t) => {
  const g = await generalWritingFixture(t);
  const missing = await refusal(g.create({ proceeding_id: 1, tree: NO_VENUE_TREE, kind: "letter_to_opposing_party" }));
  assert.match(missing.message, /needs recipient/);

  const shared = await refusal(g.create({ proceeding_id: 1, tree: NO_VENUE_TREE, kind: "demand letter", recipient: "opposing-party" }));
  assert.equal(shared.code, "kind_unresolved");
  assert.match(shared.message, /letter-to-opposing-counsel \(recipient opposing-counsel\), letter-to-opposing-party \(recipient opposing-party\)/);

  const mismatch = await refusal(g.create({ proceeding_id: 1, tree: NO_VENUE_TREE, kind: "letter_to_opposing_party", recipient: "witness" }));
  assert.equal(mismatch.code, "recipient_mismatch");
  assert.match(mismatch.message, /opposing-party/);
  assert.match(mismatch.message, /witness/);
  assert.equal(g.query("SELECT count(*) AS n FROM filings")[0].n, 0, "a refusal writes nothing");

  const party = await g.create({ proceeding_id: 1, tree: NO_VENUE_TREE, kind: "letter_to_opposing_party", recipient: "opposing-party" });
  assert.equal(party.type_file, PARTY_LETTER_FILE);
  assert.equal(snapshotOf(g, party.filing_id).snapshot.layout.title, "Letter to opposing party");
});

test("a type declaring needs_forum_parts true under _NoVenue refuses", async (t) => {
  const g = await generalWritingFixture(t, { block: { ...LETTER_BLOCK, needs_forum_parts: true } });
  const err = await refusal(g.createLetter());
  assert.equal(err.code, "invalid_layout");
  assert.match(err.message, /needs_forum_parts/);
  assert.equal(g.query("SELECT count(*) AS n FROM filings")[0].n, 0, "a refusal writes nothing");
});

test("an unknown part source refuses naming the part and the vocabulary; an unbuilt projection refuses naming it and its phase", async (t) => {
  const g = await generalWritingFixture(t);
  const withSource = (source) => knowledgeFile(LEARNED_FRONT, { ...LETTER_BLOCK, parts: [...LETTER_BLOCK.parts.slice(0, 4), { ...LETTER_BLOCK.parts[4], source }] });

  g.f.local(LETTER_FILE, withSource("letterhead-logo"));
  const unknown = await refusal(g.createLetter());
  assert.equal(unknown.code, "invalid_layout");
  assert.match(unknown.message, /parts\[4\]\.source/);
  assert.match(unknown.message, /closed vocabulary/);

  g.f.local(LETTER_FILE, withSource("facts"));
  const unbuilt = await refusal(g.createLetter());
  assert.equal(unbuilt.code, "projection_not_built");
  assert.match(unbuilt.message, /"facts"/);
  assert.match(unbuilt.message, /no phase yet/);
});

test("a caption part under _NoVenue refuses naming the projection, since _NoVenue has no venue block; the same layout under BCSC is created", async (t) => {
  const g = await generalWritingFixture(t);
  installCaptionedNote(g, "_NoVenue");
  const err = await refusal(g.create({ proceeding_id: 1, tree: NO_VENUE_TREE, kind: "captioned_note", recipient: "internal" }));
  assert.equal(err.code, "invalid_layout");
  assert.match(err.message, /parts\[0\]\.source: projection "caption"/);
  assert.match(err.message, /_NoVenue type has no venue\.md/);
  assert.equal(g.query("SELECT count(*) AS n FROM filings")[0].n, 0, "a refusal writes nothing");

  installCaptionedNote(g, "BCSC");
  const created = await g.create({ proceeding_id: 2, tree: BCSC_TREE, kind: "captioned_note" });
  assert.equal(snapshotOf(g, created.filing_id).snapshot.venue_file, "draft/CAN/BC/BCSC/venue.md");
});

test("a legal-basis part with paragraph_numbering none refuses naming the part and the rule", async (t) => {
  const g = await generalWritingFixture(t);
  const parts = MEMO_BLOCK.parts.map((p) => (p.source === "legal-basis" ? { ...p, paragraph_numbering: "none" } : p));
  g.f.local(MEMO_FILE, knowledgeFile(null, { ...MEMO_BLOCK, parts }));
  const err = await refusal(g.create({ proceeding_id: 1, tree: NO_VENUE_TREE, kind: "internal_memo", recipient: "internal" }));
  assert.equal(err.code, "invalid_layout");
  assert.match(err.message, /parts\[3\]\.paragraph_numbering/);
  assert.match(err.message, /"legal-basis" part is always numbered/);
  assert.equal(g.query("SELECT count(*) AS n FROM filings")[0].n, 0, "a refusal writes nothing");
});

test("the needs-forum guard refuses a needs_forum_parts 1 row on a forum-less proceeding written through the generic write primitive", async (t) => {
  const g = await generalWritingFixture(t);
  const err = await refusal(
    submissionDataWrite(g.dbPath, "INSERT INTO filings (proceeding_id, kind, title, needs_forum_parts) VALUES (?, ?, ?, ?)", [1, "notice_of_application", "NoA", 1])
  );
  assert.match(err.message, /needs its proceeding's forum chosen first/, "the guard text layout-snapshot.ts maps to needs_forum");
  assert.equal(g.query("SELECT count(*) AS n FROM filings")[0].n, 0);
});

test("a venue kind needs the proceeding's own forum: needs_forum on none, forum_mismatch on another, and the venue block stored on its own", async (t) => {
  const g = await generalWritingFixture(t);
  const noa = { tree: BCSC_TREE, kind: "notice_of_application", title: "NoA" };

  const noForum = await refusal(g.create({ ...noa, proceeding_id: 1 }));
  assert.equal(noForum.code, "needs_forum");

  const other = await refusal(g.create({ ...noa, proceeding_id: 3 }));
  assert.equal(other.code, "forum_mismatch");
  assert.match(other.message, /CAN\/BC\/BCSC/);
  assert.match(other.message, /CAN\/BC\/BCCA/);

  const created = await g.create({ ...noa, proceeding_id: 2 });
  const row = snapshotOf(g, created.filing_id);
  const venueMd = `${resolveShippedRoot("draft/references").root}/draft/references/CAN/BC/BCSC/venue.md`;
  assert.equal(row.needs_forum_parts, 1);
  assert.deepEqual(row.snapshot.venue, extractJsonBlock(readFileSync(venueMd, "utf-8"), venueMd, true));
  assert.equal(row.snapshot.venue_file, "draft/CAN/BC/BCSC/venue.md");
  assert.equal(row.snapshot.type_file, "draft/CAN/BC/BCSC/Documents/notice-of-application.md");
  assert.deepEqual(row.snapshot.passage_hashes, {});
});

test("the signer: a staff person is no default, a passed key must be a roster lawyer, and a party type takes a party of its own proceeding", async (t) => {
  const g = await generalWritingFixture(t, { person: "st" });
  assert.equal(snapshotOf(g, (await g.createLetter()).filing_id).signer_key, null);
  assert.equal((await refusal(g.createLetter({ signer_key: "st" }))).code, "invalid_signer");
  assert.equal(snapshotOf(g, (await g.createLetter({ signer_key: "pe" })).filing_id).signer_key, "pe");

  renameSync(g.firmJson, `${g.firmJson}.aside`);
  assert.equal(snapshotOf(g, (await g.createLetter()).filing_id).signer_key, null, "no firm profile leaves the default unset");
  const noProfile = await refusal(g.createLetter({ signer_key: "pe" }));
  assert.ok(noProfile instanceof NotFoundError, "a passed key with no firm profile fails on the missing profile");
  assert.match(noProfile.message, /firm profile is incomplete\. Missing: firm\.json/);
  renameSync(`${g.firmJson}.aside`, g.firmJson);

  const { letterhead: _letterhead, ...unlettered } = LETTER_BLOCK;
  g.f.local(LETTER_FILE, knowledgeFile(LEARNED_FRONT, { ...unlettered, signer: "party" }));
  const signed = await g.createLetter({ signer_party_id: 2 });
  const row = snapshotOf(g, signed.filing_id);
  assert.equal(row.signer_party_id, 2);
  assert.equal(row.signer_key, null);
  assert.equal((await refusal(g.createLetter({ signer_party_id: 4 }))).code, "invalid_signer", "party 4 is proceeding 2's");
  assert.equal((await refusal(g.createLetter({ signer_key: "pe" }))).code, "invalid_signer");
});

test("with no per-user coclerk.json, create_writing finds the overlay and firm profile from the database's 0. CASE DATA folder, and stores no default signer", async (t) => {
  const g = await generalWritingFixture(t);
  rmSync(join(g.f.seams.env.APPDATA, "Coclerk", "coclerk.json"));
  // /matter-data's layout: the matter's case-data folder sits directly in the 0. CASE DATA folder.
  const dbPath = join(g.f.caseRoot, "L1 Test", "submission.sqlite");
  mkdirSync(dirname(dbPath));
  copyFileSync(g.dbPath, dbPath);
  const result = await callTool({}, "drafting_data__create_writing", {
    db_path: dbPath,
    proceeding_id: 1,
    tree: NO_VENUE_TREE,
    kind: "letter_to_opposing_counsel",
    recipient: "opposing-counsel",
    title: "Letter to Cara",
  });
  assert.equal(result.type_file, LETTER_FILE);
  assert.equal(result.signer_key, null);
  const [row] = submissionDataQuery(dbPath, "SELECT signer_key, layout_snapshot FROM filings WHERE id = ?", [result.filing_id]).rows;
  assert.equal(row.signer_key, null);
  assert.deepEqual(JSON.parse(row.layout_snapshot).layout, LETTER_BLOCK);
});
