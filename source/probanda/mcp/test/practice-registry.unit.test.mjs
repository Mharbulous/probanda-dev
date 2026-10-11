import assert from "node:assert/strict";
import test from "node:test";

const practice = await import("../build/practice-registry.js");

const TABLES = [
  "practice_clients",
  "practice_matters",
  "practice_time_entries",
  "practice_invoices",
  "practice_tasks",
  "practice_retainer_notices",
  "practice_anchors",
  "practice_anchor_sources",
  "practice_deadlines",
  "practice_payment_in_flight",
  "practice_matter_signals",
  "practice_status_policies",
  "practice_court_calendar_coverage",
  "practice_court_calendar_days",
  "practice_rule_overlay",
];

test("PRACTICE_ENTITIES has exactly the 15 expected tables", () => {
  const tables = practice.PRACTICE_ENTITIES.map((entity) => entity.table);
  assert.deepEqual([...tables].sort(), [...TABLES].sort());
  assert.equal(practice.PRACTICE_ENTITIES.length, 15);
});

test("every practice entity is single-pk id, pkGenerated, owner-scoped, no operations", () => {
  for (const entity of practice.PRACTICE_ENTITIES) {
    assert.equal(entity.pk, "id", `${entity.table} pk`);
    assert.equal(entity.pkGenerated, true, `${entity.table} pkGenerated`);
    assert.equal(entity.matterScoped, false, `${entity.table} matterScoped`);
    assert.equal(entity.operations, undefined, `${entity.table} operations`);
  }
});
