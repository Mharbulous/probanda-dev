// The review_date__* tools on billing's `timekeeping` server (issue 284, ticket 279): each tool's
// results, the 60-minute claim, the export file tie_out.py reads, and the one-time import.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const {
  reviewDateClaim,
  reviewDateRenew,
  reviewDateJudge,
  reviewDateRelease,
  reviewDateStatus,
  reviewDateExport,
  reviewDateImportFile,
} = await import("../build/time-pipeline/review-date.js");
const { resolveTimePipelineDbPath } = await import("../build/time-pipeline/backend.js");
const { callTimekeepingTool } = await import("../build/timekeeping-dispatch.js");

const MINUTE = 60 * 1000;
const START = Date.parse("2026-11-10T09:00:00.000Z");

/** A scratch store and a clock the test moves. */
function fixture(t) {
  const scratch = mkdtempSync(join(tmpdir(), "coclerk-review-date-"));
  t.after(() => rmSync(scratch, { recursive: true, force: true }));
  const appData = join(scratch, "appdata");
  mkdirSync(join(appData, "Coclerk"), { recursive: true });
  const root = join(scratch, "0. CASE DATA");
  mkdirSync(root, { recursive: true });
  writeFileSync(join(appData, "Coclerk", "coclerk.json"), JSON.stringify({ case_data_root: root }));
  let now = START;
  const seams = {
    // LOCALAPPDATA and COCLERK_PYTHON reach the Python helper, as in time-pipeline-tools.db.test.mjs.
    env: { APPDATA: appData, LOCALAPPDATA: process.env.LOCALAPPDATA, COCLERK_PYTHON: process.env.COCLERK_PYTHON },
    now: () => new Date(now),
  };
  return { seams, root, scratch, advance: (minutes) => { now += minutes * MINUTE; } };
}

const iso = (ms) => new Date(ms).toISOString();

test("claim returns claimed with a token and an expiry 60 minutes on, then held to anyone else", (t) => {
  const f = fixture(t);
  const first = reviewDateClaim("2026-10-02", "L145:b1", f.seams);
  assert.equal(first.status, "claimed");
  assert.match(first.token, /^[0-9a-f-]{36}$/);
  assert.equal(first.expires_at, iso(START + 60 * MINUTE));
  f.advance(59);
  assert.deepEqual(reviewDateClaim("2026-10-02", "L166:b2", f.seams), {
    status: "held", date: "2026-10-02", holder: "L145:b1", expires_at: iso(START + 60 * MINUTE),
  });
  // Even the same holder gets held: the token was given once.
  assert.equal(reviewDateClaim("2026-10-02", "L145:b1", f.seams).status, "held");
});

test("renew sets a full 60 minutes from now, and works after a lapse while no other run took the date", (t) => {
  const f = fixture(t);
  const { token } = reviewDateClaim("2026-10-02", "L145:b1", f.seams);
  f.advance(45);
  assert.deepEqual(reviewDateRenew("2026-10-02", token, f.seams), {
    status: "renewed", date: "2026-10-02", expires_at: iso(START + 105 * MINUTE),
  });
  f.advance(90); // lapsed, nobody else claimed
  assert.equal(reviewDateRenew("2026-10-02", token, f.seams).status, "renewed");
  assert.deepEqual(reviewDateRenew("2026-10-02", "not-the-token", f.seams), { status: "claim_lost", date: "2026-10-02" });
});

test("judge marks the date with the claim's holder, after a lapse too, and the date then answers judged", (t) => {
  const f = fixture(t);
  const { token } = reviewDateClaim("2026-10-02", "L145:b1", f.seams);
  f.advance(75);
  const judged = reviewDateJudge("2026-10-02", token, f.seams);
  assert.deepEqual(judged, { status: "judged", date: "2026-10-02", judged_at: iso(START + 75 * MINUTE), judged_by: "L145:b1" });
  assert.deepEqual(reviewDateClaim("2026-10-02", "L166:b2", f.seams), {
    status: "judged", date: "2026-10-02", judged_at: judged.judged_at, judged_by: "L145:b1",
  });
  // The token is spent: no renew, judge or release with it.
  for (const call of [reviewDateRenew, reviewDateJudge, reviewDateRelease]) {
    assert.equal(call("2026-10-02", token, f.seams).status, "claim_lost");
  }
});

test("release frees the date without a mark; a wrong token gets claim_lost and changes nothing", (t) => {
  const f = fixture(t);
  const { token } = reviewDateClaim("2026-10-02", "L145:b1", f.seams);
  assert.deepEqual(reviewDateRelease("2026-10-02", "wrong", f.seams), { status: "claim_lost", date: "2026-10-02" });
  assert.equal(reviewDateClaim("2026-10-02", "L166:b2", f.seams).status, "held");
  assert.deepEqual(reviewDateRelease("2026-10-02", token, f.seams), { status: "released", date: "2026-10-02" });
  assert.deepEqual(reviewDateStatus(["2026-10-02"], f.seams).dates, [{ date: "2026-10-02", status: "not_started" }]);
  assert.equal(reviewDateClaim("2026-10-02", "L166:b2", f.seams).status, "claimed");
});

