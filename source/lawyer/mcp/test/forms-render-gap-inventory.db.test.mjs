// #1226: every 🧩 gap a bespoke renderer prints is its own non-generating open-items entry in the
// render manifest, as #1213 made a general Writing's gap lines and #1219 the NoA's and Application
// Response's blank fields. One logical gap printed several times is one entry, and each distinct
// gap carries its own (table, id), since the Practice Board folds non-generating entries on
// marker:table:id.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { seededDbFixture, seedVaniacProceeding, seedBcscDefaultJudgment, seedBcscConsentOrder, ASHBOURNE } from "./fixtures/forms-render-seeds.mjs";
import { FACTUM_CASE_DATA, FACTUM_SEED } from "./fixtures/bcca-factum-seed.mjs";
import { STAY_RESPONSE_CASE_DATA, STAY_RESPONSE_SEED, STAY_RESPONSE_POSITIONS } from "./fixtures/bcca-stay-response-seed.mjs";
const { freshSubmissionDb } = await import("./helpers/template-db.mjs");
const { updateCaseData, writePartiesOfRecord } = await import("./helpers/matter-data-fixture.mjs");
const { submissionDataExecute } = await import("../build/submission/backend.js");
const { submissionFormsRender } = await import("../build/submission/forms.js");

const NEVER_DELIVERED = new Set(["practice_board"]);

/** Renders filing 1 and returns its 🧩 entries (from the saved manifest) and the venue documents
 * whose saved mockup prints a 🧩. The file, not the returned markdown: the returned copy withholds
 * the hearing date, which can re-show a 🧩 the renderer never printed (out of scope here). */
function renderGaps(dbPath) {
  const result = submissionFormsRender(dbPath, 1, ASHBOURNE);
  const venue = result.documents.filter((d) => !NEVER_DELIVERED.has(d.document_type));
  const manifest = JSON.parse(readFileSync(join(dirname(dirname(venue[0].path)), "Drafting records", "render-manifest-1.json"), "utf-8"));
  const entries = manifest.inventory.filter((e) => e.marker === "🧩");
  const printing = new Set(venue.filter((d) => readFileSync(d.path, "utf-8").includes("🧩")).map((d) => d.document_type));
  return { entries, printing };
}

/** The gapped render's entries, by document, as [table, id, item]; asserts the invariants every
 * kind shares: non-generating, keys distinct within a document, and an entry on exactly the
 * documents that print a 🧩. */
function gapsByDoc({ entries, printing }) {
  const byDoc = {};
  for (const e of entries) {
    assert.equal(e.generating, false);
    (byDoc[e.doc] ??= []).push([e.table, e.id, e.item]);
  }
  for (const [doc, gaps] of Object.entries(byDoc)) {
    const keys = gaps.map(([table, id]) => `${table}:${id}`);
    assert.equal(new Set(keys).size, keys.length, `${doc}: one entry per distinct gap`);
  }
  assert.deepEqual(Object.keys(byDoc).sort(), [...printing].sort(), "an entry on exactly the documents that print 🧩");
  return byDoc;
}

