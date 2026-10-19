// Byte-identity pin for a board migration (map #125): pin the sha256 of `render(fixture)` before
// the move, then assert it after. A mismatch reports the two hashes only, never the page, because
// no session reads a generated page (shared/html-pages.md).

import assert from "node:assert/strict";
import { createHash } from "node:crypto";

/** The sha256 hex of `text` as UTF-8. */
export function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** Asserts `text` hashes to `expected`, naming `label` and both hashes on failure. */
export function assertSha256Pin(text, expected, label) {
  const actual = sha256(text);
  assert.ok(actual === expected, `${label}: sha256 ${actual} does not match the pinned ${expected}`);
}
