// Contributes decompositions to the pool through commons-contribute, one
// principle per request, in the order given (the plan's phase 5). Run from
// Probanda's development machine. Stops at the first principle that is not
// saved. Safe to run again: a decomposition contributed twice adds nothing.
//
//   node contribute.mjs <payloads.json> <contributor>
//
// <payloads.json> is a list of the payloads contribute_decomposition takes,
// each without "fingerprint" and without any "embedding".
//
// The secret key comes from the environment variable POOL_SECRET_KEY, set by the
// person running this in their own terminal. This script prints no key.

import fs from "node:fs";

const ENDPOINT = "https://nbzkuhgiqscjkypedqff.supabase.co/functions/v1/commons-contribute";
const key = process.env.POOL_SECRET_KEY;
if (!key) throw new Error("set POOL_SECRET_KEY first");
const [file, contributor] = process.argv.slice(2);
if (!file || !contributor) throw new Error("usage: node contribute.mjs <payloads.json> <contributor>");

const payloads = JSON.parse(fs.readFileSync(file, "utf8"));
let made = 0;
for (const payload of payloads) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { apikey: key, "Content-Type": "application/json" },
    body: JSON.stringify({ contributor, payload }),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  if (!res.ok || json?.saved !== true) {
    console.log(`NOT SAVED  ${payload.principle_id}  ${res.status} ${text.slice(0, 300)}`);
    console.log(`stopped after ${made} new test(s); the principles before this one are saved`);
    process.exit(1);
  }
  made += json.tests_made;
  console.log(`saved  ${payload.principle_id}  ${Object.keys(json.tests).length} test(s), ${json.tests_made} new`);
}
console.log(`\n${payloads.length} principle(s) saved, ${made} new test(s)`);
