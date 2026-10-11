// Pure unit tests for the admission-ladder derivation (issue #344) --
// admissionLadderState/admissionRungMarker/admissionCaptureMarkers in
// markers.ts. No database, no golden fixture: `today` is always a literal
// string parameter, exactly so these branchy cases can be pinned exactly
// without a golden fixture's byte-for-byte fragility.

import assert from "node:assert/strict";
import test from "node:test";

const {
  admissionLadderState,
  admissionRungMarker,
  admissionCaptureMarkers,
  admissionRole,
  admittedAgainstAllOpposing,
  isAdmittedGuard,
  noWitnessMarker,
  courtRecordPinpointMarker,
  courtRecordCitation,
  citedExhibitLetters,
  swornExhibitLetters,
} = await import("../build/submission/forms/markers.js");

const TODAY = "2026-08-23";

/** A fully "nothing outstanding" base row -- override per test. */
function baseRow(overrides = {}) {
  return {
    method: "notice_to_admit",
    instrument: 1,
    instrumentServedOn: null,
    instrumentPinpoint: "item 1",
    responseDue: null,
    response: null,
    responseDate: null,
    responsePinpoint: null,
    responseExcerpt: null,
    answer: null,
    struckOn: null,
    responseFilingSelected: false,
    instrumentAndServiceSelected: false,
    defaultJudgmentRequisitionExists: false,
    ...overrides,
  };
}

function rung(row, today = TODAY) {
  return admissionRungMarker(admissionLadderState(row, today));
}

test("not sought -- instrument NULL renders nothing, regardless of other fields", () => {
  const row = baseRow({ instrument: null, answer: "agreed" });
  assert.equal(admissionLadderState(row, TODAY).state, "not_sought");
  assert.equal(rung(row), "");
});

test("serve -- instrument drafted, unserved, no response", () => {
  const row = baseRow({ instrumentServedOn: null, response: null });
  assert.equal(admissionLadderState(row, TODAY).state, "serve");
  assert.equal(rung(row), "🎾");
});

test("a response with no recorded served_on falls through to classification, not serve", () => {
  const row = baseRow({ instrumentServedOn: null, response: 9, answer: "agreed", responseFilingSelected: true });
  const result = admissionLadderState(row, TODAY);
  assert.notEqual(result.state, "serve");
  assert.equal(result.state, "clean");
});

test("waiting -- served, no response, response_due not yet passed", () => {
  const row = baseRow({ instrumentServedOn: "2026-08-01", responseDue: "2126-01-01" });
  assert.equal(admissionLadderState(row, TODAY).state, "waiting");
  assert.equal(rung(row), "⏳");
});

test("waiting -- served, no response_due recorded at all", () => {
  const row = baseRow({ instrumentServedOn: "2026-08-01", responseDue: null });
  assert.equal(admissionLadderState(row, TODAY).state, "waiting");
  assert.equal(rung(row), "⏳");
});

test("classify -- agreed, response filing-selected -- clean, prints nothing", () => {
  const row = baseRow({
    instrumentServedOn: "2026-06-01",
    responseDue: "2026-06-15",
    response: 9,
    responseDate: "2026-06-10",
    answer: "agreed",
    responseFilingSelected: true,
  });
  assert.equal(admissionLadderState(row, TODAY).state, "clean");
  assert.equal(rung(row), "");
});

test("classify -- agreed, response not filing-selected -- tender, renders 🤝 🕹️", () => {
  const row = baseRow({
    instrumentServedOn: "2026-06-01",
    responseDue: "2026-06-15",
    response: 9,
    responseDate: "2026-06-10",
    answer: "agreed",
    responseFilingSelected: false,
  });
  const result = admissionLadderState(row, TODAY);
  assert.equal(result.state, "tender");
  assert.equal(result.base, "admitted");
  assert.equal(rung(row), "🤝 🕹️");
});

test("classify -- denied", () => {
  const row = baseRow({ instrumentServedOn: "2026-06-01", responseDue: "2026-06-15", response: 9, responseDate: "2026-06-10", answer: "denied" });
  assert.equal(admissionLadderState(row, TODAY).state, "denied");
  assert.equal(rung(row), "🙅🏻‍♂️");
});

