// 🧐 final review (work-markers.md row 🧐; practitioner-review design §3, §5; plan Phase 5):
// the predicate, the glyph lists, the snapshot serializer, and the pin between
// REVIEW_SNAPSHOT_FIELDS and the /drafting-data reference review.md. Pure: no database, no render.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const { ALL_MARKER_GLYPHS, WORK_MARKER_GLYPHS, counselReviewMarker, REVIEW_SNAPSHOT_FIELDS, reviewSnapshotSql } = await import("../build/submission/forms/markers.js");
const { NON_GENERATING_GLYPHS, GLYPH_SLUGS, deriveProposals } = await import("../build/submission/forms/proposal-inventory.js");
const { submissionDataMigrateScriptsDir } = await import("../build/repo-root.js");
const { orderReviewMarkerFor } = await import("../build/submission/forms/render-vaniac-submissions.js");

const SNAP = `{"excerpt":"The passage.","pinpoint":"para 4"}`;

test("🧐 fires with no approval or a differing one, and clears on a byte-identical approval", () => {
  assert.equal(counselReviewMarker("", SNAP, null), "🧐", "never approved");
  assert.equal(counselReviewMarker("", SNAP, SNAP), "", "the latest approval matches");
  assert.equal(counselReviewMarker("", SNAP, SNAP + "x"), "🧐", "the stored fields changed since approval");
  assert.equal(counselReviewMarker("", SNAP + " ", SNAP), "🧐", "one byte is a change");
});

test("any other 1a work glyph on the line holds 🧐 back, fused or beside an event", () => {
  for (const g of WORK_MARKER_GLYPHS) {
    if (g === "🧐") continue;
    assert.equal(counselReviewMarker(g, SNAP, null), "", `${g} holds 🧐 back`);
    assert.equal(counselReviewMarker(`⚠️ ${g}`, SNAP, null), "", `⚠️ ${g} holds 🧐 back`);
  }
  assert.equal(counselReviewMarker("🥈🏅", SNAP, null), "", "the fused rung counts by containment");
});

test("events and holds do not hold 🧐 back", () => {
  for (const g of ["⚠️", "🚨", "🏆", "🚧", "🙅🏻‍♂️"]) {
    assert.equal(counselReviewMarker(g, SNAP, null), "🧐", `${g} renders beside 🧐`);
  }
});

test("🧐 is a filed-face-stripped, non-generating 1a glyph", () => {
  assert.ok(ALL_MARKER_GLYPHS.includes("🧐"), "ALL_MARKER_GLYPHS carries 🧐, so the filed face strips it");
  for (const g of WORK_MARKER_GLYPHS) assert.ok(ALL_MARKER_GLYPHS.includes(g), `${g} is in WORK_MARKER_GLYPHS but not ALL_MARKER_GLYPHS`);
  assert.equal(WORK_MARKER_GLYPHS.length, 31, "work-markers.md table 1a holds 31 work glyphs");
  assert.ok(NON_GENERATING_GLYPHS.includes("🧐"));
  assert.equal(GLYPH_SLUGS.has("🧐"), false, "🧐 generates no Proposal");
});

test("reviewSnapshotSql builds the json_object expression in key order", () => {
  assert.equal(reviewSnapshotSql("statements_of_fact"), "json_object('excerpt', excerpt, 'pinpoint', pinpoint, 'exhibit_excerpt', exhibit_excerpt, 'exhibit_pinpoint', exhibit_pinpoint)");
});

test("a statement of law snapshots its authority's treatment, and a proposition its overruled statements, each computed from its own row (#1200)", () => {
  assert.equal(
    reviewSnapshotSql("statements_of_law"),
    "json_object('excerpt', excerpt, 'pinpoint', pinpoint, 'treatment', (SELECT a.treatment || COALESCE(' — ' || a.treatment_note, '') FROM authorities a WHERE a.id = statements_of_law.authority_id))"
  );
  assert.equal(
    reviewSnapshotSql("statements_of_law", false),
    "json_object('excerpt', excerpt, 'pinpoint', pinpoint, 'treatment', (SELECT a.treatment FROM authorities a WHERE a.id = statements_of_law.authority_id))",
    "a database held below v51 reads the pre-v51 key"
  );
  assert.equal(
    reviewSnapshotSql("law_assertions"),
    "json_object('proposition', proposition, 'overruled_statement_ids', (SELECT group_concat(s.id ORDER BY s.id) FROM statements_of_law s JOIN authorities a ON a.id = s.authority_id WHERE s.law_assertion_id = law_assertions.id AND a.treatment = 'overruled'))"
  );
});

