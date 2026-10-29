// Plan 2026-10-28 §2d: with run_id and row_id, file_ops__move, file_ops__move_from_downloads and
// file_ops__trash act only on a row that run's approval.json approves, while the source file still
// holds the hash proposal.json recorded. Without them, each tool behaves as before.

import assert from "node:assert/strict";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { matterFixture, proposalFor, row, runDir, writeApproval } from "./helpers/housekeeping-fixture.mjs";

const { writeRunFile } = await import("../build/housekeeping/run-files.js");
const { callFileManagerTool } = await import("../build/file-manager-dispatch.js");

const RUN = "20260924-100000-aaaa";
const A = "a letter.pdf";
const B = "b letter.pdf";
const move = { action: { kind: "move", folder: "3. CORRESPONDENCE" } };

/** A matter with two root files proposed as rows `a` and `b`; `approved` names the approved rows. */
function setUp(approved = ["a"], files = {}) {
  const m = matterFixture({ [A]: "alpha", [B]: "bravo", ...files });
  mkdirSync(runDir(m, RUN), { recursive: true });
  const rows = [row(m, A, { row_id: "a", ...move }), row(m, B, { row_id: "b", ...move })];
  writeRunFile(m.root, RUN, "proposal.json", JSON.stringify(proposalFor(m, RUN, rows)));
  if (approved !== null) writeApproval(m, RUN, approved.map((row_id) => ({ row_id, approve: true })));
  return m;
}

const moveArgs = (m, name, extra = {}) => ({
  matter_root: m.root,
  source: m.at(name),
  destination: m.at(`3. CORRESPONDENCE/${name}`),
  ...extra,
});

async function refusedWith(promise, code) {
  await assert.rejects(promise, (err) => {
    assert.equal(err.code, code, err.message);
    return true;
  });
}

test("file_ops__move with run_id refuses a row the approval does not approve, touching nothing", async () => {
  const m = setUp(["a"]);
  try {
    await refusedWith(callFileManagerTool("file_ops__move", moveArgs(m, B, { run_id: RUN, row_id: "b" })), "not_approved");
    assert.equal(readFileSync(m.at(B), "utf-8"), "bravo");
    assert.equal(existsSync(m.at(`3. CORRESPONDENCE/${B}`)), false);
  } finally {
    m.cleanup();
  }
});

test("file_ops__move with run_id refuses when the run has no approval.json", async () => {
  const m = setUp(null);
  try {
    await refusedWith(callFileManagerTool("file_ops__move", moveArgs(m, A, { run_id: RUN, row_id: "a" })), "not_approved");
    assert.equal(readFileSync(m.at(A), "utf-8"), "alpha");
  } finally {
    m.cleanup();
  }
});

test("file_ops__move with run_id refuses a row whose source changed after approval", async () => {
  const m = setUp(["a"]);
  try {
    appendFileSync(m.at(A), " changed");
    await refusedWith(callFileManagerTool("file_ops__move", moveArgs(m, A, { run_id: RUN, row_id: "a" })), "changed_since_approval");
    assert.equal(readFileSync(m.at(A), "utf-8"), "alpha changed");
    assert.equal(existsSync(m.at(`3. CORRESPONDENCE/${A}`)), false);
  } finally {
    m.cleanup();
  }
});

test("file_ops__move with run_id refuses a row that is not in the proposal", async () => {
  const m = setUp(["a"]);
  try {
    await refusedWith(callFileManagerTool("file_ops__move", moveArgs(m, A, { run_id: RUN, row_id: "zz" })), "unknown_row");
    assert.equal(readFileSync(m.at(A), "utf-8"), "alpha");
  } finally {
    m.cleanup();
  }
});

test("file_ops__move takes run_id and row_id together or not at all", async () => {
  const m = setUp(["a"]);
  try {
    await refusedWith(callFileManagerTool("file_ops__move", moveArgs(m, A, { run_id: RUN })), "invalid_argument");
    await refusedWith(callFileManagerTool("file_ops__move", moveArgs(m, A, { row_id: "a" })), "invalid_argument");
    assert.equal(readFileSync(m.at(A), "utf-8"), "alpha");
  } finally {
    m.cleanup();
  }
});

