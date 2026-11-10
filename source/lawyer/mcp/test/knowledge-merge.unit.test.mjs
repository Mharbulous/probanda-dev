// Merge on read (shared/knowledge-tree.md section 7, plan Phase 7): per file the
// shipped copy wins and a shadowed overlay copy is reported with `identical` compared
// after line-ending normalization; index rows merge by key with `layer` on every row
// and alias and `conflicts` on the view.

import assert from "node:assert/strict";
import test from "node:test";

import { errorOf, knowledgeFixture, knowledgeFile } from "./helpers/knowledge-fixture.mjs";

const { knowledgeList, knowledgeRead } = await import("../build/knowledge/tools.js");

const VENUE_BLOCK = {
  caption_lines: ["IN THE SUPREME COURT OF BRITISH COLUMBIA"],
  file_number_label: "No.",
  registry_label: "Vancouver Registry",
  party_roles: { plaintiff: "Plaintiff", defendant: "Defendant" },
  display_label: "BCSC",
};
const VENUE = knowledgeFile("venue: BCSC", VENUE_BLOCK, "Line one of guidance.\nLine two of guidance.\n");

test("a file in both layers is served from the shipped tree; the overlay copy is identical after CRLF/LF normalization", (t) => {
  const f = knowledgeFixture(t);
  f.shipped("draft/CAN/BC/BCSC/venue.md", VENUE);
  f.local("draft/CAN/BC/BCSC/venue.md", VENUE.replace(/\n/g, "\r\n"));
  const result = knowledgeRead("draft/CAN/BC/BCSC/venue.md", f.seams);
  assert.equal(result.layer, "shipped");
  assert.equal(result.content, VENUE);
  assert.deepEqual(result.shadowed_local, { path: f.localPath("draft/CAN/BC/BCSC/venue.md"), identical: true });
  assert.equal(result.shipped_from, "install");
  assert.equal(result.plugin_version, "9.9.9");
  assert.equal(result.build_stamp, null);
});

test("a shadowed overlay copy that differs beyond line endings reports identical: false", (t) => {
  const f = knowledgeFixture(t);
  f.shipped("draft/CAN/BC/BCSC/venue.md", VENUE);
  f.local("draft/CAN/BC/BCSC/venue.md", VENUE.replace("Line two", "Line 2").replace(/\n/g, "\r\n"));
  const result = knowledgeRead("draft/CAN/BC/BCSC/venue.md", f.seams);
  assert.equal(result.content, VENUE, "the shipped copy still wins");
  assert.equal(result.shadowed_local.identical, false);
});

test("an overlay-only file is served from the overlay with no shadowing", (t) => {
  const f = knowledgeFixture(t);
  f.local("draft/CAN/BC/BCSC/venue.md", VENUE);
  const result = knowledgeRead("draft/CAN/BC/BCSC/venue.md", f.seams);
  assert.equal(result.layer, "local");
  assert.equal(result.shadowed_local, undefined);
  assert.equal(result.shipped_from, "install", "the shipped root consulted is still reported");
});

