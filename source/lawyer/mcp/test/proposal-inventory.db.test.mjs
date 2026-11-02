// The render's marker inventory, end to end (Practice Board Proposals design §8, Phase D step 1):
// every generating glyph the 26 emit sites print lands in render-manifest.json's `inventory`,
// keyed on the row its work is done on. The two seeds together cover every emit site a fixture
// reaches -- the VanIAC package covers the shared submission body, the witness statements, the
// evidence index and the companions; the BCSC default judgment covers the requisition checklist.
//
// Expected keys were read off the rendered goldens (written-argument.md, the former
// brief's golden, evidence-index.md, witness-statement-unlinked-facts.md) and confirmed against a run.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { seededDbFixture, seedVaniacProceeding, seedFusedRungCases, seedBcscDefaultJudgment, seedBcscConsentOrder, ASHBOURNE, boardDataOf } from "./fixtures/forms-render-seeds.mjs";
const { freshSubmissionDb } = await import("./helpers/template-db.mjs");
const { submissionDataExecute } = await import("../build/submission/backend.js");
const { submissionFormsRender } = await import("../build/submission/forms.js");
const { proposalKey } = await import("../build/submission/forms/proposal-inventory.js");

/** The local date `days` from today, as 📇's 30-day freshness window reads `currency_checked_on`. */
function localDate(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Renders filing 1 on a freshly seeded database and returns the inventory of the manifest the render
 * wrote in the matter's `0. DRAFT/Drafting records`, as forms-render-memo-order.db.test.mjs reads it. */
async function inventoryOf(seed) {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seed(f.dbPath);
    submissionFormsRender(f.dbPath, 1, ASHBOURNE);
    const manifest = JSON.parse(readFileSync(join(f.draft, "Drafting records", "render-manifest-1.json"), "utf-8"));
    return manifest.inventory;
  } finally {
    f.cleanup();
  }
}

test("the VanIAC seed's render records exactly the keys its mockups print a generating glyph on", async () => {
  const inventory = await inventoryOf(seedVaniacProceeding);

  assert.deepEqual(
    [...new Set(inventory.filter((e) => e.generating !== false).map(proposalKey))].sort(),
    [
      "authority-rating:authorities:1",
      "doctrinal-basis:law_assertions:4",
      "draft-it:witnesses:3",
      "enter-it:documents:14",
      "enter-it:documents:9",
      "exhibit-excerpt:admissions:1",
      "exhibit-pinpoint:admissions:5",
      "exhibit-pinpoint:statements_of_fact:7",
      "factual-basis:submissions:1",
      "factual-basis:submissions:3",
      "interview:witnesses:3",
      "jurisdictional-basis:order_sought:2",
      "jurisdictional-basis:order_sought:3",
      "not-recorded:documents:2",
      "note-up:authorities:2",
      "primary-authority:law_assertions:2",
      "primary-authority:law_assertions:3",
      "proposition:submissions:3",
      "scrutinize:statements_of_law:4",
      "serve-it:documents:10",
      "sign-it:documents:3",
      "unserved-petitum:order_sought:2",
      "unserved-petitum:order_sought:3",
    ]
  );

  const noteUp = inventory.filter((e) => proposalKey(e) === "note-up:authorities:2");
  assert.ok(noteUp.length > 0, "expected the reserved authority's 📇 to be recorded");
  for (const e of noteUp) assert.equal(e.cleared, false, "statement 4 is a lead, so its authority has cleared nothing");

  // Decision f: the killed authority's own rows print no glyph, so nothing keys on them.
  for (const e of inventory) {
    assert.ok(
      !(e.table === "statements_of_law" && (e.id === 5 || e.id === 6)),
      `statements_of_law ${e.id} belongs to the killed authority and must record nothing`
    );
    assert.ok(!(e.table === "authorities" && e.id === 4), "the killed authority must record nothing");
  }
});

