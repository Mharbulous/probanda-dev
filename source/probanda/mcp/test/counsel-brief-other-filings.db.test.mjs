// #959: an order or submission deployed only on ANOTHER filing of the proceeding (retired or live)
// is not held in reserve on the filing being rendered. The Counsel Brief lists it marker-free under
// its own heading, naming the deploying filing and its state, and it raises no Proposals. Only an
// item deployed on no filing of the proceeding keeps 🂡.

import assert from "node:assert/strict";
import test from "node:test";
import { seededDbFixture, seedBcscDefaultJudgment, boardDataOf } from "./fixtures/forms-render-seeds.mjs";
const { freshSubmissionDb } = await import("./helpers/template-db.mjs");
const { submissionDataExecute } = await import("../build/submission/backend.js");
const { submissionFormsRender } = await import("../build/submission/forms.js");

test("an order or submission deployed only on another filing is listed, not held in reserve", async () => {
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
    const brief = result.documents.find((d) => d.document_type === "Counsel_brief").markdown;

    assert.match(
      brief,
      /## Orders used on other filings\n\n- damages to be assessed — Default Judgment Requisition \(Retired\) <!-- order_sought_id 1 -->\n- costs to be assessed — Default Judgment Requisition \(Retired\) <!-- order_sought_id 2 -->\n- costs in a fixed amount — Default Judgment Requisition \(Retired\) <!-- order_sought_id 3 -->\n- an order on a live filing — Second Application \(Drafting\) <!-- order_sought_id 5 -->\n/
    );
    assert.equal(brief.split("<!-- order_sought_id 3 -->").length - 1, 1, "a placed alternative is listed once, not also held in reserve");
    assert.match(brief, /^- an order deployed nowhere .*🂡 <!-- order_sought_id 4 -->$/m, "an order deployed nowhere is still reserved");
    assert.match(
      brief,
      /## Submissions used on other filings\n\n- Argued on the retired filing\. — Default Judgment Requisition \(Retired\) <!-- submission_id 1 -->\n/
    );
    assert.equal(brief.split("<!-- submission_id 1 -->").length - 1, 1, "no argument body for a submission deployed elsewhere");
    assert.match(brief, /^R1\. \*\*Drafted but deployed nowhere\.\*\*.*🂡 <!-- submission_id 2 -->$/m, "a submission deployed nowhere is still reserved");

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

    const result = submissionFormsRender(f.dbPath, 2, { clientName: "Ledger", clientNo: "1", matterNo: "L1" });
    const brief = result.documents.find((d) => d.document_type === "Counsel_brief").markdown;

    assert.match(brief, /^- costs in a fixed amount — Default Judgment Requisition \(Drafting\) <!-- order_sought_id 3 -->$/m);
    assert.equal(brief.split("<!-- order_sought_id 3 -->").length - 1, 1, "a placed alternative is listed once, not also held in reserve");
    for (const id of [6, 8, 10]) {
      assert.match(brief, new RegExp(`^.*🂡 <!-- order_sought_id ${id} -->$`, "m"), `order ${id} is still reserved`);
    }

    const keys = boardDataOf(f.dbPath, 2).proposals.map((p) => p.key);
    assert.ok(!keys.some((k) => /:order_sought:3$/.test(k)), `no Proposal for the placed alternative: ${keys.join(", ")}`);
    for (const id of [6, 8, 10]) {
      assert.ok(keys.includes(`unserved-petitum:order_sought:${id}`), `order ${id} still raises its Proposal: ${keys.join(", ")}`);
    }
  } finally {
    f.cleanup();
  }
});