test("venue index rows merge by code: shipped fields win, aliases union, every row and alias carries its layer", (t) => {
  const f = knowledgeFixture(t);
  f.shipped("draft/CAN/BC/venues.json", {
    jurisdiction: "BC",
    name: "British Columbia",
    venues: [
      { code: "BCSC", name: "Supreme Court of British Columbia", aliases: [{ name: "BC Supreme Court" }] },
      { code: "BCCA", name: "Court of Appeal for British Columbia", aliases: [] },
    ],
    not_venues: [
      { name: "Ministry of Attorney General", aliases: [{ name: "MAG" }], resolves_to: "_NoVenue", source: "practitioner", ref: "L8443", recorded: "2026-09-01" },
    ],
  });
  f.local("draft/CAN/BC/venues.local.json", {
    venues: [
      // A partial row: an alias for a shipped venue, plus one the shipped row already carries.
      { code: "BCSC", aliases: [
        { name: "Supreme Court", source: "practitioner", ref: "L8443", recorded: "2026-09-20" },
        { name: "B.C. Supreme Court", source: "agent", ref: "https://example.test", recorded: "2026-09-20" },
      ] },
      // A code the firm had learned before a plugin update shipped it under another name.
      { code: "BCCA", name: "BC Court of Appeal", aliases: [], source: "agent", ref: "L0002", recorded: "2026-08-01" },
      // A venue learned only in the overlay: a full row.
      { code: "BCCRT", name: "Civil Resolution Tribunal", aliases: [{ name: "CRT", source: "official", ref: "https://civilresolutionbc.ca", recorded: "2026-09-20" }], source: "agent", ref: "L8443", recorded: "2026-09-20" },
    ],
    not_venues: [
      { name: "Ministry of the Attorney General", aliases: [{ name: "AG Ministry", source: "practitioner", ref: "L8443", recorded: "2026-09-21" }], resolves_to: "_NoVenue", source: "practitioner", ref: "L8443", recorded: "2026-09-21" },
    ],
  });

  const result = knowledgeRead("draft/CAN/BC/venues.json", f.seams);
  assert.equal(result.index, "venues");
  assert.deepEqual(result.layers, { shipped: true, local: true });
  const { view } = result;
  assert.equal(view.jurisdiction, "BC");
  assert.deepEqual(view.venues.map((row) => [row.code, row.layer]), [
    ["BCSC", "shipped"], ["BCCA", "shipped"], ["BCCRT", "local"], ["_NoVenue", "shipped"],
  ]);
  const bcsc = view.venues[0];
  assert.deepEqual(bcsc.aliases.map((a) => [a.name, a.layer]), [["BC Supreme Court", "shipped"], ["Supreme Court", "local"]],
    "B.C. Supreme Court normalizes to an alias the row already carries");
  assert.equal(view.venues[1].name, "Court of Appeal for British Columbia", "the shipped name wins");
  assert.deepEqual(view.conflicts, [
    { key: "BCCA", field: "name", shipped: "Court of Appeal for British Columbia", local: "BC Court of Appeal", shadowed_local: true },
  ]);
  assert.deepEqual(view.venues[3], { code: "_NoVenue", name: "No venue", aliases: [], layer: "shipped", reserved: true });
  assert.deepEqual(view.not_venues.map((row) => [row.name, row.layer]), [
    ["Ministry of Attorney General", "shipped"],
    ["Ministry of the Attorney General", "local"],
  ]);

  // The overlay name reads the same merged view.
  assert.deepEqual(knowledgeRead("draft/CAN/BC/venues.local.json", f.seams).view, view);
});

test("kind index rows merge by file; a differing recipient under _NoVenue is a conflict", (t) => {
  const f = knowledgeFixture(t);
  f.shipped("draft/CAN/BC/_NoVenue/Documents/kinds.json", {
    kinds: [{ file: "letter-to-witness", name: "Letter to a witness", aliases: [], recipient: "witness" }],
  });
  f.local("draft/CAN/BC/_NoVenue/Documents/kinds.local.json", {
    kinds: [
      { file: "letter-to-witness", recipient: "expert", aliases: [{ name: "witness letter", source: "practitioner", ref: "L8443", recorded: "2026-09-20" }] },
      { file: "release", name: "Release", aliases: [], recipient: "opposing-party" },
    ],
  });
  const { view } = knowledgeRead("draft/CAN/BC/_NoVenue/Documents/kinds.json", f.seams);
  assert.deepEqual(view.kinds.map((row) => [row.file, row.recipient, row.layer]), [
    ["letter-to-witness", "witness", "shipped"],
    ["release", "opposing-party", "local"],
  ]);
  assert.deepEqual(view.kinds[0].aliases, [{ name: "witness letter", source: "practitioner", ref: "L8443", recorded: "2026-09-20", layer: "local" }]);
  assert.deepEqual(view.conflicts, [{ key: "letter-to-witness", field: "recipient", shipped: "witness", local: "expert" }]);
});

