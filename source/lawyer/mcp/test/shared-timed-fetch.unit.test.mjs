// The one fetch helper with a timeout (mcp-shared/timed-fetch.js): it owns the signal and the
// redacted network-error message, and returns the Response unparsed.

import assert from "node:assert/strict";
import test from "node:test";

const { timedFetch } = await import("../../../mcp-shared/timed-fetch.js");

test("the default signal is passed beside the caller's init", async () => {
  let seen;
  await timedFetch("https://example.test/", {
    init: { method: "POST", body: "{}" },
    fetch: async (url, init) => {
      seen = { url, init };
      return new Response("");
    },
  });
  assert.equal(seen.url, "https://example.test/");
  assert.equal(seen.init.method, "POST");
  assert.equal(seen.init.body, "{}");
  assert.ok(seen.init.signal instanceof AbortSignal);
  assert.equal(seen.init.signal.aborted, false);
});

test("the Response comes back unparsed", async () => {
  const reply = new Response("not json", { status: 500 });
  assert.equal(await timedFetch("https://example.test/", { fetch: async () => reply }), reply);
  assert.equal(await reply.text(), "not json");
});

test("a network failure's message is redacted and keeps cause and name", async () => {
  const cause = { code: "ECONNRESET" };
  const failing = async () => {
    throw Object.assign(new Error("fetch failed for api_key=SECRET", { cause }), { name: "TimeoutError" });
  };
  const redact = (message) => message.replace("SECRET", "REDACTED");
  await assert.rejects(timedFetch("https://example.test/", { fetch: failing, redact }), (err) => {
    assert.equal(err.message, "fetch failed for api_key=REDACTED");
    assert.equal(err.cause, cause);
    assert.equal(err.name, "TimeoutError");
    return true;
  });
});

test("label gives the shared wording, around the redacted detail", async () => {
  const failing = async () => {
    throw new Error("boom key");
  };
  await assert.rejects(
    timedFetch("https://example.test/", { fetch: failing, label: "Service", redact: (m) => m.replace(" key", "") }),
    /^Error: Service could not be reached \(boom\)$/
  );
});

test("timeoutMs sets the signal's budget", async () => {
  const never = (_url, init) =>
    new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason)));
  // AbortSignal.timeout's timer does not hold the process open, so this one does.
  const keepAlive = setInterval(() => {}, 50);
  try {
    await assert.rejects(timedFetch("https://example.test/", { fetch: never, timeoutMs: 1 }), { name: "TimeoutError" });
  } finally {
    clearInterval(keepAlive);
  }
});

test("with no injected fetch it calls the global one at call time", async () => {
  const real = globalThis.fetch;
  globalThis.fetch = async () => new Response("stubbed");
  try {
    assert.equal(await (await timedFetch("https://example.test/")).text(), "stubbed");
  } finally {
    globalThis.fetch = real;
  }
});
