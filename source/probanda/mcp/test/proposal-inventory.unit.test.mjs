// deriveProposals, on hand-built inventories (Work Board Proposals design §4, §5, §7, §8;
// Phase D step 2). Pure: no database, no Python, no render.

import assert from "node:assert/strict";
import test from "node:test";

const { ALL_MARKER_GLYPHS } = await import("../build/submission/forms/markers.js");
const { deriveProposals, noteUpCleared, proposalKey, recordLawStatementGlyphs, GLYPH_SLUGS, WORK_NAMES } = await import("../build/submission/forms/proposal-inventory.js");

const NO_HOLDERS = new Map();
const NO_REJECTIONS = new Map();

function keysOf(result) {
  return result.proposals.map((p) => p.key);
}

function derive(inventory, holders = NO_HOLDERS, rejections = NO_REJECTIONS) {
  return deriveProposals(inventory, holders, rejections);
}

// Entry builders, one per keyed table, carrying only the fields that table's recorders set.
const law = (slug, marker, id) => ({ slug, marker, table: "statements_of_law", id, item: "Case v. X, 2020 BCSC 1" });
const authority = (id, cleared) => ({ slug: "note-up", marker: "📇", table: "authorities", id, item: "Case v. X, 2020 BCSC 1", cleared });
const assertion = (slug, marker, id) => ({ slug, marker, table: "law_assertions", id, item: "the proposition" });
const witness = (slug, marker, id, statement_id) => ({ slug, marker, table: "witnesses", id, item: "M. Reyes", statement_id });
const instrument = (slug, marker, id, witness_id) => ({ slug, marker, table: "documents", id, item: "Witness Statement of M. Reyes", witness_id });
const statement = (slug, marker, id, witness_id, instrument_id) => ({
  slug,
  marker,
  table: "statements_of_fact",
  id,
  item: "M. Reyes: the fact",
  witness_id,
  ...(instrument_id === undefined ? {} : { instrument_id }),
});

test("every glyph GLYPH_SLUGS maps is a marker glyph markers.ts knows", () => {
  for (const glyph of GLYPH_SLUGS.keys()) {
    assert.ok(ALL_MARKER_GLYPHS.includes(glyph), `${glyph} is in GLYPH_SLUGS but not in ALL_MARKER_GLYPHS`);
  }
});

test("proposalKey appends a fourth segment only for a qualified row", () => {
  assert.equal(proposalKey({ slug: "note-up", table: "authorities", id: 2 }), "note-up:authorities:2");
  assert.equal(proposalKey({ slug: "unchosen", table: "filings", id: 1, qualifier: "affidavit" }), "unchosen:filings:1:affidavit");
});

test("one key yields one Proposal however many documents printed it", () => {
  const entry = assertion("doctrinal-basis", "📖", 4);
  const { proposals } = derive([entry, entry, entry]);
  assert.deepEqual(keysOf({ proposals }), ["doctrinal-basis:law_assertions:4"]);
  assert.equal(proposals[0].title, `${WORK_NAMES["doctrinal-basis"]}: the proposition`);
  assert.equal(proposals[0].marker, "📖");
  assert.equal(proposals[0].lane, "proposed");
  assert.equal(proposals[0].holder, null);
});

test("a witnesses-keyed Proposal counts its distinct statements and keeps the count out of the item", () => {
  const { proposals } = derive([witness("draft-it", "✍️", 3, 7), witness("draft-it", "✍️", 3, 9), witness("draft-it", "✍️", 3, 7)]);
  assert.equal(proposals.length, 1);
  assert.equal(proposals[0].count, 2);
  assert.equal(proposals[0].item, "M. Reyes");
});

test("📍 is the rung only until 📜 prints on the same statement", () => {
  assert.deepEqual(keysOf(derive([law("authority-pinpoint", "📍", 9)])), ["authority-pinpoint:statements_of_law:9"]);
  assert.deepEqual(keysOf(derive([law("authority-pinpoint", "📍", 9), law("authority-excerpt", "📜", 9)])), [
    "authority-excerpt:statements_of_law:9",
  ]);
});

test("🔬 is the rung only until either 📜 or 📍 prints on the same statement", () => {
  assert.deepEqual(keysOf(derive([law("scrutinize", "🔬", 4)])), ["scrutinize:statements_of_law:4"]);
  assert.deepEqual(keysOf(derive([law("scrutinize", "🔬", 4), law("authority-excerpt", "📜", 4)])), ["authority-excerpt:statements_of_law:4"]);
  assert.deepEqual(keysOf(derive([law("scrutinize", "🔬", 4), law("authority-pinpoint", "📍", 4)])), ["authority-pinpoint:statements_of_law:4"]);
});

