// drafting_forms__focus_view_page (submission/forms/focus-view-page.ts) and the listener's POST /focus
// (page-api/server.ts): a session points the Arguments page at a card, the number checked against the
// page's own data, and the page reads the pointer back only with its page's token.

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { freshSubmissionDb } = await import("./helpers/template-db.mjs");
const { submissionDataExecute } = await import("../build/submission/backend.js");
const { submissionFormsFocusViewPage } = await import("../build/submission/forms/focus-view-page.js");
const { startPageApi } = await import("../build/page-api/server.js");
const { pageApiToken } = await import("../build/page-api/token.js");

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

async function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "coclerk-focus-"));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
  const port = await freePort();
  const configPath = join(dir, "coclerk.json");
  writeFileSync(configPath, JSON.stringify({ version: 1, page_api_port: port }));
  const env = { ...process.env, COCLERK_CONFIG_PATH: configPath };
  const dbPath = join(dir, "submission.sqlite");
  await freshSubmissionDb(dbPath);
  await submissionDataExecute(
    dbPath,
    `INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L9999 - Test', 'CAN/BC/Vancouver-International-Arbitration-Centre');
     INSERT INTO filings (id, proceeding_id, kind, round, title) VALUES (1, 1, 'submissions_package', 'opening', 'Opening');
     INSERT INTO submissions (id, proceeding_id, contention, ordinal) VALUES (1, 1, 'Held in reserve.', 1);
     INSERT INTO anticipated_points (id, proceeding_id, point) VALUES (1, 1, 'One.'), (2, 1, 'Two.');`
  );
  return { port, env, dbPath };
}

function postFocus(port, body) {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, method: "POST", path: "/focus", headers: { "Content-Type": "application/json", Origin: "null" } }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString("utf-8")) }));
    });
    req.on("error", reject);
    req.end(JSON.stringify(body));
  });
}

const args = (f, section, number) => ({ db_path: f.dbPath, filing_id: 1, page: "Arguments", section, number });

test("a pointer is written for a card the page has and read back with the page's token", async (t) => {
  const f = await fixture(t);
  const api = await startPageApi(f.env, { log: () => {} });
  t.after(() => api.close());
  const body = { db_path: f.dbPath, proceeding_id: 1, token: pageApiToken(f.dbPath, 1, f.env), filing_ids: [1] };

  assert.deepEqual((await postFocus(f.port, body)).body, { focus: null });
  const result = submissionFormsFocusViewPage(args(f, "counter", 2), f.env);
  assert.equal(result.focused, true);
  const read = await postFocus(f.port, body);
  assert.equal(read.status, 200);
  assert.equal(read.body.focus.section, "counter");
  assert.equal(read.body.focus.number, 2);

  submissionFormsFocusViewPage({ ...args(f, "rebuttals"), item: 1 }, f.env);
  const next = (await postFocus(f.port, body)).body.focus;
  assert.equal(next.section, "rebuttals");
  assert.equal(next.number, 1);
  assert.notEqual(next.id, read.body.focus.id);
  assert.equal(submissionFormsFocusViewPage({ ...args(f, "counter"), item: "anticipated:2" }, f.env).number, 2, "an item resolves to its page number");

  assert.equal((await postFocus(f.port, { ...body, token: "0".repeat(64) })).status, 403);
  assert.equal((await postFocus(f.port, { ...body, filing_ids: ["1"] })).status, 400);
});

test("a card the page lacks, or another page, is refused and writes nothing", async (t) => {
  const f = await fixture(t);
  assert.throws(() => submissionFormsFocusViewPage(args(f, "counter", 3), f.env), (e) => e.code === "no_such_card");
  assert.throws(() => submissionFormsFocusViewPage(args(f, "submissions", 1), f.env), (e) => e.code === "no_such_card");
  assert.throws(() => submissionFormsFocusViewPage({ ...args(f, "counter", 1), page: "Legal Memos" }, f.env), (e) => e.code === "unsupported_page");
  assert.throws(() => submissionFormsFocusViewPage({ ...args(f, "counter"), item: "raised:1" }, f.env), (e) => e.code === "no_such_card");
  assert.throws(() => submissionFormsFocusViewPage({ ...args(f, "counter", 1), item: "anticipated:1" }, f.env), (e) => e.code === "invalid_target");
  const api = await startPageApi(f.env, { log: () => {} });
  t.after(() => api.close());
  const read = await postFocus(f.port, { db_path: f.dbPath, proceeding_id: 1, token: pageApiToken(f.dbPath, 1, f.env), filing_ids: [1] });
  assert.deepEqual(read.body, { focus: null });
});
