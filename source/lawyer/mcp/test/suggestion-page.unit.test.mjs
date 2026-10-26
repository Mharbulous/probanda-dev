// The Past suggestions page (suggestions/page.ts): rendered from the stored record, it shows the sent
// payload's fields as stored and the mockup in an iframe sandboxed with no permissions whose srcdoc is
// the stored bytes; dismissed cards and held drafts never appear; its Withdraw button reaches the
// page API (page-api/server.ts) only with the token the render gave that suggestion.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { closedPort, stubCloud, suggestionDevice } from "./helpers/suggestion-fixture.mjs";

const { submitSuggestion, readStatuses } = await import("../build/suggestions/send.js");
const { writePastSuggestionsPage } = await import("../build/suggestions/page.js");
const { suggestionLogWrite } = await import("../build/suggestions/tools.js");
const { withStore } = await import("../build/suggestions/store.js");
const { startPageApi } = await import("../build/page-api/server.js");
const { pageApiSuggestionToken } = await import("../build/page-api/token.js");

const ID = "0b7c3a5e-1f2d-4c6b-9a8e-7d6c5b4a3f21";

// Placeholder text only, with characters an attribute must escape and one outside ASCII.
const MOCKUP = `<!doctype html><html><body style="font-family:Georgia,serif;background:#fdfcf8">
<ol style="padding-left:2em"><li>Item one &amp; "two" — it's <b>bold</b> &lt;not a tag&gt;</li></ol></body></html>`;

const CARD = {
  title: "List layout on the summary page",
  pain_point: "The list is hard to read for [person] in white on dark green.",
  source: "user",
  origin: "practitioner",
  items: ["Put the numbers in their own column with hanging indents.", "Use black serif text on a light background."],
  context_lines: [{ kind: "constraint", text: "No nested cards or boxes." }, { kind: "evidence", text: "A first mockup on [date] was too graphical." }],
  comment: "Mostly the indentation.",
  raw_observation: "pages__preview called 4 times",
  environment_facts: { host: "Code", os: "linux", plugins: { lawyer: "0.9.14", researcher: null } },
  mockup: MOCKUP,
};

/** Every value of `name="..."` attributes in `html`, decoded as the browser decodes them. */
function attributes(html, name) {
  return [...html.matchAll(new RegExp(`\\s${name}="([^"]*)"`, "g"))].map((m) => decode(m[1]));
}

function decode(text) {
  const named = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
  return text.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (whole, ref) =>
    ref[0] === "#" ? String.fromCodePoint(ref[1] === "x" || ref[1] === "X" ? parseInt(ref.slice(2), 16) : Number(ref.slice(1))) : named[ref] ?? whole);
}

/** The page's visible text, tags dropped and entities decoded. */
function visible(html) {
  return decode(html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<iframe[^>]*><\/iframe>/g, "").replace(/<[^>]+>/g, ""));
}

async function sentCard(t, extra = {}) {
  const f = suggestionDevice(t, extra);
  const cloud = await stubCloud(t, (call) => call.path.endsWith("suggestion-submit")
    ? [200, { suggestion_id: ID, items_saved: true, previews_saved: false, mockup_saved: true }]
    : [200, { statuses: [{ suggestion_id: ID, status: "under review", badge: "Approved (1 of 2)", items: [
        { item: 1, status: "approved", reason: "Easier to scan", category: null, implemented_in: null },
        { item: 2, status: "declined", reason: "The page follows the firm's colours", category: "conflicts with how Probanda must work", implemented_in: null },
      ] }] }]);
  f.env.SUPABASE_URL = cloud.url;
  const sent = await submitSuggestion(CARD, f.env, f.seams);
  assert.equal(sent.status, "Submitted ✓");
  await readStatuses(undefined, f.env, f.seams);
  return { f, cloud, recordId: sent.record_id };
}

