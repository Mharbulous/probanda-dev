// Contributes decompositions to the pool, one principle per write, in the
// order given (the plan's phase 5). Run from Probanda's development machine.
// Stops at the first principle that is not saved. Safe to run again: a
// decomposition contributed twice adds nothing.
//
//   node contribute.mjs <payloads.json> <contributor>
//
// <payloads.json> is a list of the payloads contribute_decomposition takes,
// each without "fingerprint" and without any "embedding".
//
// Embedding and writing are two steps, because one Edge Function request ran out
// of compute at 11 embeddings (2026-10-13). The statements are embedded a few at
// a time through commons-reembed's check route, which reads and writes nothing,
// each distinct wording once. The whole principle is then written in one call
// of contribute_decomposition, so it is still saved whole or not at all.
//
// The secret key comes from the environment variable POOL_SECRET_KEY, set by the
// person running this in their own terminal. This script prints no key.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = "https://nbzkuhgiqscjkypedqff.supabase.co";
const BATCH = 4;
const key = process.env.POOL_SECRET_KEY;
if (!key) throw new Error("set POOL_SECRET_KEY first");
const [file, contributor] = process.argv.slice(2);
if (!file || !contributor) throw new Error("usage: node contribute.mjs <payloads.json> <contributor>");

// The fixed sentence is defined once, in the Edge Functions' shared file.
const shared = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "supabase", "functions", "_shared", "pool.ts"), "utf8");
const FINGERPRINT_SENTENCE = shared.match(/FINGERPRINT_SENTENCE = "([^"]+)"/)[1];

async function post(url, headers, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { apikey: key, "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { res, text, json };
}

async function embedAll(texts) {
  const out = new Map();
  const distinct = [...new Set(texts)];
  for (let i = 0; i < distinct.length; i += BATCH) {
    const batch = distinct.slice(i, i + BATCH);
    const { res, text, json } = await post(`${BASE}/functions/v1/commons-reembed`, {}, { embed: batch });
    if (!res.ok || json?.embeddings?.length !== batch.length) {
      throw new Error(`embedding failed: ${res.status} ${text.slice(0, 300)}`);
    }
    batch.forEach((t, j) => out.set(t, json.embeddings[j]));
  }
  return out;
}

const payloads = JSON.parse(fs.readFileSync(file, "utf8"));
let made = 0;
for (const payload of payloads) {
  const items = [
    ...payload.tests.map((t) => t.consequence),
    ...payload.tests.flatMap((t) => t.clauses ?? []),
    ...(payload.rationales ?? []),
  ].filter((item) => item && typeof item.text === "string");
  const embeddings = await embedAll([FINGERPRINT_SENTENCE, ...items.map((item) => item.text)]);
  for (const item of items) item.embedding = embeddings.get(item.text);
  payload.fingerprint = embeddings.get(FINGERPRINT_SENTENCE);

  const { res, text, json } = await post(`${BASE}/rest/v1/rpc/contribute_decomposition`,
    { "Content-Profile": "legal_commons" }, { p_payload: payload, p_contributor: contributor });
  if (!res.ok || json?.saved !== true) {
    console.log(`NOT SAVED  ${payload.principle_id}  ${res.status} ${text.slice(0, 300)}`);
    console.log(`stopped after ${made} new test(s); the principles before this one are saved`);
    process.exit(1);
  }
  made += json.tests_made;
  console.log(`saved  ${payload.principle_id}  ${Object.keys(json.tests).length} test(s), ${json.tests_made} new`);
}
console.log(`\n${payloads.length} principle(s) saved, ${made} new test(s)`);
