// The request shapes of the Suggestion Box's six Edge Functions
// (cloud/legal-commons/supabase/functions/suggestion-*/shape.ts): every accepted
// and refused shape. The shape modules import nothing, so Node runs them
// directly.
//
//   node --test cloud/suggestions/tests/shapes.test.mjs

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { checkSubmit, MAX_CONTEXT_LINES, MAX_ITEMS, MAX_MOCKUP_BYTES } from "../../legal-commons/supabase/functions/suggestion-submit/shape.ts";
import { checkSetStatus, DECLINE_CATEGORIES } from "../../legal-commons/supabase/functions/suggestion-set-status/shape.ts";
import { checkStatusRequest, MAX_IDS } from "../../legal-commons/supabase/functions/suggestion-status/shape.ts";
import { checkListRequest } from "../../legal-commons/supabase/functions/suggestion-list/shape.ts";
import { checkAttachRequest } from "../../legal-commons/supabase/functions/suggestion-attach-specification/shape.ts";
import { checkWithdrawRequest } from "../../legal-commons/supabase/functions/suggestion-withdraw/shape.ts";

const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const BASIC = { title: " A title ", body: " The body ", source: "user", plugin_version: "0.5.0" };
const STRUCTURED = [{ pain: "p", where: "w", done_test: "d", constraints: ["c"], changes: [{ change: "x", origin: "lawyer" }] }];

const ok = (checked) => {
  assert.ok("ok" in checked, `expected ok, got ${JSON.stringify(checked)}`);
  return checked.ok;
};
const refused = (checked) => {
  assert.ok("question" in checked, `expected a question, got ${JSON.stringify(checked)}`);
  assert.match(checked.question, /\?$/, "a refusal asks a question");
  return checked.question;
};

