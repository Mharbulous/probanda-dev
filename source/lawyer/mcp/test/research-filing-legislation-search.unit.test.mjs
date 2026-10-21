// research_filing__legislation_search: a read-only full-text search of one instrument held in a
// matter. The fixture is a synthetic "Fixture Act" in the shape research_filing__file_fetched files a
// BC Laws page: a `---` header, then one block per line, a table of contents whose numbers are glued
// to their titles, numbered sections with their headings on the line before, and a schedule whose
// paragraphs number again from 1. PDFs go through an injected extractor, so no host Python runs.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { drawImage, imagePdfBytes } from "./helpers/synthetic-docs.mjs";

const { legislationSearch } = await import("../build/files/legislation-search.js");
const { buildToolDefinitions } = await import("../build/schema-gen.js");

const middle = [4, 6, 7, 8, 9, 10, 11].flatMap((n) => [`Fixture heading ${n}`, `${n} Fixture provision number ${n} applies.`]);
const ACT = [
  "---",
  'url: "https://fixture.test/act"',
  'final_url: "https://fixture.test/act"',
  'sha256: "0000"',
  'fetched_at: "2026-10-05T12:00:00.000Z"',
  'currency_marker: "current to September 30, 2026"',
  "---",
  "Fixture Act",
  "[SBC 2099] CHAPTER 1",
  "This Act is current to September 30, 2026",
  "Contents",
  "1Definitions",
  "2Application",
  "Part 1 — Interpretation",
  "Definitions",
  "1 In this Act:",
  '"court" means the Supreme Court;',
  '"party" means a person named in a proceeding.',
  "Application",
  "2 This Act applies to every proceeding.",
  "Fixture rule",
  "2.1 A party may apply to the court.",
  "Part 2 — Proceedings",
  "Commencement",
  "3 (1) A proceeding is commenced by filing a notice.",
  "(2) The notice must be served within 30 days.",
  ...middle.slice(0, 2),
  "Referral to an arbitrator",
  "5 (1) The court may refer a question to an arbitrator.",
  "(2) An arbitrator's report binds the parties.",
  ...middle.slice(2),
  "Commencement of this Act",
  "12 This Act comes into force by regulation.",
  "Schedule 1",
  "Form of notice",
  "1 The notice must name each party.",
  "2 The notice must be signed by a party or counsel.",
  "",
].join("\n");

function setup(t) {
  const matter = mkdtempSync(join(tmpdir(), "coclerk-legislation-search-"));
  t.after(() => rmSync(matter, { recursive: true, force: true }));
  writeFileSync(join(matter, "coclerk.json"), "{}");
  const law = join(matter, "6. LAW", "Issue");
  const books = join(matter, "4. APPEAL", "Books");
  const privileged = join(matter, "privileged");
  for (const dir of [law, books, privileged]) mkdirSync(dir, { recursive: true });
  const act = join(law, "Fixture Act, SBC 2099, c 1.md");
  writeFileSync(act, ACT);
  return { matter, law, books, privileged, act };
}

function codeOf(fn) {
  try {
    fn();
  } catch (err) {
    return err.code;
  }
  return "no error";
}

test("a term hit returns each section holding it, whole, with its heading", (t) => {
  const s = setup(t);
  const r = legislationSearch(s.matter, s.act, ["arbitrator"]);
  assert.equal(r.source, "md");
  assert.deepEqual(
    r.hits.map((h) => [h.block, h.section, h.heading]),
    [[1, "5", "Referral to an arbitrator"]]
  );
  assert.equal(
    r.hits[0].text,
    "5 (1) The court may refer a question to an arbitrator.\n(2) An arbitrator's report binds the parties."
  );
  assert.deepEqual(r.hits[0].matched, ["arbitrator"]);
  assert.equal(r.hits[0].page, null);
});

test("a search with no hit still reports every section searched, by block", (t) => {
  const s = setup(t);
  const r = legislationSearch(s.matter, s.act, ["stay of proceedings", "suspend"]);
  assert.deepEqual(r.hits, []);
  assert.deepEqual(r.sections_searched, {
    count: 15,
    blocks: [
      { block: 1, heading: "Definitions", first: "1", last: "12", count: 13 },
      { block: 2, heading: "Form of notice", first: "1", last: "2", count: 2 },
    ],
  });
  assert.equal(r.terms.length, 2);
  // The title, citation, currency line and the glued table of contents are searched but unsectioned.
  assert.equal(r.unsectioned_lines, 7);
  assert.ok(r.lines_searched > 30);
  assert.match(r.sha256, /^[0-9a-f]{64}$/);
});

test("the filed page's header is not searched", (t) => {
  const s = setup(t);
  assert.deepEqual(legislationSearch(s.matter, s.act, "final_url").hits, []);
});

test("a regex and terms are OR-ed and case-insensitive", (t) => {
  const s = setup(t);
  const r = legislationSearch(s.matter, s.act, ["SUPREME COURT"], "within \\d+ days");
  assert.deepEqual(
    r.hits.map((h) => [h.section, h.matched]),
    [
      ["1", ["SUPREME COURT"]],
      ["3", ["/within \\d+ days/"]],
    ]
  );
  assert.equal(r.regex, "within \\d+ days");
});