test("classify -- refused", () => {
  const row = baseRow({ instrumentServedOn: "2026-06-01", responseDue: "2026-06-15", response: 9, responseDate: "2026-06-10", answer: "refused" });
  assert.equal(admissionLadderState(row, TODAY).state, "refused");
  assert.equal(rung(row), "🫸");
});

test("classify -- no_knowledge", () => {
  const row = baseRow({
    instrumentServedOn: "2026-06-01",
    responseDue: "2026-06-15",
    response: 9,
    responseDate: "2026-06-10",
    answer: "no_knowledge",
  });
  assert.equal(admissionLadderState(row, TODAY).state, "no_knowledge");
  assert.equal(rung(row), "🤷");
});

test("NtA silent item (in-time response, answer NULL) counts as no response -- routes to deemed timing", () => {
  const row = baseRow({
    method: "notice_to_admit",
    instrumentServedOn: "2026-06-01",
    responseDue: "2126-01-01", // far future -- still "waiting" territory
    response: 9,
    responseDate: "2026-06-10",
    answer: null,
  });
  // Not classified (no answer) -- falls to the deemed/waiting timing check,
  // which still sees response_due unexpired -- waiting.
  assert.equal(admissionLadderState(row, TODAY).state, "waiting");
});

test("NtA late response -- deemed stands even though a response exists", () => {
  const row = baseRow({
    method: "notice_to_admit",
    instrumentServedOn: "2026-06-01",
    responseDue: "2020-01-01", // long expired
    response: 9,
    responseDate: "2026-06-10", // arrived, but after response_due
    answer: "agreed",
    instrumentAndServiceSelected: false,
  });
  const result = admissionLadderState(row, TODAY);
  assert.equal(result.state, "tender");
  assert.equal(result.base, "deemed");
  assert.equal(rung(row), "⏰ 🕹️");
});

test("pleading late response still classifies (judgment-entered not derivable -- pinned interpretation)", () => {
  const row = baseRow({
    method: "pleading",
    instrumentServedOn: "2026-06-01",
    responseDue: "2020-01-01", // long expired
    response: 9,
    responseDate: "2026-06-10",
    answer: "denied",
  });
  assert.equal(admissionLadderState(row, TODAY).state, "denied");
});

test("pleading, response present, answer NULL -- no_knowledge (🤷)", () => {
  const row = baseRow({ method: "pleading", instrumentServedOn: "2026-06-01", responseDue: "2126-01-01", response: 9, answer: null });
  assert.equal(admissionLadderState(row, TODAY).state, "no_knowledge");
  assert.equal(rung(row), "🤷");
});

test("interrogatories, deemed (no answer, response_due expired) -- bare ⏰, no 🕹️ refinement", () => {
  const row = baseRow({ method: "interrogatories", instrumentServedOn: "2026-06-01", responseDue: "2020-01-01", response: null, answer: null });
  const result = admissionLadderState(row, TODAY);
  assert.equal(result.state, "deemed");
  assert.equal(result.base, undefined);
  assert.equal(rung(row), "⏰");
});

test("interrogatories, classified late answer still classifies (practitioner's classification is the routing decision)", () => {
  const row = baseRow({
    method: "interrogatories",
    instrumentServedOn: "2026-06-01",
    responseDue: "2020-01-01",
    response: 9,
    responseDate: "2026-06-10",
    answer: "agreed",
    responseFilingSelected: true,
  });
  assert.equal(admissionLadderState(row, TODAY).state, "clean");
});

test("oral -- born answered, answer set classifies directly (no 🎾/⏳ ever apply)", () => {
  const row = baseRow({ method: "oral", instrument: 1, instrumentServedOn: null, response: null, answer: "agreed", responseFilingSelected: true });
  assert.equal(admissionLadderState(row, TODAY).state, "clean");
});

test("oral -- struck renders bare ⚡️ (no response period to reset)", () => {
  const row = baseRow({ method: "oral", instrument: 1, struckOn: "2026-06-01", answer: "agreed" });
  assert.equal(admissionLadderState(row, TODAY).state, "struck");
  assert.equal(rung(row), "⚡️");
});

test("oral -- answer-less row (incomplete seed data) renders nothing, not an invented rung", () => {
  const row = baseRow({ method: "oral", instrument: 1, answer: null, struckOn: null });
  assert.equal(admissionLadderState(row, TODAY).state, "not_sought");
});

