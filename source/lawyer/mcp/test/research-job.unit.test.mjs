// The mechanical part of a legal research job's form: the title is the prefix and the intent, and the
// intent is one to three sentences whose last, and only last, ends in a question mark.

import assert from "node:assert/strict";
import test from "node:test";

const { RESEARCH_JOB_PREFIX, researchFormProblems, isResearchTitle } = await import("../build/submission/forms/research-job.js");

const problems = (intent, title = `${RESEARCH_JOB_PREFIX}${intent}`) => researchFormProblems(title, intent);

test("an issue in the form has no problems, abbreviations and citations included", () => {
  for (const intent of [
    "Does a request to correct an award extend the time to set it aside?",
    "A commercial tenant holds over. Does the landlord's acceptance of rent renew the lease?",
    "A commercial tenant holds over. The lease is silent. Does acceptance of rent renew it?",
    "Under s. 164 of the Act, does time run from service?",
    "Does Hunt v. Carey Canada Inc. govern a claim struck under R. 9-5?",
    "Does [2020] 1 S.C.R. 123 apply in B.C. and Alberta?",
    "A party, e.g. a tenant, relies on para. 12 of the lease. Does it bind the assignee?",
  ]) {
    assert.deepEqual(problems(intent), [], intent);
  }
});

test("each failed check is named", () => {
  for (const [intent, pattern] of [
    ["Whether the rule applies", /must end in/],
    ["Is it legal? Is it wise?", /only the last sentence/],
    ["Is it legal? It may be.", /must end in/],
    ["One. Two. Three. Is it legal?", /at most 3 sentences/],
    ["Is it\nlegal?", /line break/],
    [" Is it legal?", /no space/],
    [`${RESEARCH_JOB_PREFIX}Is it legal?`, /must not itself open/],
    [`${"Is it legal in this place ".repeat(20)}?`, /at most 500/],
  ]) {
    assert.ok(problems(intent).some((p) => pattern.test(p)), `${intent}: ${problems(intent).join("; ")}`);
  }
});

test("the title must be the prefix and the intent, character for character", () => {
  assert.match(problems("Is it legal?", `${RESEARCH_JOB_PREFIX}Is it lawful?`)[0], /character for character/);
  assert.equal(isResearchTitle("legal research: Is it legal?"), false);
  assert.equal(isResearchTitle(`${RESEARCH_JOB_PREFIX}Is it legal?`), true);
});
