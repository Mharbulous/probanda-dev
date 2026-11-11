// Issue 284's first Done-when check: two bills that share dates, run interleaved against one
// time_pipeline.db, with a clock the test moves. No bill-record row is lost (a stale save is
// refused, then retried on the fresh value), no date is judged twice (the second claim is
// refused, and a judge by the run that lost the date gets claim_lost), and an abandoned claim is
// taken after 60 minutes. Named .db., not .unit.: the store runs on host Python.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { timePipelineGet, timePipelineList, timePipelineSet } = await import("../build/time-pipeline/backend.js");
const { reviewDateClaim, reviewDateJudge, reviewDateRenew, reviewDateStatus } = await import("../build/time-pipeline/review-date.js");

const MINUTE = 60 * 1000;

function fixture(t) {
  const scratch = mkdtempSync(join(tmpdir(), "coclerk-timekeeping-"));
  t.after(() => rmSync(scratch, { recursive: true, force: true }));
  const appData = join(scratch, "appdata");
  mkdirSync(join(appData, "Coclerk"), { recursive: true });
  const root = join(scratch, "0. CASE DATA");
  mkdirSync(root, { recursive: true });
  writeFileSync(join(appData, "Coclerk", "coclerk.json"), JSON.stringify({ case_data_root: root }));
  let now = Date.parse("2026-11-10T09:00:00.000Z");
  return {
    env: { APPDATA: appData, LOCALAPPDATA: process.env.LOCALAPPDATA, COCLERK_PYTHON: process.env.COCLERK_PYTHON },
    now: () => new Date(now),
    advance: (minutes) => { now += minutes * MINUTE; },
  };
}

/** /bill-client's four-step save: read with list keeping sha256, save naming it, on stale_write
 * read again and make the same change once more. Returns how many saves were refused. */
function addRow(namespace, key, row, env) {
  const [read] = timePipelineList(namespace, key, env).items.filter((item) => item.key === key);
  const rows = read ? JSON.parse(read.value) : [];
  try {
    timePipelineSet(namespace, key, JSON.stringify([...rows, row]), read ? { expect_sha256: read.sha256 } : { expect_absent: true }, env);
    return 0;
  } catch (err) {
    if (err.code !== "stale_write") throw err;
  }
  const fresh = timePipelineGet(namespace, key, env);
  const freshRows = fresh.value === null ? [] : JSON.parse(fresh.value);
  timePipelineSet(
    namespace, key, JSON.stringify([...freshRows, row]),
    fresh.sha256 === null ? { expect_absent: true } : { expect_sha256: fresh.sha256 }, env,
  );
  return 1;
}

test("two bills sharing dates, interleaved: no bill-record row lost, no date judged twice, an abandoned claim taken after 60 minutes", (t) => {
  const f = fixture(t);
  const seams = { env: f.env, now: f.now };
  const A = "L145:20261110-090000";
  const B = "L166:20261110-090500";
  const shared = ["2026-10-01", "2026-10-02"];
  const key = "L145:candidate-dates";

  // Both bills read the same bill record before either saves (the race that lost rows before).
  const readByA = timePipelineList("bill", key, f.env).items;
  const readByB = timePipelineList("bill", key, f.env).items;
  assert.deepEqual(readByA, []);
  assert.deepEqual(readByB, []);
  timePipelineSet("bill", key, JSON.stringify(["row-from-A"]), { expect_absent: true }, f.env);
  // B's blind save, naming the empty read, is refused and writes nothing ...
  assert.throws(
    () => timePipelineSet("bill", key, JSON.stringify(["row-from-B"]), { expect_absent: true }, f.env),
    (err) => err.code === "stale_write",
  );
  assert.deepEqual(JSON.parse(timePipelineGet("bill", key, f.env).value), ["row-from-A"]);
  // ... and the procedure's retry on the fresh value keeps both rows.
  const sha = timePipelineGet("bill", key, f.env).sha256;
  timePipelineSet("bill", key, JSON.stringify(["row-from-A", "row-from-B"]), { expect_sha256: sha }, f.env);
  // Two more rows saved through the four-step procedure, A's read going stale under B's save.
  const [aRead] = timePipelineList("bill", key, f.env).items;
  assert.equal(addRow("bill", key, "row-2-from-B", f.env), 0);
  assert.throws(
    () => timePipelineSet("bill", key, JSON.stringify([...JSON.parse(aRead.value), "row-2-from-A"]), { expect_sha256: aRead.sha256 }, f.env),
    (err) => err.code === "stale_write",
  );
  assert.equal(addRow("bill", key, "row-2-from-A", f.env), 0);
  assert.deepEqual(JSON.parse(timePipelineGet("bill", key, f.env).value), ["row-from-A", "row-from-B", "row-2-from-B", "row-2-from-A"]);

  // Each bill claims the shared dates in the list's order: A takes the first, B the second.
  const a1 = reviewDateClaim(shared[0], A, seams);
  assert.equal(a1.status, "claimed");
  assert.deepEqual(reviewDateClaim(shared[0], B, seams), { status: "held", date: shared[0], holder: A, expires_at: a1.expires_at });
  f.advance(5);
  const b2 = reviewDateClaim(shared[1], B, seams);
  assert.equal(b2.status, "claimed");
  assert.equal(reviewDateClaim(shared[1], A, seams).status, "held");

  // A works its date, renewing at the fixed points, and judges it.
  f.advance(20);
  assert.equal(reviewDateRenew(shared[0], a1.token, seams).status, "renewed");
  f.advance(30);
  assert.equal(reviewDateJudge(shared[0], a1.token, seams).status, "judged");

  // B's second pass over its held date finds it judged: it is never reviewed twice.
  assert.deepEqual(reviewDateClaim(shared[0], B, seams), {
    status: "judged", date: shared[0], judged_at: f.now().toISOString(), judged_by: A,
  });

  // B abandons the second date (a crash: its token is gone). At 59 minutes it is still held ...
  f.advance(9); // 59 minutes after B's claim
  assert.equal(reviewDateClaim(shared[1], A, seams).status, "held");
  // ... and after 60 minutes A's second pass takes it.
  f.advance(1);
  const a2 = reviewDateClaim(shared[1], A, seams);
  assert.equal(a2.status, "claimed");

  // B comes back with its old token: renew and judge both get claim_lost, and change nothing.
  assert.deepEqual(reviewDateRenew(shared[1], b2.token, seams), { status: "claim_lost", date: shared[1] });
  assert.deepEqual(reviewDateJudge(shared[1], b2.token, seams), { status: "claim_lost", date: shared[1] });
  assert.equal(reviewDateStatus([shared[1]], seams).dates[0].holder, A);
  assert.equal(reviewDateJudge(shared[1], a2.token, seams).status, "judged");

  // Each date was judged once, by the run that held it.
  assert.deepEqual(
    reviewDateStatus(shared, seams).dates.map(({ date, status, judged_by }) => ({ date, status, judged_by })),
    [
      { date: shared[0], status: "judged", judged_by: A },
      { date: shared[1], status: "judged", judged_by: A },
    ],
  );
});