test("struck -- no new response_due -- bare ⚡️", () => {
  const row = baseRow({ instrumentServedOn: "2026-06-01", struckOn: "2026-07-01", responseDue: null });
  assert.equal(admissionLadderState(row, TODAY).state, "struck");
  assert.equal(rung(row), "⚡️");
});

test("struck -- new response_due no later than the strike date -- still bare ⚡️", () => {
  const row = baseRow({ instrumentServedOn: "2026-06-01", struckOn: "2026-07-01", responseDue: "2026-07-01" });
  assert.equal(admissionLadderState(row, TODAY).state, "struck");
});

test("struck -- court-reset response_due beyond the strike, unexpired -- waiting with struckReset", () => {
  const row = baseRow({ instrumentServedOn: "2026-06-01", struckOn: "2026-07-01", responseDue: "2126-01-01" });
  const result = admissionLadderState(row, TODAY);
  assert.equal(result.state, "waiting");
  assert.equal(result.struckReset, true);
  assert.equal(rung(row), "⚡️ ⏳");
});

test("struck -- court-reset response_due beyond the strike, itself now expired -- falls through to deemed", () => {
  const row = baseRow({
    method: "notice_to_admit",
    instrumentServedOn: "2026-06-01",
    struckOn: "2026-06-15",
    responseDue: "2026-06-20", // after struckOn, but still in the past relative to TODAY
    instrumentAndServiceSelected: true,
  });
  const result = admissionLadderState(row, TODAY);
  assert.equal(result.state, "clean");
  assert.equal(result.base, "deemed");
});

test("🕹️ clears -- admitted base, response filing-selected", () => {
  const row = baseRow({
    instrumentServedOn: "2026-06-01",
    responseDue: "2026-06-15",
    response: 9,
    responseDate: "2026-06-10",
    answer: "agreed",
    responseFilingSelected: true,
  });
  assert.equal(admissionLadderState(row, TODAY).state, "clean");
});

test("🕹️ clears -- deemed base, NtA, instrument + affidavit of service selected", () => {
  const row = baseRow({
    method: "notice_to_admit",
    instrumentServedOn: "2026-06-01",
    responseDue: "2020-01-01",
    instrumentAndServiceSelected: true,
  });
  assert.equal(admissionLadderState(row, TODAY).state, "clean");
});

test("🕹️ clears -- deemed base, pleading, default-judgment requisition exists", () => {
  const row = baseRow({
    method: "pleading",
    instrumentServedOn: "2026-06-01",
    responseDue: "2020-01-01",
    defaultJudgmentRequisitionExists: true,
  });
  assert.equal(admissionLadderState(row, TODAY).state, "clean");
});

test("today boundary -- due today is still in time (inclusive)", () => {
  const row = baseRow({ instrumentServedOn: "2026-06-01", responseDue: TODAY });
  assert.equal(admissionLadderState(row, TODAY).state, "waiting");
});

test("today boundary -- the day after due is deemed", () => {
  const row = baseRow({ method: "notice_to_admit", instrumentServedOn: "2026-06-01", responseDue: "2026-08-22", instrumentAndServiceSelected: true });
  assert.equal(admissionLadderState(row, TODAY).state, "clean");
});

// The capture markers are gated on the derived state (work-markers.md §5: ⏰/🤝 → capture ∨ 🕹️
// → clean) and pick their pair by method -- notice_to_admit/pleading owe 📑 📌, interrogatories/
// oral owe 💬 🧷. TENDER is the gate-open literal these by-method cases hold constant over.
const TENDER = { state: "tender", base: "admitted" };

test("admissionCaptureMarkers -- 📑 fires when a notice-to-admit response exists with no excerpt captured", () => {
  const row = baseRow({ response: 9, responseExcerpt: null, instrumentPinpoint: "item 1", responsePinpoint: "item 1" });
  assert.equal(admissionCaptureMarkers(row, TENDER), "📑");
});

test("admissionCaptureMarkers -- 📌 fires once even when both pinpoints are missing", () => {
  const row = baseRow({ response: 9, responseExcerpt: "captured", instrumentPinpoint: null, responsePinpoint: null });
  assert.equal(admissionCaptureMarkers(row, TENDER), "📌");
});

