// drafting_forms__form_currency (ADR 0038): an enactment change on record that names a BCSC form,
// against that form's /publish identity file's conformed_to list. Runs formCurrency on a scratch
// skills tree, so the record and the identity files are the fixture's, never the checkout's.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { knowledgeFixture } from "./helpers/knowledge-fixture.mjs";

const { formCurrency } = await import("../build/submission/form-currency.js");

const REG = "B.C. Reg. 105/2026";
const TODAY = "2026-10-06";

function record({ commencement = "2026-10-01", forms = ["17", "32", "33", "33.01", "68", "117.1"] } = {}) {
  return {
    _meta: { purpose: "fixture" },
    enactments: [
      {
        name: "Supreme Court Civil Rules",
        pending_changes: [
          { amending_reg: REG, amending_oic: "OIC 264/2026", commencement_date: commencement, sections: ["Rule 8-1 (1)"], forms },
        ],
      },
    ],
  };
}

function identity(number, conformedTo) {
  const tail = conformedTo === undefined ? "" : `conformed_to:${conformedTo.map((reg) => `\n  - ${reg}`).join("")}\n`;
  return `---\nform_number: ${number}\ntitle: Form ${number}\nform_key: form-${number}\nversion: not recorded\n${tail}---\n\n# Form ${number}\n`;
}

function tree(t, { change, form32 = [], form33 = [] } = {}) {
  const f = knowledgeFixture(t);
  f.shipped("docket-clerk/rule-freshness.json", record(change));
  if (form32 !== null) f.shipped("publish/CAN/BC/BCSC/Documents/notice-of-application.md", identity(32, form32));
  if (form33 !== null) f.shipped("publish/CAN/BC/BCSC/Documents/application-response.md", identity(33, form33));
  return f;
}

test("a change in force naming the form, not conformed, warns naming the reg and the form", (t) => {
  const f = tree(t);
  const result = formCurrency("form-32", TODAY, f.seams);
  assert.equal(result.form_key, "form-32");
  assert.equal(result.form_number, "32");
  assert.equal(result.identity_file, "publish/CAN/BC/BCSC/Documents/notice-of-application.md");
  assert.deepEqual(result.unconformed, [
    { amending_reg: REG, amending_oic: "OIC 264/2026", commencement_date: "2026-10-01", enactment: "Supreme Court Civil Rules" },
  ]);
  assert.equal(
    result.warning,
    "Form 32: B.C. Reg. 105/2026 (OIC 264/2026), in force 2026-10-01, is recorded as amending this form, and the shipped Form 32 template, emitter and type file are not recorded as conformed to it."
  );
  assert.equal(result.update_doc, "publish/subskills/publish-bcsc-form/references/form-update.md");
});

test("a change not yet in force warns of nothing", (t) => {
  const f = tree(t, { change: { commencement: "2026-10-07" } });
  const result = formCurrency("form-32", TODAY, f.seams);
  assert.deepEqual(result.unconformed, []);
  assert.equal(result.warning, null);
});

test("a form whose identity file lists the reg is clear, while the other form still warns", (t) => {
  const f = tree(t, { form32: [REG] });
  const form32 = formCurrency("form-32", TODAY, f.seams);
  assert.deepEqual(form32.conformed_to, [REG]);
  assert.equal(form32.warning, null);
  const form33 = formCurrency("form-33", TODAY, f.seams);
  assert.match(form33.warning, /^Form 33: B\.C\. Reg\. 105\/2026 /);
});

test("a change whose forms do not include this form warns of nothing", (t) => {
  const f = tree(t, { change: { forms: ["17", "33"] } });
  const result = formCurrency("form-32", TODAY, f.seams);
  assert.deepEqual(result.unconformed, []);
  assert.equal(result.warning, null);
});

