// drafting_data__split_merge (/drafting-data references/sync-split.md): the two copies a sync conflict
// split submission.sqlite into are compared record by record, every difference waits for a decision, and
// the merge is written to a new file while both copies stay byte for byte as they were.

import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

process.env.COCLERK_SUBMISSION_LOCK_ROOT = mkdtempSync(join(tmpdir(), "coclerk-split-locks-"));

const { callTool } = await import("../build/index.js");
const { freshSubmissionDb } = await import("./helpers/template-db.mjs");
const { submissionDataExecute, submissionDataQuery } = await import("../build/submission/backend.js");

async function rejection(promise) {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error("expected a rejection, got none");
}

const SEED = `INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L9999 - Test', 'CAN/BC/Vancouver-International-Arbitration-Centre');
  INSERT INTO filings (id, proceeding_id, kind, round, title) VALUES (1, 1, 'submissions_package', 'opening', 'Opening');
  INSERT INTO filings (id, proceeding_id, kind, round, title) VALUES (2, 1, 'submissions_package', 'reply', 'Reply');`;

/** A matter whose submission.sqlite was split into submission-DEV_A.sqlite and submission-DEV_B.sqlite,
 * each edited from a common start by its own script. */
async function splitMatter(t, scriptA, scriptB) {
  const base = mkdtempSync(join(tmpdir(), "coclerk-split-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const matterRoot = join(base, "L9999 Test Matter");
  const caseData = join(matterRoot, "0. CASE DATA");
  mkdirSync(caseData, { recursive: true });
  mkdirSync(join(base, "0. CASE DATA"));
  writeFileSync(join(matterRoot, "coclerk.json"), JSON.stringify({ schema_version: 5, matter_root: matterRoot, case_data_dir: "0. CASE DATA" }), "utf-8");
  const start = join(base, "start", "s.sqlite");
  mkdirSync(join(base, "start"));
  await freshSubmissionDb(start);
  await submissionDataExecute(start, SEED);
  const copies = {};
  for (const [side, script] of [["A", scriptA], ["B", scriptB]]) {
    const own = join(base, side, `${side}.sqlite`);
    mkdirSync(join(base, side));
    copyFileSync(start, own);
    if (script) await submissionDataExecute(own, script);
    copies[side] = join(caseData, `submission-DEV_${side}.sqlite`);
    copyFileSync(own, copies[side]);
  }
  const bytes = () => [readFileSync(copies.A), readFileSync(copies.B)];
  return { matterRoot, caseData, merged: join(caseData, "submission-merged.sqlite"), bytes, before: bytes() };
}

const diffOf = (m) => callTool({}, "drafting_data__split_merge", { matter_root: m.matterRoot, op: "diff" });
const mergeOf = (m, d, decisions) => callTool({}, "drafting_data__split_merge", { matter_root: m.matterRoot, op: "merge", sha256: d.inputs.map((i) => i.sha256), decisions });
const byKey = (d) => Object.fromEntries(d.differences.map((x) => [`${x.table} ${JSON.stringify(x.key)} ${x.kind}`, x]));

test("diff lists a one-sided insert, a one-sided update and a delete-or-add, and writes nothing", async (t) => {
  const m = await splitMatter(
    t,
    "UPDATE filings SET title = 'Opening, revised' WHERE id = 1; DELETE FROM filings WHERE id = 2;",
    "INSERT INTO filings (id, proceeding_id, kind, round, title) VALUES (3, 1, 'submissions_package', 'response', 'Sur-reply');"
  );
  const d = await diffOf(m);
  const found = byKey(d);
  assert.deepEqual(found['filings {"id":1} differ'].a, { title: "Opening, revised" });
  assert.deepEqual(found['filings {"id":1} differ'].b, { title: "Opening" });
  assert.equal(found['filings {"id":2} only_b'].a, null, "deleted in A, or never added: no ancestor tells which");
  assert.equal(found['filings {"id":3} only_b'].b.title, "Sur-reply");
  assert.ok(d.differences.every((x) => x.table !== "db_meta" || x.key.key !== "revision"), "the revision counter is resolved, never asked");
  assert.deepEqual(m.bytes(), m.before);
  assert.equal(existsSync(m.merged), false);
});

test("merge applies each decision, keeps both copies byte-identical, and gives the same file twice", async (t) => {
  const m = await splitMatter(
    t,
    "UPDATE filings SET title = 'Opening, revised' WHERE id = 1; DELETE FROM filings WHERE id = 2;",
    "INSERT INTO filings (id, proceeding_id, kind, round, title) VALUES (3, 1, 'submissions_package', 'response', 'Sur-reply');"
  );
  const d = await diffOf(m);
  const decisions = Object.fromEntries(d.differences.map((x) => [x.id, x.kind === "only_b" ? "b" : "a"]));
  const out = await mergeOf(m, d, decisions);
  assert.equal(out.out.toLowerCase(), m.merged.toLowerCase());
  const titles = () => submissionDataQuery(m.merged, "SELECT id, title FROM filings ORDER BY id").rows;
  assert.deepEqual(titles(), [{ id: 1, title: "Opening, revised" }, { id: 2, title: "Reply" }, { id: 3, title: "Sur-reply" }]);
  const triggers = (p) => submissionDataQuery(p, "SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name").rows;
  assert.deepEqual(triggers(m.merged), triggers(join(m.caseData, "submission-DEV_A.sqlite")), "every trigger restored");
  const first = readFileSync(m.merged);
  await mergeOf(m, d, decisions);
  assert.deepEqual(readFileSync(m.merged), first, "the same decisions give the same file");
  assert.deepEqual(m.bytes(), m.before, "both copies untouched");
});

test("a job held in one copy and released in the other is one difference the practitioner decides", async (t) => {
  const job = "INSERT INTO tickets (id, proceeding_id, title, intent, kind, billing_anchor, created) VALUES (6, 1, 'Research memo', 'Answer it', 'work', 'L9999', '2026-11-17');";
  const m = await splitMatter(t, job, `${job} UPDATE tickets SET status = 'wip', locked_by = 'sess-1017', locked_at = '2026-11-17T12:59' WHERE id = 6;`);
  const d = await diffOf(m);
  const hold = byKey(d)['tickets {"id":6} differ'];
  assert.deepEqual([hold.a.status, hold.b.status, hold.a.locked_by, hold.b.locked_by], ["queued", "wip", null, "sess-1017"]);
  await mergeOf(m, d, { [hold.id]: "a" });
  assert.equal(submissionDataQuery(m.merged, "SELECT status FROM tickets WHERE id = 6").rows[0].status, "queued");
});

test("an id both copies used: the practitioner's pick keeps that copy's record and its references", async (t) => {
  const m = await splitMatter(
    t,
    "INSERT INTO proceedings (id, matter_reference, forum) VALUES (2, 'A side', 'CAN/BC/BCSC'); INSERT INTO filings (id, proceeding_id, kind, round, title) VALUES (4, 2, 'submissions_package', 'opening', 'A filing');",
    "INSERT INTO proceedings (id, matter_reference, forum) VALUES (2, 'B side', 'CAN/BC/BCSC');"
  );
  const d = await diffOf(m);
  const found = byKey(d);
  const collision = found['proceedings {"id":2} differ'];
  const child = found['filings {"id":4} only_a'];
  // Taking B's proceeding 2 and A's filing 4 is sound: filing 4 still names a proceeding 2.
  await mergeOf(m, d, { [collision.id]: "b", [child.id]: "a" });
  assert.equal(submissionDataQuery(m.merged, "SELECT matter_reference FROM proceedings WHERE id = 2").rows[0].matter_reference, "B side");
  assert.equal(submissionDataQuery(m.merged, "SELECT proceeding_id FROM filings WHERE id = 4").rows[0].proceeding_id, 2);
});

test("a decision that orphans a record is refused, and nothing is written", async (t) => {
  const m = await splitMatter(
    t,
    "INSERT INTO proceedings (id, matter_reference, forum) VALUES (2, 'A side', 'CAN/BC/BCSC'); INSERT INTO filings (id, proceeding_id, kind, round, title) VALUES (4, 2, 'submissions_package', 'opening', 'A filing');",
    null
  );
  const d = await diffOf(m);
  const found = byKey(d);
  const err = await rejection(mergeOf(m, d, { [found['proceedings {"id":2} only_a'].id]: "b", [found['filings {"id":4} only_a'].id]: "a" }));
  assert.equal(err.code, "split_merge_unsound");
  assert.equal(existsSync(m.merged), false);
  assert.deepEqual(m.bytes(), m.before);
});

test("an undecided difference, a changed copy and a third copy are refused", async (t) => {
  const m = await splitMatter(t, "UPDATE filings SET title = 'A' WHERE id = 1;", "UPDATE filings SET title = 'B' WHERE id = 1;");
  const d = await diffOf(m);
  assert.equal((await rejection(mergeOf(m, d, {}))).code, "split_undecided");
  const stale = { ...d, inputs: [{ sha256: "0" }, d.inputs[1]] };
  assert.equal((await rejection(mergeOf(m, stale, { [d.differences[0].id]: "a" }))).code, "split_inputs_changed");
  copyFileSync(join(m.caseData, "submission-DEV_A.sqlite"), join(m.caseData, "submission-DEV_C.sqlite"));
  assert.equal((await rejection(diffOf(m))).code, "split_not_two");
  assert.equal(existsSync(m.merged), false);
});
