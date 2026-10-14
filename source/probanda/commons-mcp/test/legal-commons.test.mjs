import assert from "node:assert/strict";
import test from "node:test";

const index = await import("../build/index.js");
const schemaGen = await import("../build/schema-gen.js");

// A fake LegalCommonsClient that records calls and needs no network. Enough
// surface for the dispatch wiring: get + rpc. Retrieval is in-Postgres now, so
// there is no embed() step to fake.
function fakeLegalCommons() {
  const calls = { get: [], rpc: [], patch: [], fn: [] };
  return {
    calls,
    async callFunction(name, body = {}) {
      calls.fn.push({ name, body });
      return { results: [] };
    },
    async get(table, filters = {}, options = {}) {
      calls.get.push({ table, filters, options });
      return [];
    },
    async rpc(fn, body = {}) {
      calls.rpc.push({ fn, body });
      return { ok: true, fn };
    },
    async patch(table, filters = {}, body = {}) {
      calls.patch.push({ table, filters, body });
      return [{ table, ...body }];
    },
  };
}

// Deliberately signed OUT and crypto LOCKED, to prove legal-commons routes
// before requireReady (spec §7 1a: static credential, no login/unlock gate).
function context(legalCommons) {
  return {
    admin: {},
    legalCommons,
    auth: { hasSession: () => false },
    keyStore: {},
    userId: () => "unused",
    matterStates: new Map(),
  };
}

test("legal-commons tools route without any auth/crypto gate", async () => {
  const lc = fakeLegalCommons();
  const result = await index.callTool(context(lc), "legal_commons__resolve_by_id", {
    id: "00000000-0000-4000-8000-000000000001",
  });
  assert.deepEqual(result, { ok: true, fn: "resolve_principle" });
  assert.equal(lc.calls.rpc[0].fn, "resolve_principle");
  assert.equal(lc.calls.rpc[0].body.p_id, "00000000-0000-4000-8000-000000000001");
});

test("push calls push_principle with a matter-free payload and a doctrine tag", async () => {
  const lc = fakeLegalCommons();
  await index.callTool(context(lc), "legal_commons__push", {
    text: "A limitation period runs from discovery.",
    jurisdiction: "BC",
    doctrine_tag: "limitation-discoverability",
    authorities: [{ citation: "SBC 2012, c 13", url: "https://example.test" }],
    criteria: [{ description: "the claim was discovered", criterion_order: 1 }],
  });

  const pushCall = lc.calls.rpc.find((c) => c.fn === "push_principle");
  assert.ok(pushCall, "push_principle RPC was called");
  assert.equal(pushCall.body.p_text, "A limitation period runs from discovery.");
  assert.equal(pushCall.body.p_doctrine_tag, "limitation-discoverability");
  assert.equal(pushCall.body.p_authorities[0].citation, "SBC 2012, c 13");
  // No embedding anywhere — retrieval is in-Postgres.
  assert.ok(!("p_embedding" in pushCall.body), "push carries no embedding");
  // Structural severance backstop: no matter_id anywhere in the payload.
  assert.equal(JSON.stringify(pushCall.body).includes("matter_id"), false);
});

test("push carries the currency fields the payload supplies", async () => {
  const lc = fakeLegalCommons();
  await index.callTool(context(lc), "legal_commons__push", {
    text: "A limitation period runs from discovery.",
    authorities: [
      { citation: "2019 BCCA 1", treatment: "overruled", last_verified_at: "2026-09-01T00:00:00Z" },
    ],
  });
  const pushCall = lc.calls.rpc.find((c) => c.fn === "push_principle");
  assert.equal(pushCall.body.p_authorities[0].treatment, "overruled");
  assert.equal(pushCall.body.p_authorities[0].last_verified_at, "2026-09-01T00:00:00Z");
});

test("record_treatment passes the treating packet and both tenses to the RPC", async () => {
  const lc = fakeLegalCommons();
  await index.callTool(context(lc), "legal_commons__record_treatment", {
    treating: { citation: "2026 BCCA 100", title: "R v Example" },
    treated_authority_id: "00000000-0000-4000-8000-000000000002",
    treatment: "overrules",
    scope: "partial",
    edge_treatment: "overruled",
  });
  const call = lc.calls.rpc.find((c) => c.fn === "record_treatment");
  assert.ok(call);
  assert.equal(call.body.p_treating.citation, "2026 BCCA 100");
  assert.equal(call.body.p_treated_authority_id, "00000000-0000-4000-8000-000000000002");
  assert.equal(call.body.p_treatment, "overrules");
  assert.equal(call.body.p_scope, "partial");
  assert.equal(call.body.p_edge_treatment, "overruled");
});

