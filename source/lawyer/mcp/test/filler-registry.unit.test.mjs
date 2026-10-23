// The filler registry (spec §6 piece 7, plan Phase 5): fillers are keyed by venue key plus stored
// kind. Every registered key has a shipped type file declaring `bespoke`, and every shipped
// `bespoke` type file has a registered key. A `bespoke` type with no filler fails at compose,
// naming the venue, the kind and the missing filler; a `_NoVenue` type never has one. No type
// declares a folder code: each Writing's folder is named after the document (spec 2026-10-22).

import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { errorOf, knowledgeFile, knowledgeFixture } from "./helpers/knowledge-fixture.mjs";

const { composeFiller, fillerName, REGISTERED_FILLERS, resolveTypeFile } = await import("../build/submission/forms/filler-registry.js");
const { extractJsonBlock } = await import("../build/knowledge/declared-layout.js");
const { resolveShippedRoot } = await import("../build/repo-root.js");

/** Every `Documents/kinds.json` row in /draft's shipped tree, as { venue, row, block }. */
function shippedTypeFiles() {
  const references = join(resolveShippedRoot("draft/references").root, "draft", "references");
  const dirs = (path) => readdirSync(path, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  const out = [];
  for (const country of dirs(references).filter((name) => /^[A-Z]{3}$/.test(name))) {
    for (const jurisdiction of dirs(join(references, country))) {
      for (const venue of dirs(join(references, country, jurisdiction))) {
        const documents = join(references, country, jurisdiction, venue, "Documents");
        if (!existsSync(join(documents, "kinds.json"))) continue;
        for (const row of JSON.parse(readFileSync(join(documents, "kinds.json"), "utf-8")).kinds) {
          const path = join(documents, `${row.file}.md`);
          out.push({ venue: `${country}/${jurisdiction}/${venue}`, row, block: extractJsonBlock(readFileSync(path, "utf-8"), path, true) });
        }
      }
    }
  }
  return out;
}

test("every registered key has a shipped type file declaring bespoke, and composes to its filler", () => {
  assert.ok(REGISTERED_FILLERS.length > 0);
  for (const key of REGISTERED_FILLERS) {
    const composed = composeFiller(key.venue, key.kind);
    assert.equal(composed.block.renderer, "bespoke", `${fillerName(key)}: ${composed.file}`);
    assert.equal(typeof composed.filler, "function");
  }
});

test("every shipped bespoke type file has a registered key", () => {
  const files = shippedTypeFiles();
  assert.ok(files.length > 0, "the shipped tree holds type files");
  for (const { venue, row, block } of files.filter((f) => f.block.renderer === "bespoke")) {
    const registered = row.aliases.filter((alias) => REGISTERED_FILLERS.some((key) => key.venue === venue && key.kind === alias.name));
    assert.equal(registered.length, 1, `${venue}/Documents/${row.file}.md declares bespoke; exactly one of its aliases must be a registered kind`);
  }
});

test("no registered type declares a folder code: each Writing's folder is named after the document", () => {
  for (const key of REGISTERED_FILLERS) assert.equal(Object.hasOwn(resolveTypeFile(key.venue, key.kind).block, "folder_code"), false, key.kind);
});

test("each registered type declares the companions the render path's retired kind list implied", () => {
  const companions = Object.fromEntries(REGISTERED_FILLERS.map((key) => [key.kind, resolveTypeFile(key.venue, key.kind).block.companions ?? []]));
  assert.deepEqual(companions, {
    submissions_package: [],
    notice_of_application: ["written-arguments"],
    requisition_default_judgment: ["written-arguments"],
    requisition_consent: ["written-arguments"],
    application_response: ["written-arguments"],
    bcca_stay_response: [],
    bcca_factum: [],
  });
});

const BESPOKE = { renderer: "bespoke", needs_forum_parts: true, folder_code: "FIX", title: "Fixture", exhibit_numbering: "writing" };

test("a general type never composes: it renders from the Writing's stored layout", (t) => {
  const f = knowledgeFixture(t);
  f.shipped("draft/CAN/BC/Fixture-Venue/Documents/kinds.json", {
    kinds: [{ file: "fixture-letter", name: "Fixture letter", aliases: [{ name: "fixture_letter" }] }],
  });
  f.shipped(
    "draft/CAN/BC/Fixture-Venue/Documents/fixture-letter.md",
    knowledgeFile(null, {
      ...BESPOKE,
      renderer: "general",
      parts: [{ heading: null, heading_numbering: "none", paragraph_numbering: "none", source: "slot:body" }],
    })
  );
  const err = errorOf(() => composeFiller("CAN/BC/Fixture-Venue", "fixture_letter", f.seams));
  assert.equal(err.code, "no_renderer");
  assert.match(err.message, /a general type renders from the Writing's stored layout snapshot/);
});

test("a bespoke fixture type with no filler fails at compose, naming venue, kind and the missing filler", (t) => {
  const f = knowledgeFixture(t);
  f.shipped("draft/CAN/BC/Fixture-Venue/Documents/kinds.json", {
    kinds: [{ file: "fixture-kind", name: "Fixture kind", aliases: [{ name: "fixture_kind" }] }],
  });
  f.shipped("draft/CAN/BC/Fixture-Venue/Documents/fixture-kind.md", knowledgeFile(null, BESPOKE));

  assert.equal(resolveTypeFile("CAN/BC/Fixture-Venue", "fixture_kind", f.seams).block.renderer, "bespoke");
  const err = errorOf(() => composeFiller("CAN/BC/Fixture-Venue", "fixture_kind", f.seams));
  assert.equal(err.code, "no_filler");
  assert.match(err.message, /venue CAN\/BC\/Fixture-Venue/);
  assert.match(err.message, /kind fixture_kind/);
  assert.ok(err.message.includes(`the missing filler is "${fillerName({ venue: "CAN/BC/Fixture-Venue", kind: "fixture_kind" })}"`), err.message);
});

test("a _NoVenue bespoke type never has a filler", (t) => {
  const f = knowledgeFixture(t);
  f.shipped("draft/CAN/BC/_NoVenue/Documents/kinds.json", {
    kinds: [{ file: "internal-memo", name: "Internal memo", aliases: [{ name: "internal_memo" }], recipient: "internal" }],
  });
  f.shipped("draft/CAN/BC/_NoVenue/Documents/internal-memo.md", knowledgeFile(null, { ...BESPOKE, needs_forum_parts: false }));
  const err = errorOf(() => composeFiller("CAN/BC/_NoVenue", "internal_memo", f.seams));
  assert.equal(err.code, "no_filler");
});

test("a stored kind no kinds row lists, and a forum that is no tree key, fail hard", (t) => {
  const f = knowledgeFixture(t);
  f.shipped("draft/CAN/BC/Fixture-Venue/Documents/kinds.json", {
    kinds: [{ file: "fixture-kind", name: "Fixture kind", aliases: [{ name: "fixture_kind" }] }],
  });
  const unlisted = errorOf(() => resolveTypeFile("CAN/BC/Fixture-Venue", "requisition", f.seams));
  assert.equal(unlisted.code, "kind_unresolved");
  assert.match(unlisted.message, /no row lists kind "requisition"/);
  const legacy = errorOf(() => resolveTypeFile("bcsc", "notice_of_application", f.seams));
  assert.equal(legacy.code, "invalid_forum");
});