test("status derives not_started, in_progress and judged, and a lapsed claim reads not_started", (t) => {
  const f = fixture(t);
  const judged = reviewDateClaim("2026-10-01", "L145:b1", f.seams);
  reviewDateJudge("2026-10-01", judged.token, f.seams);
  reviewDateClaim("2026-10-02", "L145:b1", f.seams);
  assert.deepEqual(reviewDateStatus(["2026-10-01", "2026-10-02", "2026-10-03"], f.seams).dates, [
    { date: "2026-10-01", status: "judged", judged_at: iso(START), judged_by: "L145:b1" },
    { date: "2026-10-02", status: "in_progress", holder: "L145:b1", expires_at: iso(START + 60 * MINUTE) },
    { date: "2026-10-03", status: "not_started" },
  ]);
  f.advance(61);
  assert.equal(reviewDateStatus(["2026-10-02"], f.seams).dates[0].status, "not_started");
  assert.throws(() => reviewDateStatus(["2026-13-45"], f.seams), /YYYY-MM-DD/);
  assert.throws(() => reviewDateClaim("Oct 2", "L145:b1", f.seams), /YYYY-MM-DD/);
});

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

test("export writes the judged dates in range, sorted, as tie_out.py's {date, judged_at} lines, with the file's hash", (t) => {
  const f = fixture(t);
  for (const date of ["2026-10-05", "2026-10-01", "2026-09-30", "2026-10-03"]) {
    reviewDateJudge(date, reviewDateClaim(date, "L145:b1", f.seams).token, f.seams);
  }
  reviewDateClaim("2026-10-02", "L145:b1", f.seams); // in progress: not exported
  const out = join(f.scratch, "matter", "timecamping", "judged-dates.export.jsonl");
  const result = reviewDateExport("2026-10-01", "2026-10-04", out, f.seams);
  const bytes = readFileSync(out);
  assert.deepEqual(result, { path: out, count: 2, sha256: sha256(bytes) });
  assert.equal(
    bytes.toString("utf-8"),
    `{"date":"2026-10-01","judged_at":"${iso(START)}"}\n{"date":"2026-10-03","judged_at":"${iso(START)}"}\n`,
  );
  assert.throws(() => reviewDateExport("2026-10-04", "2026-10-01", out, f.seams), /after/);
});

test("import_file reports what it would add with dry_run, writes nothing then, and marks only dates not judged", (t) => {
  const f = fixture(t);
  reviewDateJudge("2026-10-01", reviewDateClaim("2026-10-01", "L145:b1", f.seams).token, f.seams);
  const file = join(f.scratch, "judged-dates.jsonl");
  writeFileSync(
    file,
    '{"date": "2026-10-02", "judged_at": "2026-10-20T10:00:00Z"}\n\n{"date": "2026-10-01", "judged_at": "2026-10-20T11:00:00Z"}\r\n{"date": "2026-10-03"}\n',
  );
  const before = sha256(readFileSync(file));

  assert.deepEqual(reviewDateImportFile(file, "practitioner", true, f.seams), {
    dry_run: true, added: ["2026-10-02", "2026-10-03"], skipped: ["2026-10-01"],
  });
  assert.equal(reviewDateStatus(["2026-10-02"], f.seams).dates[0].status, "not_started");

  assert.deepEqual(reviewDateImportFile(file, "practitioner", false, f.seams), {
    dry_run: false, added: ["2026-10-02", "2026-10-03"], skipped: ["2026-10-01"],
  });
  assert.deepEqual(reviewDateStatus(["2026-10-01", "2026-10-02", "2026-10-03"], f.seams).dates, [
    { date: "2026-10-01", status: "judged", judged_at: iso(START), judged_by: "L145:b1" },
    { date: "2026-10-02", status: "judged", judged_at: "2026-10-20T10:00:00Z", judged_by: "practitioner" },
    { date: "2026-10-03", status: "judged", judged_at: iso(START), judged_by: "practitioner" },
  ]);
  assert.equal(sha256(readFileSync(file)), before);
  // A second import adds nothing.
  assert.deepEqual(reviewDateImportFile(file, "practitioner", false, f.seams).added, []);
  assert.throws(() => reviewDateImportFile(join(f.scratch, "missing.jsonl"), "practitioner", true, f.seams), /not found/);
});

test("the timekeeping server serves every review_date__ tool through dispatch", async (t) => {
  const f = fixture(t);
  process.env.COCLERK_TIME_PIPELINE_DB_PATH = resolveTimePipelineDbPath(f.seams.env);
  t.after(() => delete process.env.COCLERK_TIME_PIPELINE_DB_PATH);
  const claimed = await callTimekeepingTool("review_date__claim", { date: "2026-10-02", holder: "timecamping:20261110T090000Z" });
  assert.equal(claimed.status, "claimed");
  assert.equal((await callTimekeepingTool("review_date__renew", { date: "2026-10-02", token: claimed.token })).status, "renewed");
  assert.equal((await callTimekeepingTool("review_date__judge", { date: "2026-10-02", token: claimed.token })).status, "judged");
  assert.equal((await callTimekeepingTool("review_date__release", { date: "2026-10-02", token: claimed.token })).status, "claim_lost");
  assert.equal((await callTimekeepingTool("review_date__status", { dates: ["2026-10-02"] })).dates[0].status, "judged");
  const out = join(f.scratch, "export.jsonl");
  assert.equal((await callTimekeepingTool("review_date__export", { from: "2026-10-01", to: "2026-10-31", out_path: out })).count, 1);
  assert.ok(existsSync(out));
  assert.deepEqual(
    await callTimekeepingTool("review_date__import_file", { path: out, judged_by: "practitioner", dry_run: true }),
    { dry_run: true, added: [], skipped: ["2026-10-02"] },
  );
});
