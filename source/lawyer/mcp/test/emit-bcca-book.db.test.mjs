// Tests for the bcca-book.md filed-face emitter (drafting_forms__emit_bcca_book), per
// .claude/skills/publish/subskills/publish-bcca-book/references/bcca-book-contract.md (SSOT). Reuses the
// same CA52140-shaped fixture as bcca-stay-response.db.test.mjs so both the mockup and this
// emitter exercise identical underlying data -- the cross-check test below depends on that.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { assertMatchesGolden } from "./fixtures/forms-render-seeds.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
// The contract's own acceptance oracle (bcca-book-contract.md, "CLI acceptance oracle"), the
// same way emit-bcca-factum.db.test.mjs runs fill_factum.py --validate. resolveShippedRoot, given an
// install root with no skill source, serves the checkout's .claude/skills copy:
// plugins/litigation/skills/ is untracked since #1266.
const { resolveShippedRoot } = await import("../build/repo-root.js");
const BOOK_SCRIPT = ["publish", "scripts", "fill_book.py"];
const VALIDATOR = join(resolveShippedRoot(BOOK_SCRIPT.join("/"), process.env, { installRoot: join(HERE, "no-install") }).root, ...BOOK_SCRIPT);
const PY_CANDIDATES = [process.env.COCLERK_PYTHON, "python", "python3"].filter(Boolean);