test("admissionCaptureMarkers -- both clear when fully captured", () => {
  const row = baseRow({ response: 9, responseExcerpt: "captured", instrumentPinpoint: "item 1", responsePinpoint: "item 1" });
  assert.equal(admissionCaptureMarkers(row, TENDER), "");
});

test("admissionCaptureMarkers -- no response means no excerpt marker and no response-pinpoint check", () => {
  const row = baseRow({ response: null, responseExcerpt: null, instrumentPinpoint: "item 1", responsePinpoint: null });
  assert.equal(admissionCaptureMarkers(row, TENDER), "");
});

test("admissionCaptureMarkers -- an interrogatories row owes the testimony pair 💬 🧷, not the exhibit pair", () => {
  const row = baseRow({ method: "interrogatories", instrumentServedOn: "2026-06-01", response: 9, answer: "agreed", responseExcerpt: null, instrumentPinpoint: null, responsePinpoint: null });
  const state = admissionLadderState(row, TODAY);
  assert.equal(state.state, "tender");
  assert.equal(admissionCaptureMarkers(row, state), "💬 🧷");
});

test("admissionCaptureMarkers -- a denied row owes no capture work, everything missing (the gate)", () => {
  const row = baseRow({ instrumentServedOn: "2026-06-01", response: 9, answer: "denied", responseExcerpt: null, instrumentPinpoint: null, responsePinpoint: null });
  const state = admissionLadderState(row, TODAY);
  assert.equal(state.state, "denied");
  assert.equal(admissionCaptureMarkers(row, state), "");
});

test("admissionCaptureMarkers -- a row still at 🎾 owes no pinpoint yet (the gate)", () => {
  const row = baseRow({ instrumentServedOn: null, response: null, instrumentPinpoint: null });
  const state = admissionLadderState(row, TODAY);
  assert.equal(state.state, "serve");
  assert.equal(admissionCaptureMarkers(row, state), "");
});

test("admissionCaptureMarkers -- a bare ⏰ interrogatories row past the gate owes 🧷 on its instrument", () => {
  const row = baseRow({ method: "interrogatories", instrumentServedOn: "2020-01-01", responseDue: "2020-02-01", instrumentPinpoint: null });
  const state = admissionLadderState(row, TODAY);
  assert.equal(state.state, "deemed");
  assert.equal(admissionCaptureMarkers(row, state), "🧷");
});

// "clean" is the ✅ rung -- 🕹️ cleared, nothing prints. It is still inside the capture
// gate: the tender being in hand is exactly when the uncaptured response passage is owed.
// Drop "clean" from the gate and every ✅ row with a missing excerpt renders falsely clean.
test("admissionCaptureMarkers -- a clean row is still inside the gate and owes 📑 for its uncaptured response", () => {
  const row = baseRow({
    instrumentServedOn: "2026-06-01",
    responseDue: "2026-06-15",
    response: 9,
    responseDate: "2026-06-10",
    answer: "agreed",
    responseFilingSelected: true,
    responseExcerpt: null,
    responsePinpoint: "item 1",
  });
  const state = admissionLadderState(row, TODAY);
  assert.equal(state.state, "clean");
  assert.equal(admissionCaptureMarkers(row, state), "📑");
});

test("admissionCaptureMarkers -- a row still at ⏳ owes no capture work, instrument pinpoint missing (the gate)", () => {
  const row = baseRow({ instrumentServedOn: "2026-08-01", responseDue: "2126-01-01", instrumentPinpoint: null });
  const state = admissionLadderState(row, TODAY);
  assert.equal(state.state, "waiting");
  assert.equal(admissionCaptureMarkers(row, state), "");
});

test("admissionCaptureMarkers -- a struck row never becomes proof and owes no capture work (the gate)", () => {
  const row = baseRow({ instrumentServedOn: "2026-06-01", struckOn: "2026-07-01", responseDue: null, instrumentPinpoint: null });
  const state = admissionLadderState(row, TODAY);
  assert.equal(state.state, "struck");
  assert.equal(admissionCaptureMarkers(row, state), "");
});