test("file_ops__move with run_id moves an approved, unchanged row", async () => {
  const m = setUp(["a"]);
  try {
    const result = await callFileManagerTool("file_ops__move", moveArgs(m, A, { run_id: RUN, row_id: "a" }));
    assert.equal(result.moved_to, m.at(`3. CORRESPONDENCE/${A}`));
    assert.equal(readFileSync(m.at(`3. CORRESPONDENCE/${A}`), "utf-8"), "alpha");
    assert.equal(existsSync(m.at(A)), false);
  } finally {
    m.cleanup();
  }
});

test("file_ops__move with no run_id moves as before, approval or not", async () => {
  const m = setUp(["a"]);
  try {
    const result = await callFileManagerTool("file_ops__move", moveArgs(m, B));
    assert.equal(result.moved_to, m.at(`3. CORRESPONDENCE/${B}`));
    assert.equal(existsSync(m.at(B)), false);
  } finally {
    m.cleanup();
  }
});

test("file_ops__trash with run_id trashes only an approved, unchanged row", async () => {
  const m = setUp(["a"]);
  try {
    await refusedWith(callFileManagerTool("file_ops__trash", { path: m.at(B), run_id: RUN, row_id: "b" }), "not_approved");
    assert.equal(readFileSync(m.at(B), "utf-8"), "bravo");
    const result = await callFileManagerTool("file_ops__trash", { path: m.at(A), run_id: RUN, row_id: "a" });
    assert.equal(result.moved_to, m.at(`TRASH/${A}`));
    assert.equal(existsSync(m.at(A)), false);
  } finally {
    m.cleanup();
  }
});

test("file_ops__trash with run_id refuses a row whose source changed after approval", async () => {
  const m = setUp(["a"]);
  try {
    writeFileSync(m.at(A), "rewritten");
    await refusedWith(callFileManagerTool("file_ops__trash", { path: m.at(A), run_id: RUN, row_id: "a" }), "changed_since_approval");
    assert.equal(readFileSync(m.at(A), "utf-8"), "rewritten");
  } finally {
    m.cleanup();
  }
});

test("file_ops__trash with no run_id trashes as before", async () => {
  const m = setUp(["a"]);
  try {
    const result = await callFileManagerTool("file_ops__trash", { path: m.at(B) });
    assert.equal(result.moved_to, m.at(`TRASH/${B}`));
  } finally {
    m.cleanup();
  }
});

test("file_ops__move_from_downloads with run_id checks the download against the approved row", async () => {
  const m = setUp(["a"]);
  const dl = join(m.base, "Downloads");
  mkdirSync(dl);
  writeFileSync(join(dl, "same.pdf"), "alpha");
  writeFileSync(join(dl, "other.pdf"), "something else");
  const saved = process.env.COCLERK_DOWNLOADS_DIR;
  process.env.COCLERK_DOWNLOADS_DIR = dl;
  const args = (name, extra) => ({ matter_root: m.root, source_filename: name, destination: m.at(`3. CORRESPONDENCE/${name}`), ...extra });
  try {
    await refusedWith(callFileManagerTool("file_ops__move_from_downloads", args("same.pdf", { run_id: RUN, row_id: "b" })), "not_approved");
    await refusedWith(callFileManagerTool("file_ops__move_from_downloads", args("other.pdf", { run_id: RUN, row_id: "a" })), "changed_since_approval");
    assert.equal(existsSync(join(dl, "other.pdf")), true);
    const approved = await callFileManagerTool("file_ops__move_from_downloads", args("same.pdf", { run_id: RUN, row_id: "a" }));
    assert.equal(approved.moved_to, m.at("3. CORRESPONDENCE/same.pdf"));
    const plain = await callFileManagerTool("file_ops__move_from_downloads", args("other.pdf"));
    assert.equal(plain.moved_to, m.at("3. CORRESPONDENCE/other.pdf"));
  } finally {
    if (saved === undefined) delete process.env.COCLERK_DOWNLOADS_DIR;
    else process.env.COCLERK_DOWNLOADS_DIR = saved;
    m.cleanup();
  }
});
