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
  // Line numbers are the file's own, counting the filed page's header.
  assert.deepEqual(r.hits[0].line_range, { first: 30, last: 31 });
  assert.deepEqual(r.hits[0].heading_path, ["Part 2 — Proceedings", "Referral to an arbitrator"]);
  assert.equal(r.hits[0].truncated, false);
  assert.equal(r.hits[0].currency_marker, "current to September 30, 2026");
  assert.equal(r.currency_marker, "current to September 30, 2026");
  assert.equal(r.sectioning, "headings");
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
  // The title, citation, currency line, the glued table of contents and the two Part headings are
  // searched but unsectioned.
  assert.equal(r.unsectioned_lines, 8);
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

// A guard for the planned move to extractText: today every PDF is refused before it is read, so this
// passes whatever the scanned-page check does. It starts to bite once PDFs are read.
test("guard for the move to extractText: an OCR'd PDF is refused and its hidden text layer never searched", (t) => {
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
  assert.deepEqual(Object.keys(def.inputSchema.properties), ["matter_root", "path", "terms", "regex", "pages", "pinpoint"]);
});

// Rule-level sections (docs/Specs/2026-10-22_legislation-search-rule-sections-spec.md). The fixture is
// synthetic court rules in the shape of a filed BC Rules page: a header, a table of contents of Part
// and Rule headings, then each `Rule N-N — Title` heading with `(n)` subrules under bold or plain
// sub-headings, an amendment note, and Rule 4-2 long enough to pass the 6,000-character cap.
const filler = (n) => " The fixture text continues without stating anything.".repeat(n);
const RULE_LINES = [
  "---",
  'url: "https://fixture.test/rules"',
  'currency_marker: "current to October 1, 2026"',
  "---",
  "Fixture Court Rules",
  "B.C. Reg. 999/2099",
  "Contents",
  "Part 1 — Interpretation",
  "Rule 1-1 — Definitions",
  "Part 4 — Documents",
  "Rule 4-1 — Form of Documents",
  "Rule 4-2 — Address for Service",
  "Part 1 — Interpretation",
  "Rule 1-1 — Definitions",
  "Definitions",
  '(1) In these rules, "fixture" means a synthetic text.',
  "Part 4 — Documents",
  "Rule 4-1 — Form of Documents",
  "**Paper size**",
  "(1) A document must be on letter size paper.",
  "Rule 4-2 — Address for Service",
  "Address for service required",
  `(1) Each party must have an address for service.${filler(20)}`,
  `(2) An address for service may be a postal address.${filler(20)}`,
  "30 days after it is given, an unused address lapses.",
  `(3) An address for service may include an email address.${filler(20)}`,
  `(4) A lawyer's office may be an address for service.${filler(20)}`,
  `(5) An address for service must be in the province.${filler(130)}`,
  "**Change of address**",
  "(6) A party may change its address for service by filing a notice.",
  "[am. B.C. Reg. 1/2099, s. 1.]",
  "Accessible address",
  "(7) An address must be accessible during business hours.",
  "Part 5 — Case Planning",
  "Rule 5-1 — Fixture Conference",
  "(1) A party may request a fixture conference.",
  "",
];
const lineOf = (text) => RULE_LINES.lastIndexOf(text) + 1;

function rulesFile(s) {
  const file = join(s.law, "Fixture Court Rules.md");
  writeFileSync(file, RULE_LINES.join("\n"));
  return file;
}

test("a pinpoint Rule 4-2(6) returns that subrule alone, with its heading path and line range", (t) => {
  const s = setup(t);
  const r = legislationSearch(s.matter, rulesFile(s), undefined, undefined, undefined, {}, "Rule 4-2(6)");
  assert.equal(r.pinpoint, "Rule 4-2(6)");
  assert.equal(r.hits.length, 1);
  const h = r.hits[0];
  assert.equal(h.section, "4-2");
  assert.equal(h.subsection, "6");
  assert.equal(h.heading, "Rule 4-2 — Address for Service");
  assert.deepEqual(h.heading_path, ["Part 4 — Documents", "Rule 4-2 — Address for Service", "Change of address"]);
  assert.equal(
    h.text,
    "**Change of address**\n(6) A party may change its address for service by filing a notice.\n[am. B.C. Reg. 1/2099, s. 1.]"
  );
  assert.deepEqual(h.line_range, { first: lineOf("**Change of address**"), last: lineOf("[am. B.C. Reg. 1/2099, s. 1.]") });
  assert.equal(h.truncated, false);
  assert.equal(h.currency_marker, "current to October 1, 2026");

  // The table of contents entry for Rule 4-2 is not returned as the provision.
  const whole = legislationSearch(s.matter, rulesFile(s), undefined, undefined, undefined, {}, "R 4-2");
  assert.equal(whole.hits.length, 1);
  assert.equal(whole.hits[0].subsection, null);
  assert.equal(whole.hits[0].truncated, true);
  assert.equal(whole.hits[0].text.length, 6000);

  assert.deepEqual(legislationSearch(s.matter, rulesFile(s), undefined, undefined, undefined, {}, "Rule 9-9").hits, []);
  assert.deepEqual(legislationSearch(s.matter, rulesFile(s), undefined, undefined, undefined, {}, "Rule 4-2(9)").hits, []);
});

