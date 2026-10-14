// The order and the 50-file cap of a /housekeeping run (spec §B3.4, #1209):
// housekeeping__order_candidates computes them, housekeeping__write_run_file refuses a proposal
// that breaks them.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { codeOf, matterFixture, proposalFor, runDir, writeApproval } from "./helpers/housekeeping-fixture.mjs";

const { orderCandidates } = await import("../build/housekeeping/order.js");
const { writeRunFile } = await import("../build/housekeeping/run-files.js");

const RUN_A = "20260927-100000000-aaaa";
const RUN_B = "20260927-110000000-bbbb";
const RUN_C = "20260927-120000000-cccc";

/** A stand-in content hash: the same `content` always gives the same hash. */
const h = (content) => createHash("sha256").update(content).digest("hex");

const candidate = (path, content = path) => ({ path, hash: h(content) });

/** A proposal row for `c`: offered (stuck, information only), ingested_only or deferred. */
function rowFor(c, i, section = "offered", action = { kind: "stuck", reason: "no proposal" }) {
  return {
    row_id: `r${String(i + 1).padStart(3, "0")}`,
    current_path: c.path,
    hash: c.hash,
    ingest_outcome: "none",
    source_ids: [],
    section,
    ...(section === "offered" ? { action } : {}),
    name_checks: [],
    notes: [],
  };
}

/** Rows for an ordered candidate list: the first 50 offered, the rest deferred. */
const rowsFor = (ordered) => ordered.map((c, i) => rowFor(c, i, i < 50 ? "offered" : "deferred"));

/** A proposal written straight into `runId`'s directory, with the rows exactly as given. */
function plantProposal(m, runId, rows) {
  mkdirSync(runDir(m, runId), { recursive: true });
  writeFileSync(join(runDir(m, runId), "proposal.json"), JSON.stringify({ ...proposalFor(m, runId, []), rows }));
}

const paths = (list) => list.map((c) => c.path);

test("60 fresh files and no earlier run: root by name, then subfolder by folder then name, case ignored; 50 admitted, 10 deferred", () => {
  const m = matterFixture();
  try {
    mkdirSync(runDir(m, RUN_A), { recursive: true });
    const root = Array.from({ length: 28 }, (_, i) => candidate(`Root ${String(i).padStart(2, "0")}.pdf`));
    const sub = [
      ...Array.from({ length: 15 }, (_, i) => candidate(`4. LAWYER BRIEF\\Brief ${String(i).padStart(2, "0")}.pdf`)),
      ...Array.from({ length: 15 }, (_, i) => candidate(`3. CORRESPONDENCE\\letter ${String(i).padStart(2, "0")}.pdf`)),
    ];
    // Case is ignored, and a folder's own files come before those of a folder inside it.
    const shuffled = [...sub, candidate("3. CORRESPONDENCE\\A\\inner.pdf"), candidate("3. CORRESPONDENCE B\\x.pdf"), ...root.reverse()];
    const { previous_run, admitted, deferred } = orderCandidates(m.root, RUN_A, shuffled);
    assert.equal(previous_run, null);
    assert.equal(admitted.length, 50);
    assert.equal(deferred.length, 10);
    assert.ok([...admitted, ...deferred].every((c) => c.rotated === false));
    const expected = [
      ...Array.from({ length: 28 }, (_, i) => `Root ${String(i).padStart(2, "0")}.pdf`),
      ...Array.from({ length: 15 }, (_, i) => `3. CORRESPONDENCE\\letter ${String(i).padStart(2, "0")}.pdf`),
      "3. CORRESPONDENCE\\A\\inner.pdf",
      "3. CORRESPONDENCE B\\x.pdf",
      ...Array.from({ length: 15 }, (_, i) => `4. LAWYER BRIEF\\Brief ${String(i).padStart(2, "0")}.pdf`),
    ];
    assert.deepEqual(paths([...admitted, ...deferred]), expected);
    assert.deepEqual(paths(deferred), expected.slice(50));
  } finally {
    m.cleanup();
  }
});

