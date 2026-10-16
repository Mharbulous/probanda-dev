import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { matterFixture, proposalFor, row, runDir, writeApproval } from "./helpers/housekeeping-fixture.mjs";

const { writeRunFile } = await import("../build/housekeeping/run-files.js");
const { resolveRun, templateRoot } = await import("../build/housekeeping/resolve.js");
const { fileNamingSkillDir, runNameGate } = await import("../build/housekeeping/name-gate.js");

const RUN = "20260924-100000-aaaa";
const GOOD = "2026-01-05 LF Smith re Settlement.pdf";

function setUp(files, rows, approvals, extra) {
  const m = matterFixture(files);
  mkdirSync(runDir(m, RUN), { recursive: true });
  writeRunFile(m.root, RUN, "proposal.json", JSON.stringify(proposalFor(m, RUN, rows(m), extra)));
  writeApproval(m, RUN, approvals);
  return m;
}

async function resolved(m, env = m.env) {
  const out = await resolveRun(m.root, RUN, env);
  return Object.fromEntries(out.rows.map((r) => [r.row_id, r]));
}

const file = (name, folder = "3. CORRESPONDENCE", extra = {}) => ({ action: { kind: "file", name, folder, ...extra } });

test("resolve names the kind of every row the approval page can produce (spec §B7.5, §B9.2)", async () => {
  const files = {
    "root letter.pdf": "a",
    "2026-01-06 LF Smith re Costs.pdf": "b",
    "3. CORRESPONDENCE/inplace.pdf": "c",
    "question.pdf": "e",
    "draft.docx": "f",
    "photo.png": "g",
    "unchanged.docx": "h",
    "6. LAW/Smith v Jones 2020 BCSC 1 (1).pdf": "i",
    "failed.pdf": "j",
    "brown letter.pdf": "k",
    "bill of costs.pdf": "l",
    "unsure.pdf": "m",
    "new folder.pdf": "n",
    "copy.pdf": "twin",
    "3. CORRESPONDENCE/2025-12-01 LF Smith re Offer.pdf": "twin",
  };
  const rows = (m) => [
    row(m, "root letter.pdf", { row_id: "file", ...file(GOOD) }),
    row(m, "2026-01-06 LF Smith re Costs.pdf", { row_id: "move", action: { kind: "move", folder: "3. CORRESPONDENCE" } }),
    row(m, "3. CORRESPONDENCE/inplace.pdf", { row_id: "rename", action: { kind: "rename", name: "2026-01-07 LF Smith re Costs.pdf" } }),
    row(m, "question.pdf", { row_id: "question", ingest_outcome: "stopped", ...file("2026-01-09 LF Smith re Response.pdf", undefined, { answer: "Counterclaim" }) }),
    row(m, "draft.docx", { row_id: "final", ingest_outcome: "none", ...file("2026-01-10 LF Smith re Draft.docx", undefined, { final: true }) }),
    row(m, "photo.png", { row_id: "no_ingest", ingest_outcome: "none", action: { kind: "move", folder: "3. CORRESPONDENCE", file_no_ingest: true } }),
    row(m, "unchanged.docx", { row_id: "draft", ingest_outcome: "none", action: { kind: "draft" } }),
    row(m, "6. LAW/Smith v Jones 2020 BCSC 1 (1).pdf", {
      row_id: "by_ref",
      ingest_outcome: "ingested_by_reference",
      ...file("Smith v Jones 2020 BCSC 1 (second copy).pdf", "6. LAW"),
      name_checks: [{ name: "Smith v Jones 2020 BCSC 1 (second copy).pdf", folder: "6. LAW", ok: true }],
    }),
    row(m, "failed.pdf", { row_id: "retry", ingest_outcome: "failed", action: { kind: "unreadable" } }),
    row(m, "brown letter.pdf", { row_id: "misfiled", action: { kind: "misfiled", matter: "L998" } }),
    row(m, "bill of costs.pdf", { row_id: "stuck", action: { kind: "stuck", reason: "no naming rule for a bill of costs" } }),
    row(m, "unsure.pdf", { row_id: "else", ...file("2026-01-11 LF Smith re Unsure.pdf") }),
    row(m, "new folder.pdf", { row_id: "new_folder", ...file("2026-01-12 LF Smith re Costs.pdf", "7. DISCOVERY\\LOD Plaintiff\\Jane Smith", { create_folder: true }) }),
    row(m, "copy.pdf", { row_id: "trash", ingest_outcome: "none", action: { kind: "duplicate" }, twin: { path: "3. CORRESPONDENCE\\2025-12-01 LF Smith re Offer.pdf", ingested: true } }),
  ];
  // "else" is left as is: it has no approval entry. "misfiled" and "stuck" are information only.
  const approvals = ["file", "move", "rename", "question", "final", "no_ingest", "draft", "by_ref", "retry", "new_folder", "trash"].map((row_id) => ({
    row_id,
    approve: true,
  }));
  const m = setUp(files, rows, approvals);
  try {
    const r = await resolved(m);
    const kinds = Object.fromEntries(Object.values(r).map((x) => [x.row_id, x.kind]));
    assert.deepEqual(kinds, {
      file: "rename_and_file",
      move: "rename_and_file",
      rename: "rename_in_place",
      question: "answered_question",
      final: "final",
      no_ingest: "file_no_ingest",
      draft: "draft_unchanged",
      by_ref: "ingested_by_reference",
      retry: "retry",
      new_folder: "rename_and_file",
      trash: "trash",
    });
    for (const x of Object.values(r)) assert.equal(x.ok, true, `${x.row_id}: ${x.failure}`);

    assert.equal(r.file.new_path, m.at("3. CORRESPONDENCE/" + GOOD));
    assert.equal(r.file.old_path, m.at("root letter.pdf"));
    assert.deepEqual(r.file.checks.name, { verdict: "pass" });
    assert.equal(r.move.new_path, m.at("3. CORRESPONDENCE/2026-01-06 LF Smith re Costs.pdf"));
    assert.equal(r.move.checks.name.verdict, "pass", "a kept name is still gated");
    assert.equal(r.no_ingest.checks.name.verdict, "not_checked", "a file filed without reading keeps its name ungated");
    assert.equal(r.rename.new_path, m.at("3. CORRESPONDENCE/2026-01-07 LF Smith re Costs.pdf"));
    assert.equal(r.question.answer, "Counterclaim");
    assert.equal(r.no_ingest.new_path, m.at("3. CORRESPONDENCE/photo.png"));
    assert.equal(r.draft.new_path, m.at("0. DRAFT/unchanged.docx"));
    assert.equal(r.draft.checks.name.verdict, "not_checked");
    assert.equal(r.by_ref.checks.name.verdict, "pass", "the page-build Law check stands for a citation-form name");
    assert.deepEqual(r.new_folder.folders_to_create, ["7. DISCOVERY", "7. DISCOVERY/LOD Plaintiff", "7. DISCOVERY/LOD Plaintiff/Jane Smith"].map((f) => m.at(f)));
    assert.equal(r.retry.move, false);
    assert.equal(r.retry.new_path, undefined);
    assert.equal(r.else, undefined, "a row left as is is not resolved");
    assert.equal(r.trash.move, true);
    assert.equal(r.trash.new_path, undefined);
  } finally {
    m.cleanup();
  }
});

