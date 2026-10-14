import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { codeOf, matterFixture, proposalFor, row, runDir, writeApproval } from "./helpers/housekeeping-fixture.mjs";

const { mintRunId, readProposal, RUN_ID_RE } = await import("../build/housekeeping/run-dir.js");
const { journalAppend, newRun, writeRunFile } = await import("../build/housekeeping/run-files.js");
const { waitApproval } = await import("../build/housekeeping/wait.js");
const { validateProposal: validate } = await import("../build/housekeeping/proposal.js");

const LETTER = "3. CORRESPONDENCE/2026-01-05 LF Smith re Settlement.pdf";

/** A run under an explicit id (run order is by id), holding a valid proposal. */
function withProposal(m, run_id = "20260924-100000-aaaa", rows = undefined) {
  mkdirSync(runDir(m, run_id), { recursive: true });
  writeRunFile(m.root, run_id, "proposal.json", JSON.stringify(proposalFor(m, run_id, rows ?? [row(m, LETTER, { action: { kind: "file", name: "2026-01-05 LF Smith re Settlement.pdf", folder: "3. CORRESPONDENCE" } })])));
  return run_id;
}

/** Every folder under `dir`, every level. */
function foldersUnder(dir) {
  return readdirSync(dir, { withFileTypes: true, recursive: true }).filter((e) => e.isDirectory()).map((e) => e.name);
}

test("the run directory is created under <case-data folder>\\housekeeping\\, and nothing is created in the matter", () => {
  const m = matterFixture({}, { dirs: ["3. CORRESPONDENCE"] });
  try {
    assert.equal(existsSync(join(m.caseData, "housekeeping")), false);
    const { run_id, run_dir } = newRun(m.root);
    assert.equal(run_dir.toLowerCase(), join(m.caseData, "housekeeping", run_id).toLowerCase());
    assert.ok(existsSync(run_dir));
    assert.deepEqual(foldersUnder(m.root), ["3. CORRESPONDENCE"]);
    assert.equal(existsSync(join(m.root, "4. LAWYER BRIEF")), false);
    assert.ok(!foldersUnder(m.base).some((name) => name.toLowerCase() === "cowork"));
  } finally {
    m.cleanup();
  }
});

test("a matter whose case-data folder does not exist is refused, and no folder is created", () => {
  const m = matterFixture({}, { dirs: ["3. CORRESPONDENCE"] });
  try {
    rmSync(m.caseData, { recursive: true });
    assert.throws(() => newRun(m.root), (err) => err.code === "case_data_missing" && /\/case-data initialize/.test(err.message));
    assert.equal(codeOf(() => writeRunFile(m.root, "20260924-100000-aaaa", "questions.json", "[]")), "case_data_missing");
    assert.deepEqual(readdirSync(m.base).sort(), ["Matter", "template"]);
    assert.deepEqual(foldersUnder(m.root), ["3. CORRESPONDENCE"]);
  } finally {
    m.cleanup();
  }
});

test("run ids carry milliseconds, so two runs in one second sort by time; ids without them still read", () => {
  const early = mintRunId(new Date(2026, 8, 24, 20, 40, 13, 5));
  const late = mintRunId(new Date(2026, 8, 24, 20, 40, 13, 120));
  assert.match(early, /^20260924-204013005-[0-9a-f]{4}$/);
  assert.match(late, /^20260924-204013120-[0-9a-f]{4}$/);
  assert.ok(early < late);
  for (const id of [early, late, "20260924-204013-a1b2"]) assert.match(id, RUN_ID_RE);
  assert.doesNotMatch("20260924-2040131-a1b2", RUN_ID_RE);
});

test("new_run mints a fixed-width run id and creates its directory", () => {
  const m = matterFixture();
  try {
    const { run_id, run_dir } = newRun(m.root);
    assert.match(run_id, RUN_ID_RE);
    assert.equal(run_dir.toLowerCase(), runDir(m, run_id).toLowerCase());
    assert.ok(existsSync(run_dir));
    assert.equal(codeOf(() => newRun(join(m.root, "3. CORRESPONDENCE"))), "invalid_root");
  } finally {
    m.cleanup();
  }
});

