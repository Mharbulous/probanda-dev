import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Worker } from "node:worker_threads";

const { listDownloads, listLawFolder, fileDownload, appendManifest, resolveLawDir, saveAnswer, writeScratch } =
  await import("../build/files/research-filing.js");
const { checkCoverageLine } = await import("../build/files/coverage-line.js");

/** A throwaway Downloads folder plus an initialized matter with a 0. DRAFT folder, a 6. LAW tree, a
 * look-alike, and a firewall zone. */
function fixture() {
  const downloads = realpathSync.native(mkdtempSync(join(tmpdir(), "coclerk-downloads-")));
  const matter = realpathSync.native(mkdtempSync(join(tmpdir(), "coclerk-filing-matter-")));
  const files = {
    "6. LAW/Issue/2020 BCSC 1.pdf": "already filed\n",
    "6. LAW junk/x.pdf": "x\n",
    "4. LAWYER BRIEF/CoWork/privileged/6. LAW/p.pdf": "p\n",
  };
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(matter, rel, ".."), { recursive: true });
    writeFileSync(join(matter, rel), body);
  }
  writeFileSync(join(matter, "coclerk.json"), "{}\n");
  mkdirSync(join(matter, "0. DRAFT"));
  writeFileSync(join(downloads, "2021 BCSC 963.pdf"), "decision\n");
  writeFileSync(join(downloads, "memo.docx.crdownload"), "partial\n");
  mkdirSync(join(downloads, "a folder"));
  return {
    env: { COCLERK_DOWNLOADS_DIR: downloads },
    downloads,
    matter,
    law: join(matter, "6. LAW", "Issue"),
    draft: join(matter, "0. DRAFT"),
    at: (rel) => join(matter, ...rel.split("/")),
    cleanup: () => {
      rmSync(downloads, { recursive: true, force: true });
      rmSync(matter, { recursive: true, force: true });
    },
  };
}

function codeOf(fn) {
  try {
    fn();
  } catch (err) {
    return err.code;
  }
  throw new Error("expected a throw, got none");
}

test("resolveLawDir refuses everything outside an existing 6. LAW tree", () => {
  const f = fixture();
  try {
    assert.equal(codeOf(() => resolveLawDir("6. LAW/Issue")), "invalid_path");
    // A sandbox-mapped path is rooted, so it passes the syntax screen and dies at realpath.
    assert.equal(codeOf(() => resolveLawDir("/sessions/abc/mnt/matter/6. LAW/Issue")), "not_found");
    assert.equal(codeOf(() => resolveLawDir(join(f.matter, "6. LAW", "missing"))), "not_found");
    assert.equal(codeOf(() => resolveLawDir(join(f.law, "2020 BCSC 1.pdf"))), "not_found");
    assert.equal(codeOf(() => resolveLawDir(f.matter)), "not_law_folder");
    assert.equal(codeOf(() => resolveLawDir(join(f.matter, "6. LAW junk"))), "not_law_folder");
    assert.equal(codeOf(() => resolveLawDir(join(f.law, "..", "..", "6. LAW junk"))), "not_law_folder");
    assert.equal(codeOf(() => resolveLawDir(f.at("4. LAWYER BRIEF/CoWork/privileged/6. LAW"))), "protected");

    assert.equal(resolveLawDir(f.law).toLowerCase(), f.law.toLowerCase());
    assert.equal(resolveLawDir(join(f.law, "..", "Issue")).toLowerCase(), f.law.toLowerCase());
  } finally {
    f.cleanup();
  }
});

test("a junction at 6. LAW pointing outside the matter loses the segment and is refused", (t) => {
  const f = fixture();
  const elsewhere = mkdtempSync(join(tmpdir(), "coclerk-elsewhere-"));
  try {
    mkdirSync(join(elsewhere, "Issue"));
    const other = mkdtempSync(join(tmpdir(), "coclerk-junction-matter-"));
    try {
      symlinkSync(elsewhere, join(other, "6. LAW"), "junction");
    } catch {
      t.skip("cannot create a junction here");
      return;
    }
    assert.equal(codeOf(() => resolveLawDir(join(other, "6. LAW", "Issue"))), "not_law_folder");
    rmSync(other, { recursive: true, force: true });
  } finally {
    f.cleanup();
    rmSync(elsewhere, { recursive: true, force: true });
  }
});

