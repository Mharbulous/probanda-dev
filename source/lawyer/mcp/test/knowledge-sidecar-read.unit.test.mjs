// Effective status at read (shared/knowledge-tree.md section 10, plan Phase 7): a
// confirmation lapses on a passage change, survives a currency move, and a vanished
// rule_ref lands in orphaned_confirmations; a correction is substituted into the
// layout, reported, and never reverted; the session's memoized sources__check result
// makes a missing passage read unconfirmed. The source check runs against a localhost
// fixture through a transport double, as sources-check.unit.test.mjs does.

import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

import { errorOf, knowledgeFile, knowledgeFixture, passageHash } from "./helpers/knowledge-fixture.mjs";

const { knowledgeRead } = await import("../build/knowledge/tools.js");
const { checkSources } = await import("../build/sources/check.js");
const { createSourceFetcher } = await import("../build/sources/fetch.js");

const PAGE =
  "<html><body><h1>Fixture Rules (as amended September 1, 2020)</h1>" +
  "<p>Alpha: the registry copy governs.</p><p>Bravo: address the registrar.</p><p>Echo stays put.</p></body></html>";

const server = http.createServer((req, res) => {
  if (req.url === "/rules") res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(PAGE);
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

const CURRENCY = "September 1, 2020";
const PASSAGES = {
  "R-title": "Alpha: the registry copy governs.",
  "R-addr": "Bravo: address the registrar.",
  "R-echo": "Echo stays put.",
  "R-missing": "Charlie is not on the page.",
  "R-pdf": "Delta was transcribed from the PDF.",
};

// A learned source record: page_url, currency marker and the items' verbatim passages.
const RECORD = `---
page_url: https://fixture.test/rules
accessed: 2026-09-20
checked: 2026-09-20
currency_marker_pattern: 'Fixture Rules \\(as amended ([A-Z][a-z]+ \\d{1,2}, \\d{4})\\)'
currency_marker: ${CURRENCY}
fetch_note: fixture
items:
  - rule_ref: R-title
    passage: "${PASSAGES["R-title"]}"
  - rule_ref: R-addr
    passage: "${PASSAGES["R-addr"]}"
  - rule_ref: R-echo
    passage: ${PASSAGES["R-echo"]}
  - rule_ref: R-missing
    passage: ${PASSAGES["R-missing"]}
  - rule_ref: R-pdf
    passage: ${PASSAGES["R-pdf"]}
    checked_by: file_sha256
    page: 4
---
# Fixture rules excerpt
`;

const ADDRESSEE = { heading: null, heading_numbering: "none", paragraph_numbering: "none", source: "addressee", rule_ref: "R-addr" };
const BLOCK = {
  renderer: "general",
  needs_forum_parts: true,
  folder_code: "LTR",
  title: { value: "Letter to the registry", rule_ref: "R-title" },
  exhibit_numbering: "writing",
  letterhead: true,
  goal_criteria: ["counsel-review"],
  parts: [
    ADDRESSEE,
    { heading: null, heading_numbering: "none", paragraph_numbering: "none", source: "slot:body" },
    { heading: null, heading_numbering: "none", paragraph_numbering: "none", source: "signature-block" },
  ],
};
const FRONT = `learned_by: agent
accessed: 2026-09-20
matter: L8443
reviewed_by:
reviewed_on:
sources:
  - ../Sources/rules.md`;

const FILE = "draft/CAN/BC/BCSC/Documents/letter.md";
const SIDECAR = `${FILE}.confirmations.local.json`;

function row(rule_ref, extra = {}) {
  return {
    rule_ref,
    status: "confirmed",
    by: "pe",
    on: "2026-09-21",
    confirmed_against: { passage_hash: passageHash(PASSAGES[rule_ref] ?? "gone"), currency: CURRENCY },
    ...extra,
  };
}

function fixture(t, rows, venue = "BCSC") {
  const f = knowledgeFixture(t);
  const file = FILE.replace("BCSC", venue);
  f.local(file, knowledgeFile(FRONT, BLOCK));
  f.local(`draft/CAN/BC/${venue}/Sources/rules.md`, RECORD);
  if (rows) f.local(`${file}.confirmations.local.json`, { file, items: rows });
  return { f, file, read: () => knowledgeRead(file, f.seams) };
}

const statusOf = (result, ref) => result.items.find((item) => item.rule_ref === ref);

test("with no sidecar every item of a learned file reads unconfirmed, freshness not verified", (t) => {
  const { read } = fixture(t, null);
  const result = read();
  assert.equal(result.learned, true);
  assert.equal(result.sources_check, "none");
  assert.deepEqual(result.items.map((item) => [item.rule_ref, item.status, item.freshness]), [
    ["R-title", "unconfirmed", "not verified"],
    ["R-addr", "unconfirmed", "not verified"],
    ["R-echo", "unconfirmed", "not verified"],
    ["R-missing", "unconfirmed", "not verified"],
    ["R-pdf", "unconfirmed", "not verified"],
  ]);
  assert.equal(statusOf(result, "R-pdf").pdf_page, "4");
  assert.equal(statusOf(result, "R-title").record, "draft/CAN/BC/BCSC/Sources/rules.md");
  assert.equal(statusOf(result, "R-title").currency, CURRENCY);
  assert.equal(result.header.learned_by, "agent");
  assert.equal(result.header.matter, "L8443");
});

test("a confirmation lapses on a passage change, survives a currency move, and an orphan is kept and reported", (t) => {
  const { read } = fixture(t, [
    row("R-title"),
    row("R-addr", { confirmed_against: { passage_hash: passageHash("Bravo: address the registry."), currency: CURRENCY } }),
    row("R-echo", { confirmed_against: { passage_hash: passageHash(PASSAGES["R-echo"]), currency: "January 1, 2019" } }),
    row("R-gone"),
  ]);
  const result = read();
  assert.equal(statusOf(result, "R-title").status, "confirmed");
  assert.equal(statusOf(result, "R-addr").status, "unconfirmed", "the passage changed, so the row no longer applies");
  assert.deepEqual(result.stale_confirmation, [{
    rule_ref: "R-addr",
    by: "pe",
    on: "2026-09-21",
    confirmed_against: { passage_hash: passageHash("Bravo: address the registry."), currency: CURRENCY },
    passage_hash: passageHash(PASSAGES["R-addr"]),
  }]);
  assert.equal(statusOf(result, "R-echo").status, "confirmed", "a currency move alone does not lapse the row");
  assert.deepEqual(result.currency_moved, [{ rule_ref: "R-echo", confirmed_currency: "January 1, 2019", currency: CURRENCY }]);
  assert.deepEqual(result.orphaned_confirmations.map((orphan) => orphan.rule_ref), ["R-gone"]);
  assert.deepEqual(result.corrections, []);
});

test("a corrected part is substituted into the layout, reported, and stands across a passage change", (t) => {
  const corrected = { heading: "To the Registrar", heading_numbering: "none", paragraph_numbering: "none", source: "addressee" };
  const { read } = fixture(t, [
    row("R-addr", {
      status: "corrected",
      value: corrected,
      confirmed_against: { passage_hash: passageHash("an older passage"), currency: CURRENCY },
    }),
    row("R-title", { status: "corrected", value: "Letter to the court registry" }),
  ]);
  const result = read();
  assert.equal(statusOf(result, "R-addr").status, "corrected");
  assert.deepEqual(result.layout.parts[0], { ...corrected, rule_ref: "R-addr" });
  assert.deepEqual(result.layout.title, { value: "Letter to the court registry", rule_ref: "R-title" });
  assert.deepEqual(result.corrections, [
    { rule_ref: "R-title", value: "Letter to the court registry", by: "pe", on: "2026-09-21", passage_changed: false },
    { rule_ref: "R-addr", value: corrected, by: "pe", on: "2026-09-21", passage_changed: true },
  ]);
  assert.deepEqual(result.corrections_substituted, ["R-title", "R-addr"]);
  assert.deepEqual(result.stale_confirmation, [], "a correction is never reverted to a stale confirmation");
});

test("a corrected value that breaks the layout contract fails hard, naming the file, the field and the rule", (t) => {
  const { read, file } = fixture(t, [
    row("R-addr", { status: "corrected", value: { heading: null, heading_numbering: "none", paragraph_numbering: "none", source: "letterhead-logo" } }),
  ]);
  const err = errorOf(read);
  assert.equal(err.code, "invalid_layout");
  assert.ok(err.message.startsWith(`${file}: parts[0].source:`), err.message);
  assert.match(err.message, /closed vocabulary/);

  const { read: readScalar } = fixture(t, [row("R-title", { status: "corrected", value: { text: "not a scalar" } })]);
  assert.match(errorOf(readScalar).message, /title takes a scalar/);
});

test("a malformed sidecar fails hard", (t) => {
  const { read } = fixture(t, [row("R-title", { status: "corrected" })]);
  const err = errorOf(read);
  assert.equal(err.code, "invalid_sidecar");
  assert.match(err.message, /items\[0\]\.value: is required on a corrected row/);
});

test("a row stamped with its writer's plugin version and shipped_from reads beside an unstamped one; a malformed stamp fails hard", (t) => {
  const { read } = fixture(t, [row("R-title", { plugin_version: "9.9.9", shipped_from: "checkout" }), row("R-addr", { plugin_version: null, shipped_from: "install" }), row("R-echo")]);
  const result = read();
  assert.deepEqual(["R-title", "R-addr", "R-echo"].map((ref) => statusOf(result, ref).status), ["confirmed", "confirmed", "confirmed"]);

  for (const [stamp, rule] of [
    [{ shipped_from: "elsewhere" }, /items\[0\]\.shipped_from: must be "install" or "checkout"/],
    [{ plugin_version: "" }, /items\[0\]\.plugin_version: must be a non-empty string or null/],
  ]) {
    const err = errorOf(fixture(t, [row("R-title", stamp)], "BCCA").read);
    assert.equal(err.code, "invalid_sidecar");
    assert.match(err.message, rule);
  }
});

test("the session's memoized sources__check result makes a missing passage read unconfirmed for the session", async (t) => {
  // BCCA, so no other test's memo entry is in play: the memo is per knowledge path.
  const { f, file, read } = fixture(t, [row("R-title"), row("R-missing"), row("R-pdf")], "BCCA");
  const before = read();
  assert.equal(before.sources_check, "none");
  assert.equal(statusOf(before, "R-missing").status, "confirmed");

  const fetcher = createSourceFetcher(() => ["fixture.test"], transport);
  const checked = await checkSources([{ tree: "knowledge", path: file }], { ...f.seams, fetcher });
  assert.equal(checked.files[0].sources[0].record, "draft/CAN/BC/BCCA/Sources/rules.md");

  const after = read();
  assert.equal(after.sources_check, "consulted");
  assert.deepEqual([statusOf(after, "R-title").status, statusOf(after, "R-title").freshness], ["confirmed", "verified"]);
  assert.deepEqual([statusOf(after, "R-missing").status, statusOf(after, "R-missing").freshness], ["unconfirmed", "missing"]);
  assert.deepEqual([statusOf(after, "R-pdf").status, statusOf(after, "R-pdf").freshness], ["confirmed", "not verified"],
    "a PDF-transcribed item is never machine-checked, so its confirmation stands with freshness not verified");
  assert.equal(statusOf(after, "R-addr").status, "unconfirmed");
});

// #163: no vetted kind. A shipped file a maintainer reviewed (reviewed_by in its header) reads
// unconfirmed item by item until this firm's own sidecar confirms or corrects it.
test("a reviewed shipped file's items read unconfirmed until this firm confirms or corrects each", (t) => {
  const f = knowledgeFixture(t);
  f.shipped(FILE, knowledgeFile(FRONT.replace("reviewed_by:\nreviewed_on:", "reviewed_by: Pat Example\nreviewed_on: 2026-09-22"), BLOCK));
  f.shipped("draft/CAN/BC/BCSC/Sources/rules.md", RECORD);
  f.local(SIDECAR, { file: FILE, items: [row("R-title", { status: "corrected", value: "Letter to the registrar" }), row("R-echo")] });
  const result = knowledgeRead(FILE, f.seams);
  assert.equal(result.layer, "shipped");
  assert.equal(result.header.reviewed_by, "Pat Example");
  assert.equal(statusOf(result, "R-title").status, "corrected");
  assert.equal(statusOf(result, "R-echo").status, "confirmed");
  assert.equal(statusOf(result, "R-addr").status, "unconfirmed", "an item this firm has not confirmed");
  assert.deepEqual(result.layout.title, { value: "Letter to the registrar", rule_ref: "R-title" });
});

test("a missing passage makes a corrected item read unconfirmed for the session; the correction stays recorded", async (t) => {
  // BCHRT, so no other test's memo entry is in play.
  const { f, file, read } = fixture(t, [row("R-missing", { status: "corrected", value: "Charlie is on the notice board." })], "BCHRT");
  const before = read();
  assert.equal(statusOf(before, "R-missing").status, "corrected");

  const fetcher = createSourceFetcher(() => ["fixture.test"], transport);
  await checkSources([{ tree: "knowledge", path: file }], { ...f.seams, fetcher });

  const after = read();
  assert.deepEqual([statusOf(after, "R-missing").status, statusOf(after, "R-missing").freshness], ["unconfirmed", "missing"]);
  assert.deepEqual(after.corrections, [
    { rule_ref: "R-missing", value: "Charlie is on the notice board.", by: "pe", on: "2026-09-21", passage_changed: false },
  ], "the correction is still reported, not reverted");
});

test("the memoized check is found by a read that spells the path in another case", async (t) => {
  const { f, file } = fixture(t, [row("R-title"), row("R-missing")], "BCPC");
  const fetcher = createSourceFetcher(() => ["fixture.test"], transport);
  await checkSources([{ tree: "knowledge", path: file }], { ...f.seams, fetcher });

  const result = knowledgeRead(file.replace("BCPC", "bcpc"), f.seams);
  assert.equal(result.sources_check, "consulted");
  assert.deepEqual([statusOf(result, "R-title").status, statusOf(result, "R-title").freshness], ["confirmed", "verified"]);
  assert.deepEqual([statusOf(result, "R-missing").status, statusOf(result, "R-missing").freshness], ["unconfirmed", "missing"]);
});

test("a corrected row on a Sources\\ excerpt fails the read hard, naming file, rule_ref and rule", (t) => {
  const f = knowledgeFixture(t);
  const excerpt = "draft/CAN/BC/BCSC/Sources/rules.md";
  f.local(excerpt, RECORD);
  f.local(`${excerpt}.confirmations.local.json`, { file: excerpt, items: [row("R-title"), row("R-addr", { status: "corrected", value: "Bravo: write to the registrar." })] });
  const err = errorOf(() => knowledgeRead(excerpt, f.seams));
  assert.equal(err.code, "invalid_sidecar");
  assert.ok(err.message.includes(f.localPath(`${excerpt}.confirmations.local.json`)), err.message);
  assert.match(err.message, /rule_ref "R-addr"/);
  assert.match(err.message, /a Sources\\ excerpt is not correctable/);

  f.local(`${excerpt}.confirmations.local.json`, { file: excerpt, items: [row("R-title")] });
  assert.equal(knowledgeRead(excerpt, f.seams).items.length, 5, "a confirmation on an excerpt reads");
});
