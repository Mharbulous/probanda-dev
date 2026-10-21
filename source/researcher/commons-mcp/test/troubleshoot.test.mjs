import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const index = await import("../build/index.js");
const schemaGen = await import("../build/schema-gen.js");
const { BAKED_SUPABASE_URL } = await import("../build/config.js");
const { LegalCommonsClient } = await import("../build/legal-commons/client.js");
const { credentialPath: poolCredentialPath } = await import("../build/legal-commons/config.js");
const {
  credentialPath: storeCredentialPath,
  loadTroubleshootConfig,
  persistTroubleshootCredential,
} = await import("../build/troubleshoot/config.js");

// A fake client that records every method call, getters included, so a test can
// say exactly which project a tool touched. `fail` makes every data call throw
// the way an unreachable project does.
function fakeClient({ key = "", url = "", rpcResult = [], fail = false } = {}) {
  const calls = [];
  const record = (method, args) => calls.push({ method, args });
  const data = async (method, args, result) => {
    record(method, args);
    if (fail) throw new TypeError("fetch failed");
    return result;
  };
  return {
    calls,
    staticKey() { record("staticKey"); return key; },
    projectUrl() { record("projectUrl"); return url; },
    hasStaticKey() { record("hasStaticKey"); return Boolean(key); },
    redactedKeyHint() { record("redactedKeyHint"); return null; },
    setStaticKey(next) { record("setStaticKey"); key = next; },
    setProjectUrl(next) { record("setProjectUrl"); url = next; },
    get: (...args) => data("get", args, []),
    rpc: (...args) => data("rpc", args, rpcResult),
    insert: (table, row) => data("insert", [table, row], [{ entry_id: "e-1", confirmed_count: 1, ...row }]),
    patch: (...args) => data("patch", args, []),
    delete: (...args) => data("delete", args, []),
  };
}

function context(legalCommons, troubleshoot) {
  return { legalCommons, troubleshoot };
}

// The pool as the store's env guard sees it at load time.
const POOL = { supabaseUrl: BAKED_SUPABASE_URL, staticKey: "sb_secret_POOL" };
// A state folder that does not exist, so no stored credential is found.
const ABSENT_ENV = { LOCALAPPDATA: join(tmpdir(), "coclerk-troubleshoot-test-absent") };

async function captureStderr(fn) {
  const original = process.stderr.write;
  let text = "";
  process.stderr.write = (chunk) => {
    text += String(chunk);
    return true;
  };
  try {
    return { value: await fn(), stderr: text };
  } finally {
    process.stderr.write = original;
  }
}

const VALID_ARGS = {
  troubleshoot__search: { query: "browser extension is not connected", tools: ["switch_browser"] },
  troubleshoot__record: {
    symptom: "Browser tools report the extension is not connected",
    tools: ["switch_browser", "list_connected_browsers"],
    error_strings: ["No other browsers available to switch to."],
    cause: "The extension is signed in to a different claude.ai account",
    fix: "Sign the extension in to the same account as the app",
  },
  troubleshoot__confirm_fix: { entry_id: "00000000-0000-4000-8000-000000000001" },
  troubleshoot__configure_credential: { project_url: "https://store.example.supabase.co", static_key: "sb_secret_STORE" },
  troubleshoot__configure_status: {},
};

test("the troubleshoot__* definitions are exactly the five tools", () => {
  const names = schemaGen.buildToolDefinitions()
    .map((t) => t.name)
    .filter((n) => n.startsWith("troubleshoot__"))
    .sort();
  assert.deepEqual(names, [
    "troubleshoot__configure_credential",
    "troubleshoot__configure_status",
    "troubleshoot__confirm_fix",
    "troubleshoot__record",
    "troubleshoot__search",
  ]);
  assert.deepEqual(Object.keys(VALID_ARGS).sort(), names, "the separation test below covers every tool");
});