describe("suggestion-submit", () => {
  test("a submit with none of the new fields keeps today's record", () => {
    assert.deepEqual(ok(checkSubmit(BASIC)), { title: "A title", body: "The body", source: "user", plugin_version: "0.5.0" });
    assert.deepEqual(ok(checkSubmit({ ...BASIC, skill: " draft " })).skill, "draft");
    for (const source of ["user", "llm", "assisted"]) assert.equal(ok(checkSubmit({ ...BASIC, source })).source, source);
  });

  test("today's structured items and previews still pass, unchanged", () => {
    const previews = [{ label: "L", chosen: true, html: "<p>x</p>" }, { label: "M", chosen: false, reason: "r", html: "<p>y</p>" }];
    const out = ok(checkSubmit({ ...BASIC, items: STRUCTURED, previews }));
    assert.deepEqual(out.items, STRUCTURED);
    assert.deepEqual(out.previews, previews);
    assert.equal(out.item_texts, undefined);
  });

  test("item texts become item_texts, trimmed and in order", () => {
    assert.deepEqual(ok(checkSubmit({ ...BASIC, items: [" one ", "two"] })).item_texts, ["one", "two"]);
    assert.equal(ok(checkSubmit({ ...BASIC, items: Array(MAX_ITEMS).fill("x") })).item_texts.length, MAX_ITEMS);
  });

  test("every new field is accepted", () => {
    const body = {
      ...BASIC, origin: "probanda", fingerprint: { plugin: "lawyer", version: "0.5.0", skill: "draft", kind: "error" },
      raw_observation: " tool x failed ", environment_facts: { host: "Code" }, comment: " A comment ",
      mockup: "<div style=\"font-family:serif\">Mockup</div>",
    };
    const out = ok(checkSubmit(body));
    assert.equal(out.origin, "probanda");
    assert.deepEqual(out.fingerprint, body.fingerprint);
    assert.equal(out.raw_observation, "tool x failed");
    assert.deepEqual(out.environment_facts, { host: "Code" });
    assert.equal(out.comment, "A comment");
    assert.equal(out.mockup_html, body.mockup);
    assert.equal(ok(checkSubmit({ ...BASIC, origin: "practitioner" })).origin, "practitioner");
    assert.equal(ok(checkSubmit({ ...BASIC, fingerprint: { plugin: "lawyer", version: "1", kind: "k" } })).fingerprint.skill, undefined);
    assert.ok(ok(checkSubmit({ ...BASIC, mockup: "x".repeat(MAX_MOCKUP_BYTES) })).mockup_html);
  });

  test("the pain point may come as pain_point, and is saved in body", () => {
    const { body: _body, ...noBody } = BASIC;
    assert.equal(ok(checkSubmit({ ...noBody, pain_point: " The pain " })).body, "The pain");
    assert.equal("pain_point" in ok(checkSubmit({ ...noBody, pain_point: "p" })), false);
    for (const bad of [
      { ...BASIC, pain_point: "p" }, { ...noBody, pain_point: "" }, { ...noBody, pain_point: "x".repeat(2001) }, { ...noBody, pain_point: 1 },
    ]) refused(checkSubmit(bad));
  });

  test("context lines: constraint and evidence lines in order, trimmed", () => {
    const lines = [{ kind: "constraint", text: " No nested boxes " }, { kind: "evidence", text: "White on green" }];
    assert.deepEqual(ok(checkSubmit({ ...BASIC, context_lines: lines })).context_lines,
      [{ kind: "constraint", text: "No nested boxes" }, { kind: "evidence", text: "White on green" }]);
    assert.equal(ok(checkSubmit({ ...BASIC, context_lines: Array(MAX_CONTEXT_LINES).fill({ kind: "evidence", text: "x" }) })).context_lines.length,
      MAX_CONTEXT_LINES);
    for (const bad of [
      [], "No nested boxes", ["No nested boxes"], [{ kind: "note", text: "x" }], [{ kind: "evidence" }], [{ kind: "evidence", text: " " }],
      [{ kind: "evidence", text: "x".repeat(2001) }], [{ kind: "constraint", text: "x", status: "approved" }],
      Array(MAX_CONTEXT_LINES + 1).fill({ kind: "evidence", text: "x" }), Array(20).fill({ kind: "evidence", text: "x".repeat(2000) }),
    ]) refused(checkSubmit({ ...BASIC, context_lines: bad }));
  });

  test("the required fields are refused when missing or too long", () => {
    for (const bad of [
      { ...BASIC, title: "" }, { ...BASIC, body: "  " }, { ...BASIC, title: "x".repeat(2001) }, { ...BASIC, body: 5 },
      { ...BASIC, source: "someone" }, { ...BASIC, plugin_version: "" }, { ...BASIC, plugin_version: "x".repeat(101) },
      { ...BASIC, skill: " " }, { ...BASIC, skill: "x".repeat(101) },
    ]) refused(checkSubmit(bad));
  });

  test("items, previews and every new field are refused in a wrong shape", () => {
    for (const bad of [
      { items: [] }, { items: "one" }, { items: Array(MAX_ITEMS + 1).fill("x") }, { items: ["one", ""] },
      { items: ["one", "x".repeat(2001)] }, { items: ["one", STRUCTURED[0]] }, { items: [{ pain: "p" }] },
      { items: [{ ...STRUCTURED[0], changes: [{ change: "x", origin: "someone" }] }] },
      { previews: [] }, { previews: [{ label: "L", html: "<p/>" }] }, { previews: Array(5).fill({ label: "L", chosen: true, html: "h" }) },
      { origin: "user" }, { origin: 1 },
      { fingerprint: "lawyer" }, { fingerprint: { plugin: "lawyer", version: "1" } },
      { fingerprint: { plugin: "lawyer", version: "1", kind: "k", where: "x" } }, { fingerprint: { plugin: "lawyer", version: "1", kind: "k", skill: "" } },
      { raw_observation: "" }, { raw_observation: "x".repeat(4001) }, { raw_observation: 3 },
      { environment_facts: [] }, { environment_facts: "Code" }, { environment_facts: { big: "x".repeat(100_001) } },
      { comment: "" }, { comment: "x".repeat(2001) },
      { mockup: "" }, { mockup: 5 }, { mockup: "x".repeat(MAX_MOCKUP_BYTES + 1) }, { mockup: "é".repeat(MAX_MOCKUP_BYTES / 2 + 1) },
      { mockup: "<script>x</script>" }, { mockup: "<SCRIPT>" }, { mockup: "<link rel=stylesheet>" }, { mockup: "<a class=x href=\"#\">" },
      { mockup: "<img src=\"data:x\">" }, { mockup: "see http://example" }, { mockup: "<iframe>" },
      { mockup: "<style>@import 'x.css'</style>" }, { mockup: "<div style=\"background:url(//host/x.png)\">" },
    ]) refused(checkSubmit({ ...BASIC, ...bad }));
  });
});