// D7: an oral treatment note records the edge only — it never restates what a
// principle's authority now is, so the past-tense stamp must go through as null.
test("record_treatment sends a null edge_treatment for an oral note", async () => {
  const lc = fakeLegalCommons();
  await index.callTool(context(lc), "legal_commons__record_treatment", {
    treating: { citation: "Oral reasons, BCSC S-123456, Smith J, 2026-09-01" },
    treated_authority_id: "00000000-0000-4000-8000-000000000002",
    treatment: "declines_to_follow",
  });
  const call = lc.calls.rpc.find((c) => c.fn === "record_treatment");
  assert.equal(call.body.p_edge_treatment, null);
  assert.equal(call.body.p_scope, null);
});

// The pool's treatment columns are bare text — nothing in Postgres refuses a
// typo, so the runtime is the only guard.
test("record_treatment rejects a treatment outside the vocabulary, and a tense mix-up", async () => {
  const lc = fakeLegalCommons();
  await assert.rejects(
    () => index.callTool(context(lc), "legal_commons__record_treatment", {
      treating: { citation: "2026 BCCA 100" },
      treated_authority_id: "00000000-0000-4000-8000-000000000002",
      treatment: "doubted",
    }),
    /treatment must be one of/
  );
  await assert.rejects(
    () => index.callTool(context(lc), "legal_commons__record_treatment", {
      treating: { citation: "2026 BCCA 100" },
      treated_authority_id: "00000000-0000-4000-8000-000000000002",
      // present tense in the past-tense field
      treatment: "overrules",
      edge_treatment: "overrules",
    }),
    /edge_treatment must be one of/
  );
  assert.equal(lc.calls.rpc.length, 0, "nothing reaches the pool");
});

test("stamp_verified patches last_verified_at, defaulting to now", async () => {
  const lc = fakeLegalCommons();
  await index.callTool(context(lc), "legal_commons__stamp_verified", {
    authority_id: "00000000-0000-4000-8000-000000000003",
  });
  const call = lc.calls.patch[0];
  assert.equal(call.table, "authority");
  assert.equal(call.filters.authority_id, "eq.00000000-0000-4000-8000-000000000003");
  assert.ok(typeof call.body.last_verified_at === "string" && call.body.last_verified_at.endsWith("Z"));
});

test("amend_authority refuses an empty patch and passes the fields it is given", async () => {
  const lc = fakeLegalCommons();
  await assert.rejects(
    () => index.callTool(context(lc), "legal_commons__amend_authority", {
      authority_id: "00000000-0000-4000-8000-000000000003",
    }),
    /at least one of title, url, authority_type/
  );
  assert.equal(lc.calls.patch.length, 0);

  await index.callTool(context(lc), "legal_commons__amend_authority", {
    authority_id: "00000000-0000-4000-8000-000000000003",
    title: "Reasons for Judgment",
    authority_type: "case_law",
  });
  assert.equal(lc.calls.patch[0].table, "authority");
  assert.equal(lc.calls.patch[0].body.title, "Reasons for Judgment");
  assert.equal(lc.calls.patch[0].body.authority_type, "case_law");
  assert.ok(!("url" in lc.calls.patch[0].body), "an unsupplied field is not patched to null");
});

test("find_candidates passes the retrieval packet to the union RPC (no embedding)", async () => {
  const lc = fakeLegalCommons();
  await index.callTool(context(lc), "legal_commons__find_candidates", {
    rephrasings: ["time runs from discovery", "claim accrues when discoverable"],
    doctrine_tag: "limitation-discoverability",
    citations: ["SBC 2012, c 13"],
    k: 10,
  });
  const call = lc.calls.rpc.find((c) => c.fn === "find_candidates");
  assert.ok(call);
  assert.deepEqual(call.body.p_rephrasings, ["time runs from discovery", "claim accrues when discoverable"]);
  assert.equal(call.body.p_doctrine_tag, "limitation-discoverability");
  assert.deepEqual(call.body.p_citations, ["SBC 2012, c 13"]);
  assert.equal(call.body.p_k, 10);
  assert.ok(!("p_embedding" in call.body), "no embedding in the retrieval call");
});

// Supabase's API log keeps the address of every request and not its body, so a
// keyword in a GET's query string would be saved on the cloud (Commandment 3).
test("browse sends its keyword in an RPC body, never in a GET address", async () => {
  const lc = fakeLegalCommons();
  await index.callTool(context(lc), "legal_commons__browse", { keyword: "limitation" });
  assert.equal(lc.calls.get.length, 0);
  assert.deepEqual(lc.calls.rpc, [{ fn: "browse_principles", body: { p_keyword: "limitation", p_limit: 50 } }]);
});

// The meaning search runs in an Edge Function, which replies with prose and
// pinpoint citations only, so the pool's internal structure never reaches this
// machine. Its text travels in a POST body, never in an address.
test("search sends its text to the search function in a POST body", async () => {
  const lc = fakeLegalCommons();
  const result = await index.callTool(context(lc), "legal_commons__search", { text: "a lender recovers a note", limit: 3 });
  assert.deepEqual(result, { results: [] });
  assert.deepEqual(lc.calls.fn, [{ name: "commons-find", body: { text: "a lender recovers a note", limit: 3 } }]);
  assert.equal(lc.calls.get.length + lc.calls.rpc.length, 0, "no direct pool read");
});

