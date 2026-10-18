import assert from "node:assert/strict";
import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { matterFixture, proposalFor, row, runDir, sha, writeApproval } from "./helpers/housekeeping-fixture.mjs";

const { journalAppend, writeRunFile } = await import("../build/housekeeping/run-files.js");
const { hashAt, reconcile } = await import("../build/housekeeping/reconcile.js");

const RUN = "20260924-100000-aaaa";
const CORR = "3. CORRESPONDENCE";
const name = (id) => `2026-01-05 LF Smith re ${id}.pdf`;
const fileTo = (n, extra = {}) => ({ action: { kind: "file", name: n, folder: CORR, ...extra } });

/** A run approving `ids` (root files `<id>.pdf`, each filed to 3. CORRESPONDENCE), plus `extraRows`. */
function setUp(m, ids, extraRows = [], extraApprovals = [], runId = RUN) {
  const rows = ids.map((id) => row(m, `${id}.pdf`, { row_id: id, ...fileTo(name(id)) }));
  mkdirSync(runDir(m, runId), { recursive: true });
  writeRunFile(m.root, runId, "proposal.json", JSON.stringify(proposalFor(m, runId, [...rows, ...extraRows])));
  writeApproval(m, runId, [...ids.map((id) => ({ row_id: id, approve: true })), ...extraApprovals]);
}

const at = (m, id) => m.at(`${id}.pdf`);
const filed = (m, id) => m.at(`${CORR}/${name(id)}`);

test("each state of the reconciler table (spec §B10) and its action", async () => {
  const ids = ["nm", "mv", "ch", "gone", "gone2", "clash", "dup", "done"];
  const m = matterFixture(Object.fromEntries(ids.map((id) => [`${id}.pdf`, `bytes of ${id}`])));
  try {
    setUp(m, ids);
    renameSync(at(m, "mv"), filed(m, "mv"));
    writeFileSync(at(m, "ch"), "edited after approval");
    rmSync(at(m, "gone"));
    rmSync(at(m, "gone2"));
    writeFileSync(filed(m, "gone2"), "someone else's file");
    writeFileSync(filed(m, "clash"), "a different file");
    writeFileSync(filed(m, "dup"), "bytes of dup");
    renameSync(at(m, "done"), filed(m, "done"));
    journalAppend(m.root, RUN, "done", "done");

    const { runs } = await reconcile(m.root, undefined, m.env);
    assert.equal(runs.length, 1);
    assert.equal(runs[0].run_id, RUN);
    const got = Object.fromEntries(runs[0].rows.map((r) => [r.row_id, [r.state, r.action, r.reason]]));
    assert.deepEqual(got, {
      nm: ["not_moved", "apply", undefined],
      mv: ["moved", "post_move_steps", undefined],
      ch: ["changed", "journal_failed", "changed since approval"],
      gone: ["missing", "journal_failed", "approved file not found"],
      gone2: ["missing", "journal_failed", "approved file not found"],
      clash: ["clash", "journal_failed", "a different file is at the destination"],
      dup: ["duplicate_at_destination", "journal_failed", "duplicate at destination"],
    });
    const nm = runs[0].rows.find((r) => r.row_id === "nm");
    assert.equal(nm.new_path, filed(m, "nm"));
    assert.equal(nm.resolution.ok, true);
  } finally {
    m.cleanup();
  }
});

test("answered-question and It's-final rows not moved ask for ingest status; invalid rows close failed", async () => {
  const m = matterFixture({ "q.pdf": "q", "q2.pdf": "q2", "fin.docx": "f", "bad.pdf": "b" });
  try {
    setUp(
      m,
      [],
      [
        row(m, "q.pdf", { row_id: "q", ingest_outcome: "stopped", ...fileTo(name("q"), { answer: "A" }) }),
        row(m, "q2.pdf", { row_id: "q2", ingest_outcome: "stopped", ...fileTo(name("q2"), { answer: "B" }) }),
        row(m, "fin.docx", { row_id: "fin", ingest_outcome: "none", ...fileTo("2026-01-05 LF Smith re fin.docx", { final: true }) }),
        row(m, "bad.pdf", { row_id: "bad", ingest_outcome: "none", ...fileTo(name("bad")) }),
      ],
      ["q", "q2", "fin", "bad"].map((row_id) => ({ row_id, approve: true }))
    );
    renameSync(m.at("q2.pdf"), filed(m, "q2"));
    const { runs } = await reconcile(m.root, RUN, m.env);
    const got = Object.fromEntries(runs[0].rows.map((r) => [r.row_id, [r.state, r.action, r.reason]]));
    assert.deepEqual(got, {
      q: ["not_moved", "needs_ingest_status", undefined],
      q2: ["moved", "post_move_steps", undefined],
      fin: ["not_moved", "needs_ingest_status", undefined],
      bad: ["unresolvable", "journal_failed", "the file is not ingested (none), so it cannot be filed"],
    });
  } finally {
    m.cleanup();
  }
});

