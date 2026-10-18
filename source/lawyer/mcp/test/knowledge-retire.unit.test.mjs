// knowledge__retire (spec §3.2, plan Phase 8): a file and its sidecar move to
// `_superseded\<same path>`; the `shadowed_only` sweep retires only overlay files the
// shipped tree holds identically; and a `_fetched\` PDF is deleted, by retire or by a
// refresh, only once no live excerpt records its hash.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import test from "node:test";

import { knowledgeFixture } from "./helpers/knowledge-fixture.mjs";

const { knowledgeRetire, knowledgeWrite } = await import("../build/knowledge/tools.js");

const retire = (f, args) => knowledgeRetire({ matter: "L8443", ...args }, f.seams);

async function rejection(promise) {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error("expected a rejection, got none");
}

const VENUE = "---\nlearned_by: agent\naccessed: 2026-09-20\n---\n# BCSC venue notes\n";
const sha = (text) => createHash("sha256").update(text).digest("hex");

test("retire moves the file and its sidecar to _superseded under the same path", async (t) => {
  const f = knowledgeFixture(t);
  const path = "draft/CAN/BC/BCSC/Sources/rules.md";
  f.local(path, VENUE);
  f.local(`${path}.confirmations.local.json`, { file: path, items: [] });
  const result = await retire(f, { path });
  assert.deepEqual(result.retired, [{ path, to: `_superseded/${path}`, sidecar_to: `_superseded/${path}.confirmations.local.json` }]);
  assert.equal(existsSync(f.localPath(path)), false);
  assert.equal(existsSync(f.localPath(`${path}.confirmations.local.json`)), false);
  assert.equal(readFileSync(f.localPath(`_superseded/${path}`), "utf-8"), VENUE);
  assert.ok(existsSync(f.localPath(`_superseded/${path}.confirmations.local.json`)));
  assert.equal(result.plugin_version, "9.9.9");
});

test("a second retire gets not_found, which counts as done, and a retired copy is never overwritten", async (t) => {
  const f = knowledgeFixture(t);
  const path = "draft/CAN/BC/BCSC/venue.md";
  f.local(path, VENUE);
  await retire(f, { path });
  assert.equal((await rejection(retire(f, { path }))).code, "not_found");
  f.local(path, `${VENUE}\nA second learned copy.\n`);
  assert.equal((await rejection(retire(f, { path }))).code, "superseded_exists");
  assert.ok(existsSync(f.localPath(path)));
  assert.equal(readFileSync(f.localPath(`_superseded/${path}`), "utf-8"), VENUE);
});

test("retire refuses a sidecar, a reserved entry and the repo-run marker", async (t) => {
  const f = knowledgeFixture(t);
  const path = "draft/CAN/BC/BCSC/venue.md";
  f.local(path, VENUE);
  assert.equal((await rejection(retire(f, { path: `${path}.confirmations.local.json` }))).code, "reserved_suffix");
  assert.equal((await rejection(retire(f, { path: "_hosts.json" }))).code, "reserved_entry");
  assert.equal((await rejection(retire(f, { path, matter: "repo-run" }))).code, "repo_session");
  assert.equal((await rejection(retire(f, { path, shadowed_only: true }))).name, "ValidationError");
  assert.ok(existsSync(f.localPath(path)));
});

test("shadowed_only retires only overlay files the shipped tree holds identically", async (t) => {
  const f = knowledgeFixture(t);
  const same = "draft/CAN/BC/BCSC/venue.md";
  const differs = "draft/CAN/BC/BCCA/venue.md";
  const localOnly = "draft/CAN/BC/BCPC/venue.md";
  const format = "publish/CAN/BC/BCSC/format.md";
  f.shipped(same, VENUE);
  f.local(same, VENUE.replace(/\n/g, "\r\n")); // identical after line-ending normalization
  f.local(`${same}.confirmations.local.json`, { file: same, items: [] });
  f.shipped(differs, VENUE);
  f.local(differs, `${VENUE}The firm's own note.\n`);
  f.local(localOnly, VENUE);
  f.shipped(format, "---\naccessed: 2026-09-20\n---\n# Format\n");
  f.local(format, "---\naccessed: 2026-09-20\n---\n# Format\n");

  const result = await retire(f, { shadowed_only: true });
  assert.deepEqual(result.retired.map((entry) => entry.path).sort(), [same, format].sort());
  assert.equal(result.retired.find((entry) => entry.path === same).sidecar_to, `_superseded/${same}.confirmations.local.json`);
  assert.equal(existsSync(f.localPath(same)), false);
  assert.ok(existsSync(f.localPath(differs)));
  assert.ok(existsSync(f.localPath(localOnly)));
  assert.deepEqual((await retire(f, { shadowed_only: true })).retired, []);
});