test("list_downloads returns names and metadata, flags in-progress files, and filters", () => {
  const f = fixture();
  try {
    const NOW = new Date("2026-09-14T10:00:00.000Z");
    const all = listDownloads(undefined, undefined, f.env, NOW);
    assert.equal(all.now, NOW.toISOString());
    assert.equal(all.downloads_dir.toLowerCase(), f.downloads.toLowerCase());
    assert.deepEqual(
      all.entries.map((e) => [e.filename, e.in_progress]).sort(),
      [
        ["2021 BCSC 963.pdf", false],
        ["memo.docx.crdownload", true],
      ]
    );
    assert.equal(all.entries.find((e) => e.filename === "2021 BCSC 963.pdf").bytes, Buffer.byteLength("decision\n"));

    const byName = listDownloads(undefined, "2021 BCSC 963.pdf", f.env);
    assert.equal(byName.entries.length, 1);
    assert.equal(listDownloads(undefined, "nope.pdf", f.env).entries.length, 0);

    const old = new Date("2020-01-01T00:00:00Z");
    utimesSync(join(f.downloads, "2021 BCSC 963.pdf"), old, old);
    const recent = listDownloads("2026-01-01T00:00:00Z", undefined, f.env);
    assert.deepEqual(
      recent.entries.map((e) => e.filename),
      ["memo.docx.crdownload"]
    );
    assert.equal(codeOf(() => listDownloads("yesterday", undefined, f.env)), "invalid_argument");
  } finally {
    f.cleanup();
  }
});

test("list_downloads hard-fails naming the probed path when Downloads is missing", () => {
  const probe = join(tmpdir(), "coclerk-no-such-downloads-" + process.pid);
  try {
    listDownloads(undefined, undefined, { COCLERK_DOWNLOADS_DIR: probe });
    assert.fail("expected a throw");
  } catch (err) {
    assert.equal(err.code, "downloads_missing");
    assert.ok(err.message.includes(probe));
  }
});

test("list_law_folder lists files only", () => {
  const f = fixture();
  try {
    mkdirSync(join(f.law, "sub"));
    assert.deepEqual(listLawFolder(f.law), {
      entries: [{ filename: "2020 BCSC 1.pdf", bytes: Buffer.byteLength("already filed\n") }],
    });
  } finally {
    f.cleanup();
  }
});

test("file_download copies a completed download and refuses, touching nothing, on every boundary", () => {
  const f = fixture();
  try {
    for (const bad of ["", "sub/2021 BCSC 963.pdf", "..\\x.pdf", "C:x.pdf", "..", "a\0b"]) {
      assert.equal(codeOf(() => fileDownload(f.law, bad, undefined, f.env)), "invalid_filename", JSON.stringify(bad));
    }
    assert.equal(codeOf(() => fileDownload(f.law, "2021 BCSC 963.pdf", "out/x.pdf", f.env)), "invalid_filename");
    assert.equal(codeOf(() => fileDownload(f.law, "missing.pdf", undefined, f.env)), "not_found");
    assert.equal(codeOf(() => fileDownload(f.law, "a folder", undefined, f.env)), "not_found");
    assert.equal(codeOf(() => fileDownload(f.law, "memo.docx.crdownload", undefined, f.env)), "in_progress");
    assert.equal(codeOf(() => fileDownload(f.law, "2021 BCSC 963.pdf", "2020 BCSC 1.pdf", f.env)), "dest_exists");
    assert.equal(codeOf(() => fileDownload(join(f.matter, "6. LAW junk"), "2021 BCSC 963.pdf", undefined, f.env)), "not_law_folder");
    assert.ok(existsSync(join(f.downloads, "2021 BCSC 963.pdf")), "source untouched after refusals");
    assert.equal(readFileSync(join(f.law, "2020 BCSC 1.pdf"), "utf-8"), "already filed\n");

    const result = fileDownload(f.law, "2021 BCSC 963.pdf", undefined, f.env);
    assert.equal(result.path.toLowerCase(), join(f.law, "2021 BCSC 963.pdf").toLowerCase());
    assert.equal(result.bytes, Buffer.byteLength("decision\n"));
    assert.equal(readFileSync(join(f.downloads, "2021 BCSC 963.pdf"), "utf-8"), "decision\n", "the download stays in Downloads");
    assert.equal(readFileSync(result.path, "utf-8"), "decision\n");
  } finally {
    f.cleanup();
  }
});

