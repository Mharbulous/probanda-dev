// Pure unit tests for the jurisdictional authority-support ladder past 🏛️
// (issue #348, re-shaped by #380 onto order_sought_requires edges) --
// jurisdictionLadderMarker in markers.ts. No database: JurisdictionRequiresEdge
// is a plain object, exactly the shape the renderers' LEFT JOIN queries
// produce -- jurisdictionLadderMarker now takes an array of 0..N edges per
// order, not one slot.

import assert from "node:assert/strict";
import test from "node:test";

const { jurisdictionEdgeMarkers, jurisdictionLadderMarker } = await import("../build/submission/forms/markers.js");

/** A 'filled' edge with a fully clean linked statement -- override per test. */
function baseEdge(overrides = {}) {
  return {
    basis_state: "filled",
    statement_id: 1,
    excerpt: "the excerpt",
    pinpoint: "para 1",
    treatment: "good_law",
    verification: "verified",
    authority_killed_on: null,
    ...overrides,
  };
}

test("no edges at all -- fails toward showing work, renders 🏛️", () => {
  assert.equal(jurisdictionLadderMarker([]), "🏛️");
});

test("needed -- renders 🏛️ regardless of any statement fields", () => {
  const edge = baseEdge({ basis_state: "needed", statement_id: null, excerpt: null, pinpoint: null, treatment: null });
  assert.equal(jurisdictionLadderMarker([edge]), "🏛️");
});

test("dead_end -- renders 🚧", () => {
  const edge = baseEdge({ basis_state: "dead_end" });
  assert.equal(jurisdictionLadderMarker([edge]), "🚧");
});

test("filled with no linked statement -- fails toward showing work, renders 🏛️", () => {
  const edge = baseEdge({ statement_id: null, excerpt: null, pinpoint: null, treatment: null });
  assert.equal(jurisdictionLadderMarker([edge]), "🏛️");
});

test("filled, linked statement, nothing captured, not noted up -- 📜 📍 📇", () => {
  const edge = baseEdge({ excerpt: null, pinpoint: null, treatment: null });
  assert.equal(jurisdictionLadderMarker([edge]), "📜 📍 📇");
});

test("filled, excerpt captured, pinpoint missing, not noted up -- 📍 📇", () => {
  const edge = baseEdge({ pinpoint: null, treatment: null });
  assert.equal(jurisdictionLadderMarker([edge]), "📍 📇");
});

test("filled, fully captured, not noted up -- 📇 alone", () => {
  const edge = baseEdge({ treatment: null });
  assert.equal(jurisdictionLadderMarker([edge]), "📇");
});

test("filled, fully captured, distinguishable -- ⚠️", () => {
  const edge = baseEdge({ treatment: "distinguishable" });
  assert.equal(jurisdictionLadderMarker([edge]), "⚠️");
});

test("filled, fully captured, negative -- 🚨", () => {
  const edge = baseEdge({ treatment: "negative" });
  assert.equal(jurisdictionLadderMarker([edge]), "🚨");
});

test("filled, fully captured, overruled -- reopens the basis slot: ⛔ 🏛️", () => {
  const edge = baseEdge({ treatment: "overruled" });
  assert.equal(jurisdictionLadderMarker([edge]), "⛔ 🏛️");
});

// An overruled authority's own statement lines render no work marker (#828). ⛔ routes the
// replacement -- work-markers.md's ⛔ row: "research-lawyer replaces; basis reopens (⛔→🏛️⊕📖)" --
// so the whole 📜 📍 🔬 🏅 ladder is withheld on rule 1 (a marker names remaining work), and every
// branch that puts 🏛️ on an order's line now leaves it bare. The next three pin one withheld
// rung each; before #828 they rendered "📜 📍 ⛔ 🏛️", "🔬 ⛔ 🏛️" and "🏅 ⛔ 🏛️".
test("filled, excerpt and pinpoint outstanding, overruled -- 📜 📍 withheld: ⛔ 🏛️", () => {
  const edge = baseEdge({ excerpt: null, pinpoint: null, treatment: "overruled" });
  assert.equal(jurisdictionLadderMarker([edge]), "⛔ 🏛️");
});