test("rules: sections open at each Rule heading, a table of contents is its own block, and body numbers stay body", (t) => {
  const s = setup(t);
  const r = legislationSearch(s.matter, rulesFile(s), ["no such phrase"]);
  assert.equal(r.sectioning, "headings");
  assert.deepEqual(r.sections_searched, {
    count: 7,
    blocks: [
      { block: 1, heading: "Rule 1-1 — Definitions", first: "1-1", last: "4-2", count: 3 },
      { block: 2, heading: "Rule 1-1 — Definitions", first: "1-1", last: "5-1", count: 4 },
    ],
  });
  const lapse = legislationSearch(s.matter, rulesFile(s), ["unused address lapses"]);
  assert.deepEqual(lapse.hits.map((h) => [h.section, h.subsection]), [["4-2", "2"]]);
});

test("a phrase returns several sections, none over the cap, each flagged truncated or not", (t) => {
  const s = setup(t);
  const r = legislationSearch(s.matter, rulesFile(s), ["address for service"]);
  // Rule 4-2 is over the cap, so its matching subsections come back one by one; the table of
  // contents line and the rule's own heading line also hold the phrase.
  assert.deepEqual(
    r.hits.map((h) => [h.block, h.section, h.subsection]),
    [
      [1, "4-2", null],
      [2, "4-2", null],
      [2, "4-2", "1"],
      [2, "4-2", "2"],
      [2, "4-2", "3"],
      [2, "4-2", "4"],
      [2, "4-2", "5"],
      [2, "4-2", "6"],
    ]
  );
  for (const h of r.hits) {
    assert.ok(h.text.length <= 6000);
    assert.equal(typeof h.truncated, "boolean");
    assert.equal(h.currency_marker, "current to October 1, 2026");
  }
  assert.deepEqual(r.hits.map((h) => h.truncated), [false, false, false, false, false, false, true, false]);
  // The plain sub-heading above (1) opens that subrule, not the rule's lead.
  assert.deepEqual(r.hits[2].heading_path, ["Part 4 — Documents", "Rule 4-2 — Address for Service", "Address for service required"]);
  assert.equal(r.hits[1].text, "Rule 4-2 — Address for Service");
});

test("a pinpoint resolves a statute section and subsection, and stands alone", (t) => {
  const s = setup(t);
  const sub = legislationSearch(s.matter, s.act, undefined, undefined, undefined, {}, "s 5(2)");
  assert.deepEqual(sub.hits.map((h) => [h.section, h.subsection, h.text]), [["5", "2", "(2) An arbitrator's report binds the parties."]]);
  assert.deepEqual(sub.hits[0].line_range, { first: 31, last: 31 });
  const first = legislationSearch(s.matter, s.act, undefined, undefined, undefined, {}, "section 3(1)");
  assert.equal(first.hits[0].text, "3 (1) A proceeding is commenced by filing a notice.");
  const whole = legislationSearch(s.matter, s.act, undefined, undefined, undefined, {}, "s. 2.1");
  assert.deepEqual(whole.hits.map((h) => [h.section, h.heading, h.text]), [["2.1", "Fixture rule", "2.1 A party may apply to the court."]]);

  assert.equal(codeOf(() => legislationSearch(s.matter, s.act, ["court"], undefined, undefined, {}, "s 5")), "invalid_argument");
  assert.equal(codeOf(() => legislationSearch(s.matter, s.act, undefined, undefined, undefined, {}, "paragraph five")), "invalid_argument");
});

test("text with no section headings falls back to 40-line chunks with line ranges, and says so", (t) => {
  const s = setup(t);
  const file = join(s.law, "Fixture Notes.txt");
  writeFileSync(file, Array.from({ length: 100 }, (_, i) => `Clause text ${i + 1} about notices.`).join("\n"));
  const r = legislationSearch(s.matter, file, ["notices"]);
  assert.equal(r.sectioning, "fixed_chunks");
  assert.deepEqual(
    r.hits.map((h) => [h.section, h.line_range]),
    [
      [null, { first: 1, last: 40 }],
      [null, { first: 41, last: 80 }],
      [null, { first: 81, last: 100 }],
    ]
  );
  assert.equal(r.unsectioned_lines, 100);
  assert.equal(r.currency_marker, null);
  for (const h of r.hits) assert.equal(h.currency_marker, null);
});

test("with no filed header, the currency marker is the text's own \"current to\" line", (t) => {
  const s = setup(t);
  const file = join(s.law, "Fixture Act.txt");
  writeFileSync(file, ACT.split("\n").slice(7).join("\n"));
  const r = legislationSearch(s.matter, file, ["arbitrator"]);
  assert.equal(r.currency_marker, "This Act is current to September 30, 2026");
  assert.equal(r.hits[0].currency_marker, "This Act is current to September 30, 2026");
  assert.deepEqual(r.hits[0].line_range, { first: 23, last: 24 });
});