test("append_manifest creates the JSONL file and counts records", () => {
  const f = fixture();
  try {
    const first = appendManifest(f.law, { citation: "2021 BCSC 963", status: "downloaded", source: "canlii" });
    assert.equal(first.records, 1);
    const second = appendManifest(f.law, { citation: "2022 BCCA 1", status: "unavailable" });
    assert.equal(second.records, 2);
    const lines = readFileSync(second.path, "utf-8").trim().split("\n").map((l) => JSON.parse(l));
    assert.deepEqual(lines.map((l) => l.citation), ["2021 BCSC 963", "2022 BCCA 1"]);
    assert.equal(codeOf(() => appendManifest(f.law, ["not", "an", "object"])), "invalid_argument");
    assert.equal(codeOf(() => appendManifest(join(f.matter, "6. LAW junk"), {})), "not_law_folder");
  } finally {
    f.cleanup();
  }
});

// Line endings, non-ASCII and no trailing newline: a byte-faithful save keeps all three.
const ANSWER = "Confidence summary: high\r\nÉtienne v. Ng, 2024 BCCA 1 at para 3 — § 3(1)\n\nCoverage: complete";

test("save_answer saves byte-faithfully and takes the next vN, never touching an existing file", () => {
  const f = fixture();
  try {
    writeFileSync(join(f.law, "other.md"), "someone else's\n");
    const first = saveAnswer(f.law, "2026-10-02 research-lawyer answer.md", ANSWER);
    const second = saveAnswer(f.law, "2026-10-02 research-lawyer answer.md", ANSWER);
    assert.equal(first.filename, "2026-10-02 research-lawyer answer.md");
    assert.equal(second.filename, "2026-10-02 research-lawyer answer v2.md");
    assert.notEqual(first.path, second.path);
    assert.equal(first.created_dir, false);
    for (const r of [first, second]) {
      assert.deepEqual(readFileSync(r.path), Buffer.from(ANSWER, "utf-8"));
      assert.equal(r.bytes, Buffer.byteLength(ANSWER, "utf-8"));
    }

    // A file another session wrote is never overwritten: its content survives a third save.
    writeFileSync(join(f.law, "2026-10-02 research-lawyer answer v3.md"), "another session\n");
    const fourth = saveAnswer(f.law, "2026-10-02 research-lawyer answer.md", ANSWER);
    assert.equal(fourth.filename, "2026-10-02 research-lawyer answer v4.md");
    assert.equal(readFileSync(join(f.law, "2026-10-02 research-lawyer answer v3.md"), "utf-8"), "another session\n");
    assert.equal(readFileSync(join(f.law, "other.md"), "utf-8"), "someone else's\n");
  } finally {
    f.cleanup();
  }
});

test("save_answer numbers one above the highest vN, matching names case-insensitively", () => {
  const f = fixture();
  try {
    writeFileSync(join(f.law, "answer.md"), "1\n");
    writeFileSync(join(f.law, "ANSWER V7.MD"), "7\n");
    writeFileSync(join(f.law, "answer v9 draft.md"), "not a version\n");
    writeFileSync(join(f.law, "other answer v20.md"), "different stem\n");
    assert.equal(saveAnswer(f.law, "answer.md", ANSWER).filename, "answer v8.md");

    // A version with no base file still counts.
    writeFileSync(join(f.law, "memo v2.md"), "2\n");
    assert.equal(saveAnswer(f.law, "memo.md", ANSWER).filename, "memo v3.md");
  } finally {
    f.cleanup();
  }
});

