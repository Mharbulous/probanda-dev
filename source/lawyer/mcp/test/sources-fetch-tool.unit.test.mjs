// sources__fetch (spec §3.3, plan Phase 8) and the firm's `_hosts.json` joining the
// allowed hosts. The fixture is the Phase 2 pattern: a node:http server on localhost,
// reached through a transport double from https URLs on the test's own hosts, with the
// guard unchanged.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { knowledgeFixture } from "./helpers/knowledge-fixture.mjs";

const { createSourceFetcher, sourcesFetch, FETCH_TEXT_LIMIT_BYTES } = await import("../build/sources/fetch.js");
const { overlayFirmHosts, SOURCES_ALLOWED_HOSTS } = await import("../build/sources/hosts.js");
const { buildToolDefinitions } = await import("../build/schema-gen.js");
const { knowledgeWrite } = await import("../build/knowledge/tools.js");

const APOSTROPHE = String.fromCodePoint(0x2019);
const PAGE =
  "<html><head><script>var hidden = 'Alpha in a script';</script></head><body>" +
  "<h1>Fixture Rules (as amended September 1, 2020)</h1>" +
  `<p>Alpha: the Registry${APOSTROPHE}s <i>fixture</i> copy governs.</p>` +
  "<p>Bravo clause opens here</p><div>Charlie: the registrar decides.</div>" +
  "</body></html>";
const BIG = `<html><body><p>${"Filler text. ".repeat(Math.ceil((FETCH_TEXT_LIMIT_BYTES + 1024) / 13))}</p><p>Tail block.</p></body></html>`;
const PDF = Buffer.from("%PDF-1.4\n% fixture rules\n%%EOF\n");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

