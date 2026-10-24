import assert from "node:assert/strict";
import { closeSync, constants, existsSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { codeOf, matterFixture } from "./helpers/housekeeping-fixture.mjs";

const { fileOpsMove } = await import("../build/file_ops/move.js");

const ROOT_FILE = "2026-01-05 LF Smith re Settlement.pdf";

function fixture() {
  return matterFixture({
    [ROOT_FILE]: "letter",
    "3. CORRESPONDENCE/taken.pdf": "already here",
    "4. LAWYER BRIEF/CoWork/privileged/p.pdf": "p",
    "0. CASE DATA/main.sqlite": "db",
    "8. NOTES/0. CASE DATA/nested.pdf": "nested",
    "TRASH/old.pdf": "old",
    "draft.docx": "draft",
  });
}

test("file_ops__move refuses every protected source and destination, touching nothing", () => {
  const m = fixture();
  const outside = mkdtempSync(join(tmpdir(), "coclerk-move-outside-"));
  try {
    writeFileSync(join(outside, "x.pdf"), "x");
    const src = m.at(ROOT_FILE);
    const cases = [
      [() => fileOpsMove(m.root, ROOT_FILE, m.at("3. CORRESPONDENCE/a.pdf")), "invalid_path"],
      [() => fileOpsMove(m.root, m.at("missing.pdf"), m.at("3. CORRESPONDENCE/a.pdf")), "not_found"],
      [() => fileOpsMove(m.root, m.at("3. CORRESPONDENCE"), m.at("6. LAW/a")), "not_a_file"],
      [() => fileOpsMove(m.root, join(outside, "x.pdf"), m.at("3. CORRESPONDENCE/x.pdf")), "path_out_of_scope"],
      [() => fileOpsMove(m.root, m.at("coclerk.json"), m.at("3. CORRESPONDENCE/coclerk.json")), "protected"],
      [() => fileOpsMove(m.root, m.at("TRASH/old.pdf"), m.at("3. CORRESPONDENCE/old.pdf")), "protected"],
      [() => fileOpsMove(m.root, m.at("0. CASE DATA/main.sqlite"), m.at("3. CORRESPONDENCE/main.sqlite")), "protected"],
      [() => fileOpsMove(m.root, m.at("8. NOTES/0. CASE DATA/nested.pdf"), m.at("3. CORRESPONDENCE/nested.pdf")), "protected"],
      [() => fileOpsMove(m.root, m.at("4. LAWYER BRIEF/CoWork/privileged/p.pdf"), m.at("3. CORRESPONDENCE/p.pdf")), "protected"],
      [() => fileOpsMove(m.root, src, join(outside, ROOT_FILE)), "path_out_of_scope"],
      [() => fileOpsMove(m.root, src, m.at(ROOT_FILE + ".bak")), "protected"],
      [() => fileOpsMove(m.root, src, m.at("0. DRAFT/" + ROOT_FILE)), "protected"],
      [() => fileOpsMove(m.root, src, m.at("1. CASEMAP/" + ROOT_FILE), [m.at("1. CASEMAP")]), "protected"],
      [() => fileOpsMove(m.root, src, m.at("0. CASE DATA/" + ROOT_FILE)), "protected"],
      [() => fileOpsMove(m.root, src, m.at("TRASH/" + ROOT_FILE)), "protected"],
      [() => fileOpsMove(m.root, src, m.at("4. LAWYER BRIEF/CoWork/privileged/" + ROOT_FILE)), "protected"],
      [() => fileOpsMove(m.root, src, m.at("4. LAWYER BRIEF/disclosed/" + ROOT_FILE), [m.at("4. LAWYER BRIEF/disclosed")]), "protected"],
      [() => fileOpsMove(m.root, src, m.at("3. CORRESPONDENCE/a:b.pdf")), "invalid_filename"],
      [() => fileOpsMove(m.root, src, m.at("3. CORRESPONDENCE/taken.pdf")), "dest_exists"],
      [() => fileOpsMove(m.root, src, m.at("9. DISBURSEMENTS/" + ROOT_FILE)), "folder_not_approved"],
      [() => fileOpsMove(m.root, src, m.at("7. DISCOVERY/LOD Plaintiff/" + ROOT_FILE), [m.at("7. DISCOVERY/LOD Plaintiff")]), "folder_not_approved"],
      [() => fileOpsMove(m.root, src, m.at("9. DISBURSEMENTS/" + ROOT_FILE), [m.at("9. DISBURSEMENTS"), m.at("6. LAW/x")]), "invalid_argument"],
      [() => fileOpsMove(m.root, m.at("3. CORRESPONDENCE/taken.pdf"), m.at("3. CORRESPONDENCE/taken.pdf")), "invalid_argument"],
      [() => fileOpsMove(m.root, src, m.at("3. CORRESPONDENCE/" + ROOT_FILE), [], true), "invalid_argument"],
    ];
    for (const [fn, code] of cases) assert.equal(codeOf(fn), code, fn.toString());
    assert.equal(readFileSync(src, "utf-8"), "letter");
    assert.equal(readFileSync(m.at("3. CORRESPONDENCE/taken.pdf"), "utf-8"), "already here");
    for (const dir of ["9. DISBURSEMENTS", "7. DISCOVERY", "1. CASEMAP"]) assert.equal(existsSync(m.at(dir)), false, dir);
  } finally {
    m.cleanup();
    rmSync(outside, { recursive: true, force: true });
  }
});

test("file_ops__move renames and files a root file, creating only the approved folders", () => {
  const m = fixture();
  try {
    const src = m.at(ROOT_FILE);
    const dest = m.at("7. DISCOVERY/LOD Plaintiff/Jane Smith/2026-01-05 LF Smith re Offer.pdf");
    const folders = ["7. DISCOVERY", "7. DISCOVERY/LOD Plaintiff", "7. DISCOVERY/LOD Plaintiff/Jane Smith"].map((f) => m.at(f));
    const result = fileOpsMove(m.root, src, dest, folders);
    assert.deepEqual(result, { moved_from: src, moved_to: dest, created_folders: folders });
    assert.equal(existsSync(src), false);
    assert.equal(readFileSync(dest, "utf-8"), "letter");
  } finally {
    m.cleanup();
  }
});

test("file_ops__move never creates a folder whose name ends in a dot or a space, or that Windows cannot hold", () => {
  const m = fixture();
  try {
    const src = m.at(ROOT_FILE);
    for (const leaf of ["Plaintiff Holdings Inc.", "Jane Smith ", "NUL"]) {
      const folders = ["7. DISCOVERY", "7. DISCOVERY/LOD Plaintiff", `7. DISCOVERY/LOD Plaintiff/${leaf}`].map((f) => m.at(f));
      assert.equal(codeOf(() => fileOpsMove(m.root, src, join(folders[2], ROOT_FILE), folders)), "invalid_filename", leaf);
    }
    assert.equal(existsSync(m.at("7. DISCOVERY")), false, "nothing is created");
    assert.equal(readFileSync(src, "utf-8"), "letter");
  } finally {
    m.cleanup();
  }
});

test("file_ops__move renames in place, including a case-only rename, and reports the on-disk path", () => {
  const m = fixture();
  try {
    const moved = fileOpsMove(m.root, m.at("3. CORRESPONDENCE/taken.pdf"), m.at("3. CORRESPONDENCE/Taken.pdf"));
    assert.equal(moved.moved_to, m.at("3. CORRESPONDENCE/Taken.pdf"));
    assert.deepEqual(readdirSync(m.at("3. CORRESPONDENCE")), ["Taken.pdf"]);
  } finally {
    m.cleanup();
  }
});

test("Move to 0. DRAFT unchanged is the one folder-0 destination, and only under the current name", () => {
  const m = fixture();
  try {
    assert.equal(codeOf(() => fileOpsMove(m.root, m.at("draft.docx"), m.at("0. DRAFT/renamed.docx"), [], true)), "draft_name_changed");
    writeFileSync(m.at("0. DRAFT/clash.docx"), "mine");
    writeFileSync(m.at("clash.docx"), "root copy");
    assert.equal(codeOf(() => fileOpsMove(m.root, m.at("clash.docx"), m.at("0. DRAFT/clash.docx"), [], true)), "dest_exists");
    assert.equal(readFileSync(m.at("0. DRAFT/clash.docx"), "utf-8"), "mine");

    const moved = fileOpsMove(m.root, m.at("draft.docx"), m.at("0. DRAFT/draft.docx"), [], true);
    assert.equal(moved.moved_to, m.at("0. DRAFT/draft.docx"));
    assert.equal(existsSync(m.at("draft.docx")), false);
  } finally {
    m.cleanup();
  }
});

test("superseded moves only into the 0. DRAFT folder's Superseded folder, under any name, creating only that folder", () => {
  const m = fixture();
  try {
    const src = m.at("3. CORRESPONDENCE/taken.pdf");
    const superseded = m.at("0. DRAFT/Superseded");
    const target = m.at("0. DRAFT/Superseded/2024-04-20 AFF Smith DRAFT.pdf");
    const cases = [
      [() => fileOpsMove(m.root, src, m.at("0. DRAFT/taken.pdf"), [], false, true), "invalid_argument"],
      [() => fileOpsMove(m.root, src, m.at("0. DRAFT/Other/taken.pdf"), [m.at("0. DRAFT/Other")], false, true), "invalid_argument"],
      [() => fileOpsMove(m.root, src, m.at("0. DRAFT/Superseded/Old/taken.pdf"), [superseded, m.at("0. DRAFT/Superseded/Old")], false, true), "invalid_argument"],
      [() => fileOpsMove(m.root, src, m.at("1. CASEMAP/Superseded/taken.pdf"), [m.at("1. CASEMAP"), m.at("1. CASEMAP/Superseded")], false, true), "invalid_argument"],
      [() => fileOpsMove(m.root, src, m.at("6. LAW/Superseded/taken.pdf"), [m.at("6. LAW/Superseded")], false, true), "invalid_argument"],
      [() => fileOpsMove(m.root, src, target, [superseded, m.at("0. DRAFT")], false, true), "invalid_argument"],
      [() => fileOpsMove(m.root, src, target, [superseded], true, true), "invalid_argument"],
      [() => fileOpsMove(m.root, src, target, [superseded]), "protected"],
    ];
    for (const [fn, code] of cases) assert.equal(codeOf(fn), code, fn.toString());
    for (const dir of ["0. DRAFT/Superseded", "0. DRAFT/Other", "1. CASEMAP", "6. LAW/Superseded"]) assert.equal(existsSync(m.at(dir)), false, dir);

    const moved = fileOpsMove(m.root, src, target, [superseded], false, true);
    assert.deepEqual(moved, { moved_from: src, moved_to: target, created_folders: [superseded] });
    assert.equal(readFileSync(target, "utf-8"), "already here");

    writeFileSync(m.at("again.pdf"), "a copy");
    assert.equal(codeOf(() => fileOpsMove(m.root, m.at("again.pdf"), target, [], false, true)), "dest_exists");
    assert.equal(readFileSync(target, "utf-8"), "already here", "nothing is overwritten");
  } finally {
    m.cleanup();
  }
});

test("superseded refuses a matter with no 0. DRAFT folder or two", () => {
  for (const dirs of [["3. CORRESPONDENCE"], ["0. DRAFT", "0. DRAFT (old)", "3. CORRESPONDENCE"]]) {
    const m = matterFixture({ "3. CORRESPONDENCE/a.pdf": "a" }, { dirs });
    try {
      const folders = dirs.includes("0. DRAFT") ? [m.at("0. DRAFT/Superseded")] : [m.at("0. DRAFT"), m.at("0. DRAFT/Superseded")];
      assert.equal(codeOf(() => fileOpsMove(m.root, m.at("3. CORRESPONDENCE/a.pdf"), m.at("0. DRAFT/Superseded/a.pdf"), folders, false, true)), "invalid_argument", dirs.join(", "));
      assert.equal(readFileSync(m.at("3. CORRESPONDENCE/a.pdf"), "utf-8"), "a");
    } finally {
      m.cleanup();
    }
  }
});

test("file_ops__move refuses a destination reached through a junction out of the matter", () => {
  const m = fixture();
  const outside = mkdtempSync(join(tmpdir(), "coclerk-move-junction-"));
  try {
    symlinkSync(outside, m.at("3. CORRESPONDENCE/linked"), "junction");
    assert.equal(codeOf(() => fileOpsMove(m.root, m.at(ROOT_FILE), m.at("3. CORRESPONDENCE/linked/" + ROOT_FILE))), "path_out_of_scope");
    assert.deepEqual(readdirSync(outside), []);
    mkdirSync(m.at("6. LAW/Issue"));
    assert.equal(fileOpsMove(m.root, m.at(ROOT_FILE), m.at("6. LAW/Issue/" + ROOT_FILE)).moved_to, m.at("6. LAW/Issue/" + ROOT_FILE));
  } finally {
    m.cleanup();
    rmSync(outside, { recursive: true, force: true });
  }
});

test("the draft folder is the matter's `0. DRAFT*` folder, whatever follows the word", () => {
  const m = matterFixture({ "draft.docx": "draft" }, { dirs: ["0. DRAFT (Smith)", "3. CORRESPONDENCE"] });
  try {
    const moved = fileOpsMove(m.root, m.at("draft.docx"), m.at("0. DRAFT (Smith)/draft.docx"), [], true);
    assert.equal(moved.moved_to, m.at("0. DRAFT (Smith)/draft.docx"));
  } finally {
    m.cleanup();
  }
});

test("a move claims its destination first, and on failure removes only that claim", () => {
  const m = fixture();
  const EXLOCK = 0x10000000; // libuv UV_FS_O_EXLOCK: an open that shares nothing, so the rename fails
  try {
    const src = m.at(ROOT_FILE);
    const dest = m.at("3. CORRESPONDENCE/" + ROOT_FILE);
    const fd = openSync(src, constants.O_RDONLY | EXLOCK);
    try {
      assert.throws(() => fileOpsMove(m.root, src, dest), (err) => err.code === "EBUSY");
    } finally {
      closeSync(fd);
    }
    assert.equal(existsSync(dest), false, "the placeholder is removed");
    assert.equal(readFileSync(src, "utf-8"), "letter");

    fileOpsMove(m.root, src, dest);
    assert.equal(readFileSync(dest, "utf-8"), "letter");
    assert.deepEqual(readdirSync(m.at("3. CORRESPONDENCE")).sort(), [ROOT_FILE, "taken.pdf"]);
  } finally {
    m.cleanup();
  }
});