// #908: the proposition line prints its rung fused to 🏅 (🥈🏅, 🥉🏅), and the rung still generates
// "Find primary authority" keyed on the proposition, with the bare rung as its marker. A dead end's
// line reads 🚧 alone, so it records no rung.
test("a rung fused to 🏅 still records primary-authority; a 🚧 line records none", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedVaniacProceeding(f.dbPath);
    await seedFusedRungCases(f.dbPath);
    const result = submissionFormsRender(f.dbPath, 1, ASHBOURNE);

    const advocacy = result.documents.filter((d) => d.document_type !== "practice_board");
    const printed = advocacy.flatMap((d) => readFileSync(d.path, "utf-8").split("\n"));
    const lineOf = (id) => printed.find((l) => l.endsWith(`<!-- law_assertion_id ${id} -->`));
    assert.ok(lineOf(20).endsWith(`sources 🥈🏅 <!-- law_assertion_id 20 -->`), lineOf(20));
    assert.ok(lineOf(21).endsWith(`sources 🥉🏅 <!-- law_assertion_id 21 -->`), lineOf(21));
    // 🚧 is an event (table 1b), so it does not hold back 🧐 (#912).
    assert.ok(lineOf(22).endsWith(`sources 🚧🧐 <!-- law_assertion_id 22 -->`), lineOf(22));

    const manifest = JSON.parse(readFileSync(join(dirname(dirname(advocacy[0].path)), "Drafting records", "render-manifest-1.json"), "utf-8"));
    const rungs = (id) => [
      ...new Set(manifest.inventory.filter((e) => e.generating !== false && e.table === "law_assertions" && e.id === id).map((e) => `${proposalKey(e)} ${e.marker}`)),
    ];
    assert.deepEqual(rungs(20), ["primary-authority:law_assertions:20 🥈"]);
    assert.deepEqual(rungs(21), ["primary-authority:law_assertions:21 🥉"]);
    assert.deepEqual(rungs(22), [], "🚧 owns the dead end's line, so no rung is recorded");

    const cards = boardDataOf(f.dbPath, 1, ASHBOURNE).proposals.filter((p) => p.slug === "primary-authority");
    assert.deepEqual(
      cards.filter((p) => p.key.endsWith(":20") || p.key.endsWith(":21")).map((p) => [p.key, p.title]),
      [
        ["primary-authority:law_assertions:20", "Find primary authority: a proposition resting on secondary and unrated sources"],
        ["primary-authority:law_assertions:21", "Find primary authority: a proposition resting on tertiary and unrated sources"],
      ]
    );
  } finally {
    f.cleanup();
  }
});

// #1628: a statute, regulation or rule owes 📇 by its statute-currency result, read through the
// submission-law and jurisdictional-edge queries alike. Authority 1 (distinguishable) backs
// statement 1's doctrinal line and order 1's basis edge; authority 2 backs statement 4.
test("a statute's 📇 reads its currency on the doctrinal line and the order's basis line, and repealed proposes nothing", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedVaniacProceeding(f.dbPath);
    await submissionDataExecute(f.dbPath, "UPDATE statements_of_law SET verification = 'verified' WHERE id = 4;");
    const state = async (sql) => {
      if (sql !== null) await submissionDataExecute(f.dbPath, sql);
      const result = submissionFormsRender(f.dbPath, 1, ASHBOURNE);
      const printed = result.documents.filter((d) => d.document_type !== "practice_board").flatMap((d) => readFileSync(d.path, "utf-8").split("\n"));
      const marked = (tag) => printed.filter((l) => l.includes(tag)).some((l) => l.includes("📇"));
      const keys = boardDataOf(f.dbPath, 1, ASHBOURNE).proposals.map((p) => p.key).filter((k) => k.startsWith("note-up:"));
      return { statement1: marked("<!-- statement_of_law_id 1 -->"), order1: marked("<!-- relief_item a -->"), statement4: marked("<!-- statement_of_law_id 4 -->"), keys };
    };
    assert.deepEqual(await state(null), { statement1: false, order1: false, statement4: true, keys: ["note-up:authorities:2"] }, "every seed authority is a case");
    assert.deepEqual(
      await state("UPDATE authorities SET kind = 'statute' WHERE id IN (1, 2);"),
      { statement1: true, order1: true, statement4: true, keys: ["note-up:authorities:1", "note-up:authorities:2"] },
      "unchecked currency, treatment notwithstanding"
    );
    assert.deepEqual(
      await state(`UPDATE authorities SET currency_status = 'current', currency_checked_on = '${localDate(-31)}' WHERE id = 1; UPDATE authorities SET currency_status = 'repealed' WHERE id = 2;`),
      { statement1: true, order1: true, statement4: true, keys: ["note-up:authorities:1"] },
      "a 'current' checked more than 30 days ago is stale and keeps 📇"
    );
    assert.deepEqual(
      await state(`UPDATE authorities SET currency_checked_on = '${localDate(0)}' WHERE id = 1;`),
      { statement1: false, order1: false, statement4: true, keys: [] },
      "current clears 📇; repealed prints it and proposes nothing"
    );
    assert.deepEqual(
      await state("UPDATE authorities SET kind = 'doctrine', currency_status = NULL WHERE id = 2;"),
      { statement1: false, order1: false, statement4: false, keys: [] },
      "doctrine never prints 📇"
    );
  } finally {
    f.cleanup();
  }
});