test("a case-only rename in place reads as not moved, then moved", async () => {
  const current = "2026-01-05 lf Smith re case.pdf";
  const m = matterFixture({ [`${CORR}/${current}`]: "case" });
  try {
    setUp(m, [], [row(m, `${CORR}/${current}`, { row_id: "case", action: { kind: "rename", name: name("case") } })], [{ row_id: "case", approve: true }]);
    let rows = (await reconcile(m.root, RUN, m.env)).runs[0].rows;
    assert.deepEqual([rows[0].state, rows[0].action], ["not_moved", "apply"]);
    renameSync(m.at(`${CORR}/${current}`), filed(m, "case"));
    rows = (await reconcile(m.root, RUN, m.env)).runs[0].rows;
    assert.deepEqual([rows[0].state, rows[0].action], ["moved", "post_move_steps"]);
  } finally {
    m.cleanup();
  }
});

test("trash rows reconcile from the old path alone, and trash only while the twin still holds the same contents (§C8)", async () => {
  const files = {
    "tr1.pdf": "dup",
    "tr2.pdf": "dup",
    "tr3.pdf": "dup",
    "tr4.pdf": "gone twin",
    "tr5.pdf": "twin that moved",
    "twinrow.pdf": "twin that moved",
    [`${CORR}/filed twin.pdf`]: "dup",
  };
  const m = matterFixture(files);
  try {
    const dup = (id, twin) =>
      row(m, `${id}.pdf`, {
        row_id: id,
        ingest_outcome: "none",
        action: { kind: "duplicate" },
        twin,
      });
    setUp(
      m,
      ["twinrow"],
      [
        dup("tr1", { path: `${CORR}\\filed twin.pdf`, ingested: true }),
        dup("tr2", { path: `${CORR}\\filed twin.pdf`, ingested: true }),
        dup("tr3", { path: `${CORR}\\filed twin.pdf`, ingested: true }),
        dup("tr4", { path: `${CORR}\\no longer here.pdf`, ingested: true }),
        dup("tr5", { path: "twinrow.pdf", row_id: "twinrow", ingested: false }),
      ],
      ["tr1", "tr2", "tr3", "tr4", "tr5"].map((id) => ({ row_id: id, approve: true }))
    );
    rmSync(m.at("tr1.pdf"));
    writeFileSync(m.at("tr3.pdf"), "edited");
    renameSync(m.at("twinrow.pdf"), filed(m, "twinrow"));
    journalAppend(m.root, RUN, "twinrow", "done");

    const { runs } = await reconcile(m.root, RUN, m.env);
    const got = Object.fromEntries(runs[0].rows.map((r) => [r.row_id, [r.state, r.action, r.reason]]));
    assert.deepEqual(got, {
      tr1: ["trashed", "journal_done", undefined],
      tr2: ["not_moved", "trash", undefined],
      tr3: ["changed", "journal_failed", "changed since approval"],
      tr4: ["not_moved", "journal_failed", "the other copy was not found with the same contents"],
      tr5: ["not_moved", "trash", undefined],
    });
  } finally {
    m.cleanup();
  }
});

test("a duplicate whose twin is a row on the same page follows the twin to where its own row filed it (Run B)", async () => {
  const filedTwin = `${CORR}\\2026-01-05 LF Smith re Scan.pdf`;
  const m = matterFixture({ "Scan_0001.pdf": "scan", "Scan_0002.pdf": "scan" });
  try {
    const rows = [
      row(m, "Scan_0001.pdf", { row_id: "r027", action: { kind: "file", name: "2026-01-05 LF Smith re Scan.pdf", folder: CORR } }),
      row(m, "Scan_0002.pdf", { row_id: "r028", ingest_outcome: "none", action: { kind: "duplicate" }, twin: { path: "Scan_0001.pdf", ingested: true } }),
    ];
    mkdirSync(runDir(m, RUN), { recursive: true });
    // Without the twin's row id the proposal is refused, naming the row: the trash check could not follow the twin.
    assert.throws(
      () => writeRunFile(m.root, RUN, "proposal.json", JSON.stringify(proposalFor(m, RUN, rows))),
      (err) => err.code === "invalid_proposal" && /r028/.test(err.message) && /twin\.row_id/.test(err.message) && /r027/.test(err.message)
    );
    rows[1].twin.row_id = "r027";
    writeRunFile(m.root, RUN, "proposal.json", JSON.stringify(proposalFor(m, RUN, rows)));
    writeApproval(m, RUN, [{ row_id: "r027", approve: true }, { row_id: "r028", approve: true }]);
    // The twin is filed in the same apply, before the trash row.
    renameSync(m.at("Scan_0001.pdf"), m.at(filedTwin));
    journalAppend(m.root, RUN, "r027", "done");
    const { runs } = await reconcile(m.root, RUN, m.env);
    assert.deepEqual(runs[0].rows.map((r) => [r.row_id, r.state, r.action, r.reason]), [["r028", "not_moved", "trash", undefined]]);
  } finally {
    m.cleanup();
  }
});