test("write_run_file writes only the three run files; refuses reserved and other names, unknown runs, and a run directory reached through a junction", () => {
  const m = matterFixture({ [LETTER]: "letter" });
  const outside = mkdtempSync(join(tmpdir(), "coclerk-hk-outside-"));
  try {
    const { run_id } = newRun(m.root);
    assert.equal(codeOf(() => writeRunFile(m.root, run_id, "approval.json", "{}")), "reserved_file");
    assert.equal(codeOf(() => writeRunFile(m.root, run_id, "APPLIED.JSONL", "")), "reserved_file");
    assert.equal(codeOf(() => writeRunFile(m.root, run_id, "..\\escape.json", "{}")), "invalid_filename");
    assert.equal(codeOf(() => writeRunFile(m.root, run_id, "sub/x.json", "{}")), "invalid_filename");
    assert.equal(codeOf(() => writeRunFile(m.root, run_id, ".hidden", "{}")), "invalid_filename");
    for (const other of ["notes.md", "hashes.json", "proposal.json.bak"]) {
      assert.equal(codeOf(() => writeRunFile(m.root, run_id, other, "x")), "invalid_filename", other);
    }
    assert.equal(codeOf(() => writeRunFile(m.root, "20990101-000000-abcd", "questions.json", "x")), "run_not_found");
    assert.equal(codeOf(() => writeRunFile(m.root, "..\\..", "questions.json", "x")), "invalid_run_id");

    for (const name of ["questions.json", "rule_gaps.json"]) {
      const written = writeRunFile(m.root, run_id, name, "[]");
      assert.equal(readFileSync(written.path, "utf-8"), "[]");
    }

    // A junction planted at housekeeping carries every write outside the case-data folder: refused, nothing created.
    const junctioned = matterFixture();
    try {
      symlinkSync(outside, join(junctioned.caseData, "housekeeping"), "junction");
      assert.equal(codeOf(() => newRun(junctioned.root)), "path_out_of_scope");
      assert.deepEqual(readdirSync(outside), []);
    } finally {
      junctioned.cleanup();
    }
  } finally {
    m.cleanup();
    rmSync(outside, { recursive: true, force: true });
  }
});

test("proposal.json that does not parse or validate is refused and nothing is written", () => {
  const m = matterFixture({ [LETTER]: "letter" });
  try {
    const { run_id } = newRun(m.root);
    const path = join(runDir(m, run_id), "proposal.json");
    assert.equal(codeOf(() => writeRunFile(m.root, run_id, "proposal.json", "{not json")), "invalid_proposal");
    const good = proposalFor(m, run_id, [row(m, LETTER, { action: { kind: "file", name: "2026-01-05 LF Smith re Settlement.pdf", folder: "3. CORRESPONDENCE" } })]);
    const broken = [
      { ...good, run_id: "20990101-000000-abcd" },
      { ...good, matter_root: m.base },
      { ...good, rows: [{ ...good.rows[0], section: "care" }] },
      { ...good, rows: [{ ...good.rows[0], hash: "abc" }] },
      { ...good, rows: [{ ...good.rows[0], current_path: "..\\x.pdf" }] },
      { ...good, rows: [good.rows[0], good.rows[0]] },
      { ...good, rows: [{ ...good.rows[0], action: undefined }] },
      { ...good, rows: [{ ...good.rows[0], section: "ingested_only" }] },
      { ...good, rows: [{ ...good.rows[0], action: { kind: "keep" } }] },
      { ...good, rows: [{ ...good.rows[0], action: { kind: "stuck" } }] },
      { ...good, rows: [{ ...good.rows[0], action: { kind: "unreadable" } }] },
      { ...good, rows: [{ ...good.rows[0], action: { kind: "duplicate" } }] },
      { ...good, rows: [{ ...good.rows[0], action: { kind: "draft" } }] },
      { ...good, rows: [{ ...good.rows[0], action: { kind: "move", folder: "3. CORRESPONDENCE", matter: "L998" } }] },
      { ...good, draft_folder: null, rows: [{ ...good.rows[0], action: { kind: "draft" } }] },
      { ...good, rows: [{ ...good.rows[0], action: { ...good.rows[0].action, name: "a\\b.pdf" } }] },
      { ...good, rows: [{ ...good.rows[0], action: { ...good.rows[0].action, folder: "Jane Smith", create_folder: true } }] },
      { ...good, rows: [{ ...good.rows[0], action: { ...good.rows[0].action, final: true, file_no_ingest: true } }] },
      { ...good, rows: [{ ...good.rows[0], action: { ...good.rows[0].action, folder: "6. LAW", file_no_ingest: true } }] },
      { ...good, rule_gaps: [{ file_name: "x.pdf" }] },
    ];
    for (const proposal of broken) {
      assert.equal(codeOf(() => writeRunFile(m.root, run_id, "proposal.json", JSON.stringify(proposal))), "invalid_proposal");
    }
    assert.equal(existsSync(path), false);

    // Past the cap, the problems left out are counted, never dropped silently.
    const many = { ...good, rows: Array.from({ length: 25 }, (_, i) => ({ ...good.rows[0], row_id: "r" + i, current_path: `Scan_${i}.pdf`, hash: "abc" })) };
    assert.throws(
      () => writeRunFile(m.root, run_id, "proposal.json", JSON.stringify(many)),
      (err) => err.code === "invalid_proposal" && /; and 5 more problems$/.test(err.message)
    );

    // A rule gap carries its own run date and matter root (§B13).
    const gap = { run_date: "2026-09-24", matter_root: m.root, file_name: "x.pdf", trigger: "t", current_rule: "c", missing: "m", reference_file: "r" };
    for (const key of ["run_date", "matter_root"]) {
      const { [key]: _, ...without } = gap;
      assert.equal(codeOf(() => writeRunFile(m.root, run_id, "proposal.json", JSON.stringify({ ...good, rule_gaps: [without] }))), "invalid_proposal", key);
    }
    assert.equal(existsSync(path), false);
    writeRunFile(m.root, run_id, "proposal.json", JSON.stringify({ ...good, rule_gaps: [gap] }));
    assert.equal(existsSync(path), true);
  } finally {
    m.cleanup();
  }
});

