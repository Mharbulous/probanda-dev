// The stale time zone data check in src/dav/tz.ts: tz data 2026b put British Columbia on
// permanent -07:00 from 2026-11-01, and a host with older data must refuse BC times
// rather than give them an hour off.

import assert from "node:assert/strict";
import test from "node:test";

const { offsetMinutes, staleTzDataError } = await import("../build/dav/tz.js");

const PROBE = Date.UTC(2026, 10, 2, 18);

test("a host still falling back to -08:00 refuses Vancouver and its aliases", () => {
  for (const tz of ["America/Vancouver", "Canada/Pacific"]) {
    const err = staleTzDataError(tz, -480);
    assert.equal(err?.code, "stale_tz_data", tz);
    assert.match(err.message, /Node\.js 22\.23\.3 or later/);
  }
});

test("a stale host still serves zones outside British Columbia", () => {
  assert.equal(staleTzDataError("America/Los_Angeles", -480), null);
});

test("a current host serves Vancouver", () => {
  assert.equal(staleTzDataError("America/Vancouver", -420), null);
});

test("this host's Node has current BC rules", () => {
  assert.equal(offsetMinutes("America/Vancouver", PROBE), -420, `tz data ${process.versions.tz}`);
});