test("a _fetched PDF is deleted only when no live excerpt records its hash, by retire or by a refresh", async (t) => {
  const f = knowledgeFixture(t);
  const [h1, h2, h3] = ["one", "two", "three"].map(sha);
  const recordWith = (hash) =>
    `---\npage_url: https://fixture.test/rules\npdf_url: https://fixture.test/rules.pdf\npdf_sha256: ${hash}\naccessed: 2026-09-20\n` +
    "items:\n  - rule_ref: R-pdf\n    passage: Delta was transcribed from the PDF.\n    checked_by: file_sha256\n    page: 4\n---\n# Excerpt\n";
  const r1 = "draft/CAN/BC/BCSC/Sources/r1.md";
  const r2 = "draft/CAN/BC/BCSC/Sources/r2.md";
  const r3 = "draft/CAN/BC/BCCA/Sources/r3.md";
  f.local(r1, recordWith(h1));
  f.local(r2, recordWith(h1));
  f.local(r3, recordWith(h2));
  const pdf = (hash) => `_fetched/fixture.test/${hash.slice(0, 12)}.pdf`;
  for (const hash of [h1, h2, h3]) f.local(pdf(hash), "%PDF-1.4\n");

  // r2 still records h1.
  assert.deepEqual((await retire(f, { path: r1 })).fetched_deleted, []);
  assert.ok(existsSync(f.localPath(pdf(h1))));
  // Nothing live records h2 once r3 is retired; h3 was never r3's, so it stays.
  assert.deepEqual((await retire(f, { path: r3 })).fetched_deleted, [pdf(h2)]);
  assert.equal(existsSync(f.localPath(pdf(h2))), false);
  assert.ok(existsSync(f.localPath(pdf(h3))));

  // A refresh of r2 that no longer records h1 deletes it: the retired r1 in _superseded does not count.
  const refreshed = await knowledgeWrite(
    { operation: "create", path: r2, matter: "L8443", content: recordWith(h3), overwrite: true },
    f.seams
  );
  assert.equal(refreshed.status, "overwritten");
  assert.deepEqual(refreshed.fetched_deleted, [pdf(h1)]);
  assert.equal(existsSync(f.localPath(pdf(h1))), false);
  assert.ok(existsSync(f.localPath(pdf(h3))));
});

test("shadowed_only skips a file whose retired copy already exists, reports it, and retires the rest", async (t) => {
  const f = knowledgeFixture(t);
  const blocked = "draft/CAN/BC/BCSC/venue.md";
  const free = "draft/CAN/BC/BCCA/venue.md";
  for (const path of [blocked, free]) {
    f.shipped(path, VENUE);
    f.local(path, VENUE);
  }
  f.local(`_superseded/${blocked}`, "an earlier retired copy\n");

  const result = await retire(f, { shadowed_only: true });
  assert.deepEqual(result.retired.map((entry) => entry.path), [free]);
  assert.equal(result.skipped.length, 1);
  assert.equal(result.skipped[0].path, blocked);
  assert.match(result.skipped[0].reason, /already holds a retired copy/);
  assert.ok(existsSync(f.localPath(blocked)));
  assert.equal(readFileSync(f.localPath(`_superseded/${blocked}`), "utf-8"), "an earlier retired copy\n");
  // A single-path retire stays strict.
  assert.equal((await rejection(retire(f, { path: blocked }))).code, "superseded_exists");
});

test("a refused retire creates no _superseded folder", async (t) => {
  const f = knowledgeFixture(t);
  const path = "draft/CAN/BC/BCSC/Sources/rules.md";
  mkdirSync(f.localPath(path), { recursive: true });
  assert.equal((await rejection(retire(f, { path }))).code, "not_a_file");
  assert.equal(existsSync(f.localPath("_superseded")), false);
});

test("a _fetched PDF whose hash a shipped excerpt records is kept after the overlay copy is retired", async (t) => {
  const f = knowledgeFixture(t);
  const hash = sha("promoted");
  const path = "draft/CAN/BC/BCSC/Sources/rules.md";
  const text =
    `---\npage_url: https://fixture.test/rules\npdf_sha256: ${hash}\naccessed: 2026-09-20\n` +
    "items:\n  - rule_ref: R-pdf\n    passage: Delta was transcribed from the PDF.\n    checked_by: file_sha256\n    page: 4\n---\n# Excerpt\n";
  f.shipped(path, text);
  f.local(path, text);
  const pdf = `_fetched/fixture.test/${hash.slice(0, 12)}.pdf`;
  f.local(pdf, "%PDF-1.4\n");

  const result = await retire(f, { shadowed_only: true });
  assert.deepEqual(result.retired.map((entry) => entry.path), [path]);
  assert.deepEqual(result.fetched_deleted, []);
  assert.ok(existsSync(f.localPath(pdf)));
});