test("a folder or name ending in a dot or a space, or otherwise not a Windows name, is refused, naming the row and the segment", () => {
  const m = matterFixture({ [LETTER]: "letter" });
  try {
    const { run_id } = newRun(m.root);
    const NAME = "2026-01-05 LF Smith re Settlement.pdf";
    const withAction = (action) => proposalFor(m, run_id, [row(m, LETTER, { row_id: "r027", action })]);
    const refusals = [
      [{ kind: "file", name: NAME, folder: "7. DISCOVERY\\LOD Plaintiff\\Plaintiff Holdings Inc.", create_folder: true }, "Plaintiff Holdings Inc."],
      [{ kind: "move", folder: "7. DISCOVERY\\LOD Plaintiff\\Jane Smith \\Sub" }, "Jane Smith "],
      [{ kind: "file", name: NAME, folder: "7. DISCOVERY\\NUL" }, "NUL"],
      [{ kind: "file", name: NAME, folder: "7. DISCOVERY\\com1.txt" }, "com1.txt"],
      [{ kind: "file", name: NAME, folder: "7. DISCOVERY\\A|B" }, "A|B"],
      [{ kind: "rename", name: "2026-01-05 LF Smith re Settlement." }, "2026-01-05 LF Smith re Settlement."],
      [{ kind: "rename", name: "2026-01-05 LF Smith re Settlement.pdf " }, "2026-01-05 LF Smith re Settlement.pdf "],
    ];
    for (const [action, segment] of refusals) {
      assert.throws(
        () => writeRunFile(m.root, run_id, "proposal.json", JSON.stringify(withAction(action))),
        (err) => err.code === "invalid_proposal" && err.message.includes("r027") && err.message.includes(JSON.stringify(segment)),
        JSON.stringify(action)
      );
    }
    assert.equal(existsSync(join(runDir(m, run_id), "proposal.json")), false);
    writeRunFile(m.root, run_id, "proposal.json", JSON.stringify(withAction({ kind: "file", name: NAME, folder: "7. DISCOVERY\\LOD Plaintiff\\Plaintiff Holdings Inc", create_folder: true })));
  } finally {
    m.cleanup();
  }
});

