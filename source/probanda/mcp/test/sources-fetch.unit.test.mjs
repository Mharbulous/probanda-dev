// The shared fetch module behind sources__check (spec §3.3 "Shared module").
//
// The fixture is a node:http server on localhost. The guard is never relaxed
// for it: every URL here is https on a host in the test's own list
// ("fixture.test"), and a transport double carries each guarded request to the
// fixture. So https-only and the host list are exercised exactly as shipped.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const {
  createSourceFetcher,
  htmlBlocks,
  passagePresent,
  saveFetchedPdf,
  sourcesFetcher,
} = await import("../build/sources/fetch.js");
const { SOURCES_ALLOWED_HOSTS, loadFirmHosts } = await import("../build/sources/hosts.js");

const PAGE = "<html><body><h1>Fixture page</h1><p>the Registry\u2019s <i>copy</i> governs.</p></body></html>";
const PDF = Buffer.from("%PDF-1.4\n% fixture\n%%EOF\n");

const hits = new Map();
const userAgents = [];
const server = http.createServer((req, res) => {
  hits.set(req.url, (hits.get(req.url) ?? 0) + 1);
  userAgents.push(req.headers["user-agent"]);
  if (req.url === "/start") {
    res.writeHead(302, { Location: "/page" }).end();
  } else if (req.url === "/moved") {
    res.writeHead(302, { Location: "https://elsewhere.test/landing" }).end();
  } else if (req.url === "/page" || req.url === "/memo") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(PAGE);
  } else if (req.url === "/flaky" && hits.get(req.url) === 1) {
    res.writeHead(502).end();
  } else if (req.url === "/flaky") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(PAGE);
  } else if (req.url === "/down") {
    res.writeHead(502).end();
  } else if (req.url === "/rules.pdf") {
    res.writeHead(200, { "Content-Type": "application/pdf" }).end(PDF);
  } else {
    res.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();
test.after(() => server.close());

/** Carries a guarded https URL to the localhost fixture; moves bytes, decides nothing. */
const transport = {
  request(url, options, callback) {
    return http.request(
      {
        host: "127.0.0.1",
        port,
        path: url.pathname + url.search,
        method: options.method,
        headers: { ...options.headers, host: url.host },
        timeout: options.timeout,
      },
      callback
    );
  },
};

const fixtureFetcher = () => createSourceFetcher(() => ["fixture.test"], transport, () => [], 1);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

test("follows a same-host redirect and sends a browser User-Agent", async () => {
  const outcome = await fixtureFetcher().fetchSource("https://fixture.test/start");
  assert.equal(outcome.ok, true);
  assert.equal(outcome.final_url, "https://fixture.test/page");
  assert.equal(outcome.status, 200);
  assert.equal(outcome.sha256, sha256(Buffer.from(PAGE)));
  assert.deepEqual(outcome.hosts, ["fixture.test"]);
  assert.match(userAgents.at(-1), /^Mozilla\/5\.0 /);
});

test("refuses a cross-host redirect to an unlisted host, naming redirect_from", async () => {
  const outcome = await fixtureFetcher().fetchSource("https://fixture.test/moved");
  assert.deepEqual(outcome, {
    ok: false,
    reason: "host_not_allowed",
    host: "elsewhere.test",
    url: "https://elsewhere.test/landing",
    redirect_from: "https://fixture.test/moved",
    hosts: ["fixture.test"],
  });
});

test("refuses http, and an unlisted host, before any request", async () => {
  const before = [...hits.values()].reduce((a, b) => a + b, 0);
  const plain = await fixtureFetcher().fetchSource("http://fixture.test/page");
  assert.equal(plain.reason, "host_not_allowed");
  assert.equal(plain.redirect_from, undefined);
  const unlisted = await fixtureFetcher().fetchSource("https://unlisted.test/page");
  assert.equal(unlisted.reason, "host_not_allowed");
  assert.equal([...hits.values()].reduce((a, b) => a + b, 0), before);
});

test("the shipped fetcher refuses a host outside SOURCES_ALLOWED_HOSTS", async () => {
  // The members themselves are pinned by /plugin-packager's sources-host-guard.
  assert.ok(!SOURCES_ALLOWED_HOSTS.includes("unlisted.example"));
  // Refused by the guard, so no network is touched.
  const outcome = await sourcesFetcher.fetchSource("https://unlisted.example/rules");
  assert.equal(outcome.reason, "host_not_allowed");
});

test("memoizes a successful fetch: a second call within 24 hours makes no request", async () => {
  const fetcher = fixtureFetcher();
  const first = await fetcher.fetchSource("https://fixture.test/memo");
  const second = await fetcher.fetchSource("https://fixture.test/memo");
  assert.equal(hits.get("/memo"), 1);
  assert.equal(second.sha256, first.sha256);
});

test("normalizes in two stages and folds the curly apostrophe only when matching", () => {
  const html =
    "<h1>Title &amp; more</h1><p>Line one\n   continues</p>text between<br>after break" +
    "<ul><li>item&nbsp;one</li></ul><script>ignored()</script><!-- hidden -->" +
    "<p>the Registry\u2019s <b>copy</b></p>";
  const blocks = htmlBlocks(html);
  assert.deepEqual(blocks, [
    "Title & more",
    "Line one continues",
    "text between",
    "after break",
    "item one",
    "the Registry\u2019s copy",
  ]);
  const joined = blocks.join(" ");
  assert.ok(joined.includes("\u2019"), "the text keeps the curly apostrophe");
  assert.equal(passagePresent(joined, "the Registry's copy"), true);
  assert.equal(passagePresent(joined, "Line one continues\n text between"), true);
  assert.equal(passagePresent(joined, "ignored()"), false);
});

test("loads the firm's _hosts.json afresh on every call, ignoring incomplete entries", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "coclerk-hosts-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "_hosts.json");
  assert.deepEqual(loadFirmHosts(path), []);
  writeFileSync(
    path,
    JSON.stringify([
      { host: "Example.org", category: "venue", page_url: "https://example.org/", added: "2026-09-25", approved_by: "practitioner" },
      { host: "no-category.test", approved_by: "practitioner" },
      { host: "no-approval.test", category: "venue" },
    ])
  );
  assert.deepEqual(loadFirmHosts(path), ["example.org"]);
  writeFileSync(path, "\ufeff" + JSON.stringify([{ host: "second.test", category: "statute", approved_by: "practitioner" }]));
  assert.deepEqual(loadFirmHosts(path), ["second.test"]);
  writeFileSync(path, "{}");
  assert.throws(() => loadFirmHosts(path), (err) => err.code === "invalid_hosts_file");
});

