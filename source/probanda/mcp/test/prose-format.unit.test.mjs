// The prose format check (plan 2026-10-07, structured and unstructured Writings, step 5;
// forms/prose-format.ts): each rule's hit, and a near-miss that must not fire.

import assert from "node:assert/strict";
import test from "node:test";

const { proseFormatRules, formatFlag, REFUSED_FORMAT_RULES } = await import("../build/submission/forms/prose-format.js");

const cases = {
  bracket: {
    hits: ["Dated [insert date].", "The sum of $[123456].", "Signed by [CLIENT NAME].", "Due on [___]."],
    misses: ["He said it was [sic] fine.", "The court held [emphasis added] that", "As at [para. 33].", "It found [the defendant] liable."],
  },
  tbd: {
    hits: ["The hearing date is TBD.", "TODO finish this", "Amount TBC"],
    misses: ["Several TBDs remain", "the date is tbd", "the STBD port"],
  },
  note: {
    hits: ["Note: confirm with the client.", "Draft note: shorten this", "  NOTE: check the date"],
    misses: ["Please note: the hearing is at 10 am.", "Noted: the registry closes early.", "Notes: none"],
  },
  emoji: {
    hits: ["We are pleased 😀", "Launch 🚀 today", "A flag 🏳️‍🌈 here"],
    misses: ["© 2026 Fixture Law LLP", "The Brand™ mark", "A gap 🧩", "A rebuttal ↩️", "A warning ⚠"],
  },
  underscores: {
    hits: ["Dated ________", "Signed: ___"],
    misses: ["a __ b", "the snake_case_name"],
  },
};

for (const [rule, { hits, misses }] of Object.entries(cases)) {
  test(`${rule}: fires on each hit and on no near-miss`, () => {
    for (const line of hits) assert.ok(proseFormatRules(line).includes(rule), `expected ${rule} on ${JSON.stringify(line)}`);
    for (const line of misses) assert.ok(!proseFormatRules(line).includes(rule), `no ${rule} on ${JSON.stringify(line)}`);
  });
}

test("ordinary prose and a signing line break no rule", () => {
  assert.deepEqual(proseFormatRules("Your objection came after the time Example v. Authority, 2020 BCSC 1, allows."), []);
  assert.deepEqual(proseFormatRules("Yours truly,"), []);
});

test("a line breaking several rules names each, and only underscores is not refused", () => {
  assert.deepEqual(proseFormatRules("Note: amount [TBD] ____"), ["bracket", "tbd", "note", "underscores"]);
  assert.equal(formatFlag(["bracket", "tbd"]), " 🧩 <!-- format: bracket, tbd -->");
  assert.deepEqual([...REFUSED_FORMAT_RULES].sort(), ["bracket", "emoji", "note", "tbd"]);
});
