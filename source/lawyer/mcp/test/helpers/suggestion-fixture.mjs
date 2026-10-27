// A scratch device for the suggestion store tests: a probanda.json read through COCLERK_CONFIG_PATH
// (beside which the store and the old suggestion log sit), an install
// root whose plugin.json names the plugin and version, and a stand-in for Probanda's Cloud on
// 127.0.0.1 that records every request and answers from a handler the test sets.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { fakeCloudKeyStore } from "./fake-cloud-key-store.mjs";

export const KEY = "sb_secret_TEST_KEY";

export function suggestionDevice(t, { key = true, port } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "probanda-suggestions-"));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  const device = join(dir, "device");
  const install = join(dir, "install");
  mkdirSync(device, { recursive: true });
  mkdirSync(join(install, ".claude-plugin"), { recursive: true });
  writeFileSync(join(install, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "lawyer", version: "0.9.14" }));
  const config = join(device, "probanda.json");
  writeFileSync(config, JSON.stringify(port ? { page_api_port: port } : {}));
  const env = {
    PATH: process.env.PATH,
    COCLERK_CONFIG_PATH: config,
    SUPABASE_URL: "http://127.0.0.1:9",
    ...(key ? { LEGAL_COMMONS_SUPABASE_KEY: KEY } : {}),
  };
  const seams = { installRoot: install, keyStore: fakeCloudKeyStore(null) };
  return { dir, device, env, seams, store: join(device, "suggestions", "suggestions.json"), legacyLog: join(device, "suggestions.local.json") };
}

/** A port nothing listens on: taken from the OS, then let go. */
export function closedPort() {
  return new Promise((resolve, reject) => {
    const probe = createNetServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

/** The stand-in cloud. `respond(call)` returns [status, json]; every call is kept in `calls`. */
export async function stubCloud(t, respond) {
  const calls = [];
  const server = createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf-8");
      const call = { path: req.url, apikey: req.headers.apikey, raw, body: raw ? JSON.parse(raw) : undefined };
      calls.push(call);
      const [status, json] = stub.respond(call);
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(json));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const stub = { calls, respond, url: `http://127.0.0.1:${server.address().port}` };
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }));
  return stub;
}