test("the page shows the sent payload's fields as stored and the mockup's srcdoc byte for byte, sandboxed with no permissions", async (t) => {
  const { f, recordId } = await sentCard(t);
  // Held drafts and dismissed cards never appear.
  await suggestionLogWrite({ op: "hold", draft: { title: "HELD-SENTINEL", body: "Not sent." } }, f.env);
  await withStore(f.env, (s) => { s.records.push({ kind: "dismissal", record_id: "d-1", title: "DISMISSED-SENTINEL" }); });

  const path = await writePastSuggestionsPage(f.env);
  assert.equal(path, `${f.data}/suggestions/Past suggestions.html`);
  const html = readFileSync(path, "utf-8");
  const record = JSON.parse(readFileSync(f.store, "utf-8")).records.find((r) => r.record_id === recordId);
  const stored = JSON.parse(record.payload);

  const frames = [...html.matchAll(/<iframe[^>]*>/g)].map((m) => m[0]);
  assert.equal(frames.length, 1);
  assert.deepEqual(attributes(frames[0], "sandbox"), [""], "sandboxed with no permissions");
  const [srcdoc] = attributes(frames[0], "srcdoc");
  assert.equal(srcdoc, stored.mockup);
  assert.ok(Buffer.from(srcdoc, "utf-8").equals(Buffer.from(stored.mockup, "utf-8")), "byte for byte");
  assert.ok(record.payload.includes(JSON.stringify(MOCKUP)), "the mockup is embedded in the payload as sent");

  const text = visible(html);
  for (const value of [stored.title, stored.pain_point, ...stored.items, stored.comment, stored.raw_observation, ...stored.context_lines.map((l) => l.text)]) {
    assert.ok(text.includes(value), `shows ${value}`);
  }
  assert.ok(text.includes(JSON.stringify(stored.environment_facts, null, 2)), "shows the environment facts as sent");
  assert.match(html, /<span class="bracket">\[person\]<\/span>/, "a bracket is drawn as on the card");
  assert.match(html, /<span class="bracket">\[date\]<\/span>/);
  for (const shown of ["Approved (1 of 2)", "Approved · Easier to scan", "Declined · The page follows the firm's colours", "Show the technical write-up", "Withdraw"]) {
    assert.ok(text.includes(shown), `shows ${shown}`);
  }
  assert.ok(!text.includes("HELD-SENTINEL") && !text.includes("DISMISSED-SENTINEL"));
  for (const internal of ["suggestion_box", "suggestion_id", "payload", "record_id"]) {
    assert.ok(!text.includes(internal), `names no internal: ${internal}`);
  }
  assert.ok(html.includes(`data-token="${pageApiSuggestionToken(recordId, f.env)}"`));
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.equal(scripts.length, 1);
  assert.doesNotThrow(() => new Function(scripts[0]), "the page's script parses");
});

test("an unsent suggestion shows its card status, and a withdrawn one has no Withdraw button", async (t) => {
  const f = suggestionDevice(t);
  f.env.SUPABASE_URL = `http://127.0.0.1:${await closedPort()}`;
  await submitSuggestion({ title: "Unsent one", body: "Not sent yet.", source: "user" }, f.env, f.seams);
  let text = visible(readFileSync(await writePastSuggestionsPage(f.env), "utf-8"));
  assert.ok(text.includes("Not sent, will retry"));
  await withStore(f.env, (s) => { s.records[0].withdrawn_at = "2026-10-26T00:00:00.000Z"; });
  const html = readFileSync(await writePastSuggestionsPage(f.env), "utf-8");
  text = visible(html);
  assert.ok(text.includes("Withdrawn"));
  assert.ok(!html.includes('class="withdraw"'));
});

test("the Withdraw button withdraws through the page API with its token only, and the page file then shows it", async (t) => {
  const port = await closedPort();
  const { f, cloud, recordId } = await sentCard(t, { port });
  cloud.respond = (call) => call.path.endsWith("suggestion-withdraw") ? [200, { suggestion_id: ID, withdrawn: true }] : [200, { statuses: [] }];
  const api = await startPageApi(f.env, { log: () => {} });
  t.after(() => api.close());
  const post = (token) => fetch(`http://127.0.0.1:${port}/suggestions/${recordId}/withdraw`, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: "null" }, body: JSON.stringify({ token }),
  });
  const wrong = await post("0".repeat(64));
  assert.equal(wrong.status, 403);
  assert.equal(cloud.calls.filter((c) => c.path.endsWith("suggestion-withdraw")).length, 0);
  const right = await post(pageApiSuggestionToken(recordId, f.env));
  assert.equal(right.status, 200);
  assert.equal(right.headers.get("access-control-allow-origin"), "null");
  assert.deepEqual(await right.json(), { outcome: "withdrawn", badge: "Withdrawn" });
  const html = readFileSync(`${f.data}/suggestions/Past suggestions.html`, "utf-8");
  assert.ok(!html.includes('class="withdraw"'));
});
