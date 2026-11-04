// A job touched just now is not shown as lapsed, even when the server's own clock and the clock
// that writes the job's stamps read the zone differently.

import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { freshSubmissionDb } = await import("./helpers/template-db.mjs");
const { submissionDataExecute } = await import("../build/submission/backend.js");
const { submissionDataTouchJob } = await import("../build/submission/forms/job-activity.js");
const { buildProceedingBoard } = await import("../build/submission/forms/build-proceeding-board.js");

const SEED = `INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'X0001 - Example', NULL);
  INSERT INTO tickets (id, proceeding_id, filing_id, title, intent, status, priority, kind, billing_anchor, locked_by, locked_at, plan_approved_at, created)
    VALUES (1, 1, NULL, 'Example job', 'Example intent', 'wip', 0, 'work', 'X0001|example', 'sess-a', '2026-01-02 09:00', '2026-01-02 09:00', '2026-01-02 08:55');`;

test("a job touched now is not lapsed when the stamp writer's zone differs from the server's", async (t) => {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), "job-clock-")));
  const tz = process.env.TZ;
  process.env.TZ = "Etc/GMT+7";
  t.after(() => {
    if (tz === undefined) delete process.env.TZ;
    else process.env.TZ = tz;
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });
  const dbPath = join(dir, "drafting.sqlite");
  await freshSubmissionDb(dbPath);
  await submissionDataExecute(dbPath, SEED);
  await submissionDataTouchJob({ db_path: dbPath, ticket_id: 1, session_token: "sess-a" }, { ...process.env, TZ: "XXX8" });
  const job = buildProceedingBoard(dbPath, 1).tickets.find((x) => x.ticket.id === 1);
  assert.equal(job.ticket.status, "wip");
});
