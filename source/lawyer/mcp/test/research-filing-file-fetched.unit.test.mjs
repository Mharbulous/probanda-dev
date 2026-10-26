// research_filing__file_fetched: files a page sources__fetch already fetched, read back from the
// fetch memo, into a matter's `6. LAW` folder and appends its manifest line. The fetcher is the
// sources tests' pattern: a node:http server on localhost, reached through a transport double from
// https URLs on the test's own host, with the guard unchanged.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { createSourceFetcher, sourcesFetch, FETCH_TEXT_LIMIT_BYTES } = await import("../build/sources/fetch.js");
const { fileFetched } = await import("../build/files/research-filing.js");
const { buildToolDefinitions } = await import("../build/schema-gen.js");

const PAGE =
  "<html><body><h1>Fixture Act</h1><p>[current to September 30, 2026]</p>" +
  "<p>1 This Act may be cited as the <i>Fixture Act</i>.</p></body></html>";
const BIG = `<html><body><p>${"Section text. ".repeat(Math.ceil((FETCH_TEXT_LIMIT_BYTES + 1024) / 14))}</p><p>Last section.</p></body></html>`;
const PDF = Buffer.from("%PDF-1.4\n% fixture act\n%%EOF\n");
const RELEASE =
  "<html><body><h1>Fixture rules consultation</h1><p>Effective October 1, 2026; updated October 2026</p>" +
  "<p>The committee invites comment.</p></body></html>";
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