test("save_answer creates only a missing final folder whose parent is in a 6. LAW tree", () => {
  const f = fixture();
  try {
    const fresh = join(f.matter, "6. LAW", "New issue");
    const created = saveAnswer(fresh, "answer.md", ANSWER);
    assert.equal(created.created_dir, true);
    assert.equal(created.path.toLowerCase(), join(fresh, "answer.md").toLowerCase());
    assert.equal(saveAnswer(fresh, "answer.md", ANSWER).created_dir, false);

    const deep = join(f.matter, "6. LAW", "Missing", "Deeper");
    assert.equal(codeOf(() => saveAnswer(deep, "answer.md", ANSWER)), "not_found");
    assert.equal(existsSync(join(f.matter, "6. LAW", "Missing")), false);
    assert.equal(codeOf(() => saveAnswer(join(f.matter, "Not law"), "answer.md", ANSWER)), "not_law_folder");
    assert.equal(existsSync(join(f.matter, "Not law")), false);
    const firewall = join(f.matter, "6. LAW", "Privileged");
    assert.equal(codeOf(() => saveAnswer(firewall, "answer.md", ANSWER)), "protected");
    assert.equal(existsSync(firewall), false, "a refused firewall folder is never created");
  } finally {
    f.cleanup();
  }
});

test("save_answer refuses, creating nothing, outside 6. LAW and on bad input", () => {
  const f = fixture();
  try {
    const fresh = join(f.matter, "6. LAW", "Fresh");
    for (const bad of ["", "sub/answer.md", "..\\answer.md", "C:answer.md", "answer.txt", "answer"]) {
      assert.equal(codeOf(() => saveAnswer(fresh, bad, ANSWER)), "invalid_filename", JSON.stringify(bad));
    }
    assert.equal(codeOf(() => saveAnswer(fresh, "answer.md", "")), "invalid_argument");
    assert.equal(codeOf(() => saveAnswer(fresh, "answer.md", undefined)), "invalid_argument");
    assert.equal(existsSync(fresh), false, "no folder is created for a refused save");

    assert.equal(codeOf(() => saveAnswer("6. LAW/Issue", "answer.md", ANSWER)), "invalid_path");
    assert.equal(codeOf(() => saveAnswer(f.matter, "answer.md", ANSWER)), "not_law_folder");
    assert.equal(codeOf(() => saveAnswer(join(f.matter, "6. LAW junk"), "answer.md", ANSWER)), "not_law_folder");
    assert.equal(
      codeOf(() => saveAnswer(f.at("4. LAWYER BRIEF/CoWork/privileged/6. LAW"), "answer.md", ANSWER)),
      "protected"
    );
    assert.equal(codeOf(() => saveAnswer(join(f.law, "2020 BCSC 1.pdf"), "answer.md", ANSWER)), "not_found");
    assert.equal(existsSync(join(f.matter, "answer.md")), false);
  } finally {
    f.cleanup();
  }
});

test("save_answer under a race: two threads saving at once lose nothing and overwrite nothing", async () => {
  const f = fixture();
  const workers = [];
  try {
    const perThread = 25;
    const gate = new Int32Array(new SharedArrayBuffer(4));
    const moduleUrl = new URL("../build/files/research-filing.js", import.meta.url).href;
    const source = `
      const { workerData, parentPort } = require("node:worker_threads");
      import(workerData.moduleUrl).then(({ saveAnswer }) => {
        parentPort.postMessage("ready");
        Atomics.wait(workerData.gate, 0, 0);
        const names = [];
        for (let i = 0; i < workerData.perThread; i++) {
          names.push(saveAnswer(workerData.dir, "answer.md", workerData.text).filename);
        }
        parentPort.postMessage(names);
      });
    `;
    const runs = [0, 1].map(() => {
      const worker = new Worker(source, {
        eval: true,
        workerData: { moduleUrl, gate, perThread, dir: f.law, text: ANSWER },
      });
      workers.push(worker);
      let onReady;
      const ready = new Promise((resolve) => (onReady = resolve));
      const done = new Promise((resolve, reject) => {
        worker.on("message", (m) => (m === "ready" ? onReady() : resolve(m)));
        worker.on("error", reject);
      });
      return { ready, done };
    });
    await Promise.all(runs.map((r) => r.ready));
    Atomics.store(gate, 0, 1);
    Atomics.notify(gate, 0);
    const names = (await Promise.all(runs.map((r) => r.done))).flat();

    const expected = ["answer.md", ...Array.from({ length: 2 * perThread - 1 }, (_, i) => `answer v${i + 2}.md`)];
    assert.deepEqual([...names].sort(), [...expected].sort(), "every save got its own name");
    const onDisk = readdirSync(f.law).filter((n) => n.startsWith("answer"));
    assert.deepEqual(onDisk.sort(), [...expected].sort());
    for (const name of onDisk) assert.deepEqual(readFileSync(join(f.law, name)), Buffer.from(ANSWER, "utf-8"));
  } finally {
    // Stop a thread still writing after the other failed, so cleanup cannot mask the failure.
    await Promise.all(workers.map((w) => w.terminate()));
    f.cleanup();
  }
});

