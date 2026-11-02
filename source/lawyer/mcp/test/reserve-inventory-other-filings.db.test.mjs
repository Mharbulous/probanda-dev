// #959: an order or submission deployed only on ANOTHER filing of the proceeding (retired or live)
// is not held in reserve on the filing being rendered, and it raises no Proposals. Only an item
// deployed on no filing of the proceeding keeps its reserve Proposals.

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { seededDbFixture, seedBcscDefaultJudgment, boardDataOf } from "./fixtures/forms-render-seeds.mjs";
const { freshSubmissionDb } = await import("./helpers/template-db.mjs");
const { submissionDataExecute } = await import("../build/submission/backend.js");
const { submissionFormsRender } = await import("../build/submission/forms.js");

test("an order or submission deployed only on another filing raises no reserve Proposals", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    // Filing 1 (retired) deploys orders 1-2 and submission 1, and order 3 by placement: it is a Form 8
    // alternative to order 2 (#996). Filing 3 (drafting) deploys order 5. Order 4 and submission 2
    // are deployed nowhere.
    await seedBcscDefaultJudgment(f.dbPath);
    await submissionDataExecute(
      f.dbPath,
      `
      INSERT INTO order_sought (id, proceeding_id, wording) VALUES (4, 1, 'an order deployed nowhere'), (5, 1, 'an order on a live filing');
      INSERT INTO submissions (id, proceeding_id, contention, ordinal)
        VALUES (1, 1, 'Argued on the retired filing.', 1), (2, 1, 'Drafted but deployed nowhere.', 2);
      INSERT INTO filing_submissions (filing_id, submission_id, document, ordinal) VALUES (1, 1, 'form', 1);
      UPDATE filings SET decided_on = '2026-09-02', retired_on = '2026-09-10', retirement_reason = 'decided' WHERE id = 1;
      INSERT INTO filings (id, proceeding_id, kind, subkind, round, title)
        VALUES (2, 1, 'notice_of_application', NULL, NULL, 'Notice of Application'),
               (3, 1, 'notice_of_application', NULL, NULL, 'Second Application');
      INSERT INTO filing_orders (filing_id, order_sought_id, document, ordinal) VALUES (3, 5, 'form', 1);
      `.trim()
    );

    const result = submissionFormsRender(f.dbPath, 2, { clientName: "Ledger", clientNo: "1", matterNo: "L1" });

    // The reserve inventory writes no document: no Counsel Brief file, entry or timing.
    const advocacy = result.documents.find((d) => d.document_type !== "practice_board");
    assert.ok(!existsSync(join(dirname(advocacy.path), "Counsel Brief.md")), "no Counsel Brief.md is written");
    assert.ok(!result.documents.some((d) => d.document_type === "Counsel_brief"), "no Counsel_brief document is returned");
    assert.ok(!result.timings.some((t) => /Counsel Brief/.test(t.phase)), `no Counsel Brief timing: ${result.timings.map((t) => t.phase).join(", ")}`);

    const keys = boardDataOf(f.dbPath, 2).proposals.map((p) => p.key);
    assert.ok(!keys.some((k) => /:order_sought:(1|2|3|5)$/.test(k)), `no Proposal for orders deployed elsewhere: ${keys.join(", ")}`);
    assert.ok(!keys.some((k) => /:submissions:1$/.test(k)), `no Proposal for a submission deployed elsewhere: ${keys.join(", ")}`);
    assert.ok(keys.includes("unserved-petitum:order_sought:4"), `order 4 still raises its Proposal: ${keys.join(", ")}`);
    assert.ok(keys.some((k) => /:submissions:2$/.test(k)), `submission 2 still raises its Proposal: ${keys.join(", ")}`);
  } finally {
    f.cleanup();
  }
});

test("#996: an alternative placed on a live sibling Form 8 is used there; other alternatives stay reserved", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    // Filing 1 (drafting Form 8) deploys orders 1-2 on its form, so order 3 (alternative to 2) by
    // placement. Order 6 is an alternative to order 5, which only a notice of application deploys.
    // Order 8 is an alternative to order 7, which the Form 8 deploys on its written argument, not
    // its form. Order 10 is an alternative to order 9, deployed nowhere.
    await seedBcscDefaultJudgment(f.dbPath);
    await submissionDataExecute(
      f.dbPath,
      `
      INSERT INTO order_sought (id, proceeding_id, wording, alternative_to) VALUES
        (5, 1, 'an order on a notice', NULL), (6, 1, 'an alternative to the notice order', 5),
        (7, 1, 'an order argued only', NULL), (8, 1, 'an alternative to the argued order', 7),
        (9, 1, 'an order deployed nowhere', NULL), (10, 1, 'an alternative to the undeployed order', 9);
      INSERT INTO filings (id, proceeding_id, kind, subkind, round, title)
        VALUES (2, 1, 'notice_of_application', NULL, NULL, 'Notice of Application'),
               (3, 1, 'notice_of_application', NULL, NULL, 'Second Application');
      INSERT INTO filing_orders (filing_id, order_sought_id, document, ordinal)
        VALUES (3, 5, 'form', 1), (1, 7, 'written_argument', 1);
      `.trim()
    );

    submissionFormsRender(f.dbPath, 2, { clientName: "Ledger", clientNo: "1", matterNo: "L1" });

    const keys = boardDataOf(f.dbPath, 2).proposals.map((p) => p.key);
    assert.ok(!keys.some((k) => /:order_sought:3$/.test(k)), `no Proposal for the placed alternative: ${keys.join(", ")}`);
    for (const id of [6, 8, 10]) {
      assert.ok(keys.includes(`unserved-petitum:order_sought:${id}`), `order ${id} still raises its Proposal: ${keys.join(", ")}`);
    }
  } finally {
    f.cleanup();
  }
});
