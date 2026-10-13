// Checks the three deployed Edge Functions (the plan's phase 4), and stores the
// first fingerprint while the pool has no clause. Run from Probanda's
// development machine.
//
//   node check_functions.mjs <output.json>
//
// The keys come from the environment variables POOL_SECRET_KEY and
// POOL_PUBLISHABLE_KEY, set by the person running this in their own terminal.
// This script reads no file but tests/embedding_cases.json, and prints no key.
//
// It writes to <output.json> the hosted model's embedding of each string in
// tests/embedding_cases.json, to be compared with a local model's, the time
// each request took, and the marker string it sent as a search, to be looked
// for in the project's logs.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const BASE = "https://nbzkuhgiqscjkypedqff.supabase.co/functions/v1/";
const FUNCTIONS = ["commons-search", "commons-contribute", "commons-reembed"];
// The sizes of the requests the strings are embedded in. The first request
// starts the worker, the second shows one embedding on a running worker, and
// the last is the size of the largest pilot decomposition with its fingerprint.
const GROUPS = [1, 1, 2, 4, 12];

const secret = process.env.POOL_SECRET_KEY;
const publishable = process.env.POOL_PUBLISHABLE_KEY;
if (!secret || !publishable) throw new Error("set POOL_SECRET_KEY and POOL_PUBLISHABLE_KEY first");
const [out] = process.argv.slice(2);
if (!out) throw new Error("usage: node check_functions.mjs <output.json>");

const HERE = path.dirname(fileURLToPath(import.meta.url));
const cases = JSON.parse(fs.readFileSync(path.join(HERE, "..", "tests", "embedding_cases.json"), "utf8"));
if (cases.length !== GROUPS.reduce((a, b) => a + b)) throw new Error("the groups do not cover the strings");
const marker = "probanda-log-marker-" + crypto.randomBytes(6).toString("hex");

async function call(fn, headers, body) {
  const started = Date.now();
  const res = await fetch(BASE + fn, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, text, json, ms: Date.now() - started };
}

let failed = 0;
function report(name, pass, detail) {
  if (!pass) failed++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  " + detail : ""}`);
}
const brief = (r) => `${r.status} ${r.text.slice(0, 160)}`;

for (const fn of FUNCTIONS) {
  let r = await call(fn, {}, {});
  report(`${fn} refuses a request with no apikey`, r.status === 401, brief(r));
  r = await call(fn, { apikey: publishable }, {});
  report(`${fn} refuses the publishable key`, r.status === 401, brief(r));
}

let r = await call("commons-search", { apikey: secret }, { text: marker });
report("commons-search accepts the secret key in apikey alone",
  r.status === 200 && Array.isArray(r.json?.nearest), brief(r));

r = await call("commons-contribute", { apikey: secret }, { payload: {} });
report("commons-contribute accepts the secret key, and answers an empty payload with a question",
  r.status === 200 && r.json?.saved === false && typeof r.json?.question === "string", brief(r));

r = await call("commons-reembed", { apikey: secret }, { finish: true });
report("commons-reembed accepts the secret key, and answers the request to finish",
  r.status === 200 && typeof r.json?.saved === "boolean", brief(r));

r = await call("commons-search", { apikey: secret, Authorization: `Bearer ${secret}` }, { text: marker });
console.log(`INFO  a call with the secret key in both apikey and Authorization: Bearer is ` +
  `${r.status === 200 ? "accepted" : "rejected"}  ${brief(r)}`);
const bothHeaders = { status: r.status, accepted: r.status === 200 };

const embeddings = {};
const requests = [];
let at = 0;
for (const size of GROUPS) {
  const texts = cases.slice(at, at + size);
  at += size;
  r = await call("commons-reembed", { apikey: secret }, { embed: texts });
  const ok = r.status === 200 && r.json?.embeddings?.length === size;
  requests.push({ size, status: r.status, ms: r.ms });
  console.log(`INFO  ${size} embedding(s) in one request: ${r.status}, ${r.ms} ms${ok ? "" : "  " + r.text.slice(0, 160)}`);
  if (ok) {
    texts.forEach((text, i) => { embeddings[text] = r.json.embeddings[i]; });
    continue;
  }
  // The request did not fit: the same strings one at a time, so the comparison still has them.
  for (const text of texts) {
    const one = await call("commons-reembed", { apikey: secret }, { embed: [text] });
    if (one.status === 200 && one.json?.embeddings?.length === 1) embeddings[text] = one.json.embeddings[0];
  }
}
report("every string was embedded by the hosted model", Object.keys(embeddings).length === cases.length);

fs.writeFileSync(out, JSON.stringify({ marker, bothHeaders, requests, embeddings }));
console.log(`\nmarker sent as a search: ${marker}`);
console.log(`wrote ${out}`);
console.log(failed === 0 ? "every check passed" : `${failed} check(s) FAILED`);
process.exitCode = failed === 0 ? 0 : 1;