// The separation criterion, from the runtime's side: a store tool never reaches
// the pool's client, and a pool tool never reaches the store's. The only pool
// reads a store tool makes are configure_credential's two guards (the pool's
// live URL and key), and neither is a call to the pool's project.
test("every troubleshoot__* tool touches only the store client", async () => {
  for (const [name, args] of Object.entries(VALID_ARGS)) {
    const pool = fakeClient({ key: "sb_secret_POOL", url: BAKED_SUPABASE_URL });
    // A failing probe keeps configure_credential from persisting to this machine.
    const store = fakeClient({ fail: name === "troubleshoot__configure_credential" });
    await index.dispatchTool(context(pool, store), name, args);
    assert.ok(store.calls.length > 0, `${name} reached the store client`);
    assert.deepEqual(
      pool.calls.map((c) => c.method).sort(),
      name === "troubleshoot__configure_credential" ? ["projectUrl", "staticKey"] : [],
      `${name} did not touch the pool client`
    );
  }
});

test("legal_commons__resolve_by_id touches only the pool client", async () => {
  const pool = fakeClient();
  const store = fakeClient();
  await index.callTool(context(pool, store), "legal_commons__resolve_by_id", {
    id: "00000000-0000-4000-8000-000000000001",
  });
  assert.equal(pool.calls[0].method, "rpc");
  assert.equal(pool.calls[0].args[0], "resolve_principle");
  assert.equal(store.calls.length, 0);
});

test("search and confirm_fix call the store RPCs", async () => {
  const store = fakeClient();
  await index.callTool(context(fakeClient(), store), "troubleshoot__search", VALID_ARGS.troubleshoot__search);
  assert.deepEqual(store.calls[0].args, [
    "search_entries",
    { p_query: "browser extension is not connected", p_tools: ["switch_browser"], p_k: 10 },
  ]);
  await index.callTool(context(fakeClient(), store), "troubleshoot__confirm_fix", VALID_ARGS.troubleshoot__confirm_fix);
  assert.deepEqual(store.calls[1].args, ["confirm_entry", { p_entry_id: "00000000-0000-4000-8000-000000000001" }]);
});

test("search truncates k and holds it to 1-50", async () => {
  for (const [k, expected] of [[undefined, 10], [0, 1], [-3, 1], [7.9, 7], [999, 50]]) {
    const store = fakeClient();
    const args = k === undefined ? { query: "x" } : { query: "x", k };
    await index.callTool(context(fakeClient(), store), "troubleshoot__search", args);
    assert.equal(store.calls[0].args[1].p_k, expected, `k=${k}`);
  }
});

// [kind, the fields that carry it, text the refusal must not echo]
const REFUSALS = [
  ["email", { symptom: "Sign-in fails for jdoe@example.com" }, ["jdoe@example.com", "jdoe"]],
  ["email", { source_url: "mailto:jdoe@example.com" }, ["jdoe@example.com", "jdoe"]],
  ["user_path", { error_strings: ["ENOENT: C:\\Users\\jdoe\\AppData\\Local\\x.json"] }, ["jdoe"]],
  ["user_path", { error_strings: ["open /Users/jdoe/Library/x.json failed"] }, ["jdoe"]],
  ["user_path", { error_strings: ["open /home/jdoe/.config/x.json failed"] }, ["jdoe"]],
  ["user_path", { error_strings: ["cd /c/Users/jdoe/Git failed"] }, ["jdoe"]],
  ["user_path", { error_strings: ["cd /c/users/jdoe/Git failed"] }, ["jdoe"]],
  ["user_path", { error_strings: ["cat /mnt/c/Users/jdoe/AppData/x"] }, ["jdoe"]],
  ["user_path", { error_strings: ["cat /mnt/c/home/jdoe/x"] }, ["jdoe"]],
  ["user_path", { fix: "Delete C:\\Users\\<jdoe>\\AppData\\Local\\x" }, ["<jdoe>", "jdoe"]],
  ["matter_folder", { fix: "Move the file out of C:\\Docs\\0. CASE DATA\\Smith v Jones\\notes" }, ["Smith"]],
  ["matter_folder", { fix: "Open 0. CASE DATA/<jdoe>/notes" }, ["<jdoe>", "jdoe"]],
  [
    "matter_folder",
    { error_strings: ["EPERM: D:\\Firm\\Litigation - Documents\\Smith v Jones\\pleadings"] },
    ["Smith"],
  ],
  ["matter_folder", { error_strings: ["EPERM: /sync/Litigation - Documents/Smith v Jones"] }, ["Smith"]],
  ["too_long", { cause: "a".repeat(2001) }, ["a".repeat(50)]],
];

