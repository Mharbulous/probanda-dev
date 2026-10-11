import assert from "node:assert/strict";
import test from "node:test";

const { RestClient } = await import("../build/db/rest.js");

test("REST client sends anon key as apikey and user JWT as bearer", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (_url, init) => {
    calls.push(init);
    return new Response(JSON.stringify([{ matter_id: "m1" }]), { status: 200 });
  };
  try {
    const client = new RestClient({
      url: "https://example.supabase.co",
      anonKey: "anon-key",
      tokenProvider: async () => "user-jwt",
    });
    const rows = await client.get("matters");
    assert.equal(rows.length, 1);
    assert.equal(calls[0].headers.apikey, "anon-key");
    assert.equal(calls[0].headers.Authorization, "Bearer user-jwt");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("REST client retries once with a forced refresh on 401", async () => {
  const originalFetch = globalThis.fetch;
  const forceFlags = [];
  const authHeaders = [];
  let count = 0;
  globalThis.fetch = async (_url, init) => {
    count += 1;
    authHeaders.push(init.headers.Authorization);
    if (count === 1) return new Response("expired", { status: 401 });
    return new Response(JSON.stringify([{ ok: true }]), { status: 200 });
  };
  try {
    const client = new RestClient({
      url: "https://example.supabase.co",
      anonKey: "anon-key",
      tokenProvider: async (force) => {
        forceFlags.push(Boolean(force));
        return force ? "fresh-jwt" : "stale-jwt";
      },
    });
    const rows = await client.get("matters");
    assert.equal(rows.length, 1);
    assert.deepEqual(forceFlags, [false, true]);
    assert.deepEqual(authHeaders, ["Bearer stale-jwt", "Bearer fresh-jwt"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
