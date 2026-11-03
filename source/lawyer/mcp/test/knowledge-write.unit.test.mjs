// knowledge__write, create (spec §3.2, plan Phase 8): document files and index rows in
// the firm's overlay only. Excerpts are checked against the fetch memo, which a
// localhost fixture fills through a transport double (as sources-fetch.unit.test.mjs
// does); nothing here touches the network.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import http from "node:http";
import { dirname, join } from "node:path";
import test from "node:test";

import { knowledgeFile, knowledgeFixture } from "./helpers/knowledge-fixture.mjs";

const { knowledgeList, knowledgeRead, knowledgeRetire, knowledgeWrite, REPO_RUN_MARKER, MAX_DOCUMENT_BYTES } = await import("../build/knowledge/tools.js");
const { createSourceFetcher } = await import("../build/sources/fetch.js");
const { loadFirmHosts } = await import("../build/sources/hosts.js");
const { buildToolDefinitions } = await import("../build/schema-gen.js");
const { callTool } = await import("../build/dispatch.js");

const page = (marker) =>
  `<html><body><h1>Fixture Rules (as amended ${marker})</h1>` +
  "<p>Alpha: the registry copy governs.</p><p>Bravo: address the registrar.</p></body></html>";
const PAGES = {
  "/rules": page("September 1, 2020"),
  "/older": page("June 1, 2019"),
  "/newer": page("March 1, 2024"),
};

