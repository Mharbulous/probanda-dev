// /housekeeping's work list in one call (issue #174): housekeeping__candidates lists, hashes,
// name-gates, looks up, admits, orders and caps. The name gate and the matter-data lookup are
// injected as fakes, so no Python and no database is needed.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { matterFixture, proposalFor, runDir } from "./helpers/housekeeping-fixture.mjs";

const { candidates } = await import("../build/housekeeping/candidates.js");

const RUN_A = "20261025-100000000-aaaa";
const RUN_B = "20261025-110000000-bbbb";
const h = (content) => createHash("sha256").update(content).digest("hex");

const SWEPT = [
  { path: "3. CORRESPONDENCE", folder_type: "Correspondence" },
  { path: "6. LAW", folder_type: "Law", flag_tokens: ["Ltd", "Inc"], second_pass: true },
  { path: "7. DISCOVERY", folder_type: "Discovery", second_pass: true },
];
const DIRS = ["0. DRAFT", "1. ADMIN", "3. CORRESPONDENCE", "6. LAW", "7. DISCOVERY", "8. MISC", "TRASH", "Claude outputs"];

/** A stand-in gate: firm grammar is `YYYY-MM-DD CODE ...`; a flag token is any listed word in the name. */
function fakeGate(calls) {
  return (groups) => {
    calls?.push(groups);
    return groups.map((g) =>
      g.names.map((name) => {
        const flags = g.flag_tokens.filter((t) => new RegExp(`\\b${t}\\b`).test(name));
        const ok = /^\d{4}-\d{2}-\d{2} [A-Z]{1,4} /.test(name);
        return { name, verdict: ok ? "conforms" : "fails", reason: ok ? "" : "no date and code", flags };
      })
    );
  };
}

/** A stand-in lookup: every file ingested unless named in `state`, which may also carry a review. */
function fakeLookup(state = {}, seen) {
  return (request) => {
    seen?.push(request);
    const ingest = request.files.map((f) => ({
      path: f.path,
      hash: f.hash,
      verdict: state[f.path]?.verdict ?? "ingested",
      store: "main",
      source_ids: [1],
      metadata: { title: "t" },
    }));
    const reviews = request.files.map((f) => ({
      reviewed: false,
      outcome: null,
      reviewed_at: null,
      matched_on: null,
      not_ingested: false,
      ingest_failure: null,
      ...(state[f.path]?.review ?? {}),
    }));
    return { ingest, reviews };
  };
}

function setup(files) {
  const m = matterFixture(files, { dirs: DIRS });
  mkdirSync(runDir(m, RUN_B), { recursive: true });
  return m;
}

const args = (m, extra = {}) => ({ matter_root: m.root, run_id: RUN_B, swept_folders: SWEPT, skip_folders: ["0. DRAFT"], ...extra });
const paths = (rows) => rows.map((r) => r.path);

test("listing: never-candidates, open in Word, skipped and unswept folders, the whitelist, `~` and `.` names at every level", async () => {
  const m = setup({
    "CLAUDE.md": "x",
    "AGENTS.md": "x",
    "ProceduralHistory.md": "x",
    "Case.cm12": "x",
    "desktop.ini": "x",
    "Shortcut.lnk": "x",
    "~scratch.txt": "x",
    ".hidden": "x",
    "Letter to client.docx": "open",
    "~$tter to client.docx": "lock",
    "Loose note.txt": "loose",
    "Scan.pdf": "scan",
    "0. DRAFT/draft.pdf": "d",
    "1. ADMIN/admin.pdf": "a",
    "8. MISC/misc.pdf": "m",
    "TRASH/old.pdf": "t",
    "Claude outputs/out.pdf": "o",
    "3. CORRESPONDENCE/letter.pdf": "l",
    "3. CORRESPONDENCE/sheet.xlsx": "s",
    "3. CORRESPONDENCE/~$letter.docx": "lock2",
    "3. CORRESPONDENCE/OC/2026/inner.MSG": "i",
    "3. CORRESPONDENCE/.sync/hidden.pdf": "h",
  });
  try {
    const out = await candidates(args(m), { gate: fakeGate(), lookup: fakeLookup() });
    assert.deepEqual(out.header, { open_in_word: ["Letter to client.docx"], folders_not_looked_inside: ["1. ADMIN", "8. MISC"] });
    // Root files always (the fixture's legacy coclerk.json pointer is never one); the subfolder
    // files fail the fake gate and carry no settled verdict.
    assert.deepEqual(paths(out.admitted), [
      "Loose note.txt",
      "Scan.pdf",
      "3. CORRESPONDENCE\\letter.pdf",
      "3. CORRESPONDENCE\\OC\\2026\\inner.MSG",
    ]);
    assert.deepEqual(out.errors, []);
    assert.deepEqual(out.deferred, []);
    const root = out.admitted[0];
    assert.equal(root.location, "root");
    assert.equal(root.admitted_by, "root");
    assert.equal(root.name, null);
    assert.equal(root.folder_type, null);
    assert.equal(root.hash, h("loose"));
    const sub = out.admitted[2];
    assert.deepEqual([sub.location, sub.folder_type, sub.admitted_by, sub.name.verdict], ["subfolder", "Correspondence", "name", "fails"]);
    assert.equal(sub.ingest.verdict, "ingested");
    assert.equal(sub.ingest.path, undefined);
  } finally {
    m.cleanup();
  }
});

