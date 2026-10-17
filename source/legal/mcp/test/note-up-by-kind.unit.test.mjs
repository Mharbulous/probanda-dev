// 📇 note up by authority kind (#1628): noting up a statute, regulation or rule is the
// statute-currency check alone. A case owes 📇 while `treatment` is ∅; a statute, regulation or
// rule while `currency_status` is anything but 'current' (∅ included); doctrine never. A
// statute, regulation or rule found repealed or archived still prints 📇 but proposes no note-up
// job: the check is finished and the work is the practitioner's. Pure: no database, no render.

import assert from "node:assert/strict";
import test from "node:test";

const { jurisdictionEdgeMarkers } = await import("../build/submission/forms/markers.js");
const { lawStatementMarkers } = await import("../build/submission/forms/law-statement-line.js");
const { deriveProposals, proposalKey, recordLawStatementGlyphs, withNoteUpSteps } = await import("../build/submission/forms/proposal-inventory.js");

/** Today's local date, so a 'current' result is inside the freshness window. */
const d = new Date();
const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** A statement that has cleared 📜 📍 🔬 and is rated, on an authority of the given kind, its
 * currency checked today. */
const cleared = (authority_kind, currency_status, treatment = null) => ({
  statement_id: 7,
  authority_id: 3,
  authority_title: "Limitation Act",
  authority_citation: "SBC 2012, c 13",
  authority_kind,
  currency_status,
  currency_checked_on: today,
  treatment,
  excerpt: "The passage.",
  pinpoint: "s 6",
  source: "primary",
  verification: "verified",
  doubt: null,
  authority_killed_on: null,
  settled_on: null,
});

/** The jurisdictional edge twin of `cleared`. */
const edge = (row) => ({ ...row, basis_state: "filled" });

const glyphsOf = (s) => s.split(" ").filter(Boolean);

/** Both statement-line sites: the doctrinal/prose-cited line and one jurisdictional edge. */
function bothSites(row) {
  return [lawStatementMarkers(row), jurisdictionEdgeMarkers([edge(row)])[0]];
}

/** The note-up Proposal keys a statement line derives once its glyphs are recorded. */
function noteUpKeys(row) {
  const inv = [];
  recordLawStatementGlyphs(inv, lawStatementMarkers(row), row);
  return deriveProposals(inv, new Map(), new Map()).proposals.map((p) => p.key).filter((k) => k.startsWith("note-up:"));
}

for (const kind of ["statute", "regulation", "rule"]) {
  test(`a ${kind} prints 📇 while its currency is unchecked or not found, treatment notwithstanding`, () => {
    for (const currency of [null, "not-found", "validation_unavailable"]) {
      for (const glyphs of bothSites(cleared(kind, currency))) assert.ok(glyphsOf(glyphs).includes("📇"), `${currency}: ${glyphs}`);
      for (const glyphs of bothSites(cleared(kind, currency, "good_law"))) assert.ok(glyphsOf(glyphs).includes("📇"), `${currency}, good_law: ${glyphs}`);
    }
  });

  test(`a current ${kind} prints no 📇, even with treatment ∅`, () => {
    for (const glyphs of bothSites(cleared(kind, "current"))) assert.ok(!glyphs.includes("📇"), glyphs);
  });

  test(`a ${kind} keeps its treatment glyph beside the currency-driven 📇`, () => {
    for (const glyphs of bothSites(cleared(kind, null, "distinguishable"))) assert.deepEqual(glyphsOf(glyphs).sort(), ["⚠️", "📇"].sort(), glyphs);
    for (const glyphs of bothSites(cleared(kind, "current", "negative"))) assert.deepEqual(glyphsOf(glyphs), ["🚨"], glyphs);
  });

  test(`an overruled ${kind} keeps the overruled behaviour: ⛔, no 📇`, () => {
    assert.equal(lawStatementMarkers(cleared(kind, null, "overruled")), "⛔");
    assert.equal(jurisdictionEdgeMarkers([edge(cleared(kind, null, "overruled"))])[0], "⛔ 🏛️");
  });

  test(`a repealed or archived ${kind} prints 📇 but proposes no note-up`, () => {
    for (const currency of ["repealed", "archived"]) {
      for (const glyphs of bothSites(cleared(kind, currency))) assert.ok(glyphsOf(glyphs).includes("📇"), `${currency}: ${glyphs}`);
      assert.deepEqual(noteUpKeys(cleared(kind, currency)), [], currency);
    }
  });

  test(`a ${kind} with unchecked or not-found currency proposes the note-up once a statement cleared 📜 📍 🔬`, () => {
    for (const currency of [null, "not-found", "validation_unavailable"]) {
      assert.deepEqual(noteUpKeys(cleared(kind, currency)), ["note-up:authorities:3"], String(currency));
    }
    assert.deepEqual(noteUpKeys({ ...cleared(kind, null), verification: "lead" }), [], "a lead has cleared nothing");
  });
}

test("doctrine never prints 📇 and proposes no note-up, with treatment ∅", () => {
  for (const currency of [null, "repealed", "current"]) {
    for (const glyphs of bothSites(cleared("doctrine", currency))) assert.ok(!glyphs.includes("📇"), glyphs);
    assert.deepEqual(noteUpKeys(cleared("doctrine", currency)), []);
  }
});

