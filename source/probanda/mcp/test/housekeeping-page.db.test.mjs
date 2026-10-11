import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { matterFixture, proposalFor, row, runDir } from "./helpers/housekeeping-fixture.mjs";

const { writeRunFile } = await import("../build/housekeeping/run-files.js");
const { closePageServer, servePage } = await import("../build/housekeeping/server.js");
const { waitApproval } = await import("../build/housekeeping/wait.js");

const LETTER = "2026-01-05 LF Smith re Settlement.pdf";
const OTHER = "3. CORRESPONDENCE/old name.pdf";
const TWIN = "3. CORRESPONDENCE/2025-12-01 LF Smith re Offer.pdf";

function fixture() {
  return matterFixture({ [LETTER]: "letter bytes", [OTHER]: "other bytes", "copy.pdf": "offer", [TWIN]: "offer" });
}

function rows(m) {
  return [
    row(m, LETTER, { row_id: "r1", action: { kind: "move", folder: "3. CORRESPONDENCE" } }),
    row(m, OTHER, { row_id: "r2", action: { kind: "rename", name: "2026-02-01 LF Jones re Costs.pdf" } }),
    row(m, "copy.pdf", { row_id: "r3", ingest_outcome: "none", action: { kind: "duplicate" }, twin: { path: TWIN.replace("/", "\\"), ingested: true } }),
  ];
}

/** A run directory under an explicit id, holding a valid proposal. */
function withRun(m, runId) {
  mkdirSync(runDir(m, runId), { recursive: true });
  writeRunFile(m.root, runId, "proposal.json", JSON.stringify(proposalFor(m, runId, rows(m))));
  return runId;
}

