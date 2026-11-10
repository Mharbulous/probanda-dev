// sources__check with the skill_source and knowledge resolvers (spec §3.3, #972
// sections 1-3, #992 item 7).
//
// A throwaway skills tree holds a dependent file (`sources:`) and its source
// records. A node:http fixture on localhost serves the page, a cross-host
// redirect and a PDF; the fetcher uses the test's own host list and a
// transport double, with the guard unchanged (see sources-fetch.unit.test.mjs).

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { knowledgeFixture } from "./helpers/knowledge-fixture.mjs";

const { checkSources, memoizedKnowledgeCheck } = await import("../build/sources/check.js");
const { createSourceFetcher } = await import("../build/sources/fetch.js");

const PDF = Buffer.from("%PDF-1.4\n% fixture rules\n%%EOF\n");
const PDF_SHA = createHash("sha256").update(PDF).digest("hex");
const PAGE =
  "<html><head><title>Fixture Rules</title><script>var s = 'Echo text in a script';</script></head><body>" +
  "<h1>Fixture Rules (as amended September 1, 2020)</h1>" +
  "<div><p>Alpha: the Registry\u2019s <i>fixture</i> copy governs.</p></div>" +
  "<p>Bravo clause opens here</p><p>and closes here.</p>" +
  '<a href="https://fixture.test/rules.pdf">PDF version</a>' +
  "</body></html>";
const RELATIVE_PAGE = "<html><body><p>Golf rules page.</p><a href='../rules.pdf'>PDF version</a></body></html>";