const MEMO = "---\r\nDocument: MEMORANDUM OF LAW\nRe: \"Étienne v. Ng\" — § 3(1)\n---\n\n## Conclusion";

test("save_answer from_scratch copies the memo byte for byte, keeps the scratch file and takes the next vN", () => {
  const f = fixture();
  try {
    const scratch = writeScratch(f.matter, "2026-10-05 stem memo.md", MEMO);
    const first = saveAnswer(f.law, "2026-10-05 stem.md", undefined, scratch.path);
    const second = saveAnswer(f.law, "2026-10-05 stem.md", undefined, scratch.path);
    assert.equal(first.filename, "2026-10-05 stem.md");
    assert.equal(second.filename, "2026-10-05 stem v2.md");
    const expected = createHash("sha256").update(readFileSync(scratch.path)).digest("hex");
    for (const r of [first, second]) {
      assert.deepEqual(readFileSync(r.path), Buffer.from(MEMO, "utf-8"));
      assert.equal(r.bytes, Buffer.byteLength(MEMO, "utf-8"));
      assert.equal(r.sha256, expected);
    }
    assert.deepEqual(readFileSync(scratch.path), Buffer.from(MEMO, "utf-8"), "the scratch file is kept");

    // A text save reports the digest of what it wrote too.
    const text = saveAnswer(f.law, "typed.md", ANSWER);
    assert.equal(text.sha256, createHash("sha256").update(Buffer.from(ANSWER, "utf-8")).digest("hex"));

    // A missing final folder is created from a scratch source as from text.
    const fresh = join(f.matter, "6. LAW", "New issue");
    assert.equal(saveAnswer(fresh, "answer.md", undefined, scratch.path).created_dir, true);
  } finally {
    f.cleanup();
  }
});

test("save_answer refuses, writing nothing, both or neither of text and from_scratch and any source outside the matter's scratchpad", () => {
  const f = fixture();
  const other = fixture();
  try {
    const scratch = writeScratch(f.matter, "memo.md", MEMO);
    const fresh = join(f.matter, "6. LAW", "Fresh");
    assert.equal(codeOf(() => saveAnswer(fresh, "answer.md", MEMO, scratch.path)), "invalid_argument");
    assert.equal(codeOf(() => saveAnswer(fresh, "answer.md")), "invalid_argument");

    // Another matter's scratchpad, a file elsewhere in this matter, a subfolder of the scratchpad,
    // a relative path and a missing file.
    const foreign = writeScratch(other.matter, "memo.md", MEMO);
    assert.equal(codeOf(() => saveAnswer(fresh, "answer.md", undefined, foreign.path)), "not_scratch");
    writeFileSync(join(f.draft, "loose.md"), MEMO);
    assert.equal(codeOf(() => saveAnswer(fresh, "answer.md", undefined, join(f.draft, "loose.md"))), "not_scratch");
    const nested = join(f.draft, "AI Scratchpad", "research-agent", "sub");
    mkdirSync(nested);
    writeFileSync(join(nested, "memo.md"), MEMO);
    assert.equal(codeOf(() => saveAnswer(fresh, "answer.md", undefined, join(nested, "memo.md"))), "not_scratch");
    assert.equal(codeOf(() => saveAnswer(fresh, "answer.md", undefined, nested)), "not_found", "a folder is not a file");
    assert.equal(codeOf(() => saveAnswer(fresh, "answer.md", undefined, "AI Scratchpad/memo.md")), "invalid_path");
    const missing = join(f.draft, "AI Scratchpad", "research-agent", "missing.md");
    assert.equal(codeOf(() => saveAnswer(fresh, "answer.md", undefined, missing)), "not_found");
    writeFileSync(join(f.draft, "AI Scratchpad", "research-agent", "empty.md"), "");
    const empty = join(f.draft, "AI Scratchpad", "research-agent", "empty.md");
    assert.equal(codeOf(() => saveAnswer(fresh, "answer.md", undefined, empty)), "invalid_argument");

    // The destination is still confined to a 6. LAW tree.
    assert.equal(codeOf(() => saveAnswer(f.matter, "answer.md", undefined, scratch.path)), "not_law_folder");
    assert.equal(existsSync(fresh), false, "no folder is created for a refused save");
    assert.deepEqual(readdirSync(f.law), ["2020 BCSC 1.pdf"], "nothing is written for a refused save");
  } finally {
    f.cleanup();
    other.cleanup();
  }
});