describe("suggestion-set-status", () => {
  test("the per-item decision", () => {
    assert.deepEqual(ok(checkSetStatus({ suggestion_id: ID, item: 1, status: "approved", reason: " Worth doing " })),
      { form: "item", suggestion_id: ID, item: 1, status: "approved", reason: "Worth doing", category: null });
    for (const category of DECLINE_CATEGORIES) {
      assert.equal(ok(checkSetStatus({ suggestion_id: ID, item: 2, status: "declined", reason: "No", category })).category, category);
    }
  });

  test("the per-item decision is refused without a reason, or with a wrong category", () => {
    const base = { suggestion_id: ID, item: 1, status: "approved" };
    for (const bad of [
      base, { ...base, reason: "" }, { ...base, reason: "  " }, { ...base, reason: "a\nb" }, { ...base, reason: "x".repeat(201) },
      { ...base, reason: 3 }, { ...base, reason: "Yes", category: "not enough detail" },
      { ...base, status: "declined", reason: "No" }, { ...base, status: "declined", reason: "No", category: "not recorded" },
      { ...base, status: "declined", reason: "No", category: "Not Enough Detail" }, { ...base, status: "declined", category: "already suggested" },
      { ...base, item: 0, reason: "Yes" }, { ...base, item: 51, reason: "Yes" }, { ...base, item: 1.5, reason: "Yes" }, { ...base, item: "1", reason: "Yes" },
      { ...base, status: "undecided", reason: "Yes" }, { ...base, status: "under review" }, { ...base, status: "rejected", reason: "No" },
      { ...base, reason: "Yes", issue_number: 4 }, { ...base, reason: "Yes", extra: 1 },
    ]) refused(checkSetStatus(bad));
  });

  test("implemented, by automation", () => {
    assert.deepEqual(ok(checkSetStatus({ suggestion_id: ID, item: 3, status: "implemented", implemented_in: "file-manager 0.4.12" })),
      { form: "implemented", suggestion_id: ID, item: 3, implemented_in: "file-manager 0.4.12" });
    for (const release of [undefined, "", "lawyer", "lawyer 0.4", "Lawyer 0.4.2", "lawyer v0.4.2", "lawyer  0.4.2", 4]) {
      refused(checkSetStatus({ suggestion_id: ID, item: 3, status: "implemented", implemented_in: release }));
    }
    refused(checkSetStatus({ suggestion_id: ID, item: 3, status: "implemented", implemented_in: "lawyer 0.4.2", reason: "x" }));
    refused(checkSetStatus({ suggestion_id: ID, status: "implemented", implemented_in: "lawyer 0.4.2" }));
  });

  test("recording the issue, by automation, with no status", () => {
    assert.deepEqual(ok(checkSetStatus({ suggestion_id: ID, issue_number: 61 })), { form: "issue", suggestion_id: ID, issue_number: 61 });
    for (const bad of [0, -3, 1.5, "61", null]) refused(checkSetStatus({ suggestion_id: ID, issue_number: bad }));
    refused(checkSetStatus({ suggestion_id: ID, issue_number: 61, reason: "x" }));
    refused(checkSetStatus({ suggestion_id: "x", issue_number: 61 }));
    refused(checkSetStatus({ suggestion_id: ID, item: 1, issue_number: 61 }));
  });

  test("under review, by automation", () => {
    assert.deepEqual(ok(checkSetStatus({ suggestion_id: ID, status: "under review", issue_number: 12 })),
      { form: "review", suggestion_id: ID, issue_number: 12 });
    assert.equal(ok(checkSetStatus({ suggestion_id: ID, status: "under review" })).issue_number, null);
    for (const bad of [0, -1, 1.5, "12"]) refused(checkSetStatus({ suggestion_id: ID, status: "under review", issue_number: bad }));
    refused(checkSetStatus({ suggestion_id: ID, status: "under review", reason: "x" }));
  });

  test("the old whole-suggestion form is retired: a decision naming no item is refused, reason or not", () => {
    for (const bad of [
      { status: "approved" }, { status: "approved", issue_number: 9 }, { status: "approved in part" },
      { status: "rejected" }, { status: "rejected", reason: "Asked before", category: "already suggested" },
      { status: "approved", reason: "Worth doing" }, { status: "declined", reason: "No", category: "already suggested" },
      { status: "new" }, { status: "approved", item_number: 1 },
    ]) assert.match(refused(checkSetStatus({ suggestion_id: ID, ...bad })), /item/);
  });

  test("no form changes an item's status without a reason", () => {
    // Every write that moves an item: approved and declined need their reason,
    // implemented needs the release its fixed reason is made from.
    for (const status of ["approved", "declined"]) {
      for (const reason of [undefined, "", " ", "\n", "a\nb", null, 0, "x".repeat(201)]) {
        const body = { suggestion_id: ID, item: 1, status, category: status === "declined" ? "already works as asked" : undefined };
        if (reason !== undefined) body.reason = reason;
        if (body.category === undefined) delete body.category;
        refused(checkSetStatus(body));
      }
    }
    refused(checkSetStatus({ suggestion_id: ID, item: 1, status: "implemented" }));
    // The two writes that move no item take no reason at all.
    refused(checkSetStatus({ suggestion_id: ID, status: "under review", reason: "Opened" }));
    refused(checkSetStatus({ suggestion_id: ID, issue_number: 3, reason: "Filed" }));
  });

  test("the two reasons triage recommends are declines in their own categories", () => {
    for (const [reason, category] of [["Already works as asked", "already works as asked"], ["Already suggested", "already suggested"]]) {
      assert.deepEqual(ok(checkSetStatus({ suggestion_id: ID, item: 2, status: "declined", reason, category })),
        { form: "item", suggestion_id: ID, item: 2, status: "declined", reason, category });
    }
  });

  test("a bad id or status is refused", () => {
    for (const bad of [{}, { suggestion_id: "x", status: "approved" }, { suggestion_id: ID }, { suggestion_id: ID, status: 1 }]) {
      refused(checkSetStatus(bad));
    }
  });
});

