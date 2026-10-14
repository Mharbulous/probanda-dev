// Asks commons-find one question and prints its reply, the reply the plugin's
// search tool returns (the plan's phase 7). Run from Probanda's development
// machine. Only reads.
//
//   node find.mjs "<question>" [limit]
//
// The secret key comes from the environment variable POOL_SECRET_KEY, set by the
// person running this in their own terminal. This script prints no key.

const ENDPOINT = "https://nbzkuhgiqscjkypedqff.supabase.co/functions/v1/commons-find";
const key = process.env.POOL_SECRET_KEY;
if (!key) throw new Error("set POOL_SECRET_KEY first");
const [text, limit] = process.argv.slice(2);
if (!text) throw new Error('usage: node find.mjs "<question>" [limit]');

const res = await fetch(ENDPOINT, {
  method: "POST",
  headers: { apikey: key, "Content-Type": "application/json" },
  body: JSON.stringify(limit ? { text, limit: Number(limit) } : { text }),
});
console.log(`${res.status} ${JSON.stringify(JSON.parse(await res.text()), null, 1)}`);
