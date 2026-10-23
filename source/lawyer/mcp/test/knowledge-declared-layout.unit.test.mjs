// Every shipped layout block validates (plan Phase 5; grows with Phases 7, 16, 19 and 20): each
// `venue.md` block and each `Documents` type file block in /draft's shipped tree passes the
// runtime's single validator (knowledge/declared-layout.ts). Every tree folder and file name holds
// only letters, digits, `.`, `_` and `-` (shared/knowledge-tree.md "Name characters"). And each
// shipped venue's heading fields print the caption bytes its forum branch printed before Phase 16.
//
// /publish's shipped tree (plan Phase 19): each venue's `format.md` block passes the format
// validator (knowledge/declared-format.ts) and reads through knowledge__read, every item
// practitioner-sourced and pointing at an in-repo file; and each BCSC form-identity file records
// its form number, title, registry key, version and shipped template, a version being either
// `not recorded` or the sha256 of the on-disk official PDF it names, and never a filler.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { extractJsonBlock, validateTypeBlock, validateVenueBlock } = await import("../build/knowledge/declared-layout.js");
const { validateFormatBlock } = await import("../build/knowledge/declared-format.js");
const { NO_VENUE } = await import("../build/knowledge/index.js");
const { knowledgeRead } = await import("../build/knowledge/tools.js");
const { readFrontMatter } = await import("../build/sources/check.js");
const { resolveShippedRoot } = await import("../build/repo-root.js");
const { styleOfProceedingCaption } = await import("../build/submission/forms/components.js");
const { scalarValue } = await import("../build/submission/forms/layout-snapshot.js");

