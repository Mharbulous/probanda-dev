// Re-embeds the whole pool through commons-reembed, a batch per request, then
// asks it to move every staged embedding in at once. Run from Probanda's
// development machine, after a change of model. Safe to run again after a
// failure: staging a clause again replaces what was staged for it.
//
//   node reembed.mjs [batch size, 10 unless told otherwise]
//
// The secret key comes from the environment variable POOL_SECRET_KEY, set by the
// person running this in their own terminal. This script reads no file.

const ENDPOINT ="https://nbzkuhgiqscjkypedqff.supabase.co/functions/v1/commons-reembed";
const key = process.env.POOL_SECRET_KEY;
if (!key) throw new Error("set POOL_SECRET_KEY first");
const limit = Number(process.argv[2] ?? 10);

async function call(body) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { apikey: key, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`commons-reembed answered ${res.status}: ${text}`);
  return JSON.parse(text);
}

let after = null;
let total = 0;
do {
  const batch = await call({ after, limit });
  if (batch.saved !== true) throw new Error(`a batch was not staged: ${JSON.stringify(batch)}`);
  total += batch.staged;
  after = batch.next;
  console.log(`staged ${total}`);
} while (after);

console.log(JSON.stringify(await call({ finish: true })));
