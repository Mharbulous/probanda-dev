// The Arguments page's data (forms/arguments-page.ts, schema v82): a row with no argument_rebuts link
// out is an argument under its number, a row with one is a rebuttal labelled under its lowest-numbered
// target, a killed row stays on its tab last in kill-date order, and a live opposing argument no live
// rebuttal answers carries "No rebuttal".

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { freshSubmissionDb } = await import("./helpers/template-db.mjs");
const { submissionDataExecute } = await import("../build/submission/backend.js");
const { buildArgumentsData } = await import("../build/submission/forms/arguments-page.js");

test("arguments by number, rebuttals by label, killed rows last on their tab", async (t) => {
  const base = mkdtempSync(join(tmpdir(), "coclerk-arguments-killed-"));
  t.after(() => rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
  const dbPath = join(base, "submission.sqlite");
  await freshSubmissionDb(dbPath);
  await submissionDataExecute(
    dbPath,
    `INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L9999 - Test', 'CAN/BC/Vancouver-International-Arbitration-Centre');
     INSERT INTO filings (id, proceeding_id, kind, round, title) VALUES (1, 1, 'submissions_package', 'opening', 'Opening');
     INSERT INTO arguments (id, proceeding_id, contention, ordinal, killed_on, side, number, anticipated, component, pinpoint) VALUES
       (1, 1, 'A live contention.', 1, NULL, 'ours', NULL, 0, NULL, NULL),
       (2, 1, 'Killed later.', 2, '2026-10-05', 'ours', NULL, 0, NULL, NULL),
       (3, 1, 'Killed first.', 3, '2026-10-01', 'ours', 3, 0, NULL, NULL),
       (4, 1, 'They will say the goods were never ordered.', 4, NULL, 'opposing', 1, 1, NULL, NULL),
       (5, 1, 'Their raised point.', 5, NULL, 'opposing', 2, 0, 'Response', 'para 2'),
       (6, 1, 'Our answer to their answer.', 6, NULL, 'ours', NULL, 0, NULL, NULL);
     INSERT INTO argument_rebuts (rebuttal_id, argument_id) VALUES (1, 4), (2, 4), (1, 5), (6, 1);`
  );
  const data = buildArgumentsData(dbPath, { id: 1, proceeding_id: 1 });
  assert.deepEqual(
    data.arguments.map((a) => [a.id, a.label, a.side, a.where, a.tags]),
    [
      [4, "#1", "opposing", null, ["Anticipated"]],
      [5, "#2", "opposing", "Response, para 2", []],
      [3, "#3", "ours", null, ["Killed 2026-10-01"]],
    ]
  );
  assert.deepEqual(
    data.rebuttals.map((r) => [r.id, r.label, r.number, r.tags, r.rebuts, r.rebutted_by]),
    [
      [1, "#1.a", 1, ["Held in reserve"], ["#1", "#2"], ["#1.a.i"]],
      [6, "#1.a.i", 1, ["Held in reserve"], ["#1.a"], []],
      [2, "#1.b", 1, ["Killed 2026-10-05"], ["#1"], []],
    ]
  );
  assert.deepEqual(data.arguments.find((a) => a.id === 4).rebutted_by, ["#1.a", "#1.b"]);
  assert.deepEqual(data.arguments.find((a) => a.id === 5).rebutted_by, ["see #1.a"]);

  // Killing the only live rebuttal leaves both opposing arguments with no rebuttal.
  await submissionDataExecute(dbPath, "UPDATE arguments SET killed_on = '2026-10-09' WHERE id = 1");
  const after = buildArgumentsData(dbPath, { id: 1, proceeding_id: 1 });
  assert.deepEqual(
    after.arguments.filter((a) => a.tags.includes("No rebuttal")).map((a) => a.label),
    ["#1", "#2"]
  );
});