test("admissionCaptureMarkers -- a pleading row past the gate owes the exhibit pair 📑 📌 (counsel-drafted answer)", () => {
  const row = baseRow({
    method: "pleading",
    instrumentServedOn: "2026-06-01",
    responseDue: "2026-06-15",
    response: 9,
    responseDate: "2026-06-10",
    answer: "agreed",
    responseExcerpt: null,
    instrumentPinpoint: null,
    responsePinpoint: null,
  });
  const state = admissionLadderState(row, TODAY);
  assert.equal(state.state, "tender");
  assert.equal(admissionCaptureMarkers(row, state), "📑 📌");
});

test("admissionCaptureMarkers -- an oral row past the gate owes the testimony pair 💬 🧷 (the party's own words)", () => {
  const row = baseRow({
    method: "oral",
    instrumentServedOn: null,
    response: 9,
    answer: "agreed",
    responseExcerpt: null,
    instrumentPinpoint: null,
    responsePinpoint: null,
  });
  const state = admissionLadderState(row, TODAY);
  assert.equal(state.state, "tender");
  assert.equal(admissionCaptureMarkers(row, state), "💬 🧷");
});

// --- Per-party guard (issue #345) --------------------------------------

test("admissionRole -- tender and clean are tenders", () => {
  assert.equal(admissionRole({ state: "tender" }), "tenders");
  assert.equal(admissionRole({ state: "clean" }), "tenders");
});

test("admissionRole -- serve, waiting, deemed, and the unreachable bare admitted are outstanding", () => {
  assert.equal(admissionRole({ state: "serve" }), "outstanding");
  assert.equal(admissionRole({ state: "waiting" }), "outstanding");
  assert.equal(admissionRole({ state: "deemed" }), "outstanding");
  assert.equal(admissionRole({ state: "admitted" }), "outstanding");
});

test("admissionRole -- an interrogatories row past its response period with no defined route is outstanding, not a tender (ADR-0006 refuses to invent the outcome)", () => {
  const row = baseRow({ method: "interrogatories", instrumentServedOn: "2020-01-01", responseDue: "2020-02-01" });
  const result = admissionLadderState(row, TODAY);
  assert.equal(result.state, "deemed");
  assert.equal(admissionRole(result), "outstanding");
});

test("admissionRole -- denied, refused, no_knowledge, struck, and not_sought are spent", () => {
  assert.equal(admissionRole({ state: "denied" }), "spent");
  assert.equal(admissionRole({ state: "refused" }), "spent");
  assert.equal(admissionRole({ state: "no_knowledge" }), "spent");
  assert.equal(admissionRole({ state: "struck" }), "spent");
  assert.equal(admissionRole({ state: "not_sought" }), "spent");
});

test("admittedAgainstAllOpposing -- no opposing parties is defensive-false", () => {
  assert.equal(admittedAgainstAllOpposing(new Set([2]), []), false);
});

test("admittedAgainstAllOpposing -- one opposing party, covered", () => {
  assert.equal(admittedAgainstAllOpposing(new Set([2]), [2]), true);
});

test("admittedAgainstAllOpposing -- one opposing party, not covered", () => {
  assert.equal(admittedAgainstAllOpposing(new Set(), [2]), false);
});

test("admittedAgainstAllOpposing -- two opposing parties, only one covered (ADR-0006's 'admitted by A, denied by B' example) -- still needs proof", () => {
  assert.equal(admittedAgainstAllOpposing(new Set([2]), [2, 3]), false);
});

test("admittedAgainstAllOpposing -- two opposing parties, both covered", () => {
  assert.equal(admittedAgainstAllOpposing(new Set([2, 3]), [2, 3]), true);
});

test("isAdmittedGuard -- a court-record link silences regardless of admission coverage (untouched by issue #345)", () => {
  assert.equal(isAdmittedGuard(true, false), true);
});

test("isAdmittedGuard -- no court-record link silences only when covered (issue #360/#362)", () => {
  assert.equal(isAdmittedGuard(false, false), false);
  assert.equal(isAdmittedGuard(false, true), true);
});

test("noWitnessMarker -- an uncovered, unlinked fact with no statement of fact fires 👤", () => {
  assert.equal(noWitnessMarker(false, false, false, ""), "👤");
});

