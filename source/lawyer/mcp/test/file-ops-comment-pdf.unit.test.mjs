// fileOpsCommentPdf (src/file_ops/comment-pdf.ts): file_ops__comment_pdf adds sticky notes to a matter
// PDF by an incremental save, so the original bytes stay as they were, and returns the new SHA-256.
// Synthetic PDFs and a throwaway matter only.

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import test from "node:test";

import { matterFixture, sha } from "./helpers/housekeeping-fixture.mjs";
import { pdfBytes } from "./helpers/synthetic-docs.mjs";

const { fileOpsCommentPdf } = await import("../build/file_ops/comment-pdf.js");

const ORIGINAL = pdfBytes(["Placeholder page one", "Placeholder page two"]);
const refused = (code) => (err) => err.code === code;

function fixture() {
  const m = matterFixture({ "3. CORRESPONDENCE/copy.pdf": ORIGINAL, "TRASH/gone.pdf": ORIGINAL });
  return { m, file: m.at("3. CORRESPONDENCE/copy.pdf") };
}

test("the notes are appended after the original bytes and the new hash is the file's", async () => {
  const { m, file } = fixture();
  try {
    const before = sha(file);
    const result = await fileOpsCommentPdf(m.root, file, before, [
      { page: 2, text: "Differs from other.pdf p.2: dated 3 May, not 4 May" },
      { page: 2, text: "Second note on the same page" },
    ]);
    const after = readFileSync(file);
    assert.equal(result.old_sha256, before);
    assert.equal(result.new_sha256, sha(file));
    assert.notEqual(result.new_sha256, before);
    assert.equal(result.comments, 2);
    assert.ok(after.subarray(0, ORIGINAL.length).equals(ORIGINAL), "the original bytes are kept unchanged");
    const tail = after.subarray(ORIGINAL.length).toString("latin1");
    assert.match(tail, /\/Subtype\s*\/Text/);
    assert.ok(tail.includes("dated 3 May, not 4 May") && tail.includes("Second note on the same page"));
    assert.deepEqual(readdirSync(dirname(file)), ["copy.pdf"], "no temp file is left");
  } finally {
    m.cleanup();
  }
});

test("each refusal leaves the file as it was", async () => {
  const { m, file } = fixture();
  try {
    const hash = sha(file);
    const note = [{ page: 1, text: "note" }];
    await assert.rejects(fileOpsCommentPdf(m.root, file, "0".repeat(64), note), refused("hash_mismatch"));
    await assert.rejects(fileOpsCommentPdf(m.root, file, hash, [{ page: 3, text: "note" }]), refused("bad_pages"));
    await assert.rejects(fileOpsCommentPdf(m.root, m.at("TRASH/gone.pdf"), hash, note), refused("protected"));
    await assert.rejects(fileOpsCommentPdf(m.root, m.at("3. CORRESPONDENCE/none.pdf"), hash, note), refused("not_found"));
    await assert.rejects(fileOpsCommentPdf(m.root, file, hash, []), /comments must name/);
    assert.equal(sha(file), hash);
    assert.deepEqual(readdirSync(dirname(file)), ["copy.pdf"]);
  } finally {
    m.cleanup();
  }
});