test("a proposed name meets the gate and the folder's check at apply; a folder with alternate formats waits for the second pass", async () => {
  const files = { "t1.pdf": "1", "t2.pdf": "2", "t3.pdf": "3" };
  const rows = (m) => [
    row(m, "t1.pdf", { row_id: "t1", ...file("2026-01-05 ZZZ Smith re Proposed.pdf") }),
    row(m, "t2.pdf", { row_id: "t2", ...file("Smith v Jones 2020 BCSC 1.pdf", "6. LAW") }),
    row(m, "t3.pdf", { row_id: "t3", ...file("2026-01-05 LF Smith Ltd re Proposed.pdf", "6. LAW") }),
  ];
  const m = setUp(files, rows, ["t1", "t2", "t3"].map((row_id) => ({ row_id, approve: true })));
  try {
    const r = await resolved(m);
    assert.equal(r.t1.ok, false);
    assert.equal(r.t1.checks.name.verdict, "fail");
    assert.match(r.t1.failure, /^name check failed: .*'ZZZ' is not a registered code/);
    assert.equal(r.t1.new_path, m.at("3. CORRESPONDENCE/2026-01-05 ZZZ Smith re Proposed.pdf"));
    // A folder with alternate formats: the prose second pass decides, never this server.
    assert.equal(r.t2.checks.name.verdict, "second_pass_required");
    assert.equal(r.t2.ok, false);
    assert.equal(r.t2.failure, undefined);
    // A raised flag token fails outright, even in a folder with a second pass (#987).
    assert.equal(r.t3.checks.name.verdict, "fail");
    assert.deepEqual(r.t3.checks.name.flags, ["Ltd"]);
  } finally {
    m.cleanup();
  }
});