async function post(url, body) {
  const res = await fetch(url.replace(/\/$/, "") + "/approve", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
}

test.after(() => closePageServer());

test("the page is served on 127.0.0.1 with a per-run token, self-contained, from proposal.json", async () => {
  const m = fixture();
  try {
    const runId = withRun(m, "20260924-100000-aaaa");
    const served = await servePage(m.root, runId);
    assert.match(served.url, /^http:\/\/127\.0\.0\.1:\d+\/h\/[A-Za-z0-9_-]{32}\/$/);
    assert.equal(served.rows, 3);
    assert.equal(served.approved, false);
    const res = await fetch(served.url);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-security-policy"), /default-src 'none'/);
    const html = await res.text();
    assert.ok(html.includes('"run_id":"' + runId + '"'));
    assert.equal(/<(script|link|img)[^>]+(src|href)=/i.test(html), false, "no external resource");

    const file = await fetch(served.url + "file/r1");
    assert.equal(await file.text(), "letter bytes");
    assert.equal(file.headers.get("content-type"), "application/pdf");
    assert.equal((await fetch(served.url + "file/nope")).status, 404);
    assert.equal((await fetch(served.url.replace(/\/h\/[^/]+/, "/h/not-a-token"))).status, 410);
  } finally {
    m.cleanup();
  }
});

test("a proposal.json that does not validate is never served, and only the newest run is", async () => {
  const m = fixture();
  try {
    const runId = "20260924-100000-aaaa";
    mkdirSync(runDir(m, runId), { recursive: true });
    writeFileSync(join(runDir(m, runId), "proposal.json"), JSON.stringify({ ...proposalFor(m, runId, rows(m)), rows: "nope" }));
    await assert.rejects(servePage(m.root, runId), (err) => err.code === "invalid_proposal");

    // An unparseable newer proposal is no proposal: the older run is still the newest one.
    const older = withRun(m, "20260924-090000-aaaa");
    assert.equal((await servePage(m.root, older)).run_id, older);
    withRun(m, "20260924-110000-aaaa");
    await assert.rejects(servePage(m.root, older), (err) => err.code === "stale_run");
  } finally {
    m.cleanup();
  }
});

test("serving again invalidates the earlier token: its page and its Approve are refused", async () => {
  const m = fixture();
  try {
    const runId = withRun(m, "20260924-100000-aaaa");
    const first = await servePage(m.root, runId);
    const second = await servePage(m.root, runId);
    assert.notEqual(first.url, second.url);
    assert.equal((await fetch(first.url)).status, 410);
    const refused = await post(first.url, { run: runId, rows: [{ row_id: "r1", approve: true }] });
    assert.equal(refused.status, 410);
    assert.equal(existsSync(join(runDir(m, runId), "approval.json")), false);
    assert.equal((await fetch(second.url)).status, 200);
  } finally {
    m.cleanup();
  }
});

test("an old page's Approve is refused once a newer run with a proposal exists", async () => {
  const m = fixture();
  try {
    const runId = withRun(m, "20260924-100000-aaaa");
    const served = await servePage(m.root, runId);
    withRun(m, "20260924-110000-aaaa");
    const refused = await post(served.url, { run: runId, rows: [{ row_id: "r1", approve: true }] });
    assert.equal(refused.status, 409);
    assert.match(refused.body.error, /out of date/);
    assert.equal(existsSync(join(runDir(m, runId), "approval.json")), false);
  } finally {
    m.cleanup();
  }
});

test("an old page's Approve is refused as soon as a newer run directory exists, before it has a proposal (spec A4)", async () => {
  const m = fixture();
  try {
    const runId = withRun(m, "20260924-100000-aaaa");
    const served = await servePage(m.root, runId);
    mkdirSync(runDir(m, "20260924-100000500-bbbb"), { recursive: true });
    const refused = await post(served.url, { run: runId, rows: [{ row_id: "r1", approve: true }] });
    assert.equal(refused.status, 409);
    assert.match(refused.body.error, /out of date/);
    assert.equal(existsSync(join(runDir(m, runId), "approval.json")), false);
  } finally {
    m.cleanup();
  }
});

test("Approve with nothing approved is valid: rows: [] writes approval.json (spec §B8.3)", async () => {
  const m = fixture();
  try {
    const runId = withRun(m, "20260924-100000-aaaa");
    const served = await servePage(m.root, runId);
    const empty = await post(served.url, { run: runId, rows: [] });
    assert.equal(empty.status, 200);
    assert.deepEqual(empty.body, { ok: true, run_id: runId, rows: 0 });
    const onDisk = JSON.parse(readFileSync(join(runDir(m, runId), "approval.json"), "utf-8"));
    assert.deepEqual(onDisk.rows, []);
    const waited = await waitApproval(m.root, runId, { ...m.env, COCLERK_HOUSEKEEPING_WAIT_MS: "400" });
    assert.equal(waited.status, "approved");
    assert.equal(waited.rows, 0);
  } finally {
    m.cleanup();
  }
});

test("Approve refuses a corrupt saved approval (untouched) and an unreadable proposal, each with its own message", async () => {
  const m = fixture();
  try {
    const runId = withRun(m, "20260924-100000-aaaa");
    const served = await servePage(m.root, runId);
    const approvalPath = join(runDir(m, runId), "approval.json");

    writeFileSync(approvalPath, "{truncated");
    const corrupt = await post(served.url, { run: runId, rows: [{ row_id: "r1", approve: true }] });
    assert.equal(corrupt.status, 409);
    assert.match(corrupt.body.error, /unreadable/);
    assert.equal(readFileSync(approvalPath, "utf-8"), "{truncated");
    rmSync(approvalPath);

    writeFileSync(join(runDir(m, runId), "proposal.json"), "{");
    const unreadable = await post(served.url, { run: runId, rows: [{ row_id: "r1", approve: true }] });
    assert.match(unreadable.body.error, /proposal for this run cannot be read \(proposal\.json does not parse/);
    assert.equal(existsSync(approvalPath), false);
  } finally {
    m.cleanup();
  }
});

test("Approve refuses unknown row ids, other runs, and anything but approve: true keyed by row id", async () => {
  const m = fixture();
  try {
    const runId = withRun(m, "20260924-100000-aaaa");
    const served = await servePage(m.root, runId);
    const bad = [
      { run: runId, rows: [{ row_id: "r1", approve: true }, { row_id: "ghost", approve: true }] },
      { run: "20260924-090000-aaaa", rows: [{ row_id: "r1", approve: true }] },
      { run: runId, rows: [{ row_id: "r1", approve: true, path: "C:\\Windows\\x" }] },
      { run: runId, rows: [{ row_id: "r1", approve: true, name: { kind: "typed", value: "x.pdf" } }] },
      { run: runId, rows: [{ row_id: "r1", approve: true, dest: "6. LAW" }] },
      { run: runId, rows: [{ row_id: "r1", approve: "yes" }] },
      { run: runId, rows: [{ row_id: "r1", approve: false }] },
      { run: runId, rows: [{ row_id: "r1" }] },
      { run: runId, rows: [{ row_id: "r1", approve: true, somethingElse: true }] },
      { run: runId, rows: [{ row_id: "r1", somethingElse: true }] },
      { run: runId, rows: [{ row_id: "ghost", approve: true }] },
      { run: runId, rows: [{ row_id: "r1", approve: true }, { row_id: "r1", approve: true }] },
      { run: runId, rows: "r1" },
    ];
    for (const body of bad) {
      const out = await post(served.url, body);
      assert.equal(out.status, 400, JSON.stringify(body));
    }
    assert.match((await post(served.url, { run: runId, rows: [{ row_id: "r1", somethingElse: true }] })).body.error, /unknown key somethingElse/);
    assert.match((await post(served.url, { run: runId, rows: [{ row_id: "ghost", approve: true }] })).body.error, /Unknown rows: ghost/);
    assert.equal(existsSync(join(runDir(m, runId), "approval.json")), false);
  } finally {
    m.cleanup();
  }
});

test("Approve refuses an entry on a stuck or misfiled row, naming the row: those rows are information only", async () => {
  const m = matterFixture({ [LETTER]: "letter bytes", "bill of costs.pdf": "bill", "brown letter.pdf": "brown" });
  try {
    const runId = "20260924-100000-aaaa";
    mkdirSync(runDir(m, runId), { recursive: true });
    const proposal = proposalFor(m, runId, [
      row(m, LETTER, { row_id: "r1", action: { kind: "move", folder: "3. CORRESPONDENCE" } }),
      row(m, "bill of costs.pdf", { row_id: "r4", action: { kind: "stuck", reason: "no naming rule for a bill of costs" } }),
      row(m, "brown letter.pdf", { row_id: "r5", action: { kind: "misfiled", matter: "L998" } }),
    ]);
    writeRunFile(m.root, runId, "proposal.json", JSON.stringify(proposal));
    const served = await servePage(m.root, runId);
    for (const [ids, named] of [[["r1", "r4"], /r4/], [["r5"], /r5/], [["r4", "r5"], /r4, r5/]]) {
      const out = await post(served.url, { run: runId, rows: ids.map((row_id) => ({ row_id, approve: true })) });
      assert.equal(out.status, 400, ids.join());
      assert.match(out.body.error, named);
      assert.match(out.body.error, /information only/);
      assert.doesNotMatch(out.body.error, /r1/);
    }
    assert.equal(existsSync(join(runDir(m, runId), "approval.json")), false);
    // Approving only the rows that are decided still works.
    assert.equal((await post(served.url, { run: runId, rows: [{ row_id: "r1", approve: true }] })).status, 200);
  } finally {
    m.cleanup();
  }
});

test("Approve writes approval.json durably before replying, once; a second submit is refused", async () => {
  const m = fixture();
  try {
    const runId = withRun(m, "20260924-100000-aaaa");
    const served = await servePage(m.root, runId);
    const choices = [
      { row_id: "r1", approve: true },
      { row_id: "r3", approve: true },
    ];
    const waiting = waitApproval(m.root, runId, { ...m.env, COCLERK_HOUSEKEEPING_WAIT_MS: "4000" });
    const ok = await post(served.url, { run: runId, rows: choices });
    // The reply came back: the file is already whole on disk.
    const onDisk = JSON.parse(readFileSync(join(runDir(m, runId), "approval.json"), "utf-8"));
    assert.equal(ok.status, 200);
    assert.deepEqual(onDisk.rows, choices);
    assert.equal(onDisk.run_id, runId);
    // The wait, polling on the same event loop as the listener, sees it.
    const waited = await waiting;
    assert.equal(waited.status, "approved");
    assert.equal(waited.rows, 2);

    const again = await post(served.url, { run: runId, rows: [{ row_id: "r2", approve: true }] });
    assert.equal(again.status, 409);
    assert.match(again.body.error, /already approved/);
    assert.deepEqual(JSON.parse(readFileSync(join(runDir(m, runId), "approval.json"), "utf-8")).rows, choices);

    // After approval the page renders the approved state.
    const html = await (await fetch(served.url)).text();
    assert.ok(html.includes('"approval":{"run_id":"' + runId + '"'));
  } finally {
    m.cleanup();
  }
});

test("serving an unknown run or a bad run id is refused", async () => {
  const m = fixture();
  try {
    await assert.rejects(servePage(m.root, "20260924-100000-aaaa"), (err) => err.code === "run_not_found");
    await assert.rejects(servePage(m.root, "../x"), (err) => err.code === "invalid_run_id");
  } finally {
    m.cleanup();
  }
});
