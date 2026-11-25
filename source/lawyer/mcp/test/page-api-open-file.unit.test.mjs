// The page API's file link (page-api/server.ts /files/open): it opens only a file whose token a render
// wrote, answers in plain words, and carries the names a law folder really holds. A test starts no app,
// so what opens the file is a seam here.

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { get } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { startPageApi } = await import("../build/page-api/server.js");
const { pageApiFileToken, pageApiFileUrl } = await import("../build/page-api/token.js");

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

async function fixture(t, openFile) {
  const dir = mkdtempSync(join(tmpdir(), "probanda-open-file-"));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
  const port = await freePort();
  const configPath = join(dir, "coclerk.json");
  writeFileSync(configPath, JSON.stringify({ version: 1, page_api_port: port }));
  const env = { ...process.env, COCLERK_CONFIG_PATH: configPath };
  const opened = [];
  const api = await startPageApi(env, { log: () => {}, openFile: openFile ?? (async (p) => void opened.push(p)) });
  t.after(() => api.close());
  const file = join(dir, "2026-01-05 report A & B Ltd., 2019 BCSC 1 #2 +v2.docx");
  writeFileSync(file, "x");
  return { dir, env, opened, file };
}

function open(url) {
  return new Promise((resolve, reject) => {
    get(url, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString("utf-8") }));
    }).on("error", reject);
  });
}

test("a page's link opens its file, whatever the file's name holds, and names only the file", async (t) => {
  const f = await fixture(t);
  const res = await open(pageApiFileUrl(f.file, f.env));
  assert.equal(res.status, 200);
  assert.deepEqual(f.opened, [f.file]);
  assert.ok(res.body.includes("You can close this tab"), res.body);
  assert.ok(res.body.includes("A &#38; B Ltd."), "the name is escaped");
  assert.equal(res.body.includes(f.dir), false, "the reply never shows the folder");
});

test("a link with a wrong token, another file's token or no token opens nothing", async (t) => {
  const f = await fixture(t);
  const other = join(f.dir, "other.md");
  writeFileSync(other, "x");
  const base = pageApiFileUrl(f.file, f.env).split("?")[0];
  const q = (path, token) => `${base}?path=${encodeURIComponent(path)}${token === null ? "" : `&token=${token}`}`;
  assert.equal((await open(q(f.file, "0".repeat(64)))).status, 403);
  assert.equal((await open(q(f.file, pageApiFileToken(other, f.env)))).status, 403);
  assert.equal((await open(q(f.file, null))).status, 403);
  assert.deepEqual(f.opened, []);
});

test("a file gone since the render, and a file nothing can open, each get a plain answer", async (t) => {
  const f = await fixture(t);
  const gone = await open(pageApiFileUrl(join(f.dir, "gone.md"), f.env));
  assert.equal(gone.status, 404);
  assert.ok(gone.body.includes("gone.md is not in the law folder now"), gone.body);
  assert.deepEqual(f.opened, []);

  const g = await fixture(t, async () => {
    throw new Error("no app");
  });
  const failed = await open(pageApiFileUrl(g.file, g.env));
  assert.equal(failed.status, 500);
  assert.ok(failed.body.includes("could not be opened"), failed.body);
  assert.equal(failed.body.includes("no app"), false);
});

const MEMO = [
  "# Issue & answer",
  "",
  "| Case | Held |",
  "| --- | --- |",
  "| A v B | yes |",
  "",
  "<script>alert(1)</script>",
  "",
  "[click](javascript:alert(1))",
  "",
].join("\n");

test("a link to a .md shows it formatted, runs nothing from it and opens no app", async (t) => {
  const f = await fixture(t);
  const memo = join(f.dir, "2026-01-05 ML re A & B.md");
  writeFileSync(memo, MEMO);
  const res = await open(pageApiFileUrl(memo, f.env));
  assert.equal(res.status, 200);
  assert.deepEqual(f.opened, []);
  assert.equal(res.headers["content-type"], "text/html; charset=utf-8");
  assert.ok(res.body.includes("<h1>Issue &amp; answer</h1>"), res.body);
  assert.ok(res.body.includes("<table>") && res.body.includes("<td>A v B</td>"), res.body);
  assert.equal(res.body.includes("You can close this tab"), false);
  assert.equal(res.body.includes("<script"), false, "raw HTML is escaped");
  assert.ok(res.body.includes("&lt;script&gt;"), res.body);
  assert.equal(/href="javascript:/i.test(res.body), false, "a javascript: link is no link");
  assert.ok(res.body.includes("<title>2026-01-05 ML re A &#38; B.md</title>"), "the name is escaped");
  assert.equal(res.body.includes(f.dir), false, "the reply never shows the folder");
  const csp = res.headers["content-security-policy"];
  assert.ok(csp.includes("default-src 'none'") && !csp.includes("script-src"), csp);
  assert.equal(res.headers["referrer-policy"], "no-referrer");
});

test("a .md reached by another path, or with a wrong or missing token, is not shown", async (t) => {
  const f = await fixture(t);
  const memo = join(f.dir, "memo.md");
  writeFileSync(memo, MEMO);
  const base = pageApiFileUrl(memo, f.env).split("?")[0];
  const token = pageApiFileToken(memo, f.env);
  const q = (path, tok) => `${base}?path=${encodeURIComponent(path)}${tok === null ? "" : `&token=${tok}`}`;
  for (const url of [q(`${f.dir}/sub/../memo.md`, token), q(memo, "0".repeat(64)), q(memo, null)]) {
    const res = await open(url);
    assert.equal(res.status, 403, url);
    assert.equal(res.body.includes("Issue"), false);
  }
});

test("the listener opens a file only on GET", async (t) => {
  const f = await fixture(t);
  const url = new URL(pageApiFileUrl(f.file, f.env));
  const res = await fetch(url, { method: "POST" });
  assert.equal(res.status, 405);
  assert.deepEqual(f.opened, []);
});