test("search defaults to five principles", async () => {
  const lc = fakeLegalCommons();
  await index.callTool(context(lc), "legal_commons__search", { text: "x" });
  assert.deepEqual(lc.calls.fn[0].body, { text: "x", limit: 5 });
});

test("input validation still applies to legal-commons tools", async () => {
  const lc = fakeLegalCommons();
  await assert.rejects(
    () => index.callTool(context(lc), "legal_commons__push", { jurisdiction: "BC" }),
    /text is required/
  );
  await assert.rejects(
    () => index.callTool(context(lc), "legal_commons__push", { text: "x", bogus: 1 }),
    /unknown field/
  );
});

test("every legal_commons tool is registered and matter-free (no matter_id)", () => {
  const defs = schemaGen.buildToolDefinitions();
  const lc = defs.filter((t) => t.name.startsWith("legal_commons__"));
  assert.deepEqual(lc.map((t) => t.name).sort(), [
    "legal_commons__amend_authority",
    "legal_commons__amend_authority_edge",
    "legal_commons__amend_criterion_text",
    "legal_commons__amend_principle_text",
    "legal_commons__browse",
    "legal_commons__configure_credential",
    "legal_commons__configure_status",
    "legal_commons__find_candidates",
    "legal_commons__link_authority",
    "legal_commons__lookup_by_citation",
    "legal_commons__merge_authority",
    "legal_commons__push",
    "legal_commons__record_treatment",
    "legal_commons__resolve_by_id",
    "legal_commons__rule_period_find",
    "legal_commons__rule_period_push",
    "legal_commons__rule_period_record_verification",
    "legal_commons__rule_period_retire",
    "legal_commons__search",
    "legal_commons__stamp_verified",
    "legal_commons__treatment_chain",
    "legal_commons__unlink_authority",
  ]);
  for (const tool of lc) {
    assert.ok(!("matter_id" in (tool.inputSchema.properties ?? {})), `${tool.name} has no matter_id`);
  }
});

// configure_credential's persistence path (writeProtectedJson -> DPAPI on
// win32) is covered separately in dpapi-store.test.mjs; here we cover the
// validation and probe that run before any file I/O, so these pass on every
// platform the test suite runs on.
function fakeConfigurable(probeFails = false) {
  let key = "";
  return {
    probeCount: 0,
    staticKey: () => key,
    setStaticKey(next) { key = next; },
    async get() {
      this.probeCount += 1;
      if (probeFails) throw new Error("PostgREST failed (401): invalid api key");
      return [];
    },
  };
}

test("configure_credential rejects a missing static_key before touching local storage", async () => {
  const lc = fakeLegalCommons();
  await assert.rejects(
    () => index.callTool(context(lc), "legal_commons__configure_credential", {}),
    /static_key/
  );
});

test("configure_credential rejects the publishable key without probing or saving it", async () => {
  const lc = fakeConfigurable();
  await assert.rejects(
    () => index.callTool(context(lc), "legal_commons__configure_credential", {
      static_key: "sb_publishable_ABCDEFGHIJKLMNOP",
    }),
    /publishable \(anon\) key/
  );
  assert.equal(lc.probeCount, 0, "must fail before spending a network round trip");
  assert.equal(lc.staticKey(), "", "must not go live");
});

// A wrong key arriving mid-session must not knock out a session that was
// already working — the probe failure has to roll the live key back.
test("configure_credential restores the previous key when the probe fails", async () => {
  const lc = fakeConfigurable(true);
  lc.setStaticKey("sb_secret_ALREADYWORKING");
  await assert.rejects(
    () => index.callTool(context(lc), "legal_commons__configure_credential", {
      static_key: "sb_secret_WRONGKEY",
    }),
    /did not work against the legal-commons pool/
  );
  assert.equal(lc.staticKey(), "sb_secret_ALREADYWORKING");
});

// configure_status is the one tool a caller may run before a credential exists,
// so it must answer rather than throw the not-configured error, and it must
// never hand back the key it is reporting on.
test("configure_status reports an unconfigured machine without a hint", async () => {
  const lc = { ...fakeLegalCommons(), hasStaticKey: () => false, redactedKeyHint: () => null };
  const result = await index.callTool(context(lc), "legal_commons__configure_status", {});
  assert.deepEqual(result, { configured: false, key_hint: null });
});

test("configure_status redacts the key it reports on", async () => {
  const key = "sb_secret_ABCDEFGHIJKLMNOPQRSTUVWXYZ7890";
  const { LegalCommonsClient } = await import("../build/legal-commons/client.js");
  const client = new LegalCommonsClient({ supabaseUrl: "https://x", staticKey: key, schema: "legal_commons" });
  const result = await index.callTool(context(client), "legal_commons__configure_status", {});
  assert.equal(result.configured, true);
  assert.equal(result.key_hint, "sb_secret_…7890");
  assert.ok(!result.key_hint.includes("ABCDEFGHIJKLMNOPQRSTUVWXYZ"), "hint must not contain the key body");
});