test("admits a firm host only when approved_by is exactly \"practitioner\"", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "coclerk-hosts-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "_hosts.json");
  writeFileSync(
    path,
    JSON.stringify([
      { host: "admitted.test", category: "venue", approved_by: "practitioner" },
      { host: "assistant.test", category: "venue", approved_by: "assistant" },
      { host: "capital.test", category: "venue", approved_by: "Practitioner" },
    ])
  );
  assert.deepEqual(loadFirmHosts(path), ["admitted.test"]);
});

test("saves a fetched PDF as _fetched/<host>/<sha256 first 12>.pdf", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "coclerk-fetched-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const pdf = await fixtureFetcher().fetchSource("https://fixture.test/rules.pdf");
  assert.equal(pdf.sha256, sha256(PDF));
  const path = saveFetchedPdf(root, pdf);
  assert.equal(path, join(root, "fixture.test", `${sha256(PDF).slice(0, 12)}.pdf`));
  assert.deepEqual(readFileSync(path), PDF);
  const page = await fixtureFetcher().fetchSource("https://fixture.test/page");
  assert.throws(() => saveFetchedPdf(root, page), (err) => err.code === "not_pdf");
});

test("retries a 5xx once after a wait, then succeeds", async () => {
  const outcome = await fixtureFetcher().fetchSource("https://fixture.test/flaky");
  assert.equal(outcome.ok, true);
  assert.equal(outcome.status, 200);
  assert.equal(hits.get("/flaky"), 2);
});

test("a 5xx twice is final: fetch_failed with retried, and no third request", async () => {
  const outcome = await fixtureFetcher().fetchSource("https://fixture.test/down");
  assert.equal(outcome.ok, false);
  assert.equal(outcome.reason, "fetch_failed");
  assert.equal(outcome.status, 502);
  assert.equal(outcome.retried, true);
  assert.equal(hits.get("/down"), 2);
});

test("a 4xx is never retried", async () => {
  const outcome = await fixtureFetcher().fetchSource("https://fixture.test/missing-once");
  assert.equal(outcome.status, 404);
  assert.equal(outcome.retried, undefined);
  assert.equal(hits.get("/missing-once"), 1);
});