test("save_answer from_scratch refuses a matter whose scratchpad does not exist yet", () => {
  const f = fixture();
  try {
    const elsewhere = join(f.draft, "memo.md");
    writeFileSync(elsewhere, MEMO);
    assert.equal(codeOf(() => saveAnswer(f.law, "answer.md", undefined, elsewhere)), "not_scratch");
    assert.equal(existsSync(join(f.draft, "AI Scratchpad")), false, "the scratchpad is never created by a save");
  } finally {
    f.cleanup();
  }
});

const NOTES = "# Internal research notes\r\ncase data: audited | commons: not installed — § 3(1)\n\n| Issue |";
const STEM = "2026-10-05 ML re limitation notes";

test("write_scratch saves under 0. DRAFT\\AI Scratchpad\\research-agent and takes the next vN", () => {
  const f = fixture();
  try {
    const scratch = join(f.draft, "AI Scratchpad", "research-agent");
    const first = writeScratch(f.matter, `${STEM}.md`, NOTES);
    assert.equal(first.created_dir, true);
    assert.ok(existsSync(scratch), "both folders are created");
    assert.equal(first.filename, `${STEM}.md`);
    assert.equal(first.path.toLowerCase(), join(scratch, `${STEM}.md`).toLowerCase());
    assert.deepEqual(readFileSync(first.path), Buffer.from(NOTES, "utf-8"));
    assert.equal(first.bytes, Buffer.byteLength(NOTES, "utf-8"));

    const second = writeScratch(f.matter, `${STEM}.md`, NOTES);
    assert.equal(second.created_dir, false);
    assert.equal(second.filename, `${STEM} v2.md`);

    // A file another session wrote is never overwritten.
    writeFileSync(join(scratch, `${STEM} v3.md`), "another session\n");
    assert.equal(writeScratch(f.matter, `${STEM}.md`, NOTES).filename, `${STEM} v4.md`);
    assert.equal(readFileSync(join(scratch, `${STEM} v3.md`), "utf-8"), "another session\n");
  } finally {
    f.cleanup();
  }
});