test("the BCSC default-judgment seed records the requisition checklist's ⬜", async () => {
  const keys = new Set((await inventoryOf(seedBcscDefaultJudgment)).map(proposalKey));

  // Site 25: the fixture attaches an `order` document and no affidavit, so exactly one ⬜ prints.
  assert.ok(keys.has("unchosen:filings:1:affidavit"), "expected ⬜ on the missing affidavit");
  assert.ok(!keys.has("unchosen:filings:1:order"), "the draft order is attached, so no ⬜ prints for it");
});

// #960: a requisition's own order lines -- the Form 8 Default Judgment (primary and alternative
// alike) and the Consent Order -- carry no 🦵. Neither form has a place for argument, so "draft a
// submission for the order" named work nobody would do, and it outlived the order's entry. Brahm's
// call 2026-09-24 on #960 (option A: never on requisitions, both kinds).
for (const [kind, seed, venueDocs] of [
  ["default-judgment", seedBcscDefaultJudgment, ["Form 8 Default Judgment.md", "Form 17 Draft Requisition.md"]],
  ["consent", seedBcscConsentOrder, ["Consent Order.md", "Requisition for Consent Order.md"]],
]) {
  test(`a ${kind} requisition's order lines record no 🦵 and derive no unserved-petitum Proposal`, async () => {
    const keys = (await inventoryOf(seed)).map(proposalKey);
    assert.deepEqual(keys.filter((k) => k.startsWith("unserved-petitum:")), [], "expected no unserved-petitum inventory key");

    const f = seededDbFixture();
    try {
      await freshSubmissionDb(f.dbPath);
      await seed(f.dbPath);
      const result = submissionFormsRender(f.dbPath, 1, ASHBOURNE);
      for (const name of venueDocs) {
        const doc = result.documents.find((d) => d.file_name === name);
        assert.ok(doc, `expected ${name}`);
        assert.ok(!doc.markdown.includes("🦵"), `expected no 🦵 on ${name}`);
      }
      const cards = boardDataOf(f.dbPath, 1, ASHBOURNE).proposals.filter((p) => p.slug === "unserved-petitum");
      assert.deepEqual(cards, [], "expected no \"Draft a submission for the order\" Proposal");
    } finally {
      f.cleanup();
    }
  });
}

// #829: a live Form 8 order with no template_key prints ⬜ "(template not chosen)", and that is
// practitioner work -- choosing the template -- so it yields one choose-template card keyed on the
// order, primary or alternative alike. A crossed-out order records nothing, and an unrecognized
// key's 🏷️ stays non-generating: it is a data defect, not a choice left open (#825 already keeps
// both off the filed face).
test("a keyless live Form 8 order yields one choose-template card; struck and unrecognized keys yield none", async () => {
  const f = seededDbFixture();
  try {
    await freshSubmissionDb(f.dbPath);
    await seedBcscDefaultJudgment(f.dbPath);
    await submissionDataExecute(
      f.dbPath,
      `UPDATE order_sought SET template_key = NULL WHERE id IN (1, 3);
       UPDATE order_sought SET template_key = 'costs_agreed' WHERE id = 2;`
    );
    const proposals = () => (submissionFormsRender(f.dbPath, 1, ASHBOURNE), boardDataOf(f.dbPath, 1, ASHBOURNE).proposals);
    const chooseCards = () => proposals().filter((p) => p.slug === "choose-template");

    assert.ok(
      !proposals().some((p) => p.key.endsWith(":order_sought:2")),
      "the unrecognized key's 🏷️ generates nothing"
    );
    assert.deepEqual(
      chooseCards().map((p) => [p.key, p.title]),
      [
        ["choose-template:order_sought:1", "Choose the order template: damages to be assessed"],
        ["choose-template:order_sought:3", "Choose the order template: costs in a fixed amount"],
      ]
    );

    await submissionDataExecute(f.dbPath, `UPDATE order_sought SET crossed_out_on = '2026-09-22' WHERE id = 1;`);
    assert.deepEqual(chooseCards().map((p) => p.key), ["choose-template:order_sought:3"], "a crossed-out order records nothing");
  } finally {
    f.cleanup();
  }
});
