// The Work Board (practice-board-shell.ts, map #125): a data golden for buildPracticeBoardData with
// the clock injected, and a sha256 pin of the page it renders, taken before the move to templates.
// The pin is checked by hash only; no test reads the page.

import assert from "node:assert/strict";
import test from "node:test";

import { memoryKv, startFakeCloud } from "./helpers/fake-cloud.mjs";
import { assertSha256Pin } from "./helpers/sha256-pin.mjs";

const { PracticeStore } = await import("../build/practice/store.js");
const writes = await import("../build/tools/practice/writes.js");
const { buildPracticeBoardData } = await import("../build/tools/practice/practice-board.js");
const { renderPracticeBoardHtml } = await import("../build/submission/forms/practice-board-shell.js");

/** 2026-10-15 09:30 local time, so today and the horizon do not depend on the machine's zone. */
const NOW = new Date(2026, 9, 15, 9, 30);

async function fixtureStore(t) {
  const cloud = await startFakeCloud(t);
  const store = new PracticeStore({ ...cloud.env }, memoryKv());
  const { matter_id } = await writes.upsert_client_matter(store, { client_num: "C-1", name: "Acme Co", matt_num: "L200", file_number: "F-200", description: "Contract dispute", status: "active" });
  await writes.upsert_client_matter(store, { client_num: "C-2", name: "Beta Ltd", matt_num: "L201", file_number: "F-201", description: "Advice", billable: false });
  await writes.upsert_client_matter(store, { client_num: "C-3", name: "Test Client", matt_num: "L202", file_number: "F-202", status: "test" });
  const task = (matt_num, description, extra) => writes.upsert_task(store, { matt_num, task_type: "client", description, ...extra });
  await task("L200", "Serve the <reply> on Beta", { deadline_date: "2026-10-10" });
  await task("L200", "Call the client", { deadline_date: "2026-10-15" });
  await task("L200", "Settle the list of documents", { deadline_date: "2026-10-29" });
  await task("L200", "Book the trial room", { deadline_date: "2026-12-01" });
  await task("L201", "Send the opinion letter", { next_nudge_date: "2026-10-22" });
  await task("L202", "A test matter's to-do", { deadline_date: "2026-10-16" });
  const anchor = { matt_num: "L200", anchor_type: "trial_date", party_label: "Plaintiff Acme" };
  await writes.upsert_anchor(store, { ...anchor, anchor_date: "2026-10-20", source_document: "Notice of Trial", stated_date: "2026-10-20" });
  await writes.upsert_anchor(store, { ...anchor, anchor_date: "2026-10-27", source_document: "TMC Order", stated_date: "2026-10-27" });
  await writes.upsert_deadline(store, { matter_id, deadline_type: "trial_brief", deadline_date: "2026-10-14", rule_ref: "R. 12-1", rule_description: "Trial brief due", source_type: "bc_rules", review_flag: "check_order" });
  return store;
}

const acme = { matter: "L200 — Contract dispute", client: "Acme Co", matter_status: "active", billable: true };
const card = (kind, label, date, extra = {}) => ({ kind, label, date, flag: null, bf_date: null, ...acme, ...extra });

const GOLDEN = {
  meta: { rendered: "2026-10-15 09:30", today: "2026-10-15", horizon_days: 14 },
  panels: {
    overdue: [card("todo", "Serve the <reply> on Beta", "2026-10-10"), card("deadline", "Trial brief", "2026-10-14", { flag: "Check order" })],
    due_today: [card("todo", "Call the client", "2026-10-15")],
    coming_up: [card("event", "Trial date — Plaintiff Acme", "2026-10-20", { flag: "Conflicted" }), card("todo", "Settle the list of documents", "2026-10-29")],
    other: [
      card("todo", "Book the trial room", "2026-12-01"),
      card("todo", "Send the opinion letter", null, { bf_date: "2026-10-22", matter: "L201 — Advice", client: "Beta Ltd", matter_status: null, billable: false }),
    ],
  },
  notes: [],
  conflicted: 1,
  excluded_test_matters: 1,
};

/** sha256 of renderPracticeBoardHtml(GOLDEN), taken from the inline-string shell before the move to templates. */
const PAGE_PIN = "0beed7e66657e623627d4f010458e7fde25166f891f29aa941d9a3c243688a71";

test("buildPracticeBoardData places each item by its stored date against the injected today", async (t) => {
  assert.deepEqual(await buildPracticeBoardData(await fixtureStore(t), NOW), GOLDEN);
});

test("the Work Board page is byte-identical to the pinned render", () => {
  assertSha256Pin(renderPracticeBoardHtml(GOLDEN), PAGE_PIN, "Work Board");
});
