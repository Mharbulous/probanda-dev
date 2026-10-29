// The Arguments page's Killed section (forms/arguments-page.ts; spec 2026-10-09_retire-counsel-brief-spec.md):
// a submission the practitioner killed (submissions.killed_on) is listed as kind "killed", in kill-date
// order after the live ones, its where line naming the kill date, and never under a counter-argument.

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { freshSubmissionDb } = await import("./helpers/template-db.mjs");
const { submissionDataExecute } = await import("../build/submission/backend.js");
const { buildArgumentsData } = await import("../build/submission/forms/arguments-page.js");

test("killed submissions show in kill-date order with their kill date and link to no counter-argument", async (t) => {
  const base = mkdtempSync(join(tmpdir(), "coclerk-arguments-killed-"));
  t.after(() => rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
  const dbPath = join(base, "submission.sqlite");
  await freshSubmissionDb(dbPath);
  await submissionDataExecute(
    dbPath,
    `INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L9999 - Test', 'CAN/BC/Vancouver-International-Arbitration-Centre');
     INSERT INTO filings (id, proceeding_id, kind, round, title) VALUES (1, 1, 'submissions_package', 'opening', 'Opening');
     INSERT INTO submissions (id, proceeding_id, contention, ordinal, killed_on) VALUES
       (1, 1, 'A live contention.', 1, NULL),
       (2, 1, 'Killed later.', 2, '2026-10-05'),
       (3, 1, 'Killed first.', 3, '2026-10-01');
     INSERT INTO anticipated_points (id, proceeding_id, point) VALUES (1, 1, 'An anticipated point.');
     INSERT INTO submission_rebuts_anticipated_points (submission_id, anticipated_point_id) VALUES (1, 1), (2, 1);`
  );
  const data = buildArgumentsData(dbPath, { id: 1, proceeding_id: 1 });
  assert.deepEqual(
    data.submissions.map((s) => [s.id, s.kind, s.where]),
    [
      [1, "rebuttal", "Held in reserve"],
      [3, "killed", "Killed 2026-10-01"],
      [2, "killed", "Killed 2026-10-05"],
    ]
  );
  assert.deepEqual(data.counter_arguments[0].linked, [1]);
});
