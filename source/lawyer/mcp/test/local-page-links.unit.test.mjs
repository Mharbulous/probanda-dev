// Link records: a page URL carries an id, and the target it stands for is read back from a record
// beside probanda.json, so no client folder name reaches a URL and any process on the device can
// resolve it. A record the device did not write is refused.

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { deviceLink, dropLinks, resolveLink, sweepLinks } = await import("../build/local-page/links.js");

function device() {
  const dir = mkdtempSync(join(tmpdir(), "local-page-links-"));
  const path = join(dir, "probanda.json");
  writeFileSync(path, "{}");
  return { dir, records: join(dir, "page-links"), env: { ...process.env, COCLERK_CONFIG_PATH: path }, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const TARGET = JSON.stringify({ matter_root: "C:\\Clients\\L166 Smith", run_id: "20260924-100000-aaaa" });

test("a link resolves to its target, for its own kind only, and its id names no folder", () => {
  const d = device();
  try {
    const id = deviceLink("housekeeping", TARGET, d.env);
    assert.match(id, /^[A-Za-z0-9_-]{32}$/);
    assert.equal(id.includes("Smith"), false);
    assert.equal(resolveLink("housekeeping", id, d.env), TARGET);
    assert.equal(resolveLink("other", id, d.env), null);
    assert.equal(resolveLink("housekeeping", "not-a-link", d.env), null);
    assert.equal(resolveLink("housekeeping", "A".repeat(32), d.env), null);
  } finally {
    d.cleanup();
  }
});

test("a planted or edited record is refused", () => {
  const d = device();
  try {
    const id = deviceLink("housekeeping", TARGET, d.env);
    // A record written by hand under an id the device never issued.
    const planted = "B".repeat(32);
    writeFileSync(join(d.records, `${planted}.json`), JSON.stringify({ kind: "housekeeping", target: TARGET }));
    assert.equal(resolveLink("housekeeping", planted, d.env), null);
    // A genuine record whose target was changed.
    writeFileSync(join(d.records, `${id}.json`), JSON.stringify({ kind: "housekeeping", target: TARGET.replace("Smith", "Jones") }));
    assert.equal(resolveLink("housekeeping", id, d.env), null);
    // Not JSON at all.
    writeFileSync(join(d.records, `${id}.json`), "{");
    assert.equal(resolveLink("housekeeping", id, d.env), null);
  } finally {
    d.cleanup();
  }
});

test("dropLinks removes the matching records of one kind; sweepLinks removes records older than 30 days", () => {
  const d = device();
  try {
    const keep = deviceLink("housekeeping", "keep", d.env);
    const drop = deviceLink("housekeeping", "drop", d.env);
    const otherKind = deviceLink("other", "drop", d.env);
    dropLinks("housekeeping", (target) => target === "drop", d.env);
    assert.equal(resolveLink("housekeeping", keep, d.env), "keep");
    assert.equal(resolveLink("housekeeping", drop, d.env), null);
    assert.equal(resolveLink("other", otherKind, d.env), "drop");

    const old = new Date(Date.now() - 31 * 24 * 3600 * 1000);
    utimesSync(join(d.records, `${keep}.json`), old, old);
    sweepLinks(d.env);
    assert.equal(existsSync(join(d.records, `${keep}.json`)), false);
    assert.deepEqual(readdirSync(d.records), [`${otherKind}.json`]);
  } finally {
    d.cleanup();
  }
});

test("dropLinks and sweepLinks do nothing when no record was ever written", () => {
  const d = device();
  try {
    dropLinks("housekeeping", () => true, d.env);
    sweepLinks(d.env);
    assert.equal(existsSync(d.records), false);
  } finally {
    d.cleanup();
  }
});