test("REVIEW_SNAPSHOT_FIELDS matches review.md's Snapshot fields table, key order and expression included", () => {
  const file = join(submissionDataMigrateScriptsDir(process.env), "..", "review.md");
  const fields = {};
  const expressions = {};
  for (const line of readFileSync(file, "utf-8").split(/\r?\n/)) {
    if (!line.startsWith("| ")) continue;
    // A pipe inside a cell is escaped `\|` for the table; the expression has no backslash.
    const cells = line.split(/(?<!\\)\|/).slice(1, -1).map((c) => c.trim().replace(/\\\|/g, "|"));
    const table = /^`([a-z_]+)`$/.exec(cells[1] ?? "");
    if (!table) continue;
    fields[table[1]] = [...cells[2].matchAll(/`([a-z_]+)`/g)].map((m) => m[1]);
    expressions[table[1]] = /^`(.*)`$/.exec(cells[3])?.[1];
  }
  assert.deepEqual(Object.keys(fields), Object.keys(REVIEW_SNAPSHOT_FIELDS), `${file}: the tables, in order, differ from REVIEW_SNAPSHOT_FIELDS`);
  assert.deepEqual(fields, REVIEW_SNAPSHOT_FIELDS, `${file}: the snapshot keys differ from REVIEW_SNAPSHOT_FIELDS`);
  for (const table of Object.keys(REVIEW_SNAPSHOT_FIELDS)) {
    assert.equal(expressions[table], reviewSnapshotSql(table), `${file}: ${table}'s expression differs from reviewSnapshotSql`);
  }
});

test("the clause kind snapshots its basis and its excerpt reference (#1078; work-markers.md row 🧐)", () => {
  assert.ok(REVIEW_SNAPSHOT_FIELDS.clauses.includes("basis"));
  assert.ok(REVIEW_SNAPSHOT_FIELDS.clauses.includes("excerpt_id"));
});

test("the clause kind snapshots whether its cited authority is overruled, computed from its own row (#1198)", () => {
  assert.ok(REVIEW_SNAPSHOT_FIELDS.clauses.includes("cited_overruled"));
  assert.match(reviewSnapshotSql("clauses"), /'cited_overruled', \(SELECT 1 FROM statements_of_law s JOIN authorities a ON a\.id = s\.authority_id WHERE s\.id = clauses\.excerpt_id AND a\.treatment = 'overruled'\)\)$/);
});

// An order's line (review.md, "Snapshot fields"): the order's own 🧐, or its filing's `filing_orders`
// row's while that row holds a wording_override (practitioner's decision, 2026-10-05).
const ORDER = `{"wording":"The defendant pay costs.","template_key":null,"template_values":null,"amount":null,"basis_statements":null}`;
const OVERRIDE = (w) => JSON.stringify({ wording_override: w });
const orderRow = (wordingOverride) => ({ id: 1, pointer_id: 31, wording: "The defendant pay costs.", wording_override: wordingOverride });
const reviewState = (current, approved) => ({ current: new Map(Object.entries(current)), approved: new Map(Object.entries(approved)) });

test("an order line reads 🧐 when its filing's override changed after approval, recorded on the filing_orders row", () => {
  const review = reviewState(
    { "order_sought:1": ORDER, "filing_orders:31": OVERRIDE("The defendants pay costs forthwith.") },
    { "order_sought:1": ORDER, "filing_orders:31": OVERRIDE("The defendants pay costs.") }
  );
  const inv = [];
  assert.equal(orderReviewMarkerFor(review, inv, "", orderRow("The defendants pay costs forthwith.")), "🧐");
  assert.deepEqual(
    inv.map((e) => ({ table: e.table, id: e.id, changed: e.changed })),
    [{ table: "filing_orders", id: 31, changed: true }],
    "the approved order records nothing; the override's row records a changed 🧐"
  );
});

test("a NULL override raises no 🧐 by itself, though its row has no approval", () => {
  const review = reviewState({ "order_sought:1": ORDER, "filing_orders:31": OVERRIDE(null) }, { "order_sought:1": ORDER });
  const inv = [];
  assert.equal(orderReviewMarkerFor(review, inv, "", orderRow(null)), "");
  assert.deepEqual(inv, []);
});

test("an override approved and unchanged raises no 🧐", () => {
  const review = reviewState(
    { "order_sought:1": ORDER, "filing_orders:31": OVERRIDE("The defendants pay costs.") },
    { "order_sought:1": ORDER, "filing_orders:31": OVERRIDE("The defendants pay costs.") }
  );
  assert.equal(orderReviewMarkerFor(review, [], "", orderRow("The defendants pay costs.")), "");
});

test("a changed order_sought still reads 🧐 on its line, with or without an approved override", () => {
  const changed = ORDER.replace("costs.", "costs forthwith.");
  const bare = reviewState({ "order_sought:1": changed, "filing_orders:31": OVERRIDE(null) }, { "order_sought:1": ORDER });
  assert.equal(orderReviewMarkerFor(bare, [], "", orderRow(null)), "🧐");
  const withOverride = reviewState(
    { "order_sought:1": changed, "filing_orders:31": OVERRIDE("The defendants pay costs.") },
    { "order_sought:1": ORDER, "filing_orders:31": OVERRIDE("The defendants pay costs.") }
  );
  const inv = [];
  assert.equal(orderReviewMarkerFor(withOverride, inv, "", orderRow("The defendants pay costs.")), "🧐");
  assert.deepEqual(inv.map((e) => `${e.table}:${e.id}`), ["order_sought:1"]);
  assert.equal(orderReviewMarkerFor(withOverride, [], "🏛️", orderRow("The defendants pay costs.")), "", "another 1a work marker still holds it back");
});

test("a 🧐 entry derives no Proposal, changed or not", () => {
  const entry = { generating: false, marker: "🧐", table: "submissions", id: 1, item: "x", doc: "Written_arguments", changed: true };
  assert.deepEqual(deriveProposals([entry], new Map(), new Map()).proposals, []);
});