test("name verdicts: Law citation and AI-memo forms, a Law flag token, Discovery's listed-document form and legacy bare number", async () => {
  const m = setup({
    "6. LAW/2019 BCSC 1101 Sahyoun v Lawson.pdf": "1",
    "6. LAW/2026-03-01 Westlaw limitation periods.pdf": "2",
    "6. LAW/1994 CanLII 117 RJR-MacDonald Inc v Canada (AG).pdf": "3",
    "6. LAW/Smith decision.pdf": "4",
    "7. DISCOVERY/P1.57 - 2025-03-18 LF MPP re payout.pdf": "5",
    "7. DISCOVERY/D2.03 - photo of label.pdf": "6",
    "7. DISCOVERY/D1.1.pdf": "7",
    "7. DISCOVERY/Ashby0067.pdf": "8",
  });
  try {
    const calls = [];
    const out = await candidates(args(m), { gate: fakeGate(calls), lookup: fakeLookup() });
    // One gate spawn: the Law group carries its flag tokens; Discovery's tails ride along.
    assert.equal(calls.length, 1);
    const law = calls[0].find((g) => g.flag_tokens.length);
    assert.deepEqual(law.flag_tokens, ["Ltd", "Inc"]);
    const plain = calls[0].find((g) => !g.flag_tokens.length);
    assert.ok(plain.names.includes("2025-03-18 LF MPP re payout.pdf"));
    // Everything is ingested, so only names that do not conform are admitted.
    const byPath = Object.fromEntries(out.admitted.map((r) => [r.path, r.name]));
    assert.deepEqual(Object.keys(byPath).sort(), [
      "6. LAW\\1994 CanLII 117 RJR-MacDonald Inc v Canada (AG).pdf",
      "6. LAW\\Smith decision.pdf",
      "7. DISCOVERY\\Ashby0067.pdf",
      "7. DISCOVERY\\D2.03 - photo of label.pdf",
    ]);
    assert.deepEqual(byPath["6. LAW\\1994 CanLII 117 RJR-MacDonald Inc v Canada (AG).pdf"], {
      verdict: "fails",
      reason: "flag token raised: Inc",
      flags: ["Inc"],
    });
    assert.equal(byPath["6. LAW\\Smith decision.pdf"].verdict, "second_pass_required");
    assert.equal(byPath["7. DISCOVERY\\Ashby0067.pdf"].verdict, "second_pass_required");
    assert.equal(byPath["7. DISCOVERY\\D2.03 - photo of label.pdf"].verdict, "second_pass_required");
  } finally {
    m.cleanup();
  }
});

test("admission: the name arm yields to a settled verdict unless forced; the ingest arm yields to a not_ingested hash match, forced or not", async () => {
  const files = {
    "3. CORRESPONDENCE/settled.pdf": "1",
    "3. CORRESPONDENCE/2026-01-01 LF ok.pdf": "2",
    "3. CORRESPONDENCE/2026-01-02 LF unread.pdf": "3",
    "3. CORRESPONDENCE/2026-01-03 LF filed unread.pdf": "4",
    "3. CORRESPONDENCE/both.pdf": "5",
  };
  const state = {
    "3. CORRESPONDENCE\\settled.pdf": { review: { reviewed: true, outcome: "renamed", matched_on: "hash" } },
    "3. CORRESPONDENCE\\2026-01-02 LF unread.pdf": { verdict: "none" },
    "3. CORRESPONDENCE\\2026-01-03 LF filed unread.pdf": { verdict: "failed", review: { reviewed: true, outcome: "not_ingested", not_ingested: true } },
    "3. CORRESPONDENCE\\both.pdf": { verdict: "partial" },
  };
  const m = setup(files);
  try {
    const plain = await candidates(args(m), { gate: fakeGate(), lookup: fakeLookup(state) });
    assert.deepEqual(
      plain.admitted.map((r) => [r.path, r.admitted_by]),
      [
        ["3. CORRESPONDENCE\\2026-01-02 LF unread.pdf", "ingest"],
        ["3. CORRESPONDENCE\\both.pdf", "both"],
      ]
    );
    const forced = await candidates(args(m, { force: true }), { gate: fakeGate(), lookup: fakeLookup(state) });
    assert.deepEqual(
      forced.admitted.map((r) => [r.path, r.admitted_by]),
      [
        ["3. CORRESPONDENCE\\2026-01-02 LF unread.pdf", "ingest"],
        ["3. CORRESPONDENCE\\both.pdf", "both"],
        ["3. CORRESPONDENCE\\settled.pdf", "name"],
      ]
    );
    assert.deepEqual(forced.admitted[2].review.outcome, "renamed");
  } finally {
    m.cleanup();
  }
});