describe("suggestion-status", () => {
  test("1 to 50 ids, lower case and each once", () => {
    assert.deepEqual(ok(checkStatusRequest({ suggestion_ids: [ID.toUpperCase(), ID] })), [ID]);
    assert.equal(ok(checkStatusRequest({ suggestion_ids: Array.from({ length: MAX_IDS }, () => ID) })).length, 1);
    for (const bad of [{}, { suggestion_ids: [] }, { suggestion_ids: ID }, { suggestion_ids: [ID, "x"] },
      { suggestion_ids: Array(MAX_IDS + 1).fill(ID) }, { suggestion_ids: [1] }]) refused(checkStatusRequest(bad));
  });
});

describe("suggestion-list", () => {
  test("every suggestion, one status, or the old name new", () => {
    assert.equal(ok(checkListRequest({})), null);
    for (const status of ["submitted", "under review", "withdrawn"]) assert.equal(ok(checkListRequest({ status })), status);
    assert.equal(ok(checkListRequest({ status: "new" })), "submitted");
    for (const status of ["approved", "approved in part", "rejected", "", 1, null]) refused(checkListRequest({ status }));
  });
});

describe("suggestion-attach-specification", () => {
  test("an id, a specification and the backstop's result", () => {
    assert.deepEqual(ok(checkAttachRequest({ suggestion_id: ID.toUpperCase(), specification: "Spec", backstop_result: { passed: true } })),
      { suggestion_id: ID, specification: "Spec", backstop_result: { passed: true } });
    const base = { suggestion_id: ID, specification: "Spec", backstop_result: { passed: true } };
    for (const bad of [
      { ...base, suggestion_id: "x" }, { ...base, specification: "" }, { ...base, specification: " " },
      { ...base, specification: "x".repeat(100_001) }, { ...base, specification: 1 }, { ...base, backstop_result: undefined },
      { ...base, backstop_result: [] }, { ...base, backstop_result: "passed" }, { ...base, backstop_result: { notes: "x".repeat(20_001) } },
      { ...base, extra: 1 },
    ]) refused(checkAttachRequest(bad));
  });
});

describe("suggestion-withdraw", () => {
  test("an id alone", () => {
    assert.equal(ok(checkWithdrawRequest({ suggestion_id: ID.toUpperCase() })), ID);
    for (const bad of [{}, { suggestion_id: "x" }, { suggestion_id: 1 }, { suggestion_id: ID, reason: "x" }]) {
      refused(checkWithdrawRequest(bad));
    }
  });
});