test("noWitnessMarker -- a covered, unlinked fact stays silent regardless of witness backing", () => {
  assert.equal(noWitnessMarker(false, false, true, ""), "");
});

test("noWitnessMarker -- a court-record link stays silent even with no witness", () => {
  assert.equal(noWitnessMarker(true, false, false, ""), "");
});

// Issue #361: a spent admission's rung prefixes 👤 the same way renderEvidenceIndex
// prefixes it onto the unsponsored-exhibit marker.
test("noWitnessMarker -- a spent admission's rung prefixes 👤", () => {
  assert.equal(noWitnessMarker(false, false, false, "🙅🏻‍♂️"), "🙅🏻‍♂️ 👤");
});

test("noWitnessMarker -- witness backing drops the prefix along with 👤", () => {
  assert.equal(noWitnessMarker(false, true, false, "🙅🏻‍♂️"), "");
});

test("noWitnessMarker -- coverage drops the prefix along with 👤", () => {
  assert.equal(noWitnessMarker(false, false, true, "🙅🏻‍♂️"), "");
});

// Issue #360/#362: the fact's own line owes its court-record link's pinpoint,
// independent of the unless-admitted guard.
test("courtRecordPinpointMarker -- link set, pinpoint null fires 📌", () => {
  assert.equal(courtRecordPinpointMarker(1, null, null, null), "📌");
});

test("courtRecordPinpointMarker -- link set, pinpoint empty string fires 📌", () => {
  assert.equal(courtRecordPinpointMarker(1, "", null, null), "📌");
});

test("courtRecordPinpointMarker -- link set, pinpoint captured stays silent", () => {
  assert.equal(courtRecordPinpointMarker(1, "para 4", null, null), "");
});

test("courtRecordPinpointMarker -- no link stays silent regardless of pinpoint", () => {
  assert.equal(courtRecordPinpointMarker(null, null, null, null), "");
  assert.equal(courtRecordPinpointMarker(null, "Exhibit K", "2026-08-12", "A-J"), "");
});

// E2E 2026-10-05 finding 4.3: a sworn court record re-checks the exhibit letters its pinpoint cites.
test("courtRecordPinpointMarker -- a sworn record holding every cited letter stays silent", () => {
  assert.equal(courtRecordPinpointMarker(1, "Exhibits B-D", "2026-08-12", "A-J"), "");
  assert.equal(courtRecordPinpointMarker(1, "Affidavit #2, Exhibits C, L", "2026-08-12", "A-J, L"), "");
});

test("courtRecordPinpointMarker -- a sworn record lacking a cited letter fires 📌", () => {
  assert.equal(courtRecordPinpointMarker(1, "Exhibits K-M", "2026-08-12", "A-J"), "📌");
  assert.equal(courtRecordPinpointMarker(1, "Exhibit K", "2026-08-12", "A-J, L"), "📌");
});

test("courtRecordPinpointMarker -- a sworn record with unknown or unparseable letters fires 📌 on a cited letter", () => {
  assert.equal(courtRecordPinpointMarker(1, "Exhibit A", "2026-08-12", null), "📌");
  assert.equal(courtRecordPinpointMarker(1, "Exhibit A", "2026-08-12", "A to J"), "📌");
  assert.equal(courtRecordPinpointMarker(1, "Exhibit A", "2026-08-12", "J-A"), "📌");
});

test("courtRecordPinpointMarker -- an unsworn record, or a pinpoint citing no letter, stays silent", () => {
  assert.equal(courtRecordPinpointMarker(1, "Exhibits K-M", null, "A-J"), "");
  assert.equal(courtRecordPinpointMarker(1, "Exhibits M-K", null, "A-J"), "");
  assert.equal(courtRecordPinpointMarker(1, "para 4", "2026-08-12", null), "");
  assert.equal(courtRecordPinpointMarker(1, "Exhibit 4", "2026-08-12", "A-J"), "");
});

test("courtRecordPinpointMarker -- the printed forms Exhibit \"X\" and Ex. X are re-checked too", () => {
  assert.equal(courtRecordPinpointMarker(1, 'Exhibit "K"', "2026-08-12", "A-J"), "📌");
  assert.equal(courtRecordPinpointMarker(1, "Ex. K", "2026-08-12", "A-J"), "📌");
  assert.equal(courtRecordPinpointMarker(1, "Ex. B, p. 3", "2026-08-12", "A-J"), "");
});