test("rows the previous page offered and did not approve (left as is, stuck, misfiled) come after every fresh file, root before subfolder; approved rows are fresh even when their apply failed", () => {
  const m = matterFixture();
  try {
    const leftRoot = candidate("b left.pdf");
    const stuckSub = candidate("3. CORRESPONDENCE\\a stuck.pdf");
    const misfiledRoot = candidate("a misfiled.pdf");
    const approvedFailed = candidate("z approved.pdf");
    const deferredBefore = candidate("4. LAWYER BRIEF\\deferred.pdf");
    const ingestedOnly = candidate("3. CORRESPONDENCE\\z ingested.pdf");
    const previous = [
      rowFor(misfiledRoot, 0, "offered", { kind: "misfiled", matter: "L1000" }),
      rowFor(leftRoot, 1),
      rowFor(approvedFailed, 2, "offered", { kind: "move", folder: "3. CORRESPONDENCE" }),
      rowFor(stuckSub, 3),
      rowFor(ingestedOnly, 4, "ingested_only"),
      rowFor(deferredBefore, 5, "deferred"),
    ];
    plantProposal(m, RUN_A, previous);
    // r004 is stuck: an approve entry on it (the page never posts one) does not make it fresh.
    writeApproval(m, RUN_A, [{ row_id: "r003", approve: true }, { row_id: "r004", approve: true }]);
    writeFileSync(join(runDir(m, RUN_A), "applied.jsonl"), JSON.stringify({ row_id: "r003", outcome: "failed", reason: "dest_exists" }) + "\n");
    mkdirSync(runDir(m, RUN_B));

    const freshRoot = candidate("zz new.pdf");
    const freshSub = candidate("6. LAW\\new case.pdf");
    const result = orderCandidates(m.root, RUN_B, [stuckSub, leftRoot, freshSub, misfiledRoot, approvedFailed, deferredBefore, freshRoot, ingestedOnly]);
    assert.equal(result.previous_run, RUN_A);
    assert.deepEqual(
      result.admitted.map((c) => [c.path, c.rotated]),
      [
        ["z approved.pdf", false],
        ["zz new.pdf", false],
        ["3. CORRESPONDENCE\\z ingested.pdf", false],
        ["4. LAWYER BRIEF\\deferred.pdf", false],
        ["6. LAW\\new case.pdf", false],
        ["a misfiled.pdf", true],
        ["b left.pdf", true],
        ["3. CORRESPONDENCE\\a stuck.pdf", true],
      ]
    );
  } finally {
    m.cleanup();
  }
});

test("rotation matches by hash: a file renamed since the last page still rotates, and a new file under an old name does not", () => {
  const m = matterFixture();
  try {
    plantProposal(m, RUN_A, [rowFor(candidate("old name.pdf", "contents 1"), 0), rowFor(candidate("same name.pdf", "contents 2"), 1)]);
    mkdirSync(runDir(m, RUN_B));
    const { admitted } = orderCandidates(m.root, RUN_B, [candidate("a renamed.pdf", "contents 1"), candidate("same name.pdf", "contents 3")]);
    assert.deepEqual(admitted.map((c) => [c.path, c.rotated]), [["same name.pdf", false], ["a renamed.pdf", true]]);
  } finally {
    m.cleanup();
  }
});

