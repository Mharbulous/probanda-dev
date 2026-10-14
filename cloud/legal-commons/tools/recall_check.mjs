// Checks the search over the pooled clauses through commons-search, one query
// per request (the plan's phase 5, step 6). Run from Probanda's development
// machine. Only reads.
//
//   node recall_check.mjs <queries.json> <output.json>
//
// <queries.json> is a list of { "id", "text", "principle_ids", "expect_exact" }.
// principle_ids lists the principle the query came from first, then any
// principle a hit may also come from (a variant).
//
// A reply lists hits in order: `exact` first if any, then `nearest`. A hit is
// from a principle when any record in its `tests` list has that principle in
// `stated_in`. A query's rank is the position of the first hit from one of its
// principles, or null when none is in the first ten.
//
// Pass marks, over the queries with expect_exact false: rank 1 in at least 90%,
// and rank 3 or better in at least 95%. Over the queries with expect_exact
// true: every one comes back as `exact`.
//
// The secret key comes from the environment variable POOL_SECRET_KEY, set by the
// person running this in their own terminal. This script prints no key and no
// clause text.

import fs from "node:fs";

const ENDPOINT = "https://nbzkuhgiqscjkypedqff.supabase.co/functions/v1/commons-search";
const key = process.env.POOL_SECRET_KEY;
if (!key) throw new Error("set POOL_SECRET_KEY first");
const [file, out] = process.argv.slice(2);
if (!file || !out) throw new Error("usage: node recall_check.mjs <queries.json> <output.json>");

const queries = JSON.parse(fs.readFileSync(file, "utf8"));

async function search(text) {
  // Three attempts, because one dropped connection should not cost a run of several minutes.
  for (let attempt = 1; ; attempt++) {
    let status = "no reply";
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { apikey: key, "Content-Type": "application/json" },
        body: JSON.stringify({ text, role: "any", limit: 10 }),
      });
      status = res.status;
      if (res.ok) return await res.json();
    } catch { /* counted as a failed attempt */ }
    if (attempt === 3) throw new Error(`commons-search answered ${status} three times in a row`);
    await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
  }
}

const results = [];
for (const [i, q] of queries.entries()) {
  const reply = await search(q.text);
  const hits = [...(reply.exact ? [reply.exact] : []), ...(reply.nearest ?? [])];
  const position = hits.findIndex((hit) =>
    (hit.tests ?? []).some((t) => (t.stated_in ?? []).some((s) => q.principle_ids.includes(s.principle_id))));
  results.push({
    id: q.id,
    principle_id: q.principle_ids[0],
    expect_exact: q.expect_exact,
    exact: reply.exact != null,
    rank: position >= 0 && position < 10 ? position + 1 : null,
    hits: hits.map((hit) => hit.clause_id),
  });
  if ((i + 1) % 50 === 0) console.log(`${i + 1} of ${queries.length} queries sent`);
}
fs.writeFileSync(out, JSON.stringify(results, null, 1));

const pct = (n, of) => (of ? ((100 * n) / of).toFixed(1) : "0.0") + "%";
function line(label, rows) {
  const at = (n) => rows.filter((r) => r.rank !== null && r.rank <= n).length;
  const cells = [1, 3, 5, 10].map((n) => `${String(at(n)).padStart(4)} ${pct(at(n), rows.length).padStart(6)}`);
  return `${label.padEnd(10)}${String(rows.length).padStart(5)}  ${cells.join("  ")}  ${String(rows.length - at(10)).padStart(9)}`;
}

const rewordings = results.filter((r) => !r.expect_exact);
const pooled = results.filter((r) => r.expect_exact);
console.log(`\n${"".padEnd(10)}${"n".padStart(5)}  ${"rank 1".padStart(11)}  ${"3 or better".padStart(11)}  ${"5 or better".padStart(11)}  ${"10 or better".padStart(11)}  not found`);
console.log(line("overall", rewordings));
for (const id of [...new Set(rewordings.map((r) => r.principle_id))].sort()) {
  console.log(line(id.slice(0, 8), rewordings.filter((r) => r.principle_id === id)));
}

const at1 = rewordings.filter((r) => r.rank === 1).length;
const at3 = rewordings.filter((r) => r.rank !== null && r.rank <= 3).length;
const exact = pooled.filter((r) => r.exact).length;
const marks = [
  [`rank 1 in at least 90%: ${pct(at1, rewordings.length)}`, at1 >= 0.9 * rewordings.length],
  [`rank 3 or better in at least 95%: ${pct(at3, rewordings.length)}`, at3 >= 0.95 * rewordings.length],
  [`every pooled wording comes back as exact: ${exact} of ${pooled.length}`, exact === pooled.length],
];
console.log("");
for (const [name, pass] of marks) console.log(`${pass ? "PASSED" : "FAILED"}  ${name}`);
console.log(`wrote ${out}`);
process.exitCode = marks.every(([, pass]) => pass) ? 0 : 1;