test("a twin that is itself a row on the page must carry that row's id", () => {
  const m = matterFixture({ "Scan_0001.pdf": "scan", "Scan_0002.pdf": "scan", "Scan_0003.pdf": "other" });
  try {
    const { run_id } = newRun(m.root);
    const rows = (twin) => [
      row(m, "Scan_0001.pdf", { row_id: "r027", action: { kind: "file", name: "2026-01-05 LF Smith re Scan.pdf", folder: "3. CORRESPONDENCE" } }),
      row(m, "Scan_0003.pdf", { row_id: "r029", action: { kind: "stuck", reason: "no naming rule" } }),
      row(m, "Scan_0002.pdf", { row_id: "r028", ingest_outcome: "none", action: { kind: "duplicate" }, twin }),
    ];
    const write = (twin) => writeRunFile(m.root, run_id, "proposal.json", JSON.stringify(proposalFor(m, run_id, rows(twin))));
    for (const [twin, pattern] of [
      [{ path: "Scan_0001.pdf", ingested: true }, /r028.*twin\.row_id.*r027/],
      [{ path: "scan_0001.PDF", ingested: true }, /r028.*twin\.row_id.*r027/],
      [{ path: "Scan_0001.pdf", row_id: "r029", ingested: true }, /r028.*twin\.row_id.*r027/],
    ]) {
      assert.throws(() => write(twin), (err) => err.code === "invalid_proposal" && pattern.test(err.message), JSON.stringify(twin));
    }
    // A twin that is not a row needs no row id.
    const outside = proposalFor(m, run_id, [rows({ path: "3. CORRESPONDENCE\\filed.pdf", ingested: true })[2]]);
    assert.deepEqual(validate(outside, run_id, m.root).filter((p) => /twin/.test(p)), []);
    write({ path: "Scan_0001.pdf", row_id: "r027", ingested: true });
  } finally {
    m.cleanup();
  }
});

test("two rows that name the same file are refused, naming both row ids", () => {
  const m = matterFixture({ "Scan_0001.pdf": "scan", "Scan_0002.pdf": "scan", [LETTER]: "letter" });
  try {
    const run_id = "20260924-100000-aaaa";
    const first = row(m, "Scan_0001.pdf", { row_id: "r001" });
    const letter = row(m, LETTER, { row_id: "r003" });
    const repeated = (p) => validate(p, run_id, m.root).filter((problem) => /same file/.test(problem));
    for (const [rows, label] of [
      [[first, row(m, "Scan_0001.pdf", { row_id: "r002" })], "identical"],
      [[first, row(m, "Scan_0001.pdf", { row_id: "r002", current_path: "scan_0001.PDF" })], "case"],
      [[letter, row(m, LETTER, { row_id: "r004", current_path: LETTER })], "separator"],
    ]) {
      const problems = repeated(proposalFor(m, run_id, rows));
      assert.equal(problems.length, 1, label);
      assert.match(problems[0], new RegExp(`${rows[0].row_id}.*${rows[1].row_id}`), label);
    }
    // Distinct paths validate as before, and a twin naming another row's path is not a repeat.
    const twin = row(m, "Scan_0002.pdf", { row_id: "r002", ingest_outcome: "none", action: { kind: "duplicate" }, twin: { path: "Scan_0001.pdf", row_id: "r001", ingested: true } });
    assert.deepEqual(validate(proposalFor(m, run_id, [first, twin, letter]), run_id, m.root), []);
  } finally {
    m.cleanup();
  }
});

test("proposal.json is write-once: the same content is a no-op, other content is refused", () => {
  const m = matterFixture({ [LETTER]: "letter" });
  try {
    const { run_id } = newRun(m.root);
    const proposal = proposalFor(m, run_id, [row(m, LETTER, { action: { kind: "file", name: "2026-01-05 LF Smith re Settlement.pdf", folder: "3. CORRESPONDENCE" } })]);
    const first = writeRunFile(m.root, run_id, "proposal.json", JSON.stringify(proposal));
    assert.equal(first.unchanged, undefined);
    assert.equal(writeRunFile(m.root, run_id, "proposal.json", JSON.stringify(proposal)).unchanged, true);
    const changed = { ...proposal, header: { ...proposal.header, open_in_word: ["x.docx"] } };
    assert.equal(codeOf(() => writeRunFile(m.root, run_id, "proposal.json", JSON.stringify(changed))), "proposal_exists");
    assert.deepEqual(JSON.parse(readFileSync(first.path, "utf-8")), proposal);
  } finally {
    m.cleanup();
  }
});

test("a half-written proposal.json reads as no proposal", () => {
  const m = matterFixture({ [LETTER]: "letter" });
  try {
    const { run_id, run_dir } = newRun(m.root);
    writeFileSync(join(run_dir, "proposal.json"), '{"run_id": "' + run_id + '", "rows": [');
    const read = readProposal(run_dir, run_id, m.root);
    assert.equal(read.proposal, null);
    assert.match(read.problem, /does not parse/);
  } finally {
    m.cleanup();
  }
});

