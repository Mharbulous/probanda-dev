// Coverage meta-test for the filed goldens (issue #805). Issue #795 put a plain-prose mockup
// annotation ("Power to make: jurisdictional basis not yet filled.") on a delivered Notice of
// Application: prose carries none of the syntactic mechanisms toFiledFace strips, so nothing in
// the transform or its structural scan could have caught it. Only a byte-for-byte golden of the
// delivered face catches that class -- and at the time eight of the twelve delivered faces had no
// filed golden at all.
//
// This file makes an unpinned delivered face impossible to ship quietly. It reads the filing
// kinds out of the filler registry (forms/filler-registry.ts) rather than trusting a list in test
// code -- the kind is open text since schema v29, so the schema no longer lists them -- and a new
// registered kind turns it red until someone declares its faces; and it compares each kind's
// actual filed-mode document_type set against the declared one, so a new delivered document on an
// existing kind turns it red the same way.
//
// It asserts only that each declared golden EXISTS. The byte-for-byte comparison stays with the
// renderer tests that own each fixture, which is where a regeneration gets reviewed. Two limits
// on that, stated rather than implied:
//
//   * The Written Arguments companion is byte-compared ONCE, on notice_of_application
//     (forms-render-bcsc.db.test.mjs). The other three kinds that deliver a companion get the
//     existence check only, and the one golden cannot serve them all anyway -- its cover table
//     carries the NOA seed's own parties. The NOA seed also deploys nothing with
//     document = 'written_argument', so that golden pins the caption path and a single sentence,
//     not a populated companion.
//   * "Delivered face" here means a document submissionFormsRender returns in renderMode 'filed'.
//     The court-ready emitters -- renderForm32FiledFace, renderForm33FiledFace,
//     renderBccaBookFiledFace, renderBccaFactumFiledFace -- build their own documents and never
//     pass through toFiledFace, so nothing here guards them. Tracked separately as #816.

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import {
  goldenPath,
  seedApplicationResponse,
  seedBcscConsentOrder,
  seedBcscDefaultJudgment,
  seedVaniacProceeding,
} from "./fixtures/forms-render-seeds.mjs";
import { STAY_RESPONSE_CASE_DATA, STAY_RESPONSE_SEED, STAY_RESPONSE_POSITIONS } from "./fixtures/bcca-stay-response-seed.mjs";
import { assertHeadingListInStep } from "./helpers/filed-face-scan.mjs";
import { FACTUM_CASE_DATA, FACTUM_SEED } from "./fixtures/bcca-factum-seed.mjs";
const { freshSubmissionDb } = await import("./helpers/template-db.mjs");
const { writePartiesOfRecord } = await import("./helpers/matter-data-fixture.mjs");
const { submissionDataExecute } = await import("../build/submission/backend.js");
const { REGISTERED_FILLERS } = await import("../build/submission/forms/filler-registry.js");
const { submissionFormsRender } = await import("../build/submission/forms.js");

// The Job Board is no document of a filed render -- absent, not stripped. It may never appear in a
// filed render of any kind.
const NEVER_DELIVERED = ["Work_board"];

/**
 * Every filing kind, the delivered document_type values its filed render produces, and the filed
 * golden pinning each one. `faces` is the whole delivered set for that kind: a new delivered
 * document type fails the set comparison below until it is declared here WITH a golden.
 *
 * The set comparison is only as complete as each seed. Witness_statement appears for
 * submissions_package solely because seedVaniacProceeding seeds witness documents; a face that
 * renders only when some table has rows would slip past a seed that lacks them. A seed added here
 * must exercise every conditional face of its kind.
 */