test("arguments: a subfolder drops root files, a file list keeps only its files, finished files are left out before any lookup", async () => {
  const m = setup({
    "Root.pdf": "r",
    "3. CORRESPONDENCE/a.pdf": "a",
    "3. CORRESPONDENCE/OC/b.pdf": "b",
    "6. LAW/c.pdf": "c",
  });
  try {
    const sub = await candidates(args(m, { subfolder: "3. CORRESPONDENCE" }), { gate: fakeGate(), lookup: fakeLookup() });
    assert.deepEqual(paths(sub.admitted), ["3. CORRESPONDENCE\\a.pdf", "3. CORRESPONDENCE\\OC\\b.pdf"]);
    const list = await candidates(args(m, { files: ["Root.pdf", "6. LAW/c.pdf"] }), { gate: fakeGate(), lookup: fakeLookup() });
    assert.deepEqual(paths(list.admitted), ["Root.pdf", "6. LAW\\c.pdf"]);
    const seen = [];
    const done = await candidates(args(m, { finished: ["3. CORRESPONDENCE\\a.pdf"] }), { gate: fakeGate(), lookup: fakeLookup({}, seen) });
    assert.ok(!paths(done.admitted).includes("3. CORRESPONDENCE\\a.pdf"));
    assert.ok(!seen[0].files.some((f) => f.path === "3. CORRESPONDENCE\\a.pdf"));
  } finally {
    m.cleanup();
  }
});

test("order and cap: a file the previous page offered and did not approve rotates to the end; deferred rows carry path and hash only", async () => {
  const files = Object.fromEntries(Array.from({ length: 55 }, (_, i) => [`Root ${String(i).padStart(2, "0")}.pdf`, `root ${i}`]));
  const m = setup(files);
  try {
    mkdirSync(runDir(m, RUN_A), { recursive: true });
    const offered = {
      row_id: "r001",
      current_path: "Root 00.pdf",
      hash: h("root 0"),
      ingest_outcome: "none",
      source_ids: [],
      section: "offered",
      action: { kind: "stuck", reason: "no proposal" },
      name_checks: [],
      notes: [],
    };
    writeFileSync(join(runDir(m, RUN_A), "proposal.json"), JSON.stringify({ ...proposalFor(m, RUN_A, []), rows: [offered] }));
    const out = await candidates(args(m), { gate: fakeGate(), lookup: fakeLookup() });
    assert.equal(out.previous_run, RUN_A);
    assert.equal(out.admitted.length, 50);
    assert.equal(out.admitted[0].path, "Root 01.pdf");
    assert.deepEqual(out.deferred, [
      { path: "Root 51.pdf", hash: h("root 51") },
      { path: "Root 52.pdf", hash: h("root 52") },
      { path: "Root 53.pdf", hash: h("root 53") },
      { path: "Root 54.pdf", hash: h("root 54") },
      { path: "Root 00.pdf", hash: h("root 0") },
    ]);
    assert.ok(out.admitted.every((r) => r.rotated === false));
  } finally {
    m.cleanup();
  }
});

test("no hash of a file that is not admitted appears anywhere in the output", async () => {
  const m = setup({
    "3. CORRESPONDENCE/2026-01-01 LF kept.pdf": "kept",
    "3. CORRESPONDENCE/odd name.pdf": "odd",
    "Root.pdf": "root",
  });
  try {
    const out = await candidates(args(m), { gate: fakeGate(), lookup: fakeLookup() });
    assert.deepEqual(paths(out.admitted), ["Root.pdf", "3. CORRESPONDENCE\\odd name.pdf"]);
    assert.ok(!JSON.stringify(out).includes(h("kept")));
  } finally {
    m.cleanup();
  }
});

test("a swept folder that is not on disk is refused", async () => {
  const m = setup({});
  try {
    await assert.rejects(
      candidates(args(m, { swept_folders: [{ path: "5. COURT FILE", folder_type: "Court File" }] }), { gate: fakeGate(), lookup: fakeLookup() }),
      (err) => err.code === "invalid_argument"
    );
  } finally {
    m.cleanup();
  }
});