test("filled, unverified lead, overruled -- 🔬 withheld: ⛔ 🏛️", () => {
  const edge = baseEdge({ verification: "lead", treatment: "overruled" });
  assert.equal(jurisdictionLadderMarker([edge]), "⛔ 🏛️");
});

test("filled, unrated source, overruled -- 🏅 withheld: ⛔ 🏛️", () => {
  const edge = baseEdge({ source: null, treatment: "overruled" });
  assert.equal(jurisdictionLadderMarker([edge]), "⛔ 🏛️");
});

// Overruled AND killed is the ordinary pairing -- being overruled is why one kills an authority.
// The kill wins outright (design §4, #796): a killed item's own lines render no marker of any
// type, work or event, so ⛔ goes with the rest and the edge contributes the bare 🏛️ the kill
// itself owes. Nothing is lost -- ⛔'s job is to route the reopen, and the kill has already
// routed it.
test("filled, overruled AND on a KILLED authority -- the kill silences ⛔ too: 🏛️", () => {
  const edge = baseEdge({ treatment: "overruled", authority_killed_on: "2026-09-01" });
  assert.equal(jurisdictionLadderMarker([edge]), "🏛️");
});

test("filled, fully captured, good_law -- clean, renders nothing", () => {
  const edge = baseEdge({ treatment: "good_law" });
  assert.equal(jurisdictionLadderMarker([edge]), "");
});

// #502's jurisdictional half: work-markers.md's 🔬 row is "doctrinal and jurisdictional alike",
// and §5 runs the order's citation up the same 📜 📍 🔬 📇 ladder. Before this, a filled basis
// resting on an unverified lead rendered a clean order line -- the rule-6 breach the doctrinal
// side was just fixed for (observed live on L8443, where all three orders' bases cite a lead).
test("filled, fully captured, resting on an unverified lead -- 🔬", () => {
  const edge = baseEdge({ verification: "lead" });
  assert.equal(jurisdictionLadderMarker([edge]), "🔬");
});

test("filled, lead, not yet noted up -- 🔬 precedes 📇, the ladder's order", () => {
  const edge = baseEdge({ verification: "lead", treatment: null });
  assert.equal(jurisdictionLadderMarker([edge]), "🔬 📇");
});

// work-markers.md §4 "Killed": a killed authority's statements are invisible to 📖 🔬 🥉 🥈 🏅
// 🏛️. On this ladder that means 🔬 and 🏅 are withheld, and -- because the statement is invisible
// to 🏛️ too -- a 'filled' edge resting on one never fills the basis, so 🏛️ stays on the line.
test("filled, lead on a KILLED authority -- 🔬 silenced, but the basis is not filled: 🏛️", () => {
  const edge = baseEdge({ verification: "lead", authority_killed_on: "2026-09-01" });
  assert.equal(jurisdictionLadderMarker([edge]), "🏛️", "a killed authority is invisible to 🔬 and cannot fill the basis");
});

// Schema v46: a statement the research lawyer failed supports nothing, so a 'filled' edge resting
// on one fills no basis, as a killed one does not, and contributes 🏛️ alone: its 👃 and finding
// print on the statement's own line, and the decision is counsel's.
test("filled, statement failed by scrutiny -- the basis is not filled: bare 🏛️", () => {
  assert.equal(jurisdictionLadderMarker([baseEdge({ verification: "failed" })]), "🏛️");
  assert.equal(jurisdictionLadderMarker([baseEdge({ verification: "failed", excerpt: null, treatment: null })]), "🏛️", "no rung of the failed statement's own reaches the order's line");
});

