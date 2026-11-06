// The page API (page-api/server.ts) on the shared local-page listener, answering exactly as the
// pages rendered before the move expect: /health keeps { ok, pid, started_at, plugin_version } and
// its CORS headers; OPTIONS on any path gets the 204 preflight; an unknown path or method gets
// JSON with CORS; a busy port logs the same line and is taken over; and the Loose Threads Defer,
// a suggestion card's page and click, and the /files/open token check work as before.

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { closedPort, suggestionDevice } from "./helpers/suggestion-fixture.mjs";

const { freshSubmissionDb } = await import("./helpers/template-db.mjs");
const { executeThenMove } = await import("./helpers/threads.mjs");
const { startPageApi } = await import("../build/page-api/server.js");
const { pageApiCardToken, pageApiToken } = await import("../build/page-api/token.js");
const { readThreads } = await import("../build/loose-threads/backend.js");
const card = await import("../build/suggestions/card.js");
const { loadStopWords } = await import("../build/suggestions/crosscheck.js");
const { RECORD_SOURCES } = await import("../build/suggestions/records.js");

/** A scratch probanda.json naming a free page_api_port, read through COCLERK_CONFIG_PATH. */
async function device(t) {
  const dir = mkdtempSync(join(tmpdir(), "probanda-page-api-listener-"));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
  const port = await closedPort();
  const config = join(dir, "probanda.json");
  writeFileSync(config, JSON.stringify({ version: 1, page_api_port: port }));
  return { dir, port, env: { ...process.env, COCLERK_CONFIG_PATH: config } };
}

async function listening(t, env, options = {}) {
  const lines = [];
  const api = await startPageApi(env, { log: (line) => lines.push(line), ...options });
  t.after(() => api.close());
  return { api, lines };
}

/** One HTTP exchange, with any headers (fetch drops Origin). The body is JSON, text otherwise. */
function exchange(port, method, path, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, method, path, headers }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf-8");
        let parsed = text || null;
        try { parsed = text ? JSON.parse(text) : null; } catch { /* an HTML page */ }
        resolve({ status: res.statusCode, headers: res.headers, body: parsed });
      });
    });
    req.on("error", reject);
    if (body !== undefined) req.write(JSON.stringify(body));
    req.end();
  });
}

test("/health answers ok, pid, started_at and plugin_version only, with CORS for a file:// page", async (t) => {
  const f = await device(t);
  await listening(t, f.env);
  const plain = await exchange(f.port, "GET", "/health");
  assert.equal(plain.status, 200);
  assert.deepEqual(Object.keys(plain.body), ["ok", "pid", "started_at", "plugin_version"]);
  assert.equal(plain.body.ok, true);
  assert.equal(plain.body.pid, process.pid);
  assert.ok(!Number.isNaN(Date.parse(plain.body.started_at)));
  assert.equal(plain.headers["access-control-allow-origin"], undefined, "no Origin, no Allow-Origin");
  const page = await exchange(f.port, "GET", "/health", { headers: { Origin: "null" } });
  assert.equal(page.headers["access-control-allow-origin"], "null");
  assert.equal(page.headers["access-control-allow-private-network"], "true");
  assert.equal(page.headers.vary, "Origin");
});

test("OPTIONS on /health, on a route and on an unknown path gets the 204 preflight", async (t) => {
  const f = await device(t);
  await listening(t, f.env);
  const ask = { Origin: "null", "Access-Control-Request-Method": "POST", "Access-Control-Request-Private-Network": "true" };
  for (const path of ["/health", "/seeds/1/defer", "/nowhere"]) {
    const res = await exchange(f.port, "OPTIONS", path, { headers: ask });
    assert.equal(res.status, 204, path);
    assert.equal(res.headers["access-control-allow-origin"], "null", path);
    assert.equal(res.headers["access-control-allow-methods"], "GET, POST", path);
    assert.equal(res.headers["access-control-allow-headers"], "Content-Type", path);
    assert.equal(res.headers["access-control-allow-private-network"], "true", path);
    assert.equal(res.headers.vary, "Origin", path);
  }
  const other = await exchange(f.port, "OPTIONS", "/health", { headers: { Origin: "https://example.com" } });
  assert.equal(other.headers["access-control-allow-origin"], undefined, "only Origin: null is echoed");
});