test("a schedule numbering again from 1 is its own block", (t) => {
  const s = setup(t);
  const r = legislationSearch(s.matter, s.act, ["name each party"]);
  assert.deepEqual(
    r.hits.map((h) => [h.block, h.section, h.heading]),
    [[2, "1", "Form of notice"]]
  );
});

test("a PDF anywhere in the matter is searched over its page range, with page numbers", (t) => {
  const s = setup(t);
  const book = join(s.books, "Book of Authorities.pdf");
  writeFileSync(book, "%PDF-1.4\n%%EOF\n");
  const filler = " Fixture filler text.".repeat(40);
  const pages = [
    `Index of authorities${filler}`,
    `Fixture Act\nDefinitions\n1 In this Act, "court" means the Supreme Court.${filler}`,
    `Referral\n2 The court may refer a question to an arbitrator.${filler}`,
    `Another decision mentions an arbitrator.${filler}`,
  ];
  const extractPages = () => pages;
  const r = legislationSearch(s.matter, book, ["arbitrator"], undefined, "2-3", { extractPages });
  assert.equal(r.source, "pdf");
  assert.deepEqual(r.pages, { first: 2, last: 3 });
  assert.deepEqual(r.hits.map((h) => [h.section, h.page]), [["2", 3]]);
  assert.deepEqual(r.sections_searched.blocks, [{ block: 1, heading: "Definitions", first: "1", last: "2", count: 2 }]);

  assert.equal(codeOf(() => legislationSearch(s.matter, book, ["x"], undefined, "3-9", { extractPages })), "invalid_argument");
  const scanned = () => ["a", "b"];
  assert.equal(codeOf(() => legislationSearch(s.matter, book, ["x"], undefined, undefined, { extractPages: scanned })), "ocr_unavailable");
});

test("until the in-server extractor lands, a PDF or .docx is refused, never read through host pypdf", (t) => {
  const s = setup(t);
  for (const name of ["Book of Authorities.pdf", "Fixture Act.docx"]) {
    const file = join(s.books, name);
    writeFileSync(file, "%PDF-1.4\n%%EOF\n");
    assert.equal(codeOf(() => legislationSearch(s.matter, file, ["court"])), "extractor_unavailable");
  }
});

test("an OCR'd PDF is refused and its hidden text layer never searched", (t) => {
  const s = setup(t);
  const scan = join(s.books, "Scanned Act.pdf");
  const ocr = Array.from({ length: 40 }, (_, i) => `BT 3 Tr /F1 12 Tf 72 ${740 - 17 * i} Td (${i + 1} The court may refer a question.) Tj ET`).join(" ");
  writeFileSync(scan, imagePdfBytes({ pages: [{ content: `${drawImage(0, 0, 612, 792)} ${ocr}` }] }));
  assert.equal(codeOf(() => legislationSearch(s.matter, scan, ["court"])), "extractor_unavailable");
});

test("refusals: outside the matter, a firewall tree, and bad arguments", (t) => {
  const s = setup(t);
  const outside = mkdtempSync(join(tmpdir(), "coclerk-legislation-outside-"));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  const stray = join(outside, "Fixture Act.md");
  writeFileSync(stray, ACT);
  const secret = join(s.privileged, "Fixture Act.md");
  writeFileSync(secret, ACT);

  assert.equal(codeOf(() => legislationSearch(s.matter, stray, ["court"])), "not_in_matter");
  assert.equal(codeOf(() => legislationSearch(s.matter, secret, ["court"])), "protected");
  assert.equal(codeOf(() => legislationSearch(s.matter, "Fixture Act.md", ["court"])), "invalid_path");
  assert.equal(codeOf(() => legislationSearch(s.matter, join(s.law, "absent.md"), ["court"])), "not_found");
  assert.equal(codeOf(() => legislationSearch(s.matter, s.act)), "invalid_argument");
  assert.equal(codeOf(() => legislationSearch(s.matter, s.act, [""])), "invalid_argument");
  assert.equal(codeOf(() => legislationSearch(s.matter, s.act, undefined, "(")), "invalid_argument");
  assert.equal(codeOf(() => legislationSearch(s.matter, s.act, ["court"], undefined, "1-2")), "invalid_argument");
  assert.equal(codeOf(() => legislationSearch(outside, s.act, ["court"])), "invalid_root");
  const doc = join(s.law, "Fixture Act.doc");
  writeFileSync(doc, "binary");
  assert.equal(codeOf(() => legislationSearch(s.matter, doc, ["court"])), "unsupported_type");
});

test("the tool is registered read-only with matter_root and path required", () => {
  const def = buildToolDefinitions().find((d) => d.name === "research_filing__legislation_search");
  assert.ok(def);
  assert.deepEqual(def.annotations, { readOnlyHint: true, openWorldHint: false });
  assert.deepEqual(def.inputSchema.required, ["matter_root", "path"]);
  assert.deepEqual(Object.keys(def.inputSchema.properties), ["matter_root", "path", "terms", "regex", "pages"]);
});