test("🥈 is the rung only until 📖 prints on the same law assertion", () => {
  assert.deepEqual(keysOf(derive([assertion("primary-authority", "🥈", 2)])), ["primary-authority:law_assertions:2"]);
  assert.deepEqual(keysOf(derive([assertion("primary-authority", "🥈", 2), assertion("doctrinal-basis", "📖", 2)])), [
    "doctrinal-basis:law_assertions:2",
  ]);
});

test("✍️ is the rung only until 🗣️ prints on the same witness", () => {
  assert.deepEqual(keysOf(derive([witness("draft-it", "✍️", 3, 7)])), ["draft-it:witnesses:3"]);
  assert.deepEqual(keysOf(derive([witness("draft-it", "✍️", 3, 7), witness("interview", "🗣️", 3, 7)])), ["interview:witnesses:3"]);
});

test("🖋️ is held by 🗣️ on any witness of the instrument, and current when none of them owes one", () => {
  const twoWitnesses = [instrument("sign-it", "🖋️", 6, 1), instrument("sign-it", "🖋️", 6, 2)];
  assert.deepEqual(keysOf(derive(twoWitnesses)), ["sign-it:documents:6"]);
  assert.deepEqual(keysOf(derive([...twoWitnesses, witness("interview", "🗣️", 2, 7)])), ["interview:witnesses:2"]);
});

test("🧷 is held by 🖋️ on its instrument and by 🗣️ or ✍️ on its witness", () => {
  const pin = statement("testimony-pinpoint", "🧷", 5, 3, 6);
  assert.deepEqual(keysOf(derive([pin])), ["testimony-pinpoint:statements_of_fact:5"]);
  assert.deepEqual(keysOf(derive([pin, instrument("sign-it", "🖋️", 6, 3)])), ["sign-it:documents:6"]);
  assert.deepEqual(keysOf(derive([pin, witness("interview", "🗣️", 3, 5)])), ["interview:witnesses:3"]);
  assert.deepEqual(keysOf(derive([pin, witness("draft-it", "✍️", 3, 5)])), ["draft-it:witnesses:3"]);
});

test("📇 is the rung only when some statement of the authority has cleared 📜 📍 🔬", () => {
  assert.deepEqual(keysOf(derive([authority(2, false)])), []);
  assert.deepEqual(keysOf(derive([authority(2, false), authority(2, true)])), ["note-up:authorities:2"]);
});

// Schema v46: a failed scrutiny clears 🔬 for nobody, so only a 'verified' statement clears the
// note-up gate.
test("noteUpCleared reads 'verified' alone: a lead or a failed statement has cleared nothing", () => {
  const row = { excerpt: "the excerpt", pinpoint: "para 1", verification: "verified" };
  assert.equal(noteUpCleared(row), true);
  assert.equal(noteUpCleared({ ...row, verification: "lead" }), false);
  assert.equal(noteUpCleared({ ...row, verification: "failed" }), false);
});

// Schema v47: a settled statement has cleared 🔬 by counsel's confirmed close, and stays subject to
// note-up as a verified one is.
test("noteUpCleared reads 'settled' as cleared, as 'verified' is", () => {
  assert.equal(noteUpCleared({ excerpt: "the excerpt", pinpoint: "para 1", verification: "settled" }), true);
});

// #909: a statement-of-law line prints 🏅 as its own space-separated token, so the whole-token
// match records authority-rating on the statement's authority, and on nothing when it has none.
test("a statement line's 🏅 records authority-rating on its authority", () => {
  const row = {
    statement_id: 7,
    authority_id: 1,
    authority_title: "Case v. X",
    authority_citation: "2020 BCSC 1",
    excerpt: null,
    pinpoint: null,
    verification: null,
  };
  const inv = [];
  recordLawStatementGlyphs(inv, "📜 📍 🏅", row);
  assert.deepEqual(inv.filter((e) => e.slug === "authority-rating").map(proposalKey), ["authority-rating:authorities:1"]);

  const orphan = [];
  recordLawStatementGlyphs(orphan, "📜 📍 🏅", { ...row, authority_id: null });
  assert.deepEqual(orphan.filter((e) => e.table === "authorities"), []);
});

test("a holder puts the Proposal in the held lane, over a matching rejection", () => {
  const entry = assertion("doctrinal-basis", "📖", 4);
  const holder = { ticket_id: 12, ticketed_on: "Reply Submissions Package" };
  const { proposals, lapsed_keys } = derive(
    [entry],
    new Map([["doctrinal-basis:law_assertions:4", holder]]),
    new Map([["doctrinal-basis:law_assertions:4", { ticket_id: null, marker: "📖", item: "the proposition" }]])
  );
  assert.equal(proposals[0].lane, "held");
  assert.deepEqual(proposals[0].holder, holder);
  assert.deepEqual(lapsed_keys, []);
});