const references = join(resolveShippedRoot("draft/references").root, "draft", "references");
const publishSkill = join(resolveShippedRoot("publish/references").root, "publish");
const publishReferences = join(publishSkill, "references");
const dirs = (path) => readdirSync(path, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
const block = (path, label) => extractJsonBlock(readFileSync(path, "utf-8"), label, true);

/** Every venue folder of /draft's shipped tree, as { key, path }. */
function venues() {
  const out = [];
  for (const country of dirs(references).filter((name) => /^[A-Z]{3}$/.test(name))) {
    for (const jurisdiction of dirs(join(references, country))) {
      for (const venue of dirs(join(references, country, jurisdiction))) {
        out.push({ key: `${country}/${jurisdiction}/${venue}`, venue, path: join(references, country, jurisdiction, venue) });
      }
    }
  }
  return out;
}

test("every shipped venue.md block and type file block validates", () => {
  let types = 0;
  for (const v of venues()) {
    if (v.venue !== NO_VENUE) {
      const label = `draft/${v.key}/venue.md`;
      validateVenueBlock(block(join(v.path, "venue.md"), label), label);
    }
    for (const name of readdirSync(join(v.path, "Documents")).filter((n) => n.endsWith(".md"))) {
      const label = `draft/${v.key}/Documents/${name}`;
      validateTypeBlock(block(join(v.path, "Documents", name), label), label, { noVenue: v.venue === NO_VENUE });
      types += 1;
    }
  }
  assert.ok(types > 0, "the shipped tree holds type files");
});

test("ingest_inputs outside the folder vocabulary, or empty, fails invalid_layout naming the file and field", () => {
  const base = { renderer: "bespoke", needs_forum_parts: true, title: "Notice of Application", exhibit_numbering: "writing" };
  for (const [ingest_inputs, field] of [[["6. LAW*"], "ingest_inputs[0]"], [[], "ingest_inputs"]]) {
    assert.throws(
      () => validateTypeBlock({ ...base, ingest_inputs }, "x.md", { noVenue: false }),
      (err) => err.code === "invalid_layout" && err.message.startsWith(`x.md: ${field}: `),
      JSON.stringify(ingest_inputs)
    );
  }
});

test("every shipped tree folder and file name holds only letters, digits, '.', '_' and '-'", () => {
  const bad = [];
  const walk = (path, rel) => {
    for (const name of readdirSync(path)) {
      if (!/^[A-Za-z0-9._-]+$/.test(name)) bad.push(`${rel}/${name}`);
      if (statSync(join(path, name)).isDirectory()) walk(join(path, name), `${rel}/${name}`);
    }
  };
  for (const root of [references, publishReferences]) {
    for (const country of dirs(root).filter((name) => /^[A-Z]{3}$/.test(name))) walk(join(root, country), country);
  }
  assert.deepEqual(bad, []);
});

/** Every venue folder of /publish's shipped tree, _NoVenue included, as { key, venue, path }. */
function publishVenues() {
  const out = [];
  for (const country of dirs(publishReferences).filter((name) => /^[A-Z]{3}$/.test(name))) {
    for (const jurisdiction of dirs(join(publishReferences, country))) {
      for (const venue of dirs(join(publishReferences, country, jurisdiction))) {
        out.push({ key: `${country}/${jurisdiction}/${venue}`, venue, path: join(publishReferences, country, jurisdiction, venue) });
      }
    }
  }
  return out;
}

/** knowledge__read against the shipped tree, with an empty firm overlay. */
function readShipped(t, path) {
  const scratch = mkdtempSync(join(tmpdir(), "coclerk-publish-tree-"));
  t.after(() => rmSync(scratch, { recursive: true, force: true }));
  const caseRoot = join(scratch, "case");
  mkdirSync(caseRoot);
  mkdirSync(join(scratch, "Coclerk"));
  writeFileSync(join(scratch, "Coclerk", "coclerk.json"), JSON.stringify({ case_data_root: caseRoot }));
  return knowledgeRead(path, { env: { ...process.env, APPDATA: scratch } });
}

test("every shipped /publish format.md block validates, reads, and cites only practitioner items pointing at in-repo files", (t) => {
  const venues = publishVenues();
  assert.ok(venues.some((v) => v.venue === NO_VENUE), "the /publish tree ships _NoVenue/format.md");
  for (const v of venues) {
    const label = `publish/${v.key}/format.md`;
    const content = readFileSync(join(v.path, "format.md"), "utf-8");
    validateFormatBlock(extractJsonBlock(content, label, false, "invalid_format"), label);
    const result = readShipped(t, label);
    assert.equal(result.learned, false, `${label} ships vetted`);
    for (const item of readFrontMatter(content, label)?.items ?? []) {
      assert.equal(item.source, "practitioner", `${label}: ${item.rule_ref} is practitioner-sourced`);
      assert.ok(existsSync(join(publishSkill, item.ref)), `${label}: ${item.rule_ref} points at ${item.ref}, which exists`);
    }
  }
});

test("each shipped BCSC form-identity file records its form, version and template, and names no filler", (t) => {
  const documents = join(publishReferences, "CAN", "BC", "BCSC", "Documents");
  const files = readdirSync(documents).filter((name) => name.endsWith(".md"));
  assert.ok(files.length > 0, "the /publish tree ships BCSC form-identity files");
  for (const name of files) {
    const label = `publish/CAN/BC/BCSC/Documents/${name}`;
    const front = readFrontMatter(readFileSync(join(documents, name), "utf-8"), label);
    const pinned = front.version !== "not recorded";
    // ADR 0038: emitter, type_file and conformed_to are optional, on the forms /draft emits.
    const optional = ["emitter", "type_file", "conformed_to"];
    assert.deepEqual(
      Object.keys(front).filter((key) => !optional.includes(key)).sort(),
      ["form_key", "form_number", "template", "title", "version", ...(pinned ? ["version_source"] : [])].sort(),
      `${label}: fields`
    );
    assert.match(front.form_number, /^\d+(\.\d+)*$/, `${label}: form_number`);
    assert.ok(existsSync(join(publishSkill, front.template)), `${label}: template ${front.template} exists`);
    if (pinned) {
      const pdf = join(publishSkill, front.version_source);
      assert.match(front.version_source, /^subskills\/publish-bcsc-form\/forms\/[^/]+\/form-\d+-official\.pdf$/, `${label}: version_source`);
      assert.equal(front.version, `sha256:${createHash("sha256").update(readFileSync(pdf)).digest("hex")}`, `${label}: version pins the PDF`);
    }
    assert.ok(!Object.values(front).some((value) => typeof value === "string" && value.endsWith(".py")), `${label} names no filler`);
    readShipped(t, label);
  }
});

// The caption each forum branch of components.ts printed before Phase 16 moved them into venue.md,
// for registry "Vancouver", file number "X-1", title "TITLE" and no parties.
const HEAD = ["| | | |", "| :--- | :---: | ---: |"];
const BRANCH_CAPTIONS = {
  "CAN/BC/BCSC": [...HEAD, "| | | Vancouver Registry |", "| | | No. X-1 |", "| | **IN THE SUPREME COURT OF BRITISH COLUMBIA** | |", "| | **TITLE** | |"],
  "CAN/BC/BCCA": [
    ...HEAD,
    "| | | Vancouver Registry |",
    "| | | Court of Appeal File No. X-1 |",
    "| | **IN THE COURT OF APPEAL FOR BRITISH COLUMBIA** | |",
    "| | **TITLE** | |",
  ],
  "CAN/BC/Vancouver-International-Arbitration-Centre": [
    ...HEAD,
    // A registry-less venue prints its file-number row from a stored number (#1246); the label is Brahm's (#1248).
    "| | | VanIAC File No. X-1 |",
    "| | **IN AN ARBITRATION UNDER THE VANIAC DOMESTIC ARBITRATION RULES** | |",
    "| | **(EXPEDITED PROCEDURES, PART B)** | |",
    "| | **TITLE** | |",
  ],
};

test("each shipped venue's heading fields print the caption bytes its forum branch printed", () => {
  const shipped = venues().filter((x) => x.venue !== NO_VENUE);
  assert.deepEqual(shipped.map((v) => v.key).sort(), Object.keys(BRANCH_CAPTIONS).sort(), "every shipped venue has its branch caption pinned");
  for (const v of shipped) {
    const fields = block(join(v.path, "venue.md"), v.key);
    const heading = Object.fromEntries(["caption_lines", "file_number_label", "registry_label"].map((k) => [k, scalarValue(fields[k])]));
    const caption = styleOfProceedingCaption([], { heading, registry: "Vancouver", fileNumber: "X-1", titleLine: "TITLE" });
    assert.equal(caption, BRANCH_CAPTIONS[v.key].join("\n"), v.key);
  }
});