const hits = new Map();
const server = http.createServer((req, res) => {
  hits.set(req.url, (hits.get(req.url) ?? 0) + 1);
  if (req.url === "/rules") res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(PAGE);
  else if (req.url === "/rules.pdf") res.writeHead(200, { "Content-Type": "application/pdf" }).end(PDF);
  else if (req.url === "/docs/relative") res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(RELATIVE_PAGE);
  else if (req.url === "/moved") res.writeHead(301, { Location: "https://elsewhere.test/rules" }).end();
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

const RECORD = `---
page_url: https://fixture.test/rules
pdf_url: https://fixture.test/rules.pdf
pdf_sha256: ${PDF_SHA}
accessed: 2026-09-25
checked: 2026-09-25
currency_marker_pattern: "Fixture Rules \\\\(as amended ([A-Z][a-z]+ \\\\d{1,2}, \\\\d{4})\\\\)"
currency_marker: September 1, 2020
fetch_note: needs a browser User-Agent
items:
  - rule_ref: R. 1(a)
    passage: "Alpha: the Registry's fixture copy governs."
    source: R. 1(a)
  - rule_ref: R. 2(b)
    passage: >-
      Bravo clause opens here
      and closes here.
  - rule_ref: R. 3(c)
    passage: Charlie is not on the page.
  - rule_ref: R. 4(d)
    passage: Delta was transcribed from the PDF.
    checked_by: file_sha256
    page: 4
---
# Fixture rules excerpt
`;

const OLD_MARKER = `---
page_url: https://fixture.test/rules
currency_marker_pattern: 'Fixture Rules \\(as amended ([A-Z][a-z]+ \\d{1,2}, \\d{4})\\)'
currency_marker: January 1, 2019
---
`;

const MOVED = `---
page_url: https://fixture.test/moved
items:
  - rule_ref: R. 9
    passage: Foxtrot.
---
`;

const VENUE = `---
venue: Fixture venue
sources:
  - Sources/rules.md
  - Sources/old-marker.md
  - Sources/moved.md
---
# Fixture venue
`;

function skillsFixture() {
  const root = mkdtempSync(join(tmpdir(), "coclerk-sources-"));
  const venue = join(root, "source", "skills", "demo-venue");
  mkdirSync(join(venue, "Sources"), { recursive: true });
  writeFileSync(join(venue, "venue.md"), VENUE);
  writeFileSync(join(venue, "Sources", "rules.md"), RECORD);
  writeFileSync(join(venue, "Sources", "old-marker.md"), OLD_MARKER);
  writeFileSync(join(venue, "Sources", "moved.md"), MOVED);
  const installRoot = join(root, "no-install");
  mkdirSync(installRoot);
  return { seams: { env: { COCLERK_REPO_ROOT: root }, installRoot }, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("checks each source a file names and reports facts, never passages", async (t) => {
  const f = skillsFixture();
  t.after(f.cleanup);
  const fetcher = createSourceFetcher(() => ["fixture.test"], transport);
  const result = await checkSources([{ tree: "skill_source", path: "demo-venue/venue.md" }], { ...f.seams, fetcher });

  assert.equal(result.files.length, 1);
  const [file] = result.files;
  assert.equal(file.path, "demo-venue/venue.md");
  assert.equal(file.shipped_from, "checkout");
  assert.equal(file.sources.length, 3);

  assert.deepEqual(file.sources[0], {
    record: "demo-venue/Sources/rules.md",
    page_url: "https://fixture.test/rules",
    page_status: 200,
    marker_recorded: "September 1, 2020",
    marker_found: ["September 1, 2020"],
    marker_matches: true,
    pdf_linked_from_page: true,
    pdf_status: 200,
    pdf_sha256: PDF_SHA,
    pdf_matches: true,
    items: [
      { rule_ref: "R. 1(a)", present: true },   // curly apostrophe on the page, straight in the record
      { rule_ref: "R. 2(b)", present: true },   // spans two <p> blocks
      { rule_ref: "R. 3(c)", present: false },
      { rule_ref: "R. 4(d)", present: null },   // transcribed from the PDF
    ],
    hosts_fetched: ["fixture.test"],
  });

  assert.equal(file.sources[1].record, "demo-venue/Sources/old-marker.md");
  assert.equal(file.sources[1].marker_recorded, "January 1, 2019");
  assert.deepEqual(file.sources[1].marker_found, ["September 1, 2020"]);
  assert.equal(file.sources[1].marker_matches, false);

  assert.deepEqual(file.sources[2], {
    record: "demo-venue/Sources/moved.md",
    page_url: "https://fixture.test/moved",
    hosts_fetched: ["fixture.test"],
    gap: {
      reason: "host_not_allowed",
      host: "elsewhere.test",
      url: "https://elsewhere.test/rules",
      redirect_from: "https://fixture.test/moved",
    },
  });

  // The same page backs two records, and the memo served the second.
  assert.equal(hits.get("/rules"), 1);

  const text = JSON.stringify(result);
  for (const passage of ["Registry", "Bravo", "Charlie", "Delta", "Foxtrot"]) {
    assert.ok(!text.includes(passage), `passage text leaked: ${passage}`);
  }
});

test("a second check within 24 hours makes no request", async (t) => {
  const f = skillsFixture();
  t.after(f.cleanup);
  const fetcher = createSourceFetcher(() => ["fixture.test"], transport);
  const before = { page: hits.get("/rules") ?? 0, pdf: hits.get("/rules.pdf") ?? 0 };
  const files = [{ tree: "skill_source", path: "demo-venue/Sources/rules.md" }];
  const first = await checkSources(files, { ...f.seams, fetcher });
  const second = await checkSources(files, { ...f.seams, fetcher });
  assert.equal(first.files[0].sources[0].record, "demo-venue/Sources/rules.md");
  assert.deepEqual(second, first);
  assert.equal(hits.get("/rules"), before.page + 1);
  assert.equal(hits.get("/rules.pdf"), before.pdf + 1);
});

test("a PDF linked by a relative href resolves against the page's final URL", async (t) => {
  const f = skillsFixture();
  t.after(f.cleanup);
  writeFileSync(
    join(f.seams.env.COCLERK_REPO_ROOT, "source", "skills", "demo-venue", "Sources", "relative.md"),
    `---\npage_url: https://fixture.test/docs/relative\npdf_url: https://fixture.test/rules.pdf\npdf_sha256: ${PDF_SHA}\n---\n`
  );
  const fetcher = createSourceFetcher(() => ["fixture.test"], transport);
  const result = await checkSources([{ tree: "skill_source", path: "demo-venue/Sources/relative.md" }], { ...f.seams, fetcher });
  assert.equal(result.files[0].sources[0].pdf_linked_from_page, true);
  assert.equal(result.files[0].sources[0].pdf_matches, true);
});

test("the knowledge resolver checks the shipped copy and reports the shadowed overlay copy separately", async (t) => {
  const k = knowledgeFixture(t);
  const path = "draft/CAN/BC/BCSC/Sources/rules.md";
  k.shipped(path, RECORD);
  k.local(path, RECORD.replace("R. 3(c)", "R. 3(z)").replace("Charlie is not on the page.", "Bravo clause opens here"));
  k.shipped("draft/CAN/BC/BCSC/venue.md", "---\nsources:\n  - Sources/rules.md\n---\n# BCSC\n");
  const fetcher = createSourceFetcher(() => ["fixture.test"], transport);
  const result = await checkSources(
    [{ tree: "knowledge", path }, { tree: "knowledge", path: "draft/CAN/BC/BCSC/venue.md" }],
    { ...k.seams, fetcher }
  );

  const [record, venue] = result.files;
  assert.equal(record.tree, "knowledge");
  assert.equal(record.path, path);
  assert.equal(record.layer, "shipped");
  assert.equal(record.shipped_from, "install");
  assert.deepEqual(record.sources[0].items.map((item) => [item.rule_ref, item.present]), [
    ["R. 1(a)", true], ["R. 2(b)", true], ["R. 3(c)", false], ["R. 4(d)", null],
  ]);
  assert.equal(record.shadowed_local.path, k.localPath(path));
  assert.equal(record.shadowed_local.identical, false);
  assert.deepEqual(record.shadowed_local.sources[0].items.map((item) => [item.rule_ref, item.present]), [
    ["R. 1(a)", true], ["R. 2(b)", true], ["R. 3(z)", true], ["R. 4(d)", null],
  ]);

  // A dependent's sources resolve relative to it, served as knowledge__read serves them.
  assert.equal(venue.shadowed_local, undefined);
  assert.equal(venue.sources[0].record, path);
  assert.deepEqual(venue.shadowed_sources, [{ path: k.localPath(path), identical: false }], "the record it names is in both layers");
  assert.equal(record.shadowed_sources, undefined, "a source record names no other records");
  assert.equal(memoizedKnowledgeCheck(path), record, "each knowledge result is kept for the session");
});

test("the knowledge resolver refuses an overlay reserved entry and an unknown tree", async (t) => {
  const k = knowledgeFixture(t);
  await assert.rejects(checkSources([{ tree: "knowledge", path: "_hosts.json" }], k.seams), (err) => err.name === "ValidationError");
  await assert.rejects(checkSources([{ tree: "web", path: "x" }], k.seams), /must be "skill_source" or "knowledge"/);
});

test("the knowledge resolver refuses a path breaking the folder grammar, directly or through sources:", async (t) => {
  const k = knowledgeFixture(t);
  k.shipped("draft/job-session.md", "---\npage_url: https://fixture.test/rules\n---\n# Job session\n");
  await assert.rejects(checkSources([{ tree: "knowledge", path: "draft/job-session.md" }], k.seams), (err) => err.code === "grammar_violation");
  k.shipped("draft/CAN/BC/BCSC/venue.md", "---\nsources:\n  - ../../../job-session.md\n---\n# BCSC\n");
  await assert.rejects(checkSources([{ tree: "knowledge", path: "draft/CAN/BC/BCSC/venue.md" }], k.seams), (err) => err.code === "grammar_violation");
});