test("a direct rejection matching marker and item puts the Proposal in the rejected lane", () => {
  const { proposals } = derive(
    [assertion("doctrinal-basis", "📖", 4)],
    NO_HOLDERS,
    new Map([["doctrinal-basis:law_assertions:4", { ticket_id: null, marker: "📖", item: "the proposition" }]])
  );
  assert.equal(proposals[0].lane, "rejected");
  assert.equal(proposals[0].holder, null);
});

test("a snapshot rejection omits the Proposal rather than rejecting it", () => {
  const { proposals, lapsed_keys } = derive(
    [assertion("doctrinal-basis", "📖", 4)],
    NO_HOLDERS,
    new Map([["doctrinal-basis:law_assertions:4", { ticket_id: 13, marker: "📖", item: "the proposition" }]])
  );
  assert.deepEqual(proposals, []);
  assert.deepEqual(lapsed_keys, []);
});

test("a rejection whose item no longer matches lapses, and the Proposal stands", () => {
  const { proposals, lapsed_keys } = derive(
    [assertion("doctrinal-basis", "📖", 4)],
    NO_HOLDERS,
    new Map([["doctrinal-basis:law_assertions:4", { ticket_id: null, marker: "📖", item: "an older wording" }]])
  );
  assert.equal(proposals[0].lane, "proposed");
  assert.deepEqual(lapsed_keys, ["doctrinal-basis:law_assertions:4"]);
});

test("a rejection on a key that is no longer the current rung is dormant, reported nowhere", () => {
  const { proposals, lapsed_keys } = derive(
    [law("authority-pinpoint", "📍", 9), law("authority-excerpt", "📜", 9)],
    NO_HOLDERS,
    new Map([["authority-pinpoint:statements_of_law:9", { ticket_id: null, marker: "📍", item: "an older wording" }]])
  );
  assert.deepEqual(keysOf({ proposals }), ["authority-excerpt:statements_of_law:9"]);
  assert.deepEqual(lapsed_keys, []);
});

test("output order is WORK_NAMES key order, then table, id and qualifier", () => {
  const unchosen = (qualifier) => ({ slug: "unchosen", marker: "⬜", table: "filings", id: 1, qualifier, item: qualifier });
  const { proposals } = derive([
    unchosen("order"),
    witness("interview", "🗣️", 3, 7),
    unchosen("affidavit"),
    assertion("doctrinal-basis", "📖", 9),
    { slug: "doctrinal-basis", marker: "📖", table: "law_assertions", id: 4, item: "an earlier proposition" },
    { slug: "interview", marker: "🗣️", table: "witnesses", id: 1, item: "A. Renwick", statement_id: 2 },
  ]);
  assert.deepEqual(keysOf({ proposals }), [
    "doctrinal-basis:law_assertions:4",
    "doctrinal-basis:law_assertions:9",
    "interview:witnesses:1",
    "interview:witnesses:3",
    "unchosen:filings:1:affidavit",
    "unchosen:filings:1:order",
  ]);
});

// The two load-time throws (#1581). SYMBOLS is one array shared by every module instance, so each
// test edits it, loads a fresh copy of proposal-inventory.js under a query string the module cache
// has not seen, and puts the array back.
const { SYMBOLS } = await import("../build/submission/forms/symbol-table.js");

async function loadWith(label, edit) {
  const undo = edit();
  try {
    return await import(`../build/submission/forms/proposal-inventory.js?${label}`);
  } finally {
    undo();
  }
}

function withExtraRow(row) {
  return () => {
    SYMBOLS.push(row);
    return () => SYMBOLS.pop();
  };
}

test("loading throws when a symbol-table row carries a slug CARD_ORDER lacks", async () => {
  await assert.rejects(
    loadWith("unknown-slug", withExtraRow({ glyph: "🧪", slug: "no-such-slug", title: "Do the unknown" })),
    { message: 'proposal-inventory: symbol-table.ts row 🧪 carries slug "no-such-slug", which CARD_ORDER lacks' }
  );
});

test("loading throws when a slug has more than one title, or none, in the symbol table", async () => {
  const noteUpTitle = WORK_NAMES["note-up"];
  await assert.rejects(
    loadWith("two-titles", withExtraRow({ glyph: "🧪", slug: "note-up", title: "A second title" })),
    { message: `proposal-inventory: slug "note-up" needs exactly one title in symbol-table.ts, found ${JSON.stringify([noteUpTitle, "A second title"])}` }
  );

  const rows = SYMBOLS.filter((r) => r.slug === "note-up");
  await assert.rejects(
    loadWith("no-title", () => {
      for (const r of rows) delete r.title;
      return () => rows.forEach((r) => (r.title = noteUpTitle));
    }),
    { message: 'proposal-inventory: slug "note-up" needs exactly one title in symbol-table.ts, found [null]' }
  );
  assert.equal((await loadWith("restored", () => () => {})).WORK_NAMES["note-up"], noteUpTitle);
});