test("a malformed overlay index fails hard, naming the file and the field", (t) => {
  const f = knowledgeFixture(t);
  f.shipped("draft/CAN/BC/venues.json", { jurisdiction: "BC", name: "British Columbia", venues: [] });

  f.local("draft/CAN/BC/venues.local.json", { venues: [{ code: "BCHRT", aliases: [] }] });
  let err = errorOf(() => knowledgeRead("draft/CAN/BC/venues.json", f.seams));
  assert.equal(err.code, "invalid_index");
  assert.ok(err.message.includes(f.localPath("draft/CAN/BC/venues.local.json")), err.message);
  assert.match(err.message, /venues\[0\]\.name: is required/);

  f.local("draft/CAN/BC/venues.local.json", { venues: [{ code: "BCHRT", name: "Human Rights Tribunal", aliases: [{ name: "HRT" }] }] });
  err = errorOf(() => knowledgeRead("draft/CAN/BC/venues.json", f.seams));
  assert.match(err.message, /aliases\[0\]\.source: is required/, "a local alias records its provenance");

  f.local("draft/CAN/BC/_NoVenue/Documents/kinds.local.json", { kinds: [{ file: "letter-to-client", name: "Client letter", aliases: [], recipient: "client" }] });
  const { view } = knowledgeRead("draft/CAN/BC/_NoVenue/Documents/kinds.json", f.seams);
  assert.deepEqual(view.kinds.map((row) => [row.file, row.recipient]), [["letter-to-client", "client"]], "a client letter enters the tree");

  f.local("draft/CAN/BC/_NoVenue/Documents/kinds.local.json", { kinds: [{ file: "letter-to-nobody", name: "Letter", aliases: [], recipient: "nobody" }] });
  err = errorOf(() => knowledgeRead("draft/CAN/BC/_NoVenue/Documents/kinds.json", f.seams));
  assert.equal(err.code, "invalid_index");
  assert.match(err.message, /recipient: must be one of/);
});

test("index rows in either layer may carry a writer's plugin version and shipped_from, validated, and the view leaves them out", (t) => {
  const f = knowledgeFixture(t);
  const stamp = { plugin_version: "9.9.9", shipped_from: "checkout" };
  f.shipped("draft/CAN/BC/venues.json", {
    jurisdiction: "BC",
    name: "British Columbia",
    venues: [{ code: "BCSC", name: "Supreme Court of British Columbia", aliases: [], ...stamp }],
    not_venues: [{ name: "Burnaby RCMP", aliases: [], resolves_to: "_NoVenue", source: "practitioner", ref: "L8443", recorded: "2026-09-25", ...stamp }],
  });
  f.shipped("draft/CAN/BC/BCSC/Documents/kinds.json", { kinds: [{ file: "letter", name: "Letter", aliases: [], ...stamp }] });
  f.local("draft/CAN/BC/venues.local.json", { venues: [{ code: "BCCRT", name: "Civil Resolution Tribunal", aliases: [], plugin_version: null, shipped_from: "install" }, { code: "BCPC", name: "Provincial Court", aliases: [] }] });
  const venues = knowledgeRead("draft/CAN/BC/venues.json", f.seams).view;
  assert.deepEqual(venues.venues.map((venue) => venue.code), ["BCSC", "BCCRT", "BCPC", "_NoVenue"]);
  for (const row of [...venues.venues, ...venues.not_venues]) assert.equal(Object.hasOwn(row, "plugin_version") || Object.hasOwn(row, "shipped_from"), false, row.code ?? row.name);
  assert.equal(knowledgeRead("draft/CAN/BC/BCSC/Documents/kinds.json", f.seams).view.kinds[0].file, "letter");

  f.local("draft/CAN/BC/venues.local.json", { venues: [{ code: "BCCRT", name: "Civil Resolution Tribunal", aliases: [], shipped_from: "elsewhere" }] });
  let err = errorOf(() => knowledgeRead("draft/CAN/BC/venues.json", f.seams));
  assert.equal(err.code, "invalid_index");
  assert.match(err.message, /venues\[0\]\.shipped_from: must be "install" or "checkout"/);
  f.local("draft/CAN/BC/BCSC/Documents/kinds.local.json", { kinds: [{ file: "memo", name: "Memo", aliases: [], plugin_version: 9 }] });
  err = errorOf(() => knowledgeRead("draft/CAN/BC/BCSC/Documents/kinds.json", f.seams));
  assert.match(err.message, /kinds\[0\]\.plugin_version: must be a non-empty string or null/);
});