test("a name that raises the folder's flag token fails even when the page-build check recorded it ok (#987)", async () => {
  const name = "2020 BCCA 9902 Greenleaf v Northshore Widgets Ltd.pdf";
  const files = { "6. LAW/Negligence/greenleaf.pdf": "g" };
  const rows = (m) => [
    row(m, "6. LAW/Negligence/greenleaf.pdf", {
      row_id: "ltd",
      action: { kind: "rename", name },
      name_checks: [{ name, folder: "6. LAW\\Negligence", ok: true, second_pass: true }],
    }),
  ];
  const m = setUp(files, rows, [{ row_id: "ltd", approve: true }]);
  try {
    const r = await resolved(m);
    assert.equal(r.ltd.kind, "rename_in_place");
    assert.equal(r.ltd.checks.name.verdict, "fail");
    assert.equal(r.ltd.checks.name.reason, "flag token raised: Ltd");
    assert.deepEqual(r.ltd.checks.name.flags, ["Ltd"]);
    assert.equal(r.ltd.ok, false);
  } finally {
    m.cleanup();
  }
});

test("folders: present ignoring case and plural, template folders creatable, placeholders and bare stems never", async () => {
  const files = Object.fromEntries(["f1", "f2", "f3", "f4", "f5", "f6", "f7", "f8", "f9"].map((n) => [n + ".pdf", n]));
  const dests = {
    f1: "3. Correspondences",
    f2: "9. DISBURSEMENTS",
    f3: "5. COURT FILE#S-290001",
    f4: "5. COURT FILE#",
    f5: "7. DISCOVERY\\LOD Plaintiff\\Party #1",
    f6: "7. DISCOVERY\\LOD Plaintiff\\Jane Smith",
    f7: "7. DISCOVERY\\LOD Plaintiff\\Jane Smith",
    f8: "Random Folder",
    f9: "1. CASEMAP",
  };
  const rows = (m) => Object.keys(dests).map((id) => row(m, id + ".pdf", { row_id: id, ...file(GOOD.replace("Settlement", id), dests[id], id === "f6" ? { create_folder: true } : {}) }));
  const m = setUp(files, rows, Object.keys(dests).map((row_id) => ({ row_id, approve: true })));
  try {
    const r = await resolved(m);
    assert.equal(r.f1.folder, "3. CORRESPONDENCE");
    assert.deepEqual(r.f1.folders_to_create, []);
    assert.equal(r.f1.ok, true);
    assert.deepEqual(r.f2.folders_to_create, [m.at("9. DISBURSEMENTS")]);
    assert.equal(r.f2.ok, true);
    assert.equal(r.f3.ok, true, r.f3.failure);
    assert.equal(r.f4.ok, false);
    assert.match(r.f4.failure, /needs its action number/);
    assert.match(r.f5.failure, /Party #N placeholder/);
    assert.equal(r.f6.ok, true, r.f6.failure);
    assert.deepEqual(r.f6.folders_to_create, ["7. DISCOVERY", "7. DISCOVERY/LOD Plaintiff", "7. DISCOVERY/LOD Plaintiff/Jane Smith"].map((f) => m.at(f)));
    // The same folder, not marked create_folder, is never created.
    assert.match(r.f7.failure, /not one of the firm's standard folders and was not approved as a new folder/);
    assert.match(r.f8.failure, /not one of the firm's standard folders/);
    assert.match(r.f9.failure, /never a destination/);

    const missingTemplate = await resolved(m, { ...m.env, COCLERK_HOUSEKEEPING_TEMPLATE_ROOT: join(m.base, "no template") });
    assert.match(missingTemplate.f2.failure, /template matter was not found/);
    assert.equal(missingTemplate.f1.ok, true, "a present folder never reads the template");

    const { COCLERK_HOUSEKEEPING_TEMPLATE_ROOT: _, ...unset } = m.env;
    const unconfigured = await resolved(m, { ...unset, APPDATA: join(m.base, "no appdata") });
    assert.match(unconfigured.f2.failure, /template matter cannot be located.*COCLERK_HOUSEKEEPING_TEMPLATE_ROOT/);
    assert.equal(unconfigured.f1.ok, true, "a present folder never needs the configuration");
  } finally {
    m.cleanup();
  }
});

test("clashes, page-build check failures, unfiled files and rows never offered are refused", async () => {
  const files = {
    "c1.pdf": "1",
    "c2.pdf": "2",
    "c3.pdf": "3",
    "c4.pdf": "4",
    "c5.pdf": "5",
    "3. CORRESPONDENCE/c6.pdf": "6",
    "c9.pdf": "9",
    "bill of costs.pdf": "l",
    "brown letter.pdf": "k",
    ["3. CORRESPONDENCE/" + GOOD]: "already filed",
    ["0. DRAFT/c9.pdf"]: "a draft of mine",
  };
  const other = "2026-02-02 LF Smith re Other.pdf";
  const four = "2026-02-03 LF Smith re Four.pdf";
  const rows = (m) => [
    row(m, "c1.pdf", { row_id: "c1", ...file(GOOD) }),
    row(m, "c2.pdf", { row_id: "c2", ...file(other) }),
    row(m, "c3.pdf", { row_id: "c3", ...file(other) }),
    row(m, "c4.pdf", { row_id: "c4", ...file(four), name_checks: [{ name: four, folder: "3. CORRESPONDENCE", ok: false, reason: "flag raised" }] }),
    row(m, "c5.pdf", { row_id: "c5", ingest_outcome: "none", ...file(other) }),
    row(m, "3. CORRESPONDENCE/c6.pdf", { row_id: "c6", section: "ingested_only", action: undefined }),
    row(m, "c9.pdf", { row_id: "c9", ingest_outcome: "none", action: { kind: "draft" } }),
    row(m, "bill of costs.pdf", { row_id: "stuck", action: { kind: "stuck", reason: "no naming rule for a bill of costs" } }),
    row(m, "brown letter.pdf", { row_id: "misfiled", action: { kind: "misfiled", matter: "L998" } }),
  ];
  const approvals = ["c1", "c2", "c3", "c4", "c5", "c6", "c9", "gone", "stuck", "misfiled"].map((row_id) => ({ row_id, approve: true }));
  const m = setUp(files, rows, approvals);
  try {
    const r = await resolved(m);
    assert.match(r.c1.failure, /already in 3\. CORRESPONDENCE/);
    assert.equal(r.c2.ok, true);
    assert.match(r.c3.failure, /row c2 files to the same name/);
    assert.match(r.c4.failure, /flag raised/);
    for (const [id, pattern] of [
      ["c5", /not ingested/],
      ["c6", /not offered for a decision \(ingested_only\)/],
      ["gone", /not in proposal\.json/],
      ["stuck", /information only \(stuck\)/],
      ["misfiled", /information only \(misfiled\)/],
    ]) {
      assert.equal(r[id].kind, "invalid", id);
      assert.match(r[id].failure, pattern, id);
    }
    assert.equal(r.c9.kind, "draft_unchanged");
    assert.match(r.c9.failure, /c9\.pdf is already in 0\. DRAFT/);
  } finally {
    m.cleanup();
  }
});

test("filed without ingest, a subfolder file is renamed where it is (§B9.2, §C8)", async () => {
  const CORR = "3. CORRESPONDENCE";
  const files = {
    [`${CORR}/old.msg`]: "m",
    [`${CORR}/copy.pdf`]: "twin",
    [`${CORR}/2025-12-01 LF Smith re Offer.pdf`]: "twin",
  };
  const rows = (m) => [
    row(m, `${CORR}/old.msg`, { row_id: "stay", ingest_outcome: "none", action: { kind: "rename", name: "2026-01-05 LF Smith re Old.msg", file_no_ingest: true } }),
    row(m, `${CORR}/copy.pdf`, {
      row_id: "keep",
      ingest_outcome: "none",
      action: { kind: "rename", name: "2025-12-02 LF Smith re Offer.pdf", file_no_ingest: true },
      twin: { path: `${CORR}\\2025-12-01 LF Smith re Offer.pdf`, ingested: true },
    }),
  ];
  const m = setUp(files, rows, ["stay", "keep"].map((row_id) => ({ row_id, approve: true })));
  try {
    const r = await resolved(m);
    assert.equal(r.stay.kind, "file_no_ingest");
    assert.equal(r.stay.ok, true, r.stay.failure);
    assert.equal(r.stay.folder, CORR);
    assert.equal(r.stay.new_path, m.at(`${CORR}/2026-01-05 LF Smith re Old.msg`));
    assert.equal(r.keep.kind, "file_no_ingest");
    assert.equal(r.keep.ok, true, r.keep.failure);
    assert.equal(r.keep.new_path, m.at(`${CORR}/2025-12-02 LF Smith re Offer.pdf`));
  } finally {
    m.cleanup();
  }
});

test("resolve refuses a run with no approval, and names a corrupt approval.json as corrupt", async () => {
  const m = matterFixture({ [GOOD]: "x" });
  try {
    mkdirSync(runDir(m, RUN), { recursive: true });
    writeRunFile(m.root, RUN, "proposal.json", JSON.stringify(proposalFor(m, RUN, [row(m, GOOD, { action: { kind: "move", folder: "3. CORRESPONDENCE" } })])));
    await assert.rejects(resolveRun(m.root, RUN, m.env), (err) => err.code === "not_approved");
    writeFileSync(join(runDir(m, RUN), "approval.json"), "{truncated");
    await assert.rejects(resolveRun(m.root, RUN, m.env), (err) => err.code === "approval_corrupt" && /approval\.json/.test(err.message));
    writeFileSync(join(runDir(m, RUN), "approval.json"), JSON.stringify({ run_id: RUN, rows: [] }));
    await assert.rejects(resolveRun(m.root, RUN, m.env), (err) => err.code === "approval_corrupt" && /approved_at/.test(err.message));
  } finally {
    m.cleanup();
  }
});

test("an approval with nothing approved resolves no row; an entry other than approve: true is refused, naming its key", async () => {
  const m = matterFixture({ [GOOD]: "x" });
  try {
    mkdirSync(runDir(m, RUN), { recursive: true });
    writeRunFile(m.root, RUN, "proposal.json", JSON.stringify(proposalFor(m, RUN, [row(m, GOOD, { row_id: "r1", action: { kind: "move", folder: "3. CORRESPONDENCE" } })])));
    writeApproval(m, RUN, []);
    assert.deepEqual((await resolveRun(m.root, RUN, m.env)).rows, []);
    // No backward compatibility: an approval.json from the old page, carrying somethingElse, is unreadable.
    writeApproval(m, RUN, [{ row_id: "r1", somethingElse: true }]);
    await assert.rejects(resolveRun(m.root, RUN, m.env), (err) => err.code === "approval_corrupt" && /unknown key somethingElse/.test(err.message));
    writeApproval(m, RUN, [{ row_id: "r1", approve: false }]);
    await assert.rejects(resolveRun(m.root, RUN, m.env), (err) => err.code === "approval_corrupt" && /approve must be true/.test(err.message));
  } finally {
    m.cleanup();
  }
});

test("the template matter sits beside the configured case data root, not under a hardcoded firm folder", () => {
  const appData = mkdtempSync(join(tmpdir(), "coclerk-template-root-"));
  try {
    const library = join(appData, "Some Firm", "Litigation - Documents");
    const caseData = join(library, "0. CASE DATA");
    mkdirSync(caseData, { recursive: true });
    mkdirSync(join(appData, "Coclerk"));
    writeFileSync(join(appData, "Coclerk", "coclerk.json"), JSON.stringify({ case_data_root: caseData }));
    assert.equal(templateRoot({ APPDATA: appData }), join(library, "ADMIN", "0. TEMPLATE", "L### Litigation"));
    assert.equal(templateRoot({ APPDATA: appData, COCLERK_HOUSEKEEPING_TEMPLATE_ROOT: "X:\\override" }), "X:\\override");
    assert.throws(
      () => templateRoot({ APPDATA: join(appData, "none") }),
      (err) => err.code === "template_missing" && /case_data_root/.test(err.message) && /COCLERK_HOUSEKEEPING_TEMPLATE_ROOT/.test(err.message)
    );
  } finally {
    rmSync(appData, { recursive: true, force: true });
  }
});