test("a missing, unparseable or invalid previous proposal makes every file fresh, with no error; the newest valid earlier run is read past them", () => {
  const m = matterFixture();
  try {
    const left = candidate("left.pdf");
    const files = [candidate("b.pdf"), left, candidate("a.pdf")];
    // No earlier run directory at all.
    mkdirSync(runDir(m, RUN_C), { recursive: true });
    assert.equal(orderCandidates(m.root, RUN_C, files).previous_run, null);

    for (const plant of [
      () => mkdirSync(runDir(m, RUN_B)), // a run that stopped before its proposal
      () => writeFileSync(join(runDir(m, RUN_B), "proposal.json"), "{not json"),
      () => writeFileSync(join(runDir(m, RUN_B), "proposal.json"), JSON.stringify({ ...proposalFor(m, RUN_A, [rowFor(left, 0)]) })), // another run's id
    ]) {
      plant();
      const { previous_run, admitted } = orderCandidates(m.root, RUN_C, files);
      assert.equal(previous_run, null);
      assert.deepEqual(paths(admitted), ["a.pdf", "b.pdf", "left.pdf"]);
    }

    plantProposal(m, RUN_A, [rowFor(left, 0)]);
    const { previous_run, admitted } = orderCandidates(m.root, RUN_C, files);
    assert.equal(previous_run, RUN_A);
    assert.deepEqual(paths(admitted), ["a.pdf", "b.pdf", "left.pdf"]);
    assert.equal(admitted[2].rotated, true);
    // A later run is never the previous run.
    plantProposal(m, "20260927-130000000-dddd", [rowFor(candidate("a.pdf"), 0)]);
    assert.equal(orderCandidates(m.root, RUN_C, files).admitted[0].rotated, false);
  } finally {
    m.cleanup();
  }
});

test("an unreadable previous approval.json is refused, never read as no approval", () => {
  const m = matterFixture();
  try {
    plantProposal(m, RUN_A, [rowFor(candidate("a.pdf"), 0)]);
    writeFileSync(join(runDir(m, RUN_A), "approval.json"), "{torn");
    mkdirSync(runDir(m, RUN_B));
    assert.equal(codeOf(() => orderCandidates(m.root, RUN_B, [candidate("a.pdf")])), "approval_corrupt");
  } finally {
    m.cleanup();
  }
});

test("order_candidates refuses a malformed candidate list and an unknown run", () => {
  const m = matterFixture();
  try {
    mkdirSync(runDir(m, RUN_A), { recursive: true });
    for (const bad of [
      "not a list",
      [{ path: "a.pdf" }],
      [{ path: "C:\\a.pdf", hash: h("a") }],
      [{ path: "..\\a.pdf", hash: h("a") }],
      [{ path: "a.pdf", hash: "ABC" }],
      [candidate("3. CORRESPONDENCE\\a.pdf"), candidate("3. correspondence/A.pdf")],
    ]) {
      assert.equal(codeOf(() => orderCandidates(m.root, RUN_A, bad)), "invalid_argument", JSON.stringify(bad));
    }
    assert.equal(codeOf(() => orderCandidates(m.root, RUN_B, [])), "run_not_found");
  } finally {
    m.cleanup();
  }
});