const CASES = [
  {
    name: "default-judgment requisition and order",
    seed: seedBcscDefaultJudgment,
    blank: "UPDATE parties SET role = 'Claimant' WHERE id = 2; UPDATE parties SET is_client = 0, is_applicant = 0;",
    expected: {
      Requisition: [
        ["form_fields", 0, "Defendants"],
        ["form_fields", 1, "Filed by"],
      ],
      // Printed in the preamble and in every provision, recorded once.
      Default_judgment: [["form_fields", 0, "Defendants"]],
    },
  },
  {
    name: "consent requisition and order",
    seed: seedBcscConsentOrder,
    blank: "UPDATE parties SET is_client = 0, is_applicant = 0;",
    expected: {
      Requisition: [["form_fields", 0, "Filed by"]],
      Consent_order: [["form_fields", 1, "Applicants"]],
    },
  },
  {
    name: "VanIAC submissions package",
    seed: seedVaniacProceeding,
    fill: "DELETE FROM statement_paragraphs WHERE id = 2; DELETE FROM filing_documents WHERE document_id = 4;",
    expected: {
      Witness_statement: [
        ["statement_paragraphs", 2, "A. Renwick's witness statement, paragraph 2: linked fact"],
        ["witnesses", 2, "J. Renwick's witness statement: attributed facts"],
      ],
    },
  },
  {
    name: "BCCA factum, empty",
    seed: (dbPath) => {
      writePartiesOfRecord(dirname(dbPath), FACTUM_CASE_DATA);
      return submissionDataExecute(dbPath, FACTUM_SEED);
    },
    blank:
      "DELETE FROM filing_chronology; DELETE FROM filing_prose; DELETE FROM filing_submissions; DELETE FROM filing_orders;" +
      " UPDATE parties SET is_client = 0;",
    // Counsel is read from case data (party/counsel SSOT), so its blanks are written there.
    caseBlank: "UPDATE parties SET lawyer_phone = NULL, lawyer_email = NULL WHERE party_id = 1;",
    expected: {
      Factum: [
        ["counsel_of_record.counsel_phone", 1, "Counsel for the Appellant: telephone"],
        ["counsel_of_record.counsel_email", 1, "Counsel for the Appellant: email"],
        ["form_fields", 0, "Chronology"],
        ["form_fields", 1, "Opening statement"],
        ["form_fields", 2, "Position on the appellants' statement of facts"],
        ["form_fields", 3, "Submissions"],
        ["form_fields", 4, "Order sought"],
        ["form_fields", 5, "Place of signing"],
        ["form_fields", 6, "Name authorizing filing"],
      ],
    },
  },
  {
    name: "BCCA factum, appendices",
    seed: (dbPath) => {
      writePartiesOfRecord(dirname(dbPath), FACTUM_CASE_DATA);
      return submissionDataExecute(dbPath, FACTUM_SEED);
    },
    // The excerpt write snapshots the pair it leaves, as the v47 verified write does, so the
    // statement stays 'verified' rather than reopening to 'lead'.
    blank: "UPDATE authorities SET citation = NULL WHERE id = 1; UPDATE statements_of_law SET excerpt = NULL, scrutinized_authority_id = authority_id, scrutinized_pinpoint = pinpoint, scrutinized_excerpt = NULL WHERE authority_id = 2;",
    expected: {
      Factum: [
        ["authority_citations", 1, "Housen v Nikolaisen: citation"],
        ["enactment_excerpts", 2, "Arbitration Act: excerpt"],
      ],
    },
  },
  {
    name: "BCCA stay-response book",
    seed: (dbPath) => {
      writePartiesOfRecord(dirname(dbPath), STAY_RESPONSE_CASE_DATA);
      return submissionDataExecute(dbPath, STAY_RESPONSE_SEED + STAY_RESPONSE_POSITIONS);
    },
    blank:
      "UPDATE parties SET is_client = 0, is_applicant = 0;" +
      " DELETE FROM hearing_details; UPDATE documents SET document_date = NULL; UPDATE documents SET deponent = NULL WHERE id = 11;" +
      " DELETE FROM filing_orders; UPDATE authorities SET citation = NULL;",
    caseBlank: "UPDATE parties SET lawyer_firm = NULL WHERE party_id = 1;",
    expected: {
      Response_book: [
        ["counsel_of_record.counsel_firm", 1, "Counsel for the Appellants: firm"],
        ["documents.deponent", 11, "Affidavit #1 of Adrian Renwick: deponent"],
        ["documents.document_date", 11, "Affidavit #1 of Adrian Renwick: filed date"],
        ["form_fields", 0, "Respondents"],
        ["form_fields", 1, "Applicants"],
        ["form_fields", 2, "Date the stay application was filed"],
        ["form_fields", 3, "Hearing date"],
        ["form_fields", 4, "Order sought"],
        ["form_fields", 5, "Preparer"],
        ["authority_citations", 1, "RJR-MacDonald Inc. v. Canada (Attorney General): citation"],
      ],
    },
  },
];

for (const { name, seed, blank, caseBlank, fill, expected } of CASES) {
  test(`${name}: each printed 🧩 is its own open-items entry, and a populated render records none (#1226)`, async () => {
    const f = seededDbFixture();
    try {
      await freshSubmissionDb(f.dbPath);
      await seed(f.dbPath);
      if (blank) await submissionDataExecute(f.dbPath, blank);
      if (caseBlank) updateCaseData(dirname(f.dbPath), caseBlank);
      assert.deepEqual(gapsByDoc(renderGaps(f.dbPath)), expected);

      if (blank) {
        const g = seededDbFixture();
        try {
          await freshSubmissionDb(g.dbPath);
          await seed(g.dbPath);
          const populated = renderGaps(g.dbPath);
          assert.deepEqual([populated.entries, [...populated.printing]], [[], []], "the populated render prints and records no 🧩");
        } finally {
          g.cleanup();
        }
      } else {
        await submissionDataExecute(f.dbPath, fill);
        const populated = renderGaps(f.dbPath);
        assert.deepEqual([populated.entries, [...populated.printing]], [[], []], "the populated render prints and records no 🧩");
      }
    } finally {
      f.cleanup();
    }
  });
}