for (const [kind, override, leaks] of REFUSALS) {
  test(`record refuses ${kind} in ${JSON.stringify(override).slice(0, 60)} without echoing it`, async () => {
    const store = fakeClient();
    const result = await index.dispatchTool(context(fakeClient(), store), "troubleshoot__record", {
      ...VALID_ARGS.troubleshoot__record,
      ...override,
    });
    assert.equal(result.isError, true);
    const message = JSON.parse(result.content[0].text).error.message;
    assert.match(message, /^record refused: /);
    assert.ok(message.includes(kind), `message names ${kind}: ${message}`);
    for (const leak of leaks) assert.ok(!message.includes(leak), `message does not contain "${leak}"`);
    assert.equal(store.calls.length, 0, "refused before any store call");
  });
}

const ALLOWED = [
  "could not read C:\\Users\\<user>\\AppData\\Local\\Coclerk\\troubleshoot\\credential.json.dpapi",
  "could not read C:\\Users\\<username>\\AppData\\Local\\x",
  "C:\\Users\\Public\\Documents is read-only",
  "C:\\Users\\Default\\AppData is a template profile",
  "set it under C:\\Users\\%USERNAME%\\AppData\\Local",
  "run: dir \"C:\\Users\\$env:USERNAME\\AppData\"",
  "C:/Users/<user>/AppData/Local/x",
  "cd /c/Users/<user>/Git",
  "cat /home/<user>/.config/x",
  "file_ops__move refuses any path inside 0. CASE DATA",
  "the server writes under 0. CASE DATA\\<matter>\\housekeeping",
  "the server writes under 0. CASE DATA/<folder>/form-sessions",
  "Litigation - Documents\\0. CASE DATA\\<matter>\\x",
  "Litigation - Documents/<folder>/x",
  "the root is Litigation - Documents",
  "git@github.com: Permission denied (publickey).",
  "git clone git@gitlab.com:owner/repo.git failed",
  "bounce from noreply@github.com",
  "bounce from No-Reply@accounts.example.com",
  "see https://example.com/home/page",
  "GET /users/123 returned 404",
];

test("record lets every allow-listed form through", async () => {
  for (const text of ALLOWED) {
    const store = fakeClient();
    const result = await index.dispatchTool(context(fakeClient(), store), "troubleshoot__record", {
      ...VALID_ARGS.troubleshoot__record,
      error_strings: [text],
    });
    assert.equal(result.isError, undefined, `"${text}" passes: ${result.content[0].text}`);
    assert.equal(store.calls[0].method, "insert");
    assert.equal(store.calls[0].args[0], "entry");
  }
});

test("record refuses array fields holding anything but strings, before any call", async () => {
  for (const override of [{ tools: ["switch_browser", 1] }, { error_strings: [{ note: "jdoe@example.com" }] }]) {
    const store = fakeClient();
    await assert.rejects(
      () => index.callTool(context(fakeClient(), store), "troubleshoot__record", {
        ...VALID_ARGS.troubleshoot__record,
        ...override,
      }),
      /must be an array of strings/
    );
    assert.equal(store.calls.length, 0);
  }
});