// Schema v47: a settled statement is counsel's confirmed close over a scrutiny finding. It fills the
// basis as a verified one does, and raises no 🔬, since a settled row is not a lead.
test("filled, statement settled by counsel -- fills the basis and raises no 🔬: clean", () => {
  const marker = jurisdictionLadderMarker([baseEdge({ verification: "settled" })]);
  assert.equal(marker, "");
  assert.doesNotMatch(marker, /🏛️|🔬/);
});

// Spec R6 (schema v47): an order deployed on no live Writing raises no 🔬 on its edges. The
// default is deployed, so every existing caller keeps its 🔬.
test("filled, lead, order deployed on no live Writing -- 🔬 withheld", () => {
  const edge = baseEdge({ verification: "lead" });
  assert.deepEqual(jurisdictionEdgeMarkers([edge], false), [""]);
  assert.deepEqual(jurisdictionEdgeMarkers([edge]), ["🔬"], "the deployed control");
});

test("filled, unrated statement on a KILLED authority -- 🏅 withheld, 🏛️ renders", () => {
  const edge = baseEdge({ source: null, authority_killed_on: "2026-09-01" });
  assert.equal(jurisdictionLadderMarker([edge]), "🏛️", "a killed authority is owed no source rating (§4)");
});

test("filled, unrated statement on a live authority -- 🏅 still renders (the control)", () => {
  const edge = baseEdge({ source: null });
  assert.equal(jurisdictionLadderMarker([edge]), "🏅");
});

// Pins the reading, not just the behaviour: a killed item's own lines render no marker of any
// type, work or event, so on this ladder a killed edge contributes exactly 🏛️ and nothing else.
// The governing text is the Work Board Proposals design (planning/1. Design/
// 2026-09-15_work-board-proposals-design.md) §4 -- "Dropped authorities never generate. Neither
// does a statement of law whose authority is dropped, nor 📇 on a dropped authority" -- and §8,
// which names markers printed on killed-authority statements a known defect to fix before the
// collector ships. The earlier reading, that §4's "invisible to 📖 🔬 🥉 🥈 🏅 🏛️" list was
// exhaustive and left 📜 📍 📇 standing, is overturned (#796). The edge below owes every one of
// those three, which is why it states the expectation glyph by glyph.
test("KILLED authority -- its own line renders no marker but the 🏛️ the kill owes", () => {
  const edge = baseEdge({ excerpt: null, pinpoint: null, treatment: null, authority_killed_on: "2026-09-01" });
  assert.equal(jurisdictionLadderMarker([edge]), "🏛️");
});

// Each edge is its own recorded requirement, exactly as a 'needed' edge beside a satisfied one
// already renders 🏛️ (the dedupe test below). A killed edge is no different: the requirement it
// records has lost its support, so the line shows the work even though a sibling edge is filled.
test("a killed edge beside a live filled one still puts 🏛️ on the line", () => {
  const live = baseEdge({ source: "primary" });
  const killed = baseEdge({ statement_id: 2, source: null, authority_killed_on: "2026-09-01" });
  assert.equal(jurisdictionLadderMarker([live, killed]), "🏛️");
  assert.equal(jurisdictionLadderMarker([live]), "", "the live edge alone renders clean -- the control");
});

test("multiple edges -- one satisfied, one still needed: dedupes to 🏛️ alone", () => {
  const satisfied = baseEdge();
  const needed = baseEdge({ basis_state: "needed", statement_id: null, excerpt: null, pinpoint: null, treatment: null });
  assert.equal(jurisdictionLadderMarker([satisfied, needed]), "🏛️");
});

test("multiple edges -- distinct glyphs from different edges both render", () => {
  const distinguishable = baseEdge({ treatment: "distinguishable" });
  const negative = baseEdge({ statement_id: 2, treatment: "negative" });
  const marker = jurisdictionLadderMarker([distinguishable, negative]);
  assert.match(marker, /⚠️/);
  assert.match(marker, /🚨/);
});