const DECLARED = [
  {
    kind: "submissions_package",
    seed: seedVaniacProceeding,
    // forms-render-vaniac.db.test.mjs
    faces: {
      Written_arguments: "written-argument-filed",
      Evidence_index: "evidence-index-filed",
      Witness_statement: "witness-statement-filed",
    },
  },
  {
    kind: "notice_of_application",
    // seedBcscDefaultJudgment seeds the requisition shape; the Notice of Application is that same
    // proceeding re-kinded, exactly as forms-render-bcsc.db.test.mjs does it. associate_judge must
    // be set -- the filed face refuses outright while it is undetermined (#451).
    seed: async (dbPath) => {
      await seedBcscDefaultJudgment(dbPath);
      await submissionDataExecute(
        dbPath,
        `
        INSERT INTO hearing_details (filing_id, hearing_date, hearing_time, time_estimate_minutes, associate_judge)
          VALUES (1, '2026-09-01', '9:45 am', 45, 1);
        UPDATE filings SET kind = 'notice_of_application', subkind = NULL, title = 'Notice of Application' WHERE id = 1;`.trim()
      );
    },
    // forms-render-bcsc.db.test.mjs
    faces: {
      Notice_of_application: "notice-of-application-filed",
      Written_arguments: "written-argument-companion-filed",
    },
  },
  {
    kind: "requisition_default_judgment",
    seed: seedBcscDefaultJudgment,
    // forms-render-bcsc.db.test.mjs
    faces: {
      Requisition: "requisition-default-judgment-filed",
      Default_judgment: "form-8-default-judgment-filed",
      Written_arguments: "written-argument-companion-filed",
    },
  },
  {
    kind: "requisition_consent",
    seed: seedBcscConsentOrder,
    // forms-render-bcsc.db.test.mjs
    faces: {
      Requisition: "requisition-consent-filed",
      Consent_order: "consent-order-filed",
      Written_arguments: "written-argument-companion-filed",
    },
  },
  {
    kind: "application_response",
    seed: seedApplicationResponse,
    // application-response.db.test.mjs
    faces: {
      Application_response: "application-response-filed",
      Written_arguments: "written-argument-companion-filed",
    },
  },
  {
    kind: "bcca_stay_response",
    seed: (dbPath) => {
      writePartiesOfRecord(dirname(dbPath), STAY_RESPONSE_CASE_DATA);
      return submissionDataExecute(dbPath, STAY_RESPONSE_SEED + STAY_RESPONSE_POSITIONS);
    },
    // bcca-stay-response.db.test.mjs -- the book IS the written argument, so no companion.
    // NOTE: this seed inserts no opposing_authorities row, which is the state that makes
    // renderBccaStayResponse emit its "Opposing application book's table of authorities not yet
    // transcribed" line. The line is built with mockupMessage, so toFiledFace drops it whole. The
    // response-book-filed golden is generated from the OTHER state (bcca-stay-response.db.test.mjs
    // seeds an opposing_authorities row), so this state is pinned by assertion instead, in
    // bcca-mockup-messages.db.test.mjs (#1243).
    faces: { Response_book: "response-book-filed" },
  },
  {
    kind: "bcca_factum",
    seed: (dbPath) => {
      writePartiesOfRecord(dirname(dbPath), FACTUM_CASE_DATA);
      return submissionDataExecute(dbPath, FACTUM_SEED);
    },
    // bcca-factum.db.test.mjs -- the factum IS the written argument, so no companion.
    faces: { Factum: "factum-filed" },
  },
];

function caseLabel(c) {
  return c.kind;
}

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "coclerk-filed-face-coverage-"));
  return { dbPath: join(dir, "submission.sqlite"), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("the filed-face scan's mockup-only heading list is in step with filed-face.ts", () => {
  assertHeadingListInStep();
});

test("every filing kind the filler registry renders has its delivered faces declared", () => {
  const registeredKinds = REGISTERED_FILLERS.map((key) => key.kind);
  const declaredKinds = new Set(DECLARED.map((c) => c.kind));
  assert.deepEqual(
    registeredKinds.filter((kind) => !declaredKinds.has(kind)),
    [],
    "the filler registry renders a kind no case in DECLARED covers. " +
      "Add the kind here with every delivered document_type it renders and that face's filed golden."
  );
  // The converse, so a stale DECLARED entry says so plainly instead of failing later on a render
  // that composes to no filler.
  assert.deepEqual(
    [...declaredKinds].filter((kind) => !registeredKinds.includes(kind)),
    [],
    "DECLARED names a kind the filler registry no longer renders -- remove the stale case."
  );
});

for (const c of DECLARED) {
  test(`${caseLabel(c)} delivers exactly its declared faces, each with a filed golden`, async () => {
    const f = fixture();
    try {
      await freshSubmissionDb(f.dbPath);
      await c.seed(f.dbPath);

      const result = submissionFormsRender(f.dbPath, 1, {}, "filed");
      assert.equal(result.citation_gate_failed, undefined, `the citation gate fired on ${caseLabel(c)}`);
      assert.equal(result.associate_judge_gate_failed, undefined, `the associate-judge gate fired on ${caseLabel(c)}`);

      const delivered = [...new Set(result.documents.map((d) => d.document_type))].sort();
      assert.deepEqual(
        delivered,
        Object.keys(c.faces).sort(),
        `${caseLabel(c)}'s filed render delivers a different set of document types than DECLARED says. ` +
          "A new delivered face needs a filed golden of its own before it can ship."
      );

      for (const [documentType, golden] of Object.entries(c.faces)) {
        assert.ok(
          existsSync(goldenPath(golden)),
          `${caseLabel(c)}'s ${documentType} face has no filed golden at ${goldenPath(golden)}. ` +
            "Review the render by eye, then regenerate with COCLERK_REGENERATE_GOLDEN=1."
        );
      }

      for (const documentType of NEVER_DELIVERED) {
        assert.ok(
          !result.documents.some((d) => d.document_type === documentType),
          `${documentType} reached a filed render of ${caseLabel(c)} -- it is never delivered and must be absent, not stripped`
        );
      }
    } finally {
      f.cleanup();
    }
  });
}
