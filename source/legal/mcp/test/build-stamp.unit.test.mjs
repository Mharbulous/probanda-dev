// D7a: an outdated server's build_note names exactly one action, picked by the stamp of the bundle in
// the install folder the server started from. buildStampStatus itself cannot run here: BUILD_STAMP is
// null in the tsc build, so these cases go through the pure buildNote.

import assert from "node:assert/strict";
import test from "node:test";

const { buildNote } = await import("../build/build-stamp.js");

const HEAD = "This server is running build aaaaaaaaaaaa; the repo's current build is bbbbbbbbbbbb.";

test("an install already holding the current build: start a new session", () => {
  assert.equal(buildNote("aaaaaaaaaaaa", "bbbbbbbbbbbb", "bbbbbbbbbbbb"), `${HEAD} Start a new session; the installed copy is current.`);
});

test("an install holding another build: reinstall, then restart the app fully", () => {
  assert.equal(buildNote("aaaaaaaaaaaa", "bbbbbbbbbbbb", "aaaaaaaaaaaa"), `${HEAD} Reinstall the practice plugin, then restart the app fully.`);
});

test("an install whose stamp cannot be read: reinstall, then restart the app fully", () => {
  assert.equal(buildNote("aaaaaaaaaaaa", "bbbbbbbbbbbb", null), `${HEAD} Reinstall the practice plugin, then restart the app fully.`);
});
