import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

// The contributor id is minted under LOCALAPPDATA; keep it out of the real profile.
process.env.LOCALAPPDATA = mkdtempSync(join(tmpdir(), "lc-rule-periods-"));

const index = await import("../build/index.js");
const { contributorPath } = await import("../build/legal-commons/contributor.js");

function fakePool(responses = {}) {
  const calls = [];
  return {
    calls,
    async rpc(fn, body = {}) {
      calls.push({ fn, body });
      return responses[fn] ?? [];
    },
  };
}

function context(legalCommons) {
  return { legalCommons };
}

// A verified overlay record in the rule-overlay spec §6 shape. No matter content.
function record(overrides = {}) {
  return {
    record_id: "00000000-0000-4000-8000-0000000000aa",
    jurisdiction: "CA-BC",
    enactment: { name: "Supreme Court Civil Rules", citation: "B.C. Reg. 168/2009", civix_id: "168_2009" },
    amending_instrument: { reg: "B.C. Reg. 105/2026", oic: "OIC 264/2026", commencement: "2026-10-01" },
    deadline_type: "notice_of_hearing_service",
    anchor_type: "application_hearing_date",
    rule_ref: "Rule 8-1(14.5)(a)",
    offset: { value: 4, unit: "business_days", direction: "before", clear: true },
    counting: "backward_n_business_days",
    semantics: "latest_permissible",
    description: "Serve the notice of hearing before the hearing date.",
    verbatim: "at least 4 business days before the date set for the hearing of the application",
    source: { url: "https://www.bclaws.gov.bc.ca/civix/document/id/oic/oic_cur/0264_2026", fetched_at: "2026-10-05", kind: "oic_pdf" },
    effective_from: "2026-10-01",
    effective_to: null,
    supersedes: ["shipped:application_hearing_earliest"],
    open_questions: [],
    status: "verified",
    verified_by: "practitioner",
    verified_at: "2026-10-05",
    ...overrides,
  };
}

async function push(pool, records) {
  return index.callTool(context(pool), "legal_commons__rule_period_push", { records });
}

test("push sends the key columns, a content hash and the install's contributor id, with local fields stripped", async () => {
  const pool = fakePool({ rule_periods_push: [{ rule_period_id: "x", pooled: "new" }] });
  const result = await push(pool, [record()]);

  const call = pool.calls[0];
  assert.equal(call.fn, "rule_periods_push");
  const [sent] = call.body.p_records;
  assert.equal(sent.jurisdiction, "CA-BC");
  assert.equal(sent.enactment_citation, "B.C. Reg. 168/2009");
  assert.equal(sent.rule_ref, "Rule 8-1(14.5)(a)");
  assert.equal(sent.deadline_type, "notice_of_hearing_service");
  assert.equal(sent.effective_from, "2026-10-01");
  assert.equal(sent.amending_reg, "B.C. Reg. 105/2026");
  assert.match(sent.content_hash, /^[0-9a-f]{64}$/);
  for (const field of ["record_id", "status", "verified_by", "verified_at"]) {
    assert.ok(!(field in sent.record), `${field} stays local`);
  }
  assert.equal(sent.record.verbatim, record().verbatim);

  const minted = JSON.parse(readFileSync(contributorPath(), "utf8")).id;
  assert.equal(call.body.p_contributor, minted);
  assert.equal(result.contributor, minted);
});

test("a field outside the record shape is refused before any network call, top level or nested", async () => {
  const pool = fakePool();
  await assert.rejects(() => push(pool, [record({ matter_note: "x" })]), /records\[0\]\.matter_note is not a rule-record field/);
  await assert.rejects(
    () => push(pool, [record(), record({ source: { url: "https://example.test", fetched_at: "2026-10-05", file_path: "x" } })]),
    /records\[1\]\.source\.file_path is not a rule-record field/
  );
  assert.equal(pool.calls.length, 0);
});

test("a client matter code anywhere in a record refuses the whole push, naming the field and not the text", async () => {
  const pool = fakePool();
  await assert.rejects(
    () => push(pool, [record(), record({ open_questions: ["raised on file L0000"] })]),
    (error) => {
      assert.match(error.message, /records\[1\]\.open_questions\[0\] holds a client matter code/);
      assert.ok(!error.message.includes("L0000"), "the refusal does not repeat the code");
      return true;
    }
  );
  assert.equal(pool.calls.length, 0, "nothing reaches the pool");
});