test("configure_credential refuses the pool, a non-https URL and the publishable key without probing", async () => {
  const cases = [
    [{ project_url: `${BAKED_SUPABASE_URL.toUpperCase()}/`, static_key: "sb_secret_STORE" }, /pool's project URL/],
    [{ project_url: `${BAKED_SUPABASE_URL}/rest/v1`, static_key: "sb_secret_STORE" }, /pool's project URL/],
    [{ project_url: "https://live-pool.example.co/rest/v1/", static_key: "sb_secret_STORE" }, /pool's project URL/],
    [{ project_url: "https://store.example.supabase.co", static_key: "sb_secret_POOL" }, /pool's key/],
    [{ project_url: "http://store.example.supabase.co", static_key: "sb_secret_STORE" }, /must be an https:\/\/ URL/],
    [{ project_url: "store.example.supabase.co", static_key: "sb_secret_STORE" }, /not a valid URL/],
    [{ project_url: "https://store.example.supabase.co", static_key: "sb_publishable_ABC" }, /publishable \(anon\) key/],
  ];
  for (const [args, pattern] of cases) {
    const pool = fakeClient({ key: "sb_secret_POOL", url: "https://live-pool.example.co" });
    const store = fakeClient();
    await assert.rejects(
      () => index.callTool(context(pool, store), "troubleshoot__configure_credential", args),
      pattern
    );
    assert.equal(store.calls.length, 0, `nothing reached the store client for ${args.project_url}`);
  }
});

test("configure_credential restores the previous URL and key when the probe fails", async () => {
  const store = fakeClient({ key: "sb_secret_OLD", url: "https://old.example.supabase.co", fail: true });
  await assert.rejects(
    () => index.callTool(context(fakeClient({ key: "sb_secret_POOL" }), store), "troubleshoot__configure_credential", {
      project_url: "https://new.example.supabase.co",
      static_key: "sb_secret_NEW",
    }),
    /did not work against the troubleshooting store/
  );
  assert.equal(store.staticKey(), "sb_secret_OLD");
  assert.equal(store.projectUrl(), "https://old.example.supabase.co");
});

// The disk write fails at its mkdir, before any DPAPI call: the state folder is
// pointed under an ordinary file, where no folder can be created.
test("configure_credential reports a failed save and keeps the working credential live", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "coclerk-troubleshoot-persist-"));
  const blocker = join(dir, "not-a-folder");
  await writeFile(blocker, "x");
  const saved = process.env.LOCALAPPDATA;
  process.env.LOCALAPPDATA = blocker;
  t.after(async () => {
    process.env.LOCALAPPDATA = saved;
    await rm(dir, { recursive: true, force: true });
  });

  const store = fakeClient();
  const result = await index.callTool(context(fakeClient({ key: "sb_secret_POOL" }), store), "troubleshoot__configure_credential", {
    project_url: "https://store.example.supabase.co",
    static_key: "sb_secret_STORE",
  });
  assert.equal(result.configured, true);
  assert.equal(result.persisted, false);
  assert.match(result.warning, /could not be saved to disk/);
  assert.equal(store.staticKey(), "sb_secret_STORE");
  assert.equal(store.projectUrl(), "https://store.example.supabase.co");
});

test("configure_status never returns the key", async () => {
  const key = "sb_secret_ABCDEFGHIJKLMNOPQRSTUVWXYZ7890";
  const client = new LegalCommonsClient({
    supabaseUrl: "https://store.example.supabase.co",
    staticKey: key,
    schema: "troubleshoot",
    label: "troubleshoot",
  });
  const result = await index.callTool(context(fakeClient(), client), "troubleshoot__configure_status", {});
  assert.equal(result.configured, true);
  assert.equal(result.project_url, "https://store.example.supabase.co");
  assert.equal(result.key_hint, "sb_secret_…7890");
  assert.ok(!JSON.stringify(result).includes(key), "the full key is not in the result");
  assert.ok(!JSON.stringify(result).includes("ABCDEFGHIJKLMNOPQRSTUVWXYZ"), "the key body is not in the result");
});

test("the store's credential file is its own, beside the pool's", () => {
  const env = { LOCALAPPDATA: join(tmpdir(), "coclerk-troubleshoot-test") };
  assert.ok(storeCredentialPath(env).endsWith(join("Coclerk", "troubleshoot", "credential.json.dpapi")));
  assert.notEqual(storeCredentialPath(env), poolCredentialPath(env));
});

// Writes and reads a real DPAPI file, in a temporary state folder.
test("the env credential wins over the stored file", async (t) => {
  if (process.platform !== "win32") {
    t.skip("the stored credential is DPAPI-encrypted, which is Windows-only");
    return;
  }
  const dir = await mkdtemp(join(tmpdir(), "coclerk-troubleshoot-stored-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const env = { LOCALAPPDATA: dir };
  await persistTroubleshootCredential("https://stored.example.supabase.co", "sb_secret_STORED", env);

  const stored = await loadTroubleshootConfig(env, POOL);
  assert.equal(stored.supabaseUrl, "https://stored.example.supabase.co");
  assert.equal(stored.staticKey, "sb_secret_STORED");

  const fromEnv = await loadTroubleshootConfig(
    { ...env, TROUBLESHOOT_SUPABASE_URL: "https://env.example.supabase.co", TROUBLESHOOT_SUPABASE_KEY: "sb_secret_ENV" },
    POOL
  );
  assert.equal(fromEnv.supabaseUrl, "https://env.example.supabase.co");
  assert.equal(fromEnv.staticKey, "sb_secret_ENV");
});

test("the env guard refuses the pool's URL or key and starts unconfigured", async () => {
  const cases = [
    [{ TROUBLESHOOT_SUPABASE_URL: `${BAKED_SUPABASE_URL}/rest/v1`, TROUBLESHOOT_SUPABASE_KEY: "sb_secret_STORE" }, POOL, /URL is the legal-commons pool's project/],
    [
      { TROUBLESHOOT_SUPABASE_URL: "https://LIVE-POOL.example.co/", TROUBLESHOOT_SUPABASE_KEY: "sb_secret_STORE" },
      { supabaseUrl: "https://live-pool.example.co", staticKey: "sb_secret_POOL" },
      /URL is the legal-commons pool's project/,
    ],
    [{ TROUBLESHOOT_SUPABASE_URL: "https://store.example.supabase.co", TROUBLESHOOT_SUPABASE_KEY: "sb_secret_POOL" }, POOL, /KEY is the legal-commons pool's key/],
  ];
  for (const [env, pool, reason] of cases) {
    const { value: config, stderr } = await captureStderr(() => loadTroubleshootConfig({ ...ABSENT_ENV, ...env }, pool));
    assert.equal(config.supabaseUrl, "");
    assert.equal(config.staticKey, "");
    assert.match(stderr, reason);
    await assert.rejects(() => new LegalCommonsClient(config).get("entry"), (error) => {
      assert.match(error.message, /is not configured/);
      assert.match(error.message, reason);
      return true;
    });
  }
});

test("one env var without the other is reported and ignored", async () => {
  for (const env of [{ TROUBLESHOOT_SUPABASE_URL: "https://store.example.supabase.co" }, { TROUBLESHOOT_SUPABASE_KEY: "sb_secret_STORE" }]) {
    const { value: config, stderr } = await captureStderr(() => loadTroubleshootConfig({ ...ABSENT_ENV, ...env }, POOL));
    assert.match(stderr, /only TROUBLESHOOT_SUPABASE_(URL|KEY) is set/);
    assert.equal(config.staticKey, "");
    assert.equal(config.supabaseUrl, "");
  }
});

// The three store states the troubleshooter reports must stay distinguishable:
// answered-and-empty, did-not-answer, and not configured.
test("search keeps an empty store, an unreachable store and an unconfigured store apart", async () => {
  const empty = await index.dispatchTool(context(fakeClient(), fakeClient()), "troubleshoot__search", { query: "x" });
  assert.equal(empty.isError, undefined);
  assert.deepEqual(JSON.parse(empty.content[0].text), { entries: [] });

  const down = await index.dispatchTool(context(fakeClient(), fakeClient({ fail: true })), "troubleshoot__search", {
    query: "x",
  });
  assert.equal(down.isError, true);
  assert.deepEqual(JSON.parse(down.content[0].text).error, { code: "data_error", message: "fetch failed" });

  const unconfigured = new LegalCommonsClient(await loadTroubleshootConfig(ABSENT_ENV, POOL));
  const none = await index.dispatchTool(context(fakeClient(), unconfigured), "troubleshoot__search", { query: "x" });
  assert.equal(none.isError, true);
  assert.match(JSON.parse(none.content[0].text).error.message, /is not configured/);
});

test("each client instance names itself when not configured", async () => {
  const pool = new LegalCommonsClient({ supabaseUrl: "https://x", staticKey: "", schema: "legal_commons" });
  await assert.rejects(() => pool.get("principle"), {
    message:
      "legal-commons is not configured: this computer has no Probanda key. If the practitioner has one, " +
      "call cloud_key__configure_credential and have them paste it on the page it serves; if not, " +
      "call key_request__submit so they can ask Probanda for one. A developer may instead set " +
      "LEGAL_COMMONS_SUPABASE_KEY in the runtime environment (Claude Code CLI).",
  });

  // Maintainer-only: the message never sends a practitioner after an sb_secret_ key.
  const store = new LegalCommonsClient(await loadTroubleshootConfig(ABSENT_ENV, POOL));
  await assert.rejects(() => store.get("entry"), {
    message:
      "the troubleshooting store is not configured on this computer. It is maintainer-only: never ask the " +
      "practitioner for its key or URL. Draft a confirmed fix as a suggestion through /lawyer:suggestion instead.",
  });
});
