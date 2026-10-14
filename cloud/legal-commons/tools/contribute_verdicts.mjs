// Stores meaning verdicts in the pool, in one call that saves all of them or
// none (the plan's phase 6). Run from Probanda's development machine.
//
//   node contribute_verdicts.mjs <verdicts.json> <contributor>
//
// <verdicts.json> is the list contribute_verdicts takes: each entry
// { "clause_a", "clause_b", "a_implies_b", "b_implies_a",
//   "judge_kind": "person" | "model", "judge_model", "judge_prompt_version" }.
//
// A file that was saved is not sent again: the function has no duplicate check
// and would store every verdict a second time.
//
// The secret key comes from the environment variable POOL_SECRET_KEY, set by the
// person running this in their own terminal. This script prints no key.

import fs from "node:fs";

const ENDPOINT = "https://nbzkuhgiqscjkypedqff.supabase.co/rest/v1/rpc/contribute_verdicts";
const key = process.env.POOL_SECRET_KEY;
if (!key) throw new Error("set POOL_SECRET_KEY first");
const [file, contributor] = process.argv.slice(2);
if (!file || !contributor) throw new Error("usage: node contribute_verdicts.mjs <verdicts.json> <contributor>");

const verdicts = JSON.parse(fs.readFileSync(file, "utf8"));
const res = await fetch(ENDPOINT, {
  method: "POST",
  headers: { apikey: key, "Content-Type": "application/json", "Content-Profile": "legal_commons" },
  body: JSON.stringify({ p_verdicts: verdicts, p_contributor: contributor }),
});
const text = await res.text();
let json = null;
try { json = JSON.parse(text); } catch { /* not JSON */ }
console.log(`${verdicts.length} verdict(s) sent: ${res.status} ${text.slice(0, 300)}`);
process.exitCode = res.ok && json?.saved === true ? 0 : 1;