test("only a locally verified record with its required fields and a dated period may be pushed", async () => {
  const pool = fakePool();
  await assert.rejects(() => push(pool, [record({ status: "unverified" })]), /status must be "verified"/);
  await assert.rejects(() => push(pool, [record({ verbatim: "" })]), /verbatim is required/);
  await assert.rejects(
    () => push(pool, [record({ amending_instrument: { oic: "OIC 264/2026" } })]),
    /amending_instrument\.reg is required/
  );
  await assert.rejects(() => push(pool, [record({ effective_from: null })]), /needs effective_from or effective_to/);
  await assert.rejects(() => push(pool, [record({ effective_from: "1 Oct 2026" })]), /YYYY-MM-DD/);
  await assert.rejects(() => push(pool, [record({ offset: { value: "4" } })]), /offset\.value must be a number/);
  await assert.rejects(() => push(pool, [record({ source: { url: "file:///x", fetched_at: "2026-10-05" } })]), /http\(s\)/);
  await assert.rejects(() => push(pool, []), /non-empty records array/);
  assert.equal(pool.calls.length, 0);
});

// The pool holds a new row for a key only when the hash differs, so the hash
// must separate a different rule and join the same rule described or sourced
// differently.
test("the content hash keys rows on what the rule does, not on how it was described", async () => {
  const pool = fakePool();
  await push(pool, [
    record(),
    record({ description: "Other words.", source: { url: "https://example.test/consolidation", fetched_at: "2026-10-06", kind: "consolidation" } }),
    record({ verbatim: "at least  4 business days before the date set for the hearing of the application " }),
    record({ offset: { value: 5, unit: "business_days", direction: "before", clear: true } }),
  ]);
  const hashes = pool.calls[0].body.p_records.map((r) => r.content_hash);
  assert.equal(hashes[1], hashes[0], "description and source do not change the hash");
  assert.equal(hashes[2], hashes[0], "whitespace in the quote does not change the hash");
  assert.notEqual(hashes[3], hashes[0], "a different offset is a different rule");
});

// No reader sees a corroboration status, a verification or attribution
// (lawyer-only-access plan §7 rules 7 and 15, #119). The fake rows carry the
// fields the pool returned before #119, so the reply must name its fields.
test("find passes its filters and replies with no status, verification or attribution", async () => {
  const me = JSON.parse(readFileSync(contributorPath(), "utf8")).id;
  const pool = fakePool({
    rule_periods_find: [
      {
        rule_period_id: "a", status: "corroborated", contributor: me, contributed_at: "2026-10-05T00:00:00Z",
        record: { rule_ref: "Rule 8-1(14.5)(a)" }, retired_at: null, retire_reason: null, shipped_version: null,
        verifications: [{ verifier: "someone-else", verified_at: "t", source_fetched_at: "2026-10-05", quote_matched: true }],
      },
      { rule_period_id: "b", status: "disputed", contributor: "someone-else", verifier: "x", mine: false },
    ],
  });
  const rows = await index.callTool(context(pool), "legal_commons__rule_period_find", {
    jurisdiction: "CA-BC",
    enactment: "B.C. Reg. 168/2009",
    amending_reg: "B.C. Reg. 105/2026",
  });
  assert.deepEqual(pool.calls[0].body, {
    p_jurisdiction: "CA-BC",
    p_enactment_citation: "B.C. Reg. 168/2009",
    p_amending_reg: "B.C. Reg. 105/2026",
    p_rule_ref: null,
    p_deadline_type: null,
  });
  for (const row of rows) {
    assert.deepEqual(Object.keys(row).sort(), [
      "contributed_at", "record", "retire_reason", "retired_at", "rule_period_id", "shipped_version",
    ]);
  }
  assert.deepEqual(rows[0].record, { rule_ref: "Rule 8-1(14.5)(a)" });
  const text = JSON.stringify(rows);
  for (const banned of ["corroborated", "disputed", "status", "verifications", "verifier", "contributor", "mine"]) {
    assert.ok(!text.includes(banned), `the reply holds no "${banned}"`);
  }
});

test("retirement is recorded under this install's id, never a caller-supplied one", async () => {
  const me = JSON.parse(readFileSync(contributorPath(), "utf8")).id;
  const pool = fakePool();
  await index.callTool(context(pool), "legal_commons__rule_period_retire", {
    id: "00000000-0000-4000-8000-0000000000bb",
    reason: "shipped in the plugin",
    shipped_version: "1.29.0",
  });
  assert.equal(pool.calls[0].fn, "rule_periods_retire");
  assert.equal(pool.calls[0].body.p_caller, me);
  assert.equal(pool.calls[0].body.p_shipped_version, "1.29.0");
  await assert.rejects(
    () => index.callTool(context(pool), "legal_commons__rule_period_retire", { id: "x", reason: "r", contributor: "spoof" }),
    /unknown field "contributor"/
  );
});
