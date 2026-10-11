// Pure unit tests for filing lifecycle derivation -- deriveLifecycle in
// forms/lifecycle.ts. No database: the filing is a plain object carrying the
// four stored lifecycle dates, exactly the shape FilingRow gives the callers.
// Focused on the "entered" state added in schema v19 and on the ordering rule
// that keeps appeal_expired ahead of it.

import assert from "node:assert/strict";
import test from "node:test";

const { deriveLifecycle, LIFECYCLE_LABELS } = await import("../build/submission/forms/lifecycle.js");

/** A filing with every lifecycle date unset -- override per test. */
function filing(overrides = {}) {
  return { filed_on: null, decided_on: null, entered_on: null, retired_on: null, ...overrides };
}

const TODAY = "2026-09-10";

test("entered_on alone -- entered, dated by the entry, never ready to retire", () => {
  const result = deriveLifecycle(filing({ entered_on: "2026-09-09" }), null, TODAY);
  assert.deepEqual(result, { state: "entered", since: "2026-09-09", readyToRetire: false, offerDelivered: false });
});

test("entered_on with decided_on -- entered wins, it is the later act", () => {
  const result = deriveLifecycle(
    filing({ decided_on: "2026-09-02", entered_on: "2026-09-09" }),
    null,
    TODAY
  );
  assert.deepEqual(result, { state: "entered", since: "2026-09-09", readyToRetire: false, offerDelivered: false });
});

test("expired appeal deadline outranks entered_on -- appeal time runs from pronouncement", () => {
  const result = deriveLifecycle(
    filing({ filed_on: "2026-08-14", decided_on: "2026-09-02", entered_on: "2026-09-09" }),
    null,
    TODAY,
    "2026-09-08"
  );
  assert.deepEqual(result, { state: "appeal_expired", since: "2026-09-08", readyToRetire: true, offerDelivered: false });
});

test("retired_on outranks everything, entered_on included", () => {
  const result = deriveLifecycle(
    filing({
      filed_on: "2026-08-14",
      decided_on: "2026-09-02",
      entered_on: "2026-09-09",
      retired_on: "2026-09-10",
    }),
    "2026-08-30",
    TODAY,
    "2026-09-08"
  );
  assert.deepEqual(result, { state: "retired", since: "2026-09-10", readyToRetire: false, offerDelivered: false });
});

test("entered carries its own label", () => {
  assert.equal(LIFECYCLE_LABELS.entered, "Entered");
});

// A Writing that needs no forum parts (needs_forum_parts 0, schema v30): drafting -> sent -> retired.

test("needs_forum_parts 0, nothing set -- drafting", () => {
  const result = deriveLifecycle(filing({ needs_forum_parts: 0 }), null, TODAY);
  assert.deepEqual(result, { state: "drafting", since: null, readyToRetire: false, offerDelivered: false });
});

test("needs_forum_parts 0, filed_on -- sent, dated by the send, offering the delivered retirement", () => {
  const result = deriveLifecycle(filing({ needs_forum_parts: 0, filed_on: "2026-09-08" }), null, TODAY);
  assert.deepEqual(result, { state: "sent", since: "2026-09-08", readyToRetire: false, offerDelivered: true });
});

test("needs_forum_parts 0 reads only filed_on and retired_on -- a hearing, decision, entry and expired appeal deadline change nothing", () => {
  const result = deriveLifecycle(
    filing({ needs_forum_parts: 0, filed_on: "2026-08-14", decided_on: "2026-09-02", entered_on: "2026-09-09" }),
    "2026-08-30",
    TODAY,
    "2026-09-08"
  );
  assert.deepEqual(result, { state: "sent", since: "2026-08-14", readyToRetire: false, offerDelivered: true });
});

test("needs_forum_parts 0, retired_on -- retired, no offer", () => {
  const result = deriveLifecycle(filing({ needs_forum_parts: 0, filed_on: "2026-09-08", retired_on: "2026-09-09" }), null, TODAY);
  assert.deepEqual(result, { state: "retired", since: "2026-09-09", readyToRetire: false, offerDelivered: false });
});

test("needs_forum_parts 1, filed_on -- filed, no offer: a venue-kind letter is a filing", () => {
  const result = deriveLifecycle(filing({ needs_forum_parts: 1, filed_on: "2026-09-08" }), null, TODAY);
  assert.deepEqual(result, { state: "filed", since: "2026-09-08", readyToRetire: false, offerDelivered: false });
});

test("sent carries its own label", () => {
  assert.equal(LIFECYCLE_LABELS.sent, "Sent");
});
