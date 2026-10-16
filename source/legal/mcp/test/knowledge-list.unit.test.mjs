// knowledge__list (spec §3.2, plan Phase 7): both layers merged per folder, each entry
// with its layers, and every entry that breaks the folder grammar reported -- a
// OneDrive conflict copy, an index file under the wrong layer's name, a type file no
// kinds row names, a folder refused under _NoVenue, a sidecar in the shipped tree.

import assert from "node:assert/strict";
import { mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { errorOf, knowledgeFixture, matterFixture, useProcessEnv } from "./helpers/knowledge-fixture.mjs";

const { knowledgeList } = await import("../build/knowledge/tools.js");
const { callTool } = await import("../build/dispatch.js");

function fixture(t) {
  const f = knowledgeFixture(t);
  // Shipped: the skill's ordinary references beside its tree, and the tree itself.
  f.shipped("draft/letters.md", "# Letters\n");
  f.shipped("draft/CAN/BC/venues.json", { jurisdiction: "BC", name: "British Columbia", venues: [] });
  f.shipped("draft/CAN/BC/BCSC/venue.md", "# BCSC\n");
  f.shipped("draft/CAN/BC/BCSC/Documents/kinds.json", { kinds: [{ file: "notice-of-application", name: "Notice of Application", aliases: [] }] });
  f.shipped("draft/CAN/BC/BCSC/Documents/notice-of-application.md", "# NOA\n");
  f.shipped("draft/CAN/BC/BCSC/Documents/notice-of-application.md.confirmations.local.json", "{}");
  // Overlay.
  f.local("draft/CAN/BC/venues.local.json", { venues: [] });
  f.local("draft/CAN/BC/venues.json", { venues: [] });
  f.local("draft/CAN/BC/BCSC/venue.md", "# BCSC, the firm's copy\n");
  f.local("draft/CAN/BC/BCSC/venue-DESKTOP-4F2K9.md", "# a OneDrive conflict copy\n");
  f.local("draft/CAN/BC/BCSC/Documents/notice-of-application.md.confirmations.local.json", "{}");
  f.local("draft/CAN/BC/BCSC/Documents/orphan.md", "# no kinds row names me\n");
  f.local("draft/CAN/BC/_NoVenue/Locations/Vancouver/notes.md", "# refused\n");
  f.local("draft/CAN/BC/_NoVenue/Documents/kinds.local.json", { kinds: [] });
  f.local("_hosts.json", []);
  f.local("_fetched/www.bclaws.gov.bc.ca/0123456789ab.pdf", "%PDF-1.4\n");
  f.local("_fetched/www.bclaws.gov.bc.ca/notes.txt", "stray\n");
  f.local("scratch.txt", "stray at the overlay root\n");
  return f;
}

const byPath = (result) => Object.fromEntries(result.entries.map((entry) => [entry.path, entry.layers]));

test("a folder lists both layers merged, each entry with its layers, and provenance", (t) => {
  const f = fixture(t);
  const result = knowledgeList({ dir: "draft/CAN/BC/BCSC" }, f.seams);
  assert.deepEqual(byPath(result), {
    "draft/CAN/BC/BCSC/Documents": ["shipped", "local"],
    "draft/CAN/BC/BCSC/venue-DESKTOP-4F2K9.md": ["local"],
    "draft/CAN/BC/BCSC/venue.md": ["shipped", "local"],
  });
  assert.deepEqual(result.grammar_breaks, [
    { path: "draft/CAN/BC/BCSC/venue-DESKTOP-4F2K9.md", layer: "local", reason: '"venue-DESKTOP-4F2K9.md" is not a venue file (venue.md in /draft\'s tree, format.md in /publish\'s)' },
  ]);
  assert.deepEqual([result.shipped_from, result.plugin_version, result.build_stamp], ["install", "9.9.9", null]);
});

test("index files under the wrong layer's name, unindexed type files and shipped sidecars are grammar breaks", (t) => {
  const f = fixture(t);
  const jurisdiction = knowledgeList({ dir: "draft/CAN/BC" }, f.seams);
  assert.deepEqual(
    jurisdiction.grammar_breaks.map((b) => [b.path, b.layer, b.reason]),
    [["draft/CAN/BC/venues.json", "local", "the overlay never holds venues.json; it writes venues.local.json"]]
  );

  const documents = knowledgeList({ dir: "draft/CAN/BC/BCSC/Documents" }, f.seams);
  assert.deepEqual(
    documents.grammar_breaks.map((b) => [b.path, b.layer, b.reason]).sort(),
    [
      ["draft/CAN/BC/BCSC/Documents/notice-of-application.md.confirmations.local.json", "shipped", "a confirmation sidecar never ships"],
      ["draft/CAN/BC/BCSC/Documents/orphan.md", "local", 'no row of this folder\'s kinds index names "orphan"'],
    ]
  );
});

test("a recursive walk reports breaks all the way down and skips a shipped root's ordinary references", (t) => {
  const f = fixture(t);
  const result = knowledgeList({ dir: "draft", recursive: true }, f.seams);
  const paths = result.entries.map((entry) => entry.path);
  assert.ok(!paths.includes("draft/letters.md"), "a shipped root's non-tree references are not the tree");
  assert.ok(paths.includes("draft/CAN/BC/BCSC/Documents/notice-of-application.md"));
  const breaks = result.grammar_breaks.map((b) => b.path);
  assert.ok(breaks.includes("draft/CAN/BC/_NoVenue/Locations"), JSON.stringify(result.grammar_breaks));
  assert.ok(!paths.includes("draft/CAN/BC/_NoVenue/Locations/Vancouver"), "a broken folder is not walked");
  assert.ok(breaks.includes("draft/CAN/BC/BCSC/venue-DESKTOP-4F2K9.md"));
  assert.ok(breaks.includes("draft/CAN/BC/BCSC/Documents/orphan.md"));
});

test("the knowledge root lists the tree-owning skills and the overlay's reserved entries", (t) => {
  const f = fixture(t);
  const result = knowledgeList({}, f.seams);
  assert.deepEqual(byPath(result), {
    _fetched: ["local"],
    "_hosts.json": ["local"],
    assemble: ["shipped"],
    "docket-clerk": ["shipped"],
    draft: ["shipped", "local"],
    "legal-research": ["shipped"],
    publish: ["shipped"],
  });
  assert.equal(result.entries.find((entry) => entry.path === "draft").shipped_from, "install");
  assert.deepEqual(result.grammar_breaks, [
    { path: "scratch.txt", layer: "local", reason: '"scratch.txt" is neither a skill with a knowledge tree nor a reserved entry (_superseded, _fetched, _inbox, _hosts.json)' },
  ]);
  const fetched = knowledgeList({ dir: "_fetched", recursive: true }, f.seams);
  assert.deepEqual(fetched.grammar_breaks.map((b) => b.path), ["_fetched/www.bclaws.gov.bc.ca/notes.txt"]);
  assert.equal(fetched.shipped_from, null);
});

test("a folder in neither layer is not_found; recipient without resolve is refused", (t) => {
  const f = fixture(t);
  assert.equal(errorOf(() => knowledgeList({ dir: "draft/CAN/ON" }, f.seams)).code, "not_found");
  assert.equal(errorOf(() => knowledgeList({ dir: "draft/CAN/BC", recipient: "witness" }, f.seams)).name, "ValidationError");
  assert.equal(errorOf(() => knowledgeList({ dir: "draft/CAN/BC/venues.json" }, f.seams)).code, "not_a_folder");
});

test("a child junction out of the case data root inside a listed overlay folder fails the listing hard", (t) => {
  const f = fixture(t);
  const outside = join(f.scratch, "elsewhere", "Locations");
  mkdirSync(outside, { recursive: true });
  symlinkSync(outside, f.localPath("draft/CAN/BC/BCSC/Locations"), "junction");
  const err = errorOf(() => knowledgeList({ dir: "draft/CAN/BC/BCSC" }, f.seams));
  assert.equal(err.code, "path_out_of_scope");
  assert.match(err.message, /resolves outside its permitted root/);
});

// ------------------------------------------------------------ no per-user coclerk.json --
// Through callTool, so the dispatch wiring is exercised; the shipped layer is the checkout's.

async function rejection(promise) {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error("expected a rejection, got none");
}

const CANNOT_LOCATE = /Cannot locate the practice database: .*coclerk\.json not found/;

test("with no per-user coclerk.json, knowledge__list given matter_root lists the overlay under the matter pointer's 0. CASE DATA folder", async (t) => {
  const f = knowledgeFixture(t);
  useProcessEnv(t, f, { userFile: false });
  const { matterRoot } = matterFixture(f);
  f.local("draft/CAN/BC/venues.local.json", { venues: [] });
  const result = await callTool({}, "knowledge__list", { dir: "draft/CAN/BC", matter_root: matterRoot });
  assert.deepEqual(byPath(result)["draft/CAN/BC/venues.local.json"], ["local"]);
  assert.deepEqual(byPath(result)["draft/CAN/BC/venues.json"], ["shipped"]);
});

test("with no per-user coclerk.json and no matter_root, both tools fail as before", async (t) => {
  const f = knowledgeFixture(t);
  useProcessEnv(t, f, { userFile: false });
  assert.match((await rejection(callTool({}, "knowledge__list", { dir: "draft/CAN/BC" }))).message, CANNOT_LOCATE);
  assert.match((await rejection(callTool({}, "knowledge__read", { path: "_hosts.json" }))).message, CANNOT_LOCATE);
});

test("a case_data_dir whose parent is not a 0. CASE DATA folder derives nothing, unless COCLERK_CASE_DATA_ROOT names that parent", async (t) => {
  const f = knowledgeFixture(t);
  useProcessEnv(t, f, { userFile: false });
  const elsewhere = join(f.scratch, "Case Files");
  mkdirSync(join(elsewhere, "L1 Test"), { recursive: true });
  const { matterRoot } = matterFixture(f, { case_data_dir: join(elsewhere, "L1 Test") });
  const err = await rejection(callTool({}, "knowledge__list", { dir: "draft/CAN/BC", matter_root: matterRoot }));
  assert.match(err.message, CANNOT_LOCATE);

  process.env.COCLERK_CASE_DATA_ROOT = elsewhere;
  const listed = await callTool({}, "knowledge__list", { dir: "draft/CAN/BC", matter_root: matterRoot });
  assert.deepEqual(byPath(listed)["draft/CAN/BC/venues.json"], ["shipped"]);
});