const { freshSubmissionDb } = await import("./helpers/template-db.mjs");
const { writePartiesOfRecord } = await import("./helpers/matter-data-fixture.mjs");
const { submissionDataExecute } = await import("../build/submission/backend.js");
const { submissionFormsEmitBccaBook, submissionFormsEmitBccaFactum, submissionFormsRender } = await import("../build/submission/forms.js");
const { FACTUM_CASE_DATA, FACTUM_SEED } = await import("./fixtures/bcca-factum-seed.mjs");
// SEED below holds the stay-response fixture's parties, linked to the same case data.
const { STAY_RESPONSE_CASE_DATA } = await import("./fixtures/bcca-stay-response-seed.mjs");

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "coclerk-emit-bcca-book-"));
  const matter = join(dir, "L4801 Matter");
  mkdirSync(join(matter, "0. CASE DATA"), { recursive: true });
  mkdirSync(join(matter, "0. DRAFT"));
  return { dir, dbPath: join(matter, "0. CASE DATA", "submission.sqlite"), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function validate(dir, markdown) {
  const path = join(dir, "bcca-book.md");
  writeFileSync(path, markdown, "utf-8");
  let lastErr = "";
  for (const py of PY_CANDIDATES) {
    // -B: write no __pycache__ into the checkout's .claude/skills tree.
    const res = spawnSync(py, ["-B", VALIDATOR, "--validate", path], { encoding: "utf-8" });
    if (res.error) {
      lastErr = String(res.error);
      continue;
    }
    return { status: res.status, stdout: res.stdout.trim() };
  }
  throw new Error(`No Python interpreter found (tried ${PY_CANDIDATES.join(", ")}). Last error: ${lastErr}`);
}

const SEED = `
INSERT INTO proceedings (id, matter_reference, forum, court_or_centre, registry, file_number, style_of_cause, courthouse_address, under_appeal_judge, under_appeal_court, under_appeal_pronounced, access_restrictions)
  VALUES (1, 'L4801 - Merrow', 'CAN/BC/BCCA', 'Court of Appeal for British Columbia', 'Vancouver', 'CA52140', NULL, NULL, 'Madam Justice Trelawney', 'Supreme Court of British Columbia', '2026-06-29', NULL);
INSERT INTO parties (id, proceeding_id, name, role, ordinal, is_client, is_applicant, case_party_id) VALUES
  (1, 1, 'Tidewater Outfitters Inc.', 'Appellant', 1, 0, 1, 1),
  (2, 1, 'Kestrel Collective Inc.', 'Appellant', 2, 0, 0, 2),
  (3, 1, 'Merrow Clothing Manufacturers Ltd.', 'Respondent', 3, 1, 0, 3),
  (4, 1, 'Adrian Renwick', 'Respondent', 4, 0, 0, 4),
  (5, 1, 'Jonah Renwick', 'Respondent', 5, 0, 0, 5);
INSERT INTO filings (id, proceeding_id, kind, subkind, round, title)
  VALUES (1, 1, 'bcca_stay_response', NULL, 'response', 'Stay Application Response');
INSERT INTO hearing_details (filing_id, hearing_date, hearing_time, time_estimate_minutes) VALUES (1, '2026-09-04', '10:00 am', 40);
INSERT INTO documents (id, proceeding_id, label, document_date) VALUES
  (10, 1, 'Notice of Application (stay of execution)', '2026-08-27');
INSERT INTO opposing_orders (id, proceeding_id, document_id, paragraph_number, wording) VALUES
  (1, 1, 10, 1, 'A stay of execution of the order of Trelawney J. pending the appeal'),
  (2, 1, 10, 2, 'An order extending the interim stay of VanIAC arbitration 2767-DCA-EP');
INSERT INTO witnesses (id, proceeding_id, name) VALUES (1, 1, 'Adrian Renwick');
INSERT INTO documents (id, proceeding_id, label, document_date, description, instrument, deponent, execution, affidavit_number) VALUES
  (11, 1, 'Affidavit #1 of Adrian Renwick', '2026-08-30', 'Responding affidavit', 'affidavit', 1, '2026-08-30', '1');
INSERT INTO filing_documents (id, filing_id, document_id, ordinal, role) VALUES (1, 1, 11, 1, 'affidavit');
INSERT INTO facts (id, proceeding_id, postulate) VALUES (1, 1, 'The arbitration was commenced on 12 May 2026.');
INSERT INTO filing_facts (id, filing_id, fact_id, document, part, ordinal) VALUES (1, 1, 1, 'form', 'part2', 1);
INSERT INTO statements_of_fact (id, proceeding_id, fact_id, witness_id, instrument, pinpoint, interviewed, excerpt)
  VALUES (1, 1, 1, 1, 11, 'para 4', 1, 'The arbitration was commenced on 12 May 2026.');
INSERT INTO submissions (id, proceeding_id, contention, ordinal) VALUES
  (1, 1, 'The appeal raises no serious question to be tried.', 1);
INSERT INTO filing_submissions (id, filing_id, submission_id, document, ordinal) VALUES (1, 1, 1, 'form', 1);
INSERT INTO submission_facts (submission_id, fact_id) VALUES (1, 1);
INSERT INTO law_assertions (id, proceeding_id, proposition) VALUES (1, 1, 'A stay requires a serious question, irreparable harm, and a favourable balance of convenience.');
INSERT INTO submission_law (submission_id, law_assertion_id) VALUES (1, 1);
INSERT INTO authorities (id, proceeding_id, style_of_cause_or_title, citation, kind, treatment, weight)
  VALUES (1, 1, 'RJR-MacDonald Inc. v. Canada (Attorney General)', '[1994] 1 SCR 311', 'case', 'good_law', 'binding');
INSERT INTO statements_of_law (id, proceeding_id, law_assertion_id, authority_id, pinpoint, excerpt, source, verification)
  VALUES (1, 1, 1, 1, 'at 334', 'the tripartite test', 'primary', 'verified');
INSERT INTO order_sought (id, proceeding_id, wording) VALUES (1, 1, 'The application is dismissed, with costs.');
INSERT INTO filing_orders (id, filing_id, order_sought_id, document, ordinal) VALUES (1, 1, 1, 'form', 1);
INSERT INTO filing_positions (id, filing_id, opposing_order_id, position) VALUES
  (1, 1, 1, 'opposed'),
  (2, 1, 2, 'opposed');
UPDATE db_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision';
`;

function frontmatterValue(markdown, key) {
  const m = markdown.match(new RegExp(`^${key}: (.+)$`, "m"));
  return m ? m[1] : undefined;
}

// Parses the mockup's own TOC markdown table into the same {text, indent} row shape the
// emitter's response_book_toc carries, so the two can be compared directly.
function mockupTocRows(markdown) {
  const headerIdx = markdown.indexOf("| :--- | ---: |");
  assert.ok(headerIdx !== -1, "mockup TOC table header found");
  const afterHeader = markdown.slice(headerIdx).split("\n").slice(1);
  const rows = [];
  for (const line of afterHeader) {
    if (line.trim() === "") break;
    const m = line.match(/^\| ((?:&nbsp;&nbsp;)*)(.+) \| TBD \|$/);
    if (!m) break;
    const indent = m[1] ? m[1].match(/&nbsp;&nbsp;/g).length : 0;
    rows.push({ text: m[2], indent });
  }
  return rows;
}

test("emits bcca-book.md frontmatter with the contract's required keys", async () => {
  const f = fixture();
  try {
    await freshSubmissionDb(f.dbPath);
    writePartiesOfRecord(dirname(f.dbPath), STAY_RESPONSE_CASE_DATA);
    await submissionDataExecute(f.dbPath, SEED);

    const result = submissionFormsEmitBccaBook(f.dbPath, 1);
    assert.equal(result.file_name, "bcca-book.md");
    const md = result.markdown;

    assert.match(md, /^---$/m);
    assert.match(md, /^file_number: CA52140$/m);
    assert.match(md, /^registry: Vancouver$/m);
    assert.match(md, /^short_style: Tidewater Outfitters Inc\. vs\. Merrow Clothing Manufacturers Ltd.$/m);
    assert.match(md, /^under_appeal_judge: Madam Justice Trelawney$/m);
    assert.match(md, /^under_appeal_court: Supreme Court of British Columbia$/m);
    assert.match(md, /^under_appeal_pronounced: 2026-06-29$/m);
    assert.doesNotMatch(md, /^access_restrictions:/m, "omitted entirely when NULL, never an empty array");
    assert.match(md, /^response_book_record_label: Response Book$/m);
    assert.match(md, /^response_book_title: Respondents' Response Book$/m);
    assert.match(md, /^boa_record_label: Book of Authorities$/m);
    assert.match(md, /^boa_title: Respondents' Book of Authorities$/m);
    assert.match(md, /^filing_party_phrase: Merrow Clothing Manufacturers Ltd., Adrian Renwick, and Jonah Renwick$/m);

    const partyGroups = JSON.parse(frontmatterValue(md, "party_groups"));
    assert.deepEqual(partyGroups, [
      { role: "Appellants", names: ["Tidewater Outfitters Inc.", "Kestrel Collective Inc."] },
      { role: "Respondents", names: ["Merrow Clothing Manufacturers Ltd.", "Adrian Renwick", "Jonah Renwick"] },
    ]);

    const contacts = JSON.parse(frontmatterValue(md, "contacts"));
    assert.equal(contacts.length, 2);
    assert.deepEqual(contacts[0], {
      role: "Appellants",
      names: ["Tidewater Outfitters Inc.", "Kestrel Collective Inc."],
      counsel_name: "Ian Kerr",
      counsel_firm: "Caldwell, Fenn & Roe LLP",
      address: "410 - 1290 Beatty Street, Vancouver, BC V6B 2M8",
      phone: "(604) 555-0142",
      email: "ikerr@cfr-law.ca",
    });

    const boaToc = JSON.parse(frontmatterValue(md, "boa_toc"));
    assert.deepEqual(boaToc, [{ authority: "RJR-MacDonald Inc. v. Canada (Attorney General)", citation: "[1994] 1 SCR 311", part: 0 }]);
    assert.deepEqual(JSON.parse(frontmatterValue(md, "boa_parts")), [
      { bookmark: "RJR-MacDonald Inc. v. Canada (Attorney General), [1994] 1 SCR 311" },
    ]);

    // No body content -- frontmatter-only (contract: "the validator rejects any non-blank line
    // after the closing ---").
    const closingIdx = md.lastIndexOf("---");
    assert.equal(md.slice(closingIdx + 3).trim(), "", "nothing after the closing --- fence");

    const check = validate(f.dir, md);
    assert.equal(check.status, 0, check.stdout);
    assert.deepEqual(JSON.parse(check.stdout), { success: true });

    // #816: the whole emitted face, byte for byte. This file's assertions are the
    // densest of the four emitters' -- but they pin contacts[0] alone, so an
    // annotation in the second contact's counsel_firm ("Beacon Law (address for
    // service not yet confirmed)") passed this test AND the validator. Only this
    // golden catches it.
    assertMatchesGolden("bcca-book-stay-response-emitted", md);
  } finally {
    f.cleanup();
  }
});

test("response_book_toc reproduces the mockup's own table-of-contents row set exactly (mockup/filed-face alignment)", async () => {
  const f = fixture();
  try {
    await freshSubmissionDb(f.dbPath);
    writePartiesOfRecord(dirname(f.dbPath), STAY_RESPONSE_CASE_DATA);
    await submissionDataExecute(f.dbPath, SEED);

    const mockup = submissionFormsRender(f.dbPath, 1, {});
    const mockupText = mockup.documents.find((d) => d.document_type === "Response_book").markdown;
    const expectedRows = mockupTocRows(mockupText);
    assert.ok(expectedRows.length > 0, "sanity: mockup TOC has rows");

    const result = submissionFormsEmitBccaBook(f.dbPath, 1);
    const actualRows = JSON.parse(frontmatterValue(result.markdown, "response_book_toc"));

    assert.deepEqual(actualRows.map(({ text, indent }) => ({ text, indent })), expectedRows);
    // Sanity on the structure the contract requires: Cover Page/Table of Contents self-rows
    // first, the affidavit row nested under Part 1, then Part 2's four fixed sub-rows, then
    // Part 3 (present here since an authority is cited and the delta is unverified).
    assert.deepEqual(actualRows[0], { text: "Cover Page", indent: 0, part: "cover" });
    assert.deepEqual(actualRows[1], { text: "Table of Contents", indent: 0, part: "toc" });
    assert.ok(actualRows.some((r) => r.text === "Affidavit #1 of Adrian Renwick, filed 2026-08-30" && r.indent === 1));
    assert.deepEqual(actualRows[actualRows.length - 1], { text: "Part 3: Table of Authorities", indent: 0, part: 2 });
  } finally {
    f.cleanup();
  }
});

test("response_book_parts: one part per document, the written argument and the table of authorities; rows inside a part stay blank", async () => {
  const f = fixture();
  try {
    await freshSubmissionDb(f.dbPath);
    writePartiesOfRecord(dirname(f.dbPath), STAY_RESPONSE_CASE_DATA);
    await submissionDataExecute(f.dbPath, SEED);

    const md = submissionFormsEmitBccaBook(f.dbPath, 1).markdown;
    const rows = JSON.parse(frontmatterValue(md, "response_book_toc"));
    const parts = JSON.parse(frontmatterValue(md, "response_book_parts"));

    assert.deepEqual(parts, [
      { bookmark: "Affidavit #1 of Adrian Renwick, filed 2026-08-30" },
      { bookmark: "Part 2: Written Argument" },
      { bookmark: "Part 3: Table of Authorities" },
    ]);
    assert.deepEqual(
      rows.map((r) => [r.text, r.part]),
      [
        ["Cover Page", "cover"],
        ["Table of Contents", "toc"],
        ["Part 1: Evidence, Exhibits or Affidavits", null],
        ["Affidavit #1 of Adrian Renwick, filed 2026-08-30", 0],
        ["Part 2: Written Argument", 1],
        ["Part 1: Statement of Facts", null],
        ["Part 2: Issues", null],
        ["Part 3: Analysis", null],
        ["Part 4: Order(s) Sought", null],
        ["Part 3: Table of Authorities", 2],
      ]
    );
  } finally {
    f.cleanup();
  }
});

test("refuses a filing whose proceeding has no file_number recorded", async () => {
  const f = fixture();
  try {
    await freshSubmissionDb(f.dbPath);
    writePartiesOfRecord(dirname(f.dbPath), STAY_RESPONSE_CASE_DATA);
    await submissionDataExecute(f.dbPath, SEED + `UPDATE proceedings SET file_number = NULL WHERE id = 1;`);
    assert.throws(() => submissionFormsEmitBccaBook(f.dbPath, 1), /file_number/);
  } finally {
    f.cleanup();
  }
});

test("refuses a filing with fewer than two party role groups", async () => {
  const f = fixture();
  try {
    await freshSubmissionDb(f.dbPath);
    writePartiesOfRecord(dirname(f.dbPath), STAY_RESPONSE_CASE_DATA);
    await submissionDataExecute(f.dbPath, SEED + `DELETE FROM parties WHERE role = 'Appellant';`);
    assert.throws(() => submissionFormsEmitBccaBook(f.dbPath, 1), /party role group/);
  } finally {
    f.cleanup();
  }
});

test("a bcca_factum filing emits the Book of Authorities half alone, and passes the validator", async () => {
  const f = fixture();
  try {
    await freshSubmissionDb(f.dbPath);
    writePartiesOfRecord(dirname(f.dbPath), FACTUM_CASE_DATA);
    await submissionDataExecute(f.dbPath, FACTUM_SEED);

    const result = submissionFormsEmitBccaBook(f.dbPath, 1);
    assert.equal(result.file_name, "bcca-book.md");
    const md = result.markdown;

    // The whole response-book group is absent -- all four keys or none (bcca-book-contract.md).
    for (const key of ["response_book_record_label", "response_book_title", "response_book_toc", "response_book_parts"]) {
      assert.doesNotMatch(md, new RegExp(`^${key}:`, "m"), `${key} is omitted for a factum`);
    }

    assert.match(md, /^boa_record_label: Book of Authorities$/m);
    assert.match(md, /^boa_title: Respondents' Book of Authorities$/m);
    // The seed's rule-kind authority (Court of Appeal Rules) is dropped from the book: it is
    // neither reproduced nor listed. The case and the statute stay (#813).
    assert.deepEqual(JSON.parse(frontmatterValue(md, "boa_toc")), [
      { authority: "Arbitration Act", citation: "SBC 2020, c 2", part: 0 },
      { authority: "Housen v Nikolaisen", citation: "2002 SCC 33", part: 1 },
    ]);
    assert.deepEqual(JSON.parse(frontmatterValue(md, "boa_parts")), [
      { bookmark: "Arbitration Act, SBC 2020, c 2" },
      { bookmark: "Housen v Nikolaisen, 2002 SCC 33" },
    ]);
    // The cover half is composed the same way for both kinds.
    assert.match(md, /^file_number: CA52140$/m);
    assert.match(md, /^registry: Vancouver$/m);
    assert.match(md, /^short_style: Tidewater Outfitters Inc\. vs\. Merrow Clothing Manufacturers Ltd\.$/m);
    assert.equal(JSON.parse(frontmatterValue(md, "contacts")).length, 2);

    const check = validate(f.dir, md);
    assert.equal(check.status, 0, check.stdout);
    assert.deepEqual(JSON.parse(check.stdout), { success: true });

    // #816: the factum's book is a separate delivered face from the stay
    // response's -- four keys omitted as a group, a different BOA source -- so it
    // needs its own golden. `contacts` here is checked for length only.
    assertMatchesGolden("bcca-book-factum-emitted", md);
  } finally {
    f.cleanup();
  }
});

test("a factum's boa_toc is its List of Authorities narrowed by kind -- a subset, in the same order (#813)", async () => {
  const f = fixture();
  try {
    await freshSubmissionDb(f.dbPath);
    writePartiesOfRecord(dirname(f.dbPath), FACTUM_CASE_DATA);
    await submissionDataExecute(f.dbPath, FACTUM_SEED);

    const bookMd = submissionFormsEmitBccaBook(f.dbPath, 1).markdown;
    const factumMd = submissionFormsEmitBccaFactum(f.dbPath, 1, "2026-09-16").markdown;

    const boaToc = JSON.parse(frontmatterValue(bookMd, "boa_toc"));
    const factumAuthorities = JSON.parse(frontmatterValue(factumMd, "authorities"));
    const pair = ({ authority, citation }) => ({ authority, citation });

    assert.ok(factumAuthorities.length > 0, "sanity: the factum lists authorities");
    // The book is a subset of the factum's list, never a superset and never reordered: an
    // authority the book omits by kind still appears on the factum's List of Authorities.
    const listed = factumAuthorities.map(pair);
    const booked = boaToc.map(pair);
    assert.deepEqual(booked, listed.filter((a) => booked.some((b) => b.authority === a.authority && b.citation === a.citation)));
    // The rule-kind authority is on the factum's list and absent from the book entirely --
    // no table-of-contents row, not even one with a null part (#813).
    assert.ok(listed.some((a) => a.authority === "Court of Appeal Rules"), "the factum lists the rule");
    assert.ok(!booked.some((a) => a.authority === "Court of Appeal Rules"), "the book omits the rule");
    // Book order is the table's own order, so every part index is its row's position.
    assert.deepEqual(boaToc.map((r) => r.part), boaToc.map((_, i) => i));
  } finally {
    f.cleanup();
  }
});

test("boa_toc carries cases, doctrine and enactments and drops rules, across all five kinds (#813)", async () => {
  const f = fixture();
  try {
    await freshSubmissionDb(f.dbPath);
    writePartiesOfRecord(dirname(f.dbPath), FACTUM_CASE_DATA);
    await submissionDataExecute(f.dbPath, FACTUM_SEED);
    // Add a regulation and a doctrine authority to the seed's case/statute/rule, and cite each
    // from the same law assertion the seed already deploys, so all five kinds are in play.
    await submissionDataExecute(
      f.dbPath,
      `INSERT INTO authorities (id, proceeding_id, style_of_cause_or_title, citation, kind, treatment, weight) VALUES
         (5, 1, 'Arbitration Regulation', 'BC Reg 1/2021', 'regulation', 'good_law', 'binding'),
         (6, 1, 'The Law of Arbitration', '(Toronto: Carswell, 2024)', 'doctrine', 'good_law', 'persuasive');
       INSERT INTO statements_of_law (proceeding_id, law_assertion_id, authority_id, pinpoint, excerpt, source, verification) VALUES
         (1, 2, 5, 's 3', '3 A stay application is brought by requisition.', 'primary', 'verified'),
         (1, 2, 6, 'at 15-54', 'Arbitration agreements are construed generously.', 'secondary', 'verified');`
    );

    const boaToc = JSON.parse(frontmatterValue(submissionFormsEmitBccaBook(f.dbPath, 1).markdown, "boa_toc"));

    // case, doctrine, statute and regulation in; rule out. Alphabetical, so part = index.
    assert.deepEqual(boaToc, [
      { authority: "Arbitration Act", citation: "SBC 2020, c 2", part: 0 },
      { authority: "Arbitration Regulation", citation: "BC Reg 1/2021", part: 1 },
      { authority: "Housen v Nikolaisen", citation: "2002 SCC 33", part: 2 },
      { authority: "The Law of Arbitration", citation: "(Toronto: Carswell, 2024)", part: 3 },
    ]);
    assert.ok(!boaToc.some((r) => r.authority === "Court of Appeal Rules"), "rule-kind is dropped");
  } finally {
    f.cleanup();
  }
});

test("refuses a filing that is neither bcca_stay_response nor bcca_factum", async () => {
  const f = fixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await submissionDataExecute(
      f.dbPath,
      `
      INSERT INTO proceedings (id, matter_reference, forum, court_or_centre, registry, file_number, style_of_cause, courthouse_address)
        VALUES (1, 'L9002 - Halloway', 'CAN/BC/BCSC', 'BC Supreme Court', 'Vancouver', 'S-901433', 'Halloway v. Vasey', '800 Smithe Street');
      INSERT INTO order_sought (id, proceeding_id, wording) VALUES (1, 1, 'damages to be assessed');
      INSERT INTO filings (id, proceeding_id, kind, subkind, round, title)
        VALUES (1, 1, 'requisition_default_judgment', 'default_judgment', NULL, 'Default Judgment Requisition');
      INSERT INTO filing_orders (filing_id, order_sought_id, document, ordinal) VALUES (1, 1, 'form', 1);

      -- Revision reset LAST: schema v21 triggers move db_meta.revision on every seeded row (#607).
      UPDATE db_meta SET value = '1' WHERE key = 'revision';
      `.trim()
    );
    assert.throws(
      () => submissionFormsEmitBccaBook(f.dbPath, 1),
      /has kind "requisition_default_judgment", not "bcca_stay_response" or "bcca_factum"/
    );
  } finally {
    f.cleanup();
  }
});