test("write_scratch refuses, writing nothing, outside a matter's one unprotected 0. DRAFT folder and on bad input", () => {
  const f = fixture();
  const base = mkdtempSync(join(tmpdir(), "coclerk-scratch-"));
  const matter = (rel, drafts) => {
    const root = join(base, ...rel.split("/"));
    mkdirSync(root, { recursive: true });
    for (const d of drafts) mkdirSync(join(root, d));
    return root;
  };
  try {
    for (const bad of ["", "sub/notes.md", "..\\notes.md", "C:notes.md", "notes.txt", "notes"]) {
      assert.equal(codeOf(() => writeScratch(f.matter, bad, NOTES)), "invalid_filename", JSON.stringify(bad));
    }
    assert.equal(codeOf(() => writeScratch(f.matter, "notes.md", "")), "invalid_argument");
    assert.equal(codeOf(() => writeScratch("relative/matter", "notes.md", NOTES)), "invalid_root");
    assert.equal(existsSync(join(f.draft, "AI Scratchpad")), false, "no folder is created for a refused write");

    const uninitialized = matter("Uninitialized", ["0. DRAFT"]);
    assert.equal(codeOf(() => writeScratch(uninitialized, "notes.md", NOTES)), "invalid_root");

    const noDraft = matter("No draft", []);
    writeFileSync(join(noDraft, "coclerk.json"), "{}\n");
    assert.equal(codeOf(() => writeScratch(noDraft, "notes.md", NOTES)), "draft_dir_missing");
    assert.equal(existsSync(join(noDraft, "0. DRAFT")), false, "the 0. DRAFT folder is never created");

    const twoDrafts = matter("Two drafts", ["0. DRAFT", "0. DRAFT old"]);
    writeFileSync(join(twoDrafts, "coclerk.json"), "{}\n");
    assert.equal(codeOf(() => writeScratch(twoDrafts, "notes.md", NOTES)), "draft_dir_ambiguous");

    const firewalled = matter("privileged/Matter", ["0. DRAFT"]);
    writeFileSync(join(firewalled, "coclerk.json"), "{}\n");
    assert.equal(codeOf(() => writeScratch(firewalled, "notes.md", NOTES)), "protected");

    for (const draft of [
      join(uninitialized, "0. DRAFT"),
      join(twoDrafts, "0. DRAFT"),
      join(twoDrafts, "0. DRAFT old"),
      join(firewalled, "0. DRAFT"),
    ]) {
      assert.deepEqual(readdirSync(draft), [], `${draft} is left empty`);
    }
  } finally {
    f.cleanup();
    rmSync(base, { recursive: true, force: true });
  }
});

test("an existing AI Scratchpad junction into a privileged tree is refused before anything is written", (t) => {
  const f = fixture();
  const elsewhere = mkdtempSync(join(tmpdir(), "coclerk-scratch-elsewhere-"));
  try {
    const target = join(elsewhere, "privileged");
    mkdirSync(target);
    try {
      symlinkSync(target, join(f.draft, "AI Scratchpad"), "junction");
    } catch {
      t.skip("cannot create a junction here");
      return;
    }
    assert.equal(codeOf(() => writeScratch(f.matter, "notes.md", NOTES)), "protected");
    assert.deepEqual(readdirSync(target), [], "nothing is created inside the privileged tree");
  } finally {
    f.cleanup();
    rmSync(elsewhere, { recursive: true, force: true });
  }
});

// Every allowed form of each tier, in order. Each line below swaps one tier's value into an
// otherwise valid line.
const COVERAGE_FORMS = [
  ["case data", ["audited", "NOT AUDITED", "NOT AUDITED: schema guard refused the query"]],
  ["commons", ["audited", "unavailable", "not installed", "NOT AUDITED", "NOT AUDITED: pool read tools absent from my grant"]],
  ["6. LAW", ["audited", "2 memos UNREAD", "1 memo UNREAD", "NOT AUDITED: matter tree unreachable"]],
  [
    "Westlaw",
    ["run (4 decisions, memo Y)", "run (1 decision, memo N)", "not run: tiers 1–3 held pinpointable text", "not run: scoped dispatch", "NOT AUDITED"],
  ],
  ["CanLII", ["noted up", "no key", "NOT AUDITED: citator returned 503"]],
  ["Legislation", ["retrieved 3, on disk 3", "retrieved 0, on disk 1", "not run: no legislation in issue", "NOT AUDITED"]],
];
const coverageLine = (swap = {}) =>
  COVERAGE_FORMS.map(([label, forms]) => `${label}: ${swap[label] ?? forms[0]}`).join(" | ");
const notesWith = (line) => `# Internal research notes\r\n\r\n${line}\r\n\r\n| Issue | # authorities |\r\n`;
const OBSERVED =
  "case data: audited | commons: audited (1 principle, no authorities attached) | 6. LAW: audited | " +
  "Westlaw: not run: tiers 1–3 held pinpointable text | CanLII: noted up | " +
  "Legislation: retrieved 3, on disk 3 (currency check leg 1 not run)";

function refusal(fn) {
  try {
    fn();
  } catch (err) {
    return { code: err.code, message: err.message };
  }
  throw new Error("expected a throw, got none");
}