test("only interrupted runs are listed; a named run without approval is refused", async () => {
  const m = matterFixture({ "a.pdf": "a", "b.pdf": "b", "c.pdf": "c" });
  try {
    setUp(m, ["a"], [], [], "20260924-090000-aaaa");
    journalAppend(m.root, "20260924-090000-aaaa", "a", "done");
    setUp(m, ["b"], [], [], "20260924-100000-aaaa");
    // Closed without Approve: finished, not interrupted.
    mkdirSync(runDir(m, "20260924-110000-aaaa"), { recursive: true });
    writeRunFile(m.root, "20260924-110000-aaaa", "proposal.json", JSON.stringify(proposalFor(m, "20260924-110000-aaaa", [row(m, "c.pdf", { row_id: "c", ...fileTo(name("c")) })])));
    // Neither a run id nor a parseable proposal: ignored.
    mkdirSync(join(runDir(m, "20260924-120000-aaaa")), { recursive: true });
    writeFileSync(join(runDir(m, "20260924-120000-aaaa"), "proposal.json"), "{");
    mkdirSync(join(m.caseData, "housekeeping", "notes"), { recursive: true });

    const { runs } = await reconcile(m.root, undefined, m.env);
    assert.deepEqual(runs.map((r) => r.run_id), ["20260924-100000-aaaa"]);
    await assert.rejects(reconcile(m.root, "20260924-110000-aaaa", m.env), (err) => err.code === "not_approved");
    await assert.rejects(reconcile(m.root, "20260924-120000-aaaa", m.env), (err) => err.code === "invalid_proposal");
  } finally {
    m.cleanup();
  }
});

test("a run is open only while a move row lacks its journal line: retry entries, rows left as is and information-only rows never keep it open", async () => {
  const files = { "a.pdf": "a", "failed.pdf": "f", "brown.pdf": "b", "stuck.pdf": "s", "unsure.pdf": "u" };
  const m = matterFixture(files);
  try {
    // "unsure" is left as is: no approval entry. "other" and "leave" are information only: never approved.
    setUp(
      m,
      ["a"],
      [
        row(m, "failed.pdf", { row_id: "retry", ingest_outcome: "failed", action: { kind: "unreadable" } }),
        row(m, "brown.pdf", { row_id: "other", action: { kind: "misfiled", matter: "L998" } }),
        row(m, "stuck.pdf", { row_id: "leave", action: { kind: "stuck", reason: "no naming rule" } }),
        row(m, "unsure.pdf", { row_id: "unsure", ...fileTo(name("unsure")) }),
      ],
      [{ row_id: "retry", approve: true }]
    );
    renameSync(at(m, "a"), filed(m, "a"));
    journalAppend(m.root, RUN, "a", "done");
    // Nothing is open, so nothing is re-resolved: a name gate that cannot start is never reached.
    const noGate = { ...m.env, COCLERK_REPO_ROOT: join(m.base, "no repo") };
    assert.deepEqual(await reconcile(m.root, undefined, noGate), { runs: [] });
    assert.deepEqual(await reconcile(m.root, RUN, noGate), { runs: [] });
  } finally {
    m.cleanup();
  }
});

test("an approval with nothing approved (rows: []) is finished, not interrupted", async () => {
  const m = matterFixture({ "a.pdf": "a" });
  try {
    const rows = [row(m, "a.pdf", { row_id: "a", ...fileTo(name("a")) })];
    mkdirSync(runDir(m, RUN), { recursive: true });
    writeRunFile(m.root, RUN, "proposal.json", JSON.stringify(proposalFor(m, RUN, rows)));
    writeApproval(m, RUN, []);
    assert.deepEqual(await reconcile(m.root, undefined, m.env), { runs: [] });
    assert.deepEqual(await reconcile(m.root, RUN, m.env), { runs: [] });
  } finally {
    m.cleanup();
  }
});

test("a corrupt approval.json is an error, for a named run and in the listing, never a run without approval", async () => {
  const m = matterFixture({ "a.pdf": "a" });
  try {
    setUp(m, ["a"]);
    writeFileSync(join(runDir(m, RUN), "approval.json"), "{truncated");
    await assert.rejects(reconcile(m.root, RUN, m.env), (err) => err.code === "approval_corrupt" && /approval\.json/.test(err.message));
    await assert.rejects(reconcile(m.root, undefined, m.env), (err) => err.code === "approval_corrupt");
  } finally {
    m.cleanup();
  }
});

test("hashAt tells an absent path from one that is not a file", async () => {
  const m = matterFixture({ "a.pdf": "a" });
  try {
    assert.deepEqual(await hashAt(m.at("missing.pdf")), { kind: "absent" });
    assert.deepEqual(await hashAt(m.at(CORR)), { kind: "not_a_file" });
    assert.deepEqual(await hashAt(m.at("a.pdf")), { kind: "file", sha256: sha(m.at("a.pdf")) });
  } finally {
    m.cleanup();
  }
});