test("a case is unchanged: 📇 on treatment ∅ whatever its currency, and the note-up proposes as before", () => {
  for (const currency of [null, "current", "repealed"]) {
    for (const glyphs of bothSites(cleared("case", currency))) assert.ok(glyphsOf(glyphs).includes("📇"), glyphs);
    assert.deepEqual(noteUpKeys(cleared("case", currency)), ["note-up:authorities:3"]);
  }
  for (const glyphs of bothSites(cleared("case", null, "good_law"))) assert.ok(!glyphs.includes("📇"), glyphs);
  assert.deepEqual(noteUpKeys(cleared("case", null, "good_law")), []);
});

// A note-up of a statute, regulation or rule is done provision by provision: its Proposal carries
// one step per provision the filing cites, never one that restates its title.
const RULES = { authority_id: 1, authority_title: "Supreme Court Civil Rules", authority_citation: "B.C. Reg. 168/2009" };
const TITLE = "Note up: Supreme Court Civil Rules, B.C. Reg. 168/2009";

/** The note-up Proposals and their steps, from statement lines recorded as a render records them. */
function stepsOf(statements, contentions = [], pinpoints = statements) {
  const inv = [];
  for (const row of statements) recordLawStatementGlyphs(inv, lawStatementMarkers(row), row);
  const proposals = deriveProposals(inv, new Map(), new Map()).proposals.filter((p) => p.slug === "note-up");
  const cited = pinpoints.filter((s) => s.pinpoint !== null).map((s) => ({ authority_id: s.authority_id, pinpoint: s.pinpoint }));
  return Object.fromEntries(withNoteUpSteps(proposals, inv, cited, contentions).map((p) => [p.key, p.steps]));
}

const ruleAt = (statement_id, pinpoint) => ({ ...cleared("rule", null), ...RULES, statement_id, pinpoint });

test("a rule cited at three pinpoints and once in a contention's text proposes four steps, one per provision", () => {
  const statements = [ruleAt(11, "r. 9-6(3)"), ruleAt(12, "r. 9-6(5)"), ruleAt(13, "r. 3-4(7.1)")];
  assert.deepEqual(stepsOf(statements, ["The respondent should have its costs under Rule 14-1(12)."]), {
    "note-up:authorities:1": [`${TITLE}, r. 9-6(3)`, `${TITLE}, r. 9-6(5)`, `${TITLE}, r. 3-4(7.1)`, `${TITLE}, Rule 14-1(12)`],
  });
});

test("a provision cited twice, or again in the text, is one step", () => {
  const statements = [ruleAt(11, "r. 9-6(3)"), ruleAt(12, "r. 9-6(3)")];
  assert.deepEqual(stepsOf(statements, ["Rule 9-6(3) applies."]), { "note-up:authorities:1": [`${TITLE}, r. 9-6(3)`] });
});

test("a contention's provision goes to no authority when two cite provisions of its form", () => {
  const other = { ...ruleAt(21, "r. 1-1(1)"), authority_id: 2, authority_title: "Supreme Court Family Rules", authority_citation: "B.C. Reg. 169/2009" };
  const steps = stepsOf([ruleAt(11, "r. 9-6(3)"), other], ["Costs under Rule 14-1(12)."]);
  assert.deepEqual(steps["note-up:authorities:1"], [`${TITLE}, r. 9-6(3)`]);
  assert.deepEqual(steps["note-up:authorities:2"], ["Note up: Supreme Court Family Rules, B.C. Reg. 169/2009, r. 1-1(1)"]);
});

test("a rule whose only pinpoint names no provision proposes no step that restates the title", () => {
  // A blank pinpoint still reads as captured (noteUpCleared), so the Proposal derives with no provision.
  assert.deepEqual(stepsOf([ruleAt(11, "  ")]), { "note-up:authorities:1": [] });
});

test("a rule with no pinpoint proposes no note-up job at all", () => {
  assert.deepEqual(stepsOf([ruleAt(11, null)], ["Costs under Rule 14-1(12)."], []), {});
});

test("a case's note-up Proposal carries no steps, its single step staying its title", () => {
  const steps = stepsOf([{ ...cleared("case", null), statement_id: 11, pinpoint: "para 31" }], ["Under s. 6 the claim is out of time."]);
  assert.deepEqual(Object.keys(steps), ["note-up:authorities:3"]);
  assert.equal(steps["note-up:authorities:3"], undefined);
});

test("the recorded 📇 entry keys on the authority whatever the kind", () => {
  const inv = [];
  recordLawStatementGlyphs(inv, lawStatementMarkers(cleared("statute", "repealed")), cleared("statute", "repealed"));
  const noteUps = inv.filter((e) => e.marker === "📇");
  assert.deepEqual(noteUps.filter((e) => e.generating).map(proposalKey), ["note-up:authorities:3"], "the printed 📇 stays in the inventory");
  assert.deepEqual(
    noteUps.filter((e) => !e.generating).map((e) => `${e.table}:${e.id}`),
    ["authorities:3"],
    "and a criterion entry keeps the noting-up row open"
  );
});