test("the coverage check accepts every allowed form, bare or after **Coverage:**", () => {
  for (const [label, forms] of COVERAGE_FORMS) {
    for (const form of forms) {
      const line = coverageLine({ [label]: form });
      assert.doesNotThrow(() => checkCoverageLine(notesWith(line)), line);
      assert.doesNotThrow(() => checkCoverageLine(notesWith(`**Coverage:** ${line}`)), line);
    }
  }
});

test("the observed decorated line is refused coverage_line_malformed, naming each bad segment", () => {
  const legislationOnly = coverageLine({ Legislation: "retrieved 3, on disk 3 (currency check leg 1 not run)" });
  const one = refusal(() => checkCoverageLine(notesWith(legislationOnly)));
  assert.equal(one.code, "coverage_line_malformed");
  assert.match(one.message, /Legislation segment "Legislation: retrieved 3, on disk 3 \(currency check leg 1 not run\)" must be Legislation: retrieved n, on disk n \/ not run: <reason>/);
  assert.doesNotMatch(one.message, /commons segment/);

  const both = refusal(() => checkCoverageLine(notesWith(`**Coverage:** ${OBSERVED}`)));
  assert.equal(both.code, "coverage_line_malformed");
  assert.match(both.message, /commons segment "commons: audited \(1 principle, no authorities attached\)"/);
  assert.match(both.message, /Legislation segment/);
});

test("the coverage check refuses every other off-shape line", () => {
  const bad = [
    ["no line at all", "# Internal research notes\n\nNothing here.\n"],
    ["three-line wrap", notesWith(coverageLine()).replace(" | 6. LAW", " |\n6. LAW")],
    ["text after Legislation", notesWith(`${coverageLine()} | currency not checked`)],
    ["a tier missing", notesWith(coverageLine().replace(" | CanLII: noted up", ""))],
    [
      "segments out of order",
      notesWith(coverageLine().replace("CanLII: noted up | Legislation: retrieved 3, on disk 3", "Legislation: retrieved 3, on disk 3 | CanLII: noted up")),
    ],
    ["Westlaw not run without a reason", notesWith(coverageLine({ Westlaw: "not run" }))],
    ["Westlaw not run, empty reason", notesWith(coverageLine({ Westlaw: "not run: " }))],
    ["memo neither Y nor N", notesWith(coverageLine({ Westlaw: "run (4 decisions, memo yes)" }))],
    ["CanLII qualifier", notesWith(coverageLine({ CanLII: "noted up (43 citing decisions)" }))],
    ["6. LAW qualifier", notesWith(coverageLine({ "6. LAW": "audited (four memos read)" }))],
    ["NOT AUDITED with an empty reason", notesWith(coverageLine({ "case data": "NOT AUDITED: " }))],
    ["lower-case not audited", notesWith(coverageLine({ "case data": "not audited" }))],
    ["wrong label", notesWith(coverageLine().replace("CanLII:", "Canlii:"))],
  ];
  for (const [why, notes] of bad) {
    assert.equal(refusal(() => checkCoverageLine(notes)).code, "coverage_line_malformed", why);
  }
});

test("write_scratch with kind research-notes writes a good line and refuses a bad one, writing nothing", () => {
  const f = fixture();
  try {
    const scratch = join(f.draft, "AI Scratchpad");
    assert.equal(codeOf(() => writeScratch(f.matter, "n.md", notesWith(OBSERVED), "research-notes")), "coverage_line_malformed");
    assert.equal(existsSync(scratch), false, "no folder is created for a refused write");
    assert.equal(codeOf(() => writeScratch(f.matter, "n.md", notesWith(coverageLine()), "memo")), "invalid_argument");
    assert.equal(existsSync(scratch), false);

    const saved = writeScratch(f.matter, "n.md", notesWith(coverageLine()), "research-notes");
    assert.equal(readFileSync(saved.path, "utf-8"), notesWith(coverageLine()));
  } finally {
    f.cleanup();
  }
});

test("write_scratch with no kind checks nothing, as before", () => {
  const f = fixture();
  try {
    assert.equal(writeScratch(f.matter, "n.md", notesWith(OBSERVED)).filename, "n.md");
    assert.equal(writeScratch(f.matter, "n.md", "no coverage line at all").filename, "n v2.md");
  } finally {
    f.cleanup();
  }
});