test("courtRecordPinpointMarker -- a sworn record with a malformed Exhibits list fires 📌, whatever its letters", () => {
  assert.equal(courtRecordPinpointMarker(1, "Exhibits M-K", "2026-08-12", "A-Z"), "📌");
});

test("citedExhibitLetters -- reads Exhibit X, Exhibits X-Y and Exhibits X, Y, items may be ranges", () => {
  assert.deepEqual(citedExhibitLetters("Exhibit K"), ["K"]);
  assert.deepEqual(citedExhibitLetters("Affidavit #2 of S. Ashby, Exhibits K-M"), ["K", "L", "M"]);
  assert.deepEqual(citedExhibitLetters("Exhibits A, C-D, AA"), ["A", "C", "D", "AA"]);
  assert.deepEqual(citedExhibitLetters("Exhibits Y-AB"), ["Y", "Z", "AA", "AB"]);
  assert.deepEqual(citedExhibitLetters("Exhibit A, para 3; Exhibit B"), ["A", "B"]);
});

test("citedExhibitLetters -- reads the printed forms Exhibit \"X\" (straight or curly quotes) and Ex. X", () => {
  assert.deepEqual(citedExhibitLetters('Exhibit "A"'), ["A"]);
  assert.deepEqual(citedExhibitLetters("Exhibit “AB”, p. 2"), ["AB"]);
  assert.deepEqual(citedExhibitLetters("Ex. A, s. 2.3"), ["A"]);
  assert.deepEqual(citedExhibitLetters('Ex. "C"; Exhibits D-E'), ["C", "D", "E"]);
  // Deliberately lenient: an unmatched or mixed quote still reads its letter.
  assert.deepEqual(citedExhibitLetters('Exhibit "A'), ["A"]);
  assert.deepEqual(citedExhibitLetters('Exhibit "A”'), ["A"]);
});

test("citedExhibitLetters -- a recognised but malformed Exhibits list reads as null", () => {
  assert.equal(citedExhibitLetters("Exhibits M-K"), null);
  assert.equal(citedExhibitLetters("Exhibit A; Exhibits M-K"), null);
});

test("citedExhibitLetters -- any other wording cites no letters", () => {
  for (const pinpoint of ["para 4", "exhibit A", "Ex A", "Exhibit ABC", "Exhibit Al", 'Exhibit "ABC"', "Exhibit 4", "Index. A", "Annex. A", "Ex. ABC", "Exhibition A"]) {
    assert.deepEqual(citedExhibitLetters(pinpoint), [], pinpoint);
  }
});

test("swornExhibitLetters -- parses letters and ranges, ordered A..Z then AA..ZZ", () => {
  assert.deepEqual([...swornExhibitLetters("A-J")], ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"]);
  assert.deepEqual([...swornExhibitLetters("A-C, L")], ["A", "B", "C", "L"]);
  assert.deepEqual([...swornExhibitLetters("Z-AB")], ["Z", "AA", "AB"]);
  assert.equal(swornExhibitLetters("A-ZZ").size, 702);
});

test("swornExhibitLetters -- NULL or unparseable reads as null", () => {
  for (const letters of [null, "", "A to J", "J-A", "A-", "A,,B", "a-j", "AAA"]) {
    assert.equal(swornExhibitLetters(letters), null, String(letters));
  }
});

// Issue #440: courtRecordPinpointMarker only ever signalled the pinpoint was
// missing -- once captured, nothing carried the locator text itself onto the
// fact's line. courtRecordCitation is the sibling that does.
test("courtRecordCitation -- link set, pinpoint captured renders the citation text", () => {
  assert.equal(courtRecordCitation(1, "para 4"), "(para 4)");
});

test("courtRecordCitation -- link set, pinpoint null stays silent", () => {
  assert.equal(courtRecordCitation(1, null), "");
});

test("courtRecordCitation -- link set, pinpoint empty string stays silent", () => {
  assert.equal(courtRecordCitation(1, ""), "");
});

test("courtRecordCitation -- no link stays silent regardless of pinpoint", () => {
  assert.equal(courtRecordCitation(null, "para 4"), "");
});
