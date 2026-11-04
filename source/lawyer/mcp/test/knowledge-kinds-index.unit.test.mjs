// Every shipped index (plan Phase 5, decision 3): each `kinds.json` row's `file` exists, each
// alias resolves to exactly one file, and every type file in a `Documents` folder is named by a
// row. Each `venues.json` venue has its folder, and each venue alias resolves to exactly one
// venue. Resolution is the runtime's own (knowledge/venues-kinds.ts), the one knowledge__list uses.

import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const { mergeKinds, mergeVenues, NO_VENUE, resolveKind, resolveVenue } = await import("../build/knowledge/venues-kinds.js");
const { KNOWLEDGE_SKILLS } = await import("../build/knowledge/tree.js");
const { resolveShippedRoot } = await import("../build/repo-root.js");

const dirs = (path) => readdirSync(path, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
const readJson = (path) => JSON.parse(readFileSync(path, "utf-8"));

/** Every jurisdiction folder of every shipped tree, as { skill, jurisdiction, path }. */
function jurisdictions() {
  const out = [];
  for (const skill of KNOWLEDGE_SKILLS) {
    const references = join(resolveShippedRoot(`${skill}/references`).root, skill, "references");
    if (!existsSync(references)) continue;
    for (const country of dirs(references).filter((name) => /^[A-Z]{3}$/.test(name))) {
      for (const jurisdiction of dirs(join(references, country))) {
        out.push({ skill, jurisdiction, path: join(references, country, jurisdiction), label: `${skill}/${country}/${jurisdiction}` });
      }
    }
  }
  return out;
}

test("every shipped kinds.json row names a file that exists, and each alias resolves to exactly that file", () => {
  let rows = 0;
  for (const j of jurisdictions()) {
    for (const venue of dirs(j.path)) {
      const documents = join(j.path, venue, "Documents");
      if (!existsSync(documents)) continue;
      const label = `${j.label}/${venue}/Documents/kinds.json`;
      const noVenue = venue === NO_VENUE;
      const view = mergeKinds({ doc: readJson(join(documents, "kinds.json")), file: label }, null, noVenue);
      for (const row of view.kinds) {
        rows += 1;
        assert.ok(existsSync(join(documents, `${row.file}.md`)), `${label}: row "${row.file}" names no file`);
        for (const alias of row.aliases) {
          const resolved = resolveKind(view, alias.name, j.jurisdiction, noVenue, noVenue ? row.recipient : undefined);
          assert.equal(resolved.result, "resolved", `${label}: alias "${alias.name}" -> ${JSON.stringify(resolved)}`);
          assert.equal(resolved.code, row.file, `${label}: alias "${alias.name}" resolves to another file`);
        }
      }
      const named = new Set(view.kinds.map((row) => `${row.file}.md`));
      const typeFiles = readdirSync(documents).filter((name) => name.endsWith(".md"));
      assert.deepEqual(typeFiles.filter((name) => !named.has(name)), [], `${label}: type files no row names`);
    }
  }
  assert.ok(rows > 0, "the shipped tree holds kinds rows");
});

test("every shipped venues.json venue has its folder, and each alias resolves to exactly that venue", () => {
  for (const j of jurisdictions()) {
    const label = `${j.label}/venues.json`;
    const view = mergeVenues({ doc: readJson(join(j.path, "venues.json")), file: label }, null);
    const venues = view.venues.filter((row) => !row.reserved);
    assert.ok(venues.length > 0, `${label} lists venues`);
    for (const row of venues) {
      assert.ok(existsSync(join(j.path, row.code)), `${label}: venue "${row.code}" has no folder`);
      for (const alias of row.aliases) {
        const resolved = resolveVenue(view, alias.name, j.jurisdiction);
        assert.equal(resolved.result, "resolved", `${label}: alias "${alias.name}" -> ${JSON.stringify(resolved)}`);
        assert.equal(resolved.code, row.code, `${label}: alias "${alias.name}" resolves to another venue`);
      }
    }
    const listed = new Set(venues.map((row) => row.code));
    assert.deepEqual(dirs(j.path).filter((name) => name !== NO_VENUE && !listed.has(name)), [], `${label}: venue folders it does not list`);
  }
});

test("mergeKinds refuses a row whose file ends in .md, in either layer, naming the file and the stem", () => {
  const index = (file) => ({ doc: { kinds: [{ file, name: "Notice", aliases: [{ name: "Notice", source: "official" }] }] }, file: "kinds.json" });
  const local = (file) => ({ doc: { kinds: [{ file, name: "Notice", aliases: [{ name: "Notice", source: "practitioner" }] }] }, file: "kinds.local.json" });
  const refused = (file, message) => (error) => {
    assert.equal(error.code, "grammar_violation");
    assert.ok(error.message.includes(file) && error.message.includes(message), error.message);
    return true;
  };
  assert.throws(() => mergeKinds(index("x.md"), null, false), refused("kinds.json", '"x"'));
  assert.throws(() => mergeKinds(null, local("x.md"), false), refused("kinds.local.json", '"x"'));
  assert.throws(() => mergeKinds(index("x"), local("x.md"), false), refused("kinds.local.json", '"x"'));
});