test("write_run_file refuses rows out of order, a deferred row before the cap, and more than 50 rows not deferred, naming the first row out of place", () => {
  const m = matterFixture();
  try {
    plantProposal(m, RUN_A, [rowFor(candidate("a rotated.pdf"), 0)]);
    mkdirSync(runDir(m, RUN_B));
    const files = [candidate("a rotated.pdf"), ...Array.from({ length: 55 }, (_, i) => candidate(`f${String(i).padStart(2, "0")}.pdf`))];
    const { admitted, deferred } = orderCandidates(m.root, RUN_B, files);
    const good = rowsFor([...admitted, ...deferred]);
    const write = (rows) => writeRunFile(m.root, RUN_B, "proposal.json", JSON.stringify({ ...proposalFor(m, RUN_B, []), rows }));
    const refusal = (rows) => {
      try {
        write(rows);
      } catch (err) {
        return [err.code, err.message];
      }
      throw new Error("expected a refusal");
    };

    // By name, the rotated file comes first; it belongs after every fresh file.
    const byName = rowsFor([...admitted, ...deferred].sort((a, b) => (a.path < b.path ? -1 : 1)));
    let [code, message] = refusal(byName);
    assert.equal(code, "proposal_out_of_order");
    assert.match(message, /rows\[0\] \(r001\) a rotated\.pdf is out of order: row 1 must be f00\.pdf;/);
    [code, message] = refusal([...good.slice(0, 54), good[55], good[54]]);
    assert.match(message, /rows\[54\] \(r056\) a rotated\.pdf is out of order: row 55 must be f54\.pdf;/);

    const deferredEarly = good.map((r) => ({ ...r }));
    deferredEarly[3] = rowFor(admitted[3], 3, "deferred");
    [code, message] = refusal(deferredEarly);
    assert.equal(code, "proposal_out_of_order");
    assert.match(message, /rows\[3\] \(r004\) is deferred, but only rows past the first 50 are deferred/);

    const overCap = good.map((r, i) => (i === 50 ? rowFor(deferred[0], 50, "ingested_only") : r));
    [code, message] = refusal(overCap);
    assert.match(message, /rows\[50\] \(r051\) is past the 50-file cap and must be deferred/);

    assert.equal(write(good).bytes > 0, true);
  } finally {
    m.cleanup();
  }
});

test("two runs over more than 50 files: files deferred behind rotated ones come back fresh, and files left as is go to the back", () => {
  const m = matterFixture();
  try {
    // Run A offered five subfolder files; the practitioner approved none of them.
    const old = Array.from({ length: 5 }, (_, i) => candidate(`3. CORRESPONDENCE\\old ${i}.pdf`));
    plantProposal(m, RUN_A, old.map((c, i) => rowFor(c, i)));
    writeApproval(m, RUN_A, []);

    // Run B: 48 new root files and three new subfolder files fill the 50 ahead of the rotated five.
    mkdirSync(runDir(m, RUN_B));
    const newRoot = Array.from({ length: 48 }, (_, i) => candidate(`new ${String(i).padStart(2, "0")}.pdf`));
    const newSub = Array.from({ length: 3 }, (_, i) => candidate(`6. LAW\\case ${i}.pdf`));
    const b = orderCandidates(m.root, RUN_B, [...old, ...newSub, ...newRoot]);
    assert.equal(b.previous_run, RUN_A);
    assert.deepEqual(paths(b.admitted), paths([...newRoot, ...newSub.slice(0, 2)]));
    assert.deepEqual(paths(b.deferred), paths([newSub[2], ...old]));
    assert.ok(b.deferred.slice(1).every((c) => c.rotated));
    writeRunFile(m.root, RUN_B, "proposal.json", JSON.stringify({ ...proposalFor(m, RUN_B, []), rows: rowsFor([...b.admitted, ...b.deferred]) }));
    // Every row approved and filed except the last new root file, left as is.
    writeApproval(m, RUN_B, rowsFor(b.admitted).slice(0, 50).filter((r) => r.current_path !== newRoot[47].path).map((r) => ({ row_id: r.row_id, approve: true })));

    // Run C: what is left, plus one new file. The deferred files are fresh again; the file left as is rotates.
    mkdirSync(runDir(m, RUN_C));
    const late = candidate("late arrival.pdf");
    const c = orderCandidates(m.root, RUN_C, [newRoot[47], ...old, newSub[2], late]);
    assert.equal(c.previous_run, RUN_B);
    assert.deepEqual(
      c.admitted.map((x) => [x.path, x.rotated]),
      [["late arrival.pdf", false], ...old.map((x) => [x.path, false]), ["6. LAW\\case 2.pdf", false], ["new 47.pdf", true]]
    );
    assert.deepEqual(c.deferred, []);
    writeRunFile(m.root, RUN_C, "proposal.json", JSON.stringify({ ...proposalFor(m, RUN_C, []), rows: rowsFor(c.admitted) }));
  } finally {
    m.cleanup();
  }
});