const server = http.createServer((req, res) => {
  if (PAGES[req.url]) res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(PAGES[req.url]);
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

const ITEMS = `  - rule_ref: R-alpha
    passage: "Alpha: the registry copy governs."
  - rule_ref: R-bravo
    passage: "Bravo: address the registrar."
  - rule_ref: R-pdf
    passage: Delta was transcribed from the PDF.
    checked_by: file_sha256
    page: 4`;

function record({ url = "https://fixture.test/rules", marker = "September 1, 2020", items = ITEMS, extra = "" } = {}) {
  return `---
${extra}page_url: ${url}
accessed: 2026-09-25
checked: 2026-09-25
currency_marker_pattern: 'Fixture Rules \\(as amended ([A-Z][a-z]+ \\d{1,2}, \\d{4})\\)'
currency_marker: ${marker}
fetch_note: fixture
items:
${items}
---
# Fixture rules excerpt
`;
}

const RECORD_PATH = "draft/CAN/BC/BCSC/Sources/rules.md";

/** A knowledge fixture and a fixture fetcher whose memo holds the pages already fetched. */
async function setup(t, fetched = ["/rules"]) {
  const f = knowledgeFixture(t);
  const fetcher = createSourceFetcher(() => ["fixture.test"], transport);
  for (const path of fetched) assert.equal((await fetcher.fetchSource(`https://fixture.test${path}`)).ok, true);
  const seams = { ...f.seams, fetcher };
  const write = (args) => knowledgeWrite({ matter: "L8443", ...args }, seams);
  return { f, fetcher, seams, write };
}

async function rejection(promise) {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error("expected a rejection, got none");
}

// ------------------------------------------------------------ documents --

test("create writes a learned document to the overlay, stamping learned_by, the matter, the plugin version and shipped_from", async (t) => {
  const { f, write } = await setup(t);
  const result = await write({ operation: "create", path: RECORD_PATH, content: record({ extra: "matter: L0000\nlearned_by: someone\n" }) });
  assert.equal(result.status, "created");
  assert.equal(result.layer, "local");
  assert.deepEqual(result.header, { learned_by: "agent", matter: "L8443", plugin_version: "9.9.9", shipped_from: "install" });
  assert.deepEqual(result.fetched_deleted, []);
  const text = readFileSync(f.localPath(RECORD_PATH), "utf-8");
  assert.ok(text.startsWith('---\nlearned_by: "agent"\nmatter: "L8443"\nplugin_version: "9.9.9"\nshipped_from: "install"\npage_url: '), text);
  assert.doesNotMatch(text, /L0000|someone/);

  const read = knowledgeRead(RECORD_PATH, f.seams);
  assert.equal(read.layer, "local");
  assert.equal(read.learned, true);
  assert.equal(read.header.matter, "L8443");
  assert.deepEqual(read.items.map((item) => [item.rule_ref, item.status]), [
    ["R-alpha", "unconfirmed"],
    ["R-bravo", "unconfirmed"],
    ["R-pdf", "unconfirmed"],
  ]);
});

// ------------------------------------------------------------ standing client guidance --

const GUIDANCE = "draft/CAN/BC/BCSC/Sources/client-guidance-fixture.md";
const GUIDANCE_MEMO = "draft/CAN/BC/BCSC/Sources/client-guidance-fixture.memo.md";
const guidance = (header) => `---\n${header}---\n## Paragraph\nPlaceholder.\n\n## Trace\nSentence 1: memo para 1.\n`;
const GUIDANCE_HEADER = `memo_path: ${GUIDANCE_MEMO}\ncurrency_date: 2026-11-03\nrelies_on:\n  - Fixture Instrument, s. 1\n`;

test("a client-guidance item is refused without its memo path, currency date or relies_on, or when its memo is absent", async (t) => {
  const { f, write } = await setup(t);
  await write({ operation: "create", path: GUIDANCE_MEMO, content: "---\naccessed: 2026-11-03\n---\nMemo.\n" });
  for (const header of [
    "currency_date: 2026-11-03\nrelies_on:\n  - Fixture Instrument, s. 1\n",
    `memo_path: ${GUIDANCE_MEMO}\nrelies_on:\n  - Fixture Instrument, s. 1\n`,
    `memo_path: ${GUIDANCE_MEMO}\ncurrency_date: 2026-11-03\n`,
  ]) {
    const err = await rejection(write({ operation: "create", path: GUIDANCE, content: guidance(header) }));
    assert.equal(err.code, "invalid_client_guidance");
  }
  const missing = await rejection(
    write({ operation: "create", path: GUIDANCE, content: guidance("memo_path: draft/CAN/BC/BCSC/Sources/client-guidance-none.memo.md\ncurrency_date: 2026-11-03\nrelies_on:\n  - Fixture Instrument, s. 1\n") })
  );
  assert.equal(missing.code, "not_found");
  assert.equal(existsSync(f.localPath(GUIDANCE)), false);
});

test("a client-guidance item reads back with its header, and a stale mark survives on overwrite under the item's own matter", async (t) => {
  const { f, write } = await setup(t);
  await write({ operation: "create", path: GUIDANCE_MEMO, content: "---\naccessed: 2026-11-03\n---\nMemo.\n" });
  await write({ operation: "create", path: GUIDANCE, content: guidance(GUIDANCE_HEADER) });
  const fresh = knowledgeRead(GUIDANCE, f.seams);
  assert.equal(fresh.header.memo_path, GUIDANCE_MEMO);
  assert.equal(fresh.header.currency_date, "2026-11-03");
  assert.equal(fresh.header.stale, undefined);
  assert.match(fresh.content, /## Paragraph\nPlaceholder\./);

  const marked = await write({ operation: "create", path: GUIDANCE, matter: fresh.header.matter, overwrite: true, content: fresh.content.replace("---\n## Paragraph", 'stale: "Fixture Amendment, in force 2026-12-01"\n---\n## Paragraph') });
  assert.equal(marked.status, "overwritten");
  const stale = knowledgeRead(GUIDANCE, f.seams);
  assert.equal(stale.header.stale, "Fixture Amendment, in force 2026-12-01");
  assert.equal(stale.header.matter, fresh.header.matter);
});

test("create refuses a path the shipped tree holds", async (t) => {
  const { f, write } = await setup(t);
  f.shipped(RECORD_PATH, record());
  const err = await rejection(write({ operation: "create", path: RECORD_PATH, content: record() }));
  assert.equal(err.code, "shipped_path");
  assert.equal(existsSync(f.localPath(RECORD_PATH)), false);
});

test("create refuses the confirmation sidecar suffix", async (t) => {
  const { f, write } = await setup(t);
  const path = `${RECORD_PATH}.confirmations.local.json`;
  const err = await rejection(write({ operation: "create", path, content: "{}" }));
  assert.equal(err.code, "reserved_suffix");
  assert.equal(existsSync(f.localPath(path)), false);
});

test("an existing overlay file returns exists unless overwrite is explicit", async (t) => {
  const { f, write } = await setup(t);
  await write({ operation: "create", path: RECORD_PATH, content: record() });
  const err = await rejection(write({ operation: "create", path: RECORD_PATH, content: record() }));
  assert.equal(err.code, "exists");
  assert.match(err.message, /re-read it with knowledge__read and return that path/);
  const again = await write({ operation: "create", path: RECORD_PATH, content: record(), overwrite: true });
  assert.equal(again.status, "overwritten");
  assert.ok(existsSync(f.localPath(RECORD_PATH)));
});

test("a name outside letters, digits, '.', '_' and '-' is refused on write and on read", async (t) => {
  const { f, write } = await setup(t);
  for (const path of ["draft/CAN/BC/BCSC/Sources/rules copy.md", "draft/CAN/BC/Supreme Court/venue.md", "draft/CAN/BC/BCSC/Sources/r(1).md"]) {
    const err = await rejection(write({ operation: "create", path, content: record() }));
    assert.equal(err.code, "path_out_of_scope", path);
    assert.match(err.message, /other than a letter, a digit, "\.", "_" or "-"/, path);
    assert.equal(existsSync(f.localPath(path)), false, path);
    assert.throws(() => knowledgeRead(path, f.seams), (e) => e.code === "path_out_of_scope", path);
  }
});

test("excerpt_mismatch names every rule_ref whose passage is missing, and nothing is written", async (t) => {
  const { f, write } = await setup(t);
  const items = `${ITEMS}
  - rule_ref: R-charlie
    passage: Charlie is not on the page.
  - rule_ref: R-delta
    passage: Delta is not either.`;
  const err = await rejection(write({ operation: "create", path: RECORD_PATH, content: record({ items }) }));
  assert.equal(err.code, "excerpt_mismatch");
  assert.match(err.message, /"R-charlie", "R-delta"/);
  assert.doesNotMatch(err.message, /R-alpha|R-bravo|R-pdf/);
  assert.equal(existsSync(f.localPath(RECORD_PATH)), false);
});

test("memo_expired names the URL, for a page never fetched and for one fetched over 24 hours ago", async (t) => {
  const { f, write } = await setup(t, []);
  const never = await rejection(write({ operation: "create", path: RECORD_PATH, content: record() }));
  assert.equal(never.code, "memo_expired");
  assert.match(never.message, /https:\/\/fixture\.test\/rules has no live memoized fetch.*never fetched/);

  const { write: writeLater } = await setup(t);
  const now = Date.now();
  t.mock.method(Date, "now", () => now + 25 * 60 * 60 * 1000);
  const expired = await rejection(writeLater({ operation: "create", path: RECORD_PATH, content: record() }));
  assert.equal(expired.code, "memo_expired");
  assert.match(expired.message, /https:\/\/fixture\.test\/rules has no live memoized fetch.*over 24 hours ago/);
  assert.equal(existsSync(f.localPath(RECORD_PATH)), false);
});

test("a file with no HTML-sourced item needs no memo", async (t) => {
  const { f, write } = await setup(t, []);
  const items = "  - rule_ref: R-pdf\n    passage: Delta was transcribed from the PDF.\n    checked_by: file_sha256\n    page: 4";
  const result = await write({ operation: "create", path: RECORD_PATH, content: record({ items }) });
  assert.equal(result.status, "created");
  assert.ok(existsSync(f.localPath(RECORD_PATH)));
});

test("a refresh whose page shows an older currency marker is refused as stale_body", async (t) => {
  const { f, write } = await setup(t, ["/rules", "/older", "/newer"]);
  f.local(RECORD_PATH, record({ url: "https://fixture.test/older" }));
  const stale = await rejection(write({ operation: "create", path: RECORD_PATH, content: record({ url: "https://fixture.test/older", marker: "June 1, 2019" }), overwrite: true }));
  assert.equal(stale.code, "stale_body");
  assert.match(stale.message, /"June 1, 2019", older than the recorded currency marker "September 1, 2020"/);
  assert.match(readFileSync(f.localPath(RECORD_PATH), "utf-8"), /currency_marker: September 1, 2020/);

  const same = await write({ operation: "create", path: RECORD_PATH, content: record(), overwrite: true });
  assert.equal(same.status, "overwritten");
  assert.equal(same.stale_check, "compared");
  const newer = await write({ operation: "create", path: RECORD_PATH, content: record({ url: "https://fixture.test/newer", marker: "March 1, 2024" }), overwrite: true });
  assert.equal(newer.status, "overwritten");
  assert.equal(newer.stale_check, "compared");
});

test("a refresh reports stale_check not_ordered for a marker that is not a date, and no_pattern without a recorded pattern", async (t) => {
  const { f, write } = await setup(t);
  f.local(RECORD_PATH, record({ marker: "Version 3" }));
  const notDate = await write({ operation: "create", path: RECORD_PATH, content: record(), overwrite: true });
  assert.equal(notDate.status, "overwritten");
  assert.equal(notDate.stale_check, "not_ordered");

  f.local(RECORD_PATH, record().replace(/^currency_marker_pattern:.*\n/m, ""));
  const noPattern = await write({ operation: "create", path: RECORD_PATH, content: record(), overwrite: true });
  assert.equal(noPattern.status, "overwritten");
  assert.equal(noPattern.stale_check, "no_pattern");
});

test("a block citing a rule_ref that no item of the file or its sources carries is refused, as a read refuses it", async (t) => {
  const { f, write } = await setup(t);
  const path = "draft/CAN/BC/BCSC/Documents/letter.md";
  const block = { renderer: "general", needs_forum_parts: true, folder_code: "LTR", title: { value: "Letter", rule_ref: "R-none" }, exhibit_numbering: "writing", parts: [] };
  const err = await rejection(write({ operation: "create", path, content: knowledgeFile("accessed: 2026-09-25", block) }));
  assert.equal(err.code, "invalid_layout");
  assert.match(err.message, /"R-none", which no item of the file or its source records carries/);
  assert.equal(existsSync(f.localPath(path)), false);
});

test("a dependent file that restates a source record's item is refused naming the remedy; the same file citing the record's rule_ref is created", async (t) => {
  const { f, write } = await setup(t);
  await write({ operation: "create", path: RECORD_PATH, content: record() });
  const venuePath = "draft/CAN/BC/BCSC/venue.md";
  const block = {
    caption_lines: ["IN THE SUPREME COURT OF BRITISH COLUMBIA"],
    file_number_label: { value: "No.", rule_ref: "R-alpha" },
    registry_label: null,
    party_roles: { applicant: "Applicant", respondent: "Respondent" },
    display_label: "BCSC",
  };
  const sources = "accessed: 2026-09-25\nsources:\n  - Sources/rules.md";
  const restated = `${sources}\nitems:\n  - rule_ref: R-alpha\n    passage: "Alpha: the registry copy governs."\n    checked_by: file_sha256`;
  const err = await rejection(write({ operation: "create", path: venuePath, content: knowledgeFile(restated, block) }));
  assert.equal(err.code, "invalid_source_record");
  assert.match(err.message, /rule_ref "R-alpha" is carried by both .*venue\.md and .*Sources\/rules\.md/);
  assert.match(err.message, /names the record in "sources:" and cites its rule_ref; it does not restate the item/);
  assert.equal(existsSync(f.localPath(venuePath)), false);

  const result = await write({ operation: "create", path: venuePath, content: knowledgeFile(sources, block) });
  assert.equal(result.status, "created");
  assert.deepEqual(knowledgeRead(venuePath, f.seams).items.map((item) => item.rule_ref), ["R-alpha", "R-bravo", "R-pdf"]);
});

test("an item neither transcribed from a file nor in a record with a page_url is refused, naming its rule_ref", async (t) => {
  const { f, write } = await setup(t);
  const content = "---\naccessed: 2026-09-25\nitems:\n  - rule_ref: R-loose\n    passage: A passage with no page.\n---\n# Loose\n";
  const err = await rejection(write({ operation: "create", path: RECORD_PATH, content }));
  assert.equal(err.code, "invalid_source_record");
  assert.match(err.message, /rule_ref "R-loose" is neither transcribed from a file/);
  assert.equal(existsSync(f.localPath(RECORD_PATH)), false);
});

test("layout and format blocks are validated by their validators before anything is written", async (t) => {
  const { f, write } = await setup(t);
  const typePath = "draft/CAN/BC/BCSC/Documents/letter.md";
  const block = { renderer: "general", needs_forum_parts: true, folder_code: "LTR", title: "Letter", exhibit_numbering: "writing" };
  const bad = await rejection(write({ operation: "create", path: typePath, content: knowledgeFile("accessed: 2026-09-25", block) }));
  assert.equal(bad.code, "invalid_layout");
  assert.match(bad.message, /parts: is required on a general type/);
  assert.equal(existsSync(f.localPath(typePath)), false);

  const formatPath = "publish/CAN/BC/BCSC/format.md";
  const format = { format: { paper: { value: "tabloid", rule_ref: "F-1" } } };
  const badFormat = await rejection(write({ operation: "create", path: formatPath, content: knowledgeFile("accessed: 2026-09-25", format) }));
  assert.equal(badFormat.code, "invalid_format");
  assert.equal(existsSync(f.localPath(formatPath)), false);

  const good = await write({ operation: "create", path: typePath, content: knowledgeFile("accessed: 2026-09-25", { ...block, parts: [] }) });
  assert.equal(good.status, "created");
});

test("create stamps the practice-data record's matter number, never the caller's string", async (t) => {
  const { f, write } = await setup(t);
  const result = await write({ operation: "create", path: RECORD_PATH, matter: ".L8443", content: record() });
  assert.equal(result.header.matter, "L8443");
  assert.match(readFileSync(f.localPath(RECORD_PATH), "utf-8"), /\nmatter: "L8443"\n/);
});

test("create refuses a matter that is not the number of exactly one practice-data matter, and writes nothing", async (t) => {
  const { f, seams, write } = await setup(t);
  for (const matter of ["Alpha v Bravo", "AlphaBravo", "L0000"]) {
    const err = await rejection(write({ operation: "create", path: RECORD_PATH, matter, content: record() }));
    assert.equal(err.code, "matter_unknown", matter);
    assert.match(err.message, /Nothing was written/);
  }
  const twice = { ...seams, lookUpMatter: async () => [{ matt_num: "L8443" }, { matt_num: "L8443" }] };
  const err = await rejection(knowledgeWrite({ operation: "create", path: RECORD_PATH, matter: "L8443", content: record() }, twice));
  assert.equal(err.code, "matter_unknown");
  assert.equal(existsSync(f.localPath(RECORD_PATH)), false);
});

test("create refuses a document with no front matter, over the size cap, or holding a NUL", async (t) => {
  const { write } = await setup(t);
  const path = "draft/CAN/BC/BCSC/Documents/letter.md";
  assert.equal((await rejection(write({ operation: "create", path, content: "# no header\n" }))).code, "invalid_front_matter");
  const big = `---\naccessed: 2026-09-25\n---\n${"x".repeat(MAX_DOCUMENT_BYTES)}`;
  assert.equal((await rejection(write({ operation: "create", path, content: big }))).code, "too_large");
  assert.equal((await rejection(write({ operation: "create", path, content: `---\naccessed: x\n---\na${String.fromCharCode(0)}b` }))).name, "ValidationError");
});

test("the repo-run marker is refused: a repo session never writes the overlay", async (t) => {
  const { f, seams } = await setup(t);
  const err = await rejection(knowledgeWrite({ operation: "create", path: RECORD_PATH, matter: REPO_RUN_MARKER, content: record() }, seams));
  assert.equal(err.code, "repo_session");
  assert.equal(existsSync(f.localPath(RECORD_PATH)), false);
});

test("reserved overlay entries other than _hosts.json are not written by knowledge__write", async (t) => {
  const { write } = await setup(t);
  for (const path of ["_inbox/saved.md", "_superseded/draft/CAN/BC/BCSC/venue.md", "_fetched/fixture.test/0123456789ab.pdf"]) {
    assert.equal((await rejection(write({ operation: "create", path, content: "---\na: b\n---\n" }))).code, "reserved_entry", path);
  }
});

// ------------------------------------------------------------ firm hosts --

const HOST_ROW = { host: "CivilResolutionBC.ca", category: "venue", page_url: "https://civilresolutionbc.ca/rules" };

test("a host entry creates _hosts.json with the runtime's added and approved_by, and the firm-hosts loader admits it", async (t) => {
  const { f, write } = await setup(t);
  const result = await write({ operation: "create", path: "_hosts.json", row: HOST_ROW });
  assert.equal(result.status, "created");
  assert.equal(result.host, "civilresolutionbc.ca");
  const entries = JSON.parse(readFileSync(f.localPath("_hosts.json"), "utf-8"));
  assert.equal(entries.length, 1);
  assert.match(entries[0].added, /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(entries[0], { host: "civilresolutionbc.ca", category: "venue", page_url: HOST_ROW.page_url, added: entries[0].added, approved_by: "practitioner" });
  assert.deepEqual(result.entry, entries[0]);
  assert.deepEqual(loadFirmHosts(f.localPath("_hosts.json")), ["civilresolutionbc.ca"]);
});

test("a second write for the same host changes nothing and says so; concurrent writes of different hosts both land", async (t) => {
  const { f, write } = await setup(t);
  await write({ operation: "create", path: "_hosts.json", row: HOST_ROW });
  const before = readFileSync(f.localPath("_hosts.json"), "utf-8");
  const again = await write({ operation: "create", path: "_hosts.json", row: { ...HOST_ROW, host: "civilresolutionbc.ca", category: "regulator" } });
  assert.equal(again.status, "exists");
  assert.equal(again.entry.category, "venue");
  assert.equal(readFileSync(f.localPath("_hosts.json"), "utf-8"), before);

  const row = (host) => ({ host, category: "statute", page_url: `https://${host}/acts` });
  const results = await Promise.all([write({ operation: "create", path: "_hosts.json", row: row("one.test") }), write({ operation: "create", path: "_hosts.json", row: row("two.test") })]);
  assert.deepEqual(results.map((r) => r.status), ["created", "created"]);
  assert.deepEqual(loadFirmHosts(f.localPath("_hosts.json")).sort(), ["civilresolutionbc.ca", "one.test", "two.test"]);
});

test("an invalid hostname, a category outside the admitted set, a missing or extra field and the repo-run marker are refused, the file unchanged", async (t) => {
  const { f, seams, write } = await setup(t);
  const hostsPath = f.localPath("_hosts.json");
  const attempts = [
    ...["not a host", "https://x.test", "x.test:443", "x.test/rules", "-bad.test", "bad-.test", "a..test", "1.2.3.4", "localhost", `${"a".repeat(64)}.test`].map((host) => ({ ...HOST_ROW, host })),
    { ...HOST_ROW, category: "blog" },
    { ...HOST_ROW, category: "Venue" },
    ...["host", "category", "page_url"].map((key) => Object.fromEntries(Object.entries(HOST_ROW).filter(([k]) => k !== key))),
    { ...HOST_ROW, page_url: "" },
    { ...HOST_ROW, approved_by: "practitioner" },
    { ...HOST_ROW, added: "2026-01-01" },
  ];
  for (const row of attempts) {
    assert.equal((await rejection(write({ operation: "create", path: "_hosts.json", row }))).name, "ValidationError", JSON.stringify(row));
  }
  assert.equal(existsSync(hostsPath), false, "a refused first write creates no file");

  await write({ operation: "create", path: "_hosts.json", row: HOST_ROW });
  const before = readFileSync(hostsPath, "utf-8");
  for (const row of attempts) await rejection(write({ operation: "create", path: "_hosts.json", row }));
  const repo = await rejection(knowledgeWrite({ operation: "create", path: "_hosts.json", matter: REPO_RUN_MARKER, row: { ...HOST_ROW, host: "other.test" } }, seams));
  assert.equal(repo.code, "repo_session");
  for (const args of [{ content: "[]" }, { overwrite: true }, { rule_ref: "R" }]) {
    assert.equal((await rejection(write({ operation: "create", path: "_hosts.json", row: { ...HOST_ROW, host: "other.test" }, ...args }))).name, "ValidationError");
  }
  assert.equal((await rejection(write({ operation: "confirm", path: "_hosts.json", rule_ref: "R" }))).name, "ValidationError");
  assert.equal(readFileSync(hostsPath, "utf-8"), before);
});

test("a malformed existing _hosts.json, or an entry for the host that the loader ignores, fails hard on write", async (t) => {
  const { f, write } = await setup(t);
  for (const text of ["{ not json", "{}", JSON.stringify([{ host: "civilresolutionbc.ca", category: "venue" }])]) {
    f.local("_hosts.json", text);
    assert.equal((await rejection(write({ operation: "create", path: "_hosts.json", row: HOST_ROW }))).code, "invalid_hosts_file", text);
    assert.equal(readFileSync(f.localPath("_hosts.json"), "utf-8"), text);
  }
});

// ------------------------------------------------------------ index rows --

const SHIPPED_VENUES = {
  jurisdiction: "BC",
  name: "British Columbia",
  venues: [
    { code: "BCSC", name: "Supreme Court of British Columbia", aliases: [{ name: "Supreme Court" }] },
    { code: "BCCA", name: "Court of Appeal for British Columbia", aliases: [] },
  ],
};
const alias = (name) => ({ name, source: "practitioner", ref: "L8443", recorded: "2026-09-25" });

test("venues.json and kinds.json are never written to the overlay", async (t) => {
  const { write } = await setup(t);
  for (const path of ["draft/CAN/BC/venues.json", "draft/CAN/BC/BCSC/Documents/kinds.json"]) {
    const err = await rejection(write({ operation: "create", path, row: { code: "X" } }));
    assert.equal(err.code, "grammar_violation", path);
    assert.match(err.message, /the overlay never holds/);
  }
});

test("an index row is upserted one at a time: a local venue, an alias on a shipped venue, and a replaced row", async (t) => {
  const { f, write } = await setup(t);
  f.shipped("draft/CAN/BC/venues.json", SHIPPED_VENUES);
  const path = "draft/CAN/BC/venues.local.json";
  const local = await write({ operation: "create", path, row: { code: "BCCRT", name: "Civil Resolution Tribunal", aliases: [alias("CRT")] } });
  assert.equal(local.status, "created");
  const partial = await write({ operation: "create", path, row: { code: "BCSC", aliases: [alias("Vancouver Law Courts")] } });
  assert.equal(partial.status, "created");
  const replaced = await write({ operation: "create", path, row: { code: "BCSC", aliases: [alias("Vancouver Law Courts"), alias("Supreme Crt")] } });
  assert.equal(replaced.status, "updated");

  const view = knowledgeRead(path, f.seams).view;
  const bcsc = view.venues.find((venue) => venue.code === "BCSC");
  assert.deepEqual(bcsc.aliases.map((a) => [a.name, a.layer]), [["Supreme Court", "shipped"], ["Vancouver Law Courts", "local"], ["Supreme Crt", "local"]]);
  assert.equal(view.venues.find((venue) => venue.code === "BCCRT").layer, "local");
  const stored = JSON.parse(readFileSync(f.localPath(path), "utf-8"));
  assert.deepEqual(stored.venues.map((row) => row.code), ["BCCRT", "BCSC"]);
});

test("every index row the write saves carries the writer's plugin version and shipped_from, and a caller-supplied one is refused", async (t) => {
  const { f, write } = await setup(t);
  f.shipped("draft/CAN/BC/venues.json", SHIPPED_VENUES);
  const venues = "draft/CAN/BC/venues.local.json";
  const kinds = "draft/CAN/BC/_NoVenue/Documents/kinds.local.json";
  await write({ operation: "create", path: venues, row: { code: "BCCRT", name: "Civil Resolution Tribunal", aliases: [alias("CRT")] } });
  await write({ operation: "create", path: venues, row: { code: "BCSC", aliases: [alias("Vancouver Law Courts")] } });
  await write({ operation: "create", path: venues, row: { name: "Burnaby RCMP", aliases: [], resolves_to: "_NoVenue", source: "practitioner", ref: "L8443", recorded: "2026-09-25" } });
  await write({ operation: "create", path: kinds, row: { file: "letter-to-expert", name: "Letter to an expert", aliases: [], recipient: "expert" } });

  const stamp = { plugin_version: "9.9.9", shipped_from: "install" };
  const stored = JSON.parse(readFileSync(f.localPath(venues), "utf-8"));
  const rows = [...stored.venues, ...stored.not_venues, ...JSON.parse(readFileSync(f.localPath(kinds), "utf-8")).kinds];
  assert.equal(rows.length, 4);
  for (const row of rows) assert.deepEqual({ plugin_version: row.plugin_version, shipped_from: row.shipped_from }, stamp);
  // The stamped files read back.
  assert.equal(knowledgeRead(venues, f.seams).view.not_venues[0].name, "Burnaby RCMP");
  assert.equal(knowledgeRead(kinds, f.seams).view.kinds[0].file, "letter-to-expert");

  const before = readFileSync(f.localPath(venues), "utf-8");
  for (const key of ["plugin_version", "shipped_from"]) {
    const err = await rejection(write({ operation: "create", path: venues, row: { code: "BCPC", name: "Provincial Court", aliases: [], [key]: "install" } }));
    assert.equal(err.name, "ValidationError", key);
    assert.match(err.message, new RegExp(`${key} is not a caller field of an index row; the runtime stamps plugin_version and shipped_from`));
  }
  assert.equal(readFileSync(f.localPath(venues), "utf-8"), before);
});

test("a duplicate alias is refused", async (t) => {
  const { f, write } = await setup(t);
  f.shipped("draft/CAN/BC/venues.json", SHIPPED_VENUES);
  const path = "draft/CAN/BC/venues.local.json";
  const onShipped = await rejection(write({ operation: "create", path, row: { code: "BCCA", aliases: [alias("the supreme  court")] } }));
  assert.equal(onShipped.code, "duplicate_alias");
  const twice = await rejection(write({ operation: "create", path, row: { code: "BCCA", aliases: [alias("Appeal Court"), alias("appeal-court")] } }));
  assert.equal(twice.code, "duplicate_alias");
  assert.equal(existsSync(f.localPath(path)), false);
});

test("an alias equal after normalization to a code, file name or official name is refused", async (t) => {
  const { f, write } = await setup(t);
  f.shipped("draft/CAN/BC/venues.json", SHIPPED_VENUES);
  const venues = "draft/CAN/BC/venues.local.json";
  for (const name of ["B.C.S.C.", "bcca", "The Court of Appeal for British Columbia"]) {
    const err = await rejection(write({ operation: "create", path: venues, row: { code: "BCSC", aliases: [alias(name)] } }));
    assert.equal(err.code, "alias_collision", name);
  }
  f.shipped("draft/CAN/BC/BCSC/Documents/kinds.json", { kinds: [{ file: "notice-of-application", name: "Notice of Application", aliases: [] }] });
  const kinds = "draft/CAN/BC/BCSC/Documents/kinds.local.json";
  const onFile = await rejection(write({ operation: "create", path: kinds, row: { file: "notice-of-application", aliases: [alias("Notice-of-Application")] } }));
  assert.equal(onFile.code, "alias_collision");
  assert.equal(existsSync(f.localPath(kinds)), false);
});

test("a name for a shipped code or file is refused, and a venue code must be a tree name", async (t) => {
  const { f, write } = await setup(t);
  f.shipped("draft/CAN/BC/venues.json", SHIPPED_VENUES);
  f.shipped("draft/CAN/BC/BCSC/Documents/kinds.json", { kinds: [{ file: "notice-of-application", name: "Notice of Application", aliases: [] }] });
  const venue = await rejection(write({ operation: "create", path: "draft/CAN/BC/venues.local.json", row: { code: "BCSC", name: "Supreme Court of B.C.", aliases: [] } }));
  assert.equal(venue.code, "shipped_name");
  const kind = await rejection(write({ operation: "create", path: "draft/CAN/BC/BCSC/Documents/kinds.local.json", row: { file: "notice-of-application", name: "NOA" } }));
  assert.equal(kind.code, "shipped_name");
  const spaced = await rejection(write({ operation: "create", path: "draft/CAN/BC/venues.local.json", row: { code: "Civil Resolution Tribunal", name: "Civil Resolution Tribunal", aliases: [] } }));
  assert.equal(spaced.code, "grammar_violation");
  const reserved = await rejection(write({ operation: "create", path: "draft/CAN/BC/venues.local.json", row: { code: "_NoVenue", name: "No venue", aliases: [] } }));
  assert.equal(reserved.code, "invalid_index");
});

test("under _NoVenue a shared alias may sit on kinds of different recipients, never twice on one recipient", async (t) => {
  const { f, write } = await setup(t);
  const path = "draft/CAN/BC/_NoVenue/Documents/kinds.local.json";
  f.shipped("draft/CAN/BC/_NoVenue/Documents/kinds.json", {
    kinds: [
      { file: "letter-to-opposing-counsel", name: "Letter to opposing counsel", aliases: [{ name: "demand letter" }], recipient: "opposing-counsel" },
      { file: "letter-to-opposing-party", name: "Letter to an opposing party", aliases: [], recipient: "opposing-party" },
      { file: "release", name: "Release", aliases: [], recipient: "opposing-party" },
    ],
  });
  const shared = await write({ operation: "create", path, row: { file: "letter-to-opposing-party", aliases: [alias("Demand Letter")] } });
  assert.equal(shared.status, "created");
  const same = await rejection(write({ operation: "create", path, row: { file: "release", aliases: [alias("demand letter")] } }));
  assert.equal(same.code, "duplicate_alias");
});

test("a kinds row whose file carries .md is refused naming the bare stem, nothing written; the bare stem is created", async (t) => {
  const { f, write } = await setup(t);
  const path = "draft/CAN/BC/_NoVenue/Documents/kinds.local.json";
  const row = { name: "Written submissions", aliases: [], recipient: "expert" };
  const err = await rejection(write({ operation: "create", path, row: { file: "written-submissions.md", ...row } }));
  assert.equal(err.code, "grammar_violation");
  assert.match(err.message, /kinds row file "written-submissions\.md" must be the type file's name without "\.md" \("written-submissions"\)/);
  assert.equal(existsSync(f.localPath(path)), false);
  const created = await write({ operation: "create", path, row: { file: "written-submissions", ...row } });
  assert.equal(created.status, "created");
  assert.equal(created.key, "written-submissions");
});

test("a stem-form kinds row with an alias resolves through the alias to the stem, and its type file is no grammar break", async (t) => {
  const { f, write } = await setup(t);
  const dir = "draft/CAN/BC/_NoVenue/Documents";
  const created = await write({
    operation: "create",
    path: `${dir}/kinds.local.json`,
    row: { file: "written-submissions", name: "Written submissions", aliases: [alias("Submissions in writing")], recipient: "expert" },
  });
  assert.equal(created.status, "created");
  f.local(`${dir}/written-submissions.md`, "# Written submissions\n");

  const list = (resolve) => knowledgeList({ dir, resolve, recipient: "expert" }, f.seams);
  const viaAlias = list("Submissions in writing");
  assert.deepEqual([viaAlias.result, viaAlias.code, viaAlias.via], ["resolved", "written-submissions", "alias"]);
  assert.equal(list("Written submissions").code, "written-submissions");
  assert.equal(list("written-submissions").code, "written-submissions");
  assert.deepEqual(knowledgeList({ dir }, f.seams).grammar_breaks, []);
});

// ------------------------------------------------------------ saved copies --
//
// #1143: a practitioner's saved copy in `_inbox\`, named by `saved_copy` on a source
// record's create. A PDF is hashed into `pdf_sha256` and copied to `_fetched\` once the
// record is written; any other file is left where it is, unhashed.

const SAVED_PDF = "%PDF-1.4\nfixture saved copy\n%%EOF\n";
const SAVED_SHA = createHash("sha256").update(SAVED_PDF).digest("hex");
const SAVED_ITEMS = `  - rule_ref: R-saved
    passage: Echo was transcribed from the saved copy.
    checked_by: file_sha256
    source: practitioner`;

function inbox(f, name, text) {
  mkdirSync(dirname(f.localPath(`_inbox/${name}`)), { recursive: true });
  writeFileSync(f.localPath(`_inbox/${name}`), text);
}

test("a saved PDF is hashed into pdf_sha256, replacing any the content carried, and copied to _fetched under the page_url host", async (t) => {
  const { f, write } = await setup(t, []);
  inbox(f, "rules.pdf", SAVED_PDF);
  const result = await write({
    operation: "create",
    path: RECORD_PATH,
    content: record({ items: SAVED_ITEMS, extra: `pdf_sha256: ${"0".repeat(64)}\n` }),
    saved_copy: "_inbox/rules.pdf",
  });
  const to = `_fetched/fixture.test/${SAVED_SHA.slice(0, 12)}.pdf`;
  assert.deepEqual(result.saved_copy, { path: "_inbox/rules.pdf", copied: true, to, sha256: SAVED_SHA });
  assert.equal(readFileSync(f.localPath("_inbox/rules.pdf"), "utf-8"), SAVED_PDF);
  assert.equal(readFileSync(f.localPath(to), "utf-8"), SAVED_PDF);
  const text = readFileSync(f.localPath(RECORD_PATH), "utf-8");
  assert.match(text, new RegExp(`^pdf_sha256: "${SAVED_SHA}"$`, "m"));
  assert.doesNotMatch(text, /0{64}/);
});

test("a saved PDF of a record with a pdf_url goes under the pdf_url host", async (t) => {
  const { f, write } = await setup(t, []);
  inbox(f, "rules.pdf", SAVED_PDF);
  const result = await write({
    operation: "create",
    path: RECORD_PATH,
    content: record({ items: SAVED_ITEMS, extra: "pdf_url: https://files.fixture.test/rules.pdf\n" }),
    saved_copy: "_inbox/rules.pdf",
  });
  assert.equal(result.saved_copy.to, `_fetched/files.fixture.test/${SAVED_SHA.slice(0, 12)}.pdf`);
  assert.ok(existsSync(f.localPath(result.saved_copy.to)));
});

test("a refused write leaves the saved copy in _inbox and nothing in _fetched", async (t) => {
  const { f, write } = await setup(t);
  inbox(f, "rules.pdf", SAVED_PDF);
  const mismatch = await rejection(
    write({ operation: "create", path: RECORD_PATH, content: record({ items: `${SAVED_ITEMS}\n  - rule_ref: R-x\n    passage: Not on the page.` }), saved_copy: "_inbox/rules.pdf" })
  );
  assert.equal(mismatch.code, "excerpt_mismatch");
  await write({ operation: "create", path: RECORD_PATH, content: record() });
  const exists = await rejection(write({ operation: "create", path: RECORD_PATH, content: record({ items: SAVED_ITEMS }), saved_copy: "_inbox/rules.pdf" }));
  assert.equal(exists.code, "exists");
  assert.equal(readFileSync(f.localPath("_inbox/rules.pdf"), "utf-8"), SAVED_PDF);
  assert.equal(existsSync(f.localPath("_fetched")), false);
});

test("a saved page that is not a PDF is left in _inbox with no hash stamped, and the write proceeds", async (t) => {
  const { f, write } = await setup(t, []);
  inbox(f, "rules.html", "<html><body><p>Echo was transcribed from the saved copy.</p></body></html>");
  const result = await write({ operation: "create", path: RECORD_PATH, content: record({ items: SAVED_ITEMS }), saved_copy: "_inbox/rules.html" });
  assert.equal(result.status, "created");
  assert.deepEqual(result.saved_copy, { path: "_inbox/rules.html", copied: false, reason: "not_pdf" });
  assert.ok(existsSync(f.localPath("_inbox/rules.html")));
  assert.doesNotMatch(readFileSync(f.localPath(RECORD_PATH), "utf-8"), /pdf_sha256/);
  assert.equal(existsSync(f.localPath("_fetched")), false);
});

test("the copied PDF survives a refresh of its record and is deleted when the record is retired", async (t) => {
  const { f, seams, write } = await setup(t); // a refresh compares currency markers against the memoized page
  inbox(f, "rules.pdf", SAVED_PDF);
  const { saved_copy } = await write({ operation: "create", path: RECORD_PATH, content: record({ items: SAVED_ITEMS }), saved_copy: "_inbox/rules.pdf" });
  const refreshed = await write({ operation: "create", path: RECORD_PATH, content: readFileSync(f.localPath(RECORD_PATH), "utf-8"), overwrite: true });
  assert.deepEqual(refreshed.fetched_deleted, []);
  assert.ok(existsSync(f.localPath(saved_copy.to)));
  const retired = await knowledgeRetire({ matter: "L8443", path: RECORD_PATH }, seams);
  assert.deepEqual(retired.fetched_deleted, [saved_copy.to]);
});

test("saved_copy must name an existing file under _inbox of a source record", async (t) => {
  const { f, write } = await setup(t, []);
  f.local("_fetched/fixture.test/0123456789ab.pdf", SAVED_PDF);
  inbox(f, "rules.pdf", SAVED_PDF);
  const create = (saved_copy, content = record({ items: SAVED_ITEMS })) => write({ operation: "create", path: RECORD_PATH, content, saved_copy });
  assert.equal((await rejection(create("_fetched/fixture.test/0123456789ab.pdf"))).code, "invalid_saved_copy");
  assert.equal((await rejection(create("_inbox"))).code, "invalid_saved_copy");
  assert.equal((await rejection(create("_inbox/missing.pdf"))).code, "not_found");
  assert.equal((await rejection(create(7))).name, "ValidationError");
  const notRecord = await rejection(create("_inbox/rules.pdf", "---\ntitle: no page\n---\nText\n"));
  assert.equal(notRecord.code, "invalid_saved_copy");
  const pdfOnly = await rejection(create("_inbox/rules.pdf", "---\npdf_url: https://fixture.test/rules.pdf\n---\nText\n"));
  assert.equal(pdfOnly.code, "invalid_saved_copy");
  inbox(f, "rules.html", "<html></html>");
  const pageHash = await rejection(create("_inbox/rules.html", record({ items: SAVED_ITEMS, extra: `pdf_sha256: ${"0".repeat(64)}\n` })));
  assert.equal(pageHash.code, "invalid_saved_copy");
  assert.ok(existsSync(f.localPath("_inbox/rules.html")));
  assert.ok(existsSync(f.localPath("_inbox/rules.pdf")));
  assert.equal(existsSync(f.localPath(RECORD_PATH)), false);
});

test("an _inbox that is a junction out of the overlay is refused, and nothing moves", async (t) => {
  const { f, write } = await setup(t, []);
  const outside = join(f.scratch, "outside");
  mkdirSync(outside);
  writeFileSync(join(outside, "rules.pdf"), SAVED_PDF);
  mkdirSync(f.overlay, { recursive: true });
  symlinkSync(outside, f.localPath("_inbox"), "junction");
  const err = await rejection(write({ operation: "create", path: RECORD_PATH, content: record({ items: SAVED_ITEMS }), saved_copy: "_inbox/rules.pdf" }));
  assert.equal(err.code, "path_out_of_scope");
  assert.ok(existsSync(join(outside, "rules.pdf")));
  assert.equal(existsSync(f.localPath(RECORD_PATH)), false);
});

test("saved_copy is refused on an index row, a confirm and _hosts.json", async (t) => {
  const { write } = await setup(t, []);
  const index = await rejection(write({ operation: "create", path: "draft/CAN/BC/venues.local.json", row: { code: "BCXX", name: "X", aliases: [] }, saved_copy: "_inbox/a.pdf" }));
  assert.equal(index.name, "ValidationError");
  const confirm = await rejection(write({ operation: "confirm", path: RECORD_PATH, rule_ref: "R-alpha", saved_copy: "_inbox/a.pdf" }));
  assert.equal(confirm.name, "ValidationError");
  const hosts = await rejection(write({ operation: "create", path: "_hosts.json", row: HOST_ROW, saved_copy: "_inbox/a.pdf" }));
  assert.equal(hosts.name, "ValidationError");
});

test("a copy that fails after the record is written is reported, not thrown, and the saved copy stays", async (t) => {
  const { f, write } = await setup(t, []);
  inbox(f, "rules.pdf", SAVED_PDF);
  const to = `_fetched/fixture.test/${SAVED_SHA.slice(0, 12)}.pdf`;
  mkdirSync(join(f.localPath(to), "blocker"), { recursive: true }); // a folder where the PDF would go
  const result = await write({ operation: "create", path: RECORD_PATH, content: record({ items: SAVED_ITEMS }), saved_copy: "_inbox/rules.pdf" });
  assert.equal(result.status, "created");
  assert.equal(result.saved_copy.copied, false);
  assert.equal(typeof result.saved_copy.error, "string");
  assert.ok(existsSync(f.localPath("_inbox/rules.pdf")));
  assert.match(readFileSync(f.localPath(RECORD_PATH), "utf-8"), new RegExp(`pdf_sha256: "${SAVED_SHA}"`));
});

// ------------------------------------------------------------ registration --

test("knowledge__write and knowledge__retire carry write annotations and are routed", async () => {
  for (const name of ["knowledge__write", "knowledge__retire"]) {
    const tool = buildToolDefinitions().find((definition) => definition.name === name);
    assert.ok(tool, name);
    assert.deepEqual(tool.annotations, { destructiveHint: true, openWorldHint: false });
  }
  const write = buildToolDefinitions().find((definition) => definition.name === "knowledge__write");
  assert.deepEqual(write.inputSchema.required, ["operation", "path", "matter"]);
  assert.deepEqual(write.inputSchema.properties.operation.enum, ["create", "confirm", "correct"]);
  // Routed: the repo-run marker is refused before anything is read or written.
  for (const [name, args] of [
    ["knowledge__write", { operation: "create", path: RECORD_PATH, matter: "repo-run", content: "x" }],
    ["knowledge__retire", { path: RECORD_PATH, matter: "repo-run" }],
  ]) {
    const err = await rejection(callTool({}, name, args));
    assert.equal(err.code, "repo_session", name);
  }
  // Routed with the practice-data matter lookup: a name is looked up as a matter number, matches none, and is refused.
  let lookups = 0;
  const practiceDb = {
    items() {
      lookups += 1;
      return new Map();
    },
  };
  const err = await rejection(callTool({ practiceDb }, "knowledge__write", { operation: "create", path: RECORD_PATH, matter: "Alpha v Bravo", content: record() }));
  assert.equal(err.code, "matter_unknown");
  assert.equal(lookups, 1, "the name was looked up in practice data");
});