test("journal_append refuses unknown rows, unapproved runs and a second line; tolerates a torn line", () => {
  const m = matterFixture({ [LETTER]: "letter" });
  try {
    const runId = withProposal(m);
    const rowId = "2026-01-05_LF_Smith_re_Settlement.pdf";
    assert.equal(codeOf(() => journalAppend(m.root, runId, rowId, "done")), "not_approved");
    writeFileSync(join(runDir(m, runId), "approval.json"), "{truncated");
    assert.equal(codeOf(() => journalAppend(m.root, runId, rowId, "done")), "approval_corrupt");
    writeApproval(m, runId, [{ row_id: rowId, approve: true }]);
    assert.equal(codeOf(() => journalAppend(m.root, runId, "nope", "done")), "unknown_row");
    assert.equal(codeOf(() => journalAppend(m.root, runId, rowId, "maybe")), "invalid_argument");

    const journal = join(runDir(m, runId), "applied.jsonl");
    writeFileSync(journal, '{"row_id": "torn", "outc');
    const { line } = journalAppend(m.root, runId, rowId, "failed", "changed since approval");
    assert.deepEqual(line, { row_id: rowId, outcome: "failed", reason: "changed since approval" });
    const lines = readFileSync(journal, "utf-8").split("\n").filter(Boolean);
    assert.deepEqual(JSON.parse(lines[1]), line);
    assert.equal(codeOf(() => journalAppend(m.root, runId, rowId, "done")), "already_journalled");
  } finally {
    m.cleanup();
  }
});

test("wait_approval: pending on timeout, approved at once, corrupt when approval.json is unreadable, invalidated by any newer run", async () => {
  const m = matterFixture({ [LETTER]: "letter" });
  try {
    const env = { ...m.env, COCLERK_HOUSEKEEPING_WAIT_MS: "400" };
    const runId = withProposal(m);
    const started = Date.now();
    const pending = await waitApproval(m.root, runId, env);
    assert.equal(pending.status, "pending");
    assert.ok(Date.now() - started >= 380);

    const approvalPath = join(runDir(m, runId), "approval.json");
    writeFileSync(approvalPath, '{"run_id": "' + runId + '", "rows": [');
    const corrupt = await waitApproval(m.root, runId, env);
    assert.equal(corrupt.status, "corrupt");
    assert.equal(corrupt.file.toLowerCase(), approvalPath.toLowerCase());
    assert.match(corrupt.problem, /does not parse/);
    rmSync(approvalPath);

    // A newer run invalidates this one as soon as its directory exists, proposal or not (spec A4).
    const later = "20260924-110000-0000";
    mkdirSync(runDir(m, later), { recursive: true });
    const invalidated = await waitApproval(m.root, runId, env);
    assert.deepEqual(invalidated, { status: "invalidated", run_id: runId, newer_run: later });

    writeApproval(m, runId, [{ row_id: "2026-01-05_LF_Smith_re_Settlement.pdf", approve: true }]);
    const approved = await waitApproval(m.root, runId, { ...env, COCLERK_HOUSEKEEPING_WAIT_MS: "60000" });
    assert.equal(approved.status, "approved");
    assert.equal(approved.rows, 1);

    await assert.rejects(waitApproval(m.root, runId, { ...env, COCLERK_HOUSEKEEPING_WAIT_MS: "soon" }), /positive number/);
  } finally {
    m.cleanup();
  }
});

test("the nine tools are registered and dispatch through callTool", async () => {
  const { callTool } = await import("../build/dispatch.js");
  const { buildToolDefinitions } = await import("../build/schema-gen.js");
  const names = buildToolDefinitions().map((d) => d.name);
  for (const name of ["preflight", "new_run", "write_run_file", "serve_page", "wait_approval", "resolve", "reconcile", "journal_append"]) {
    assert.ok(names.includes("housekeeping__" + name), name);
  }
  assert.ok(names.includes("file_ops__move"));
  // Serving enables the Approve write, so the tool is not annotated read-only.
  const serve = buildToolDefinitions().find((d) => d.name === "housekeeping__serve_page");
  assert.notEqual(serve.annotations.readOnlyHint, true);

  const m = matterFixture({ [LETTER]: "letter" });
  try {
    const { run_id } = await callTool({}, "housekeeping__new_run", { matter_root: m.root });
    assert.match(run_id, RUN_ID_RE);
    await assert.rejects(callTool({}, "housekeeping__journal_append", { matter_root: m.root, run_id, row_id: "x", outcome: "maybe" }), /must be one of: done, failed/);
    await assert.rejects(
      callTool({}, "file_ops__move", { matter_root: m.root, source: m.at(LETTER), destination: m.at(LETTER), create_folders: "3. CORRESPONDENCE" }),
      /create_folders must be an array of strings/
    );
  } finally {
    m.cleanup();
  }
});
