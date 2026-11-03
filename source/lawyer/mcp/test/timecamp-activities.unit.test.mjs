// The timecamp server's `activities` filters and out_file, against a stubbed TimeCamp answer.
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

import { dispatchTimecampTool } from "../build/timecamp/tools.js";

const row = (entry_id, user_id, end, time_span) => ({
  entry_id, user_id, task_id: "7", time_span, end_time: `2026-09-01 ${end}`, end_date: "2026-09-01", application: "App", window_title: "Title",
});
const ROWS = [
  row("11", "1", "09:10:00", 300),
  row("11", "1", "09:20:00", 100),
  row("22", "1", "10:05:00", 600), // runs 09:55 to 10:05, across a 10:00 edge
  row("0", "2", "10:30:00", 60),
];

const DIR = await mkdtemp(join(tmpdir(), "probanda-timecamp-activities-"));
after(() => rm(DIR, { recursive: true, force: true }));

globalThis.fetch = async () => new Response(JSON.stringify(ROWS), { status: 200 });

async function call(args) {
  const result = await dispatchTimecampTool({ token: "fake" }, "activities", { dates: ["2026-09-01"], ...args });
  return { isError: result.isError, body: JSON.parse(result.content[0].text) };
}

test("an unfiltered call returns every row unchanged, with totals in exact seconds", async () => {
  const { body } = await call({});
  assert.deepEqual(body.rows, ROWS);
  assert.equal(body.count, 4);
  assert.deepEqual(body.totals, {
    seconds: 1060,
    by_entry: [{ entry_id: "11", seconds: 400 }, { entry_id: "22", seconds: 600 }, { entry_id: "0", seconds: 60 }],
  });
});

test("entry_ids returns only rows carrying those ids, and \"0\" selects rows with no entry", async () => {
  assert.deepEqual((await call({ entry_ids: ["22"] })).body.rows, [ROWS[2]]);
  assert.deepEqual((await call({ entry_ids: ["0"] })).body.rows, [ROWS[3]]);
});

test("user_ids with a time window keeps a row that crosses the window's edge", async () => {
  const morning = await call({ user_ids: ["1"], to_time: "10:00" });
  assert.deepEqual(morning.body.rows, ROWS.slice(0, 3));
  const later = await call({ user_ids: ["1"], from_time: "10:00" });
  assert.deepEqual(later.body.rows, [ROWS[2]]);
  const outside = await call({ from_time: "11:00" });
  assert.equal(outside.body.count, 0);
});

test("out_file holds the filtered rows, the response holds none, and an existing file is refused", async () => {
  const out_file = join(DIR, "rows.json");
  const { body } = await call({ entry_ids: ["11"], out_file });
  assert.equal(body.rows, undefined);
  assert.equal(body.count, 2);
  assert.equal(body.totals.seconds, 400);
  assert.deepEqual(JSON.parse(await readFile(out_file, "utf8")), ROWS.slice(0, 2));
  const again = await call({ out_file });
  assert.equal(again.isError, true);
  assert.match(again.body.error.message, /already exists/);
});

test("a malformed or reversed time is refused", async () => {
  assert.equal((await call({ from_time: "9am" })).isError, true);
  assert.equal((await call({ from_time: "11:00", to_time: "10:00" })).isError, true);
});