test("an unknown path is a JSON 404 and a wrong method a JSON 405, each with CORS", async (t) => {
  const f = await device(t);
  await listening(t, f.env);
  const missing = await exchange(f.port, "POST", "/nowhere", { headers: { Origin: "null" } });
  assert.equal(missing.status, 404);
  assert.deepEqual(missing.body, { error: "Not found" });
  assert.equal(missing.headers["access-control-allow-origin"], "null");
  const wrong = await exchange(f.port, "GET", "/seeds/1/defer", { headers: { Origin: "null" } });
  assert.equal(wrong.status, 405);
  assert.deepEqual(wrong.body, { error: "Method not allowed" });
  assert.equal(wrong.headers["access-control-allow-origin"], "null");
  const health = await exchange(f.port, "POST", "/health", { headers: { Origin: "null" } });
  assert.equal(health.status, 405);
  assert.deepEqual(health.body, { error: "Method not allowed" });
});

test("a busy port logs one [page-api] line, retries, and is taken over when the holder closes", async (t) => {
  const f = await device(t);
  const first = await listening(t, f.env);
  assert.equal(first.api.listening(), true);
  const second = await listening(t, f.env, { retryMs: 50 });
  assert.equal(second.api.listening(), false);
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.deepEqual(second.lines, [`[page-api] port ${f.port} busy, retrying`]);
  await first.api.close();
  const end = Date.now() + 3000;
  while (!second.api.listening()) {
    if (Date.now() > end) throw new Error("the port was not taken over");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal((await exchange(f.port, "GET", "/health")).body.ok, true);
});

test("the Loose Threads Defer posts with its page's token and defers the thread", async (t) => {
  const f = await device(t);
  const dbPath = join(f.dir, "submission.sqlite");
  await freshSubmissionDb(dbPath);
  await executeThenMove(dbPath, `INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L000 - Example', NULL);
    INSERT INTO seeds (id, proceeding_id, created, surfaced_by, idea, charted_into) VALUES (1, 1, '2026-10-01T10:00', 'noticed', 'An open thread.', NULL);`);
  await listening(t, f.env);
  const post = (token) => exchange(f.port, "POST", "/seeds/1/defer", {
    headers: { "Content-Type": "application/json", Origin: "null" },
    body: { db_path: dbPath, proceeding_id: 1, token },
  });
  assert.equal((await post("0".repeat(64))).status, 403);
  const res = await post(pageApiToken(dbPath, 1, f.env));
  assert.equal(res.status, 200);
  assert.equal(res.body.outcome, "deferred");
  assert.equal(res.headers["access-control-allow-origin"], "null");
  assert.equal(readThreads(dbPath).find((s) => s.id === 1).deferred_at, res.body.deferred_at);
});

test("/files/open with a bad token is a 403 page that opens nothing", async (t) => {
  const f = await device(t);
  const opened = [];
  await listening(t, f.env, { openFile: async (p) => void opened.push(p) });
  const file = join(f.dir, "memo.md");
  writeFileSync(file, "x");
  const res = await exchange(f.port, "GET", `/files/open?path=${encodeURIComponent(file)}&token=${"0".repeat(64)}`);
  assert.equal(res.status, 403);
  assert.equal(res.headers["content-type"], "text/html; charset=utf-8");
  assert.match(res.body, /This link does not match a file/);
  assert.deepEqual(opened, []);
});

const RECORDS = { texts: Object.fromEntries(RECORD_SOURCES.map((s) => [s, []])), states: Object.fromEntries(RECORD_SOURCES.map((s) => [s, "read"])), firmName: null };
const INPUT = { origin: "practitioner", source: "user", pain_point: { text: "The deadline summary runs to three screens." }, items: [{ text: "Show the next three deadlines first." }] };

test("a card's page is served with its token, and a card click is answered with CORS", async (t) => {
  const port = await closedPort();
  const f = suggestionDevice(t, { port });
  const deps = { records: async () => RECORDS, stopWords: () => loadStopWords(process.env), seams: f.seams };
  await listening(t, f.env, { card: deps });
  const built = await card.buildCard(card.cardInput(structuredClone(INPUT)), { host: "Code" }, { ...deps, env: f.env });
  assert.equal(built.built, true);
  const token = pageApiCardToken(built.card_id, f.env);

  const page = await exchange(port, "GET", `/cards/${built.card_id}?token=${token}`);
  assert.equal(page.status, 200);
  assert.equal(page.headers["content-type"], "text/html; charset=utf-8");
  assert.match(page.body, new RegExp(`"card":"${built.card_id}"`));
  assert.equal((await exchange(port, "GET", `/cards/${built.card_id}?token=${"0".repeat(64)}`)).status, 403);

  const click = (body) => exchange(port, "POST", `/cards/${built.card_id}/dismiss`, { headers: { "Content-Type": "application/json", Origin: "null" }, body });
  assert.equal((await click({ token: "0".repeat(64) })).status, 403);
  const dismissed = await click({ token });
  assert.equal(dismissed.status, 200);
  assert.equal(dismissed.headers["access-control-allow-origin"], "null");
  assert.equal((await card.readCardState(built.card_id, { ...deps, env: f.env })).state, "dismissed");
});