test("a bare conformed_to: reads as an empty list", (t) => {
  const f = knowledgeFixture(t);
  f.shipped("docket-clerk/rule-freshness.json", record());
  f.shipped("publish/CAN/BC/BCSC/Documents/notice-of-application.md", `---\nform_number: 32\nform_key: form-32\nconformed_to:\n---\n`);
  const result = formCurrency("form-32", TODAY, f.seams);
  assert.deepEqual(result.conformed_to, []);
  assert.match(result.warning, /^Form 32: /);
});

test("a form with no identity file warns", (t) => {
  const f = tree(t, { form32: null, change: { forms: ["17"] } });
  const result = formCurrency("form-32", TODAY, f.seams);
  assert.equal(result.identity_file, null);
  assert.deepEqual(result.unconformed, []);
  assert.equal(result.warning, "Form 32: no identity file ships for this form, so its conformance to the enactment changes on record cannot be read.");
  // A form-<n> key with no identity file is still matched against the record by its number.
  assert.match(formCurrency("form-17", TODAY, f.seams).warning, /^Form 17: B\.C\. Reg\. 105\/2026 /);
});

function requisitions(t, consent, defaultJudgment) {
  const f = knowledgeFixture(t);
  f.shipped("docket-clerk/rule-freshness.json", record());
  f.shipped("publish/CAN/BC/BCSC/Documents/requisition-consent.md", identity(17, consent));
  f.shipped("publish/CAN/BC/BCSC/Documents/requisition-default-judgment.md", identity(17, defaultJudgment));
  return f;
}

test("Form 17 with one requisition identity file conformed still warns", (t) => {
  const f = requisitions(t, [REG], []);
  const result = formCurrency("form-17", TODAY, f.seams);
  assert.equal(
    result.identity_file,
    "publish/CAN/BC/BCSC/Documents/requisition-consent.md, publish/CAN/BC/BCSC/Documents/requisition-default-judgment.md"
  );
  assert.deepEqual(result.conformed_to, []);
  assert.match(result.warning, /^Form 17: B\.C\. Reg\. 105\/2026 /);
});

test("Form 17 with both requisition identity files conformed is clear", (t) => {
  const f = requisitions(t, [REG], [REG]);
  const result = formCurrency("form-17", TODAY, f.seams);
  assert.deepEqual(result.conformed_to, [REG]);
  assert.deepEqual(result.unconformed, []);
  assert.equal(result.warning, null);
});

test("the warning names no deadline and no date but the commencement date", (t) => {
  const f = tree(t);
  const { warning } = formCurrency("form-32", TODAY, f.seams);
  assert.doesNotMatch(warning, /deadline/i);
  assert.deepEqual(warning.match(/\d{4}-\d{2}-\d{2}/g), ["2026-10-01"]);
});

// Forms 33.01 and 30.001 resolve by their registry keys to the identity files /publish ships.
const SHIPPED_DOCUMENTS = new URL("../../../../source/skills/publish/references/CAN/BC/BCSC/Documents/", import.meta.url);

test("the shipped Form 33.01 and Form 30.001 identity files are clear", (t) => {
  const f = knowledgeFixture(t);
  f.shipped("docket-clerk/rule-freshness.json", record());
  for (const key of ["form-33.01", "form-30.001"]) {
    f.shipped(`publish/CAN/BC/BCSC/Documents/${key}.md`, readFileSync(new URL(`${key}.md`, SHIPPED_DOCUMENTS), "utf8"));
  }
  const noha = formCurrency("form-33.01", TODAY, f.seams);
  assert.equal(noha.form_number, "33.01");
  assert.equal(noha.identity_file, "publish/CAN/BC/BCSC/Documents/form-33.01.md");
  assert.deepEqual(noha.conformed_to, [REG]);
  assert.deepEqual(noha.unconformed, []);
  assert.equal(noha.warning, null);
  const cover = formCurrency("form-30.001", TODAY, f.seams);
  assert.equal(cover.form_number, "30.001");
  assert.equal(cover.identity_file, "publish/CAN/BC/BCSC/Documents/form-30.001.md");
  assert.equal(cover.warning, null);
});