test("a local index name a shipped row shadows is also reported at the top level as shadowed_local, on read and on resolve", (t) => {
  const f = knowledgeFixture(t);
  f.shipped("draft/CAN/BC/venues.json", {
    jurisdiction: "BC",
    name: "British Columbia",
    venues: [{ code: "BCCA", name: "Court of Appeal for British Columbia", aliases: [] }],
  });
  f.local("draft/CAN/BC/venues.local.json", {
    venues: [{ code: "BCCA", name: "BC Court of Appeal", aliases: [], source: "agent", ref: "L0002", recorded: "2026-08-01" }],
  });
  const shadowed = [{ key: "BCCA", shipped: "Court of Appeal for British Columbia", local: "BC Court of Appeal" }];
  const read = knowledgeRead("draft/CAN/BC/venues.json", f.seams);
  assert.deepEqual(read.shadowed_local, shadowed);
  assert.equal(read.view.conflicts[0].shadowed_local, true, "the conflict row is kept");
  const resolved = knowledgeList({ dir: "draft/CAN/BC", resolve: "BCCA" }, f.seams);
  assert.deepEqual(resolved.shadowed_local, shadowed);

  // A conflict on another field is not a shadowed name.
  f.shipped("draft/CAN/BC/_NoVenue/Documents/kinds.json", { kinds: [{ file: "letter", name: "Letter", aliases: [], recipient: "witness" }] });
  f.local("draft/CAN/BC/_NoVenue/Documents/kinds.local.json", { kinds: [{ file: "letter", recipient: "expert" }] });
  assert.equal(knowledgeRead("draft/CAN/BC/_NoVenue/Documents/kinds.json", f.seams).shadowed_local, undefined);
});

test("a source record a dependent names that both layers hold is reported in shadowed_sources", (t) => {
  const f = knowledgeFixture(t);
  const record = "---\npage_url: https://example.test/rules\nitems:\n  - rule_ref: R-1\n    passage: A rule.\n---\n# Rules\n";
  f.shipped("draft/CAN/BC/BCSC/venue.md", knowledgeFile("sources:\n  - Sources/rules.md", VENUE_BLOCK));
  f.shipped("draft/CAN/BC/BCSC/Sources/rules.md", record);
  f.local("draft/CAN/BC/BCSC/Sources/rules.md", record.replace(/\n/g, "\r\n"));
  const result = knowledgeRead("draft/CAN/BC/BCSC/venue.md", f.seams);
  assert.equal(result.shadowed_local, undefined, "the dependent itself is in one layer");
  assert.deepEqual(result.shadowed_sources, [{ path: f.localPath("draft/CAN/BC/BCSC/Sources/rules.md"), identical: true }]);

  f.local("draft/CAN/BC/BCSC/Sources/rules.md", record.replace("A rule.", "Another rule."));
  assert.equal(knowledgeRead("draft/CAN/BC/BCSC/venue.md", f.seams).shadowed_sources[0].identical, false);
});