const server = http.createServer((req, res) => {
  if (req.url === "/act") res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(PAGE);
  else if (req.url === "/big") res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(BIG);
  else if (req.url === "/act.pdf") res.writeHead(200, { "Content-Type": "application/pdf" }).end(PDF);
  else if (req.url === "/release") res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(RELEASE);
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

const RECORD = {
  citation: "SBC 2099, c 1",
  title: "Fixture Act",
  kind: "statute",
  jurisdiction: "BC",
  official: true,
  currency_marker: "current to September 30, 2026",
};

/** A matter with a 6. LAW issue folder, a privileged folder inside 6. LAW, and a folder outside it. */
function setup(t) {
  const matter = mkdtempSync(join(tmpdir(), "coclerk-file-fetched-"));
  t.after(() => rmSync(matter, { recursive: true, force: true }));
  const law = join(matter, "6. LAW", "Issue");
  for (const dir of [law, join(matter, "6. LAW", "privileged"), join(matter, "Not law")]) mkdirSync(dir, { recursive: true });
  const fetcher = createSourceFetcher(() => ["fixture.test"], transport);
  return {
    matter,
    law,
    fetcher,
    fetch: (url) => sourcesFetch({ url }, { fetcher }),
    file: (url, dir, filename, record = RECORD) => fileFetched(url, dir, filename, record, { fetcher }),
  };
}

function codeOf(fn) {
  try {
    fn();
  } catch (err) {
    return err.code;
  }
  throw new Error("expected a throw, got none");
}

test("a URL with no memo, or an expired one, is refused not_fetched and nothing is written", (t) => {
  const s = setup(t);
  assert.equal(codeOf(() => s.file("https://fixture.test/act", s.law, "Fixture Act.md")), "not_fetched");
  const expired = { memoized: () => "expired" };
  assert.equal(codeOf(() => fileFetched("https://fixture.test/act", s.law, "Fixture Act.md", RECORD, { fetcher: expired })), "not_fetched");
  assert.deepEqual(readdirSync(s.law), []);
});

test("an HTML memo is filed as .md with the header, and a taken name gets v2", async (t) => {
  const s = setup(t);
  await s.fetch("https://fixture.test/act");
  const NOW = new Date("2026-10-05T12:00:00.000Z");
  const first = fileFetched("https://fixture.test/act", s.law, "Fixture Act.md", RECORD, { fetcher: s.fetcher }, NOW);
  const second = s.file("https://fixture.test/act", s.law, "Fixture Act.md");
  assert.equal(first.filename, "Fixture Act.md");
  assert.equal(second.filename, "Fixture Act v2.md");
  const text = readFileSync(first.path, "utf-8");
  assert.equal(
    text,
    [
      "---",
      'url: "https://fixture.test/act"',
      'final_url: "https://fixture.test/act"',
      `sha256: "${sha256(Buffer.from(PAGE))}"`,
      'fetched_at: "2026-10-05T12:00:00.000Z"',
      'currency_marker: "current to September 30, 2026"',
      "---",
      "Fixture Act",
      "[current to September 30, 2026]",
      "1 This Act may be cited as the Fixture Act.",
      "",
    ].join("\n")
  );
  assert.equal(first.bytes, Buffer.byteLength(text));
});

test("a PDF memo is filed as .pdf, byte for byte", async (t) => {
  const s = setup(t);
  await s.fetch("https://fixture.test/act.pdf");
  const filed = s.file("https://fixture.test/act.pdf", s.law, "Fixture Act.pdf");
  assert.equal(filed.filename, "Fixture Act.pdf");
  assert.deepEqual(readFileSync(filed.path), PDF);
  assert.equal(filed.bytes, PDF.byteLength);
});

test("the manifest line carries the caller's fields and the runtime's", async (t) => {
  const s = setup(t);
  await s.fetch("https://fixture.test/act");
  const NOW = new Date("2026-10-05T12:00:00.000Z");
  const filed = fileFetched("https://fixture.test/act", s.law, "Fixture Act.md", RECORD, { fetcher: s.fetcher }, NOW);
  const lines = readFileSync(filed.manifest.path, "utf-8").trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(filed.manifest.records, 1);
  assert.deepEqual(lines, [
    {
      citation: "SBC 2099, c 1",
      title: "Fixture Act",
      kind: "statute",
      jurisdiction: "BC",
      status: "downloaded",
      source: "official-publisher",
      official: true,
      publisher_host: "fixture.test",
      url: "https://fixture.test/act",
      final_url: "https://fixture.test/act",
      sha256: sha256(Buffer.from(PAGE)),
      filename: "Fixture Act.md",
      path: filed.path,
      fetched_at: "2026-10-05T12:00:00.000Z",
      currency_marker: "current to September 30, 2026",
    },
  ]);
  assert.deepEqual(filed.record, lines[0]);

  const { citation: _citation, ...untitled } = RECORD;
  assert.equal(s.file("https://fixture.test/act", s.law, "Fixture Act.md", untitled).record.citation, null);
});

test("a secondary page is filed with its date line verbatim and labelled secondary, not official-publisher", async (t) => {
  const s = setup(t);
  await s.fetch("https://fixture.test/release");
  const record = { title: "Fixture rules consultation", kind: "secondary", jurisdiction: "BC", official: false, currency_marker: "Effective October 1, 2026; updated October 2026" };
  const filed = s.file("https://fixture.test/release", s.law, "Fixture rules consultation.md", record);
  assert.ok(readFileSync(filed.path, "utf-8").includes('currency_marker: "Effective October 1, 2026; updated October 2026"'));
  const line = JSON.parse(readFileSync(filed.manifest.path, "utf-8").trim());
  assert.equal(line.kind, "secondary");
  assert.equal(line.source, "secondary");
  assert.equal(line.official, false);
  assert.equal(line.currency_marker, "Effective October 1, 2026; updated October 2026");
});

test("a secondary PDF is filed byte for byte, labelled secondary, with its date not read", async (t) => {
  const s = setup(t);
  await s.fetch("https://fixture.test/act.pdf");
  const record = { title: "Fixture consultation paper", kind: "secondary", jurisdiction: "BC", official: false, currency_marker: "PDF: date not read" };
  const filed = s.file("https://fixture.test/act.pdf", s.law, "Fixture consultation paper.pdf", record);
  assert.deepEqual(readFileSync(filed.path), PDF);
  assert.equal(filed.record.source, "secondary");
  assert.equal(filed.record.currency_marker, "PDF: date not read");
});

test("a folder outside 6. LAW and a privileged folder are refused, writing nothing", async (t) => {
  const s = setup(t);
  await s.fetch("https://fixture.test/act");
  assert.equal(codeOf(() => s.file("https://fixture.test/act", join(s.matter, "Not law"), "Fixture Act.md")), "not_law_folder");
  assert.equal(codeOf(() => s.file("https://fixture.test/act", join(s.matter, "6. LAW", "privileged"), "Fixture Act.md")), "protected");
  assert.equal(codeOf(() => s.file("https://fixture.test/act", join(s.matter, "6. LAW", "Missing"), "Fixture Act.md")), "not_found");
  assert.deepEqual(readdirSync(join(s.matter, "Not law")), []);
  assert.deepEqual(readdirSync(join(s.matter, "6. LAW", "privileged")), []);
  assert.equal(existsSync(join(s.matter, "6. LAW", "Missing")), false);
});

test("a page over 200 KB is filed in full", async (t) => {
  const s = setup(t);
  const fetched = await s.fetch("https://fixture.test/big");
  assert.equal(fetched.truncated, true);
  const filed = s.file("https://fixture.test/big", s.law, "Big Act.md");
  const text = readFileSync(filed.path, "utf-8");
  assert.ok(Buffer.byteLength(text) > FETCH_TEXT_LIMIT_BYTES);
  assert.ok(text.endsWith("\nLast section.\n"));
});

test("a filename with the wrong extension, or a record with a runtime field or a missing one, is refused", async (t) => {
  const s = setup(t);
  await s.fetch("https://fixture.test/act");
  await s.fetch("https://fixture.test/act.pdf");
  assert.equal(codeOf(() => s.file("https://fixture.test/act", s.law, "Fixture Act.pdf")), "invalid_filename");
  assert.equal(codeOf(() => s.file("https://fixture.test/act.pdf", s.law, "Fixture Act.md")), "invalid_filename");
  assert.equal(codeOf(() => s.file("https://fixture.test/act", s.law, "sub/Fixture Act.md")), "invalid_filename");
  assert.equal(codeOf(() => s.file("https://fixture.test/act", s.law, "Fixture Act.md", { ...RECORD, status: "downloaded" })), "invalid_argument");
  const { currency_marker: _marker, ...unmarked } = RECORD;
  assert.equal(codeOf(() => s.file("https://fixture.test/act", s.law, "Fixture Act.md", unmarked)), "invalid_argument");
  assert.equal(codeOf(() => s.file("https://fixture.test/act", s.law, "Fixture Act.md", { ...RECORD, official: "yes" })), "invalid_argument");
  assert.deepEqual(readdirSync(s.law), []);
});

test("versions count only names with the same extension", async (t) => {
  const s = setup(t);
  writeFileSync(join(s.law, "Fixture Act.md"), "an answer\n");
  await s.fetch("https://fixture.test/act.pdf");
  assert.equal(s.file("https://fixture.test/act.pdf", s.law, "Fixture Act.pdf").filename, "Fixture Act.pdf");
  assert.equal(s.file("https://fixture.test/act.pdf", s.law, "Fixture Act.pdf").filename, "Fixture Act v2.pdf");
  assert.equal(readFileSync(join(s.law, "Fixture Act.md"), "utf-8"), "an answer\n");
});

test("research_filing__file_fetched is a non-destructive, closed-world write", () => {
  const tool = buildToolDefinitions().find((definition) => definition.name === "research_filing__file_fetched");
  assert.ok(tool);
  assert.deepEqual(tool.annotations, { destructiveHint: false, openWorldHint: false });
  assert.deepEqual(tool.inputSchema.required, ["url", "destination_dir", "filename", "record"]);
});