const server = http.createServer((req, res) => {
  if (req.url === "/rules") res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(PAGE);
  else if (req.url === "/big") res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(BIG);
  else if (req.url === "/rules.pdf") res.writeHead(200, { "Content-Type": "application/pdf" }).end(PDF);
  else if (req.url === "/moved") res.writeHead(302, { Location: "https://elsewhere.test/landing" }).end();
  else res.writeHead(404).end();
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();
test.after(() => server.close());
const transport = {
  request(url, options, callback) {
    return http.request(
      { host: "127.0.0.1", port, path: url.pathname + url.search, method: options.method, headers: { ...options.headers, host: url.host } },
      callback
    );
  },
};

function setup(t) {
  const f = knowledgeFixture(t);
  const fetcher = createSourceFetcher(() => ["fixture.test"], transport);
  return { f, fetch: (args) => sourcesFetch(args, { ...f.seams, fetcher }) };
}

async function rejection(promise) {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error("expected a rejection, got none");
}

test("an HTML page returns the spec's HTML shape: normalized text, one block per line", async (t) => {
  const { fetch } = setup(t);
  const result = await fetch({ url: "https://fixture.test/rules" });
  assert.deepEqual(result, {
    kind: "html",
    url: "https://fixture.test/rules",
    final_url: "https://fixture.test/rules",
    status: 200,
    size: Buffer.byteLength(PAGE),
    sha256: sha256(Buffer.from(PAGE)),
    blocks_total: 4,
    text: [
      "Fixture Rules (as amended September 1, 2020)",
      `Alpha: the Registry${APOSTROPHE}s fixture copy governs.`,
      "Bravo clause opens here",
      "Charlie: the registrar decides.",
    ].join("\n"),
  });
});

test("match keeps the blocks containing any term, literal and case-insensitive; no matching block is an error", async (t) => {
  const { fetch } = setup(t);
  const result = await fetch({ url: "https://fixture.test/rules", match: ["REGISTRAR", "bravo"] });
  assert.equal(result.blocks_total, 4);
  assert.equal(result.blocks_matched, 2);
  assert.equal(result.text, "Bravo clause opens here\nCharlie: the registrar decides.");
  const one = await fetch({ url: "https://fixture.test/rules", match: "as amended" });
  assert.equal(one.blocks_matched, 1);
  const none = await rejection(fetch({ url: "https://fixture.test/rules", match: "Zulu" }));
  assert.equal(none.code, "no_match");
  assert.equal((await rejection(fetch({ url: "https://fixture.test/rules", match: [] }))).name, "ValidationError");
});

test("text above 200 KB returns truncated: true and no text; match narrows it", async (t) => {
  const { fetch } = setup(t);
  const result = await fetch({ url: "https://fixture.test/big" });
  assert.equal(result.truncated, true);
  assert.equal(Object.hasOwn(result, "text"), false);
  assert.equal(result.blocks_total, 2);
  const narrowed = await fetch({ url: "https://fixture.test/big", match: "tail" });
  assert.equal(narrowed.text, "Tail block.");
  assert.equal(Object.hasOwn(narrowed, "truncated"), false);
});

test("a PDF returns the spec's PDF shape, and save writes it to _fetched/<host>/<sha256 first 12>.pdf in the overlay", async (t) => {
  const { f, fetch } = setup(t);
  const unsaved = await fetch({ url: "https://fixture.test/rules.pdf" });
  assert.deepEqual(unsaved, {
    kind: "pdf",
    url: "https://fixture.test/rules.pdf",
    status: 200,
    size: PDF.byteLength,
    sha256: sha256(PDF),
    saved_path: null,
  });
  assert.equal(existsSync(f.localPath("_fetched")), false);

  const saved = await fetch({ url: "https://fixture.test/rules.pdf", save: true });
  const name = `${sha256(PDF).slice(0, 12)}.pdf`;
  assert.ok(saved.saved_path.endsWith(join("_practice", "knowledge", "_fetched", "fixture.test", name)), saved.saved_path);
  assert.deepEqual(readFileSync(saved.saved_path), PDF);
  assert.deepEqual(readdirSync(f.localPath("_fetched/fixture.test")), [name]);
});

test("save on an HTML page is refused and nothing is written", async (t) => {
  const { f, fetch } = setup(t);
  const err = await rejection(fetch({ url: "https://fixture.test/rules", save: true }));
  assert.equal(err.code, "not_pdf");
  assert.equal(existsSync(f.localPath("_fetched")), false);
});

test("a refused fetch is a result naming the host and redirect_from, not an error", async (t) => {
  const { fetch } = setup(t);
  assert.deepEqual(await fetch({ url: "https://fixture.test/moved" }), {
    refused: "host_not_allowed",
    host: "elsewhere.test",
    url: "https://elsewhere.test/landing",
    redirect_from: "https://fixture.test/moved",
    hosts_fetched: ["fixture.test"],
  });
  const missing = await fetch({ url: "https://fixture.test/nowhere" });
  assert.equal(missing.refused, "fetch_failed");
  assert.equal(missing.detail, "404");
});

test("the firm's _hosts.json joins the shipped hosts, re-read on every call; an entry missing approved_by is not admitted", async (t) => {
  const f = knowledgeFixture(t);
  const fetcher = createSourceFetcher(() => SOURCES_ALLOWED_HOSTS, transport, () => overlayFirmHosts(f.seams.env));
  const fetch = (url) => sourcesFetch({ url }, { ...f.seams, fetcher });
  const entry = (host, extra = {}) => ({ host, category: "venue", page_url: `https://${host}/rules`, added: "2026-09-25", ...extra });
  f.local("_hosts.json", [entry("firm.test", { approved_by: "practitioner" }), entry("unapproved.test")]);

  const admitted = await fetch("https://firm.test/rules");
  assert.equal(admitted.kind, "html");
  assert.equal(admitted.final_url, "https://firm.test/rules");
  const refused = await fetch("https://unapproved.test/rules");
  assert.deepEqual([refused.refused, refused.host], ["host_not_allowed", "unapproved.test"]);

  f.local("_hosts.json", [entry("firm.test", { approved_by: "practitioner" }), entry("unapproved.test", { approved_by: "practitioner" })]);
  assert.equal((await fetch("https://unapproved.test/rules")).kind, "html");
  f.local("_hosts.json", []);
  assert.equal((await fetch("https://firm.test/rules")).refused, "host_not_allowed", "a memoized fetch is refused once its host leaves _hosts.json");
});

test("a fetch refused host_not_allowed succeeds in the same process once knowledge__write records the practitioner's yes", async (t) => {
  const f = knowledgeFixture(t);
  const fetcher = createSourceFetcher(() => SOURCES_ALLOWED_HOSTS, transport, () => overlayFirmHosts(f.seams.env));
  const fetch = () => sourcesFetch({ url: "https://approved.test/rules" }, { ...f.seams, fetcher });
  assert.deepEqual([(await fetch()).refused, (await fetch()).host], ["host_not_allowed", "approved.test"]);
  const written = await knowledgeWrite(
    { operation: "create", path: "_hosts.json", matter: "L8443", row: { host: "approved.test", category: "venue", page_url: "https://approved.test/rules" } },
    f.seams
  );
  assert.equal(written.status, "created");
  assert.equal((await fetch()).kind, "html");
});

test("with no case data root configured there is no overlay, so no firm hosts", (t) => {
  const appData = mkdtempSync(join(tmpdir(), "coclerk-no-config-"));
  t.after(() => rmSync(appData, { recursive: true, force: true }));
  assert.deepEqual(overlayFirmHosts({ APPDATA: appData }), []);
  mkdirSync(join(appData, "Coclerk"));
  writeFileSync(join(appData, "Coclerk", "coclerk.json"), JSON.stringify({ person: "pe" }));
  assert.deepEqual(overlayFirmHosts({ APPDATA: appData }), []);
});

test("a broken configuration or a malformed _hosts.json fails hard, never reading as no firm hosts", async (t) => {
  const f = knowledgeFixture(t);
  const fetcher = createSourceFetcher(() => SOURCES_ALLOWED_HOSTS, transport, () => overlayFirmHosts(f.seams.env));
  f.local("_hosts.json", "{ not json");
  const err = await rejection(sourcesFetch({ url: "https://firm.test/rules" }, { ...f.seams, fetcher }));
  assert.equal(err.code, "invalid_hosts_file");

  const config = join(f.seams.env.APPDATA, "Probanda", "probanda.json");
  writeFileSync(config, JSON.stringify({ case_data_root: join(f.scratch, "moved away") }));
  assert.throws(() => overlayFirmHosts(f.seams.env), /Configured case_data_root does not exist/);
  writeFileSync(config, "{ not json");
  assert.throws(() => overlayFirmHosts(f.seams.env), /probanda\.json is not valid JSON/);
});

test("match on a PDF is refused", async (t) => {
  const { fetch } = setup(t);
  const err = await rejection(fetch({ url: "https://fixture.test/rules.pdf", match: "fixture" }));
  assert.equal(err.name, "ValidationError");
  assert.match(err.message, /match applies only to an HTML page/);
});

test("sources__fetch carries write annotations, open-world", () => {
  const tool = buildToolDefinitions().find((definition) => definition.name === "sources__fetch");
  assert.ok(tool);
  assert.deepEqual(tool.annotations, { readOnlyHint: false, destructiveHint: false, openWorldHint: true });
  assert.deepEqual(tool.inputSchema.required, ["url"]);
  assert.deepEqual(Object.keys(tool.inputSchema.properties), ["url", "match", "save"]);
});
